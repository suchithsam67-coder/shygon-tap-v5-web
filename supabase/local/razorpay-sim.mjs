// A Razorpay stand-in for the local stack (V6, D-4; "Razorpay test mode /
// fixtures only. Never call live payment APIs.").
//
// Nothing here talks to Razorpay. It plays the three parts Razorpay plays:
//  1. the REST API the server functions call (orders, payments, capture),
//     reached because the local stack routes https://api.razorpay.com to it;
//  2. Checkout in the browser: taking a payment for an order and handing the
//     page the three signed fields (razorpay_order_id, _payment_id, _signature);
//  3. webhooks: signed POSTs to /api/razorpay-webhook with an event id.
// Signatures use Razorpay's documented scheme (HMAC-SHA256 with the key
// secret over "<order_id>|<payment_id>"; with the webhook secret over the raw
// body), with throwaway secrets generated per run.
import crypto from 'node:crypto';

const id = (prefix) => `${prefix}_${crypto.randomBytes(7).toString('hex')}`;
const now = () => Math.floor(Date.now() / 1000);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status, description) => json(status, { error: { code: 'BAD_REQUEST_ERROR', description, source: 'NA', step: 'NA', reason: 'NA' } });

export function createRazorpaySim({ keyId, keySecret, webhookSecret, webhookUrl, log = () => {} }) {
  const orders = new Map();
  const payments = new Map();
  const deliveries = [];

  const checkoutSignature = (orderId, paymentId) =>
    crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');

  /** The REST API, for requests to https://api.razorpay.com/v1/... */
  async function api(request) {
    const expected = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
    if (request.headers.get('authorization') !== expected) return apiError(401, 'Authentication failed');
    const { pathname } = new URL(request.url);
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : null;

    if (request.method === 'POST' && pathname === '/v1/orders') {
      const amount = Number(body?.amount);
      if (!Number.isInteger(amount) || amount < 100) return apiError(400, 'The amount must be atleast INR 1.00');
      const order = {
        id: id('order'),
        entity: 'order',
        amount,
        amount_paid: 0,
        amount_due: amount,
        currency: body.currency ?? 'INR',
        receipt: body.receipt ?? null,
        status: 'created',
        attempts: 0,
        notes: body.notes ?? {},
        created_at: now(),
      };
      orders.set(order.id, order);
      log(`razorpay-sim: order ${order.id} for ${amount}`);
      return json(200, order);
    }
    let match = pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const order = orders.get(match[1]);
      return order ? json(200, order) : apiError(400, 'The id provided does not exist');
    }
    match = pathname.match(/^\/v1\/payments\/([^/]+)$/);
    if (request.method === 'GET' && match) {
      const payment = payments.get(match[1]);
      return payment ? json(200, payment) : apiError(400, 'The id provided does not exist');
    }
    match = pathname.match(/^\/v1\/payments\/([^/]+)\/capture$/);
    if (request.method === 'POST' && match) {
      const payment = payments.get(match[1]);
      if (!payment) return apiError(400, 'The id provided does not exist');
      if (payment.status === 'captured') return apiError(400, 'This payment has already been captured');
      if (payment.status !== 'authorized') return apiError(400, 'Only payments which have been authorized and not yet captured can be captured');
      if (Number(body?.amount) !== payment.amount) return apiError(400, 'Capture amount must be equal to the amount authorized');
      payment.status = 'captured';
      payment.captured = true;
      settleOrder(payment);
      return json(200, payment);
    }
    return apiError(404, `The requested URL was not found on the server (${request.method} ${pathname}).`);
  }

  function settleOrder(payment) {
    const order = orders.get(payment.order_id);
    if (!order) return;
    order.amount_paid = payment.amount;
    order.amount_due = 0;
    order.status = 'paid';
  }

  /**
   * What Checkout does when the customer pays (or does not).
   *   outcome  'success' | 'failure' | 'dismiss'
   *   capture  'auto' → captured at once · 'manual' → only authorised
   *   amount   override the amount actually paid (to test a short payment)
   * Resolves to what Checkout hands the page: the three signed fields, an
   * `error` (failure) or `dismissed`.
   */
  function pay({ order_id: orderId, outcome = 'success', capture = 'auto', amount }) {
    const order = orders.get(orderId);
    if (!order) return { error: { code: 'BAD_REQUEST_ERROR', description: 'Order not found.' } };
    if (outcome === 'dismiss') return { dismissed: true };
    order.attempts += 1;
    const payment = {
      id: id('pay'),
      entity: 'payment',
      amount: amount ?? order.amount,
      currency: order.currency,
      status: outcome === 'failure' ? 'failed' : capture === 'manual' ? 'authorized' : 'captured',
      order_id: order.id,
      method: 'upi',
      captured: outcome !== 'failure' && capture !== 'manual',
      email: 'customer@example.test',
      contact: '+919999999999',
      error_code: outcome === 'failure' ? 'BAD_REQUEST_ERROR' : null,
      error_description: outcome === 'failure' ? 'Payment failed because the bank declined it.' : null,
      created_at: now(),
    };
    payments.set(payment.id, payment);
    if (payment.status === 'captured') settleOrder(payment);
    log(`razorpay-sim: payment ${payment.id} ${payment.status}`);
    if (outcome === 'failure') {
      return {
        error: { code: 'BAD_REQUEST_ERROR', description: payment.error_description, reason: 'payment_failed', metadata: { order_id: order.id, payment_id: payment.id } },
        payment_id: payment.id,
      };
    }
    return {
      razorpay_payment_id: payment.id,
      razorpay_order_id: order.id,
      razorpay_signature: checkoutSignature(order.id, payment.id),
    };
  }

  /** The webhook body Razorpay would send for `event` about `paymentId`. */
  function eventBody(event, paymentId) {
    const payment = payments.get(paymentId);
    if (!payment) throw new Error(`razorpay-sim: unknown payment ${paymentId}`);
    const order = orders.get(payment.order_id);
    const payload = { payment: { entity: { ...payment } } };
    if (event === 'order.paid') payload.order = { entity: { ...order } };
    return {
      entity: 'event',
      account_id: 'acc_local',
      event,
      contains: Object.keys(payload),
      payload,
      created_at: now(),
    };
  }

  /**
   * Delivers a webhook. `signature: 'invalid'` signs with the wrong secret;
   * `eventId` reuses an id (a redelivery).
   */
  async function sendWebhook(event, paymentId, { eventId = id('evt'), signature = 'valid', body } = {}) {
    const raw = JSON.stringify(body ?? eventBody(event, paymentId));
    const secret = signature === 'invalid' ? `${webhookSecret}-wrong` : webhookSecret;
    const headers = { 'content-type': 'application/json', 'x-razorpay-event-id': eventId };
    if (signature !== 'none') headers['x-razorpay-signature'] = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const response = await fetch(webhookUrl(), { method: 'POST', headers, body: raw });
    const result = { event, paymentId, eventId, status: response.status, body: await response.json().catch(() => null) };
    deliveries.push(result);
    log(`razorpay-sim: webhook ${event} ${eventId} -> ${response.status}`);
    return result;
  }

  /** The Checkout script served in place of https://checkout.razorpay.com/v1/checkout.js. */
  function checkoutScript(origin) {
    return `/* SHYGON local stack: Razorpay Checkout stand-in. Not Razorpay's code. */
(function () {
  function Razorpay(options) { this.options = options; this.handlers = {}; }
  Razorpay.prototype.on = function (event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); };
  Razorpay.prototype.open = function () {
    var self = this, options = this.options, scenario = window.__RZP_SCENARIO || {};
    fetch(${JSON.stringify(origin)} + '/__sim/razorpay/pay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: options.key, order_id: options.order_id, outcome: scenario.outcome, capture: scenario.capture, amount: scenario.amount, webhook: scenario.webhook, webhookDelayMs: scenario.webhookDelayMs })
    }).then(function (r) { return r.json(); }).then(function (result) {
      if (result.dismissed) { if (options.modal && options.modal.ondismiss) options.modal.ondismiss(); return; }
      if (result.error) { (self.handlers['payment.failed'] || []).forEach(function (fn) { fn({ error: result.error }); }); return; }
      options.handler(result);
    });
  };
  window.Razorpay = Razorpay;
})();
`;
  }

  /**
   * Browser-side pay, plus the webhook Razorpay would send.
   *   webhook  'after' (default; after webhookDelayMs) · 'before' · 'none' · 'duplicate'
   */
  async function payFromBrowser(body) {
    if (body?.key !== keyId) return { error: { code: 'BAD_REQUEST_ERROR', description: 'The key id does not match this account.' } };
    const result = pay(body);
    const paymentId = result.razorpay_payment_id ?? result.payment_id;
    const mode = body.webhook ?? 'after';
    if (!paymentId || mode === 'none') return result;
    const payment = payments.get(paymentId);
    const event = payment.status === 'failed' ? 'payment.failed' : payment.status === 'authorized' ? 'payment.authorized' : 'payment.captured';
    const deliver = async () => {
      const first = await sendWebhook(event, paymentId);
      if (mode === 'duplicate') await sendWebhook(event, paymentId, { eventId: first.eventId });
    };
    if (mode === 'before') await deliver();
    else setTimeout(() => deliver().catch((error) => log(`razorpay-sim: webhook failed ${error.message}`)), body.webhookDelayMs ?? 400);
    return result;
  }

  return { api, pay, payFromBrowser, sendWebhook, eventBody, checkoutScript, checkoutSignature, orders, payments, deliveries };
}
