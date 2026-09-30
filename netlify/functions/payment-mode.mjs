import { keyMode } from '../lib/razorpay.mjs';

/**
 * GET /api/payment-mode
 *
 * Says whether checkout will charge real money: 'live' when the server holds
 * rzp_live_ keys, 'test' for rzp_test_ keys, 'unconfigured' when either key is
 * missing. The checkout's "Test mode" notice follows this rather than the
 * build's VITE_RAZORPAY_KEY_ID, because the server's key is the one that takes
 * the payment (create-order hands it to Razorpay Checkout) — a stale build
 * variable must never tell a shopper "no real money is charged" on a live key.
 *
 * Public and side-effect free. It returns the mode only, never a key.
 */
export default async (request) => {
  if (request.method !== 'GET') return reply({ error: 'Method not allowed' }, 405);
  const keyId = String(process.env.RAZORPAY_KEY_ID ?? '').trim();
  const keySecret = String(process.env.RAZORPAY_KEY_SECRET ?? '').trim();
  return reply({ mode: keyId && keySecret ? keyMode(keyId) : 'unconfigured' });
};

const reply = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
