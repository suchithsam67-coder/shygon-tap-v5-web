/**
 * POST /functions/v1/admin-refund
 *
 * The only path in the whole system that can move money back to a customer.
 *
 * It lives here, and not in the Admin APK's normal RPC surface, for one
 * concrete reason: the payment trigger in migration 001 refuses any change to
 * `payment_status` from a context that has an `auth.uid()`. That refusal is
 * deliberate and is NOT relaxed for administrators. A refund therefore has to
 * come through the same "no auth.uid()" door the Razorpay webhook uses — the
 * service role — and the service-role key must never be inside an APK.
 *
 * Body:
 *   { order_id: uuid, amount_in_paise?: number, reason: string,
 *     revoke_entitlements?: boolean }
 *
 * Secrets required (Supabase > Edge Functions > Secrets — never in the APK):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 */

import { audit, corsHeaders, json, MissingSecretError, requireEnv, resolveAdmin, serviceClient } from '../_shared/admin.ts';

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let service;
  let claimToken: string | null = null;
  let claimedOrderId: string | null = null;

  try {
    const keyId = requireEnv('RAZORPAY_KEY_ID');
    const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
    service = serviceClient();

    const admin = await resolveAdmin(service, request, 'orders.refund');
    if (!admin) return json({ error: 'You are not permitted to issue refunds.' }, 403);

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const orderId = typeof body.order_id === 'string' ? body.order_id.trim() : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const revokeEntitlements = body.revoke_entitlements !== false;

    if (!orderId) return json({ error: 'An order id is required.' }, 400);
    if (reason.length < 3) return json({ error: 'A refund reason is required.' }, 400);

    const { data: order, error: orderError } = await service
      .from('orders')
      .select('id, order_id, user_id, amount_in_paise, payment_status, razorpay_payment_id, razorpay_refund_id, refund_amount_in_paise')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) {
      console.error('order lookup failed', orderError.message);
      return json({ error: 'Could not load that order.' }, 500);
    }
    if (!order) return json({ error: 'Order not found.' }, 404);

    if (order.payment_status !== 'paid') {
      return json({ error: 'Only a paid order can be refunded.' }, 409);
    }
    if (!order.razorpay_payment_id) {
      return json(
        { error: 'This order has no captured Razorpay payment, so there is nothing to refund.' },
        409,
      );
    }
    if (order.razorpay_refund_id) {
      // Already refunded, or another operator is mid-refund right now.
      return json(
        {
          error: order.razorpay_refund_id.startsWith('pending:')
            ? 'A refund for this order is already in progress.'
            : 'This order has already been refunded.',
          refund_id: order.razorpay_refund_id,
        },
        409,
      );
    }

    const paidInPaise = Number(order.amount_in_paise ?? 0);
    const requested = body.amount_in_paise;
    const amountInPaise =
      requested === undefined || requested === null ? paidInPaise : Number(requested);

    if (!Number.isInteger(amountInPaise) || amountInPaise <= 0) {
      return json({ error: 'The refund amount must be a positive whole number of paise.' }, 400);
    }
    if (amountInPaise > paidInPaise) {
      return json({ error: 'A refund cannot exceed what the customer paid.' }, 400);
    }

    // --- Claim the refund atomically ---------------------------------------
    // Two operators tapping "Refund" at the same moment must not both reach
    // Razorpay. Only the caller whose UPDATE matches razorpay_refund_id IS NULL
    // gets a row back; the loser sees the 409 above on its next read.
    claimToken = `pending:${crypto.randomUUID()}`;
    const { data: claimed, error: claimError } = await service
      .from('orders')
      .update({ razorpay_refund_id: claimToken })
      .eq('id', order.id)
      .is('razorpay_refund_id', null)
      .select('id');

    if (claimError) {
      console.error('refund claim failed', claimError.message);
      return json({ error: 'Could not start the refund.' }, 500);
    }
    if (!claimed || claimed.length === 0) {
      return json({ error: 'A refund for this order is already in progress.' }, 409);
    }
    claimedOrderId = order.id;

    // --- Razorpay ----------------------------------------------------------
    const auth = btoa(`${keyId}:${keySecret}`);
    let refund: { id?: string; status?: string };

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${order.razorpay_payment_id}/refund`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          // Razorpay de-duplicates on this key, so a network retry of this same
          // call cannot create a second refund.
          'X-Payment-Idempotency': claimToken,
        },
        body: JSON.stringify({
          amount: amountInPaise,
          speed: 'normal',
          notes: {
            shygon_order: order.order_id ?? order.id,
            reason: reason.slice(0, 200),
            admin: admin.userId,
          },
        }),
      },
    );

    if (!response.ok) {
      // Never echo the gateway body to the client — it can carry key detail.
      const detail = await response.text();
      console.error('razorpay refund failed', response.status, detail);
      await releaseClaim(service, claimedOrderId, claimToken);
      claimedOrderId = null;
      return json(
        {
          error:
            response.status === 400
              ? 'Razorpay rejected the refund. Check the payment is still refundable.'
              : 'The payment gateway could not process this refund. Nothing was charged back.',
        },
        502,
      );
    }

    refund = await response.json();

    // The money has now left the gateway. From here the claim must NEVER be
    // released, or a second operator could issue a duplicate refund — so the
    // catch block below is disarmed before anything else can throw.
    claimedOrderId = null;

    // --- Record it ---------------------------------------------------------
    // Past this point the money HAS moved. Every failure below is logged and
    // surfaced, never swallowed, because the database and the gateway must be
    // reconcilable by hand if one of these writes fails.
    const fullyRefunded = amountInPaise >= paidInPaise;

    const { error: updateError } = await service
      .from('orders')
      .update({
        razorpay_refund_id: refund.id ?? claimToken,
        refund_amount_in_paise: amountInPaise,
        refunded_at: new Date().toISOString(),
        payment_status: fullyRefunded ? 'refunded' : 'paid',
        admin_note: reason,
      })
      .eq('id', order.id);

    if (updateError) {
      console.error(
        'REFUND SUCCEEDED AT RAZORPAY BUT THE ORDER WAS NOT UPDATED — reconcile by hand.',
        order.id,
        refund.id,
        updateError.message,
      );
    }

    // Upsert on the unique provider_payment_id so a retried invocation records
    // the same refund once rather than failing on a duplicate key.
    const { error: ledgerError } = await service.from('payments').upsert(
      {
        order_id: order.id,
        provider: 'razorpay',
        provider_order_id: refund.id ?? claimToken,
        provider_payment_id: `refund_${refund.id ?? claimToken}`,
        status: 'refunded',
        amount_in_paise: amountInPaise,
        raw_payload: refund as unknown as Record<string, unknown>,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'provider_payment_id' },
    );
    if (ledgerError) {
      console.error('refund ledger write failed — reconcile by hand', order.id, ledgerError.message);
    }

    if (revokeEntitlements && fullyRefunded) {
      // Deactivated, not deleted: the grant is part of the order's history and
      // has to stay reconcilable against the payment that created it.
      const { error: entError } = await service
        .from('entitlements')
        .update({ is_active: false })
        .eq('source_order_id', order.id);
      if (entError) console.error('entitlement revocation failed', entError.message);

      const { error: cardError } = await service
        .from('cards')
        .update({ status: 'suspended' })
        .eq('order_id', order.id)
        .neq('status', 'replaced');
      if (cardError) console.error('card suspension failed', cardError.message);
    }

    if (order.user_id) {
      await service.from('notifications').insert({
        user_id: order.user_id,
        category: 'payment',
        title: fullyRefunded ? 'Refund issued' : 'Partial refund issued',
        body: `${chunkRupees(amountInPaise)} has been refunded for order ${order.order_id ?? ''}. It can take 5-7 working days to reach your account.`,
        link: '/shygontap/orders',
        metadata: { order_id: order.id, refund_id: refund.id },
      });
    }

    await audit(service, admin.userId, 'order.refunded', 'order', order.id, {
      amount_in_paise: amountInPaise,
      full_refund: fullyRefunded,
      razorpay_refund_id: refund.id,
      reason,
      entitlements_revoked: revokeEntitlements && fullyRefunded,
    });

    return json({
      success: true,
      order_id: order.id,
      refund_id: refund.id,
      amount_in_paise: amountInPaise,
      full_refund: fullyRefunded,
    });
  } catch (error) {
    if (error instanceof MissingSecretError) {
      console.error(error.message);
      return json({ error: 'Refunds are not configured on this server.' }, 503);
    }
    // The claim is released only when we are certain Razorpay was never
    // reached successfully; the successful path clears claimedOrderId itself.
    if (service && claimedOrderId && claimToken) {
      await releaseClaim(service, claimedOrderId, claimToken);
    }
    console.error('admin-refund error', error);
    return json({ error: 'The refund could not be completed.' }, 500);
  }
});

async function releaseClaim(
  // deno-lint-ignore no-explicit-any
  service: any,
  orderId: string,
  claimToken: string,
): Promise<void> {
  const { error } = await service
    .from('orders')
    .update({ razorpay_refund_id: null })
    .eq('id', orderId)
    .eq('razorpay_refund_id', claimToken);
  if (error) {
    console.error(
      'FAILED TO RELEASE REFUND CLAIM — this order will refuse further refunds until cleared by hand:',
      orderId,
      error.message,
    );
  }
}

function chunkRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
}
