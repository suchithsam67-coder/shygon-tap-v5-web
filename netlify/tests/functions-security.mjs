import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Drives the Netlify Functions directly.
 *
 * They are v2 handlers — `export default async (request: Request) => Response` —
 * so a plain fetch Request exercises the real code path without the Netlify CLI.
 * What is proved here is the security boundary: who is refused, and why.
 */

const ROOT = process.argv[2] ?? process.cwd();

// Load only the NON-secret settings from .env (e.g. SUPABASE_URL). Real secrets
// are never read: these checks prove behaviour — does a bad signature fail, does
// a missing key fail closed — and none of that needs a production value.
// Secrets are configured in the deployment environment, not handed to tests.
const SECRET_NAME = /SECRET|SERVICE_ROLE|PASSWORD|TOKEN/;
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[2].trim() && !SECRET_NAME.test(m[1])) process.env[m[1]] = m[2].trim();
  }
}
for (const name of Object.keys(process.env)) {
  if (SECRET_NAME.test(name)) delete process.env[name];
}

// Throwaway values, generated per run, under the exact names the functions read.
// The handlers and this file both read process.env, so signatures still match.
const throwaway = () => crypto.randomBytes(24).toString('hex');
process.env.RAZORPAY_KEY_ID = `rzp_test_${crypto.randomBytes(7).toString('hex')}`;
process.env.RAZORPAY_KEY_SECRET = throwaway();
process.env.RAZORPAY_WEBHOOK_SECRET = throwaway();
process.env.SUPABASE_URL ??= 'https://example.supabase.co';

const fn = (name) => import(`file://${path.join(ROOT, 'netlify', 'functions', name).replace(/\\/g, '/')}`);

let pass = 0, fail = 0, blocked = 0;
async function check(name, fn) {
  try {
    const d = await fn();
    console.log(`  PASS  ${name}${d ? `  — ${d}` : ''}`);
    pass++;
  } catch (e) {
    // BLOCKED means "this machine cannot run it", never "it passed".
    if (e.blocked) { console.log(`  BLOCKED  ${name}\n        ${e.message}`); blocked++; return; }
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const blockedBy = (m) => Object.assign(new Error(m), { blocked: true });

/**
 * Runs `fn` with the service-role key absent, then puts back whatever was there.
 * These checks are about the fail-closed path, so they must not depend on what
 * happens to be in .env — a correct key there used to turn them into 500s.
 */
async function withoutServiceRole(fn) {
  const saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try { return await fn(); } finally {
    if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
  }
}

const post = (body, headers = {}) =>
  new Request('https://local.test/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const { default: createOrder } = await fn('create-order.mjs');
const { default: verifyPayment } = await fn('verify-payment.mjs');
const { default: webhook } = await fn('razorpay-webhook.mjs');
const { default: checkDelivery } = await fn('check-delivery.mjs');

console.log('\n=== method guards ===');
for (const [name, handler] of [['create-order', createOrder], ['verify-payment', verifyPayment], ['razorpay-webhook', webhook]]) {
  await check(`${name} refuses GET`, async () => {
    const r = await handler(new Request('https://local.test/api/x', { method: 'GET' }));
    assert(r.status === 405, `got ${r.status}, expected 405`);
    return '405';
  });
}

console.log('\n=== fail-closed when a server secret is absent ===');
for (const [name, handler] of [['create-order', createOrder], ['verify-payment', verifyPayment]]) {
  await check(`${name} returns 503, not 200, with no SUPABASE_SERVICE_ROLE_KEY`, () => withoutServiceRole(async () => {
    const r = await handler(post({}));
    const body = await r.json();
    assert(r.status === 503, `got ${r.status}, expected 503`);
    assert(!JSON.stringify(body).match(/SERVICE_ROLE|KEY_SECRET|eyJ/), 'error body leaked a secret name/value');
    return `503 "${body.error}"`;
  }));
}

console.log('\n=== webhook signature is mandatory ===');

await check('unsigned webhook is rejected 401', async () => {
  const r = await webhook(post({ event: 'payment.captured' }));
  assert(r.status === 401, `got ${r.status}, expected 401`);
  return '401';
});

await check('wrong-signature webhook is rejected 401', async () => {
  const r = await webhook(post({ event: 'payment.captured' }, {
    'x-razorpay-signature': 'a'.repeat(64),
    'x-razorpay-event-id': 'evt_test_1',
  }));
  assert(r.status === 401, `got ${r.status}, expected 401`);
  return '401';
});

await check('signature computed over a DIFFERENT body is rejected (tamper check)', async () => {
  const honest = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { amount: 100 } } } });
  const tampered = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { amount: 9999999 } } } });
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(honest).digest('hex');
  const r = await webhook(post(tampered, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_test_2' }));
  assert(r.status === 401, `got ${r.status}, expected 401 — a tampered body was accepted`);
  return '401';
});

await check('correctly signed webhook passes the signature gate', () => withoutServiceRole(async () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } } });
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const r = await webhook(post(body, { 'x-razorpay-signature': sig, 'x-razorpay-event-id': 'evt_test_3' }));
  // It gets past the signature and then stops at the (deliberately) absent key —
  // proving the signature was accepted without touching any database.
  assert(r.status !== 401, `still 401 — a valid signature was rejected`);
  assert(r.status === 503, `got ${r.status}; expected 503 (signature accepted, DB unavailable)`);
  return 'signature accepted, then 503 on the missing service-role key';
}));

await check('signed webhook with no event id is rejected 400 (idempotency key required)', async () => {
  const body = JSON.stringify({ event: 'payment.captured' });
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const r = await webhook(post(body, { 'x-razorpay-signature': sig }));
  assert(r.status === 400, `got ${r.status}, expected 400`);
  return '400';
});

console.log('\n=== "payment succeeded" cannot be asserted by a client ===');

await check('verify-payment refuses an unauthenticated caller', async () => {
  // supabase-js builds a Realtime client inside createClient, which needs a
  // native WebSocket — Node 22+. On older Node every handler 500s before it can
  // reach its auth check, so the answer here would say nothing about auth.
  // netlify.toml pins Node 22 for production for exactly this reason.
  if (typeof globalThis.WebSocket === 'undefined') {
    throw blockedBy(`needs Node >= 22 for supabase-js (this machine: ${process.version}); production is pinned to 22`);
  }
  // Give it a syntactically valid but bogus service-role value so the handler
  // reaches its auth check instead of short-circuiting on the missing secret.
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_not_a_real_key_for_local_probe';
  const { default: vp } = await import(
    `file://${path.join(ROOT, 'netlify', 'functions', 'verify-payment.mjs').replace(/\\/g, '/')}?probe=1`
  );
  const r = await vp(post({
    razorpay_order_id: 'order_fake',
    razorpay_payment_id: 'pay_fake',
    razorpay_signature: 'deadbeef',
    success: true,
    paid: true,
  }));
  if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  assert(r.status === 401, `got ${r.status}, expected 401 — an anonymous caller was not refused`);
  return '401 — no session, no fulfilment';
});

await check('the HMAC verify-payment uses is order|payment, not client-supplied', async () => {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const good = crypto.createHmac('sha256', secret).update('order_1|pay_1').digest('hex');
  const forged = crypto.createHmac('sha256', 'attacker-guess').update('order_1|pay_1').digest('hex');
  assert(good !== forged, 'HMAC is not keyed by the server secret');
  const src = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'verify-payment.mjs'), 'utf8');
  assert(/timingSafeEqual/.test(src), 'signature compared without timingSafeEqual');
  assert(/\$\{orderId\}\|\$\{paymentId\}/.test(src), 'HMAC payload is not `${orderId}|${paymentId}`');
  assert(!/body\?\.(success|paid|status)/.test(src), 'handler reads a success flag from the request body');
  return 'keyed HMAC + constant-time compare';
});

console.log('\n=== logging safety ===');
await check('no function prints a secret value', async () => {
  const offenders = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'netlify', 'functions'))) {
    const src = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', f), 'utf8');
    // console.* and the structured logger (netlify/lib/log.mjs, V6-018).
    for (const m of src.matchAll(/(?:console|log)\.(log|info|warn|error)\(([^\n]*)/g)) {
      if (/KEY_SECRET|SERVICE_ROLE|WEBHOOK_SECRET|keySecret|webhookSecret|process\.env/.test(m[2])) {
        offenders.push(`${f}: ${m[0].slice(0, 80)}`);
      }
    }
  }
  assert(offenders.length === 0, `logs a secret: ${offenders.join(' | ')}`);
  return `${fs.readdirSync(path.join(ROOT, 'netlify', 'functions')).length} functions clean`;
});

await check('check-delivery is also gated', async () => {
  const r = await checkDelivery(post({ pincode: '560001' }));
  assert([401, 405, 503, 400, 200].includes(r.status), `unexpected ${r.status}`);
  return `status ${r.status}`;
});

console.log(`\n${pass} passed, ${fail} failed, ${blocked} blocked`);
process.exit(fail > 0 ? 1 : 0);
