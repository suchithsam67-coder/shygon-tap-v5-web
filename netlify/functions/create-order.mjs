import { adminClient, getRequestUser, json, MissingSecretError, requireEnv } from '../lib/supabase.mjs';

/**
 * POST /api/create-order
 *
 * Creates the SHYGON order row AND the Razorpay order in one authenticated
 * step, so the two are linked from the start via orders.razorpay_order_id.
 * Without that link the webhook has no way to find the order it must fulfil.
 *
 * The request body states an INTENT — which card, which plan, which add-ons,
 * how many. Every price is then read from the `products` table. Nothing the
 * browser sends is treated as money.
 */

const MAX_QUANTITY = 10;
/** Razorpay rejects anything under ₹1. */
const MIN_AMOUNT_IN_PAISE = 100;

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const keyId = requireEnv('RAZORPAY_KEY_ID');
    const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
    const admin = adminClient();

    // The order must belong to a real, authenticated customer — otherwise an
    // anonymous caller could create orders against someone else's account.
    const user = await getRequestUser(admin, request);
    if (!user) return json({ error: 'You must be signed in to place an order.' }, 401);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }

    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const orderType = str(body?.orderType) || 'physical';

    const quantity = normaliseQuantity(body?.quantity);
    if (quantity === null) {
      return json({ error: `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.` }, 400);
    }

    let lineItems;
    try {
      lineItems = await resolveLineItems(admin, { body, orderType, quantity, str, user });
    } catch (error) {
      if (error instanceof IntentError) return json({ error: error.message }, error.status);
      throw error;
    }

    if (lineItems.length === 0) {
      return json({ error: 'Your order is empty.' }, 400);
    }

    // --- Inventory ----------------------------------------------------------
    for (const item of lineItems) {
      // Digital goods carry a NULL stock, meaning unlimited.
      if (item.stock !== null && item.stock !== undefined && item.stock < item.quantity) {
        return json(
          {
            error:
              item.stock <= 0
                ? `${item.name} is out of stock.`
                : `Only ${item.stock} of ${item.name} left in stock.`,
          },
          409,
        );
      }
    }

    const amountInPaise = lineItems.reduce((sum, item) => sum + item.line_total_in_paise, 0);
    if (!Number.isInteger(amountInPaise) || amountInPaise < MIN_AMOUNT_IN_PAISE) {
      return json({ error: 'Order total must be at least ₹1.' }, 400);
    }

    // --- Shipping (physical goods only) -------------------------------------
    const isPhysical = orderType === 'physical';
    const shipping = {
      name: str(body?.shipping?.name),
      phone: str(body?.shipping?.phone),
      address: str(body?.shipping?.address),
      city: str(body?.shipping?.city),
      state: str(body?.shipping?.state),
      pincode: str(body?.shipping?.pincode),
    };

    if (isPhysical) {
      const missing = ['name', 'phone', 'address', 'city', 'state', 'pincode'].filter(
        (field) => !shipping[field],
      );
      if (missing.length > 0) {
        return json({ error: `Delivery details incomplete (missing: ${missing.join(', ')}).` }, 400);
      }
      // Six digits, never starting with 0 (same rule as /api/check-delivery).
      if (!/^[1-9]\d{5}$/.test(shipping.pincode)) {
        return json({ error: 'Enter a valid 6-digit PIN code.' }, 400);
      }
      if (shipping.phone.replace(/\D/g, '').length < 10) {
        return json({ error: 'Enter a valid phone number.' }, 400);
      }
    }

    const shygonOrderId = `ST-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const productName = lineItems
      .map((item) => (item.quantity > 1 ? `${item.name} x${item.quantity}` : item.name))
      .join(' + ');

    // --- Razorpay order -----------------------------------------------------
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    let rzpOrder;
    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: 'INR',
          receipt: shygonOrderId.slice(0, 40),
          notes: {
            userId: user.id,
            orderType,
            skus: lineItems.map((i) => i.sku).join(','),
          },
        }),
      });

      if (response.status === 401) return json({ error: 'Razorpay authentication failed.' }, 401);
      if (!response.ok) {
        // Never echo the gateway body back — it can leak key details.
        console.error('Razorpay create order failed', response.status, await response.text());
        return json({ error: 'Unable to create the payment order.' }, 502);
      }
      rzpOrder = await response.json();
    } catch (error) {
      console.error('Razorpay connection error', error);
      return json({ error: 'Unable to connect to Razorpay.' }, 502);
    }

    // --- SHYGON order row (server-side, unpaid) -----------------------------
    const primary = lineItems[0];
    const planItem = lineItems.find((i) => i.product_type === 'digital_plan');
    const cardItem = lineItems.find((i) => i.product_type === 'card');

    const { data: created, error: insertError } = await admin
      .from('orders')
      .insert({
        order_id: shygonOrderId,
        user_id: user.id,
        customer_id: user.id,
        product_id: cardItem?.category ?? null,
        product_name: productName,
        material: cardItem?.material ?? null,
        tier: cardItem?.tier ?? null,
        plan: planItem?.planId ?? null,
        plan_id: planItem?.planId ?? null,
        order_type: orderType,
        category: isPhysical ? 'Shygon Tap' : 'Shygon Tap Upgrade',
        amount: amountInPaise / 100,
        amount_in_paise: amountInPaise,
        payment_status: 'pending',
        order_status: 'placed',
        razorpay_order_id: rzpOrder.id,
        shipping_name: isPhysical ? shipping.name : null,
        shipping_phone: isPhysical ? shipping.phone : null,
        shipping_address: isPhysical ? shipping.address : null,
        shipping_city: isPhysical ? shipping.city : null,
        shipping_state: isPhysical ? shipping.state : null,
        shipping_pincode: isPhysical ? shipping.pincode : null,
      })
      .select('id, order_id')
      .single();

    if (insertError || !created) {
      console.error('Order insert failed', insertError);
      return json({ error: 'Could not save your order.' }, 500);
    }

    // Line items are what fulfilment reads to decide which entitlements to
    // grant, so a failure here must not leave a payable order behind.
    const { error: itemsError } = await admin.from('order_items').insert(
      lineItems.map((item) => ({
        order_id: created.id,
        sku: item.sku,
        name: item.name,
        product_type: item.product_type,
        unit_price_in_paise: item.unit_price_in_paise,
        quantity: item.quantity,
        line_total_in_paise: item.line_total_in_paise,
      })),
    );

    if (itemsError) {
      console.error('Order items insert failed', itemsError);
      await admin.from('orders').delete().eq('id', created.id);
      return json({ error: 'Could not save your order.' }, 500);
    }

    return json({
      order_id: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      receipt: shygonOrderId,
      shygonOrderId: created.order_id,
      key_id: keyId,
      description: productName.slice(0, 255),
    });
  } catch (error) {
    if (error instanceof MissingSecretError) {
      console.error(error.message);
      return json({ error: 'Payments are not configured on this server.' }, 503);
    }
    console.error('Create order error', error);
    return json({ error: 'Unable to create the order.' }, 500);
  }
};

/** A problem with what the customer asked for, not with the server. */
class IntentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function normaliseQuantity(value) {
  if (value === undefined || value === null || value === '') return 1;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) return null;
  return n;
}

/**
 * Turns the stated intent into priced line items, reading every price and stock
 * level from the database.
 */
/**
 * The only digital experiences that can be bought. Essential ships with every
 * Tap and is never sold; 'custom' was retired in migration 004.
 */
const SELLABLE_EXPERIENCES = new Set(['business', 'premium', 'goat']);
const EXPERIENCE_RANKS = { essential: 0, business: 1, premium: 2, goat: 3 };

/** The ₹999 Customization Pass, newest SKU first. */
const PASS_SKUS = ['pass-customization', 'plan-lifetime'];

async function lookupPass(admin) {
  for (const sku of PASS_SKUS) {
    const product = await lookupProduct(admin, sku);
    if (product) return product;
  }
  return null;
}

async function resolveLineItems(admin, { body, orderType, quantity, str, user }) {
  const items = [];

  if (orderType === 'digitalUpgrade') {
    const planId = str(body?.planId);
    if (!planId) throw new IntentError('A digital experience must be selected.');
    if (planId === 'essential') {
      throw new IntentError('The Essential experience is already included with your Tap.');
    }
    // Without this a caller could name any `plan-*` row, including the retired
    // Custom SKU or the lifetime pass at the wrong intent.
    if (!SELLABLE_EXPERIENCES.has(planId)) {
      throw new IntentError("This experience isn't currently available for your Tap.");
    }

    const { data: ownedExperiences, error: ownedError } = await admin
      .from('entitlements')
      .select('key')
      .eq('user_id', user.id)
      .eq('type', 'digital_plan')
      .eq('is_active', true);
    if (ownedError) throw new Error(`Could not verify owned experiences: ${ownedError.message}`);

    const requestedRank = EXPERIENCE_RANKS[planId];
    const ownedRanks = (ownedExperiences ?? []).map((row) => EXPERIENCE_RANKS[normaliseExperienceKey(row.key)] ?? -1);
    const highestOwnedRank = Math.max(-1, ...ownedRanks);
    if (highestOwnedRank >= requestedRank) {
      throw new IntentError(
        highestOwnedRank === requestedRank
          ? `You already own the ${planId} experience.`
          : `You already own a higher digital experience.`,
        409,
      );
    }

    const plan = await lookupProduct(admin, `plan-${planId}`);
    if (!plan) throw new IntentError("This experience isn't currently available for your Tap.");
    if (plan.price_in_paise <= 0) throw new IntentError('That experience is already included.');

    items.push(toLineItem(plan, 1, { planId }));
    return items;
  }

  if (orderType === 'lifetimeCustomization') {
    // Buying it twice would charge again for something already owned.
    const { data: owned } = await admin
      .from('entitlements')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'lifetime')
      .eq('is_active', true)
      .maybeSingle();

    if (owned) {
      throw new IntentError('You already have the Customization Pass.', 409);
    }

    const pass = await lookupPass(admin);
    if (!pass) throw new IntentError('The Customization Pass is unavailable.');
    items.push(toLineItem(pass, 1, { planId: 'lifetime' }));
    return items;
  }

  if (orderType === 'customization') {
    const requested = Array.isArray(body?.customizationSkus) ? body.customizationSkus : [];
    const skus = [...new Set(requested.map(str).filter(Boolean))];

    if (skus.length === 0) throw new IntentError('Select at least one customization.');
    if (skus.length > 20) throw new IntentError('Too many customizations in one order.');

    const { data: ownedAddons, error: ownedAddonError } = await admin
      .from('entitlements')
      .select('key')
      .eq('user_id', user.id)
      .eq('type', 'customization')
      .eq('is_active', true);
    if (ownedAddonError) throw new Error(`Could not verify owned customizations: ${ownedAddonError.message}`);
    const ownedAddonKeys = new Set((ownedAddons ?? []).map((row) => row.key));

    for (const sku of skus) {
      // Only add-on SKUs may be bought through this path; without this a caller
      // could pass 'plan-3d' and buy a tier at customization prices.
      if (!sku.startsWith('addon-')) throw new IntentError('Unknown customization.');

      const addon = await lookupProduct(admin, sku);
      if (!addon || addon.product_type !== 'customization') {
        throw new IntentError('That customization is not available.');
      }
      const entitlementKey = sku.replace(/^addon-/, '');
      if (ownedAddonKeys.has(entitlementKey)) {
        throw new IntentError(`You already own the ${addon.name}.`, 409);
      }
      items.push(toLineItem(addon, 1));
    }
    return items;
  }

  // --- Physical card ------------------------------------------------------
  const productId = str(body?.productId);
  const material = str(body?.material);
  const tier = str(body?.tier);
  const planId = str(body?.planId);

  if (!productId || !material || !tier) {
    throw new IntentError('Card, material and finish are all required.');
  }

  const card = await lookupProduct(admin, `card-${productId}-${tier}-${material}`);
  if (!card) throw new IntentError('That card configuration is not available.');

  items.push(toLineItem(card, quantity, { category: productId, material, tier }));

  // 'essential' is bundled at ₹0; anything else is a paid experience bought
  // once, regardless of how many cards are in the order.
  if (planId && planId !== 'essential') {
    if (!SELLABLE_EXPERIENCES.has(planId)) {
      throw new IntentError("That digital experience isn't available.");
    }

    const { data: ownedExperiences, error: ownedError } = await admin
      .from('entitlements')
      .select('key')
      .eq('user_id', user.id)
      .eq('type', 'digital_plan')
      .eq('is_active', true);
    if (ownedError) throw new Error(`Could not verify owned experiences: ${ownedError.message}`);

    const requestedRank = EXPERIENCE_RANKS[planId];
    const highestOwnedRank = Math.max(
      -1,
      ...(ownedExperiences ?? []).map((row) => EXPERIENCE_RANKS[normaliseExperienceKey(row.key)] ?? -1),
    );
    if (highestOwnedRank >= requestedRank) {
      throw new IntentError(
        highestOwnedRank === requestedRank
          ? `You already own the ${planId} experience.`
          : `You already own a higher digital experience.`,
        409,
      );
    }

    const plan = await lookupProduct(admin, `plan-${planId}`);
    if (!plan) throw new IntentError("That digital experience isn't available.");
    if (plan.price_in_paise > 0) items.push(toLineItem(plan, 1, { planId }));
  }

  return items;
}

function toLineItem(product, quantity, extra = {}) {
  return {
    sku: product.sku,
    name: product.name,
    product_type: product.product_type ?? 'card',
    unit_price_in_paise: product.price_in_paise,
    quantity,
    line_total_in_paise: product.price_in_paise * quantity,
    stock: product.stock ?? null,
    ...extra,
  };
}

async function lookupProduct(admin, sku) {
  const { data, error } = await admin
    .from('products')
    .select('id, sku, name, price_in_paise, stock, product_type, active')
    .eq('sku', sku)
    .maybeSingle();

  if (error) {
    console.error('Product lookup failed', sku, error.message);
    return null;
  }
  if (!data || data.active === false) return null;
  if (!Number.isInteger(data.price_in_paise)) {
    console.error('Product has no price_in_paise', sku);
    return null;
  }
  return data;
}
