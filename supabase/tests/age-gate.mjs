// The server-side 18+ record (V01 task T-13; founder decision F-26): migration
// 044 and /api/account age.status / age.confirm on the local stack, against
// DEC-2026-048 §8 (approved for the local build 2026-11-14).
//
//   A. Closure: the record is closed and append-only; the functions are server only.
//   B. Sign-up: the database records the confirmation once, from the sign-up
//      data, with its own time; bad data never fails a sign-up; later edits
//      change nothing.
//   C. /api/account: an account without a confirmation confirms once.
//   D. The export and account deletion.
//
// Not claimed: the hosted auth service itself (the trigger runs on the local
// stand-in's auth.users), and counsel's view of the wording.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/age-gate.mjs
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, legacyAccount, supabaseClient } from '../local/testkit.mjs';

const t = createHarness('The 18+ record (044, /api/account, DEC-2026-048)');
const stack = await startStack();
const q = async (sql, params = []) => (await stack.query(sql, params)).rows;
const PASSWORD = 'local-test-pass-1';
const VERSION = '29 September 2026';

let n = 0;
/** A sign-up through supabase-js with the given sign-up data, as the sign-up page sends it. */
async function signUpWith(data) {
  n++;
  const client = supabaseClient(stack);
  const email = `age${n}.${Date.now()}@example.test`;
  const { data: out, error } = await client.auth.signUp({ email, password: PASSWORD, options: { data: { full_name: `Age Test ${n}`, ...data } } });
  if (error) throw new Error(`sign-up failed: ${error.message}`);
  return { client, email, userId: out.user.id, token: out.session.access_token };
}
const rows = (userId) => q(`SELECT confirmed, source, policies_version, client_confirmed_at, created_at
  FROM public.account_age_confirmations WHERE user_id = $1 ORDER BY created_at, id`, [userId]);
const call = (body, token) => callFunction(stack, 'account', { token, body });
const codeOf = (r) => r.body?.error?.code;
const near = (at, label) => {
  const ms = Math.abs(Date.now() - new Date(at).getTime());
  assert(ms < 60_000, `${label}: ${ms} ms from now`);
};

// ---------------------------------------------------------------------------
t.section('A. Closure');

await t.check('the record is closed to every client role and append-only for the server; the functions are server only', async () => {
  const [r] = await q(`SELECT
      has_table_privilege('anon', 'public.account_age_confirmations', 'SELECT') OR has_table_privilege('authenticated', 'public.account_age_confirmations', 'SELECT')
        OR has_table_privilege('authenticated', 'public.account_age_confirmations', 'INSERT') OR has_table_privilege('authenticated', 'public.account_age_confirmations', 'UPDATE') AS client,
      has_table_privilege('service_role', 'public.account_age_confirmations', 'SELECT') AND has_table_privilege('service_role', 'public.account_age_confirmations', 'INSERT') AS server_reads_inserts,
      has_table_privilege('service_role', 'public.account_age_confirmations', 'UPDATE') OR has_table_privilege('service_role', 'public.account_age_confirmations', 'DELETE')
        OR has_table_privilege('service_role', 'public.account_age_confirmations', 'TRUNCATE') AS server_changes,
      has_function_privilege('authenticated', 'public.account_age_status(uuid)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.account_age_confirm(uuid, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.account_age_confirm(uuid, text)', 'EXECUTE') AS fn_client,
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.account_age_confirmations'::regclass) AS rls`);
  assertEqual(r, { client: false, server_reads_inserts: true, server_changes: false, fn_client: false, rls: true }, 'privileges');
  const triggers = (await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal ORDER BY 1`)).map((x) => x.tgname);
  assertEqual(triggers, ['on_auth_user_age_confirmation', 'on_auth_user_created'], 'auth.users triggers');
  const policies = await q(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = 'account_age_confirmations'`);
  assertEqual(policies[0].n, 0, 'no policy');
  return 'server only';
});

// ---------------------------------------------------------------------------
t.section('B. Sign-up');

await t.check('a sign-up with "I am 18 or older" writes one confirmed sign-up record with the server\'s time and the policies version', async () => {
  const clientAt = new Date().toISOString();
  const u = await signUpWith({ adult_confirmed: true, adult_confirmed_at: clientAt, terms_accepted_at: clientAt, policies_version: VERSION });
  const r = await rows(u.userId);
  assertEqual(r.map((x) => [x.confirmed, x.source, x.policies_version]), [[true, 'signup', VERSION]], 'record');
  near(r[0].created_at, 'server time');
  assertEqual(new Date(r[0].client_confirmed_at).toISOString(), clientAt, 'the browser\'s time, for information');
  return 'recorded at creation';
});

await t.check('a sign-up without it, or with "true", 1, false or null, records "not confirmed" and still succeeds', async () => {
  const cases = [{}, { adult_confirmed: 'true' }, { adult_confirmed: 1 }, { adult_confirmed: false }, { adult_confirmed: null }];
  for (const data of cases) {
    const u = await signUpWith({ ...data, policies_version: VERSION });
    const r = await rows(u.userId);
    assertEqual(r.map((x) => [x.confirmed, x.source]), [[false, 'signup']], JSON.stringify(data));
    const made = await q(`SELECT (SELECT count(*) FROM public.customers WHERE user_id = $1)::int AS customers,
      (SELECT count(*) FROM public.profiles WHERE id = $1)::int AS profiles`, [u.userId]);
    assertEqual(made[0], { customers: 1, profiles: 1 }, 'the sign-up itself is unchanged');
  }
  return `${cases.length} shapes`;
});

await t.check('bad or oversized values never fail a sign-up: they are trimmed or left out', async () => {
  const cases = [
    [{ policies_version: 'x'.repeat(200), adult_confirmed_at: 'not a time' }, 'x'.repeat(40), null],
    [{ policies_version: 42, adult_confirmed_at: '1999-01-01T00:00:00Z' }, null, null],
    [{ policies_version: '   ', adult_confirmed_at: { at: 'now' } }, null, null],
  ];
  for (const [data, version, client] of cases) {
    const u = await signUpWith({ adult_confirmed: true, ...data });
    const [r] = await rows(u.userId);
    assertEqual([r.confirmed, r.policies_version, r.client_confirmed_at], [true, version, client], JSON.stringify(data).slice(0, 60));
  }
  return 'never a failed sign-up';
});

await t.check('editing the sign-up data afterwards changes nothing in the record', async () => {
  const u = await signUpWith({ policies_version: VERSION });
  const { error } = await u.client.auth.updateUser({ data: { adult_confirmed: true, adult_confirmed_at: new Date().toISOString() } });
  assert(!error, `updateUser: ${error?.message}`);
  const meta = await q(`SELECT raw_user_meta_data -> 'adult_confirmed' AS v FROM auth.users WHERE id = $1`, [u.userId]);
  assertEqual(meta[0].v, true, 'the sign-up data did change');
  assertEqual((await rows(u.userId)).map((x) => [x.confirmed, x.source]), [[false, 'signup']], 'the record did not');
  return 'written once, at creation';
});

await t.check('the two sign-up triggers do not depend on each other', async () => {
  // An account created while the profile trigger was off still gets its record.
  const legacy = await legacyAccount(stack);
  assertEqual((await rows(legacy.userId)).map((x) => x.source), ['signup'], 'record without the profile trigger');
  // And with the age trigger off, sign-up still creates the customer and the profile.
  await q(`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_age_confirmation`);
  let u;
  try {
    u = await signUpWith({ adult_confirmed: true });
  } finally {
    await q(`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_age_confirmation`);
  }
  assertEqual((await rows(u.userId)).length, 0, 'no record while the age trigger is off');
  assertEqual((await q(`SELECT count(*)::int AS n FROM public.profiles WHERE id = $1`, [u.userId]))[0].n, 1, 'profile');
  return 'independent';
});

// ---------------------------------------------------------------------------
t.section('C. /api/account: age.status and age.confirm');

/** An account from before the gate: no record at all. */
async function beforeTheGate() {
  await q(`ALTER TABLE auth.users DISABLE TRIGGER on_auth_user_age_confirmation`);
  try {
    return await signUpWith({});
  } finally {
    await q(`ALTER TABLE auth.users ENABLE TRIGGER on_auth_user_age_confirmation`);
  }
}

await t.check('age.status answers for the signed-in owner only', async () => {
  const yes = await signUpWith({ adult_confirmed: true, policies_version: VERSION });
  const no = await signUpWith({});
  const old = await beforeTheGate();
  const s1 = await call({ op: 'age.status' }, yes.token);
  assertEqual([s1.status, s1.body.confirmed, s1.body.source], [200, true, 'signup'], 'confirmed at sign-up');
  near(s1.body.confirmedAt, 'confirmedAt');
  assertEqual((await call({ op: 'age.status' }, no.token)).body, { confirmed: false, confirmedAt: null, source: null }, 'not confirmed');
  assertEqual((await call({ op: 'age.status' }, old.token)).body.confirmed, false, 'before the gate');
  const anon = await call({ op: 'age.status' });
  assertEqual([anon.status, codeOf(anon)], [401, 'unauthenticated'], 'no session');
  return 'own account only';
});

await t.check('age.confirm records one confirmation with the server\'s time, only when the body says so, and only once', async () => {
  const old = await beforeTheGate();
  assertEqual(codeOf(await call({ op: 'age.confirm' }, old.token)), 'invalid_request', 'no adult: true');
  assertEqual(codeOf(await call({ op: 'age.confirm', adult: 'true' }, old.token)), 'invalid_request', 'a string is not a statement');
  assertEqual(codeOf(await call({ op: 'age.confirm', adult: true, policiesVersion: 'x'.repeat(41) }, old.token)), 'invalid_request', 'oversized version');
  assertEqual(codeOf(await call({ op: 'age.confirm', adult: true })), 'unauthenticated', 'no session');
  assertEqual((await rows(old.userId)).length, 0, 'nothing recorded by refusals');
  const ok = await call({ op: 'age.confirm', adult: true, policiesVersion: VERSION }, old.token);
  assertEqual([ok.status, ok.body.confirmed], [200, true], 'confirmed');
  near(ok.body.confirmedAt, 'server time');
  const again = await call({ op: 'age.confirm', adult: true }, old.token);
  assertEqual([again.status, codeOf(again)], [409, 'already_confirmed'], 'once');
  assertEqual((await rows(old.userId)).map((x) => [x.confirmed, x.source, x.policies_version]), [[true, 'reconfirm', VERSION]], 'one reconfirm row');
  const status = await call({ op: 'age.status' }, old.token);
  assertEqual([status.body.confirmed, status.body.source], [true, 'reconfirm'], 'status after');
  // An account that confirmed at sign-up cannot add a second confirmation.
  const yes = await signUpWith({ adult_confirmed: true });
  assertEqual(codeOf(await call({ op: 'age.confirm', adult: true }, yes.token)), 'already_confirmed', 'confirmed at sign-up');
  // An account that said no at sign-up may confirm later: both rows stay.
  const no = await signUpWith({});
  assertEqual((await call({ op: 'age.confirm', adult: true }, no.token)).body.confirmed, true, 'later confirmation');
  assertEqual((await rows(no.userId)).map((x) => [x.confirmed, x.source]), [[false, 'signup'], [true, 'reconfirm']], 'both rows kept');
  return 'append-only';
});

await t.check('two confirmations racing write one row', async () => {
  const old = await beforeTheGate();
  const both = await Promise.all([call({ op: 'age.confirm', adult: true }, old.token), call({ op: 'age.confirm', adult: true }, old.token)]);
  assertEqual(both.map((r) => r.status).sort(), [200, 409], 'one accepted, one already_confirmed');
  assertEqual((await rows(old.userId)).length, 1, 'one row');
  return 'serialised per account';
});

// ---------------------------------------------------------------------------
t.section('D. The export and deletion');

await t.check('the owner export carries the confirmation', async () => {
  const yes = await signUpWith({ adult_confirmed: true, policies_version: VERSION });
  const r = await call({ op: 'owner.export' }, yes.token);
  assertEqual(r.status, 200, 'export');
  const a = r.body.export.ageConfirmation;
  assertEqual([a?.confirmed, a?.source, a?.policiesVersion], [true, 'signup', VERSION], 'ageConfirmation');
  near(a.at, 'at');
  const no = await signUpWith({});
  assertEqual((await call({ op: 'owner.export' }, no.token)).body.export.ageConfirmation?.confirmed, false, 'not confirmed is shown as such');
  return 'U3: the owner\'s own record';
});

await t.check('deleting the account removes its records', async () => {
  const yes = await signUpWith({ adult_confirmed: true });
  assertEqual((await rows(yes.userId)).length, 1, 'a record before the deletion');
  await q(`DELETE FROM auth.users WHERE id = $1`, [yes.userId]);
  assertEqual((await rows(yes.userId)).length, 0, 'cascade');
  return 'with the account';
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
