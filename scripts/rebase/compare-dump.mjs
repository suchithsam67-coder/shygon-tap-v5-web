#!/usr/bin/env node
/**
 * F-30 / T-31 §0: compare a production schema dump with the V5 line, and show
 * how V6's migrations would land on it. READ-ONLY.
 *
 * Everything runs in throwaway in-memory databases (PGlite). The tool reads
 * files only: it opens no network connection and never contacts a server.
 *
 * Usage:
 *   node scripts/rebase/compare-dump.mjs --dump <schema-only dump.sql>
 *        [--v5 <V5 repo>] [--last 057] [--pending 054]
 *        [--extra <migration.sql> ...] [--out <dir>]
 *
 *   --dump     the output of
 *                pg_dump --schema-only --no-owner --schema=public --verbose
 *              A dump that holds table data is refused.
 *   --v5       the V5 line's repository (shygon-tap-website-audit). Without it,
 *              section 2 and the V5 part of section 3 are skipped.
 *   --last     the last V5 migration to use (default: the highest number there).
 *   --pending  the first V5 migration NOT applied on live (default 054). The
 *              base gets V5's pending..last on top of the dump.
 *   --extra    more migrations for the base, applied after V5's, in the order
 *              given (for example the Admin APK's 058).
 *   --out      where report.json and the merge proposals go
 *              (default node_modules/.cache/rebase/report, which git ignores).
 *
 * Sections:
 *   1. load     The dump, one TOC entry at a time (as createLiveDb loads the
 *               2026-09-30 baseline). Every entry that fails is named.
 *   2. replay   The dump against the V5 line replayed (V5's test baseline plus
 *               001..last): tables, columns, constraints, indexes, views,
 *               functions, grants, RLS, policies, triggers, publications.
 *   3. base     The dump + V5 pending..last + --extra, each file in its own
 *               transaction. A failure here is V5's own "step 0" signal.
 *   4. v6       Every V6 migration (020 on; 027 is held aside and not in the
 *               folder) on the base, each in its own transaction.
 *   5. bodies   For each function a V6 migration replaces: is the base's body
 *               still the 2026-09-30 body that V6 was written against? Where it
 *               is not, V6's change is three-way merged (git merge-file) onto the
 *               base's body, through every V6 migration that replaces it, and
 *               each step is written to --out/proposals as a PROPOSAL.
 *               Functions V6 creates that the base already has are listed.
 *
 * Nothing under supabase/ is written. Adapting a migration from a proposal is
 * T-31 build work, which waits for the dump and the owner's go-ahead.
 *
 * stdout carries counts and object names only, never function bodies or policy
 * text. Bodies appear only in files under --out.
 *
 * Exit: 0 the report is complete; 2 the dump did not load completely (the
 * report names every failed entry); 1 a usage error or refused input.
 */
import { PGlite } from '@electric-sql/pglite';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, newMigrations } from '../../supabase/tests/lib/migrations.mjs';
import { createLiveDb } from '../../supabase/tests/lib/live-db.mjs';

const DEFAULT_OUT = path.join(ROOT, 'node_modules', '.cache', 'rebase', 'report');
const firstLine = (error) => String(error?.message ?? error).split('\n')[0];
const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
const lf = (text) => text.replace(/\r\n/g, '\n');

export class InputError extends Error {}

// ---------------------------------------------------------------- inputs

/** Reads a dump, refuses one with table data, and records its provenance. */
export function readDump(file) {
  const raw = fs.readFileSync(file);
  const text = lf(raw.toString('utf8'));
  if (/^-- (?:Data for )?Name: [^\n]*; Type: TABLE DATA;/m.test(text) || /^COPY \S+ [^\n]*FROM stdin;$/m.test(text)) {
    throw new InputError('the dump holds table data; this tool takes schema-only dumps (pg_dump --schema-only)');
  }
  return {
    text,
    provenance: {
      file: path.resolve(file),
      bytes: raw.length,
      sha256: crypto.createHash('sha256').update(raw).digest('hex'),
      header: text.split('\n').filter((l) => /^-- Dumped (from|by) /.test(l)).map((l) => l.slice(3)),
      verbose: /^-- TOC entry /m.test(text),
    },
  };
}

function migrationFiles(dir, from = 0, to = 999) {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f))
    .map((f) => ({ name: f, num: Number(f.slice(0, 3)) }))
    .filter((f) => f.num >= from && f.num <= to)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ ...f, sql: lf(fs.readFileSync(path.join(dir, f.name), 'utf8')) }));
}

function gitState(dir) {
  try {
    const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    return { head, uncommittedFiles: dirty ? dirty.split('\n').length : 0 };
  } catch {
    return { head: null };
  }
}

// ---------------------------------------------------------------- databases

const shim = (name) => fs.readFileSync(path.join(ROOT, 'supabase', 'tests', name), 'utf8');

/**
 * The dump in a fresh database, the same way createLiveDb() loads the
 * 2026-09-30 baseline, except that failures are collected, not thrown.
 * Entries are split on pg_dump's TOC comments (--verbose), or on its
 * "-- Name:" comments when the dump was taken without --verbose.
 */
export async function loadDump(text) {
  const db = await PGlite.create();
  await db.exec(shim('live-platform-shim.sql'));
  const body = text
    .split('\n')
    .filter((line) => !/^\\(un)?restrict\b/.test(line))
    .join('\n');
  const failures = [];
  let entries = 0;
  for (const chunk of body.split(/\n(?=--\n-- (?:TOC entry |(?:Data for )?Name: ))/)) {
    entries++;
    try {
      await db.exec(chunk);
    } catch (error) {
      const name = (chunk.match(/-- Name: ([^\n]+)/) || [])[1] || '(preamble)';
      const message = firstLine(error);
      if (/^public; Type: SCHEMA;/.test(name) && /already exists/.test(message)) continue;
      failures.push(`${name}: ${message}`);
    }
  }
  await db.exec('RESET ALL;');
  try {
    await db.exec(shim('live-auth-shim.sql'));
  } catch (error) {
    failures.push(`supabase/tests/live-auth-shim.sql: ${firstLine(error)}`);
  }
  return { db, entries, failures };
}

/** Each file in its own transaction; a failure is recorded and the next file runs. */
async function applyEach(db, files) {
  const steps = [];
  for (const f of files) {
    await db.exec('BEGIN');
    try {
      await db.exec(f.sql);
      await db.exec('COMMIT');
      steps.push({ migration: f.name, ok: true });
    } catch (error) {
      await db.exec('ROLLBACK');
      steps.push({ migration: f.name, ok: false, error: firstLine(error).slice(0, 240) });
    }
  }
  return steps;
}

// ---------------------------------------------------------------- catalog

const PUBLIC_REL = `FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`;
const sortedAcl = (column) => `array_to_string(ARRAY(SELECT x::text FROM unnest(${column}) x ORDER BY 1), ' ')`;

/** What the comparison looks at. Function bodies are kept as md5 only. */
export async function catalog(db) {
  const map = async (sql, value = (r) => r.v) => new Map((await db.query(sql)).rows.map((r) => [r.k, value(r)]));
  const out = {
    tables: await map(`SELECT c.relname AS k, string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) ||
        CASE WHEN a.attnotnull THEN ' NN' ELSE '' END, ', ' ORDER BY a.attname) AS v
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') GROUP BY c.relname`),
    columnDefaults: await map(`SELECT c.relname || '.' || a.attname AS k, pg_get_expr(d.adbin, d.adrelid) AS v
      FROM pg_attrdef d JOIN pg_class c ON c.oid = d.adrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum WHERE n.nspname = 'public'`),
    constraints: await map(`SELECT c.relname || '.' || k.conname AS k, pg_get_constraintdef(k.oid) AS v
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'`),
    indexes: await map(`SELECT c.relname AS k, pg_get_indexdef(c.oid) AS v ${PUBLIC_REL} AND c.relkind IN ('i','I')`),
    views: await map(`SELECT c.relname AS k, md5(pg_get_viewdef(c.oid)) AS v ${PUBLIC_REL} AND c.relkind IN ('v','m')`),
    rls: await map(`SELECT c.relname AS k, CASE WHEN c.relrowsecurity THEN 'on' ELSE 'off' END ||
        CASE WHEN c.relforcerowsecurity THEN ' forced' ELSE '' END AS v ${PUBLIC_REL} AND c.relkind IN ('r','p')`),
    tableGrants: await map(`SELECT c.relname AS k, ${sortedAcl('c.relacl')} AS v ${PUBLIC_REL}
        AND c.relkind IN ('r','p','v','m','S') AND c.relacl IS NOT NULL`),
    columnGrants: await map(`SELECT c.relname || '.' || a.attname AS k, ${sortedAcl('a.attacl')} AS v
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND a.attacl IS NOT NULL AND NOT a.attisdropped`),
    functions: await map(`SELECT p.oid::regprocedure::text AS k, md5(replace(p.prosrc, E'\\r', '')) AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
    functionAttributes: await map(`SELECT p.oid::regprocedure::text AS k,
        'returns ' || pg_get_function_result(p.oid) || CASE WHEN p.prosecdef THEN ', security definer' ELSE '' END ||
        ', ' || p.provolatile::text || coalesce(', ' || array_to_string(p.proconfig, ' '), '') AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
    functionGrants: await map(`SELECT p.oid::regprocedure::text AS k,
        CASE WHEN p.proacl IS NULL THEN '(default)' ELSE ${sortedAcl('p.proacl')} END AS v
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`),
    policies: await map(`SELECT tablename || '.' || policyname AS k, permissive || ' ' || cmd || ' ' || roles::text || ' ' ||
        coalesce(qual, '') || ' ' || coalesce(with_check, '') AS v FROM pg_policies WHERE schemaname = 'public'`,
      (r) => String(r.v ?? '').replace(/\r/g, '').trim()),
    triggers: await map(`SELECT c.relname || '.' || t.tgname AS k, pg_get_triggerdef(t.oid) AS v FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND NOT t.tgisinternal`),
  };
  try {
    out.publications = await map(`SELECT pubname || '.' || tablename AS k, coalesce(array_to_string(attnames, ', '), '*') AS v
      FROM pg_publication_tables WHERE schemaname = 'public'`);
  } catch {
    out.publications = await map(`SELECT pubname || '.' || tablename AS k, '*' AS v
      FROM pg_publication_tables WHERE schemaname = 'public'`);
  }
  return out;
}

/** Per kind: what only the dump has, what only the replay has, and what differs. */
export function compareCatalogs(dump, replay) {
  const result = {};
  for (const kind of Object.keys(dump)) {
    const d = dump[kind];
    const r = replay[kind];
    result[kind] = {
      onlyDump: [...d.keys()].filter((k) => !r.has(k)).sort(),
      onlyReplay: [...r.keys()].filter((k) => !d.has(k)).sort(),
      differ: [...d.keys()].filter((k) => r.has(k) && d.get(k) !== r.get(k)).sort(),
    };
  }
  return result;
}

// ---------------------------------------------------------------- function bodies

/** Every public function body by signature, for the given names. */
async function bodies(db, names) {
  if (names.length === 0) return new Map();
  const { rows } = await db.query(
    `SELECT p.oid::regprocedure::text AS sig, p.proname AS name, replace(p.prosrc, E'\\r', '') AS src
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY($1)`,
    [names],
  );
  return new Map(rows.map((r) => [r.sig, { name: r.name, src: r.src }]));
}

/** The public functions a migration creates or replaces, by name, ignoring comment lines. */
export function functionsDefinedIn(sql) {
  const code = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return [...new Set([...code.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi)].map((m) => m[1]))];
}

/** git merge-file: V6's change (ancestor -> theirs) onto ours. Returns the merged text and the conflict count. */
function merge3(work, label, ours, ancestor, theirs) {
  fs.mkdirSync(work, { recursive: true });
  const files = ['ours', 'ancestor', 'theirs'].map((n) => path.join(work, `${label}.${n}.txt`));
  [ours, ancestor, theirs].forEach((text, i) => fs.writeFileSync(files[i], text));
  const run = spawnSync(
    'git',
    ['merge-file', '-p', '--diff3', '-L', 'base (dump + pending)', '-L', '2026-09-30 / previous V6', '-L', 'V6', ...files],
    { encoding: 'utf8' },
  );
  if (run.error || run.status === null || run.status < 0 || run.status > 127) {
    return { merged: null, conflicts: null, error: firstLine(run.error ?? run.stderr) };
  }
  return { merged: run.stdout, conflicts: run.status };
}

// ---------------------------------------------------------------- the run

export async function runComparison(options) {
  const out = path.resolve(options.out ?? DEFAULT_OUT);
  const pendingFrom = Number(options.pending ?? 54);
  const dump = readDump(options.dump);
  const report = {
    tool: 'scripts/rebase/compare-dump.mjs',
    generatedAt: new Date().toISOString(),
    provenance: { dump: dump.provenance, v6: gitState(ROOT) },
    note: 'READ-ONLY. In-memory databases only. Proposals are not applied anywhere.',
  };

  // 1. load
  const loaded = await loadDump(dump.text);
  report.load = { entries: loaded.entries, complete: loaded.failures.length === 0, failures: loaded.failures };
  const dumpCatalog = await catalog(loaded.db);

  // 2. replay
  let pending = [];
  if (options.v5) {
    const v5Dir = path.join(options.v5, 'supabase', 'migrations');
    const all = migrationFiles(v5Dir);
    const last = Number(options.last ?? all.at(-1).num);
    report.provenance.v5 = { repo: path.resolve(options.v5), ...gitState(options.v5), last };
    const replay = await PGlite.create();
    await replay.exec(fs.readFileSync(path.join(options.v5, 'supabase', 'tests', 'baseline.sql'), 'utf8'));
    const replayed = [];
    for (const f of all.filter((m) => m.num <= last)) {
      try {
        await replay.exec(f.sql);
        replayed.push(f.name);
      } catch (error) {
        throw new InputError(`the V5 line does not replay: ${f.name}: ${firstLine(error)}`);
      }
    }
    report.replay = { applied: `${replayed[0]} .. ${replayed.at(-1)} (${replayed.length} files)`, ...compareCatalogs(dumpCatalog, await catalog(replay)) };
    await replay.close();
    pending = all.filter((m) => m.num >= pendingFrom && m.num <= last);
  } else {
    report.replay = { skipped: 'no --v5 given' };
  }

  // 3. base
  const extras = (options.extra ?? []).map((file) => ({ name: path.basename(file), sql: lf(fs.readFileSync(file, 'utf8')) }));
  report.base = { steps: await applyEach(loaded.db, [...pending, ...extras]) };

  // 5 (prepared before 4 changes the base). Which functions do V6 migrations define?
  const v6 = newMigrations().map((m) => ({ ...m, defines: functionsDefinedIn(m.sql) }));
  const names = [...new Set(v6.flatMap((m) => m.defines))];
  const baseBodies = await bodies(loaded.db, names);

  // 4. v6 on the base
  const steps = await applyEach(loaded.db, v6);
  report.v6 = { applied: steps.filter((s) => s.ok).length, total: steps.length, steps };
  await loaded.db.close();

  // 5. bodies: 2026-09-30, then V6's body after each migration that defines it.
  const reference = await createLiveDb();
  const origin = await bodies(reference, names);
  const versions = new Map(); // sig -> [{ migration, src }]
  for (const m of v6) {
    await reference.exec(m.sql);
    for (const [sig, b] of await bodies(reference, m.defines)) {
      if (!versions.has(sig)) versions.set(sig, []);
      const list = versions.get(sig);
      if (list.length === 0 || list.at(-1).src !== b.src) list.push({ migration: m.name, src: b.src });
    }
  }
  await reference.close();

  const results = [];
  const proposals = path.join(out, 'proposals');
  fs.rmSync(proposals, { recursive: true, force: true });
  for (const [sig, chain] of [...versions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const o = origin.get(sig);
    const a = baseBodies.get(sig);
    if (!o) {
      // A function V6 adds. Does the base already have one by that signature?
      if (a) results.push({ function: sig, status: 'v6-adds-but-base-has-it', sameBody: a.src === chain.at(-1).src, migrations: chain.map((c) => c.migration) });
      continue;
    }
    if (!a) {
      results.push({ function: sig, status: 'missing-in-base', migrations: chain.map((c) => c.migration) });
      continue;
    }
    if (a.src === o.src) continue; // V6 was written against this very body.
    const steps = [];
    let ours = a.src;
    let ancestor = o.src;
    for (const step of chain) {
      const label = `${step.migration.slice(0, 3)}__${o.name}__${md5(sig).slice(0, 6)}`;
      const m = merge3(path.join(out, 'work'), label, ours, ancestor, step.src);
      const entry = { migration: step.migration, merge: m.error ? `error: ${m.error}` : m.conflicts === 0 ? 'clean' : `${m.conflicts} conflict(s)` };
      if (m.merged !== null) {
        fs.mkdirSync(proposals, { recursive: true });
        const file = path.join(proposals, `${label}.sql`);
        fs.writeFileSync(
          file,
          `-- PROPOSED body for ${sig} in ${step.migration}, by scripts/rebase/compare-dump.mjs.\n` +
            `-- V6's change, three-way merged onto the base's body. NOT applied anywhere; review before use.\n` +
            `-- Merge: ${entry.merge}. Dump sha256 ${dump.provenance.sha256.slice(0, 16)}.\n\n${m.merged}`,
        );
        entry.proposal = path.relative(out, file).split(path.sep).join('/');
      }
      steps.push(entry);
      if (m.merged === null || m.conflicts !== 0) break; // later steps need this one resolved first
      ancestor = step.src;
      ours = m.merged;
    }
    results.push({ function: sig, status: 'changed-in-base', steps });
  }
  // A 2026-09-30 function that V6 redefines under another signature: its body
  // is not merged above, so a change in the base is listed for a manual look.
  for (const [sig, o] of origin) {
    if (versions.has(sig)) continue;
    const a = baseBodies.get(sig);
    if (a && a.src !== o.src) {
      results.push({
        function: sig,
        status: 'changed-in-base-and-v6-redefines-it-under-another-signature',
        migrations: v6.filter((m) => m.defines.includes(o.name)).map((m) => m.name),
      });
    }
  }
  fs.rmSync(path.join(out, 'work'), { recursive: true, force: true });
  report.bodies = results;

  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  report.outDir = out;
  return report;
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const o = { extra: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      if (argv[i + 1] === undefined) throw new InputError(`${flag} needs a value`);
      return argv[++i];
    };
    if (flag === '--dump') o.dump = value();
    else if (flag === '--v5') o.v5 = value();
    else if (flag === '--last') o.last = value();
    else if (flag === '--pending') o.pending = value();
    else if (flag === '--extra') o.extra.push(value());
    else if (flag === '--out') o.out = value();
    else throw new InputError(`unknown argument ${flag}`);
  }
  if (!o.dump) throw new InputError('--dump <file> is required');
  return o;
}

function summarize(r) {
  const lines = [];
  const p = r.provenance.dump;
  lines.push(`dump      ${p.file}`, `          sha256 ${p.sha256}, ${p.bytes} bytes; ${p.header.join('; ') || 'no pg_dump header'}`);
  if (!p.verbose) lines.push('          WARNING: no TOC entries (not taken with --verbose); entries split on "-- Name:" comments');
  lines.push(`1 load    ${r.load.entries} entries, ${r.load.complete ? 'complete' : `INCOMPLETE: ${r.load.failures.length} failed`}`);
  for (const f of r.load.failures) lines.push(`            ${f}`);
  if (r.replay.skipped) lines.push(`2 replay  skipped (${r.replay.skipped})`);
  else {
    lines.push(`2 replay  V5 ${r.replay.applied}; per kind: only in dump / only in replay / differ`);
    for (const [kind, v] of Object.entries(r.replay)) {
      if (kind === 'applied') continue;
      lines.push(`            ${kind.padEnd(19)} ${String(v.onlyDump.length).padStart(4)} ${String(v.onlyReplay.length).padStart(4)} ${String(v.differ.length).padStart(4)}`);
    }
  }
  lines.push(`3 base    ${r.base.steps.length === 0 ? 'the dump only' : r.base.steps.map((s) => `${s.migration.slice(0, 3)} ${s.ok ? 'ok' : 'FAIL'}`).join(', ')}`);
  for (const s of r.base.steps.filter((x) => !x.ok)) lines.push(`            ${s.migration}: ${s.error}`);
  lines.push(`4 v6      ${r.v6.applied} of ${r.v6.total} apply on the base`);
  for (const s of r.v6.steps.filter((x) => !x.ok)) lines.push(`            FAIL ${s.migration}: ${s.error}`);
  lines.push(`5 bodies  ${r.bodies.length === 0 ? 'every function V6 replaces is still the 2026-09-30 body' : `${r.bodies.length} to look at`}`);
  for (const b of r.bodies) {
    if (b.status === 'changed-in-base') lines.push(`            ${b.function}: changed in base; ${b.steps.map((s) => `${s.migration.slice(0, 3)} ${s.merge}`).join(', ')}`);
    else lines.push(`            ${b.function}: ${b.status}${'sameBody' in b ? (b.sameBody ? ' (same body)' : ' (different body)') : ''}; ${b.migrations.join(', ')}`);
  }
  lines.push(`report    ${path.join(r.outDir, 'report.json')}`);
  return lines.join('\n');
}

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
if (process.argv[1] && same(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  try {
    const report = await runComparison(parseArgs(process.argv.slice(2)));
    console.log(summarize(report));
    process.exit(report.load.complete ? 0 : 2);
  } catch (error) {
    console.error(`compare-dump: ${error instanceof InputError ? error.message : error.stack}`);
    process.exit(1);
  }
}

export { summarize };
