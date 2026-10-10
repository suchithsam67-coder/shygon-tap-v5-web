import { createLiveDb, newMigrations, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * Every migration from 020 onward carries rollback SQL in its header. This
 * suite exercises each one on a local database (SHYGON V6 Stage 2; the V6
 * readiness report requires "rollback has been exercised on a local database"):
 *
 *   for migration k:  baseline + 020..k, then k's rollback  ==  baseline + 020..k-1
 *
 * compared on the schema objects a migration can change: every function in
 * `public` (signature, body, security, search_path, grants), every policy,
 * every relation (grants, row level security), every trigger and every
 * constraint (definition, including a foreign key's ON DELETE, and whether it
 * is validated). Grants are compared as sets, because a re-grant may land in a
 * different order.
 *
 * Rollback text: the block between "-- ROLLBACK (begin)" and "-- ROLLBACK (end)"
 * (021 onward), or, for 020, the indented lines under "-- ROLLBACK". Data
 * restores are proven by the migration's own suite (021: identity-contract,
 * 022: admin-notes).
 *
 *   node supabase/tests/migration-rollbacks.mjs [migrations-dir]
 */

const DIR = process.argv[2] ?? MIGRATIONS_DIR;
const migrations = newMigrations(DIR);

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

function rollbackSql(text) {
  const t = text.replace(/\r\n/g, '\n');
  const block = t.split('-- ROLLBACK (begin)\n')[1]?.split('-- ROLLBACK (end)')[0];
  if (block) return block.split('\n').map((l) => l.replace(/^-- ?/, '')).join('\n');
  // 020's form: "-- ROLLBACK" followed by indented "--   statement" lines.
  const legacy = t.split('\n-- ROLLBACK\n')[1];
  if (!legacy) return null;
  const lines = [];
  for (const l of legacy.split('\n')) {
    if (!/^-- {2,}\S/.test(l)) break;
    lines.push(l.replace(/^-- +/, ''));
  }
  return lines.length ? lines.join('\n') : null;
}

const sortAcl = (acl) => (acl ? acl.replace(/^\{|\}$/g, '').split(',').filter(Boolean).sort().join(',') : '');

async function snapshot(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  const functions = (await q(`
    SELECT p.oid::regprocedure::text AS sig, md5(p.prosrc) AS body, p.prosecdef AS definer,
           COALESCE(array_to_string(p.proconfig, '|'), '') AS config, p.proacl::text AS acl
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' ORDER BY 1`)).map((f) => ({ ...f, acl: sortAcl(f.acl) }));
  const policies = await q(`SELECT tablename, policyname, permissive, roles::text, cmd, qual, with_check
    FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`);
  const relations = (await q(`
    SELECT c.relname, c.relkind::text AS kind, c.relacl::text AS acl, c.relrowsecurity AS rls, c.relforcerowsecurity AS force
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'S') ORDER BY 1`)).map((r) => ({ ...r, acl: sortAcl(r.acl) }));
  const triggers = await q(`SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def, t.tgenabled::text AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2`);
  const constraints = await q(`SELECT c.conrelid::regclass::text AS rel, c.conname, pg_get_constraintdef(c.oid) AS def,
           c.convalidated AS validated
    FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'public' ORDER BY 1, 2`);
  return { functions, policies, relations, triggers, constraints };
}

function diff(a, b) {
  const out = [];
  for (const part of Object.keys(a)) {
    const ka = new Map(a[part].map((x) => [JSON.stringify(Object.values(x).slice(0, 2)), JSON.stringify(x)]));
    const kb = new Map(b[part].map((x) => [JSON.stringify(Object.values(x).slice(0, 2)), JSON.stringify(x)]));
    for (const [k, v] of ka) if (kb.get(k) !== v) out.push(`${part} ${k}: ${kb.has(k) ? 'differs' : 'missing after rollback'}`);
    for (const k of kb.keys()) if (!ka.has(k)) out.push(`${part} ${k}: left behind by rollback`);
  }
  return out;
}

async function build(upTo) {
  const db = await createLiveDb();
  for (const m of migrations.slice(0, upTo)) await db.exec(m.sql);
  return db;
}

console.log('\n=== migration rollbacks (each header rollback restores the previous schema) ===');

for (let k = 0; k < migrations.length; k++) {
  const { name, sql } = migrations[k];
  await check(`${name}: rollback restores the schema before it`, async () => {
    const rb = rollbackSql(sql);
    assert(rb, 'no rollback SQL found in the header');
    const before = await build(k);
    const after = await build(k + 1);
    await after.exec(rb);
    const problems = diff(await snapshot(before), await snapshot(after));
    await before.close();
    await after.close();
    assert(problems.length === 0, problems.slice(0, 8).join('; ') + (problems.length > 8 ? ` (+${problems.length - 8} more)` : ''));
    return 'functions, policies, grants, relations, triggers and constraints identical';
  });
}

await check('after every rollback, the whole chain applies again (forward after back)', async () => {
  const db = await build(migrations.length);
  for (const m of [...migrations].reverse()) await db.exec(rollbackSql(m.sql));
  const base = await createLiveDb();
  const problems = diff(await snapshot(base), await snapshot(db));
  assert(problems.length === 0, `full rollback differs from the baseline: ${problems.slice(0, 5).join('; ')}`);
  for (const m of migrations) await db.exec(m.sql);
  const fresh = await build(migrations.length);
  const again = diff(await snapshot(fresh), await snapshot(db));
  assert(again.length === 0, `re-applied chain differs: ${again.slice(0, 5).join('; ')}`);
  await db.close();
  await base.close();
  await fresh.close();
  return `${migrations.length} rolled back to the live baseline, then re-applied identically`;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
