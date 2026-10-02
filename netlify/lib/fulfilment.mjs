import { sendOrderConfirmation } from './orderMessages.mjs';

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

/**
 * What of a Razorpay payload we keep. Razorpay never sends a full card number
 * or CVV, but a payment entity does carry card metadata (last four digits,
 * network, issuer, a card id) and sometimes a UPI id or token. None of it is
 * needed to reconcile a payment, so none of it is stored.
 */
const SENSITIVE_PAYMENT_KEYS = ['card', 'card_id', 'token', 'token_id', 'vpa', 'upi', 'bank_account', 'emi'];

export function redactPaymentPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload ?? null;
  const copy = JSON.parse(JSON.stringify(payload));
  const scrub = (entity) => {
    if (!entity || typeof entity !== 'object') return;
    for (const key of SENSITIVE_PAYMENT_KEYS) delete entity[key];
  };
  scrub(copy?.payload?.payment?.entity);
  scrub(copy?.payment);
  scrub(copy);
  return copy;
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
      raw_payload: redactPaymentPayload(rawPayload),
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
      raw_payload: redactPaymentPayload(rawPayload),
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
    // Every column, so the fields added later (replaces_card_id, migration 023)
    // come along when present without failing on a database that lacks them.
    .select('*')
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
    await applyProfileDetails(admin, order);

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

    // Text the customer their confirmation. Once per order, never fatal.
    await sendOrderConfirmation(admin, order.id);

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
      case 'delivery':
        // The delivery charge (migration 023): paid for, nothing to grant.
        break;
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
 * One card record per purchased card line. The database gives it its permanent
 * Card ID and its own page (migration 022); a replacement order links the new
 * card to the replaced card's page instead.
 *
 * A plain insert, not an upsert: the unique index on cards(order_id, sku) is
 * partial (WHERE order_id IS NOT NULL), and `ON CONFLICT (order_id, sku)` cannot
 * use a partial index without repeating its predicate — every upsert failed
 * with 42P10 and no card was ever issued. A replay now hits the index and gets
 * 23505, which means "already issued" and is exactly as safe.
 */
async function issueCards(admin, order, item) {
  const { data: existing } = await admin
    .from('cards')
    .select('id')
    .eq('order_id', order.id)
    .eq('sku', item.sku)
    .maybeSingle();
  if (existing) return;

  const row = {
    user_id: order.user_id,
    order_id: order.id,
    sku: item.sku,
    status: 'pending',
    is_replacement: Boolean(order.replaces_card_id) || /replacement/i.test(item.name ?? ''),
  };
  if (order.replaces_card_id) row.replaces_card_id = order.replaces_card_id;

  const { error } = await admin.from('cards').insert(row);
  if (!error || error.code === '23505') return;

  // A missing card record is an operational problem, not a reason to fail the
  // customer's whole fulfilment — the entitlement is what unlocks their Tap.
  console.error('[fulfilment] card issue failed', item.sku, error.message);
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
 * Safety net: every paying customer ends up with a Tap page.
 *
 * Since migration 022 the database does this itself: the payment trigger
 * provisions a customer's first page, and every issued card gets its own page
 * (published automatically) when its row is written. This covers a database
 * where neither trigger ran, and keeps the reference "edit window started"
 * date on the customer's pages.
 */
async function ensureTapProfile(admin, order) {
  const userId = order.user_id;
  const { data: pages, error } = await admin
    .from('tap_profiles')
    .select('id, slug, edit_window_started_at')
    .eq('user_id', userId);

  if (error) {
    console.error('[fulfilment] page lookup failed', error.message);
    return;
  }

  if (!pages || pages.length === 0) {
    const { error: provisionError } = await admin.rpc('provision_tap_page', {
      p_user: userId,
      p_started: order.created_at ?? new Date().toISOString(),
      p_experience: (order.order_type ?? 'physical') === 'physical' ? order.plan_id ?? order.plan ?? 'essential' : null,
    });
    if (!provisionError) return;
    // Before migration 022: the one-page-per-customer path.
    if (provisionError.code === 'PGRST202' || provisionError.code === '42883') {
      await legacyProvision(admin, order);
      return;
    }
    console.error('[fulfilment] page provisioning failed', provisionError.message);
    return;
  }

  // The editing window is dated from the FIRST paid order; a later purchase
  // must never move it. Reference only — the rule itself is per page.
  if (order.created_at) {
    for (const page of pages) {
      if (page.edit_window_started_at && new Date(order.created_at) >= new Date(page.edit_window_started_at)) continue;
      const { error: stampError } = await admin
        .from('tap_profiles')
        .update({ edit_window_started_at: order.created_at })
        .eq('id', page.id);
      if (stampError) console.error('[fulfilment] edit window stamp failed', stampError.message);
    }
  }
}

/** The pre-022 provisioning: one draft Tap per customer, keyed on user_id. */
async function legacyProvision(admin, order) {
  const userId = order.user_id;
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();

  const { data: slug, error: slugError } = await admin.rpc('generate_tap_slug', { p_user: userId });
  if (slugError) {
    console.error('[fulfilment] slug generation failed', slugError.message);
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

// Migration 027's public.tier_buttons(), mirrored: the buttons a tier includes.
const TIER_BUTTONS = {
  essential: ['phone', 'email', 'whatsapp'],
  business: ['phone', 'email', 'whatsapp', 'instagram', 'linkedin', 'website'],
  premium: ['phone', 'email', 'whatsapp', 'instagram', 'linkedin', 'website', 'location', 'youtube', 'links'],
  goat: ['phone', 'email', 'whatsapp', 'instagram', 'linkedin', 'website', 'location', 'youtube', 'links', 'gallery'],
};
const DETAIL_COLUMNS = {
  displayName: 'display_name', designation: 'designation', company: 'company', phone: 'phone', email: 'email',
  whatsapp: 'whatsapp', instagram: 'instagram', linkedin: 'linkedin', website: 'website', location: 'location',
  youtube: 'youtube',
};

/**
 * Copies the Card details page into the page(s) this order's cards opened.
 * Only empty fields are filled, so a retried fulfilment (or a customer who has
 * already edited the page) is never overwritten. Buttons the page's tier
 * includes are switched on when they have a value.
 */
export async function applyProfileDetails(admin, order) {
  const details = order.profile_details;
  if (!details || typeof details !== 'object' || order.replaces_card_id) return;
  try {
    const { data: cards } = await admin.from('cards').select('tap_profile_id').eq('order_id', order.id);
    const ids = [...new Set((cards ?? []).map((c) => c.tap_profile_id).filter(Boolean))];
    if (ids.length === 0) return;
    const { data: pages } = await admin
      .from('tap_profiles')
      .select('id, selected_ui_tier, enabled_customizations, ' + Object.values(DETAIL_COLUMNS).join(', '))
      .in('id', ids);
    for (const page of pages ?? []) {
      const patch = {};
      for (const [key, column] of Object.entries(DETAIL_COLUMNS)) {
        const value = typeof details[key] === 'string' ? details[key].trim() : '';
        if (value && !String(page[column] ?? '').trim()) patch[column] = value;
      }
      const included = TIER_BUTTONS[String(page.selected_ui_tier ?? 'essential').toLowerCase()] ?? TIER_BUTTONS.essential;
      const enabled = new Set(page.enabled_customizations ?? ['phone', 'email']);
      for (const button of included) {
        const column = DETAIL_COLUMNS[button];
        if (column && (patch[column] ?? page[column])) enabled.add(button);
      }
      if (enabled.size !== (page.enabled_customizations ?? []).length) patch.enabled_customizations = [...enabled].sort();
      if (Object.keys(patch).length === 0) continue;
      const { error } = await admin.from('tap_profiles').update(patch).eq('id', page.id);
      if (error) console.error('[fulfilment] card details not applied', error.message);
    }
  } catch (error) {
    // The page exists either way; the customer can still fill it in by hand.
    console.error('[fulfilment] card details failed', error?.message ?? error);
  }
}
