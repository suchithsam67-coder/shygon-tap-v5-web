import crypto from 'node:crypto';
import { adminClient, getRequestUser, json, MissingSecretError, requireEnv } from '../lib/supabase.mjs';
import { fulfilOrder, recordPayment } from '../lib/fulfilment.mjs';
import { drainEmailOutbox } from '../lib/email.mjs';
import { afterResponse } from '../lib/after-response.mjs';

/**
 * POST /api/verify-payment
 *
 * Fast path so the customer sees their purchase immediately. NOT the source of
 * truth — razorpay-webhook fulfils the same order independently and both are
 * idempotent, so nothing is lost if the browser dies mid-payment.
 *
 * The browser no longer marks anything paid; that now happens here, behind a
 * verified signature, using the service-role key.
 */
export default async (request, context) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
    const admin = adminClient();

    const user = await getRequestUser(admin, request);
    if (!user) return json({ error: 'You must be signed in.' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const orderId = str(body?.razorpay_order_id);
    const paymentId = str(body?.razorpay_payment_id);
    const signature = str(body?.razorpay_signature);

    if (!orderId || !paymentId || !signature) {
      return json({ error: 'Missing payment verification fields.' }, 400);
    }

    // Razorpay signs "<order_id>|<payment_id>" with the API key secret.
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json({ error: 'Payment signature verification failed.' }, 400);
    }

    // Resolve the order by the Razorpay id — that is what the signature proves.
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, user_id, order_id, amount_in_paise')
      .eq('razorpay_order_id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('Order lookup failed', orderError.message);
      return json({ error: 'Could not load the order.' }, 500);
    }
    if (!order) return json({ error: 'Order not found.' }, 404);

    // A valid signature for someone else's order must not fulfil against the
    // caller's account.
    if (order.user_id !== user.id) {
      console.warn('verify-payment customer mismatch on order', order.id);
      return json({ error: 'Order not found.' }, 404);
    }

    await admin.from('orders').update({ razorpay_payment_id: paymentId }).eq('id', order.id);

    await recordPayment(admin, {
      orderId: order.id,
      amountInPaise: order.amount_in_paise ?? 0,
      providerOrderId: orderId,
      providerPaymentId: paymentId,
      rawPayload: { source: 'verify-payment', orderId, paymentId },
    });

    const result = await fulfilOrder(admin, order.id);

    // The order confirmation and e-bill (queued by the database when the order
    // turned paid) go out now rather than on the next scheduled run.
    await afterResponse(context, drainEmailOutbox({ limit: 5, budgetMs: 4000 }));

    return json({
      success: true,
      orderId: order.id,
      shygonOrderId: order.order_id,
      alreadyProcessed: !result.newlyFulfilled,
      razorpay_payment_id: paymentId,
      razorpay_order_id: orderId,
    });
  } catch (error) {
    if (error instanceof MissingSecretError) {
      console.error(error.message);
      return json({ error: 'Payments are not configured on this server.' }, 503);
    }
    console.error('Verify payment error', error);
    return json({ error: 'Unable to verify payment.' }, 500);
  }
};
