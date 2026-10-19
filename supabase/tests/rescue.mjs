// The Return-to-Owner relay (migration 031, /api/rescue).
//
// Part A: the database is closed to every client role and the message cleaner
// does what 031 says. Part B: the real server function on the local stack, as
// an anonymous finder and as the signed-in owner, separately; then another
// customer, anon REST, a support administrator; paused, suspended and disabled
// Taps; duplicates, every limit, expiry, block, report, close and retention.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/rescue.mjs
import { createMigratedDb } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';

const t = createHarness('Return-to-Owner relay (031)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}
const TABLES = ['rescue_settings', 'rescue_threads', 'rescue_messages', 'rescue_blocks', 'rescue_audit'];

// ---------------------------------------------------------------------------
t.section('A. Database');

const db = await createMigratedDb();
await db.exec(`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role; ALTER ROLE service_role BYPASSRLS;`);

await t.check('every rescue table: RLS on, no policy, no privilege for anon or authenticated', async () => {
  for (const table of TABLES) {
    const r = (await db.query(`SELECT c.relrowsecurity AS rls,
        (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS auth
      FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, [table])).rows[0];
    assert(r.rls && r.policies === 0 && !r.anon && !r.auth, `${table}: ${JSON.stringify(r)}`);
  }
  const open = (await db.query(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'rescue\\_%'
       AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
            OR NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))`)).rows;
  assertEqual(open.map((r) => r.sig), [], 'functions open to a client role');
  const audit = (await db.query(`SELECT has_table_privilege('service_role', 'public.rescue_audit', 'UPDATE,DELETE') AS p`)).rows[0];
  assertEqual(audit.p, false, 'service_role may rewrite the audit');
  return `${TABLES.length} tables and 13 functions closed`;
});

await t.check('messages: links removed, an email or number the writer chose kept, control characters flattened, 500 max', async () => {
  const clean = async (s) => (await db.query(`SELECT public.rescue_clean_text($1, 500) AS v`, [s])).rows[0].v;
  assertEqual(await clean('Get it at https://evil.example/x or bit.ly/abc'), 'Get it at [link removed] or [link removed]', 'links');
  assertEqual(await clean('Mail me: ravi.k@gmail.com, 98765 43210'), 'Mail me: ravi.k@gmail.com, 98765 43210', 'kept');
  assertEqual(await clean('a\u0007b\nc'), 'a b c', 'control characters');
  assertEqual((await clean('x'.repeat(900))).length, 500, 'cap');
  assertEqual(await clean('   '), null, 'empty');
  return 'as 031 describes';
});
await db.close();

// ---------------------------------------------------------------------------
t.section('B. Over HTTP on the local stack: finder and owner');

const stack = await startStack();
const bodies = [];
const call = async (body, { token, ip = '203.0.113.50' } = {}) => {
  const r = await callFunction(stack, 'rescue', { token, body, headers: ip === null ? {} : { 'x-nf-client-connection-ip': ip } });
  bodies.push(JSON.stringify(r.body));
  return r;
};
const codeOf = (r) => r.body?.error?.code;
const key = () => crypto.randomUUID();

const asha = await signUp(stack, { name: 'Asha Rao' });
const ben = await signUp(stack, { name: 'Ben Thomas' });
const OWNER_PHONE = '+919811122233';
const OWNER_EMAIL_LOCAL = 'asha.private';
await stack.query(`UPDATE public.profiles SET phone = $2, email = $3 WHERE id = $1`, [asha.userId, OWNER_PHONE, `${OWNER_EMAIL_LOCAL}@example.test`]);
await stack.query(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status, phone, email)
  VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), 'asha-rescue', 'asha-rescue', 'Asha Rao', 'active', $2, $3)`,
[asha.userId, OWNER_PHONE, `${OWNER_EMAIL_LOCAL}@example.test`]);
const SLUG = 'asha-rescue';

await t.check('host switch off: finders get nothing, even after the owner turns the relay on', async () => {
  const set = await call({ op: 'settings.set', enabled: true }, { token: asha.token });
  assertEqual([set.status, set.body.settings.enabled, set.body.settings.relayAllowed], [200, true, false], 'owner setting');
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'status');
  const start = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Found your card' });
  assertEqual([start.status, codeOf(start)], [404, 'unavailable'], 'start');
  process.env.RESCUE_RELAY = 'on';
  await call({ op: 'settings.set', enabled: false }, { token: asha.token });
  return 'fail-closed (DEC-2026-038 Q12)';
});

await t.check('relay off by default for the owner: unavailable; on: available with the cleaned hint', async () => {
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'owner off');
  const set = await call({ op: 'settings.set', enabled: true, publicHint: 'Tell me where you found it. Details: www.my-site.com' }, { token: asha.token });
  assertEqual(set.body.settings.publicHint, 'Tell me where you found it. Details: [link removed]', 'hint cleaned');
  const st = await call({ op: 'public.status', slug: SLUG });
  assertEqual([st.body.available, st.body.hint], [true, 'Tell me where you found it. Details: [link removed]'], 'status');
  assertEqual((await call({ op: 'public.status', slug: 'nobody-here' })).body.available, false, 'unknown Tap');
  return 'opt-in';
});

let finder;
let firstKey;
await t.check('finder start: 201 with a finder token and the thread; no owner field anywhere; links stripped', async () => {
  const noIp = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Hi' }, { ip: null });
  assertEqual(codeOf(noIp), 'unavailable', 'no client address from the host');
  assertEqual(codeOf(await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: '   ' })), 'invalid_message', 'empty');
  firstKey = key();
  const r = await call({ op: 'public.start', slug: SLUG, idempotencyKey: firstKey,
    message: 'I found your SHYGON card at the bus stop. Claim reward at http://scam.example/x. Call me 98450 11111.' });
  assertEqual(r.status, 201, JSON.stringify(r.body));
  finder = r.body.finderToken;
  assert(/^[A-Za-z0-9_-]{43}$/.test(finder), 'token format');
  assertEqual(Object.keys(r.body).sort(), ['finderToken', 'replayed', 'thread'], 'response keys');
  assertEqual(Object.keys(r.body.thread).sort(), ['canWrite', 'expiresAt', 'messages', 'status'], 'thread keys');
  assertEqual(r.body.thread.messages[0].body, 'I found your SHYGON card at the bus stop. Claim reward at [link removed]. Call me 98450 11111.', 'stored text');
  const text = JSON.stringify(r.body);
  for (const secret of [asha.userId, '9811122233', OWNER_EMAIL_LOCAL, 'Asha']) assert(!text.includes(secret), 'an owner detail reached the finder');
  const stored = (await stack.query(`SELECT finder_token_hash FROM public.rescue_threads WHERE owner_user_id = $1`, [asha.userId])).rows;
  assert(stored.length === 1 && stored[0].finder_token_hash !== finder && stored[0].finder_token_hash.length === 64, 'token stored only as a hash');
  return 'relay only';
});

await t.check('duplicate start (same key, e.g. a network retry): 200, the same token, no second thread or notice', async () => {
  const again = await call({ op: 'public.start', slug: SLUG, idempotencyKey: firstKey, message: 'I found your SHYGON card' });
  assertEqual([again.status, again.body.finderToken, again.body.replayed], [200, finder, true], 'replay');
  const n = (await stack.query(`SELECT count(*)::int AS n FROM public.rescue_threads WHERE owner_user_id = $1`, [asha.userId])).rows[0].n;
  assertEqual(n, 1, 'threads');
  const notes = (await stack.query(`SELECT title, body FROM public.notifications WHERE user_id = $1 AND category = 'rescue'`, [asha.userId])).rows;
  assertEqual(notes.length, 1, 'notices');
  assert(!/bus stop|reward/.test(notes[0].body), 'the message text is in the notification');
  return notes[0].title;
});

let threadId;
await t.check('owner: list shows unread and a preview; opening marks it read; another customer and anon cannot', async () => {
  const unauth = await call({ op: 'threads.list' });
  assertEqual([unauth.status, codeOf(unauth)], [401, 'unauthenticated'], 'no token');
  const list = await call({ op: 'threads.list' }, { token: asha.token });
  assertEqual([list.body.threads.length, list.body.threads[0].unread], [1, 1], 'list');
  threadId = list.body.threads[0].id;
  const open = await call({ op: 'threads.get', threadId }, { token: asha.token });
  assertEqual([open.body.thread.messages.length, open.body.thread.messages[0].from], [1, 'finder'], 'thread');
  assertEqual((await call({ op: 'threads.list' }, { token: asha.token })).body.threads[0].unread, 0, 'read');
  for (const op of ['threads.get', 'threads.reply', 'threads.close', 'threads.block', 'threads.report']) {
    const r = await call({ op, threadId, clientKey: key(), message: 'hijack' }, { token: ben.token });
    assertEqual([r.status, codeOf(r)], [404, 'thread_not_found'], `${op} by another customer`);
  }
  assertEqual((await call({ op: 'threads.list' }, { token: ben.token })).body.threads, [], "Ben's inbox");
  return '404 for every cross-account call';
});

await t.check('direct REST: no client reaches a rescue table or function', async () => {
  for (const table of TABLES) {
    for (const bearer of [asha.token, stack.keys.anonKey]) {
      const res = await fetch(`${stack.gatewayUrl}/rest/v1/${table}?select=*`, { headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${bearer}` } });
      assert(res.status === 401 || res.status === 403, `${table}: HTTP ${res.status}`);
    }
  }
  const res = await fetch(`${stack.gatewayUrl}/rest/v1/rpc/rescue_finder_view`, {
    method: 'POST', headers: { apikey: stack.keys.anonKey, authorization: `Bearer ${stack.keys.anonKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_token_hash: 'x' }),
  });
  assert(res.status === 401 || res.status === 403 || res.status === 404, `rpc: HTTP ${res.status}`);
  return 'refused';
});

await t.check('finder follow-ups: at most 3 in a row without a reply; a repeated client key adds nothing', async () => {
  const k2 = key();
  const p2 = await call({ op: 'finder.post', finderToken: finder, clientKey: k2, message: 'I am near the station until 6 pm.' });
  assertEqual([p2.status, p2.body.replayed], [200, false], 'second message');
  const dup = await call({ op: 'finder.post', finderToken: finder, clientKey: k2, message: 'I am near the station until 6 pm.' });
  assertEqual(dup.body.replayed, true, 'duplicate');
  await call({ op: 'finder.post', finderToken: finder, clientKey: key(), message: 'Third message' });
  const fourth = await call({ op: 'finder.post', finderToken: finder, clientKey: key(), message: 'Fourth' });
  assertEqual([fourth.status, codeOf(fourth)], [409, 'awaiting_owner'], 'fourth in a row');
  const view = await call({ op: 'finder.view', finderToken: finder });
  assertEqual([view.body.thread.messages.length, view.body.thread.canWrite], [3, false], 'finder view');
  return 'auto-quiesce';
});

await t.check('owner reply reaches the finder and lets them write again; a repeated reply is not duplicated', async () => {
  const k = key();
  const r = await call({ op: 'threads.reply', threadId, clientKey: k, message: 'Thank you! Please leave it with the station master.' }, { token: asha.token });
  assertEqual([r.status, r.body.replayed, r.body.thread.status], [200, false, 'owner_replied'], 'reply');
  const dup = await call({ op: 'threads.reply', threadId, clientKey: k, message: 'Thank you! Please leave it with the station master.' }, { token: asha.token });
  assertEqual(dup.body.replayed, true, 'replay');
  const view = await call({ op: 'finder.view', finderToken: finder });
  assertEqual(view.body.thread.messages.map((m) => m.from), ['finder', 'finder', 'finder', 'owner'], 'conversation');
  assertEqual(view.body.thread.canWrite, true, 'finder may write again');
  assertEqual(codeOf(await call({ op: 'finder.view', finderToken: 'x'.repeat(43) })), 'thread_not_found', 'unknown token');
  assertEqual(codeOf(await call({ op: 'finder.view', finderToken: 'short' })), 'invalid_token', 'malformed token');
  return 'both directions, relay only';
});

await t.check('finder limits: 3 new threads per hour from one address; 5 per owner per day', async () => {
  for (let i = 0; i < 2; i++) assertEqual((await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: `Spam ${i}` })).status, 201, `thread ${i + 2}`);
  const fourth = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Spam 3' });
  assert(fourth.status === 429 && codeOf(fourth) === 'rate_limited' && fourth.body.error.retryAfter > 0, JSON.stringify(fourth.body));
  for (const ip of ['198.51.100.1', '198.51.100.2']) {
    assertEqual((await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Found it' }, { ip })).status, 201, ip);
  }
  const sixth = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Found it' }, { ip: '198.51.100.3' });
  assertEqual([sixth.status, codeOf(sixth)], [429, 'rate_limited'], 'sixth thread for this owner today');
  const refusals = (await stack.query(`SELECT count(*)::int AS n FROM public.rescue_audit WHERE user_id = $1 AND action = 'thread.refused'`, [asha.userId])).rows[0].n;
  assert(refusals >= 2, `refusals audited: ${refusals}`);
  return `retry after ${fourth.body.error.retryAfter} s`;
});

await t.check('polling is capped (60 per thread per hour); a token stops working 14 days after the last activity', async () => {
  await stack.query(`UPDATE public.rescue_threads SET poll_window_start = now(), poll_count = 60 WHERE finder_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [finder]);
  const capped = await call({ op: 'finder.view', finderToken: finder });
  assertEqual([capped.status, codeOf(capped)], [429, 'rate_limited'], 'poll cap');
  await stack.query(`UPDATE public.rescue_threads SET poll_count = 0, last_activity_at = now() - interval '15 days' WHERE finder_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [finder]);
  assertEqual([(await call({ op: 'finder.view', finderToken: finder })).status], [410], 'view expired');
  assertEqual(codeOf(await call({ op: 'finder.post', finderToken: finder, clientKey: key(), message: 'hello' })), 'thread_expired', 'post expired');
  await stack.query(`UPDATE public.rescue_threads SET last_activity_at = now() WHERE finder_token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [finder]);
  return 'limits hold';
});

await t.check('block: the finder loses the thread and that address cannot open another to this owner', async () => {
  await stack.query(`UPDATE public.rescue_threads SET created_at = now() - interval '2 days' WHERE owner_user_id = $1`, [asha.userId]);
  const ip = '192.0.2.77';
  const s = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Hello again' }, { ip });
  assertEqual(s.status, 201, 'new thread');
  const id = (await call({ op: 'threads.list' }, { token: asha.token })).body.threads.find((x) => x.preview === 'Hello again').id;
  const b = await call({ op: 'threads.block', threadId: id }, { token: asha.token });
  assertEqual(b.body.thread.status, 'blocked', 'blocked');
  assertEqual(codeOf(await call({ op: 'finder.view', finderToken: s.body.finderToken })), 'thread_not_found', 'finder view');
  assertEqual(codeOf(await call({ op: 'finder.post', finderToken: s.body.finderToken, clientKey: key(), message: 'hi' })), 'thread_not_found', 'finder post');
  const again = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'It is me' }, { ip });
  assertEqual([again.status, codeOf(again)], [404, 'unavailable'], 'blocked address');
  assertEqual(codeOf(await call({ op: 'threads.block', threadId: id }, { token: asha.token })), 'already_blocked', 'twice');
  return 'blocked for 90 days';
});

await t.check('report: the thread is marked spam and blocked; SHYGON is told; a support admin reviews it, audited', async () => {
  await stack.query(`UPDATE public.rescue_threads SET created_at = now() - interval '2 days' WHERE owner_user_id = $1`, [asha.userId]);
  const s = await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'Abusive message' }, { ip: '192.0.2.88' });
  const id = (await call({ op: 'threads.list' }, { token: asha.token })).body.threads.find((x) => x.preview === 'Abusive message').id;
  const r = await call({ op: 'threads.report', threadId: id, reason: 'Harassment' }, { token: asha.token });
  assertEqual(r.body.thread.status, 'spam', 'status');
  assertEqual(codeOf(await call({ op: 'finder.view', finderToken: s.body.finderToken })), 'thread_not_found', 'finder cut off');
  const notice = (await stack.query(`SELECT count(*)::int AS n FROM public.admin_notifications WHERE title = 'Return-to-owner message reported'`)).rows[0].n;
  assertEqual(notice, 1, 'admin notice');
  const customer = supabaseClient(stack);
  await customer.auth.signInWithPassword({ email: ben.email, password: 'local-test-pass-1' });
  const refusedCall = await customer.rpc('admin_list_rescue_reports', { p_limit: 10, p_offset: 0 });
  assert(refusedCall.error && /administrator access/.test(refusedCall.error.message), 'a customer read the reports');
  const support = await signUp(stack, { name: 'Support Agent' });
  await stack.query(`INSERT INTO public.admin_users (user_id, role, is_active) VALUES ($1, 'support', true)`, [support.userId]);
  const { data, error } = await support.client.rpc('admin_list_rescue_reports', { p_limit: 10, p_offset: 0 });
  assert(!error && data.length === 1 && data[0].messages[0].body === 'Abusive message', JSON.stringify(error ?? data));
  const audit = (await stack.query(`SELECT count(*)::int AS n FROM public.admin_audit_log WHERE admin_id = $1 AND action = 'rescue.reports.read'`, [support.userId])).rows[0].n;
  assertEqual(audit, 1, 'audited');
  return 'moderation path';
});

await t.check('close: the finder can still read the thread but not write', async () => {
  const c = await call({ op: 'threads.close', threadId }, { token: asha.token });
  assertEqual(c.body.thread.status, 'closed', 'closed');
  const view = await call({ op: 'finder.view', finderToken: finder });
  assertEqual([view.body.thread.status, view.body.thread.canWrite], ['closed', false], 'finder view');
  assertEqual(codeOf(await call({ op: 'finder.post', finderToken: finder, clientKey: key(), message: 'hello?' })), 'thread_closed', 'finder post');
  assertEqual(codeOf(await call({ op: 'threads.reply', threadId, clientKey: key(), message: 'late' }, { token: asha.token })), 'thread_closed', 'owner reply');
  return 'closed';
});

await t.check('paused Tap, suspended Tap, suspended account, relay switched off: no new threads', async () => {
  const blockedStart = async () => codeOf(await call({ op: 'public.start', slug: SLUG, idempotencyKey: key(), message: 'x' }, { ip: '192.0.2.200' }));
  await stack.query(`UPDATE public.rescue_threads SET created_at = now() - interval '2 days' WHERE owner_user_id = $1`, [asha.userId]);
  await stack.query(`UPDATE public.tap_profiles SET status = 'paused' WHERE user_id = $1`, [asha.userId]);
  assertEqual(await blockedStart(), 'unavailable', 'paused');
  await stack.query(`UPDATE public.tap_profiles SET status = 'active', suspended_at = now() WHERE user_id = $1`, [asha.userId]);
  assertEqual(await blockedStart(), 'unavailable', 'Tap suspended');
  await stack.query(`UPDATE public.tap_profiles SET suspended_at = NULL WHERE user_id = $1`, [asha.userId]);
  await stack.query(`UPDATE public.profiles SET suspended_at = now() WHERE id = $1`, [asha.userId]);
  assertEqual(await blockedStart(), 'unavailable', 'account suspended');
  await stack.query(`UPDATE public.profiles SET suspended_at = NULL WHERE id = $1`, [asha.userId]);
  await call({ op: 'settings.set', enabled: false }, { token: asha.token });
  assertEqual(await blockedStart(), 'unavailable', 'relay off');
  assertEqual((await call({ op: 'public.status', slug: SLUG })).body.available, false, 'status');
  return 'all unavailable, indistinguishable';
});

await t.check('retention through the sweep: idle threads close after 30 days; closed ones are deleted after 90', async () => {
  await stack.query(`UPDATE public.rescue_threads SET last_activity_at = now() - interval '31 days' WHERE status IN ('open', 'owner_replied') AND owner_user_id = $1`, [asha.userId]);
  await stack.query(`UPDATE public.rescue_threads SET closed_at = now() - interval '91 days' WHERE id = $1`, [threadId]);
  const sweep = await fetch(`${stack.appUrl}/api/emergency-dispatch`, { method: 'POST', headers: { authorization: `Bearer ${stack.secrets.cronSecret}` } });
  const body = await sweep.json();
  assert(sweep.status === 200 && body.rescue.threadsDeleted >= 1 && body.rescue.threadsClosed >= 1, JSON.stringify(body.rescue));
  const gone = (await stack.query(`SELECT count(*)::int AS n FROM public.rescue_threads WHERE id = $1`, [threadId])).rows[0].n;
  assertEqual(gone, 0, 'old thread');
  return JSON.stringify(body.rescue);
});

await t.check('no message text, owner detail or secret in any log line; no owner detail in any finder response', async () => {
  const leaks = [];
  for (const line of logLines) {
    if (/bus stop|station|Abusive|Hello again|Found it/.test(line)) leaks.push('message text in a log');
    if (line.includes('9811122233') || line.includes(OWNER_EMAIL_LOCAL)) leaks.push('owner contact in a log');
    if (line.includes(stack.keys.serviceRoleKey) || line.includes(finder)) leaks.push('a secret or token in a log');
  }
  for (const b of bodies) if (b.includes('9811122233') || b.includes(OWNER_EMAIL_LOCAL)) leaks.push('owner contact in a response');
  assertEqual([...new Set(leaks)], [], 'leaks');
  return `${bodies.length} responses, ${logLines.length} log lines`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
