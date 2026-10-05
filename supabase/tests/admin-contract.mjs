import fs from 'node:fs';
import path from 'node:path';
import { createLiveDb, newMigrations, MIGRATIONS_DIR, ROOT } from './lib/live-db.mjs';

/**
 * Admin contract (doc 12 §2 contract freeze; M0.3 scope §5).
 *
 * The external Admin APK and the public Tap call these functions. Their
 * signatures, return types, security mode, search_path and EXECUTE grants must
 * never change, and their bodies may change only where an approved milestone
 * says so. This suite proves it for the migrations in this branch:
 *
 *   1. the snapshot taken from the live schema baseline equals the committed
 *      golden file (supabase/tests/golden/admin-contract.json);
 *   2. after migrations 020 onward, every frozen function still matches it,
 *      body included, except the bodies listed in APPROVED_BODY_CHANGES;
 *   3. each approved body change is exactly the approved one;
 *   4. nothing else in the schema moved: every other existing function, every
 *      policy, every table grant and every pre-existing trigger is identical.
 *
 *   node supabase/tests/admin-contract.mjs [migrations-dir]   check
 *   node supabase/tests/admin-contract.mjs --write            regenerate the golden file
 *                                                             from the baseline (review the diff)
 */

const GOLDEN = path.join(ROOT, 'supabase', 'tests', 'golden', 'admin-contract.json');
const WRITE = process.argv.includes('--write');
const DIR = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? MIGRATIONS_DIR;

// Doc 12 §2: "Signatures/return shapes frozen" (plus every admin_* function).
const FROZEN_NAMES = [
  'get_public_profile', 'get_public_tap_state', 'get_public_tap', 'record_tap_event',
  'get_tap_analytics', 'get_tap_link_clicks', 'tap_edit_state', 'theme_options', 'tier_rank',
  'user_max_ui_tier', 'user_has_pass', 'claim_tap_slug', 'provision_tap_on_payment',
  'is_admin', 'admin_has', 'require_admin', 'admin_audit', 'card_apply_verified_action',
];

// Bodies an approved decision changes. Everything else must be byte-identical.
const D_U4 = [
  // [baseline text, approved text] — DEC-2026-024 D-U4; the owner's wording (title 2026-10-05, body 2026-10-03).
  ["NEW.user_id, NEW.user_id, true, 'active', v_slug,", "NEW.user_id, NEW.user_id, false, 'draft', v_slug,"],
  ["'Your SHYGON Tap is live'", "'Your SHYGON Tap draft is ready'"],
  [
    "'Your Tap page has been created automatically. Complete your profile whenever you are ready.'",
    "'Your Tap page has been created. Review and publish it from your SHYGON dashboard.'",
  ],
];
const APPROVED_BODY_CHANGES = {
  'provision_tap_on_payment()': { decision: 'DEC-2026-024 D-U4 (migration 021)', replacements: D_U4 },
};

const FUNCTIONS_SQL = `
  SELECT p.oid::regprocedure::text AS signature,
         p.proname AS name,
         pg_get_function_arguments(p.oid) AS arguments,
         pg_get_function_result(p.oid) AS result,
         l.lanname AS language,
         p.prosecdef AS security_definer,
         p.provolatile::text AS volatility,
         COALESCE(array_to_string(p.proconfig, ' | '), '') AS config,
         COALESCE(p.proacl::text, '') AS acl,
         md5(p.prosrc) AS body_md5,
         p.prosrc AS body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
  ORDER BY 1`;

const isFrozen = (name) => name.startsWith('admin_') || FROZEN_NAMES.includes(name);
const contractOf = ({ body, ...rest }) => rest; // the golden file stores the hash, not the text

async function snapshot(db) {
  const all = (await db.query(FUNCTIONS_SQL)).rows;
  const policies = (await db.query(
    `SELECT schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check
     FROM pg_policies ORDER BY 1, 2, 3`,
  )).rows;
  const tableGrants = (await db.query(
    `SELECT c.relname, COALESCE(c.relacl::text, '') AS acl, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'S') ORDER BY 1`,
  )).rows;
  const triggers = (await db.query(
    `SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid) AS def, t.tgenabled::text AS enabled
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY 1, 2`,
  )).rows;
  return { all, policies, tableGrants, triggers };
}

const byKey = (rows, key) => new Map(rows.map((r) => [key(r), r]));

// --- build ---------------------------------------------------------------------

const baseDb = await createLiveDb();
const base = await snapshot(baseDb);
const frozenBase = base.all.filter((f) => isFrozen(f.name)).map(contractOf);
const missing = FROZEN_NAMES.filter((n) => !base.all.some((f) => f.name === n));

if (WRITE) {
  const golden = {
    description:
      'Contract snapshot of the doc 12 §2 frozen functions and every admin_* function, taken from ' +
      'supabase/baseline/000_live_baseline.sql. Generated by `node supabase/tests/admin-contract.mjs --write`. ' +
      'Do not edit by hand; a change here is a contract change and needs a decision.',
    frozenNamesNotOnLive: missing,
    functions: frozenBase,
  };
  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
  console.log(`wrote ${path.relative(ROOT, GOLDEN)} (${frozenBase.length} functions)`);
  process.exit(0);
}

const migDb = await createLiveDb();
const applied = [];
for (const { name, sql } of newMigrations(DIR)) {
  await migDb.exec(sql);
  applied.push(name);
}
const mig = await snapshot(migDb);

// --- checks --------------------------------------------------------------------

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

function diffRows(expected, actual, key, fields) {
  const a = byKey(actual, key);
  const problems = [];
  for (const e of expected) {
    const got = a.get(key(e));
    if (!got) { problems.push(`${key(e)}: missing`); continue; }
    for (const f of fields) {
      if (got[f] !== e[f]) problems.push(`${key(e)}.${f}: ${JSON.stringify(e[f])} -> ${JSON.stringify(got[f])}`);
    }
  }
  return problems;
}

const SIGNATURE_FIELDS = ['name', 'arguments', 'result', 'language', 'security_definer', 'volatility', 'config', 'acl'];

console.log(`\n=== admin contract (baseline vs baseline + ${applied.join(', ') || 'no migrations'}) ===`);

await check('the golden file is the live baseline snapshot', () => {
  assert(fs.existsSync(GOLDEN), `${path.relative(ROOT, GOLDEN)} is missing; run with --write and review it`);
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  assert(JSON.stringify(golden.functions) === JSON.stringify(frozenBase),
    'the baseline snapshot differs from the golden file (baseline or golden edited?)');
  assert(JSON.stringify(golden.frozenNamesNotOnLive) === JSON.stringify(missing), 'frozen-name coverage changed');
  return `${frozenBase.length} functions${missing.length ? `; not on live: ${missing.join(', ')}` : ''}`;
});

await check('every frozen function keeps its signature, return type, security, search_path and grants', () => {
  const frozenMig = mig.all.filter((f) => isFrozen(f.name));
  const problems = diffRows(frozenBase, frozenMig, (f) => f.signature, SIGNATURE_FIELDS);
  const added = frozenMig.filter((f) => !frozenBase.some((b) => b.signature === f.signature)).map((f) => f.signature);
  assert(problems.length === 0, problems.join('; '));
  assert(added.length === 0, `new overloads of frozen names: ${added.join(', ')}`);
  return `${frozenBase.length} unchanged`;
});

await check('every frozen body is byte-identical, except the approved changes', () => {
  const m = byKey(mig.all, (f) => f.signature);
  const changed = frozenBase.filter((f) => m.get(f.signature).body_md5 !== f.body_md5).map((f) => f.signature);
  const unapproved = changed.filter((s) => !APPROVED_BODY_CHANGES[s]);
  assert(unapproved.length === 0, `body changed without a decision: ${unapproved.join(', ')}`);
  return changed.length ? `changed (approved): ${changed.join(', ')}` : 'none changed';
});

for (const [signature, { decision, replacements }] of Object.entries(APPROVED_BODY_CHANGES)) {
  await check(`${signature}: the body differs from live by exactly the approved edit (${decision})`, () => {
    const before = base.all.find((f) => f.signature === signature).body;
    const after = mig.all.find((f) => f.signature === signature).body;
    let expected = before;
    for (const [from, to] of replacements) {
      assert(expected.split(from).length === 2, `the baseline body does not contain ${JSON.stringify(from)} exactly once`);
      expected = expected.replace(from, to);
    }
    assert(after === expected, 'the migrated body is not the baseline body with only the approved replacements');
    return 'published/status, notification title and body; nothing else';
  });
}

await check('no other existing function changed (signature, body, grants)', () => {
  const others = base.all.filter((f) => !isFrozen(f.name));
  const problems = diffRows(others, mig.all, (f) => f.signature, [...SIGNATURE_FIELDS, 'body_md5']);
  assert(problems.length === 0, problems.join('; '));
  const added = mig.all.filter((f) => !base.all.some((b) => b.signature === f.signature)).map((f) => f.signature);
  return `${others.length} unchanged; new: ${added.join(', ') || 'none'}`;
});

await check('no policy changed, and none was added or removed', () => {
  assert(JSON.stringify(mig.policies) === JSON.stringify(base.policies), 'pg_policies differs');
  return `${base.policies.length} policies identical`;
});

await check('no table grant or RLS switch changed', () => {
  assert(JSON.stringify(mig.tableGrants) === JSON.stringify(base.tableGrants), 'table ACLs / RLS flags differ');
  return `${base.tableGrants.length} relations identical`;
});

await check('every pre-existing trigger is unchanged (new ones listed)', () => {
  const problems = diffRows(base.triggers, mig.triggers, (t) => `${t.relname}.${t.tgname}`, ['def', 'enabled']);
  assert(problems.length === 0, problems.join('; '));
  const added = mig.triggers
    .filter((t) => !base.triggers.some((b) => b.relname === t.relname && b.tgname === t.tgname))
    .map((t) => `${t.relname}.${t.tgname}`);
  return `${base.triggers.length} unchanged; new: ${added.join(', ') || 'none'}`;
});

console.log(`\n${pass} passed, ${fail} failed\n`);
await baseDb.close();
await migDb.close();
process.exit(fail === 0 ? 0 : 1);
