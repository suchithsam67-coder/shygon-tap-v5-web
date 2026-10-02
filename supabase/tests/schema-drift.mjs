import { PGlite } from '@electric-sql/pglite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Schema drift: live baseline vs repository migrations (doc 12 M0.2).
 *
 * Read-only reconnaissance. It builds two isolated in-memory PGlite databases,
 * never contacts any real database, and changes no file except the optional
 * JSON report it is asked to write.
 *
 *   LIVE  live-platform-shim.sql + supabase/baseline/000_live_baseline.sql.
 *         psql's \restrict/\unrestrict meta-commands are dropped from the
 *         in-memory copy only. The baseline is applied one pg_dump TOC entry
 *         at a time, so every entry that fails is reported (reconstruction
 *         test).
 *   REPO  the live project's default privileges, copied verbatim from the
 *         baseline's ALTER DEFAULT PRIVILEGES FOR ROLE postgres statements
 *         (so grants compare like-for-like with a Supabase project), then
 *         tests/baseline.sql, then every file in supabase/migrations/ in order.
 *         This is what `npm run db:apply` builds. Each step is snapshotted.
 *
 * Both databases are read through the same catalog queries, so formatting
 * differences in the SQL text do not count as drift. For each live object it
 * also reports which repository step (if any) produced an identical
 * definition. That is the migration-lineage evidence.
 *
 *   node supabase/tests/schema-drift.mjs [--json <out.json>]
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'supabase', 'baseline', '000_live_baseline.sql');
const MIG = path.join(ROOT, 'supabase', 'migrations');
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

if (!fs.existsSync(BASELINE)) {
  console.error('FAIL  supabase/baseline/000_live_baseline.sql not found. M0.2 is blocked without it.');
  process.exit(1);
}
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const baselineSql = fs.readFileSync(BASELINE, 'utf8').replace(/\r\n/g, '\n');
const baselineNoMeta = baselineSql.split('\n').filter((l) => !/^\\(un)?restrict\b/.test(l)).join('\n');
const defaultPrivileges = baselineSql
  .split('\n')
  .filter((l) => /^ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public /.test(l))
  .join('\n');

// ---------------------------------------------------------------- introspection
const Q = {
  tables: `SELECT c.relname AS k, c.relkind AS kind, c.relrowsecurity AS rls, c.relforcerowsecurity AS force_rls
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f')`,
  columns: `SELECT c.relname || '.' || a.attname AS k, format_type(a.atttypid, a.atttypmod) AS type,
                   a.attnotnull AS not_null, pg_get_expr(d.adbin, d.adrelid) AS "default",
                   a.attidentity AS identity, a.attgenerated AS generated
              FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
              JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `SELECT c.relname || '.' || con.conname AS k, con.contype AS type,
                       pg_get_constraintdef(con.oid) AS def, con.convalidated AS validated
                  FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND con.contype <> 'n'`,
  indexes: `SELECT indexname AS k, tablename AS tbl, indexdef AS def FROM pg_indexes WHERE schemaname = 'public'`,
  functions: `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k,
                     pg_get_function_result(p.oid) AS result, l.lanname AS lang, p.provolatile AS volatility,
                     p.prosecdef AS security_definer, array_to_string(p.proconfig, ',') AS config,
                     p.prokind AS kind, p.prosrc AS body
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                JOIN pg_language l ON l.oid = p.prolang
               WHERE n.nspname = 'public'`,
  triggers: `SELECT c.relname || '.' || t.tgname AS k, pg_get_triggerdef(t.oid) AS def, t.tgenabled AS enabled
               FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND NOT t.tgisinternal`,
  policies: `SELECT tablename || '.' || policyname AS k, permissive, array_to_string(roles, ',') AS roles,
                    cmd, qual, with_check
               FROM pg_policies WHERE schemaname = 'public'`,
  table_grants: `SELECT c.relname || '|' || COALESCE(r.rolname, 'PUBLIC') AS k,
                        string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privileges
                   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                   CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
                   LEFT JOIN pg_roles r ON r.oid = a.grantee
                  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m')
                    AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role'))
                  GROUP BY 1`,
  function_grants: `SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || COALESCE(r.rolname, 'PUBLIC') AS k,
                           'EXECUTE' AS privileges
                      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                      LEFT JOIN pg_roles r ON r.oid = a.grantee
                     WHERE n.nspname = 'public' AND a.privilege_type = 'EXECUTE'
                       AND (a.grantee = 0 OR r.rolname IN ('anon','authenticated','service_role'))`,
  views: `SELECT viewname AS k, definition AS def FROM pg_views WHERE schemaname = 'public'`,
  sequences: `SELECT sequencename AS k, data_type::text AS type FROM pg_sequences WHERE schemaname = 'public'`,
  types: `SELECT t.typname AS k, t.typtype AS type FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e','d','c')
             AND (t.typrelid = 0 OR (SELECT relkind FROM pg_class WHERE oid = t.typrelid) = 'c')`,
  extensions: `SELECT extname AS k, extversion AS version FROM pg_extension`,
};

const squash = (s) => (s == null ? s : String(s).replace(/\s+/g, ' ').trim());
const hash = (s) => crypto.createHash('sha256').update(s ?? '').digest('hex').slice(0, 16);
// Semantic fingerprint of a function body. It drops -- and /* */ comments
// (outside single-quoted strings) and then every whitespace character. Two
// bodies with the same fingerprint differ only in comments and layout. The
// live project stores many bodies compacted and without comments.
function semantic(src) {
  if (src == null) return src;
  let out = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; out += ch; continue; }
    if (ch === '-' && src[i + 1] === '-') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 1; continue; }
    if (/\s/.test(ch)) continue;
    out += ch;
  }
  return out;
}

async function introspect(db) {
  // Deparse everything fully schema-qualified on both sides. The baseline sets
  // search_path to '', so without this LIVE would print public.x where REPO
  // prints x, and every such object would look falsely conflicting.
  await db.exec(`SET search_path = ''`);
  const out = {};
  for (const [cat, sql] of Object.entries(Q)) {
    const { rows } = await db.query(sql);
    out[cat] = {};
    for (const row of rows) {
      const { k, ...v } = row;
      if (cat === 'functions') {
        v.semantic_hash = hash(semantic(v.body));
        v.body_hash = hash(squash(v.body));
        v.body_raw = v.body;
        v.body = squash(v.body);
      }
      out[cat][k] = v;
    }
  }
  await db.exec('RESET search_path');
  return out;
}
// Strict comparison: everything except the body text (body_hash stands for it,
// so comment or layout changes count).
const comparable = (cat, v) => {
  if (!v) return null;
  if (cat === 'functions') {
    const { body, body_raw, ...rest } = v;
    return JSON.stringify(rest);
  }
  return JSON.stringify(v);
};
// Semantic comparison: same as strict, but function bodies are compared by
// semantic_hash only (comments and whitespace ignored).
const semanticallyEqual = (cat, a, b) => {
  if (!a || !b) return false;
  if (cat !== 'functions') return comparable(cat, a) === comparable(cat, b);
  const strip = ({ body, body_raw, body_hash, ...rest }) => JSON.stringify(rest);
  return strip(a) === strip(b);
};

// ---------------------------------------------------------------- LIVE
console.log('\n=== LIVE: platform shim + supabase/baseline/000_live_baseline.sql (isolated PGlite) ===');
const live = await PGlite.create();
await live.exec(read('supabase', 'tests', 'live-platform-shim.sql'));
const chunks = baselineNoMeta.split(/\n(?=--\n-- TOC entry )/);
const liveFailures = [];
const expectedLive = [];
for (const chunk of chunks) {
  try {
    await live.exec(chunk);
  } catch (error) {
    const name = (chunk.match(/-- Name: ([^\n]+)/) || [])[1] || '(preamble)';
    const message = String(error.message).split('\n')[0];
    // Every new database already has a public schema, so that one entry is expected to fail.
    if (/^public; Type: SCHEMA;/.test(name) && /already exists/.test(message)) {
      expectedLive.push({ entry: name, error: message });
      continue;
    }
    liveFailures.push({ entry: name, error: message });
  }
}
console.log(`  TOC entries applied: ${chunks.length - liveFailures.length - expectedLive.length}/${chunks.length}; ` +
  `unexpected failures: ${liveFailures.length}; expected (public schema pre-exists): ${expectedLive.length}`);
for (const f of liveFailures) console.log(`  FAIL  ${f.entry}\n        ${f.error}`);
const liveInv = await introspect(live);

// ---------------------------------------------------------------- REPO
console.log('\n=== REPO: live default privileges + tests/baseline.sql + supabase/migrations/* (isolated PGlite) ===');
const repo = await PGlite.create();
const repoFailures = [];
const steps = [];
const repoShim = read('supabase', 'tests', 'baseline.sql').replace(/\r\n/g, '\n');
const withPrivileges = repoShim.replace(
  /(CREATE OR REPLACE FUNCTION auth\.uid\(\)[\s\S]*?\$\$;\n)/,
  // Default privileges must exist before the first public table is created.
  `$1\n${defaultPrivileges}\n`,
);
if (withPrivileges === repoShim || !defaultPrivileges) {
  console.error('FAIL  could not insert the live default privileges into the repository chain.');
  process.exit(1);
}
await repo.exec(withPrivileges);
steps.push({ step: '000 tests/baseline.sql', inv: await introspect(repo) });
for (const file of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
  try {
    await repo.exec(fs.readFileSync(path.join(MIG, file), 'utf8'));
  } catch (error) {
    repoFailures.push({ file, error: String(error.message).split('\n')[0] });
  }
  steps.push({ step: file, inv: await introspect(repo) });
}
console.log(`  migrations applied: ${steps.length - 1 - repoFailures.length}/${steps.length - 1}; failed: ${repoFailures.length}`);
for (const f of repoFailures) console.log(`  FAIL  ${f.file}\n        ${f.error}`);
const repoInv = steps[steps.length - 1].inv;

// ---------------------------------------------------------------- diff + lineage
const report = { generated_at: new Date().toISOString(), live_failures: liveFailures, repo_failures: repoFailures, categories: {} };
console.log('\n=== DIFF (LIVE vs REPO final state) ===');
console.log('  category          live  repo   identical  cosmetic  conflicting  live-only  repo-only');
for (const cat of Object.keys(Q)) {
  const L = liveInv[cat];
  const R = repoInv[cat];
  const keys = [...new Set([...Object.keys(L), ...Object.keys(R)])].sort();
  const res = { identical: [], cosmetic: [], conflicting: [], live_only: [], repo_only: [] };
  for (const k of keys) {
    if (k in L && !(k in R)) res.live_only.push(k);
    else if (!(k in L) && k in R) res.repo_only.push(k);
    else if (comparable(cat, L[k]) === comparable(cat, R[k])) res.identical.push(k);
    else if (semanticallyEqual(cat, L[k], R[k])) res.cosmetic.push(k);
    else {
      const fields = Object.keys(L[k]).filter((f) => !['body', 'body_raw'].includes(f) && JSON.stringify(L[k][f]) !== JSON.stringify(R[k][f]));
      res.conflicting.push({ key: k, fields });
    }
  }
  // Lineage: which repository step(s) produced a definition semantically equal to live.
  const lineage = {};
  for (const k of Object.keys(L)) {
    const matches = steps.filter((s) => semanticallyEqual(cat, s.inv[cat][k], L[k])).map((s) => s.step);
    const firstSeen = steps.find((s) => k in s.inv[cat])?.step ?? null;
    lineage[k] = { first_created_in_repo_at: firstSeen, repo_steps_matching_live: matches };
  }
  report.categories[cat] = { live: L, repo: R, result: res, lineage };
  console.log(`  ${cat.padEnd(16)} ${String(Object.keys(L).length).padStart(5)} ${String(Object.keys(R).length).padStart(5)} ${String(res.identical.length).padStart(11)} ${String(res.cosmetic.length).padStart(9)} ${String(res.conflicting.length).padStart(12)} ${String(res.live_only.length).padStart(10)} ${String(res.repo_only.length).padStart(10)}`);
}

// Per-migration lineage: every object a migration created or changed, and
// whether live carries exactly that version, a different one, or none at all.
// A later migration may redefine the same object again (`later` below), so a
// "different on live" can mean a later version is live rather than drift.
console.log('\n=== MIGRATION LINEAGE (objects each migration created/changed vs live) ===');
console.log('  migration                                         changed  =live  later=live  different  absent');
report.migrations = [];
for (let i = 1; i < steps.length; i++) {
  const prev = steps[i - 1].inv;
  const cur = steps[i].inv;
  const row = { migration: steps[i].step, changed: [], same_as_live: [], later_version_live: [], different_on_live: [], absent_on_live: [] };
  for (const cat of Object.keys(Q)) {
    for (const k of Object.keys(cur[cat])) {
      if (comparable(cat, cur[cat][k]) === comparable(cat, prev[cat][k])) continue;
      const id = `${cat}:${k}`;
      row.changed.push(id);
      const lv = liveInv[cat][k];
      if (lv === undefined) row.absent_on_live.push(id);
      else if (semanticallyEqual(cat, lv, cur[cat][k])) row.same_as_live.push(id);
      else if (steps.slice(i + 1).some((s) => semanticallyEqual(cat, s.inv[cat][k], lv))) row.later_version_live.push(id);
      else row.different_on_live.push(id);
    }
  }
  report.migrations.push(row);
  console.log(`  ${row.migration.padEnd(48)} ${String(row.changed.length).padStart(7)} ${String(row.same_as_live.length).padStart(6)} ` +
    `${String(row.later_version_live.length).padStart(11)} ${String(row.different_on_live.length).padStart(10)} ${String(row.absent_on_live.length).padStart(7)}`);
}

// Replay: what would re-applying every repository migration on top of the live
// schema do? This is what `npm run db:push` (apply-remote.mjs) does to a real
// project. Simulated here on a second isolated copy of LIVE only.
if (process.argv.includes('--replay')) {
  console.log('\n=== REPLAY: supabase/migrations/* re-applied on top of an isolated LIVE copy (what db:push would do) ===');
  const replay = await PGlite.create();
  await replay.exec(read('supabase', 'tests', 'live-platform-shim.sql'));
  for (const chunk of chunks) { try { await replay.exec(chunk); } catch { /* same entries as LIVE above */ } }
  await replay.exec('RESET search_path');
  report.replay = [];
  let prev = liveInv;
  for (const file of fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort()) {
    let error = null;
    try { await replay.exec(fs.readFileSync(path.join(MIG, file), 'utf8')); } catch (e) { error = String(e.message).split('\n')[0]; }
    const inv = await introspect(replay);
    const changed = [];
    for (const cat of Object.keys(Q)) {
      for (const k of new Set([...Object.keys(prev[cat]), ...Object.keys(inv[cat])])) {
        if (!semanticallyEqual(cat, prev[cat][k], inv[cat][k]) && !(prev[cat][k] === undefined && inv[cat][k] === undefined)) {
          changed.push(`${cat}:${k}${prev[cat][k] === undefined ? ' (added)' : inv[cat][k] === undefined ? ' (removed)' : ''}`);
        }
      }
    }
    report.replay.push({ migration: file, error, changed });
    console.log(`  ${file.padEnd(48)} ${error ? 'ERROR ' + error.slice(0, 70) : 'applied'}  — live objects changed: ${changed.length}`);
    prev = inv;
  }
  // Net effect: final replayed state vs the live baseline.
  const net = {};
  for (const cat of Object.keys(Q)) {
    const keys = new Set([...Object.keys(liveInv[cat]), ...Object.keys(prev[cat])]);
    const rows = [...keys].filter((k) => !semanticallyEqual(cat, liveInv[cat][k], prev[cat][k])).map((k) =>
      `${k}${liveInv[cat][k] === undefined ? ' (added)' : prev[cat][k] === undefined ? ' (removed)' : ' (changed)'}`);
    if (rows.length) net[cat] = rows;
  }
  report.replay_net = net;
  const total = Object.values(net).reduce((n, r) => n + r.length, 0);
  console.log(`  NET: ${total} live objects would end up different after replay: ` +
    Object.entries(net).map(([c, r]) => `${c} ${r.length}`).join(', '));
}

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
  console.log(`\n  full report: ${jsonOut}`);
}
console.log(`\nRECONSTRUCTION: live baseline ${liveFailures.length === 0 ? 'APPLIES CLEANLY' : `HAS ${liveFailures.length} FAILING ENTRIES`} to an empty database (with the platform shim).`);
