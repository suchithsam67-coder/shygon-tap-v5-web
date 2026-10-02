import { adminClient, getRequestUser, json, MissingSecretError, requireEnv } from '../lib/supabase.mjs';
import { assertLiveKeysAllowed, PaymentNotConfirmedError } from '../lib/razorpay.mjs';
import { normaliseExperienceKey } from '../lib/fulfilment.mjs';

/**
 * POST /api/create-order
 *
 * Creates the SHYGON order row AND the Razorpay order in one authenticated
 * step, so the two are linked from the start via orders.razorpay_order_id.
 * Without that link the webhook has no way to find the order it must fulfil.
 *
 * The request body states an INTENT — which card, which plan, which add-ons,
 * how many, and optionally a promo code. Every price is then read from the
 * `products` table, the delivery charge included, and a promo code is checked
 * and reserved by the database. Nothing the browser sends is treated as money.
 */

const MAX_QUANTITY = 10;
/** Razorpay rejects anything under ₹1. */
const MIN_AMOUNT_IN_PAISE = 100;
/** The delivery charge's catalogue row (migration 023), and its price if that row is missing. */
const DELIVERY_SKU = 'delivery-standard';
const DELIVERY_FALLBACK_IN_PAISE = 4900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Postgres / PostgREST "no such column" and "no such function". */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);
const MISSING_FUNCTION = new Set(['42883', 'PGRST202']);

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const keyId = requireEnv('RAZORPAY_KEY_ID');
    const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
    // Live keys never charge real money from a developer's machine.
    assertLiveKeysAllowed(request);
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

    // --- Delivery (physical goods only) -------------------------------------
    const isPhysical = orderType === 'physical';
    const subtotalInPaise = lineItems.reduce((sum, item) => sum + item.line_total_in_paise, 0);
    let deliveryFeeInPaise = 0;
    if (isPhysical) {
      const delivery = await lookupProduct(admin, DELIVERY_SKU);
      const fee = delivery ? delivery.price_in_paise : DELIVERY_FALLBACK_IN_PAISE;
      deliveryFeeInPaise = fee;
      if (fee > 0) {
        lineItems.push({
          sku: DELIVERY_SKU,
          name: delivery?.name ?? 'Delivery',
          product_type: 'delivery',
          unit_price_in_paise: fee,
          quantity: 1,
          line_total_in_paise: fee,
          stock: null,
        });
      }
    }

    // --- Promo code: a percentage of the cart value, before delivery ---------
    const promoCode = str(body?.promoCode).toUpperCase().slice(0, 40);
    let discountInPaise = 0;
    if (promoCode) {
      const { data: quote, error: quoteError } = await admin.rpc('promo_evaluate', {
        p_code: promoCode,
        p_user: user.id,
        p_subtotal: subtotalInPaise,
        p_order_type: orderType,
      });
      if (quoteError) {
        if (MISSING_FUNCTION.has(quoteError.code)) {
          return json({ error: 'Promo codes are not available right now. Remove the code to continue.' }, 503);
        }
        throw new Error(`Promo check failed: ${quoteError.message}`);
      }
      if (!quote?.ok) return json({ error: quote?.message ?? 'This promo code is not valid.' }, 400);
      discountInPaise = Math.max(0, Math.min(subtotalInPaise, Number(quote.discountInPaise) || 0));
    }

    // --- Addresses ------------------------------------------------------------
    const isPhysicalOrder = orderType === 'physical';
    const billingInput = body?.billing && typeof body.billing === 'object' ? body.billing : {};
    const billingSame = isPhysicalOrder ? billingInput.sameAsShipping !== false : false;
    const billing = {
      name: str(billingInput.name).slice(0, 120),
      company: str(billingInput.company).slice(0, 120),
      phone: str(billingInput.phone).slice(0, 20),
      email: str(billingInput.email).slice(0, 160),
      address: str(billingInput.address).slice(0, 300),
      line2: str(billingInput.line2).slice(0, 200),
      locality: str(billingInput.locality).slice(0, 120),
      city: str(billingInput.city).slice(0, 80),
      state: str(billingInput.state).slice(0, 80),
      pincode: str(billingInput.pincode).slice(0, 12),
      country: str(billingInput.country).slice(0, 60) || 'India',
    };
    const customerGstin = str(billingInput.gstin).toUpperCase();
    if (customerGstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(customerGstin)) {
      return json({ error: 'Enter a valid 15-character GSTIN, or leave it empty.' }, 400);
    }
    if (isPhysicalOrder && !billingSame) {
      const missingBilling = ['name', 'address', 'city', 'state', 'pincode'].filter((field) => !billing[field]);
      if (missingBilling.length > 0) {
        return json({ error: `Billing address incomplete (missing: ${missingBilling.join(', ')}).` }, 400);
      }
      if (!/^[1-9]\d{5}$/.test(billing.pincode)) return json({ error: 'Enter a valid 6-digit billing PIN code.' }, 400);
    }
    if (billing.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billing.email)) {
      return json({ error: 'Enter a valid billing email address.' }, 400);
    }

    // --- GST: from tax_settings (migration 026), never from the browser ------
    const { data: taxSettings } = await admin.from('tax_settings').select('*').limit(1).maybeSingle();
    const taxRate = taxSettings?.enabled ? Number(taxSettings.rate_percent) || 0 : 0;
    const taxInclusive = taxSettings ? taxSettings.prices_include_tax !== false : true;
    const beforeTax = subtotalInPaise - discountInPaise + deliveryFeeInPaise;
    let taxInPaise = 0;
    if (taxRate > 0) {
      taxInPaise = taxInclusive
        ? Math.round(beforeTax - (beforeTax * 100) / (100 + taxRate))
        : Math.round((beforeTax * taxRate) / 100);
    }
    const amountInPaise = taxInclusive ? beforeTax : beforeTax + taxInPaise;
    // Place of supply: the delivery state for a card, the billing state otherwise.
    const supplyState = (isPhysicalOrder ? str(body?.shipping?.state) : billing.state) || taxSettings?.seller_state || '';
    const taxSplit =
      taxInPaise === 0
        ? 'none'
        : supplyState.toLowerCase() === String(taxSettings?.seller_state ?? 'Karnataka').toLowerCase()
          ? 'cgst_sgst'
          : 'igst';

    if (!Number.isInteger(amountInPaise) || amountInPaise < MIN_AMOUNT_IN_PAISE) {
      return json({ error: 'Order total must be at least ₹1.' }, 400);
    }

    // --- Shipping (physical goods only) -------------------------------------
    const shipping = {
      name: str(body?.shipping?.name),
      phone: str(body?.shipping?.phone),
      address: str(body?.shipping?.address),
      city: str(body?.shipping?.city),
      state: str(body?.shipping?.state),
      pincode: str(body?.shipping?.pincode),
      email: str(body?.shipping?.email).slice(0, 160),
      line2: str(body?.shipping?.line2).slice(0, 200),
      locality: str(body?.shipping?.locality).slice(0, 120),
      country: str(body?.shipping?.country).slice(0, 60) || 'India',
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
      .filter((item) => item.product_type !== 'delivery')
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
            ...(promoCode ? { promo: promoCode } : {}),
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

    const replacesCardId = lineItems.find((i) => i.replacesCardId)?.replacesCardId ?? null;
    const baseRow = {
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
    };
    // Migration 023's columns. A database without them still takes an order
    // with no discount and no replacement; one that needs them is refused
    // rather than charged a total the order row cannot explain.
    const moneyRow = {
      subtotal_in_paise: subtotalInPaise,
      discount_in_paise: discountInPaise,
      delivery_fee_in_paise: deliveryFeeInPaise,
      promo_code: promoCode || null,
      replaces_card_id: replacesCardId,
    };
    // Migration 026: the GST used for THIS order, and the addresses.
    const billingSource = billingSame ? { ...shipping, company: billing.company } : billing;
    const taxRow = {
      tax_in_paise: taxInPaise,
      taxable_value_in_paise: amountInPaise - taxInPaise,
      tax_rate_percent: taxRate,
      tax_inclusive: taxInclusive,
      tax_split: taxSplit,
      customer_gstin: customerGstin || null,
      shipping_email: isPhysical ? shipping.email || user.email || null : null,
      shipping_address_line2: isPhysical ? shipping.line2 || null : null,
      shipping_locality: isPhysical ? shipping.locality || null : null,
      shipping_country: isPhysical ? shipping.country : null,
      billing_same_as_shipping: billingSame,
      billing_name: billingSource.name || null,
      billing_company: billing.company || null,
      billing_phone: billingSource.phone || null,
      billing_email: billingSource.email || billing.email || user.email || null,
      billing_address: billingSource.address || null,
      billing_address_line2: billingSource.line2 || null,
      billing_locality: billingSource.locality || null,
      billing_city: billingSource.city || null,
      billing_state: billingSource.state || null,
      billing_pincode: billingSource.pincode || null,
      billing_country: billingSource.country || (billingSource.address ? 'India' : null),
    };

    // Migration 027: the Card details page (name on card, contact buttons).
    // Plain text only, trimmed and length-capped; never payment data.
    const profileDetails = isPhysical && !replacesCardId ? cleanProfileDetails(body?.profile) : null;
    const profileRow = profileDetails ? { profile_details: profileDetails } : {};

    let { data: created, error: insertError } = await admin
      .from('orders')
      .insert({ ...baseRow, ...moneyRow, ...taxRow, ...profileRow })
      .select('id, order_id')
      .single();

    // Before 027 the details are simply not kept; the customer fills the page in later.
    if (insertError && MISSING_COLUMN.has(insertError.code) && profileDetails) {
      ({ data: created, error: insertError } = await admin
        .from('orders')
        .insert({ ...baseRow, ...moneyRow, ...taxRow })
        .select('id, order_id')
        .single());
    }

    // A database without 026: tax that is added on top cannot be charged on an
    // order row that cannot record it; included tax changes nothing charged.
    if (insertError && MISSING_COLUMN.has(insertError.code)) {
      if (!taxInclusive && taxInPaise > 0) {
        console.error('Order insert needs migration 026', insertError.message);
        return json({ error: 'Checkout is being updated. Please try again shortly.' }, 503);
      }
      ({ data: created, error: insertError } = await admin
        .from('orders')
        .insert({ ...baseRow, ...moneyRow })
        .select('id, order_id')
        .single());
    }

    if (insertError && MISSING_COLUMN.has(insertError.code)) {
      if (discountInPaise > 0 || replacesCardId) {
        console.error('Order insert needs migration 023', insertError.message);
        return json({ error: 'This checkout option is being set up. Please try again shortly.' }, 503);
      }
      ({ data: created, error: insertError } = await admin
        .from('orders')
        .insert(baseRow)
        .select('id, order_id')
        .single());
    }

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

    // Reserve the code against this order. The database locks the code and
    // checks every limit again, so two checkouts cannot both take its last
    // use; if it changed since the quote, the order is withdrawn, not charged.
    if (promoCode) {
      const { data: reserved, error: reserveError } = await admin.rpc('promo_reserve', {
        p_code: promoCode,
        p_user: user.id,
        p_order_id: created.id,
        p_subtotal: subtotalInPaise,
        p_order_type: orderType,
      });
      const reservedDiscount = Number(reserved?.discountInPaise);
      if (reserveError || !reserved?.ok || reservedDiscount !== discountInPaise) {
        if (reserveError) console.error('Promo reserve failed', reserveError.message);
        await admin.from('orders').delete().eq('id', created.id);
        return json(
          {
            error:
              reserved && !reserved.ok
                ? reserved.message
                : 'That promo code just changed. Please apply it again.',
          },
          409,
        );
      }
    }

    return json({
      order_id: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      receipt: shygonOrderId,
      shygonOrderId: created.order_id,
      key_id: keyId,
      description: productName.slice(0, 255),
      subtotal: subtotalInPaise,
      discount: discountInPaise,
      delivery: deliveryFeeInPaise,
      promoCode: promoCode || null,
      tax: taxInPaise,
      taxRate,
      taxInclusive,
    });
  } catch (error) {
    if (error instanceof PaymentNotConfirmedError) return json({ error: error.message }, error.status);
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
  let productId = str(body?.productId);
  let material = str(body?.material);
  let tier = str(body?.tier);
  const planId = str(body?.planId);

  // A replacement re-makes one of the customer's own cards: the design comes
  // from that card, never from the request, and the new card opens the same
  // page (migration 022).
  const replacesCardId = str(body?.replacesCardId);
  let replacing = null;
  if (replacesCardId) {
    if (!UUID.test(replacesCardId)) throw new IntentError('Choose the card to replace.');
    const { data: old, error: oldError } = await admin
      .from('cards')
      .select('id, sku, status, user_id')
      .eq('id', replacesCardId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (oldError) throw new Error(`Card lookup failed: ${oldError.message}`);
    if (!old) throw new IntentError('That card was not found on your account.', 404);
    if (old.status === 'replaced') throw new IntentError('That card has already been replaced.', 409);
    const match = /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(old.sku ?? '');
    if (!match) throw new IntentError('That card cannot be replaced online. Please contact support.');
    [, productId, tier, material] = match;
    replacing = old;
  }

  if (!productId || !material || !tier) {
    throw new IntentError('Card, material and finish are all required.');
  }

  const card = await lookupProduct(admin, `card-${productId}-${tier}-${material}`);
  if (!card) throw new IntentError('That card configuration is not available.');

  if (replacing) {
    items.push({
      ...toLineItem(card, 1, { category: productId, material, tier }),
      name: `${card.name} (replacement)`,
      replacesCardId: replacing.id,
    });
    // A replacement is the card only: the page it opens already exists.
    return items;
  }

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

/** The Card details page, reduced to the known fields as short plain strings. */
const PROFILE_FIELDS = {
  displayName: 60, designation: 80, company: 80, phone: 20, email: 160, whatsapp: 20,
  instagram: 200, linkedin: 200, website: 200, location: 200, youtube: 200,
};
export function cleanProfileDetails(input) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const [key, max] of Object.entries(PROFILE_FIELDS)) {
    const value = typeof input[key] === 'string' ? input[key].replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
    if (value) out[key] = value;
  }
  // A name is what makes the details worth keeping.
  return out.displayName ? out : null;
}
