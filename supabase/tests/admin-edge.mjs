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
import { assert, assertEqual, createHarness, signUp } from '../local/testkit.mjs';

const t = createHarness('Admin boundary at the edge (Edge Functions on the local stack)');
const stack = await startStack();
const sql = async (text, params) => (await stack.query(text, params)).rows;

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

const call = async (name, { token, method = 'POST', body } = {}) => {
  const response = await handlers[name](
    new Request(`http://edge.local/functions/v1/${name}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined || method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
    }),
  );
  return { status: response.status, body: await response.json().catch(() => null) };
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
      const edge = (await resolve(`Bearer ${account.token}`, permission)) !== null;
      const { data: db } = await account.client.rpc('admin_has', { p_permission: permission });
      assertEqual(edge, db === true, `${account.email} ${permission}`);
      pairs++;
    }
  }
  return `${pairs} pairs`;
});

// ---------------------------------------------------------------------------
t.section('The functions themselves');

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

const ok = t.finish();
await stack.close();
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
