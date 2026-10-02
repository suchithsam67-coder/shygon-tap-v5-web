import { useEffect } from 'react';
import { supabase } from './supabase';

/**
 * Store conversion funnel (migration 026): visit → product view → configured →
 * cart → checkout → payment → purchase. Anonymous by design: a random session
 * id, never a name, email or anything typed into a form. Money numbers in the
 * admin funnel come from paid orders, not from these events.
 */
export type StoreEvent =
  | 'store_visit'
  | 'product_view'
  | 'product_configured'
  | 'add_to_cart'
  | 'checkout_started'
  | 'payment_opened'
  | 'payment_success'
  | 'payment_failed'
  | 'payment_cancelled'
  | 'purchase_completed';

const SESSION_KEY = 'shygon_funnel_session';
const sent = new Set<string>();
/** Off for this visit once the database says the function is missing (before migration 026). */
let disabled = false;

function sessionId(): string | null {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Fire-and-forget; analytics never blocks or breaks the store. */
export function trackStoreEvent(event: StoreEvent, product?: string | null, valueInPaise?: number | null): void {
  if (typeof window === 'undefined' || disabled) return;
  const key = `${event}:${product ?? ''}`;
  if (sent.has(key)) return;
  sent.add(key);
  const session = sessionId();
  if (!session) return;
  void Promise.resolve(
    supabase.rpc('track_store_event', {
      p_session: session,
      p_event: event,
      p_product: product ?? null,
      p_value: Number.isFinite(valueInPaise) ? Math.round(valueInPaise as number) : null,
    }),
  )
    .then(({ error }) => {
      if (error && (error.code === 'PGRST202' || error.code === '42883')) disabled = true;
    })
    .catch(() => undefined);
}

/** Records one event when a page mounts. */
export function useStoreEvent(event: StoreEvent, product?: string | null, enabled = true): void {
  useEffect(() => {
    if (enabled) trackStoreEvent(event, product);
  }, [event, product, enabled]);
}

// Every "put this in the cart" path writes the pending order and then fires
// this event, so one listener covers the builder, product page and Pass.
if (typeof window !== 'undefined') {
  window.addEventListener('shygon-cart-updated', () => {
    try {
      const raw = localStorage.getItem('shygon_pending_order');
      if (!raw) return;
      const pending = JSON.parse(raw) as { orderType?: string; productId?: string };
      trackStoreEvent('add_to_cart', pending.productId ?? pending.orderType ?? null);
    } catch {
      /* ignore */
    }
  });
}
