// The payment chain, end to end on the local stack (V6 Stage 3; V6-017/V6-084, V6-070).
//
//   checkout (create-order) → Razorpay (stand-in) → verify-payment / webhook →
//   order → fulfilment → entitlement → Tap → notification
//
// The real handlers in netlify/functions run against the real schema
// (baseline + 020 onward) through the local gateway; Razorpay is the
// stand-in in supabase/local/razorpay-sim.mjs. Every assertion reads the
// database itself: backend state is the truth, never a response body alone.
//
//   node netlify/tests/payment-chain.mjs
import { startStack } from '../../supabase/local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, legacyAccount, signUp } from '../../supabase/local/testkit.mjs';

const stack = await startStack();
const t = createHarness('Payment chain on the local stack (real handlers, real schema)');
const sql = async (text, params) => (await stack.query(text, params)).rows;

const orderRow = async (razorpayOrderId) =>
  (await sql(`SELECT * FROM public.orders WHERE razorpay_order_id = $1`, [razorpayOrderId]))[0];
const entitlementsOf = async (userId) =>
  (await sql(`SELECT type, key, is_active FROM public.entitlements WHERE user_id = $1 ORDER BY type, key`, [userId])).map(
    (e) => `${e.type}:${e.key}${e.is_active ? '' : '(inactive)'}`,
  );
const tapsOf = (userId) => sql(`SELECT * FROM public.tap_profiles WHERE user_id = $1`, [userId]);
const notificationsOf = (userId) => sql(`SELECT title FROM public.notifications WHERE user_id = $1 ORDER BY created_at`, [userId]);
const priceOf = async (sku) => (await sql(`SELECT price_in_paise FROM public.products WHERE sku = $1`, [sku]))[0].price_in_paise;

/** create-order for a digital experience; returns the response and the Razorpay order id. */
async function buyExperience(customer, planId) {
  const created = await callFunction(stack, 'create-order', { token: customer.token, body: { orderType: 'digitalUpgrade', planId } });
  return { created, razorpayOrderId: created.body?.order_id };
}

const verify = (customer, fields) => callFunction(stack, 'verify-payment', { token: customer.token, body: fields });

// ---------------------------------------------------------------------------
t.section('Checkout: the server prices and refuses');

await t.check('create-order refuses a caller who is not signed in (401)', async () => {
  const response = await callFunction(stack, 'create-order', { body: { orderType: 'digitalUpgrade', planId: 'business' } });
  assertEqual(response.status, 401, 'status');
});

await t.check('V6-070: a physical card cannot be bought in the release candidate', async () => {
  const customer = await signUp(stack);
  const response = await callFunction(stack, 'create-order', {
    token: customer.token,
    body: {
      orderType: 'physical', productId: 'business', material: 'metal', tier: 'premium', quantity: 1,
      shipping: { name: 'A Customer', phone: '9876543210', address: '1 Test Street', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    },
  });
  assert(response.status === 409, `expected 409, got ${response.status} ${JSON.stringify(response.body)}`);
  const orders = await sql(`SELECT count(*)::int AS n FROM public.orders WHERE user_id = $1`, [customer.userId]);
  assertEqual(orders[0].n, 0, 'orders written');
  assertEqual(stack.sim.orders.size, 0, 'Razorpay orders created');
  return response.body.error;
});

await t.check('Essential is never sold, and retired or unknown experiences are refused', async () => {
  const customer = await signUp(stack);
  for (const planId of ['essential', 'pro', 'custom', 'nonsense']) {
    const { created } = await buyExperience(customer, planId);
    assert(created.status === 400, `${planId}: expected 400, got ${created.status}`);
  }
});

await t.check('the amount comes from the products table, whatever the browser sends', async () => {
  const customer = await signUp(stack);
  const created = await callFunction(stack, 'create-order', {
    token: customer.token,
    body: { orderType: 'digitalUpgrade', planId: 'business', amount: 100, price_in_paise: 100 },
  });
  assertEqual(created.status, 200, 'status');
  assertEqual(created.body.amount, await priceOf('plan-business'), 'charged amount');
  const order = await orderRow(created.body.order_id);
  assertEqual(order.amount_in_paise, await priceOf('plan-business'), 'stored amount');
  assertEqual([order.payment_status, order.fulfillment_status], ['pending', 'pending'], 'initial state');
  assertEqual(stack.sim.orders.get(created.body.order_id).amount, order.amount_in_paise, 'Razorpay order amount');
});

await t.check('V6-031: order numbers are ST-<time>-<4 digits> and do not repeat', async () => {
  const customer = await signUp(stack);
  const ids = new Set();
  for (const planId of ['business', 'premium', 'goat']) {
    const { created } = await buyExperience(customer, planId);
    assert(/^ST-[0-9A-Z]+-\d{4}$/.test(created.body.shygonOrderId), `format: ${created.body.shygonOrderId}`);
    ids.add(created.body.shygonOrderId);
  }
  assertEqual(ids.size, 3, 'distinct order numbers');
});

// ---------------------------------------------------------------------------
t.section('Success paths: first-time customer');

await t.check('browser verify first, then the webhook: paid, fulfilled once, draft Tap, entitlement', async () => {
  const customer = await signUp(stack, { name: 'First Buyer' });
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const verified = await verify(customer, paid);
  assertEqual([verified.status, verified.body.success, verified.body.alreadyProcessed], [200, true, false], 'verify');

  const order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['paid', 'fulfilled'], 'order state');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business'], 'entitlements');
  const taps = await tapsOf(customer.userId);
  assertEqual(taps.length, 1, 'Taps');
  assertEqual([taps[0].published, taps[0].status], [false, 'draft'], 'Tap is a draft (D-U4)');
  const customerRow = await sql(`SELECT id FROM public.customers WHERE user_id = $1`, [customer.userId]);
  assertEqual(taps[0].customer_id, customerRow[0].id, 'Tap customer_id is the customers row (C), not the user id');
  const payments = await sql(`SELECT status, amount_in_paise FROM public.payments WHERE order_id = $1`, [order.id]);
  assertEqual(payments.map((p) => [p.status, p.amount_in_paise]), [['paid', order.amount_in_paise]], 'payment record');

  const webhook = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([webhook.status, webhook.body.newlyFulfilled], [200, false], 'webhook after verify');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business'], 'entitlements after webhook');
  assertEqual((await tapsOf(customer.userId)).length, 1, 'Taps after webhook');
  const titles = (await notificationsOf(customer.userId)).map((n) => n.title);
  assertEqual(titles.filter((title) => title === 'Your SHYGON Tap draft is ready').length, 1, 'draft notification sent once');
});

await t.check('webhook first (customer closed the tab), then verify: fulfilled once', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'premium');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const webhook = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([webhook.status, webhook.body.newlyFulfilled], [200, true], 'webhook');
  const verified = await verify(customer, paid);
  assertEqual([verified.status, verified.body.alreadyProcessed], [200, true], 'verify after webhook');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:premium'], 'entitlements');
  assertEqual((await tapsOf(customer.userId)).length, 1, 'Taps');
});

await t.check('verify and webhook at the same moment: side effects happen exactly once', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'goat');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const [verified, webhook] = await Promise.all([verify(customer, paid), stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id)]);
  assertEqual([verified.status, webhook.status], [200, 200], 'statuses');
  const winners = [verified.body.alreadyProcessed === false, webhook.body.newlyFulfilled === true].filter(Boolean).length;
  assertEqual(winners, 1, 'exactly one path fulfilled');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:goat'], 'entitlements');
  assertEqual((await notificationsOf(customer.userId)).filter((n) => n.title === 'Your SHYGON Tap draft is ready').length, 1, 'one notification');
});

await t.check('an account with no customers row (pre-trigger shape, M0.3 I-1) is provisioned on payment', async () => {
  const customer = await legacyAccount(stack);
  const before = await sql(`SELECT count(*)::int AS n FROM public.customers WHERE user_id = $1`, [customer.userId]);
  assertEqual(before[0].n, 0, 'customers rows before');
  const { created, razorpayOrderId } = await buyExperience(customer, 'business');
  assertEqual(created.status, 200, 'create-order');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const webhook = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([webhook.status, webhook.body.newlyFulfilled], [200, true], 'webhook');
  const taps = await tapsOf(customer.userId);
  const customers = await sql(`SELECT id FROM public.customers WHERE user_id = $1`, [customer.userId]);
  assertEqual(customers.length, 1, 'customers row created');
  assertEqual([taps.length, taps[0]?.customer_id], [1, customers[0].id], 'Tap linked to the new customers row');
});

// ---------------------------------------------------------------------------
t.section('Returning customer');

await t.check('a customer with a published Tap buys an upgrade: same Tap, still published, window not reopened', async () => {
  const customer = await signUp(stack);
  const first = await buyExperience(customer, 'business');
  await verify(customer, stack.sim.pay({ order_id: first.razorpayOrderId }));
  const [tap] = await tapsOf(customer.userId);
  await sql(`UPDATE public.tap_profiles SET published = true, status = 'active', published_at = now() WHERE id = $1`, [tap.id]);
  const windowBefore = (await tapsOf(customer.userId))[0].edit_window_started_at;

  const second = await buyExperience(customer, 'premium');
  assertEqual(second.created.status, 200, 'create-order');
  const verified = await verify(customer, stack.sim.pay({ order_id: second.razorpayOrderId }));
  assertEqual(verified.status, 200, 'verify');
  const taps = await tapsOf(customer.userId);
  assertEqual(taps.map((x) => [x.id, x.published, x.status]), [[tap.id, true, 'active']], 'the same, published Tap');
  assertEqual(String(taps[0].edit_window_started_at), String(windowBefore), 'edit window unchanged');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business', 'digital_plan:premium'], 'entitlements');
});

await t.check('buying an experience already owned (or a lower one) is refused with 409', async () => {
  const customer = await signUp(stack);
  const first = await buyExperience(customer, 'premium');
  await verify(customer, stack.sim.pay({ order_id: first.razorpayOrderId }));
  for (const planId of ['premium', 'business']) {
    const { created } = await buyExperience(customer, planId);
    assertEqual(created.status, 409, `${planId}`);
  }
});

// ---------------------------------------------------------------------------
t.section('Failure, cancellation and retry');

await t.check('a cancelled checkout charges nothing and grants nothing', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  assertEqual(stack.sim.pay({ order_id: razorpayOrderId, outcome: 'dismiss' }), { dismissed: true }, 'checkout result');
  const order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['pending', 'pending'], 'order state');
  assertEqual(await entitlementsOf(customer.userId), [], 'entitlements');
  assertEqual((await tapsOf(customer.userId)).length, 0, 'Taps');
});

await t.check('a failed payment is recorded as failed; a retry on the same order then succeeds', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const failed = stack.sim.pay({ order_id: razorpayOrderId, outcome: 'failure' });
  assert(failed.error, 'checkout reports the failure');
  const webhook = await stack.sim.sendWebhook('payment.failed', failed.payment_id);
  assertEqual(webhook.status, 200, 'failure webhook');
  let order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['failed', 'pending'], 'after failure');
  const failedPayment = await sql(`SELECT status FROM public.payments WHERE provider_payment_id = $1`, [failed.payment_id]);
  assertEqual(failedPayment.map((p) => p.status), ['failed'], 'failed payment recorded');
  assertEqual(await entitlementsOf(customer.userId), [], 'nothing granted');

  const retried = await verify(customer, stack.sim.pay({ order_id: razorpayOrderId }));
  assertEqual([retried.status, retried.body.alreadyProcessed], [200, false], 'retry verify');
  order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['paid', 'fulfilled'], 'after retry');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business'], 'granted once');
});

await t.check('a late payment.failed for an order already paid does not un-pay it', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const attempt = stack.sim.pay({ order_id: razorpayOrderId, outcome: 'failure' });
  await verify(customer, stack.sim.pay({ order_id: razorpayOrderId }));
  await stack.sim.sendWebhook('payment.failed', attempt.payment_id);
  const order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['paid', 'fulfilled'], 'order state');
});

await t.check('an authorised (not captured) payment is captured by verify, then fulfilled', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId, capture: 'manual' });
  assertEqual(stack.sim.payments.get(paid.razorpay_payment_id).status, 'authorized', 'starts authorised');
  const verified = await verify(customer, paid);
  assertEqual(verified.status, 200, 'verify');
  assertEqual(stack.sim.payments.get(paid.razorpay_payment_id).status, 'captured', 'captured by the server');
  assertEqual((await orderRow(razorpayOrderId)).fulfillment_status, 'fulfilled', 'fulfilled');
});

await t.check('payment.authorized webhook captures the money; payment.captured then fulfils', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId, capture: 'manual' });
  const authorised = await stack.sim.sendWebhook('payment.authorized', paid.razorpay_payment_id);
  assertEqual([authorised.status, authorised.body.captured], [200, true], 'capture on authorised');
  assertEqual((await orderRow(razorpayOrderId)).fulfillment_status, 'pending', 'not fulfilled by the authorisation alone');
  const captured = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([captured.status, captured.body.newlyFulfilled], [200, true], 'fulfilled on capture');
});

await t.check('fulfilment that fails part-way is left retryable, and the redelivered webhook completes it', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'goat');
  // One-shot fault: the first entitlement write for this user fails. A
  // sequence counts the attempts because nextval() survives the rollback the
  // fault causes (a DELETE of a flag row would be rolled back with it).
  await sql(`CREATE TABLE public.zz_fault_target (user_id uuid PRIMARY KEY)`);
  await sql(`INSERT INTO public.zz_fault_target VALUES ($1)`, [customer.userId]);
  await sql(`CREATE SEQUENCE public.zz_fault_attempts`);
  await sql(`
    CREATE FUNCTION public.zz_fault() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM public.zz_fault_target WHERE user_id = NEW.user_id)
         AND nextval('public.zz_fault_attempts') = 1 THEN
        RAISE EXCEPTION 'injected fault';
      END IF;
      RETURN NEW;
    END $$`);
  await sql(`CREATE TRIGGER zz_fault BEFORE INSERT ON public.entitlements FOR EACH ROW EXECUTE FUNCTION public.zz_fault()`);
  try {
    const paid = stack.sim.pay({ order_id: razorpayOrderId });
    const first = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
    assertEqual(first.status, 500, 'first delivery asks Razorpay to retry');
    let order = await orderRow(razorpayOrderId);
    assertEqual([order.payment_status, order.fulfillment_status], ['paid', 'retry'], 'left retryable');
    const ledger = await sql(`SELECT count(*)::int AS n FROM public.webhook_events WHERE event_id = $1`, [first.eventId]);
    assertEqual(ledger[0].n, 0, 'event claim released for the redelivery');

    const redelivered = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id, { eventId: first.eventId });
    assertEqual([redelivered.status, redelivered.body.newlyFulfilled], [200, true], 'redelivery fulfils');
    order = await orderRow(razorpayOrderId);
    assertEqual(order.fulfillment_status, 'fulfilled', 'fulfilled');
    assertEqual(await entitlementsOf(customer.userId), ['digital_plan:goat'], 'entitlements');
  } finally {
    await sql(`DROP TRIGGER IF EXISTS zz_fault ON public.entitlements`);
    await sql(`DROP FUNCTION IF EXISTS public.zz_fault()`);
    await sql(`DROP TABLE IF EXISTS public.zz_fault_target`);
    await sql(`DROP SEQUENCE IF EXISTS public.zz_fault_attempts`);
  }
});

// ---------------------------------------------------------------------------
t.section('Webhook security and idempotency');

await t.check('the same webhook delivered twice is processed once (event ledger)', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const first = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  const second = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id, { eventId: first.eventId });
  assertEqual([first.status, first.body.newlyFulfilled], [200, true], 'first');
  assertEqual([second.status, second.body.message], [200, 'Event already processed'], 'second');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business'], 'entitlements');
});

await t.check('a replayed webhook body under a new event id changes nothing (fulfilment is idempotent)', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  const body = stack.sim.eventBody('payment.captured', paid.razorpay_payment_id);
  const replay = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id, { body });
  assertEqual([replay.status, replay.body.newlyFulfilled], [200, false], 'replay');
  assertEqual(await entitlementsOf(customer.userId), ['digital_plan:business'], 'entitlements');
  const payments = await sql(`SELECT count(*)::int AS n FROM public.payments WHERE provider_payment_id = $1`, [paid.razorpay_payment_id]);
  assertEqual(payments[0].n, 1, 'one payment record');
});

await t.check('webhooks with a wrong or missing signature are refused (401) and change nothing', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const forged = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id, { signature: 'invalid' });
  const unsigned = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id, { signature: 'none' });
  assertEqual([forged.status, unsigned.status], [401, 401], 'statuses');
  const order = await orderRow(razorpayOrderId);
  assertEqual([order.payment_status, order.fulfillment_status], ['pending', 'pending'], 'order untouched');
  assertEqual(await entitlementsOf(customer.userId), [], 'nothing granted');
});

await t.check('a webhook whose amount does not match the order is held for review, not fulfilled', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'premium');
  const paid = stack.sim.pay({ order_id: razorpayOrderId, amount: 100 });
  const webhook = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([webhook.status, webhook.body.message], [200, 'Amount mismatch; held for review'], 'webhook');
  assertEqual((await orderRow(razorpayOrderId)).fulfillment_status, 'pending', 'not fulfilled');
  const alerts = await sql(
    `SELECT severity FROM public.admin_notifications WHERE metadata->>'razorpay_order_id' = $1`,
    [razorpayOrderId],
  );
  assertEqual(alerts.map((a) => a.severity), ['critical'], 'admin alerted');
});

// ---------------------------------------------------------------------------
t.section('Browser verification security');

await t.check('verify-payment refuses a forged signature (400) and changes nothing', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const forged = await verify(customer, { ...paid, razorpay_signature: '0'.repeat(64) });
  assertEqual(forged.status, 400, 'status');
  assertEqual((await orderRow(razorpayOrderId)).payment_status, 'pending', 'order untouched');
});

await t.check("verify-payment refuses another customer's valid payment (404)", async () => {
  const owner = await signUp(stack);
  const intruder = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(owner, 'business');
  const paid = stack.sim.pay({ order_id: razorpayOrderId });
  const response = await verify(intruder, paid);
  assertEqual(response.status, 404, 'status');
  assertEqual(await entitlementsOf(intruder.userId), [], 'intruder granted nothing');
  assertEqual((await orderRow(razorpayOrderId)).payment_status, 'pending', 'order untouched');
});

await t.check('verify-payment refuses a payment for less than the order (Razorpay is asked)', async () => {
  const customer = await signUp(stack);
  const { razorpayOrderId } = await buyExperience(customer, 'premium');
  const paid = stack.sim.pay({ order_id: razorpayOrderId, amount: 100 });
  const response = await verify(customer, paid);
  assertEqual(response.status, 409, 'status');
  assertEqual((await orderRow(razorpayOrderId)).fulfillment_status, 'pending', 'not fulfilled');
});

await t.check('verify-payment requires a signed-in caller (401)', async () => {
  const response = await callFunction(stack, 'verify-payment', { body: { razorpay_order_id: 'order_x', razorpay_payment_id: 'pay_x', razorpay_signature: 'x' } });
  assertEqual(response.status, 401, 'status');
});

// ---------------------------------------------------------------------------
t.section('Add-ons and the Customization Pass');

await t.check('add-ons: priced by the server, granted under the key the Tap renders, never bought twice', async () => {
  const customer = await signUp(stack);
  const created = await callFunction(stack, 'create-order', {
    token: customer.token,
    body: { orderType: 'customization', customizationSkus: ['addon-whatsapp', 'addon-website', 'addon-whatsapp'], amount: 100 },
  });
  assertEqual(created.status, 200, 'status');
  const expected = (await priceOf('addon-whatsapp')) + (await priceOf('addon-website'));
  assertEqual(created.body.amount, expected, 'charged amount (duplicate collapsed, browser amount ignored)');
  const paid = stack.sim.pay({ order_id: created.body.order_id });
  const verified = await verify(customer, paid);
  assertEqual([verified.status, verified.body.success], [200, true], 'verify');
  assertEqual(await entitlementsOf(customer.userId), ['customization:website', 'customization:whatsapp'], 'entitlements');
  assertEqual((await tapsOf(customer.userId)).length, 1, 'Taps');
  const again = await callFunction(stack, 'create-order', {
    token: customer.token,
    body: { orderType: 'customization', customizationSkus: ['addon-whatsapp'] },
  });
  assertEqual(again.status, 409, 'buying an add-on already owned');
});

await t.check('the add-on path sells only active add-ons: no experiences, passes, delisted or unknown items', async () => {
  const customer = await signUp(stack);
  const tooMany = Array.from({ length: 21 }, (_, i) => `addon-x${i}`);
  for (const skus of [['plan-goat'], ['pass-customization'], ['addon-gallery'], ['addon-nonsense'], [], tooMany]) {
    const response = await callFunction(stack, 'create-order', {
      token: customer.token,
      body: { orderType: 'customization', customizationSkus: skus },
    });
    assert(response.status === 400, `${JSON.stringify(skus).slice(0, 40)}: expected 400, got ${response.status}`);
  }
  const orders = await sql(`SELECT count(*)::int AS n FROM public.orders WHERE user_id = $1`, [customer.userId]);
  assertEqual(orders[0].n, 0, 'orders written');
});

await t.check('the Customization Pass grants editing only, never an experience, and is bought once', async () => {
  const customer = await signUp(stack);
  const created = await callFunction(stack, 'create-order', { token: customer.token, body: { orderType: 'lifetimeCustomization' } });
  assertEqual([created.status, created.body.amount], [200, await priceOf('pass-customization')], 'order');
  const paid = stack.sim.pay({ order_id: created.body.order_id });
  const webhook = await stack.sim.sendWebhook('payment.captured', paid.razorpay_payment_id);
  assertEqual([webhook.status, webhook.body.newlyFulfilled], [200, true], 'webhook');
  assertEqual(await entitlementsOf(customer.userId), ['lifetime:lifetime'], 'entitlements');
  const again = await callFunction(stack, 'create-order', { token: customer.token, body: { orderType: 'lifetimeCustomization' } });
  assertEqual(again.status, 409, 'a second Pass');
});

// ---------------------------------------------------------------------------
t.section('Consistency across everything above');

await t.check('every active entitlement traces to a paid, fulfilled order that bought it', async () => {
  const orphans = await sql(`
    SELECT e.user_id, e.type, e.key FROM public.entitlements e
    LEFT JOIN public.orders o ON o.id = e.source_order_id
    WHERE e.is_active AND (o.id IS NULL OR o.payment_status <> 'paid' OR o.fulfillment_status <> 'fulfilled' OR o.user_id <> e.user_id)`);
  assertEqual(orphans, [], 'entitlements without a paid order');
  const unfulfilledPaid = await sql(`SELECT order_id FROM public.orders WHERE payment_status = 'paid' AND fulfillment_status <> 'fulfilled'`);
  assertEqual(unfulfilledPaid, [], 'paid but not fulfilled');
});

await t.check('every customer with a paid order has exactly one Tap, and no one else has any', async () => {
  const rows = await sql(`
    SELECT u.id,
           EXISTS (SELECT 1 FROM public.orders o WHERE o.user_id = u.id AND o.payment_status = 'paid') AS paid,
           (SELECT count(*)::int FROM public.tap_profiles t WHERE t.user_id = u.id) AS taps
    FROM auth.users u`);
  const wrong = rows.filter((r) => (r.paid ? r.taps !== 1 : r.taps !== 0));
  assertEqual(wrong, [], 'customers with the wrong number of Taps');
  return `${rows.length} accounts checked`;
});

const ok = t.finish();
await stack.close();
process.exit(ok ? 0 : 1);
