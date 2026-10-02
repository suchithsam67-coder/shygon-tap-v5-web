import crypto from 'node:crypto';

/**
 * The purchase chain, end to end, against simulated Supabase and Razorpay:
 *
 *   create-order  ->  (Razorpay Checkout: the customer pays by card)
 *                 ->  verify-payment  and/or  razorpay-webhook  ->  fulfilment
 *
 * No real money moves and no real database is touched: `fetch` is replaced by
 * an in-memory PostgREST and a fake Razorpay orders API. What is proven is the
 * behaviour of OUR functions — that the browser cannot set a price, that
 * nothing is marked paid without a valid signature, that a replay does not pay
 * or issue twice, and that no card data is stored.
 *
 *   node netlify/tests/checkout-flow.mjs
 */

const SUPABASE = 'http://mock.supabase.test';
process.env.SUPABASE_URL = SUPABASE;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
delete process.env.EMAIL_PROVIDER;
delete process.env.RESEND_API_KEY;
delete process.env.SMTP_HOST;

const ALICE = '11111111-1111-4111-8111-111111111111';
const MALLORY = '22222222-2222-4222-8222-222222222222';
const TOKENS = { 'token-alice': ALICE, 'token-mallory': MALLORY };

// ------------------------------------------------------------ in-memory data
const db = {
  products: [
    { id: 'p1', sku: 'card-business-standard-pvc', name: 'Shygon Tap Business — PVC', price_in_paise: 39900, stock: 100, product_type: 'card', active: true },
    { id: 'p2', sku: 'delivery-standard', name: 'Delivery', price_in_paise: 4900, stock: null, product_type: 'delivery', active: true },
  ],
  entitlements: [],
  orders: [],
  order_items: [],
  payments: [],
  cards: [],
  tap_profiles: [],
  webhook_events: [],
  admin_notifications: [],
  profiles: [{ id: ALICE, full_name: 'Alice', email: 'alice@example.com' }],
  tax_settings: [{ id: true, enabled: true, rate_percent: 18, prices_include_tax: true, seller_state: 'Karnataka' }],
};
const razorpayOrders = [];
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function matches(row, params) {
  for (const [key, raw] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) continue;
    const value = row[key];
    if (raw.startsWith('eq.')) {
      if (String(value) !== raw.slice(3)) return false;
    } else if (raw.startsWith('neq.')) {
      if (String(value) === raw.slice(4)) return false;
    } else if (raw.startsWith('in.(')) {
      const list = raw.slice(4, -1).split(',').map((v) => v.replace(/^"|"$/g, ''));
      if (!list.includes(String(value))) return false;
    } else if (raw === 'is.null') {
      if (value !== null && value !== undefined) return false;
    }
  }
  return true;
}

function reply(body, status = 200, headers = {}) {
  return new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const RPC = {
  promo_evaluate: ({ p_code, p_subtotal }) =>
    p_code === 'DRAGON'
      ? { ok: true, code: 'DRAGON', percent: 30, discountInPaise: Math.floor((p_subtotal * 30) / 100) }
      : { ok: false, message: 'This promo code is not valid.' },
  promo_reserve: (args) => RPC.promo_evaluate(args),
  fulfil_card_stock: () => null,
  provision_tap_page: ({ p_user }) => {
    const id = uuid();
    db.tap_profiles.push({ id, user_id: p_user, slug: 'alice', edit_window_started_at: null });
    return id;
  },
  email_outbox_claim: () => [],
  orders_refund_from_webhook: ({ p_razorpay_payment_id, p_refund_id, p_amount, p_status }) => {
    const order = db.orders.find((o) => o.razorpay_payment_id === p_razorpay_payment_id);
    if (order && p_status === 'processed' && order.payment_status !== 'refunded') {
      Object.assign(order, { payment_status: 'refunded', refund_amount_in_paise: p_amount, razorpay_refund_id: p_refund_id });
    }
    return order?.id ?? null;
  },
};

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  const method = (init.method ?? (typeof input === 'object' ? input.method : 'GET') ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers ?? (typeof input === 'object' ? input.headers : undefined));
  const bodyText = init.body ?? (typeof input === 'object' && input.body ? await input.text() : undefined);
  const body = bodyText ? JSON.parse(bodyText) : undefined;

  if (url.host === 'api.razorpay.com') {
    const order = { id: `order_T${razorpayOrders.length + 1}`, amount: body.amount, currency: body.currency };
    razorpayOrders.push({ ...order, notes: body.notes });
    return reply(order);
  }

  if (!url.href.startsWith(SUPABASE)) throw new Error(`unexpected fetch ${url.href}`);

  if (url.pathname === '/auth/v1/user') {
    const token = (headers.get('authorization') ?? '').replace(/^Bearer\s+/, '');
    const id = TOKENS[token];
    return id ? reply({ id, email: `${id.slice(0, 4)}@example.com` }) : reply({ message: 'bad jwt' }, 401);
  }

  const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/(.+)$/);
  if (rpc) {
    const fn = RPC[rpc[1]];
    if (!fn) return reply({ code: 'PGRST202', message: `no function ${rpc[1]}` }, 404);
    return reply(fn(body ?? {}));
  }

  const table = url.pathname.replace('/rest/v1/', '');
  const rows = db[table];
  if (!rows) return reply({ code: '42P01', message: `no table ${table}` }, 404);
  const params = [...url.searchParams.entries()];
  const wantsObject = (headers.get('accept') ?? '').includes('vnd.pgrst.object');
  const prefer = headers.get('prefer') ?? '';
  const shape = (list) => (wantsObject ? (list.length === 1 ? reply(list[0]) : reply({ code: 'PGRST116', message: 'not one row' }, 406)) : reply(list));

  if (method === 'GET') return shape(rows.filter((r) => matches(r, params)));

  if (method === 'POST') {
    const incoming = Array.isArray(body) ? body : [body];
    const conflict = url.searchParams.get('on_conflict');
    const out = [];
    for (const item of incoming) {
      if (table === 'webhook_events' && rows.some((r) => r.event_id === item.event_id)) {
        return reply({ code: '23505', message: 'duplicate key' }, 409);
      }
      if (table === 'cards' && rows.some((r) => r.order_id === item.order_id && r.sku === item.sku)) {
        return reply({ code: '23505', message: 'duplicate key' }, 409);
      }
      if (conflict) {
        const keys = conflict.split(',');
        const existing = rows.find((r) => keys.every((k) => r[k] === item[k]));
        if (existing) {
          if (!prefer.includes('ignore-duplicates')) Object.assign(existing, item);
          out.push(existing);
          continue;
        }
      }
      const row = {
        id: uuid(),
        created_at: new Date().toISOString(),
        ...(table === 'orders' ? { fulfillment_status: 'pending', payment_status: 'pending' } : {}),
        ...item,
      };
      rows.push(row);
      out.push(row);
    }
    if (prefer.includes('return=representation')) return shape(out);
    return reply(undefined, 201);
  }

  if (method === 'PATCH') {
    const hit = rows.filter((r) => matches(r, params));
    for (const row of hit) Object.assign(row, body);
    return prefer.includes('return=representation') ? shape(hit) : reply(undefined, 204);
  }

  if (method === 'DELETE') {
    const keep = rows.filter((r) => !matches(r, params));
    const removed = rows.length - keep.length;
    rows.splice(0, rows.length, ...keep);
    if (table === 'orders') {
      const ids = new Set(db.orders.map((o) => o.id));
      db.order_items = db.order_items.filter((i) => ids.has(i.order_id));
    }
    return reply(undefined, removed ? 204 : 204);
  }

  return reply({ message: 'unsupported' }, 405);
}
globalThis.fetch = mockFetch;

const { default: createOrder } = await import('../functions/create-order.mjs');
const { default: verifyPayment } = await import('../functions/verify-payment.mjs');
const { default: webhook } = await import('../functions/razorpay-webhook.mjs');

// ------------------------------------------------------------ helpers
let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (error) {
    console.log(`  FAIL  ${name}\n        ${error.message}`);
    fail++;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const post = (body, token = 'token-alice', extra = {}) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const sign = (orderId, paymentId, secret = process.env.RAZORPAY_KEY_SECRET) =>
  crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
const SHIPPING = { name: 'Alice', phone: '9876543210', address: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
const cardIntent = (extra = {}) => ({
  orderType: 'physical', productId: 'business', material: 'pvc', tier: 'standard', planId: 'essential', shipping: SHIPPING, ...extra,
});
const orderByRzp = (id) => db.orders.find((o) => o.razorpay_order_id === id);
const webhookCall = (payload, eventId) => {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  return webhook(post(raw, null, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': eventId }));
};
const capturedEvent = (orderId, paymentId, amount) => ({
  event: 'payment.captured',
  payload: {
    payment: {
      entity: {
        id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured', method: 'card',
        card_id: 'card_ABC', card: { id: 'card_ABC', last4: '1111', network: 'Visa', name: 'Alice', issuer: 'HDFC' },
      },
    },
  },
});

console.log('\n=== pricing is the server’s ===');

let order1;
await check('create-order prices from the catalogue and ignores a client amount', async () => {
  const res = await createOrder(post(cardIntent({ amount: 1, price: 1, total: 1, amount_in_paise: 100 })));
  const json = await res.json();
  assert(res.status === 200, `status ${res.status} ${JSON.stringify(json)}`);
  assert(json.amount === 39900 + 4900, `charged ${json.amount}`);
  assert(razorpayOrders.at(-1).amount === 44800, 'Razorpay order amount differs');
  order1 = json;
  const row = orderByRzp(json.order_id);
  assert(row.payment_status === 'pending' && row.delivery_fee_in_paise === 4900, JSON.stringify(row));
  assert(db.order_items.some((i) => i.order_id === row.id && i.sku === 'delivery-standard'), 'no delivery line');
  return '₹399 card + ₹49 delivery = ₹448, client "₹1" ignored';
});

await check('a promo code is priced by the server too', async () => {
  const res = await createOrder(post(cardIntent({ promoCode: 'dragon', amount: 1 })));
  const json = await res.json();
  assert(json.amount === 39900 - 11970 + 4900, `charged ${json.amount}`);
  const row = orderByRzp(json.order_id);
  assert(row.discount_in_paise === 11970 && row.promo_code === 'DRAGON', JSON.stringify(row));
  return '₹399 − 30% + ₹49 = ₹328.30';
});

await check('an invalid promo code is refused, not ignored', async () => {
  const before = db.orders.length;
  const res = await createOrder(post(cardIntent({ promoCode: 'FREEBIE' })));
  assert(res.status === 400 && db.orders.length === before, `status ${res.status}`);
  return (await res.json()).error;
});

await check('a signed-out caller cannot create an order', async () => {
  const res = await createOrder(post(cardIntent(), null));
  assert(res.status === 401, `status ${res.status}`);
  return '401';
});

console.log('\n=== nothing is paid without a valid Razorpay signature ===');

await check('a forged signature is refused and the order stays unpaid', async () => {
  const res = await verifyPayment(post({ razorpay_order_id: order1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: 'f'.repeat(64) }));
  assert(res.status === 400, `status ${res.status}`);
  assert(orderByRzp(order1.order_id).payment_status === 'pending', 'order changed');
  return '400, still pending';
});

await check('a signature made with the wrong secret is refused', async () => {
  const res = await verifyPayment(post({
    razorpay_order_id: order1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(order1.order_id, 'pay_1', 'wrong-secret'),
  }));
  assert(res.status === 400 && orderByRzp(order1.order_id).payment_status === 'pending', `status ${res.status}`);
  return '400';
});

await check("a valid signature for someone else's order is refused", async () => {
  const res = await verifyPayment(post({
    razorpay_order_id: order1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(order1.order_id, 'pay_1'),
  }, 'token-mallory'));
  assert(res.status === 404 && orderByRzp(order1.order_id).payment_status === 'pending', `status ${res.status}`);
  return '404, still pending';
});

await check('a verified payment marks the order paid and fulfils it', async () => {
  const res = await verifyPayment(post({
    razorpay_order_id: order1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(order1.order_id, 'pay_1'),
  }));
  const json = await res.json();
  assert(res.status === 200 && json.success, JSON.stringify(json));
  const row = orderByRzp(order1.order_id);
  assert(row.payment_status === 'paid' && row.fulfillment_status === 'fulfilled', JSON.stringify(row));
  assert(db.cards.filter((c) => c.order_id === row.id).length === 1, 'card not issued');
  return `paid, fulfilled, 1 card, ${json.shygonOrderId}`;
});

await check('verifying the same payment again does not pay or issue twice', async () => {
  const res = await verifyPayment(post({
    razorpay_order_id: order1.order_id, razorpay_payment_id: 'pay_1', razorpay_signature: sign(order1.order_id, 'pay_1'),
  }));
  const json = await res.json();
  const row = orderByRzp(order1.order_id);
  assert(json.alreadyProcessed === true, JSON.stringify(json));
  assert(db.cards.filter((c) => c.order_id === row.id).length === 1, 'second card issued');
  assert(db.payments.filter((p) => p.provider_payment_id === 'pay_1').length === 1, 'second payment row');
  return 'alreadyProcessed, still 1 card and 1 payment';
});

console.log('\n=== the webhook ===');

let order3;
await check('a captured payment whose amount does not match is held, not fulfilled', async () => {
  const res0 = await createOrder(post(cardIntent()));
  order3 = await res0.json();
  const res = await webhookCall(capturedEvent(order3.order_id, 'pay_3', 100), 'evt_mismatch');
  const row = orderByRzp(order3.order_id);
  assert(res.status === 200 && row.payment_status === 'pending', `status ${res.status}, ${row.payment_status}`);
  assert(db.admin_notifications.some((n) => n.severity === 'critical'), 'no alert raised');
  return 'held for review, admin alerted';
});

await check('a correct captured payment fulfils, and a replay of the event is ignored', async () => {
  const res = await webhookCall(capturedEvent(order3.order_id, 'pay_3b', order3.amount), 'evt_ok');
  const row = orderByRzp(order3.order_id);
  assert(res.status === 200 && row.payment_status === 'paid' && row.fulfillment_status === 'fulfilled', JSON.stringify(row));
  const replay = await webhookCall(capturedEvent(order3.order_id, 'pay_3b', order3.amount), 'evt_ok');
  const body = await replay.json();
  assert(/already processed/i.test(body.message ?? ''), JSON.stringify(body));
  assert(db.cards.filter((c) => c.order_id === row.id).length === 1, 'replay issued a card');
  return 'fulfilled once; replay acknowledged';
});

await check('no card details are stored from Razorpay payloads', async () => {
  const stored = JSON.stringify(db.payments);
  assert(!/last4|"card":|card_ABC|HDFC|"network"/.test(stored), 'card data found in payments');
  return `${db.payments.length} payment rows, none with card data`;
});

await check('a failed payment leaves the order unpaid and records the failure', async () => {
  const res0 = await createOrder(post(cardIntent()));
  const order4 = await res0.json();
  const failed = capturedEvent(order4.order_id, 'pay_4', order4.amount);
  failed.event = 'payment.failed';
  failed.payload.payment.entity.status = 'failed';
  const res = await webhookCall(failed, 'evt_failed');
  const row = orderByRzp(order4.order_id);
  assert(res.status === 200 && row.payment_status === 'failed', JSON.stringify(row));
  assert(db.payments.some((p) => p.provider_payment_id === 'pay_4' && p.status === 'failed'), 'failure not recorded');
  assert(!db.cards.some((c) => c.order_id === row.id), 'a failed payment issued a card');
  return 'order failed, nothing issued';
});

await check('an unsigned webhook cannot mark anything paid', async () => {
  const res0 = await createOrder(post(cardIntent()));
  const order5 = await res0.json();
  const res = await webhook(post(JSON.stringify(capturedEvent(order5.order_id, 'pay_5', order5.amount)), null, { 'x-razorpay-event-id': 'evt_unsigned' }));
  assert(res.status === 401 && orderByRzp(order5.order_id).payment_status === 'pending', `status ${res.status}`);
  return '401, still pending';
});

console.log('\n=== GST and billing ===');

await check('GST included in the price is worked out by the server, whatever the client sends', async () => {
  const res = await createOrder(post(cardIntent({ tax: 0, taxInPaise: 0, amount: 1 })));
  const json = await res.json();
  const row = orderByRzp(json.order_id);
  const expected = Math.round(44800 - (44800 * 100) / 118);
  assert(json.amount === 44800 && row.tax_in_paise === expected, JSON.stringify({ amount: json.amount, tax: row.tax_in_paise }));
  assert(row.tax_split === 'cgst_sgst' && row.taxable_value_in_paise === 44800 - expected, row.tax_split);
  return `₹448 incl. GST ₹${expected / 100} (CGST+SGST, Karnataka)`;
});

await check('GST added on top raises the Razorpay amount; another state is IGST', async () => {
  db.tax_settings[0].prices_include_tax = false;
  const res = await createOrder(post(cardIntent({ shipping: { ...SHIPPING, state: 'Maharashtra', city: 'Mumbai', pincode: '400001' } })));
  const json = await res.json();
  db.tax_settings[0].prices_include_tax = true;
  const row = orderByRzp(json.order_id);
  assert(json.amount === 44800 + 8064 && razorpayOrders.at(-1).amount === 52864, `charged ${json.amount}`);
  assert(row.tax_split === 'igst', row.tax_split);
  return '₹448 + 18% = ₹528.64, IGST';
});

await check('a separate billing address is validated and stored', async () => {
  const bad = await createOrder(post(cardIntent({ billing: { sameAsShipping: false, name: 'Acme' } })));
  assert(bad.status === 400, `status ${bad.status}`);
  const badGst = await createOrder(post(cardIntent({ billing: { sameAsShipping: true, gstin: 'NOTAGSTIN' } })));
  assert(badGst.status === 400, `gstin status ${badGst.status}`);
  const res = await createOrder(post(cardIntent({ billing: {
    sameAsShipping: false, name: 'Acme Pvt Ltd', company: 'Acme', address: '5 Park St', city: 'Kolkata',
    state: 'West Bengal', pincode: '700016', gstin: '19ABCDE1234F1Z5', email: 'accounts@acme.in' } })));
  const row = orderByRzp((await res.json()).order_id);
  assert(row.billing_city === 'Kolkata' && row.customer_gstin === '19ABCDE1234F1Z5' && row.shipping_city === 'Bengaluru', JSON.stringify(row));
  assert(row.billing_same_as_shipping === false, 'flag');
  return 'incomplete refused, bad GSTIN refused, separate address stored';
});

await check('card details are kept with the order (known fields only) and fill the new page once paid', async () => {
  const res = await createOrder(post(cardIntent({ profile: {
    displayName: '  Arjun Mehta ', designation: 'Founder', phone: '9876543210', whatsapp: '+919876543210',
    instagram: '@arjun', cardNumber: '4111111111111111', cvv: '123' } })));
  const json = await res.json();
  assert(res.status === 200, JSON.stringify(json));
  const row = orderByRzp(json.order_id);
  assert(row.profile_details?.displayName === 'Arjun Mehta', JSON.stringify(row.profile_details));
  assert(!('cardNumber' in row.profile_details) && !('cvv' in row.profile_details), 'unknown fields kept');
  // The page this order's card opens (made by the database trigger in production).
  const pageId = uuid();
  db.tap_profiles.push({ id: pageId, user_id: ALICE, slug: 'arjun', selected_ui_tier: 'essential', enabled_customizations: ['email', 'phone'], display_name: '' });
  const paid = await verifyPayment(post({ razorpay_order_id: json.order_id, razorpay_payment_id: 'pay_details', razorpay_signature: sign(json.order_id, 'pay_details') }));
  assert(paid.status === 200, `verify ${paid.status}`);
  const card = db.cards.find((c) => c.order_id === row.id);
  card.tap_profile_id = pageId;
  const { applyProfileDetails } = await import('../lib/fulfilment.mjs');
  const { createClient } = await import('@supabase/supabase-js');
  await applyProfileDetails(createClient(SUPABASE, 'service-key'), orderByRzp(json.order_id));
  const page = db.tap_profiles.find((t) => t.id === pageId);
  assert(page.display_name === 'Arjun Mehta' && page.whatsapp === '+919876543210' && page.designation === 'Founder', JSON.stringify(page));
  assert(page.enabled_customizations.includes('whatsapp'), 'WhatsApp not switched on for Essential');
  assert(!page.enabled_customizations.includes('instagram'), 'Instagram switched on for Essential');
  // A retry never overwrites what the customer changed since.
  page.display_name = 'Arjun M.';
  await applyProfileDetails(createClient(SUPABASE, 'service-key'), orderByRzp(json.order_id));
  assert(page.display_name === 'Arjun M.', 'retry overwrote the page');
  return 'stored without card fields; page filled; whatsapp on, instagram off (Essential); retry safe';
});

await check('a refund confirmed by the webhook marks the order refunded once', async () => {
  const paid = db.orders.find((o) => o.payment_status === 'paid');
  const refund = (id) => ({ event: 'refund.processed', payload: { refund: { entity: { id, payment_id: paid.razorpay_payment_id, amount: paid.amount_in_paise } } } });
  const res = await webhookCall(refund('rfnd_1'), 'evt_refund');
  const replay = await webhookCall(refund('rfnd_1'), 'evt_refund');
  assert(res.status === 200 && paid.payment_status === 'refunded', paid.payment_status);
  assert(/already processed/i.test((await replay.json()).message ?? ''), 'replay not ignored');
  return 'refunded; replay ignored';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
