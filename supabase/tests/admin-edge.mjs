// The admin boundary at the edge (V6 Stage 4: "a customer must not reach admin
// through client-side manipulation; prove it with a test"; V6-051).
//
// The Deno Edge Functions (supabase/functions/admin-refund, admin-push and
// _shared/admin.ts) are compiled with esbuild and run under Node against the
// local stack: Deno.env reads process.env, Deno.serve hands back the handler,
// and the esm.sh import of supabase-js resolves to the installed package. The
// code under test is the functions' own; only the runtime is substituted.
//
//   node supabase/tests/admin-edge.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from './lib/live-db.mjs';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';
import { totp } from '../local/totp.mjs';

const t = createHarness('Admin boundary at the edge (Edge Functions on the local stack)');
const stack = await startStack();
const sql = async (text, params) => (await stack.query(text, params)).rows;
// A hosted project gives every Edge Function its anon key; the second-factor
// check (contract §12a) asks the database in the caller's own session with it.
process.env.SUPABASE_ANON_KEY = stack.keys.anonKey;

// --- the Deno runtime, substituted --------------------------------------------
const handlers = {};
let current = null;
globalThis.Deno = {
  env: { get: (name) => process.env[name] },
  serve: (handler) => {
    handlers[current] = handler;
  },
};
// supabase-js builds a Realtime client and needs a WebSocket class to exist
// (Deno has one); nothing here subscribes, so it is never instantiated.
globalThis.WebSocket ??= class {
  constructor() {
    throw new Error('Realtime is not used by the admin functions.');
  }
};

// Under node_modules (gitignored) so the compiled code resolves the installed
// packages. A fresh install has no node_modules/.cache yet.
const cacheDir = path.join(ROOT, 'node_modules', '.cache');
fs.mkdirSync(cacheDir, { recursive: true });
const outDir = fs.mkdtempSync(path.join(cacheDir, 'shygon-edge-'));
const esmShToNpm = {
  name: 'esm-sh-to-npm',
  setup(b) {
    b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js@/ }, () => ({
      path: path.join(ROOT, 'node_modules', '@supabase', 'supabase-js', 'dist', 'index.mjs'),
    }));
  },
};
async function load(entry, name) {
  const outfile = path.join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [path.join(ROOT, 'supabase', 'functions', entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'error',
    plugins: [esmShToNpm],
    packages: 'external',
  });
  current = name;
  const mod = await import(pathToFileURL(outfile).href);
  current = null;
  return mod;
}
const shared = await load('_shared/admin.ts', 'shared');
await load('admin-refund/index.ts', 'admin-refund');
await load('admin-push/index.ts', 'admin-push');

const call = async (name, { token, method = 'POST', body, headers = {} } = {}) => {
  const response = await handlers[name](
    new Request(`http://edge.local/functions/v1/${name}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined || method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
};

// --- the people ----------------------------------------------------------------
const customer = await signUp(stack, { name: 'Ordinary Customer' });
async function admin(role, { active = true, permissions = [] } = {}) {
  const account = await signUp(stack, { name: `${role} admin` });
  await sql(`INSERT INTO public.admin_users (user_id, role, is_active, permissions) VALUES ($1, $2, $3, $4)`, [
    account.userId,
    role,
    active,
    permissions,
  ]);
  return account;
}
const viewer = await admin('viewer');
const support = await admin('support', { permissions: ['orders.refund'] });
const inactive = await admin('admin', { active: false });
const full = await admin('admin');

// ---------------------------------------------------------------------------
t.section('V6-051: the edge role map equals the database catalogue');

await t.check('rolePermissions(role) == admin_role_permissions(role) for every role, and unknown roles get nothing', async () => {
  for (const role of ['owner', 'admin', 'fulfilment', 'support', 'viewer', 'nonsense', '']) {
    const [row] = await sql(`SELECT coalesce(public.admin_role_permissions($1), '{}') AS p`, [role]);
    assertEqual([...shared.rolePermissions(role)].sort(), [...row.p].sort(), `role ${JSON.stringify(role)}`);
  }
  return '7 roles';
});

// ---------------------------------------------------------------------------
t.section('resolveAdmin: who is an administrator, re-derived from the database');

const service = shared.serviceClient();
const resolve = (token, permission) =>
  shared.resolveAdmin(service, new Request('http://edge.local', { headers: token ? { authorization: token } : {} }), permission);

await t.check('no token, a malformed header or a forged token: not an administrator', async () => {
  assertEqual(await resolve(null, 'orders.read'), null, 'no header');
  assertEqual(await resolve('Basic abc', 'orders.read'), null, 'not bearer');
  assertEqual(await resolve('Bearer not-a-jwt', 'orders.read'), null, 'garbage');
  const forged = customer.token.split('.').slice(0, 2).join('.') + '.forgedsignature';
  assertEqual(await resolve(`Bearer ${forged}`, 'orders.read'), null, 'forged signature');
});

await t.check('a signed-in customer is not an administrator', async () => {
  assertEqual(await resolve(`Bearer ${customer.token}`, 'orders.read'), null, 'customer');
});

await t.check('client-side manipulation: a customer who writes role=admin into their own user metadata gains nothing', async () => {
  const { error } = await customer.client.auth.updateUser({ data: { role: 'admin', permissions: ['orders.refund'], is_admin: true } });
  assert(!error, `updateUser: ${error?.message}`);
  const { data } = await customer.client.auth.refreshSession();
  const token = data.session.access_token;
  assertEqual(await resolve(`Bearer ${token}`, 'orders.read'), null, 'edge');
  const rpc = await customer.client.rpc('admin_list_orders', {});
  assert(rpc.error, 'the admin RPC answered a customer');
  const has = await customer.client.rpc('admin_has', { p_permission: 'orders.read' });
  assertEqual(has.data, false, 'admin_has for the customer');
  customer.token = token;
});

await t.check('a customer cannot make themselves an administrator through the API', async () => {
  const insert = await customer.client.from('admin_users').insert({ user_id: customer.userId, role: 'owner', is_active: true });
  assert(insert.error, 'insert into admin_users succeeded');
  const count = await sql(`SELECT count(*)::int AS n FROM public.admin_users WHERE user_id = $1`, [customer.userId]);
  assertEqual(count[0].n, 0, 'admin rows for the customer');
  const audit = await customer.client.from('admin_audit_log').select('id');
  assert(audit.error || audit.data.length === 0, 'customer read the audit log');
});

await t.check('an inactive administrator is refused', async () => {
  assertEqual(await resolve(`Bearer ${inactive.token}`, 'orders.read'), null, 'inactive');
});

await t.check('a viewer may read but not refund; extra permissions on the row are honoured', async () => {
  assertEqual(await resolve(`Bearer ${viewer.token}`, 'orders.refund'), null, 'viewer refund');
  const reading = await resolve(`Bearer ${viewer.token}`, 'orders.read');
  assertEqual(reading?.role, 'viewer', 'viewer read');
  const granted = await resolve(`Bearer ${support.token}`, 'orders.refund');
  assertEqual(granted?.role, 'support', 'support with an extra orders.refund');
});

await t.check('the edge and the database agree on every role x permission pair', async () => {
  const permissions = ['orders.read', 'orders.refund', 'tap.moderate', 'customers.manage', 'audit.read', 'admins.manage'];
  let pairs = 0;
  for (const account of [customer, viewer, support, inactive, full]) {
    for (const permission of permissions) {
      const answer = await resolve(`Bearer ${account.token}`, permission);
      const edge = answer !== null && answer !== shared.MFA_REQUIRED;
      const { data: db } = await account.client.rpc('admin_has', { p_permission: permission });
      assertEqual(edge, db === true, `${account.email} ${permission}`);
      pairs++;
    }
  }
  return `${pairs} pairs`;
});

// ---------------------------------------------------------------------------
t.section('The functions themselves');

async function captureCall(name, options) {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = (...args) => lines.push(args.join(' '));
  console.warn = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));
  try {
    const response = await call(name, options);
    return { response, lines, events: lines.map((line) => JSON.parse(line)) };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

await t.check('admin edge refusals emit one security event per reason and preserve response status/body', async () => {
  const cases = [
    ['admin-refund', {}, 403, 'no-session'],
    ['admin-refund', { token: customer.token }, 403, 'not-admin'],
    ['admin-refund', { token: viewer.token }, 403, 'missing-permission'],
    ['admin-refund', { method: 'GET' }, 405, 'bad-method'],
    ['admin-push', {}, 403, 'no-session'],
    ['admin-push', { token: customer.token }, 403, 'not-admin'],
    ['admin-push', { method: 'GET' }, 405, 'bad-method'],
  ];
  for (const [name, options, status, reason] of cases) {
    const { response, events } = await captureCall(name, options);
    assertEqual(response.status, status, `${name} ${reason} status`);
    const security = events.filter((event) => event.event === 'security.admin-refused');
    assertEqual(security.length, 1, `${name} ${reason} event count`);
    assertEqual(security[0].reason, reason, `${name} refusal reason`);
  }
  assertEqual((await call('admin-refund', { method: 'GET' })).body, { error: 'Method not allowed' }, 'method response body');
  assertEqual((await call('admin-refund', {})).body, { error: 'You are not permitted to issue refunds.' }, 'refusal response body');
  return `${cases.length} refusal paths`;
});

await t.check('admin edge log lines are structured, carry request ids and exclude email, phone and token canaries', async () => {
  const canaries = ['edge-canary@example.invalid', '+15550101234', 'edge-token-canary-9f41'];
  for (const name of ['admin-refund', 'admin-push']) {
    const requestId = 'edge-request-20261102';
    const { response, lines, events } = await captureCall(name, {
      body: { email: canaries[0], phone: canaries[1], token: canaries[2] },
      headers: { 'x-request-id': requestId },
    });
    assertEqual(response.headers.get('x-request-id'), requestId, `${name} response request id`);
    assert(events.length > 0, `${name} emitted a log line`);
    for (const line of lines) {
      const event = JSON.parse(line);
      assertEqual(event.fn, name, `${name} log function`);
      assertEqual(event.requestId, requestId, `${name} log request id`);
      assert(event.ts && event.level && event.event, `${name} standard log fields`);
      for (const canary of canaries) assert(!line.includes(canary), `${name} leaked a canary`);
    }
  }
  return 'both admin functions';
});

await t.check('admin-refund: no token, a customer and a viewer are refused (403); CORS preflight and wrong method behave', async () => {
  assertEqual((await call('admin-refund', { body: { order_id: 'x', reason: 'test' } })).status, 403, 'no token');
  assertEqual((await call('admin-refund', { token: customer.token, body: { order_id: 'x', reason: 'test' } })).status, 403, 'customer');
  assertEqual((await call('admin-refund', { token: viewer.token, body: { order_id: 'x', reason: 'test' } })).status, 403, 'viewer');
  assertEqual((await call('admin-refund', { method: 'OPTIONS' })).status, 200, 'preflight');
  assertEqual((await call('admin-refund', { method: 'GET' })).status, 405, 'GET');
});

await t.check('admin-refund: an administrator with orders.refund gets past the gate (and is asked for an order)', async () => {
  const response = await call('admin-refund', { token: full.token, body: { reason: 'test' } });
  assertEqual([response.status, response.body?.error], [400, 'An order id is required.'], 'admin');
});

await t.check('admin-push: no token and a customer are refused; an admin may only send a test to themselves', async () => {
  assertEqual((await call('admin-push', { body: { test: true } })).status, 403, 'no token');
  assertEqual((await call('admin-push', { token: customer.token, body: { test: true } })).status, 403, 'customer');
  const notTest = await call('admin-push', { token: viewer.token, body: {} });
  assertEqual(notTest.status, 400, 'admin without { test: true }');
  const noDevice = await call('admin-push', { token: viewer.token, body: { test: true } });
  assertEqual(noDevice.status, 409, 'admin with no registered device');
});

// ---------------------------------------------------------------------------
t.section('DEC-2026-046 at the edge: the second factor (migration 040; contract §12a, v0.16)');

const PASSWORD = 'local-test-pass-1';
/** A fresh password sign-in: a new client with an aal1 session. */
async function signIn(account) {
  const client = supabaseClient(stack);
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: PASSWORD });
  if (error) throw new Error(`sign-in: ${error.message}`);
  return client;
}
const tokenOf = async (client) => (await client.auth.getSession()).data.session.access_token;
/** Enrols and verifies a TOTP factor through supabase-js, as the admin app would; the client ends at aal2. */
async function enrolAndVerify(client) {
  const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Phone' });
  if (error) throw new Error(`enroll: ${error.message}`);
  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: enrolled.id });
  if (challengeError) throw new Error(`challenge: ${challengeError.message}`);
  const { error: verifyError } = await client.auth.mfa.verify({ factorId: enrolled.id, challengeId: challenge.id, code: totp(enrolled.totp.secret) });
  if (verifyError) throw new Error(`verify: ${verifyError.message}`);
}
const MFA_BODY = { error: 'Enter your authenticator code to continue.', code: 'admin:mfa_required' };
async function refusal(name, options) {
  const { response, events } = await captureCall(name, options);
  const reasons = events.filter((event) => event.event === 'security.admin-refused').map((event) => event.reason);
  return [response.status, response.body, reasons];
}

const secured = await admin('admin');
const aal2Client = await signIn(secured);
await enrolAndVerify(aal2Client);
const aal2 = await tokenOf(aal2Client);
const aal1Client = await signIn(secured);
const aal1 = await tokenOf(aal1Client);

await t.check('an administrator with a verified factor: admin:mfa_required at aal1 on both functions, accepted at aal2; the database agrees', async () => {
  assertEqual(await resolve(`Bearer ${aal1}`, 'orders.refund'), shared.MFA_REQUIRED, 'resolveAdmin at aal1');
  assertEqual((await resolve(`Bearer ${aal2}`, 'orders.refund'))?.role, 'admin', 'resolveAdmin at aal2');
  assertEqual((await aal1Client.rpc('admin_has', { p_permission: 'orders.refund' })).data, false, 'admin_has at aal1');
  assertEqual((await aal2Client.rpc('admin_has', { p_permission: 'orders.refund' })).data, true, 'admin_has at aal2');
  for (const name of ['admin-refund', 'admin-push']) {
    assertEqual(await refusal(name, { token: aal1, body: { test: true, reason: 'test' } }), [403, MFA_BODY, ['mfa-required']], `${name} at aal1`);
  }
  const refund = await call('admin-refund', { token: aal2, body: { reason: 'test' } });
  assertEqual([refund.status, refund.body?.error], [400, 'An order id is required.'], 'admin-refund at aal2');
  assertEqual((await call('admin-push', { token: aal2, body: { test: true } })).status, 409, 'admin-push at aal2 (no device)');
  // The refusal is not the one the current admin app signs out on (DEC-2026-046).
  assert(!/administrator access|does not permit/i.test(MFA_BODY.error), 'the app would sign out');
  return 'opt-in, exactly as the admin RPCs';
});

await t.check('the mandatory switch (step 3): every administrator needs aal2 at the edge; switched off, one without a factor works as before', async () => {
  const on = (await sql(`SELECT public.admin_mfa_set_required(true, true, 'test:admin-edge') AS r`))[0].r;
  assertEqual(on.ok, true, 'switched on');
  try {
    assertEqual(await resolve(`Bearer ${full.token}`, 'orders.refund'), shared.MFA_REQUIRED, 'no factor, switch on');
    assertEqual(await refusal('admin-refund', { token: full.token, body: { reason: 'test' } }), [403, MFA_BODY, ['mfa-required']], 'admin-refund, switch on');
    assertEqual((await resolve(`Bearer ${aal2}`, 'orders.refund'))?.role, 'admin', 'aal2 still accepted');
  } finally {
    await sql(`SELECT public.admin_mfa_set_required(false, false, 'test:admin-edge')`);
  }
  assertEqual((await resolve(`Bearer ${full.token}`, 'orders.refund'))?.role, 'admin', 'switched off: as before');
  return 'step 3 works and ships OFF';
});

await t.check('the check fails closed: when the database cannot answer, the ordinary refusal, logged as mfa-check-failed', async () => {
  // Test-only: the caller's session may not ask, so the database gives no answer.
  await sql(`REVOKE EXECUTE ON FUNCTION public.admin_mfa_status() FROM authenticated`);
  try {
    assertEqual(await resolve(`Bearer ${full.token}`, 'orders.refund'), null, 'resolveAdmin');
    assertEqual(await refusal('admin-refund', { token: full.token, body: { reason: 'test' } }),
      [403, { error: 'You are not permitted to issue refunds.' }, ['mfa-check-failed']], 'admin-refund');
  } finally {
    await sql(`GRANT EXECUTE ON FUNCTION public.admin_mfa_status() TO authenticated`);
  }
  assertEqual((await resolve(`Bearer ${full.token}`, 'orders.refund'))?.role, 'admin', 'restored');
  return 'never allowed on doubt';
});

// ---------------------------------------------------------------------------
t.section('V5 audit B-1 parity (migration 046): the refund reason is an internal note');

await t.check('a refund writes its reason to order_admin_notes, never onto the order row the customer can read', async () => {
  // orders.customer_id references the account itself (auth.users) on live.
  const [{ id: orderId }] = await sql(`INSERT INTO public.orders (order_id, user_id, customer_id, product_name, amount, amount_in_paise,
      payment_status, order_status, razorpay_payment_id)
    VALUES ('ST-REFUND-046', $1, $1, 'Business experience', 999, 99900, 'paid', 'processing', 'pay_test_046') RETURNING id`, [customer.userId]);
  // The gateway is stubbed for this one call: no request leaves the machine.
  const realFetch = globalThis.fetch;
  let gateway = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.razorpay.com/')) {
      gateway++;
      return new Response(JSON.stringify({ id: 'rfnd_test_046', status: 'processed' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, init);
  };
  let r;
  try {
    r = await call('admin-refund', { token: full.token, body: { order_id: orderId, reason: 'Damaged in transit' } });
  } finally {
    globalThis.fetch = realFetch;
  }
  assertEqual([r.status, r.body?.success, gateway], [200, true, 1], 'refunded through the stubbed gateway');
  const [row] = await sql(`SELECT admin_note, payment_status FROM public.orders WHERE id = $1`, [orderId]);
  assertEqual(row, { admin_note: null, payment_status: 'refunded' }, 'nothing on the order row');
  const [note] = await sql(`SELECT note FROM public.order_admin_notes WHERE order_id = $1`, [orderId]);
  assertEqual(note?.note, 'Refund: Damaged in transit', 'the internal note');
  const leak = await customer.client.from('orders').select('admin_note').eq('id', orderId);
  assert(leak.error, `the customer could select admin_note: ${JSON.stringify(leak.data)}`);
  const own = await customer.client.from('orders').select('order_id, payment_status').eq('id', orderId);
  assertEqual(own.data, [{ order_id: 'ST-REFUND-046', payment_status: 'refunded' }], 'the customer still reads their order');
  return 'reason in order_admin_notes; admin_note refused to the customer';
});

const ok = t.finish();
await stack.close();
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
