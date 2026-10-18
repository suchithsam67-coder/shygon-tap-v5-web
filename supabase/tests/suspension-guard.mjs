// The F1 suspension guard (migration 020, and 028 for new rows), attacked the
// way a signed-in customer can attack it (V6; the owner's brief of 2026-10-16).
//
// A read-only production diagnostic of 2026-10-16 found that a signed-in
// customer may UPDATE every column of their own profiles and tap_profiles rows,
// the suspension an administrator set included, and that 020's guard is not on
// live. This suite proves, on isolated in-memory copies of the live schema:
//
//   A. every attack against three schemas: the live baseline, where it must
//      SUCCEED (the finding, reproduced, so no check can pass for the wrong
//      reason); the release candidate as it stood (020-026); and this branch
//      (020 onward), where it must be refused with every protected column
//      unchanged. The middle one shows the single path 028 closes;
//   B. the administrators' path, the two existing RPCs: who may call them, the
//      required reason, the audit trail, the owner's notification, the
//      account and Tap staying in step, and that nothing else changes. Normal
//      editing and the public Tap still work;
//   C. the mechanism: the guard trusts only the role the database runs the
//      statement as, never a setting or claim a caller can set; its triggers
//      run last; only the two admin RPCs can write the columns;
//   D. the attacks again over HTTP, through the local stack's PostgREST-shaped
//      gateway, with forged and tampered tokens as well.
//
// Nothing here reaches a real Supabase project or the network.
//
//   node supabase/tests/suspension-guard.mjs
import { createLiveDb, createMigratedDb, newMigrations } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { signJwt } from '../local/jwt.mjs';
import { assert, assertEqual, createHarness, legacyAccount, signUp, supabaseClient } from '../local/testkit.mjs';

const t = createHarness('F1 suspension guard (migrations 020 and 028)');

const U = {
  alice: 'a1000000-0000-4000-8000-00000000000a',
  bob: 'b1000000-0000-4000-8000-00000000000b',
  carl: 'c1000000-0000-4000-8000-00000000000c', // created before the sign-up trigger: no profile row (I-1)
  dave: 'd1000000-0000-4000-8000-00000000000d', // has no Tap yet
  admin: 'ad000000-0000-4000-8000-0000000000ad', // role admin: tap.moderate and customers.manage
  support: 'ae000000-0000-4000-8000-0000000000ae', // role support: neither permission
  former: 'af000000-0000-4000-8000-0000000000af', // an administrator who was deactivated
};
const GUARD = /Suspension can only be changed by SHYGON support/;

/** The live baseline plus the migrations numbered up to `last`. */
async function createDbThrough(last) {
  const db = await createLiveDb();
  for (const { name, sql } of newMigrations()) {
    if (Number(name.slice(0, 3)) > last) break;
    await db.exec(sql);
  }
  return db;
}

async function seed(db) {
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    INSERT INTO auth.users (id, email) VALUES
      ('${U.alice}', 'alice@example.test'), ('${U.bob}', 'bob@example.test'), ('${U.dave}', 'dave@example.test'),
      ('${U.admin}', 'admin@example.test'), ('${U.support}', 'support@example.test'), ('${U.former}', 'former@example.test');
    UPDATE public.profiles SET full_name = initcap(split_part(email, '@', 1));
    INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
    SELECT c.user_id, c.id, s.slug, s.slug, s.name, 'active'
    FROM (VALUES ('${U.alice}'::uuid, 'alice-tap', 'Alice'), ('${U.bob}'::uuid, 'bob-tap', 'Bob')) AS s(uid, slug, name)
    JOIN public.customers c ON c.user_id = s.uid;
    INSERT INTO public.admin_users (user_id, role, is_active) VALUES
      ('${U.admin}', 'admin', true), ('${U.support}', 'support', true), ('${U.former}', 'admin', false);
    ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_created;
    INSERT INTO auth.users (id, email) VALUES ('${U.carl}', 'carl@example.test');
    ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_created;
  `);
}

/**
 * Runs `fn` the way PostgREST runs a request: SET ROLE to the JWT's role, with
 * the caller's claims in the request settings. Session-level (is_local false),
 * because PGlite runs each statement in its own transaction.
 */
async function as(db, role, uid, fn) {
  const claims = JSON.stringify(uid ? { sub: uid, role } : { role });
  await db.query(
    `SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false),
            set_config('request.jwt.claim.role', $3, false)`,
    [uid ?? '', claims, role],
  );
  await db.exec(`SET ROLE ${role};`);
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE;');
    await db.query(
      `SELECT set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false),
              set_config('request.jwt.claim.role', '', false)`,
    );
  }
}

/** One statement as a signed-in caller: { ok, rows } or { ok: false, code, message }. */
async function attempt(db, uid, sql, params) {
  try {
    const result = await as(db, 'authenticated', uid, () => db.query(sql, params));
    return { ok: true, rows: result.affectedRows ?? 0 };
  } catch (error) {
    return { ok: false, code: error.code, message: error.message };
  }
}

const rowsOf = async (db, sql, params) => (await db.query(sql, params)).rows;
const tapIdOf = async (db, uid) => (await rowsOf(db, `SELECT id FROM public.tap_profiles WHERE user_id = $1`, [uid]))[0].id;

/** Every customer row an attack could touch, read as the superuser. */
async function snapshot(db) {
  return JSON.stringify({
    profiles: await rowsOf(db, `SELECT to_jsonb(p) AS r FROM public.profiles p WHERE id = ANY($1) ORDER BY id`, [[U.alice, U.bob, U.carl, U.dave]]),
    taps: await rowsOf(db, `SELECT to_jsonb(t) AS r FROM public.tap_profiles t WHERE user_id = ANY($1) ORDER BY user_id`, [[U.alice, U.bob, U.carl, U.dave]]),
    customers: await rowsOf(db, `SELECT count(*)::int AS n FROM public.customers`),
  });
}

const profile = async (db, uid) =>
  (await rowsOf(db, `SELECT suspended_at, suspended_reason, full_name FROM public.profiles WHERE id = $1`, [uid]))[0] ?? null;
const tap = async (db, uid) =>
  (await rowsOf(db, `SELECT id, slug, status, published, suspended_at, suspended_reason, suspended_by FROM public.tap_profiles WHERE user_id = $1`, [uid]))[0] ?? null;
const publicState = async (db, slug) =>
  (await as(db, 'anon', null, () => db.query(`SELECT public.get_public_tap_state($1) AS v`, [slug]))).rows[0].v;

/** Puts Bob in a known state through the administrators' own RPCs. */
async function setState(db, state) {
  const admin = (sql, params) => as(db, 'authenticated', U.admin, () => db.query(sql, params));
  await admin(`SELECT public.admin_set_customer_suspension($1, false, NULL)`, [U.bob]); // clears account and Tap
  if (state === 'account') {
    await admin(`SELECT public.admin_set_customer_suspension($1, true, 'Fixture: account suspended')`, [U.bob]);
  } else if (state === 'tap') {
    await admin(`SELECT public.admin_set_tap_suspension($1, true, 'Fixture: Tap suspended')`, [await tapIdOf(db, U.bob)]);
  }
}

// ---------------------------------------------------------------------------
t.section('A. Owner attacks: live baseline vs release candidate (020-026) vs this branch (020 onward)');

const SCHEMAS = [
  { key: 'live', label: 'live baseline', build: () => createLiveDb() },
  { key: 'rc', label: '020-026', build: () => createDbThrough(26) },
  { key: 'fixed', label: '020 onward', build: () => createMigratedDb() },
];
const dbs = {};
for (const schema of SCHEMAS) {
  dbs[schema.key] = await schema.build();
  await seed(dbs[schema.key]);
}

// expect: accepted = the attacker got what they wanted (the vulnerability);
// refused = 42501 from the guard, nothing changed; fk = refused by the I-1
// foreign key, nothing changed; none = zero rows (RLS), nothing changed.
const B = U.bob;
const ATTACKS = [
  {
    name: '1. sets their own account suspension (profiles.suspended_at NULL -> now())',
    state: 'clean',
    sql: `UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'Suspended by SHYGON Trust & Safety' WHERE id = '${B}'`,
    achieved: async (db) => (await profile(db, B)).suspended_at !== null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '1b. a legacy account (no profile row yet) inserts its own profile already suspended',
    actor: U.carl,
    state: 'clean',
    sql: `INSERT INTO public.profiles (id, customer_id, email, full_name, suspended_at, suspended_reason)
          VALUES ('${U.carl}', '${U.carl}', 'carl@example.test', 'Carl', now(), 'Suspended by SHYGON Trust & Safety')`,
    achieved: async (db) => (await profile(db, U.carl))?.suspended_at != null,
    expect: { live: 'fk', rc: 'accepted', fixed: 'refused' },
  },
  {
    name: '2. clears their own account suspension (profiles.suspended_at -> NULL)',
    state: 'account',
    sql: `UPDATE public.profiles SET suspended_at = NULL WHERE id = '${B}'`,
    achieved: async (db) => (await profile(db, B)).suspended_at === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '3. rewrites their own suspension reason',
    state: 'account',
    sql: `UPDATE public.profiles SET suspended_reason = 'Resolved, please ignore' WHERE id = '${B}'`,
    achieved: async (db) => (await profile(db, B)).suspended_reason === 'Resolved, please ignore',
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '3b. erases their own suspension reason',
    state: 'account',
    sql: `UPDATE public.profiles SET suspended_reason = NULL WHERE id = '${B}'`,
    achieved: async (db) => (await profile(db, B)).suspended_reason === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: "4a. clears their Tap's suspended_at, making it public again",
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET suspended_at = NULL WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_at === null && (await publicState(db, 'bob-tap')) === 'active',
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: "4b. rewrites their Tap's suspended_reason",
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET suspended_reason = 'Appeal granted' WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_reason === 'Appeal granted',
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '4c. replaces suspended_by (the moderator on record) with themselves',
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET suspended_by = '${B}' WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_by === B,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '4d. clears suspended_by (no moderator on record)',
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET suspended_by = NULL WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_by === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '4e. forges a moderation record naming a real administrator',
    state: 'clean',
    sql: `UPDATE public.tap_profiles SET suspended_at = now(), suspended_reason = 'Removed by SHYGON moderation',
            suspended_by = '${U.admin}' WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_by === U.admin,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '4f. clears all three Tap columns in one statement',
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET suspended_at = NULL, suspended_reason = NULL, suspended_by = NULL WHERE user_id = '${B}'`,
    achieved: async (db) => (await tap(db, B)).suspended_at === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '5. re-publishes through status/published while clearing the suspension (one statement)',
    state: 'tap',
    sql: `UPDATE public.tap_profiles SET status = 'active', published = true, suspended_at = NULL, suspended_reason = NULL,
            suspended_by = NULL WHERE user_id = '${B}'`,
    achieved: async (db) => (await publicState(db, 'bob-tap')) === 'active',
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '13. hides the change inside an ordinary edit (the whole statement fails, the name too)',
    state: 'account',
    sql: `UPDATE public.profiles SET full_name = 'Bob Renamed', suspended_at = NULL WHERE id = '${B}'`,
    achieved: async (db) => (await profile(db, B)).suspended_at === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: '13b. an upsert, as PostgREST sends one (INSERT ... ON CONFLICT DO UPDATE)',
    state: 'account',
    sql: `INSERT INTO public.profiles (id, customer_id, email, suspended_at, suspended_reason)
          VALUES ('${B}', '${B}', 'bob@example.test', NULL, NULL)
          ON CONFLICT (id) DO UPDATE SET suspended_at = EXCLUDED.suspended_at, suspended_reason = EXCLUDED.suspended_reason`,
    achieved: async (db) => (await profile(db, B)).suspended_at === null,
    expect: { live: 'accepted', rc: 'refused', fixed: 'refused' },
  },
  {
    name: "14. another customer's suspension (Bob -> Alice): RLS, on every schema",
    state: 'clean',
    sql: `UPDATE public.profiles SET suspended_at = now() WHERE id = '${U.alice}'`,
    achieved: async (db) => (await profile(db, U.alice)).suspended_at !== null,
    expect: { live: 'none', rc: 'none', fixed: 'none' },
  },
  {
    name: "14b. another customer's Tap (Bob -> Alice): RLS, on every schema",
    state: 'clean',
    sql: `UPDATE public.tap_profiles SET suspended_at = now(), suspended_by = '${B}' WHERE user_id = '${U.alice}'`,
    achieved: async (db) => (await tap(db, U.alice)).suspended_at !== null,
    expect: { live: 'none', rc: 'none', fixed: 'none' },
  },
];

for (const a of ATTACKS) {
  await t.check(a.name, async () => {
    const seen = [];
    for (const { key, label } of SCHEMAS) {
      const db = dbs[key];
      await setState(db, a.state);
      const before = await snapshot(db);
      const r = await attempt(db, a.actor ?? B, a.sql);
      const expected = a.expect[key];
      if (expected === 'accepted') {
        assert(r.ok && r.rows > 0, `${label}: expected the attack to succeed, got ${r.ok ? `${r.rows} rows` : `${r.code} ${r.message}`}`);
        assert(await a.achieved(db), `${label}: the statement ran but did not achieve the attack`);
        seen.push(`${label}: SUCCEEDS`);
        continue;
      }
      if (expected === 'refused') {
        assert(!r.ok, `${label}: NOT REFUSED (${r.rows} rows)`);
        assert(r.code === '42501' && GUARD.test(r.message), `${label}: refused with ${r.code} ${r.message}`);
      } else if (expected === 'fk') {
        assert(!r.ok && r.code === '23503', `${label}: expected the I-1 foreign key refusal, got ${r.ok ? `${r.rows} rows` : `${r.code} ${r.message}`}`);
      } else {
        assert(r.ok && r.rows === 0, `${label}: expected 0 rows, got ${r.ok ? `${r.rows} rows` : `${r.code} ${r.message}`}`);
      }
      assert(!(await a.achieved(db)), `${label}: the attack took effect`);
      assert((await snapshot(db)) === before, `${label}: a protected row changed`);
      seen.push(`${label}: ${expected === 'refused' ? 'refused 42501' : expected === 'fk' ? 'refused 23503 (I-1)' : '0 rows'}, unchanged`);
    }
    return seen.join('; ');
  });
}

await t.check('5b. status and published alone never lift a suspension (every schema)', async () => {
  const seen = [];
  for (const { key, label } of SCHEMAS) {
    const db = dbs[key];
    await setState(db, 'tap');
    const before = await tap(db, B);
    for (const sql of [
      `UPDATE public.tap_profiles SET status = 'active' WHERE user_id = '${B}'`,
      `UPDATE public.tap_profiles SET published = false WHERE user_id = '${B}'`,
      `UPDATE public.tap_profiles SET published = true WHERE user_id = '${B}'`,
      `UPDATE public.tap_profiles SET status = 'archived' WHERE user_id = '${B}'`,
      `UPDATE public.tap_profiles SET status = 'active', published = true WHERE user_id = '${B}'`,
    ]) {
      const r = await attempt(db, B, sql);
      assert(r.ok && r.rows === 1, `${label}: ${sql}: ${r.ok ? r.rows : r.message}`);
    }
    const after = await tap(db, B);
    assertEqual(
      [after.suspended_at?.toISOString(), after.suspended_reason, after.suspended_by],
      [before.suspended_at?.toISOString(), before.suspended_reason, before.suspended_by],
      `${label}: suspension columns`,
    );
    assertEqual([after.status, after.published], ['active', true], `${label}: the owner's own status`);
    assertEqual(await publicState(db, 'bob-tap'), 'unavailable', `${label}: public state`);
    const profileRow = (await as(db, 'anon', null, () => db.query(`SELECT public.get_public_profile('bob-tap') AS p`))).rows[0].p;
    assertEqual(profileRow, null, `${label}: public profile`);
    seen.push(`${label}: still unavailable`);
  }
  return seen.join('; ');
});

await t.check('5c. a new address through claim_tap_slug (a SECURITY DEFINER RPC) keeps the suspension (every schema)', async () => {
  for (const { key, label } of SCHEMAS) {
    const db = dbs[key];
    await setState(db, 'tap');
    const r = await attempt(db, B, `SELECT public.claim_tap_slug('bob-fresh-start')`);
    assert(r.ok, `${label}: claim_tap_slug: ${r.message}`);
    const row = await tap(db, B);
    assertEqual([row.slug, row.suspended_at !== null], ['bob-fresh-start', true], `${label}: slug and suspension`);
    assertEqual(await publicState(db, 'bob-fresh-start'), 'unavailable', `${label}: public state at the new address`);
    await db.query(`UPDATE public.tap_profiles SET slug = 'bob-tap', username = 'bob-tap' WHERE user_id = $1`, [B]);
  }
  return 'suspended at the new address on all three';
});

await dbs.live.close();
await dbs.rc.close();
const db = dbs.fixed;
const bobTapId = await tapIdOf(db, B);
const aliceTapId = await tapIdOf(db, U.alice);
const asAdmin = (who, sql, params) => attempt(db, who, sql, params);
const auditCount = async (action, entityId) =>
  (await rowsOf(db, `SELECT count(*)::int AS n FROM public.admin_audit_log WHERE action = $1 AND entity_id = $2`, [action, entityId]))[0].n;
const notes = async (uid) => rowsOf(db, `SELECT category, title, body, link FROM public.notifications WHERE user_id = $1 ORDER BY created_at, id`, [uid]);
const aliceRows = async () =>
  JSON.stringify(await rowsOf(db, `SELECT (SELECT to_jsonb(p) FROM public.profiles p WHERE id = $1) AS p, (SELECT to_jsonb(t) FROM public.tap_profiles t WHERE user_id = $1) AS t`, [U.alice]));

// ---------------------------------------------------------------------------
t.section('B. The administrators\' path (this branch): the two existing RPCs');

await t.check('7. a customer, an admin without the permission, a deactivated admin and anon cannot call either RPC', async () => {
  await setState(db, 'tap');
  const before = await snapshot(db);
  const audits = (await rowsOf(db, `SELECT count(*)::int AS n FROM public.admin_audit_log`))[0].n;
  const calls = [
    [`SELECT public.admin_set_customer_suspension($1, false, NULL)`, [B]],
    [`SELECT public.admin_set_customer_suspension($1, true, 'not allowed')`, [U.alice]],
    [`SELECT public.admin_set_tap_suspension($1, false, NULL)`, [bobTapId]],
    [`SELECT public.admin_set_tap_suspension($1, true, 'not allowed')`, [aliceTapId]],
  ];
  const refusals = [];
  for (const [who, expected] of [
    [U.alice, /does not have administrator access/],
    [U.support, /Your role does not permit this action \((customers\.manage|tap\.moderate)\)/],
    [U.former, /does not have administrator access/],
  ]) {
    for (const [sql, params] of calls) {
      const r = await attempt(db, who, sql, params);
      assert(!r.ok && r.code === '42501' && expected.test(r.message), `${who}: ${r.ok ? 'ACCEPTED' : `${r.code} ${r.message}`}`);
    }
    refusals.push('42501');
  }
  for (const [sql, params] of calls) {
    let error = null;
    try {
      await as(db, 'anon', null, () => db.query(sql, params));
    } catch (e) {
      error = e;
    }
    assert(error?.code === '42501' && /permission denied for function/.test(error.message), `anon: ${error ? error.message : 'ACCEPTED'}`);
  }
  assert((await snapshot(db)) === before, 'a row changed');
  assertEqual((await rowsOf(db, `SELECT count(*)::int AS n FROM public.admin_audit_log`))[0].n, audits, 'audit rows');
  return 'customer, support role, deactivated admin: 42501; anon: no EXECUTE; nothing changed, nothing audited';
});

await t.check('11. a suspension without a reason is refused (22023) and changes nothing', async () => {
  await setState(db, 'clean');
  const before = await snapshot(db);
  const bobNotes = (await notes(B)).length;
  for (const reason of [null, '', '   ']) {
    for (const [sql, params] of [
      [`SELECT public.admin_set_customer_suspension($1, true, $2)`, [B, reason]],
      [`SELECT public.admin_set_tap_suspension($1, true, $2)`, [bobTapId, reason]],
    ]) {
      const r = await asAdmin(U.admin, sql, params);
      assert(!r.ok && r.code === '22023' && /A reason is required/.test(r.message), `reason ${JSON.stringify(reason)}: ${r.ok ? 'ACCEPTED' : r.message}`);
    }
  }
  assert((await snapshot(db)) === before, 'a row changed');
  assertEqual((await notes(B)).length, bobNotes, 'notifications');
  return 'NULL, empty and blank reasons refused for both RPCs';
});

await t.check('8. an administrator suspends a customer: account and Tap, reason, moderator, audit; nobody else touched', async () => {
  await setState(db, 'clean');
  const alice = await aliceRows();
  const audits = await auditCount('customer.suspended', B);
  const bobNotes = (await notes(B)).length;
  const r = await as(db, 'authenticated', U.admin, () =>
    db.query(`SELECT public.admin_set_customer_suspension($1, true, '  Fraud report #41  ') AS v`, [B]));
  const out = r.rows[0].v;
  const acct = await profile(db, B);
  const row = await tap(db, B);
  assertEqual([acct.suspended_at !== null, acct.suspended_reason], [true, 'Fraud report #41'], 'account');
  assertEqual([row.suspended_at !== null, row.suspended_reason, row.suspended_by], [true, 'Fraud report #41', U.admin], 'Tap');
  assertEqual(await auditCount('customer.suspended', B), audits + 1, 'audit rows');
  const [audit] = await rowsOf(db, `SELECT admin_id, entity_type, metadata FROM public.admin_audit_log WHERE action = 'customer.suspended' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [B]);
  assertEqual([audit.admin_id, audit.entity_type, audit.metadata], [U.admin, 'customer', { reason: 'Fraud report #41' }], 'audit row');
  assertEqual([out.customer.id, out.customer.suspended_reason, out.tap.suspended_reason], [B, 'Fraud report #41', 'Fraud report #41'], 'returned admin_get_customer');
  assertEqual(await publicState(db, 'bob-tap'), 'unavailable', 'public state');
  // Current behaviour, kept: the account suspension sends no in-app notification.
  assertEqual((await notes(B)).length, bobNotes, 'notifications (none for an account suspension)');
  assertEqual(await aliceRows(), alice, "Alice's rows");
  return 'trimmed reason on both rows; suspended_by = admin; audited; Tap unavailable; Alice unchanged';
});

await t.check('9. an administrator reactivates the customer: both rows cleared, audited, nobody else touched', async () => {
  const alice = await aliceRows();
  const audits = await auditCount('customer.reactivated', B);
  const r = await as(db, 'authenticated', U.admin, () => db.query(`SELECT public.admin_set_customer_suspension($1, false, NULL) AS v`, [B]));
  const acct = await profile(db, B);
  const row = await tap(db, B);
  assertEqual([acct.suspended_at, acct.suspended_reason], [null, null], 'account');
  assertEqual([row.suspended_at, row.suspended_reason, row.suspended_by], [null, null, null], 'Tap');
  assertEqual(await auditCount('customer.reactivated', B), audits + 1, 'audit rows');
  assertEqual(r.rows[0].v.customer.suspended_at, null, 'returned admin_get_customer');
  assertEqual(await publicState(db, 'bob-tap'), 'active', 'public state');
  assertEqual(await aliceRows(), alice, "Alice's rows");
  return 'cleared; audited; public again';
});

await t.check('10. an administrator suspends and restores a Tap: owner notified, audited with the address, account untouched', async () => {
  await setState(db, 'clean');
  const alice = await aliceRows();
  const before = (await notes(B)).length;
  const suspended = await as(db, 'authenticated', U.admin, () =>
    db.query(`SELECT public.admin_set_tap_suspension($1, true, 'Impersonation') AS v`, [bobTapId]));
  let row = await tap(db, B);
  assertEqual([row.suspended_reason, row.suspended_by, row.suspended_at !== null], ['Impersonation', U.admin, true], 'Tap suspended');
  assertEqual((await profile(db, B)).suspended_at, null, 'account not suspended');
  assertEqual(await publicState(db, 'bob-tap'), 'unavailable', 'public state');
  assertEqual(suspended.rows[0].v.tap.suspended_reason, 'Impersonation', 'returned admin_get_tap');
  const [audit] = await rowsOf(db, `SELECT admin_id, entity_type, metadata FROM public.admin_audit_log WHERE action = 'tap.suspended' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [bobTapId]);
  assertEqual([audit.admin_id, audit.entity_type, audit.metadata], [U.admin, 'tap', { slug: 'bob-tap', reason: 'Impersonation' }], 'tap.suspended audit');

  await as(db, 'authenticated', U.admin, () => db.query(`SELECT public.admin_set_tap_suspension($1, false, NULL)`, [bobTapId]));
  row = await tap(db, B);
  assertEqual([row.suspended_at, row.suspended_reason, row.suspended_by], [null, null, null], 'Tap restored');
  assertEqual(await publicState(db, 'bob-tap'), 'active', 'public state after restore');
  const [restored] = await rowsOf(db, `SELECT metadata FROM public.admin_audit_log WHERE action = 'tap.restored' AND entity_id = $1 ORDER BY created_at DESC LIMIT 1`, [bobTapId]);
  assertEqual(restored.metadata, { slug: 'bob-tap', reason: null }, 'tap.restored audit');
  const added = (await notes(B)).slice(before);
  assertEqual(added, [
    { category: 'tap', title: 'Your Tap profile was suspended', body: 'Impersonation', link: '/shygontap/tap' },
    { category: 'tap', title: 'Your Tap profile was restored', body: 'Your Tap profile is available again.', link: '/shygontap/tap' },
  ], 'owner notifications');
  assertEqual(await aliceRows(), alice, "Alice's rows");
  return 'suspended, then restored; two notifications; two audit rows; Alice unchanged';
});

await t.check('an unknown customer or Tap is refused (P0002)', async () => {
  const missing = '99999999-0000-4000-8000-000000000099';
  for (const sql of [
    `SELECT public.admin_set_customer_suspension($1, true, 'x')`,
    `SELECT public.admin_set_tap_suspension($1, true, 'x')`,
  ]) {
    const r = await asAdmin(U.admin, sql, [missing]);
    assert(!r.ok && r.code === 'P0002', `${sql}: ${r.ok ? 'ACCEPTED' : r.message}`);
  }
});

await t.check('CURRENT BEHAVIOUR (owner decision): reactivating an account also lifts a separate moderation of its Tap', async () => {
  await setState(db, 'clean');
  await asAdmin(U.admin, `SELECT public.admin_set_tap_suspension($1, true, 'Content removed')`, [bobTapId]);
  await asAdmin(U.admin, `SELECT public.admin_set_customer_suspension($1, true, 'Chargeback')`, [B]);
  await asAdmin(U.admin, `SELECT public.admin_set_customer_suspension($1, false, NULL)`, [B]);
  assertEqual((await tap(db, B)).suspended_at, null, 'Tap after the account is reactivated');
  return 'the Tap is public again: the content moderation is not kept';
});

await t.check('CURRENT BEHAVIOUR (owner decision): an account suspended before it has a Tap is given an unsuspended one when a payment provisions it', async () => {
  await asAdmin(U.admin, `SELECT public.admin_set_customer_suspension($1, true, 'Suspended before purchase')`, [U.dave]);
  await db.exec(`
    INSERT INTO public.orders (id, order_id, user_id, customer_id, product_name, amount, amount_in_paise, payment_status, order_status)
    VALUES ('dddddddd-0000-4000-8000-0000000000d1', 'ST-DAVE', '${U.dave}', '${U.dave}', 'Digital plan', 999, 99900, 'pending', 'placed');
    UPDATE public.orders SET payment_status = 'paid' WHERE id = 'dddddddd-0000-4000-8000-0000000000d1';
  `);
  const row = await tap(db, U.dave);
  assert(row, 'no Tap was provisioned');
  assertEqual([(await profile(db, U.dave)).suspended_at !== null, row.suspended_at], [true, null], 'account suspended, Tap not');
  const r = await attempt(db, U.dave, `UPDATE public.tap_profiles SET status = 'active' WHERE user_id = '${U.dave}'`);
  assert(r.ok && r.rows === 1, `publish: ${r.message}`);
  assertEqual(await publicState(db, row.slug), 'active', 'public state of the suspended account\'s new Tap');
  return 'the suspended account publishes a public Tap';
});

await t.check('12. normal editing still works: Tap content, publish and pause, profile and preferences', async () => {
  await setState(db, 'clean');
  await db.query(`UPDATE public.tap_profiles SET last_content_edit_at = NULL WHERE user_id = $1`, [B]);
  const edits = [
    `UPDATE public.tap_profiles SET display_name = 'Bob B.', headline = 'Designer' WHERE user_id = '${B}'`,
    `UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = '${B}'`,
    `UPDATE public.tap_profiles SET status = 'active' WHERE user_id = '${B}'`,
    // What src/pages/Settings.tsx sends (upsert on id), and its preference toggle.
    `INSERT INTO public.profiles (id, customer_id, email, full_name, phone, company, job_title)
       VALUES ('${B}', '${B}', 'bob@example.test', 'Bob Builder', '+919800000001', 'SHYGON', 'Designer')
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, full_name = EXCLUDED.full_name, phone = EXCLUDED.phone,
         company = EXCLUDED.company, job_title = EXCLUDED.job_title`,
    `UPDATE public.profiles SET notify_tap_activity = false WHERE id = '${B}'`,
    // Re-sending the suspension columns unchanged is not a change.
    `UPDATE public.profiles SET suspended_at = suspended_at, suspended_reason = suspended_reason, full_name = 'Bob' WHERE id = '${B}'`,
  ];
  for (const sql of edits) {
    const r = await attempt(db, B, sql);
    assert(r.ok && r.rows === 1, `${sql.slice(0, 60)}: ${r.ok ? `${r.rows} rows` : r.message}`);
  }
  assertEqual((await tap(db, B)).status, 'active', 'status');
  assertEqual(await publicState(db, 'bob-tap'), 'active', 'public state');
  return `${edits.length} edits accepted`;
});

await t.check('12b. a suspended owner may still edit content (current behaviour); the Tap stays down', async () => {
  await setState(db, 'tap');
  await db.query(`UPDATE public.tap_profiles SET last_content_edit_at = NULL WHERE user_id = $1`, [B]);
  const r = await attempt(db, B, `UPDATE public.tap_profiles SET bio = 'Edited while suspended' WHERE user_id = '${B}'`);
  assert(r.ok && r.rows === 1, `edit: ${r.message}`);
  assertEqual(await publicState(db, 'bob-tap'), 'unavailable', 'public state');
  assert((await tap(db, B)).suspended_at !== null, 'the suspension was lifted');
});

await t.check('12c. a legacy account saves its profile the way Settings does (028 leaves the I-1 fix working)', async () => {
  const r = await attempt(db, U.carl, `INSERT INTO public.profiles (id, customer_id, email, full_name, phone)
    VALUES ('${U.carl}', '${U.carl}', 'carl@example.test', 'Carl', '+919800000002')
    ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone`);
  assert(r.ok && r.rows === 1, `upsert: ${r.ok ? r.rows : r.message}`);
  const acct = await profile(db, U.carl);
  assertEqual([acct.full_name, acct.suspended_at, acct.suspended_reason], ['Carl', null, null], 'Carl');
});

await t.check('12d. the V5 public Tap still resolves, and records a visit', async () => {
  const state = await publicState(db, 'alice-tap');
  const p = (await as(db, 'anon', null, () => db.query(`SELECT public.get_public_profile('alice-tap') AS p`))).rows[0].p;
  await as(db, 'anon', null, () => db.query(`SELECT public.record_tap_event('alice-tap', 'view', NULL)`));
  const events = (await rowsOf(db, `SELECT count(*)::int AS n FROM public.tap_events WHERE tap_profile_id = $1 AND event_type = 'view'`, [aliceTapId]))[0].n;
  assertEqual([state, p.slug, p.displayName, events], ['active', 'alice-tap', 'Alice', 1], 'public Tap');
});

// ---------------------------------------------------------------------------
t.section('C. The mechanism (this branch)');

const triggers = await rowsOf(db, `
  SELECT c.relname AS tbl, t.tgname AS name, t.tgenabled::text AS enabled,
         (t.tgtype & 1) = 1 AS row_level, (t.tgtype & 2) = 2 AS before,
         (t.tgtype & 4) = 4 AS on_insert, (t.tgtype & 16) = 16 AS on_update, p.proname AS fn
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('profiles', 'tap_profiles') AND NOT t.tgisinternal
  ORDER BY c.relname, t.tgname COLLATE "C"`);

await t.check('the guard is the LAST row-level BEFORE trigger for UPDATE and for INSERT on both tables (they fire in name order)', () => {
  const seen = [];
  for (const tbl of ['profiles', 'tap_profiles']) {
    for (const [event, name, fn] of [
      ['on_update', `trg_${tbl}_zz_guard_suspension`, 'guard_suspension_columns'],
      ['on_insert', `trg_${tbl}_zz_guard_suspension_insert`, 'guard_suspension_columns_on_insert'],
    ]) {
      const chain = triggers.filter((r) => r.tbl === tbl && r.before && r.row_level && r[event]);
      const last = chain[chain.length - 1];
      assertEqual([last?.name, last?.fn, last?.enabled], [name, fn, 'O'], `${tbl} ${event} chain ${chain.map((r) => r.name).join(' > ')}`);
      seen.push(`${tbl} ${event === 'on_update' ? 'UPDATE' : 'INSERT'}: ${chain.map((r) => r.name.replace(`trg_${tbl}_`, '')).join(' > ')}`);
    }
  }
  return seen.join('; ');
});

await t.check('both guard functions are SECURITY INVOKER, pin search_path, and no client may EXECUTE them', async () => {
  const fns = await rowsOf(db, `
    SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ',') AS config,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed,
           (p.proacl IS NULL OR p.proacl::text ~ '[{,]=X/') AS public_exec
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('guard_suspension_columns', 'guard_suspension_columns_on_insert') ORDER BY 1`);
  assertEqual(fns.map((f) => [f.proname, f.prosecdef, f.config, f.anon, f.authed, f.public_exec]), [
    ['guard_suspension_columns', false, 'search_path=pg_catalog, pg_temp', false, false, false],
    ['guard_suspension_columns_on_insert', false, 'search_path=pg_catalog, pg_temp', false, false, false],
  ], 'functions');
  for (const fn of ['guard_suspension_columns', 'guard_suspension_columns_on_insert']) {
    const r = await attempt(db, B, `SELECT public.${fn}()`);
    assert(!r.ok, `a customer called ${fn}() directly`);
  }
  return 'invoker; pinned; not callable by a client';
});

await t.check('6. settings and claims a caller can set do not unlock the guard', async () => {
  await setState(db, 'tap');
  const before = await snapshot(db);
  const forged = [
    ['app.admin_action', 'true'],
    ['app.bypass_suspension_guard', 'on'],
    ['shygon.admin_write', 'on'],
    ['request.jwt.claim.role', 'service_role'],
    ['request.jwt.claims', JSON.stringify({ sub: B, role: 'service_role' })],
    ['request.headers', JSON.stringify({ 'x-shygon-admin': 'true', authorization: 'Bearer service_role' })],
  ];
  for (const [name, value] of forged) {
    let error = null;
    try {
      await as(db, 'authenticated', B, async () => {
        // Set by the caller itself, as `authenticated`.
        await db.query(`SELECT set_config($1, $2, false)`, [name, value]);
        await db.query(`UPDATE public.tap_profiles SET suspended_at = NULL WHERE user_id = '${B}'`);
      });
    } catch (e) {
      error = e;
    } finally {
      await db.query(`SELECT set_config($1, '', false)`, [name]);
    }
    assert(error?.code === '42501' && GUARD.test(error.message), `${name}: ${error ? error.message : 'NOT REFUSED'}`);
  }
  assert((await snapshot(db)) === before, 'a row changed');
  return `${forged.length} forged settings, each refused; the guard reads only current_user`;
});

await t.check('no function an API caller reaches can change a session setting or run dynamic SQL', async () => {
  const offenders = await rowsOf(db, `
    SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.prosrc ~* 'set_config\\s*\\(' OR p.prosrc ~* '\\mEXECUTE\\s+(format|''|\\$|[a-z_]+\\s*(USING|;|\\|\\|))')
    ORDER BY 1`);
  assertEqual(offenders.map((o) => o.sig), [], 'functions calling set_config or EXECUTE');
});

await t.check('only the two admin RPCs can write a protected column (every function body in public)', async () => {
  const writers = await rowsOf(db, `
    SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND (p.prosrc ~ '\\msuspended_(at|reason|by)\\s*:?=' OR p.prosrc ~* 'INSERT\\s+INTO\\s+(public\\.)?(tap_)?profiles\\s*\\([^)]*suspended_')
    ORDER BY 1`);
  assertEqual(writers.map((w) => w.sig), [
    'admin_set_customer_suspension(uuid,boolean,text)',
    'admin_set_tap_suspension(uuid,boolean,text)',
  ], 'functions writing suspended_at / suspended_reason / suspended_by');
  return 'admin_set_customer_suspension, admin_set_tap_suspension';
});

await t.check('the admin RPCs keep their contract: SECURITY DEFINER, owned by a server role, pinned search_path, EXECUTE for authenticated only', async () => {
  const fns = await rowsOf(db, `
    SELECT p.oid::regprocedure::text AS sig, p.prosecdef, pg_get_userbyid(p.proowner) NOT IN ('anon', 'authenticated') AS server_owner,
           array_to_string(p.proconfig, ',') AS config, pg_get_function_result(p.oid) AS result,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('admin_set_customer_suspension', 'admin_set_tap_suspension') ORDER BY 1`);
  assertEqual(fns.map((f) => [f.sig, f.prosecdef, f.server_owner, f.config, f.result, f.authed, f.anon]), [
    ['admin_set_customer_suspension(uuid,boolean,text)', true, true, 'search_path=public, pg_temp', 'jsonb', true, false],
    ['admin_set_tap_suspension(uuid,boolean,text)', true, true, 'search_path=public, pg_temp', 'jsonb', true, false],
  ], 'admin RPCs');
});

await t.check('anon and authenticated inherit no other role (so current_user cannot be anything else for them)', async () => {
  const memberships = await rowsOf(db, `
    SELECT member.rolname AS member, granted.rolname AS granted FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid JOIN pg_roles member ON member.oid = m.member
    WHERE member.rolname IN ('anon', 'authenticated') ORDER BY 1, 2`);
  assertEqual(memberships, [], 'memberships');
  return 'none (on live: 028 VERIFY ON LIVE)';
});

await t.check('administrators get no direct write: the audited RPC is the only path', async () => {
  await setState(db, 'tap');
  const before = await snapshot(db);
  const other = await attempt(db, U.admin, `UPDATE public.tap_profiles SET suspended_at = NULL WHERE user_id = '${B}'`);
  assert(other.ok && other.rows === 0, `admin direct update of a customer's Tap: ${other.ok ? `${other.rows} rows` : other.message}`);
  const own = await attempt(db, U.admin, `UPDATE public.profiles SET suspended_at = now() WHERE id = '${U.admin}'`);
  assert(!own.ok && own.code === '42501' && GUARD.test(own.message), `admin direct update of their own row: ${own.ok ? 'ACCEPTED' : own.message}`);
  assert((await snapshot(db)) === before, 'a row changed');
  return "a customer's row: 0 rows (no admin UPDATE policy); their own row: refused 42501";
});

await t.check('defence in depth: with the pre-023 insert policy restored, a client still cannot create a Tap already suspended', async () => {
  await db.exec(`CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));`);
  try {
    const forged = await attempt(db, U.carl, `INSERT INTO public.tap_profiles (user_id, customer_id, username, slug, suspended_at, suspended_reason, suspended_by)
      VALUES ('${U.carl}', '${U.carl}', 'carl-tap', 'carl-tap', now(), 'Removed by SHYGON moderation', '${U.admin}')`);
    assert(!forged.ok && forged.code === '42501' && GUARD.test(forged.message), `forged insert: ${forged.ok ? 'ACCEPTED' : forged.message}`);
    const plain = await attempt(db, U.carl, `INSERT INTO public.tap_profiles (user_id, customer_id, username, slug) VALUES ('${U.carl}', '${U.carl}', 'carl-tap', 'carl-tap')`);
    assert(plain.ok && plain.rows === 1, `a plain insert: ${plain.ok ? plain.rows : plain.message}`);
  } finally {
    await db.exec(`DROP POLICY tap_profiles_insert_own ON public.tap_profiles; DELETE FROM public.tap_profiles WHERE user_id = '${U.carl}';`);
  }
  return 'suspended insert refused by 028; a plain one passes the trigger';
});

await db.close();

// ---------------------------------------------------------------------------
t.section('D. Over HTTP: the local stack (PostgREST-shaped gateway, real Postgres)');

const stack = await startStack();
const sql = async (text, params) => (await stack.query(text, params)).rows;
const visitor = supabaseClient(stack);
const stateOver = async (slug) => (await visitor.rpc('get_public_tap_state', { p_slug: slug })).data;

const owner = await signUp(stack, { name: 'Suspended Owner' });
const moderator = await signUp(stack, { name: 'Moderator' });
await sql(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, 'admin', true)`, [moderator.userId]);
await sql(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
           VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'http-owner', 'http-owner', 'Owner', 'active')`, [owner.userId]);
const readOwner = async () => JSON.stringify({
  p: (await sql(`SELECT suspended_at, suspended_reason FROM public.profiles WHERE id = $1`, [owner.userId]))[0],
  t: (await sql(`SELECT suspended_at, suspended_reason, suspended_by, status FROM public.tap_profiles WHERE user_id = $1`, [owner.userId]))[0],
});

/** A raw PostgREST request, so tokens can be forged. */
async function rest(method, path, { token, apikey = stack.keys.anonKey, body, prefer } = {}) {
  const response = await fetch(`${stack.gatewayUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json };
}

await t.check('the administrator suspends the account over HTTP (the Tap comes down)', async () => {
  const { data, error } = await moderator.client.rpc('admin_set_customer_suspension', { p_user_id: owner.userId, p_suspended: true, p_reason: 'Spam' });
  assert(!error, error?.message);
  assertEqual([data.customer.id, data.customer.suspended_reason, await stateOver('http-owner')], [owner.userId, 'Spam', 'unavailable'], 'suspended');
});

await t.check('PATCH, upsert and forged moderator from the owner: 403 / 42501, nothing changes', async () => {
  const before = await readOwner();
  const path = (tbl, col) => `${tbl}?${col}=eq.${owner.userId}`;
  const attacks = [
    ['PATCH', path('profiles', 'id'), { suspended_at: null, suspended_reason: null }],
    ['PATCH', path('profiles', 'id'), { suspended_reason: 'Resolved' }],
    ['PATCH', path('tap_profiles', 'user_id'), { suspended_at: null }],
    ['PATCH', path('tap_profiles', 'user_id'), { suspended_by: owner.userId }],
    ['PATCH', path('tap_profiles', 'user_id'), { status: 'active', published: true, suspended_at: null, suspended_reason: null, suspended_by: null }],
    ['POST', 'profiles?on_conflict=id', { id: owner.userId, customer_id: owner.userId, suspended_at: null, suspended_reason: null }, 'resolution=merge-duplicates,return=representation'],
  ];
  for (const [method, target, body, prefer] of attacks) {
    const r = await rest(method, target, { token: owner.token, body, prefer: prefer ?? 'return=representation' });
    assert(r.status === 403 && r.body?.code === '42501' && GUARD.test(r.body?.message), `${method} ${target} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  assertEqual(await readOwner(), before, 'owner rows');
  assertEqual(await stateOver('http-owner'), 'unavailable', 'public state');
  return `${attacks.length} requests, each 403 42501`;
});

await t.check('status/published over HTTP is the owner\'s to change, and the Tap still stays down', async () => {
  const r = await rest('PATCH', `tap_profiles?user_id=eq.${owner.userId}`, { token: owner.token, body: { status: 'active' }, prefer: 'return=representation' });
  assertEqual(r.status, 200, 'status change');
  assertEqual(await stateOver('http-owner'), 'unavailable', 'public state');
});

await t.check('forged and tampered tokens are refused before any SQL runs (401)', async () => {
  const before = await readOwner();
  const [header, payload] = owner.token.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const signature = owner.token.split('.')[2];
  const tokens = {
    'role edited to service_role, original signature': `${header}.${b64({ ...claims, role: 'service_role' })}.${signature}`,
    'sub edited to the moderator, original signature': `${header}.${b64({ ...claims, sub: moderator.userId })}.${signature}`,
    'service_role signed with a guessed secret': signJwt({ ...claims, role: 'service_role' }, 'not-the-project-secret-0000000000000000000000'),
    'alg none, no signature': `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims, role: 'service_role' })}.`,
  };
  for (const [label, token] of Object.entries(tokens)) {
    const r = await rest('PATCH', `profiles?id=eq.${owner.userId}`, { token, body: { suspended_at: null }, prefer: 'return=representation' });
    assert(r.status === 401, `${label}: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const asKey = await rest('PATCH', `profiles?id=eq.${owner.userId}`, { token: owner.token, apikey: owner.token, body: { suspended_at: null } });
  assert(asKey.status === 401, `a user token as the API key: ${asKey.status}`);
  assertEqual(await readOwner(), before, 'owner rows');
  return `${Object.keys(tokens).length + 1} forged requests, each 401`;
});

await t.check('the moderator gets no direct write over REST, and anon cannot call the RPC', async () => {
  const before = await readOwner();
  const direct = await rest('PATCH', `tap_profiles?user_id=eq.${owner.userId}`, { token: moderator.token, body: { suspended_at: null }, prefer: 'return=representation' });
  assert(direct.status === 200 && Array.isArray(direct.body) && direct.body.length === 0, `moderator PATCH: ${direct.status} ${JSON.stringify(direct.body)}`);
  const anon = await rest('POST', 'rpc/admin_set_customer_suspension', { token: stack.keys.anonKey, body: { p_user_id: owner.userId, p_suspended: false, p_reason: null } });
  assert(anon.status === 401 && anon.body?.code === '42501', `anon RPC: ${anon.status} ${JSON.stringify(anon.body)}`);
  const customer = await rest('POST', 'rpc/admin_set_customer_suspension', { token: owner.token, body: { p_user_id: owner.userId, p_suspended: false, p_reason: null } });
  assert(customer.status === 403 && customer.body?.code === '42501', `customer RPC: ${customer.status} ${JSON.stringify(customer.body)}`);
  assertEqual(await readOwner(), before, 'owner rows');
  return 'moderator PATCH: 200 with 0 rows; anon RPC 401; customer RPC 403';
});

await t.check('a legacy account over HTTP: a suspended self-insert is 403; the Settings upsert works', async () => {
  const legacy = await legacyAccount(stack);
  const forged = await legacy.client.from('profiles').upsert(
    { id: legacy.userId, customer_id: legacy.userId, email: legacy.email, full_name: 'Legacy', suspended_at: new Date().toISOString(), suspended_reason: 'Suspended by SHYGON Trust & Safety' },
    { onConflict: 'id' },
  );
  assert(forged.error?.code === '42501' && GUARD.test(forged.error.message), `suspended self-insert: ${JSON.stringify(forged.error ?? forged.status)}`);
  assertEqual((await sql(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [legacy.userId]))[0].n, 0, 'no profile row created');
  const saved = await legacy.client.from('profiles').upsert(
    { id: legacy.userId, customer_id: legacy.userId, email: legacy.email, full_name: 'Legacy', phone: '+919800000003' },
    { onConflict: 'id' },
  );
  assert(!saved.error, `Settings upsert: ${saved.error?.message}`);
  const [row] = await sql(`SELECT full_name, suspended_at FROM public.profiles WHERE id = $1`, [legacy.userId]);
  assertEqual([row.full_name, row.suspended_at], ['Legacy', null], 'saved profile');
});

await t.check('the owner edits as normal over HTTP; the administrator reactivates; the Tap is public again', async () => {
  const edit = await owner.client.from('tap_profiles').update({ display_name: 'Owner, edited' }).eq('user_id', owner.userId).select('display_name').single();
  assert(!edit.error && edit.data.display_name === 'Owner, edited', `edit: ${edit.error?.message}`);
  const { data, error } = await moderator.client.rpc('admin_set_customer_suspension', { p_user_id: owner.userId, p_suspended: false, p_reason: null });
  assert(!error, error?.message);
  assertEqual([data.customer.suspended_at, await stateOver('http-owner')], [null, 'active'], 'reactivated');
  const audit = await sql(`SELECT action FROM public.admin_audit_log WHERE admin_id = $1 AND entity_id = $2 ORDER BY created_at`, [moderator.userId, owner.userId]);
  assertEqual(audit.map((a) => a.action), ['customer.suspended', 'customer.reactivated'], 'audit trail');
});

const ok = t.finish();
await stack.close();
process.exit(ok ? 0 : 1);
