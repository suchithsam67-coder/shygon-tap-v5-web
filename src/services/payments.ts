import { supabase, razorpayKeyId } from '../lib/supabase';

/**
 * The browser half of the Razorpay flow.
 *
 * What the browser is allowed to do: state an intent, open Checkout, and hand
 * the three callback fields back for verification. What it never does: decide a
 * price, mark an order paid, or grant an entitlement. `create-order` prices the
 * intent from the `products` table, and `verify-payment` re-derives the HMAC
 * before anything is fulfilled.
 *
 * A successful `handler` callback is NOT the end of the purchase. It is only
 * the fast path so the customer sees their purchase immediately; the Razorpay
 * webhook fulfils the same order independently and both are idempotent, so a
 * customer who closes the tab still gets what they paid for.
 */

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  image?: string;
  prefill?: { name?: string; email?: string; contact?: string };
  notes?: Record<string, string>;
  theme?: { color?: string };
  modal?: { ondismiss?: () => void; escape?: boolean; confirm_close?: boolean };
  retry?: { enabled: boolean; max_count?: number };
  config?: {
    display: {
      blocks?: Record<string, { name: string; instruments: { method: string }[] }>;
      sequence?: string[];
      preferences?: { show_default_blocks: boolean };
    };
  };
  handler: (response: RazorpayResponse) => void | Promise<void>;
}

interface RazorpayInstance {
  open: () => void;
  on: (event: 'payment.failed', handler: (response: RazorpayFailure) => void) => void;
}

interface RazorpayFailure {
  error?: { description?: string; reason?: string };
}

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/** Thrown for anything the customer should see a specific message about. */
export class CheckoutError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'auth'
      | 'config'
      | 'network'
      | 'server'
      | 'cancelled'
      | 'failed'
      | 'verification' = 'server',
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new CheckoutError('Razorpay Checkout could not load.', 'network')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new CheckoutError('Razorpay Checkout could not load. Check your connection.', 'network'));
    document.body.appendChild(script);
  });
}

import type { CardProfileDetails } from '../lib/cardDetails';

/** Everything the server needs to price and validate a purchase. */
export type PurchaseIntent = (
  | {
      orderType: 'physical';
      productId: string;
      material: string;
      tier: string;
      planId?: string;
      quantity?: number;
      /** A replacement for one of the customer's cards: same design, same page. */
      replacesCardId?: string;
      /** The Card details page; the server copies it into the new page once paid. */
      profile?: CardProfileDetails;
      shipping: {
        name: string;
        phone: string;
        address: string;
        city: string;
        state: string;
        pincode: string;
        email?: string;
        line2?: string;
        locality?: string;
        country?: string;
      };
    }
  | { orderType: 'digitalUpgrade'; planId: string }
  | { orderType: 'lifetimeCustomization' }
  | { orderType: 'customization'; customizationSkus: string[] }
) & {
  /** A promo code. The server checks it and decides the discount; this is only the code. */
  promoCode?: string;
  /** Billing details. GST is worked out by the server from its own settings. */
  billing?: BillingDetails;
};

export interface BillingDetails {
  sameAsShipping: boolean;
  name?: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  line2?: string;
  locality?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  gstin?: string;
}

interface CreateOrderResponse {
  order_id: string;
  amount: number;
  currency: string;
  receipt: string;
  shygonOrderId: string;
  key_id: string;
  description?: string;
}

export interface CheckoutResult {
  shygonOrderId: string;
  razorpayPaymentId: string;
  alreadyProcessed: boolean;
}

async function authorizedFetch(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new CheckoutError('Your session has expired. Please sign in again.', 'auth');
  }

  try {
    return await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CheckoutError('We could not reach the payment server. Check your connection.', 'network');
  }
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) return payload.error ?? 'Please sign in again to continue.';
  if (response.status === 503) {
    return 'Payments are not configured on this server yet. Please contact support.';
  }
  return payload.error ?? fallback;
}

/**
 * Runs the whole purchase. Resolves only after the server has verified the
 * signature and written the order and entitlements; rejects with a
 * `CheckoutError` describing what the customer should do next.
 */
/**
 * Where a purchase has got to, for the checkout's progress animation. Each
 * stage is reported when it really starts; nothing is timed or simulated.
 */
export type CheckoutStage = 'creating' | 'awaiting-payment' | 'verifying';

export async function startCheckout(
  intent: PurchaseIntent,
  options: {
    customerName?: string;
    customerEmail?: string;
    customerPhone?: string;
    onStage?: (stage: CheckoutStage) => void;
  } = {},
): Promise<CheckoutResult> {
  options.onStage?.('creating');
  const createResponse = await authorizedFetch('/api/create-order', intent);

  if (!createResponse.ok) {
    throw new CheckoutError(await readError(createResponse, 'Unable to start checkout.'), 'server');
  }

  const order = (await createResponse.json().catch(() => null)) as CreateOrderResponse | null;
  if (!order?.order_id || typeof order.amount !== 'number') {
    throw new CheckoutError('The payment server returned an unexpected response.', 'server');
  }

  const key = order.key_id || razorpayKeyId;
  if (!key) {
    throw new CheckoutError('Razorpay is not configured for this site.', 'config');
  }

  await loadRazorpayScript();
  options.onStage?.('awaiting-payment');

  return new Promise<CheckoutResult>((resolve, reject) => {
    // Razorpay calls neither handler nor ondismiss in some edge cases; this
    // guard just makes sure the promise settles exactly once.
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const checkout = new window.Razorpay({
      key,
      amount: order.amount,
      currency: order.currency,
      name: 'SHYGON Tap',
      description: order.description ?? 'SHYGON Tap purchase',
      order_id: order.order_id,
      // From this deploy, so the logo shows on any host (preview, staging, live).
      image: new URL('/icons/icon-512.png', window.location.origin).href,
      prefill: {
        name: options.customerName,
        email: options.customerEmail,
        contact: options.customerPhone,
      },
      theme: { color: '#c9b486' },
      // Card first, in Razorpay's own secure window: the customer types the
      // cardholder name, number, expiry and CVV into Razorpay's fields, which
      // never touch this page, our functions or our database. UPI, netbanking
      // and wallets stay available below it.
      config: {
        display: {
          blocks: {
            card: { name: 'Pay by card', instruments: [{ method: 'card' }] },
          },
          sequence: ['block.card'],
          preferences: { show_default_blocks: true },
        },
      },
      // A declined card can be retried in the same window without a new order.
      retry: { enabled: true, max_count: 4 },
      modal: {
        confirm_close: true,
        ondismiss: () =>
          settle(() =>
            reject(
              new CheckoutError(
                'Payment was cancelled. Your order is saved and has not been charged.',
                'cancelled',
              ),
            ),
          ),
      },
      handler: async (response) => {
        try {
          options.onStage?.('verifying');
          const verifyResponse = await authorizedFetch('/api/verify-payment', response);

          if (!verifyResponse.ok) {
            throw new CheckoutError(
              await readError(
                verifyResponse,
                'We could not verify your payment. If you were charged, contact support with your payment id.',
              ),
              'verification',
            );
          }

          const verified = (await verifyResponse.json().catch(() => ({}))) as {
            success?: boolean;
            shygonOrderId?: string;
            alreadyProcessed?: boolean;
          };

          if (!verified.success) {
            throw new CheckoutError('Payment verification failed.', 'verification');
          }

          settle(() =>
            resolve({
              shygonOrderId: verified.shygonOrderId ?? order.shygonOrderId,
              razorpayPaymentId: response.razorpay_payment_id,
              alreadyProcessed: Boolean(verified.alreadyProcessed),
            }),
          );
        } catch (error) {
          settle(() =>
            reject(
              error instanceof CheckoutError
                ? error
                : new CheckoutError('Payment verification failed.', 'verification'),
            ),
          );
        }
      },
    });

    checkout.on('payment.failed', (failure) => {
      settle(() =>
        reject(
          new CheckoutError(
            failure.error?.description ?? 'The payment failed. You have not been charged.',
            'failed',
          ),
        ),
      );
    });

    checkout.open();
  });
}
