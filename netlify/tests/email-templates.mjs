/**
 * Renders the outbox templates against a mocked Supabase REST API and a mocked
 * Resend endpoint — no network, no real email. Run: node netlify/tests/email-templates.mjs
 */
process.env.SUPABASE_URL = 'https://db.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.EMAIL_FROM = 'SHYGON Tap <orders@test.invalid>';

const USER = '00000000-0000-4000-8000-000000000001';
const ORDER = {
  id: 'o1', order_id: 'SHY-TEST1', user_id: USER, order_type: 'physical', product_name: 'Obsidian card',
  amount_in_paise: 169900, subtotal_in_paise: 165000, discount_in_paise: 0, delivery_fee_in_paise: 4900,
  payment_status: 'paid', order_status: 'processing', fulfillment_status: 'fulfilled', razorpay_payment_id: 'pay_x',
  shipping_name: 'Test Buyer', shipping_address: '1 MG Road', shipping_city: 'Bengaluru', shipping_state: 'Karnataka',
  shipping_pincode: '560001', created_at: new Date(Date.now() - 3600e3).toISOString(),
  tax_in_paise: 25918, tax_rate_percent: 18, tax_inclusive: true, tax_split: 'cgst_sgst',
  customer_gstin: '29ABCDE1234F1Z5', billing_same_as_shipping: false, billing_name: 'Buyer Pvt Ltd',
  billing_address: '9 Residency Rd', billing_city: 'Bengaluru', billing_state: 'Karnataka', billing_pincode: '560025',
};

const outbox = [
  { id: 'e1', template: 'order_confirmed', user_id: USER, subject_id: 'o1', payload: {}, created_at: ORDER.created_at },
  { id: 'e2', template: 'support_ticket_created', user_id: USER, subject_id: 't1', payload: { ticket_id: 't1' }, created_at: ORDER.created_at },
  { id: 'e3', template: 'support_reply', user_id: USER, subject_id: 't1', payload: { ticket_id: 't1', message_id: 'm1' }, created_at: ORDER.created_at },
];
const sent = [];
const outcomes = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const reply = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status });
  if (u.startsWith('https://api.resend.com')) {
    sent.push(JSON.parse(init.body));
    return reply({ id: `re_${sent.length}` });
  }
  if (u.includes('rpc/email_outbox_claim')) return reply(outbox.splice(0));
  if (u.includes('rpc/email_outbox_complete')) {
    outcomes.push(JSON.parse(init.body));
    return reply(null, 204);
  }
  if (u.includes('/profiles?')) return reply([{ full_name: 'Test Buyer', email: 'buyer@test.invalid' }]);
  if (u.includes('/orders?')) return reply([ORDER]);
  if (u.includes('/order_items?')) return reply([{ name: 'Obsidian card', sku: 'card-obsidian-standard-pvc', quantity: 1, line_total_in_paise: 165000 }]);
  if (u.includes('/cards?') || u.includes('/tap_profiles?')) return reply([]);
  if (u.includes('/support_tickets?')) return reply([{ id: 't1', reference: 'ST-ABCD1234', subject: 'Card not scanning', status: 'open' }]);
  if (u.includes('/support_messages?')) return reply([{ body: 'Please hold the card near the top of the phone.\nThanks!' }]);
  return reply([]);
};

const { drainEmailOutbox } = await import('../lib/email.mjs');
let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const summary = await drainEmailOutbox({ limit: 10, budgetMs: 5000 });
const bill = sent.find((m) => /confirmed/i.test(m.subject));
const created = sent.find((m) => /Request received/.test(m.subject));
const replyMail = sent.find((m) => /Reply on/.test(m.subject));

check('three emails sent', summary.sent === 3, JSON.stringify(summary));
check('e-bill shows CGST and SGST halves', Boolean(bill?.html.includes('CGST 9%') && bill.html.includes('SGST 9%')));
check('e-bill shows the customer GSTIN and billing address', Boolean(bill?.html.includes('29ABCDE1234F1Z5') && bill.html.includes('9 Residency Rd')));
check('support request email names the reference', Boolean(created?.html.includes('ST-ABCD1234')));
check('support reply email carries the reply text', Boolean(replyMail?.html.includes('near the top of the phone.<br>Thanks!')));
check('plain-text parts have no HTML', sent.every((m) => !/<[a-z]/i.test(m.text ?? '')));
check('every row completed', outcomes.length === 3);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
