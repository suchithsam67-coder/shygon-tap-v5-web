// Observability of the server functions (V6 Stage 4; V6-018, V6-075).
//
//   - the structured logger redacts secrets and personal data and cuts long values;
//   - request ids are taken from the caller only when well-formed, and every
//     response carries the id its log lines were written with;
//   - security events (a refused webhook, a forged payment signature) are logged
//     as events, without the signature or the body;
//   - /api/health answers ok / degraded without ever naming a setting.
//
//   node --import ./scripts/ci/deny-network.mjs netlify/tests/observability.mjs
import { startStack } from '../../supabase/local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../../supabase/local/testkit.mjs';
import { __testing, requestIdOf } from '../lib/log.mjs';

const t = createHarness('Observability: structured logs, request ids, health');

/**
 * Runs fn with console output captured; returns the JSON log lines it wrote
 * (parsed) and every line as written (raw).
 */
async function captured(fn) {
  const lines = [];
  const raw = [];
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  for (const level of Object.keys(originals)) {
    console[level] = (...args) => {
      const text = args.join(' ');
      raw.push(text);
      if (text.startsWith('{"ts"')) lines.push(JSON.parse(text));
    };
  }
  try {
    const result = await fn();
    return { result, lines, raw };
  } finally {
    Object.assign(console, originals);
  }
}

t.section('The logger');

await t.check('secrets, signatures, tokens and contact details are redacted at any depth', async () => {
  const out = __testing.clean({
    orderId: 'ST-1',
    email: 'someone@example.test',
    phone: '+919800000000',
    razorpay_signature: 'abc',
    authorization: 'Bearer x',
    nested: { password: 'p', apiKey: 'k', shipping_address: '1 Road', userId: 'u-1' },
  });
  assertEqual(out, {
    orderId: 'ST-1',
    email: '[redacted]',
    phone: '[redacted]',
    razorpay_signature: '[redacted]',
    authorization: '[redacted]',
    nested: { password: '[redacted]', apiKey: '[redacted]', shipping_address: '[redacted]', userId: 'u-1' },
  }, 'cleaned');
});

await t.check('long values are cut and errors keep only their name and message', async () => {
  const out = __testing.clean({ text: 'x'.repeat(1000), error: new TypeError('boom') });
  assertEqual(out.text.length, 301, 'cut to 300 + ellipsis');
  assertEqual(out.error, { name: 'TypeError', message: 'boom' }, 'error');
});

await t.check('a well-formed caller request id is kept; anything else is replaced', async () => {
  const req = (id) => new Request('http://local/', { headers: id ? { 'x-request-id': id } : {} });
  assertEqual(requestIdOf(req('support-ticket-12345')), 'support-ticket-12345', 'kept');
  const injected = requestIdOf(req('abc\r\nx-evil: 1'.replace(/[\r\n]/g, ' ')));
  assert(/^[0-9a-f-]{36}$/.test(injected), `replaced: ${injected}`);
  assert(/^[0-9a-f-]{36}$/.test(requestIdOf(req(null))), 'generated when absent');
});

t.section('Functions on the local stack');

const stack = await startStack();
const raw = (name, init) => fetch(`${stack.appUrl}/api/${name}`, init);

await t.check('every payment function answers with the request id it logged under', async () => {
  const { result, lines } = await captured(() =>
    raw('create-order', { method: 'POST', headers: { 'x-request-id': 'trace-create-0001', 'content-type': 'application/json' }, body: '{}' }),
  );
  assertEqual(result.headers.get('x-request-id'), 'trace-create-0001', 'response header');
  const line = lines.find((l) => l.fn === 'create-order');
  assertEqual([line?.requestId, line?.event, line?.level], ['trace-create-0001', 'auth.refused', 'warn'], 'log line');
  for (const name of ['verify-payment', 'razorpay-webhook']) {
    const response = await raw(name, { method: 'POST', body: '{}' });
    assert(/^[0-9a-f-]{36}$/.test(response.headers.get('x-request-id') ?? ''), `${name} carries an id`);
  }
});

await t.check('a forged webhook is logged as a security event, without the signature or the body', async () => {
  const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', email: 'victim@example.test' } } } });
  const { result, lines } = await captured(() =>
    raw('razorpay-webhook', { method: 'POST', headers: { 'x-razorpay-signature': 'f'.repeat(64), 'x-razorpay-event-id': 'evt_forged' }, body }),
  );
  assertEqual(result.status, 401, 'refused');
  const line = lines.find((l) => l.event === 'webhook.rejected');
  assertEqual([line?.level, line?.reason], ['warn', 'bad-signature'], 'event');
  const text = JSON.stringify(lines);
  assert(!text.includes('ffffffff') && !text.includes('victim@example.test'), 'signature or body leaked into the log');
});

await t.check('a forged payment signature from a signed-in customer is logged with ids only', async () => {
  const customer = await signUp(stack);
  const { result, lines } = await captured(() =>
    callFunction(stack, 'verify-payment', {
      token: customer.token,
      body: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: '0'.repeat(64) },
    }),
  );
  assertEqual(result.status, 400, 'refused');
  const line = lines.find((l) => l.event === 'payment.signature-invalid');
  assertEqual([line?.userId, line?.razorpayOrderId, line?.razorpayPaymentId], [customer.userId, 'order_x', 'pay_x'], 'ids');
  assert(!JSON.stringify(lines).includes('0000000000'), 'the signature leaked into the log');
});

await t.check('a purchase with a tampered amount, then the real payment, logs only structured events', async () => {
  const customer = await signUp(stack);
  const { lines, raw } = await captured(async () => {
    const created = await callFunction(stack, 'create-order', {
      token: customer.token,
      body: { orderType: 'digitalUpgrade', planId: 'business' },
    });
    const short = stack.sim.pay({ order_id: created.body.order_id, amount: 100 });
    assertEqual((await callFunction(stack, 'verify-payment', { token: customer.token, body: short })).status, 409, 'underpayment');
    const paid = stack.sim.pay({ order_id: created.body.order_id });
    assertEqual((await callFunction(stack, 'verify-payment', { token: customer.token, body: paid })).status, 200, 'payment');
    await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  });
  assertEqual(raw.filter((text) => !text.startsWith('{"ts"')), [], 'free-text log lines');
  const events = lines.map((line) => line.event);
  for (const event of ['order.created', 'payment.amount-mismatch', 'payment.not-confirmed', 'payment.verified', 'order.fulfilled', 'webhook.processed']) {
    assert(events.includes(event), `no ${event} in: ${events.join(', ')}`);
  }
  const mismatch = lines.find((line) => line.event === 'payment.amount-mismatch');
  assertEqual([mismatch.fn, mismatch.paid, mismatch.expected, mismatch.level], ['verify-payment', 100, 29900, 'warn'], 'mismatch event');
  const fulfilled = lines.find((line) => line.event === 'order.fulfilled');
  const verified = lines.find((line) => line.event === 'payment.verified');
  assertEqual(fulfilled.requestId, verified.requestId, 'fulfilment logs under the request that triggered it');
  // One order, one name: every event carries the ST- number that support staff and customers see.
  const orderIds = [...new Set(lines.filter((line) => 'orderId' in line).map((line) => line.orderId))];
  assertEqual(orderIds.length, 1, `order ids in the log: ${orderIds.join(', ')}`);
  assert(/^ST-/.test(orderIds[0]), `the order number: ${orderIds[0]}`);
});

await t.check('/api/health: ok with every setting present; ?deep=1 also asks the database', async () => {
  const shallow = await raw('health');
  assertEqual([shallow.status, (await shallow.json()).status], [200, 'ok'], 'shallow');
  const deep = await raw('health?deep=1');
  const body = await deep.json();
  assertEqual([deep.status, body.status, body.checks.database], [200, 'ok', 'ok'], 'deep');
});

await t.check('/api/health: a missing setting answers 503 "degraded" without naming it', async () => {
  const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  try {
    const { result, lines } = await captured(() => raw('health?deep=1'));
    const text = await result.text();
    assertEqual(result.status, 503, 'status');
    assertEqual(JSON.parse(text).checks, { config: 'missing', database: 'skipped' }, 'checks');
    assert(!/RAZORPAY|SECRET|SUPABASE/i.test(text), `response names a setting: ${text}`);
    const line = lines.find((l) => l.event === 'health.config-missing');
    assertEqual(line?.settings, ['RAZORPAY_WEBHOOK_SECRET'], 'the name goes to the log');
  } finally {
    process.env.RAZORPAY_WEBHOOK_SECRET = saved;
  }
});

await t.check('/api/health refuses other methods', async () => {
  assertEqual((await raw('health', { method: 'POST' })).status, 405, 'POST');
});

const ok = t.finish();
await stack.close();
process.exit(ok ? 0 : 1);
