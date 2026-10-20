// SHYGON Privé, demo only (migration 033, /api/prive).
//
// Part A: the tables are closed to every client role, every hotel and request
// is a demo by construction, and the step log is append-only. Part B: the real
// server function on the local stack: the sample catalogue (no sign-in), demo
// requests (signed in), idempotency, isolation between accounts, the SHYGON
// demo "hotel desk" moving requests on, cancel, limits, retention, the hotel
// boundary refusing any provider but the demo, and every response labelled.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/prive.mjs
import { createMigratedDb } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';

const t = createHarness('Privé demo (033)');
const TABLES = ['prive_demo_hotels', 'prive_demo_requests', 'prive_demo_request_events'];

// ---------------------------------------------------------------------------
t.section('A. Database');
const db = await createMigratedDb();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);

await t.check('Privé tables and functions are closed to anon and signed-in callers', async () => {
  for (const table of TABLES) {
    const r = (await db.query(`SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
      FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [table])).rows[0];
    assert(r.rls && r.policies === 0 && !r.anon && !r.auth, `${table}: ${JSON.stringify(r)}`);
  }
  const open = (await db.query(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'prive\\_%'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))`)).rows;
  assertEqual(open.map((r) => r.sig), [], 'functions open to a client role');
  return `${TABLES.length} tables, 6 functions`;
});

await t.check('demo by construction: every hotel is a SHYGON Demo sample; a non-demo hotel or request cannot be stored', async () => {
  const hotels = (await db.query(`SELECT name, is_demo, demo_label FROM public.prive_demo_hotels ORDER BY sort_order`)).rows;
  assertEqual(hotels.map((h) => h.name), ['SHYGON Demo Residence', 'SHYGON Demo Seaside', 'SHYGON Demo Hills'], 'catalogue');
  assert(hotels.every((h) => h.is_demo && /demo/i.test(h.demo_label)), 'labels');
  const refused = async (sql) => {
    try { await db.query(sql); return 'stored'; } catch (error) { return error.code; }
  };
  assertEqual(await refused(`INSERT INTO public.prive_demo_hotels (slug, name, city, description, services) VALUES ('real', 'Grand Real Hotel', 'x', 'x', '[]')`), '23514', 'a real-looking hotel');
  assertEqual(await refused(`INSERT INTO public.prive_demo_hotels (slug, name, city, description, services, is_demo) VALUES ('flag', 'SHYGON Demo Flag', 'x', 'x', '[]', false)`), '23514', 'is_demo = false');
  await db.exec(`INSERT INTO auth.users (id, email) VALUES ('f1000000-0000-4000-8000-000000000001', 'p@example.test')`);
  assertEqual(await refused(`INSERT INTO public.prive_demo_requests (user_id, hotel_id, service, idempotency_key, is_demo)
    SELECT 'f1000000-0000-4000-8000-000000000001', id, 'housekeeping', 'not-a-demo-key-0001', false FROM public.prive_demo_hotels LIMIT 1`), '23514', 'a non-demo request');
  const svc = (await db.query(`SELECT has_table_privilege('service_role', 'public.prive_demo_request_events', 'UPDATE,DELETE') AS p`)).rows[0];
  assertEqual(svc.p, false, 'the server role may rewrite the step log');
  return 'CHECK constraints';
});
await db.close();

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack');
const stack = await startStack();
const responses = [];
const call = async (body, token) => {
  const r = await callFunction(stack, 'prive', { token, body });
  responses.push(r);
  return r;
};
const codeOf = (r) => r.body?.error?.code;
const key = () => crypto.randomUUID();
const guest = await signUp(stack, { name: 'Demo Guest' });
const other = await signUp(stack, { name: 'Other Guest' });

await t.check('hotels.list (no sign-in): three sample hotels, each marked demo and labelled; the walkthrough hotel and its services match', async () => {
  const r = await call({ op: 'hotels.list' });
  assertEqual([r.status, r.body.demo], [200, true], 'response');
  assert(/No real hotel received this request/.test(r.body.notice), 'notice');
  assertEqual(r.body.hotels.map((h) => [h.slug, h.demo]), [['demo-residence', true], ['demo-seaside', true], ['demo-hills', true]], 'hotels');
  assertEqual(r.body.hotels[0].services.map((s) => s.label), ['Fresh towels', 'Housekeeping', 'Late check-out', 'A table at the restaurant'], 'services');
  return r.body.hotels[0].label;
});

let first;
let firstKey;
await t.check('requests need sign-in, a sample hotel and one of its services; a created request is a demo with its first step', async () => {
  assertEqual([(await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'housekeeping', idempotencyKey: key() })).status], [401], 'anonymous');
  assertEqual(codeOf(await call({ op: 'requests.create', hotelSlug: 'grand-palace', service: 'housekeeping', idempotencyKey: key() }, guest.token)), 'hotel_not_found', 'unknown hotel');
  assertEqual(codeOf(await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'spa', idempotencyKey: key() }, guest.token)), 'invalid_service', 'a service the hotel lacks');
  assertEqual(codeOf(await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'housekeeping', idempotencyKey: 'short' }, guest.token)), 'invalid_idempotency_key', 'bad key');
  firstKey = key();
  const r = await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'fresh_towels', idempotencyKey: firstKey }, guest.token);
  assertEqual(r.status, 201, JSON.stringify(r.body));
  first = r.body.request;
  assertEqual([first.demo, first.status, first.service.label, first.hotel.name], [true, 'received', 'Fresh towels', 'SHYGON Demo Residence'], 'request');
  assertEqual(first.steps.map((s) => [s.status, s.by]), [['received', 'guest']], 'steps');
  return 'stored as a demo';
});

await t.check('the same key again returns the same request; another account sees and touches nothing', async () => {
  const again = await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'fresh_towels', idempotencyKey: firstKey }, guest.token);
  assertEqual([again.status, again.body.request.id, again.body.replayed], [200, first.id, true], 'replay');
  assertEqual((await call({ op: 'requests.list' }, guest.token)).body.requests.length, 1, 'one request');
  assertEqual((await call({ op: 'requests.list' }, other.token)).body.requests, [], "other's list");
  assertEqual(codeOf(await call({ op: 'requests.get', requestId: first.id }, other.token)), 'request_not_found', 'get by another account');
  assertEqual(codeOf(await call({ op: 'requests.cancel', requestId: first.id }, other.token)), 'request_not_found', 'cancel by another account');
  return 'isolated';
});

await t.check('the SHYGON demo "hotel desk" moves a request on: acknowledged, in progress, completed; each step is by the simulator', async () => {
  const at = async (seconds) => {
    await stack.query(`UPDATE public.prive_demo_requests SET created_at = now() - make_interval(secs => $2) WHERE id = $1`, [first.id, seconds]);
    return (await call({ op: 'requests.get', requestId: first.id }, guest.token)).body.request;
  };
  assertEqual((await at(25)).status, 'acknowledged', 'after 20 s');
  assertEqual((await at(65)).status, 'in_progress', 'after 1 min');
  const done = await at(185);
  assertEqual(done.status, 'completed', 'after 3 min');
  assertEqual(done.steps.map((s) => [s.status, s.by]), [['received', 'guest'], ['acknowledged', 'demo_hotel_simulator'], ['in_progress', 'demo_hotel_simulator'], ['completed', 'demo_hotel_simulator']], 'steps');
  assertEqual(codeOf(await call({ op: 'requests.cancel', requestId: first.id }, guest.token)), 'already_closed', 'cancel after completion');
  return 'simulated inside SHYGON';
});

await t.check('cancel stops an open demo request and records who did it', async () => {
  const r = await call({ op: 'requests.create', hotelSlug: 'demo-hills', service: 'spa', idempotencyKey: key() }, guest.token);
  const c = await call({ op: 'requests.cancel', requestId: r.body.request.id }, guest.token);
  assertEqual(c.body.request.status, 'cancelled', 'cancelled');
  assertEqual(c.body.request.steps.at(-1), { ...c.body.request.steps.at(-1), status: 'cancelled', by: 'guest' }, 'last step');
  return 'cancelled';
});

await t.check('limits: 10 demo requests per hour per account', async () => {
  const busy = await signUp(stack, { name: 'Busy Guest' });
  for (let i = 0; i < 10; i++) {
    assertEqual((await call({ op: 'requests.create', hotelSlug: 'demo-seaside', service: 'room_service', idempotencyKey: key() }, busy.token)).status, 201, `request ${i + 1}`);
  }
  const eleventh = await call({ op: 'requests.create', hotelSlug: 'demo-seaside', service: 'room_service', idempotencyKey: key() }, busy.token);
  assertEqual([eleventh.status, codeOf(eleventh)], [429, 'rate_limited'], 'eleventh');
  return `retry after ${eleventh.body.error.retryAfter} s`;
});

await t.check('the hotel boundary: any provider but the demo is refused (fail closed), and nothing calls out', async () => {
  process.env.HOTEL_PROVIDER = 'opera-pms';
  try {
    const r = await call({ op: 'hotels.list' });
    assertEqual([r.status, codeOf(r)], [503, 'not_supported'], 'a configured real provider');
  } finally {
    delete process.env.HOTEL_PROVIDER;
  }
  assertEqual((await call({ op: 'hotels.list' })).status, 200, 'back to the demo');
  return 'demo only';
});

await t.check('retention through the sweep: demo requests older than 30 days are deleted; the sweep also moves the desk on', async () => {
  const r = await call({ op: 'requests.create', hotelSlug: 'demo-residence', service: 'late_checkout', idempotencyKey: key() }, other.token);
  await stack.query(`UPDATE public.prive_demo_requests SET created_at = now() - interval '31 days' WHERE id = $1`, [r.body.request.id]);
  const sweep = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  const body = await sweep.json();
  assert(sweep.status === 200 && body.prive.demoRequestsDeleted >= 1, JSON.stringify(body.prive));
  assertEqual((await call({ op: 'requests.list' }, other.token)).body.requests, [], 'deleted');
  return JSON.stringify(body.prive);
});

await t.check('direct REST: no client reaches a Privé table or function', async () => {
  for (const table of TABLES) {
    const res = await fetch(`${stack.gatewayUrl}/rest/v1/${table}?select=*`, { headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${guest.token}` } });
    assert(res.status === 401 || res.status === 403, `${table}: HTTP ${res.status}`);
  }
  return 'refused';
});

await t.check('every response, errors included, is labelled demo, and none claims a hotel booked, received or opened anything', async () => {
  for (const r of responses) {
    assert(r.body?.demo === true && /No real hotel received this request/.test(r.body?.notice ?? ''), `unlabelled response: ${JSON.stringify(r.body).slice(0, 120)}`);
    const text = JSON.stringify({ ...r.body, notice: undefined });
    assert(!/\b(booked|reservation confirmed|hotel received|room unlocked|door opened)\b/i.test(text), `a claim: ${text.slice(0, 160)}`);
  }
  return `${responses.length} responses`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
