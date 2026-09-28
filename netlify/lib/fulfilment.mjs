/**
 * The single place an order becomes entitlements.
 *
 * Both verify-payment (fast path, driven by the browser) and razorpay-webhook
 * (authoritative, driven by Razorpay) call fulfilOrder. That way a customer who
 * closes the tab the instant the payment succeeds still gets what they paid for.
 *
 * Everything is idempotent: side effects run only for whichever caller wins the
 * `pending -> paid` transition, which Postgres serialises via the row lock on
 * UPDATE ... WHERE payment_status <> 'paid'.
 */

/** payment_status values an order may legitimately move to 'paid' from. */
const PAYABLE_STATUSES = ['pending', 'created', 'payment_pending', 'failed'];

/**
 * Legacy plan ids seen on orders placed before migration 004 unified the
 * vocabulary, mapped to the experience they were sold as. Granting a key the
 * database no longer recognises would leave a paying customer with an
 * entitlement that resolves to nothing.
 *
 * Note `pro`: it named the SECOND tier in the old catalog, not the third.
 */
const LEGACY_EXPERIENCE_KEYS = {
  free: 'essential',
  pro: 'business',
  '3d': 'goat',
  custom: 'goat',
};

function normaliseExperienceKey(key) {
  const value = String(key ?? '').trim().toLowerCase();
  return LEGACY_EXPERIENCE_KEYS[value] ?? value;
}

export async function recordPayment(admin, { orderId, amountInPaise, providerOrderId, providerPaymentId, rawPayload }) {
  const { error } = await admin.from('payments').upsert(
    {
      order_id: orderId,
      provider: 'razorpay',
      provider_order_id: providerOrderId,
      provider_payment_id: providerPaymentId,
      status: 'paid',
      amount_in_paise: amountInPaise,
      raw_payload: rawPayload ?? null,
      verified_at: new Date().toISOString(),
    },
    { onConflict: 'provider_payment_id' },
  );

  // A payment we cannot record is a payment we cannot reconcile later.
  if (error) throw new Error(`Failed to record payment: ${error.message}`);
}

export async function markPaymentFailed(admin, { orderId, amountInPaise, providerOrderId, providerPaymentId, rawPayload }) {
  await admin.from('payments').upsert(
    {
      order_id: orderId,
      provider: 'razorpay',
      provider_order_id: providerOrderId,
      provider_payment_id: providerPaymentId,
      status: 'failed',
      amount_in_paise: amountInPaise,
      raw_payload: rawPayload ?? null,
    },
    { onConflict: 'provider_payment_id' },
  );
}

/**
 * Marks the order paid and grants everything it bought.
 * @returns {{orderId: string, newlyFulfilled: boolean}}
 */
export async function fulfilOrder(admin, orderId) {
  const { data: order, error: orderError } = await admin
    .from('orders')
    .select('id, user_id, order_id, order_type, plan_id, product_id, product_name, material, tier, plan, amount, amount_in_paise, payment_status, order_status, fulfillment_status, created_at')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError) throw new Error(`Order lookup failed: ${orderError.message}`);
  if (!order) throw new Error(`Order not found: ${orderId}`);

  if (order.fulfillment_status === 'fulfilled') {
    return { orderId: order.id, newlyFulfilled: false };
  }

  // Claim both newly-paid orders and previously-paid orders that were left in
  // retryable state by an interrupted fulfilment. The claim is atomic, so only
  // one webhook/browser path owns the side effects at a time.
  const { data: claimed, error: claimError } = await admin
    .from('orders')
    .update({
      payment_status: 'paid',
      order_status: 'processing',
      fulfillment_status: 'processing',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId)
    .in('payment_status', [...PAYABLE_STATUSES, 'paid'])
    .in('fulfillment_status', ['pending', 'retry'])
    .select('id');

  if (claimError) throw new Error(`Failed to claim fulfilment: ${claimError.message}`);

  if (!claimed || claimed.length === 0) {
    return { orderId: order.id, newlyFulfilled: false };
  }

  try {
    const { data: itemRows, error: itemsError } = await admin
      .from('order_items')
      .select('id, sku, name, product_type, quantity')
      .eq('order_id', order.id);

    if (itemsError) throw new Error(`Order items lookup failed: ${itemsError.message}`);

    const items = itemRows ?? [];
    if (items.length > 0) {
      await grantFromLineItems(admin, order, items);
    } else {
      await grantFromLegacyColumns(admin, order);
    }

    await ensureTapProfile(admin, order);

    const { error: completeError } = await admin
      .from('orders')
      .update({
        fulfillment_status: 'fulfilled',
        fulfilled_at: new Date().toISOString(),
        order_status: 'processing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('fulfillment_status', 'processing');

    if (completeError) throw new Error(`Failed to finalize fulfilment: ${completeError.message}`);

    return { orderId: order.id, newlyFulfilled: true };
  } catch (error) {
    // Leave payment as paid — the customer already paid. Mark the fulfilment
    // retryable so a later webhook or reconciliation call can safely try again.
    const { error: releaseError } = await admin
      .from('orders')
      .update({
        fulfillment_status: 'retry',
        payment_status: 'paid',
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .eq('fulfillment_status', 'processing');
    if (releaseError) console.error('[fulfilment] failed to mark retryable', releaseError.message);
    throw error;
  }
}

/** Line items are authoritative: they are what the customer was charged for. */
async function grantFromLineItems(admin, order, items) {
  for (const item of items) {
    switch (item.product_type) {
      case 'card': {
        await grantEntitlement(admin, order.user_id, 'card', item.sku, order.id);
        await issueCards(admin, order, item);
        await decrementStock(admin, item.id, item.sku, item.quantity ?? 1);
        break;
      }
      case 'digital_plan': {
        const experience = normaliseExperienceKey(item.sku.replace(/^plan-/, ''));
        // Essential ships with every Tap, so it is never an entitlement row.
        if (experience && experience !== 'essential') {
          await grantEntitlement(admin, order.user_id, 'digital_plan', experience, order.id);
        }
        break;
      }
      case 'lifetime_plan': {
        // The ₹999 Customization Pass. It buys unlimited editing and the full
        // colour palette — NOT the paid experiences. Business, Premium and GOAT
        // are separate purchases, and granting them here would hand over the
        // entire catalogue for ₹999.
        await grantEntitlement(admin, order.user_id, 'lifetime', 'lifetime', order.id);
        break;
      }
      case 'customization': {
        // The public renderer checks for 'whatsapp', not 'addon-whatsapp'.
        const key = item.sku.replace(/^addon-/, '');
        await grantEntitlement(admin, order.user_id, 'customization', key, order.id);
        break;
      }
      default:
        console.warn('[fulfilment] unknown product_type', item.product_type, item.sku);
        break;
    }
  }
}

async function grantFromLegacyColumns(admin, order) {
  const orderType = order.order_type || 'physical';
  const planId = order.plan_id || order.plan || null;

  if (orderType === 'lifetimeCustomization') {
    // See the note in grantFromLineItems: the Pass does not grant experiences.
    await grantEntitlement(admin, order.user_id, 'lifetime', 'lifetime', order.id);
    return;
  }

  const experience = normaliseExperienceKey(planId);

  if (orderType === 'digitalUpgrade') {
    if (experience && experience !== 'essential') {
      await grantEntitlement(admin, order.user_id, 'digital_plan', experience, order.id);
    }
    return;
  }

  const cardKey = order.product_id ? String(order.product_id) : 'card';
  await grantEntitlement(admin, order.user_id, 'card', cardKey, order.id);
  if (experience && experience !== 'essential') {
    await grantEntitlement(admin, order.user_id, 'digital_plan', experience, order.id);
  }
}

async function grantEntitlement(admin, userId, type, key, sourceOrderId) {
  const { error } = await admin.from('entitlements').upsert(
    {
      user_id: userId,
      type,
      key,
      source_order_id: sourceOrderId,
      is_active: true,
    },
    { onConflict: 'user_id,type,key' },
  );

  // The customer has paid — a failed grant must never be swallowed.
  if (error) throw new Error(`Failed to grant ${type}:${key} — ${error.message}`);
}

/**
 * One card record per purchased card. The unique index on (order_id, sku) means
 * a replayed webhook cannot mint extra cards, so this is safe to re-run.
 */
async function issueCards(admin, order, item) {
  const { error } = await admin.from('cards').upsert(
    {
      user_id: order.user_id,
      order_id: order.id,
      sku: item.sku,
      status: 'pending',
      is_replacement: /replacement/i.test(item.name ?? ''),
    },
    { onConflict: 'order_id,sku', ignoreDuplicates: true },
  );

  // A missing card record is an operational problem, not a reason to fail the
  // customer's whole fulfilment — the entitlement is what unlocks their Tap.
  if (error) console.error('[fulfilment] card issue failed', item.sku, error.message);
}

async function decrementStock(admin, orderItemId, sku, quantity) {
  const { error } = await admin.rpc('fulfil_card_stock', {
    p_order_item_id: orderItemId,
    p_sku: sku,
    p_quantity: quantity,
  });
  if (error) throw new Error(`Stock fulfilment failed for ${sku}: ${error.message}`);
}

/**
 * Safety net: every paying customer ends up with a Tap profile.
 *
 * A database trigger on `orders` does this too, inside the transaction that
 * marks the order paid. Both are guarded by the unique index on
 * tap_profiles(user_id), so running both is harmless and losing either one
 * still leaves the customer provisioned.
 */
async function ensureTapProfile(admin, order) {
  const userId = order.user_id;
  const { data: existing } = await admin
    .from('tap_profiles')
    .select('id, slug, edit_window_started_at')
    .eq('user_id', userId)
    .maybeSingle();

  // The editing window is dated from the FIRST paid order, so an upgrade
  // bought later must never reopen it. The database trigger does this too;
  // both take the earlier of the two values, so running both is harmless.
  if (existing && order.created_at) {
    const current = existing.edit_window_started_at;
    if (!current || new Date(order.created_at) < new Date(current)) {
      const { error } = await admin
        .from('tap_profiles')
        .update({ edit_window_started_at: order.created_at })
        .eq('id', existing.id);
      if (error) console.error('[fulfilment] edit window stamp failed', error.message);
    }
  }

  if (existing?.slug) return;

  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();

  const { data: slug, error: slugError } = await admin.rpc('generate_tap_slug', {
    p_user: userId,
  });

  if (slugError) {
    console.error('[fulfilment] slug generation failed', slugError.message);
    return;
  }

  if (existing) {
    const { error } = await admin
      .from('tap_profiles')
      .update({ slug, username: slug })
      .eq('id', existing.id)
      .is('slug', null);
    if (error) console.error('[fulfilment] slug assignment failed', error.message);
    return;
  }

  const { error } = await admin.from('tap_profiles').upsert(
    {
      user_id: userId,
      customer_id: userId,
      published: false,
      status: 'draft',
      slug,
      username: slug,
      display_name: profile?.full_name ?? null,
      email: profile?.email ?? null,
      selected_ui_tier: 'essential',
      enabled_customizations: ['phone', 'email'],
      edit_window_started_at: order.created_at ?? null,
    },
    { onConflict: 'user_id', ignoreDuplicates: true },
  );

  if (error) console.error('[fulfilment] tap profile provisioning failed', error.message);
}
