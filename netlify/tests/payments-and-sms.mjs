// Checks the real-money and order-text logic without touching Razorpay or an
// SMS provider: `fetch` is replaced by a scripted fake, the database by a small
// in-memory stand-in.
//
//   node netlify/tests/payments-and-sms.mjs
import assert from 'node:assert/strict';

process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcd';
process.env.RAZORPAY_KEY_SECRET = 'test-secret-not-real';

const { confirmPayment, PaymentNotConfirmedError, assertLiveKeysAllowed, keyMode } = await import('../lib/razorpay.mjs');
const { sendOrderConfirmation } = await import('../lib/orderMessages.mjs');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${error.message}`);
  }
}

/** Replaces fetch with a list of [matcher, response] pairs; records calls. */
function fakeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body });
    for (const [match, reply] of routes) {
      if (match(String(url), init)) {
        const { status = 200, body } = typeof reply === 'function' ? reply(String(url), init) : reply;
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('{}', { status: 404 });
  };
  return calls;
}

const payment = (over = {}) => ({ id: 'pay_1', order_id: 'order_1', amount: 89900, currency: 'INR', status: 'captured', ...over });

console.log('\n=== Razorpay: money is confirmed with Razorpay, not taken on trust ===');

await test('a captured payment of the exact amount is accepted', async () => {
  fakeFetch([[(u) => u.endsWith('/payments/pay_1'), { body: payment() }]]);
  const p = await confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 });
  assert.equal(p.status, 'captured');
});

await test('an authorised payment is captured before it is accepted', async () => {
  const calls = fakeFetch([
    [(u, i) => u.endsWith('/payments/pay_1/capture') && i.method === 'POST', { body: payment({ status: 'captured' }) }],
    [(u) => u.endsWith('/payments/pay_1'), { body: payment({ status: 'authorized' }) }],
  ]);
  const p = await confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 });
  assert.equal(p.status, 'captured');
  const capture = calls.find((c) => c.url.endsWith('/capture'));
  assert.ok(capture, 'capture was called');
  assert.deepEqual(JSON.parse(capture.body), { amount: 89900, currency: 'INR' });
});

await test('a payment for less than the order is refused', async () => {
  fakeFetch([[(u) => u.endsWith('/payments/pay_1'), { body: payment({ amount: 100 }) }]]);
  await assert.rejects(confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 }), PaymentNotConfirmedError);
});

await test('a payment made for a different order is refused', async () => {
  fakeFetch([[(u) => u.endsWith('/payments/pay_1'), { body: payment({ order_id: 'order_other' }) }]]);
  await assert.rejects(confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 }), PaymentNotConfirmedError);
});

await test('a payment in another currency is refused', async () => {
  fakeFetch([[(u) => u.endsWith('/payments/pay_1'), { body: payment({ currency: 'USD' }) }]]);
  await assert.rejects(confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 }), PaymentNotConfirmedError);
});

await test('a failed payment is refused', async () => {
  fakeFetch([[(u) => u.endsWith('/payments/pay_1'), { body: payment({ status: 'failed' }) }]]);
  await assert.rejects(confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 }), PaymentNotConfirmedError);
});

await test('Razorpay being unreachable is not treated as paid', async () => {
  fakeFetch([[(u) => u.includes('/payments/'), { status: 503, body: {} }]]);
  await assert.rejects(confirmPayment({ paymentId: 'pay_1', razorpayOrderId: 'order_1', amountInPaise: 89900 }), PaymentNotConfirmedError);
});

await test('live keys are refused on localhost, allowed on a real host', async () => {
  assert.equal(keyMode('rzp_live_abc'), 'live');
  process.env.RAZORPAY_KEY_ID = 'rzp_live_1234567890abcd';
  assert.throws(() => assertLiveKeysAllowed(new Request('http://localhost:5173/api/create-order')), PaymentNotConfirmedError);
  assert.doesNotThrow(() => assertLiveKeysAllowed(new Request('https://shygontech.com/api/create-order')));
  process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcd';
  assert.doesNotThrow(() => assertLiveKeysAllowed(new Request('http://localhost:5173/api/create-order')));
});

const { default: paymentMode } = await import('../functions/payment-mode.mjs');

await test('payment-mode reports the server key mode and never a key', async () => {
  const ask = async () => {
    const response = await paymentMode(new Request('https://shygontech.com/api/payment-mode'));
    const text = await response.text();
    assert.ok(!text.includes('rzp_'), 'no key id in the response');
    assert.ok(!text.includes(process.env.RAZORPAY_KEY_SECRET ?? '\u0000'), 'no secret in the response');
    return JSON.parse(text).mode;
  };
  process.env.RAZORPAY_KEY_ID = 'rzp_live_1234567890abcd';
  assert.equal(await ask(), 'live');
  process.env.RAZORPAY_KEY_ID = 'rzp_test_1234567890abcd';
  assert.equal(await ask(), 'test');
  const secret = process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_KEY_SECRET;
  assert.equal(await ask(), 'unconfigured');
  process.env.RAZORPAY_KEY_SECRET = secret;
  const post = await paymentMode(new Request('https://shygontech.com/api/payment-mode', { method: 'POST' }));
  assert.equal(post.status, 405);
});

console.log('\n=== Order confirmation text: once per order, to the checkout number ===');

/** A stand-in for the few supabase-js calls orderMessages makes. */
function fakeAdmin(order, profilePhone = null) {
  const state = { ...order, updates: [] };
  const admin = {
    state,
    from(table) {
      const q = { patch: null, isNull: null };
      // Every builder method returns the chain; awaiting it runs the query,
      // as supabase-js does.
      const run = () => {
        if (table !== 'orders' || !q.patch) return { data: null, error: null };
        // The claim: update ... where id = ? and confirmation_sms_at is null
        if (q.isNull === 'confirmation_sms_at' && state.confirmation_sms_at) return { data: [], error: null };
        Object.assign(state, q.patch);
        state.updates.push(q.patch);
        return { data: [state], error: null };
      };
      const chain = {
        update(patch) { q.patch = patch; return chain; },
        select() { return chain; },
        eq() { return chain; },
        is(column) { q.isNull = column; return chain; },
        maybeSingle() { return Promise.resolve({ data: { phone: profilePhone }, error: null }); },
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject); },
      };
      return chain;
    },
  };
  return admin;
}

const baseOrder = { id: 'o1', order_id: 'ST-TEST-0001', user_id: 'u1', amount: 899, amount_in_paise: 89900, shipping_phone: '9876543210', confirmation_sms_at: null };

await test('sends one text to the checkout number (Twilio) and records it', async () => {
  process.env.SMS_PROVIDER = 'twilio';
  process.env.TWILIO_ACCOUNT_SID = 'AC_test';
  process.env.TWILIO_AUTH_TOKEN = 'token_test';
  process.env.TWILIO_FROM = '+15005550006';
  const calls = fakeFetch([[(u) => u.includes('api.twilio.com'), { status: 201, body: { sid: 'SM1' } }]]);
  const admin = fakeAdmin(baseOrder);
  const result = await sendOrderConfirmation(admin, 'o1');
  assert.equal(result.sent, true);
  assert.equal(admin.state.confirmation_sms_status, 'sent');
  const sent = new URLSearchParams(calls[0].body);
  assert.equal(sent.get('To'), '+919876543210');
  assert.match(sent.get('Body'), /ST-TEST-0001/);
  assert.match(sent.get('Body'), /Rs 899/);
});

await test('a second fulfilment of the same order sends nothing', async () => {
  const calls = fakeFetch([[(u) => u.includes('api.twilio.com'), { status: 201, body: {} }]]);
  const admin = fakeAdmin({ ...baseOrder, confirmation_sms_at: '2026-09-29T10:00:00Z' });
  const result = await sendOrderConfirmation(admin, 'o1');
  assert.equal(result.sent, false);
  assert.equal(calls.length, 0);
});

await test('MSG91 uses the order template with order number and amount', async () => {
  process.env.SMS_PROVIDER = 'msg91';
  process.env.MSG91_AUTH_KEY = 'authkey_test';
  process.env.MSG91_ORDER_TEMPLATE_ID = 'tmpl_order';
  const calls = fakeFetch([[(u) => u.includes('control.msg91.com'), { body: { type: 'success' } }]]);
  const admin = fakeAdmin(baseOrder);
  await sendOrderConfirmation(admin, 'o1');
  const body = JSON.parse(calls[0].body);
  assert.equal(body.template_id, 'tmpl_order');
  assert.deepEqual(body.recipients[0], { mobiles: '919876543210', order: 'ST-TEST-0001', amount: '899' });
});

await test('no provider set: the order is marked not_configured, nothing thrown', async () => {
  process.env.SMS_PROVIDER = '';
  fakeFetch([]);
  const admin = fakeAdmin(baseOrder);
  const result = await sendOrderConfirmation(admin, 'o1');
  assert.equal(result.sent, false);
  assert.equal(admin.state.confirmation_sms_status, 'not_configured');
});

await test('no phone on the order: falls back to the account number', async () => {
  process.env.SMS_PROVIDER = 'twilio';
  const calls = fakeFetch([[(u) => u.includes('api.twilio.com'), { status: 201, body: {} }]]);
  const admin = fakeAdmin({ ...baseOrder, shipping_phone: null }, '+91 98450 12345');
  await sendOrderConfirmation(admin, 'o1');
  assert.equal(new URLSearchParams(calls[0].body).get('To'), '+919845012345');
});

await test('the provider refusing: marked failed, nothing thrown', async () => {
  fakeFetch([[(u) => u.includes('api.twilio.com'), { status: 400, body: {} }]]);
  const admin = fakeAdmin(baseOrder);
  const result = await sendOrderConfirmation(admin, 'o1');
  assert.equal(result.sent, false);
  assert.equal(admin.state.confirmation_sms_status, 'failed');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
