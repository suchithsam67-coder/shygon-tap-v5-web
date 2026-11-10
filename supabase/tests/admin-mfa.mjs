// Administrator multi-factor authentication, step 2 of DEC-2026-046 option A
// (V01 T-12; approved for the local build 2026-11-10): migration 040's opt-in
// rule on the local stack, driven through supabase-js's own MFA API (the client
// the Expo admin app uses) against the stand-in's TOTP factors.
//
//   A. Closure and the switch's default.
//   B. No lock-out: an administrator without a factor works exactly as before.
//   C. Opt-in: once an administrator has a verified factor, every admin function,
//      policy and the status answer require aal2; the refusal is not the one the
//      current admin app signs out on.
//   D. Customers and deactivated administrators are refused as before.
//   E. The mandatory switch (step 3), service only, and enrolment that stays open.
//   F. The authenticator codes (RFC 6238) and the stand-in's factor rules.
//
// Not claimed: the two admin edge functions (Codex, after V6-094), which do not
// use is_admin(); the admin app's screens (DEC-2026-046 Q2).
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/admin-mfa.mjs
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';
import { base32Encode, totp } from '../local/totp.mjs';

const t = createHarness('Admin MFA, opt-in (040, DEC-2026-046 step 2)');
const stack = await startStack();
const q = async (sql, params = []) => (await stack.query(sql, params)).rows;
const PASSWORD = 'local-test-pass-1';
// jsonb does not keep key order, so objects are compared with their keys sorted.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b, label) => assertEqual(canon(a), canon(b), label);

// The current admin app's sign-out rule, verbatim (shygon-tap-v5-admin src/lib/supabase.ts:168-172).
const appSignsOut = (error) => error?.code === '42501' || /administrator access|does not permit/i.test(error?.message ?? '');

async function admin(name, { active = true, role = 'admin' } = {}) {
  const u = await signUp(stack, { name });
  await q(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, $2, $3)`, [u.userId, role, active]);
  return u;
}
/** A fresh password sign-in: a new client and an aal1 session. */
async function signIn(u) {
  const client = supabaseClient(stack);
  const { error } = await client.auth.signInWithPassword({ email: u.email, password: PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);
  return client;
}
/** Enrols and verifies a TOTP factor through supabase-js, as the admin app would; the client ends at aal2. */
async function enrolAndVerify(client) {
  const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Phone' });
  if (error) throw new Error(`enroll: ${error.message}`);
  const secret = enrolled.totp.secret;
  await verify(client, enrolled.id, secret);
  return { factorId: enrolled.id, secret };
}
async function verify(client, factorId, secret) {
  const { data: ch, error: chError } = await client.auth.mfa.challenge({ factorId });
  if (chError) throw new Error(`challenge: ${chError.message}`);
  const { error } = await client.auth.mfa.verify({ factorId, challengeId: ch.id, code: totp(secret) });
  if (error) throw new Error(`verify: ${error.message}`);
}
const aal = async (client) => (await client.auth.mfa.getAuthenticatorAssuranceLevel()).data;
const others = async (client, ownId) => ((await client.from('profiles').select('id')).data ?? []).filter((r) => r.id !== ownId).length;

// ---------------------------------------------------------------------------
t.section('A. Closure');

await t.check('the switch ships OFF and closed; the helpers are server only; the status answer is for signed-in callers', async () => {
  assertEqual(await q(`SELECT id, mfa_required FROM public.admin_security_settings`), [{ id: 1, mfa_required: false }], 'switch');
  const r = (await q(`SELECT
      has_table_privilege('authenticated', 'public.admin_security_settings', 'SELECT') OR has_table_privilege('authenticated', 'public.admin_security_settings', 'UPDATE')
        OR has_table_privilege('anon', 'public.admin_security_settings', 'SELECT') AS table_client,
      has_function_privilege('authenticated', 'public.admin_mfa_set_required(boolean, boolean, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.admin_mfa_required()', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.admin_mfa_satisfied()', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.admin_mfa_pending()', 'EXECUTE') AS helpers_client,
      has_function_privilege('authenticated', 'public.admin_mfa_status()', 'EXECUTE') AS status_auth,
      has_function_privilege('anon', 'public.admin_mfa_status()', 'EXECUTE') AS status_anon`))[0];
  assertEqual(r, { table_client: false, helpers_client: false, status_auth: true, status_anon: false }, 'privileges');
  return 'nothing a session can flip';
});

// ---------------------------------------------------------------------------
t.section('B. No lock-out');

const ana = await admin('Ana Admin');
const cara = await signUp(stack, { name: 'Cara Customer' });
let anaClient;
await t.check('an administrator without a factor works at aal1 exactly as before', async () => {
  anaClient = await signIn(ana);
  const me = await anaClient.rpc('admin_me');
  assertEqual([me.error, me.data?.role], [null, 'admin'], 'admin_me');
  assertEqual((await anaClient.rpc('admin_dashboard')).error, null, 'admin_dashboard');
  assert((await others(anaClient, ana.userId)) >= 1, 'reads other profiles through the admin policy');
  const st = (await anaClient.rpc('admin_mfa_status')).data;
  same(st, { factorEnrolled: false, aal: 'aal1', required: false, satisfied: true, requiredForAll: false }, 'status');
  assertEqual(await aal(anaClient).then((a) => [a.currentLevel, a.nextLevel]), ['aal1', 'aal1'], 'no second step due');
  return 'step 2 changes nothing until someone enrols';
});

await t.check('an enrolled but unverified factor still changes nothing', async () => {
  const { data: enrolled, error } = await anaClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Unfinished' });
  assertEqual(error, null, 'enroll at aal1');
  assert(/^otpauth:\/\/totp\//.test(enrolled.totp.uri) && /^[A-Z2-7]{32}$/.test(enrolled.totp.secret), 'an authenticator secret');
  assertEqual((await anaClient.rpc('admin_me')).error, null, 'admin_me');
  await anaClient.auth.mfa.unenroll({ factorId: enrolled.id });
  return 'only a verified factor opts in';
});

// ---------------------------------------------------------------------------
t.section('C. Opt-in: a verified factor makes aal2 required');

const ben = await admin('Ben Enrolled');
let benSecret;
let benFactor;
await t.check('enrolling through supabase-js raises the session to aal2; the admin functions keep working', async () => {
  const c = await signIn(ben);
  ({ secret: benSecret, factorId: benFactor } = await enrolAndVerify(c));
  assertEqual((await aal(c)).currentLevel, 'aal2', 'current level');
  assertEqual((await c.rpc('admin_me')).error, null, 'admin_me at aal2');
  same((await c.rpc('admin_mfa_status')).data, { factorEnrolled: true, aal: 'aal2', required: true, satisfied: true, requiredForAll: false }, 'status');
  const { data: refreshed, error } = await c.auth.refreshSession();
  assertEqual(error, null, 'refresh');
  assertEqual(JSON.parse(Buffer.from(refreshed.session.access_token.split('.')[1], 'base64url')).aal, 'aal2', 'a refresh keeps aal2');
  assertEqual((await c.rpc('admin_list_customers', { p_search: null, p_limit: 5, p_offset: 0 })).error, null, 'an admin list at aal2');
  return 'the enrolment the admin app will do';
});

await t.check('a password-only session of that administrator is refused everywhere, with admin:mfa_required, not 42501', async () => {
  const c = await signIn(ben);
  assertEqual(await aal(c).then((a) => [a.currentLevel, a.nextLevel]), ['aal1', 'aal2'], 'the client sees a second step is due');
  for (const fn of ['admin_me', 'admin_dashboard']) {
    const { error } = await c.rpc(fn);
    assertEqual([error?.code, error?.message], ['P0001', 'admin:mfa_required'], fn);
    assertEqual(appSignsOut(error), false, `${fn}: the current admin app would not sign out`);
  }
  assertEqual((await c.rpc('admin_list_customers', { p_search: null, p_limit: 5, p_offset: 0 })).error?.message, 'admin:mfa_required', 'an admin list');
  assertEqual(await others(c, ben.userId), 0, 'the admin read policy no longer applies at aal1');
  same((await c.rpc('admin_mfa_status')).data, { factorEnrolled: true, aal: 'aal1', required: true, satisfied: false, requiredForAll: false }, 'status still answers');
  await verify(c, benFactor, benSecret);
  assertEqual((await c.rpc('admin_me')).error, null, 'after the code');
  assert((await others(c, ben.userId)) >= 1, 'the admin read policy applies again');
  return 'every surface in the database, one rule';
});

// ---------------------------------------------------------------------------
t.section('D. Customers and deactivated administrators');

await t.check('a customer, even with a verified factor, and a deactivated administrator get 42501 as before', async () => {
  const cc = await signIn(cara);
  await enrolAndVerify(cc);
  const plain = await signIn(cara);
  for (const [label, client] of [['customer at aal2', cc], ['customer at aal1', plain]]) {
    const { error } = await client.rpc('admin_me');
    assertEqual([error?.code, appSignsOut(error)], ['42501', true], label);
  }
  assertEqual((await cc.rpc('admin_mfa_status')).error?.code, '42501', 'status for a customer');
  const gone = await admin('Gus Gone', { active: false });
  const gc = await signIn(gone);
  await enrolAndVerify(gc);
  assertEqual((await (await signIn(gone)).rpc('admin_me')).error?.code, '42501', 'deactivated, at aal1');
  assertEqual((await gc.rpc('admin_me')).error?.code, '42501', 'deactivated, at aal2');
  return 'admin:mfa_required never tells a non-administrator anything';
});

// ---------------------------------------------------------------------------
t.section('E. The mandatory switch (step 3)');

await t.check('switching on is refused while an active administrator has no factor, unless forced', async () => {
  const refused = (await q(`SELECT public.admin_mfa_set_required(true, false, 'test') AS r`))[0].r;
  assert(refused.ok === false && refused.code === 'admins_without_factor' && refused.count >= 1, JSON.stringify(refused));
  assertEqual((await q(`SELECT mfa_required FROM public.admin_security_settings`))[0].mfa_required, false, 'still off');
  return `${refused.count} active administrator(s) without a factor`;
});

await t.check('once on, an administrator without a factor is asked for one at aal1, can still enrol, and works at aal2', async () => {
  const forced = (await q(`SELECT public.admin_mfa_set_required(true, true, 'test') AS r`))[0].r;
  assertEqual([forced.ok, forced.requiredForAll], [true, true], 'forced on');
  try {
    const c = await signIn(ana);
    const { error } = await c.rpc('admin_me');
    assertEqual([error?.message, appSignsOut(error)], ['admin:mfa_required', false], 'aal1 without a factor');
    same((await c.rpc('admin_mfa_status')).data, { factorEnrolled: false, aal: 'aal1', required: true, satisfied: false, requiredForAll: true }, 'status');
    await enrolAndVerify(c);
    assertEqual((await c.rpc('admin_me')).error, null, 'after enrolling');
  } finally {
    const off = (await q(`SELECT public.admin_mfa_set_required(false, false, 'test') AS r`))[0].r;
    assertEqual(off.ok, true, 'switched off again');
  }
  return 'enrolment is never behind the rule';
});

// ---------------------------------------------------------------------------
t.section('F. Codes and factor rules');

await t.check('RFC 6238 reference codes; wrong, stale or replayed challenges refused; aal2 needed to add or remove a verified factor', async () => {
  const ref = base32Encode(Buffer.from('12345678901234567890'));
  assertEqual([totp(ref, 59_000), totp(ref, 1_111_111_109_000), totp(ref, 1_234_567_890_000)], ['287082', '081804', '005924'], 'RFC 6238 Appendix B (SHA-1, last 6 digits)');
  const c = await signIn(ben);
  const { data: ch } = await c.auth.mfa.challenge({ factorId: benFactor });
  const wrong = await c.auth.mfa.verify({ factorId: benFactor, challengeId: ch.id, code: totp(benSecret, Date.now() + 10 * 60_000) });
  assert(wrong.error && /Invalid TOTP code/.test(wrong.error.message), `a code from 10 minutes ahead: ${wrong.error?.message}`);
  const unknown = await c.auth.mfa.verify({ factorId: benFactor, challengeId: '00000000-0000-4000-8000-000000000000', code: totp(benSecret) });
  assert(unknown.error, 'an unknown challenge');
  const second = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Second' });
  assert(second.error && /AAL2 required/i.test(second.error.message), `a second factor from aal1: ${second.error?.message}`);
  const remove = await c.auth.mfa.unenroll({ factorId: benFactor });
  assert(remove.error && /AAL2 required/i.test(remove.error.message), `removing the verified factor from aal1: ${remove.error?.message}`);
  // Failed attempts do not use the challenge up; a successful one does.
  assertEqual((await c.auth.mfa.verify({ factorId: benFactor, challengeId: ch.id, code: totp(benSecret) })).error, null, 'the right code on the same challenge');
  const reused = await c.auth.mfa.verify({ factorId: benFactor, challengeId: ch.id, code: totp(benSecret) });
  assert(reused.error, 'a verified challenge is single use');
  return 'a stolen password alone cannot remove or replace the factor';
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
