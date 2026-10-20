// SHYGON Connect and the consent ledger (migration 032, /api/connect).
//
// Part A: the tables are closed to every client role and the ledger is
// append-only, even for the server role. Part B: the real server function on
// the local stack, as the requester, the target, a third account, anon and a
// suspended account: requests, duplicates, decisions, live reads under an
// active grant, share changes, revocation, decline cool-down, block (never
// revealed), limits, expiry, the ledger, and no leaks.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/connect.mjs
import { createMigratedDb } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

const t = createHarness('Connect and the consent ledger (032)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}
const TABLES = ['connect_settings', 'connections', 'consent_grants', 'connect_audit'];

// ---------------------------------------------------------------------------
t.section('A. Database');
const db = await createMigratedDb();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);

await t.check('Connect tables and functions are closed to anon and signed-in callers', async () => {
  for (const table of TABLES) {
    const r = (await db.query(`SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
      FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [table])).rows[0];
    assert(r.rls && r.policies === 0 && !r.anon && !r.auth, `${table}: ${JSON.stringify(r)}`);
  }
  const open = (await db.query(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'connect\\_%'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`)).rows;
  assertEqual(open.map((r) => r.sig), [], 'functions open to a client role');
  return `${TABLES.length} tables, 15 functions`;
});

await t.check('the consent ledger is append-only: a grant can be revoked once, and nothing else changes, even for the server role', async () => {
  const A = 'd1000000-0000-4000-8000-000000000001';
  const B = 'd2000000-0000-4000-8000-000000000002';
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${A}', 'a@example.test'), ('${B}', 'b@example.test');
    INSERT INTO public.connections (id, requester_user_id, target_user_id, status, idempotency_key)
    VALUES ('d3000000-0000-4000-8000-000000000003', '${A}', '${B}', 'accepted', 'ledger-test-key-0001');
    INSERT INTO public.consent_grants (id, grantor_user_id, grantee_user_id, scope, connection_id)
    VALUES ('d4000000-0000-4000-8000-000000000004', '${A}', '${B}', ARRAY['email'], 'd3000000-0000-4000-8000-000000000003');`);
  const asService = async (sql) => {
    try {
      await db.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE service_role'); await tx.query(sql); });
      return 'ok';
    } catch (error) {
      return error.code;
    }
  };
  const G = `id = 'd4000000-0000-4000-8000-000000000004'`;
  assertEqual(await asService(`UPDATE public.consent_grants SET scope = ARRAY['phone','email'] WHERE ${G}`), '42501', 'widen the scope');
  assertEqual(await asService(`DELETE FROM public.consent_grants WHERE ${G}`), '42501', 'delete a grant');
  assertEqual(await asService(`UPDATE public.consent_grants SET revoked_at = now(), revoke_reason = 'removed' WHERE ${G}`), 'ok', 'revoke');
  assertEqual(await asService(`UPDATE public.consent_grants SET revoked_at = NULL WHERE ${G}`), '42501', 'un-revoke');
  assertEqual(await asService(`UPDATE public.consent_grants SET revoked_at = now() - interval '1 day' WHERE ${G}`), '42501', 'rewrite the revocation time');
  const bad = await asService(`INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id)
    VALUES ('${A}', '${B}', ARRAY['password'], 'd3000000-0000-4000-8000-000000000003')`);
  assertEqual(bad, '23514', 'a field outside the shareable list');
  return 'append-only';
});
await db.close();

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack');
const stack = await startStack();
const bodies = [];
const call = async (body, token) => {
  const r = await callFunction(stack, 'connect', { token, body });
  bodies.push({ token: token ?? null, text: JSON.stringify(r.body) });
  return r;
};
const codeOf = (r) => r.body?.error?.code;
const key = () => crypto.randomUUID();

const asha = await signUp(stack, { name: 'Asha Rao' });
const ben = await signUp(stack, { name: 'Ben Thomas' });
const cara = await signUp(stack, { name: 'Cara Dsouza' });
const dev = await signUp(stack, { name: 'Dev Suspended' });
const setProfile = (u, phone, email, company, job) =>
  stack.query(`UPDATE public.profiles SET phone = $2, email = $3, company = $4, job_title = $5 WHERE id = $1`, [u.userId, phone, email, company, job]);
await setProfile(asha, '+919800011111', 'asha.private@example.test', 'Rao Studio', 'Founder');
await setProfile(ben, '+919800022222', 'ben.private@example.test', 'Thomas & Co', 'Engineer');
await setProfile(cara, '+919800033333', 'cara.private@example.test', 'Cara Inc', 'Designer');
await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'asha-connect', 'asha-connect', 'Asha Rao', 'active')`, [asha.userId]);
const SLUG = 'asha-connect';

await t.check('Connect is off by default; anon may only ask whether it is available; every other operation needs sign-in', async () => {
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'off by default');
  const anon = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] });
  assertEqual([anon.status, codeOf(anon)], [401, 'unauthenticated'], 'anonymous request');
  const off = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, ben.token);
  assertEqual([off.status, codeOf(off)], [404, 'unavailable'], 'owner has Connect off');
  const on = await call({ op: 'settings.set', enabled: true }, asha.token);
  assertEqual(on.body.settings.enabled, true, 'enabled');
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, true, 'available');
  return 'opt-in';
});

let conn;
let firstKey;
await t.check('a request shares exactly the chosen fields; the note is cleaned; the target is notified without the note', async () => {
  assertEqual(codeOf(await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: ['password'] }, ben.token)), 'invalid_share', 'unknown field');
  assertEqual(codeOf(await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, asha.token)), 'self', 'to oneself');
  firstKey = key();
  const r = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: firstKey, share: ['email', 'company'],
    note: 'We met at the expo. See www.my-portfolio.com' }, ben.token);
  assertEqual(r.status, 201, JSON.stringify(r.body));
  conn = r.body.connection;
  assertEqual([conn.status, conn.direction, conn.iShare, conn.theyShare], ['requested', 'outgoing', ['company', 'email'], {}], 'requester view');
  assertEqual(conn.note, 'We met at the expo. See [link removed]', 'note');
  assertEqual(conn.other.name, 'Asha Rao', 'target identity');
  const note = (await stack.query(`SELECT title, body FROM public.notifications WHERE user_id = $1 AND category = 'connect'`, [asha.userId])).rows;
  assert(note.length === 1 && /Ben Thomas wants to connect/.test(note[0].body) && !/expo/.test(note[0].body), JSON.stringify(note));
  return 'sent';
});

await t.check('duplicates: the same key returns the same request; a new key while one is open is refused', async () => {
  const again = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: firstKey, share: ['email', 'company'] }, ben.token);
  assertEqual([again.status, again.body.connection.id, again.body.replayed], [200, conn.id, true], 'replay');
  const second = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, ben.token);
  assertEqual([second.status, codeOf(second)], [409, 'already_connected'], 'second open request');
  return 'one open connection per pair';
});

await t.check('the target sees who asks and what they share (self-reported); nobody else sees or touches the connection', async () => {
  const list = await call({ op: 'connections.list' }, asha.token);
  const c = list.body.connections.find((x) => x.id === conn.id);
  assertEqual([c.direction, c.status], ['incoming', 'requested'], 'target view');
  assertEqual(Object.entries(c.theyShare).sort(), [
    ['company', { value: 'Thomas & Co', provenance: 'self_reported' }],
    ['email', { value: 'ben.private@example.test', provenance: 'self_reported' }],
  ], 'shared values');
  assertEqual((await call({ op: 'connections.list' }, cara.token)).body.connections, [], "a third account's list");
  for (const op of ['requests.accept', 'requests.decline', 'requests.block', 'connections.remove', 'connections.share']) {
    const r = await call({ op, connectionId: conn.id, share: [] }, cara.token);
    assertEqual([r.status, codeOf(r)], [404, 'connection_not_found'], `${op} by a third account`);
  }
  const selfAccept = await call({ op: 'requests.accept', connectionId: conn.id, share: [] }, ben.token);
  assertEqual(codeOf(selfAccept), 'connection_not_found', 'the requester accepting their own request');
  return 'two parties only';
});

await t.check('accept: the target shares back what it chooses; values are read live while the grant is active', async () => {
  const r = await call({ op: 'requests.accept', connectionId: conn.id, share: ['phone'] }, asha.token);
  assertEqual(r.body.connection.status, 'accepted', 'accepted');
  let b = (await call({ op: 'connections.list' }, ben.token)).body.connections.find((x) => x.id === conn.id);
  assertEqual(b.theyShare, { phone: { value: '+919800011111', provenance: 'self_reported' } }, 'what Ben sees');
  await stack.query(`UPDATE public.profiles SET phone = '+919800099999' WHERE id = $1`, [asha.userId]);
  b = (await call({ op: 'connections.list' }, ben.token)).body.connections.find((x) => x.id === conn.id);
  assertEqual(b.theyShare.phone.value, '+919800099999', 'live value');
  const benNote = (await stack.query(`SELECT count(*)::int AS n FROM public.notifications WHERE user_id = $1 AND title = 'Connection accepted'`, [ben.userId])).rows[0].n;
  assertEqual(benNote, 1, 'requester notified');
  assertEqual(codeOf(await call({ op: 'requests.accept', connectionId: conn.id, share: [] }, asha.token)), 'already_decided', 'twice');
  return 'consent-scoped, live';
});

await t.check('changing what I share is a revocation plus a new version; the other side stops seeing it at once', async () => {
  await call({ op: 'connections.share', connectionId: conn.id, share: [] }, asha.token);
  const b = (await call({ op: 'connections.list' }, ben.token)).body.connections.find((x) => x.id === conn.id);
  assertEqual(b.theyShare, {}, 'nothing shared now');
  const ledger = (await call({ op: 'consents.list' }, asha.token)).body.consents.filter((g) => g.direction === 'given');
  assertEqual(ledger.map((g) => [g.version, g.scope, g.revokeReason]).sort(), [[1, ['phone'], 'changed'], [2, [], null]], 'Asha\'s ledger');
  return 'append-only history';
});

await t.check('remove (either side) ends the connection and revokes every grant both ways', async () => {
  const r = await call({ op: 'connections.remove', connectionId: conn.id }, ben.token);
  assertEqual([r.body.removed, r.body.connection.status], [true, 'removed'], 'removed');
  const a = (await call({ op: 'connections.list' }, asha.token)).body.connections.find((x) => x.id === conn.id);
  assertEqual([a.status, a.theyShare], ['removed', {}], 'Asha no longer sees Ben\'s fields');
  const active = (await stack.query(`SELECT count(*)::int AS n FROM public.consent_grants WHERE connection_id = $1 AND revoked_at IS NULL`, [conn.id])).rows[0].n;
  assertEqual(active, 0, 'active grants');
  assertEqual(codeOf(await call({ op: 'connections.remove', connectionId: conn.id }, asha.token)), 'not_open', 'twice');
  return 'revoked';
});

await t.check('decline revokes the requester\'s grant and refuses a new request for 30 days', async () => {
  const r = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: ['email'] }, ben.token);
  assertEqual(r.status, 201, 'a new request after removal');
  await call({ op: 'requests.decline', connectionId: r.body.connection.id }, asha.token);
  const b = (await call({ op: 'connections.list' }, ben.token)).body.connections.find((x) => x.id === r.body.connection.id);
  assertEqual(b.status, 'declined', 'Ben sees declined');
  const a = (await call({ op: 'connections.list' }, asha.token)).body.connections.find((x) => x.id === r.body.connection.id);
  assertEqual(a.theyShare, {}, 'Asha no longer sees Ben\'s email');
  const again = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, ben.token);
  assertEqual([again.status, codeOf(again)], [429, 'recently_declined'], 'cool-down');
  return 'declined';
});

await t.check('block is never revealed: the requester sees "declined", and a new request looks like Connect is unavailable', async () => {
  const r = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: ['phone'] }, cara.token);
  await call({ op: 'requests.block', connectionId: r.body.connection.id }, asha.token);
  const c = (await call({ op: 'connections.list' }, cara.token)).body.connections.find((x) => x.id === r.body.connection.id);
  assertEqual(c.status, 'declined', 'Cara\'s view');
  const a = (await call({ op: 'connections.list' }, asha.token)).body.connections.find((x) => x.id === r.body.connection.id);
  assertEqual(a.status, 'blocked', 'Asha\'s view');
  const again = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, cara.token);
  assertEqual([again.status, codeOf(again)], [404, 'unavailable'], 'blocked requester');
  return 'indistinguishable';
});

await t.check('a suspended requester, a paused Tap and Connect switched off all refuse new requests', async () => {
  await stack.query(`UPDATE public.profiles SET suspended_at = now() WHERE id = $1`, [dev.userId]);
  assertEqual(codeOf(await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, dev.token)), 'unavailable', 'suspended requester');
  await stack.query(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [asha.userId]);
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'paused Tap');
  await stack.query(`UPDATE public.tap_profiles SET status = 'active' WHERE user_id = $1`, [asha.userId]);
  await call({ op: 'settings.set', enabled: false }, asha.token);
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'switched off');
  await call({ op: 'settings.set', enabled: true }, asha.token);
  return 'refused';
});

await t.check('limits: 5 requests per hour per requester', async () => {
  const dummies = [];
  for (let i = 0; i < 5; i++) {
    const u = await signUp(stack, { name: `Target ${i}` });
    dummies.push(u);
    await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status)
      VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, 'Target', 'active')`, [u.userId, `limit-target-${i}`]);
    await call({ op: 'settings.set', enabled: true }, u.token);
  }
  const fresh = await signUp(stack, { name: 'Busy Requester' });
  for (let i = 0; i < 5; i++) {
    assertEqual((await call({ op: 'requests.create', slug: `limit-target-${i}`, idempotencyKey: key(), share: [] }, fresh.token)).status, 201, `request ${i + 1}`);
  }
  const sixth = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: [] }, fresh.token);
  assert(sixth.status === 429 && codeOf(sixth) === 'rate_limited' && sixth.body.error.retryAfter > 0, JSON.stringify(sixth.body));
  return `retry after ${sixth.body.error.retryAfter} s`;
});

await t.check('expiry: a request not answered in 30 days expires through the sweep and its grant is revoked', async () => {
  const eve = await signUp(stack, { name: 'Eve Late' });
  const r = await call({ op: 'requests.create', slug: SLUG, idempotencyKey: key(), share: ['email'] }, eve.token);
  await stack.query(`UPDATE public.connections SET created_at = now() - interval '31 days' WHERE id = $1`, [r.body.connection.id]);
  const sweep = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  const body = await sweep.json();
  assert(body.connect.requestsExpired >= 1, JSON.stringify(body.connect));
  const e = (await call({ op: 'connections.list' }, eve.token)).body.connections.find((x) => x.id === r.body.connection.id);
  assertEqual(e.status, 'expired', 'status');
  const ledger = (await call({ op: 'consents.list' }, eve.token)).body.consents;
  assertEqual(ledger.map((g) => g.revokeReason), ['expired'], 'ledger');
  return JSON.stringify(body.connect);
});

await t.check('direct REST: no client reaches a Connect table or function', async () => {
  for (const table of TABLES) {
    const res = await fetch(`${stack.gatewayUrl}/rest/v1/${table}?select=*`, { headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${ben.token}` } });
    assert(res.status === 401 || res.status === 403, `${table}: HTTP ${res.status}`);
  }
  const res = await fetch(`${stack.gatewayUrl}/rest/v1/rpc/connect_list`, {
    method: 'POST', headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${ben.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_user: asha.userId }),
  });
  assert([401, 403, 404].includes(res.status), `rpc: HTTP ${res.status}`);
  return 'refused';
});

await t.check('no shared value reaches a log line, and none reaches any caller without a grant for it', async () => {
  const leaks = [];
  for (const line of logLines) {
    if (/private@example|98000(11111|22222|33333|99999)|We met at the expo/.test(line)) leaks.push('a value or note in a log');
  }
  // Cara never had a grant from Asha or Ben; anon never has one; Ben never had
  // one for Asha's email or company, nor any from Cara.
  const of = (token) => bodies.filter((b) => b.token === token).map((b) => b.text).join(' ');
  if (/asha.private|ben.private|98000(11111|22222|99999)|Rao Studio|Thomas & Co/.test(of(cara.token))) leaks.push('a value reached Cara');
  if (/private@example|98000d{5}|Rao Studio|Thomas & Co|Cara Inc/.test(of(null))) leaks.push('a value reached anon');
  if (/asha.private|Rao Studio|cara.private|Cara Inc|98000(33333)/.test(of(ben.token))) leaks.push('an ungranted value reached Ben');
  assertEqual([...new Set(leaks)], [], 'leaks');
  return `${bodies.length} responses, ${logLines.length} log lines`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
