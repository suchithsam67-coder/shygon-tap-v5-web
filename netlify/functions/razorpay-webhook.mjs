import crypto from 'node:crypto';
import { adminClient, json, MissingSecretError, requireEnv } from '../lib/supabase.mjs';
import { fulfilOrder, markPaymentFailed, recordPayment } from '../lib/fulfilment.mjs';
import { captureIfAuthorised } from '../lib/razorpay.mjs';

/**
 * POST /api/razorpay-webhook
 *
 * Authoritative payment confirmation. Razorpay calls this directly with no
 * Supabase session, so authenticity comes entirely from the HMAC signature —
 * which is mandatory. An unsigned request is rejected, never trusted.
 *
 * Configure in Razorpay Dashboard > Settings > Webhooks:
 *   URL    https://<your-site>/api/razorpay-webhook
 *   Events payment.authorized, payment.captured, order.paid, payment.failed
 *   Secret must match RAZORPAY_WEBHOOK_SECRET
 */

/** Postgres unique-violation — the idempotency ledger rejecting a replay. */
const UNIQUE_VIOLATION = '23505';

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let admin = null;
  let claimedEventId = null;

  try {
    // NOT the API key secret — the separate value set on the webhook itself.
    const webhookSecret = requireEnv('RAZORPAY_WEBHOOK_SECRET');

    const signature = request.headers.get('x-razorpay-signature');
    const rawBody = await request.text();

    if (!signature) {
      console.warn('razorpay-webhook: rejected unsigned request');
      return json({ error: 'Missing webhook signature.' }, 401);
    }

    const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      console.warn('razorpay-webhook: rejected invalid signature');
      return json({ error: 'Invalid webhook signature.' }, 401);
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ error: 'Malformed webhook body.' }, 400);
    }

    // Razorpay sends the event id as a header, not in the body.
    const eventId = request.headers.get('x-razorpay-event-id');
    if (!eventId) return json({ error: 'Missing x-razorpay-event-id header.' }, 400);

    const eventType = payload?.event || 'unknown';
    admin = adminClient();

    // Claim the event by inserting first: the unique index makes this atomic,
    // unlike a select-then-insert which two concurrent redeliveries both pass.
    const { error: ledgerError } = await admin
      .from('webhook_events')
      .insert({ provider: 'razorpay', event_id: eventId, event_type: eventType });

    if (ledgerError) {
      if (ledgerError.code === UNIQUE_VIOLATION) {
        return json({ message: 'Event already processed', eventId });
      }
      console.error('Webhook ledger insert failed', ledgerError.message);
      // 500 so Razorpay retries rather than dropping the event.
      return json({ error: 'Could not record webhook event.' }, 500);
    }

    // From here the claim is ours; release it if processing throws, or the
    // retry would be dismissed as a duplicate and the customer never fulfilled.
    claimedEventId = eventId;

    const paymentEntity = payload?.payload?.payment?.entity;
    const orderEntity = payload?.payload?.order?.entity;
    const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!razorpayOrderId) {
      return json({ success: true, eventId, message: 'No order id on event' });
    }

    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, amount_in_paise')
      .eq('razorpay_order_id', razorpayOrderId)
      .maybeSingle();

    if (orderError) throw new Error(`Order lookup failed: ${orderError.message}`);
    if (!order) {
      // Acknowledge — retrying will not make an unknown order appear.
      console.warn('razorpay-webhook: no local order for', razorpayOrderId);
      return json({ success: true, eventId, message: 'Unknown order' });
    }

    // Money held but not taken (auto-capture off): take it. Razorpay then
    // sends payment.captured, which fulfils below.
    if (eventType === 'payment.authorized' && razorpayPaymentId) {
      if (Number(paymentEntity?.amount) === Number(order.amount_in_paise) && paymentEntity?.currency === 'INR') {
        const captured = await captureIfAuthorised({ paymentId: razorpayPaymentId, amountInPaise: order.amount_in_paise });
        return json({ success: true, eventId, captured });
      }
    }

    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      // Real money: only an exact, rupee payment of what the order costs
      // fulfils it. Anything else is held for a person to look at.
      const paid = eventType === 'order.paid' ? orderEntity?.amount_paid : paymentEntity?.amount;
      const currency = paymentEntity?.currency ?? orderEntity?.currency;
      if (Number(paid) !== Number(order.amount_in_paise) || currency !== 'INR') {
        console.warn('razorpay-webhook: amount mismatch on order', order.id, paid, order.amount_in_paise, currency);
        await admin.from('admin_notifications').insert({
          category: 'payment',
          severity: 'critical',
          title: 'Payment amount does not match an order',
          body: `Razorpay reported ${currency ?? '?'} ${(Number(paid) || 0) / 100} for an order of ₹${(order.amount_in_paise ?? 0) / 100}. It was not fulfilled; check it in Razorpay before shipping anything.`,
          link: '/orders',
          metadata: { razorpay_order_id: razorpayOrderId, razorpay_payment_id: razorpayPaymentId ?? null },
        });
        return json({ success: true, eventId, message: 'Amount mismatch; held for review' });
      }

      if (razorpayPaymentId) {
        await admin
          .from('orders')
          .update({ razorpay_payment_id: razorpayPaymentId })
          .eq('id', order.id);

        await recordPayment(admin, {
          orderId: order.id,
          amountInPaise: order.amount_in_paise ?? paymentEntity?.amount ?? 0,
          providerOrderId: razorpayOrderId,
          providerPaymentId: razorpayPaymentId,
          rawPayload: payload,
        });
      }

      const result = await fulfilOrder(admin, order.id);
      return json({ success: true, eventId, newlyFulfilled: result.newlyFulfilled });
    }

    if (eventType === 'payment.failed' && razorpayPaymentId) {
      await markPaymentFailed(admin, {
        orderId: order.id,
        amountInPaise: order.amount_in_paise ?? 0,
        providerOrderId: razorpayOrderId,
        providerPaymentId: razorpayPaymentId,
        rawPayload: payload,
      });

      // Only touch orders that have not already been paid by the other path.
      await admin
        .from('orders')
        .update({ payment_status: 'failed' })
        .eq('id', order.id)
        .neq('payment_status', 'paid');

      return json({ success: true, eventId });
    }

    return json({ success: true, eventId, message: `Ignored event ${eventType}` });
  } catch (error) {
    if (error instanceof MissingSecretError) {
      console.error(error.message);
      return json({ error: 'Payments are not configured on this server.' }, 503);
    }

    if (admin && claimedEventId) {
      const { error: releaseError } = await admin
        .from('webhook_events')
        .delete()
        .eq('event_id', claimedEventId);
      if (releaseError) {
        console.error(
          'razorpay-webhook: FAILED TO RELEASE event claim — manual reconciliation needed for',
          claimedEventId,
          releaseError.message,
        );
      }
    }

    console.error('Webhook processing error', error);
    // 500 asks Razorpay to retry — safe because fulfilment is idempotent.
    return json({ error: 'Webhook processing error.' }, 500);
  }
};
