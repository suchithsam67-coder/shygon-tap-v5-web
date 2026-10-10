import { requestLog } from './log.mjs';
import { requireEnv } from './supabase.mjs';

/**
 * Server-side checks that make a Razorpay payment safe to act on with real
 * money. A valid checkout signature proves the browser saw a payment for an
 * order; these checks ask Razorpay itself that the money was actually taken,
 * in full, in rupees, for that order — and take it if it was only authorised.
 */

const API = 'https://api.razorpay.com/v1';

export class PaymentNotConfirmedError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

/** 'live' or 'test', from the key id Razorpay issued. */
export const keyMode = (keyId) => (String(keyId ?? '').startsWith('rzp_live_') ? 'live' : 'test');

function auth() {
  const keyId = requireEnv('RAZORPAY_KEY_ID');
  const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
  return { keyId, header: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}` };
}

async function call(path, { method = 'GET', body } = {}) {
  const { header } = auth();
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: header, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}

/**
 * Real money never moves from a developer's machine: with live keys, a
 * request to localhost is refused unless ALLOW_LIVE_PAYMENTS_LOCALLY=true.
 */
export function assertLiveKeysAllowed(request) {
  const mode = keyMode(process.env.RAZORPAY_KEY_ID);
  if (mode !== 'live') return;
  let host = '';
  try {
    host = new URL(request.url).hostname;
  } catch {
    host = '';
  }
  const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  if (local && process.env.ALLOW_LIVE_PAYMENTS_LOCALLY !== 'true') {
    throw new PaymentNotConfirmedError('Live payment keys are not used on a local development server.', 403);
  }
}

/**
 * Confirms with Razorpay that `paymentId` paid `amountInPaise` INR for
 * `razorpayOrderId`, capturing it first if it was only authorised.
 * Resolves to the payment entity; rejects with PaymentNotConfirmedError when
 * the money is not (or not all) there. A mismatch is logged as a security
 * event on the caller's log.
 */
export async function confirmPayment({ paymentId, razorpayOrderId, amountInPaise }, log = requestLog('razorpay', null)) {
  const fetched = await call(`/payments/${encodeURIComponent(paymentId)}`);
  if (!fetched.ok || !fetched.data) {
    log.error('razorpay.payment-lookup-failed', { paymentId, status: fetched.status });
    throw new PaymentNotConfirmedError('We could not confirm your payment with Razorpay yet. Please try again in a minute.', 502);
  }
  let payment = fetched.data;

  if (payment.order_id !== razorpayOrderId) {
    log.warn('payment.order-mismatch', { paymentId, razorpayOrderId, paidFor: payment.order_id });
    throw new PaymentNotConfirmedError('This payment does not belong to your order.');
  }
  if (payment.currency !== 'INR' || Number(payment.amount) !== Number(amountInPaise)) {
    log.warn('payment.amount-mismatch', { paymentId, razorpayOrderId, paid: payment.amount, expected: amountInPaise, currency: payment.currency });
    throw new PaymentNotConfirmedError('The amount paid does not match your order. Please contact support.');
  }

  if (payment.status === 'authorized') {
    // Money held but not yet taken (auto-capture off, or not yet run): take it.
    const captured = await call(`/payments/${encodeURIComponent(paymentId)}/capture`, {
      method: 'POST',
      body: { amount: Number(amountInPaise), currency: 'INR' },
    });
    if (captured.ok && captured.data?.status === 'captured') {
      payment = captured.data;
    } else {
      // A concurrent capture (webhook, auto-capture) wins the race: re-read.
      const again = await call(`/payments/${encodeURIComponent(paymentId)}`);
      if (again.ok && again.data?.status === 'captured') payment = again.data;
      else {
        log.error('razorpay.capture-failed', { paymentId, status: captured.status, code: captured.data?.error?.code });
        throw new PaymentNotConfirmedError('Your payment is authorised but could not be completed yet. We will retry automatically.', 502);
      }
    }
  }

  if (payment.status !== 'captured') {
    throw new PaymentNotConfirmedError(
      payment.status === 'failed' ? 'The payment failed. You have not been charged.' : 'The payment has not completed yet.',
    );
  }
  return payment;
}

/** Captures an authorised payment named by a webhook, if its amount is right. */
export async function captureIfAuthorised({ paymentId, amountInPaise }) {
  const result = await call(`/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: 'POST',
    body: { amount: Number(amountInPaise), currency: 'INR' },
  });
  return result.ok;
}
