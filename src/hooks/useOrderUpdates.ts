import { useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Refreshes a customer's orders when the SHYGON admin changes one.
 *
 * The admin app moves an order through fulfilment with `admin_update_order_status`
 * and cancels with `admin_cancel_order`; both write `public.orders`, which
 * migration 003 adds to the `supabase_realtime` publication. So an UPDATE to one
 * of this customer's rows is the signal that there is something new to show.
 *
 * The event is used as a signal only and its payload is ignored: the page
 * re-reads through the same query it always uses. That mirrors the admin app's
 * own `useRealtimeSignal`, keeps one code path for what a customer is allowed to
 * see, and means a delivery that arrives out of order can never show a stale row.
 *
 * Realtime is still gated by RLS — `orders_select_own` — so a subscriber only
 * ever hears about their own orders. The `user_id` filter narrows what the
 * server sends; it is not what enforces it.
 *
 * A socket held across a long background stint can come back stale, so the page
 * also refreshes when it becomes visible again — which on its own covers a
 * project where Realtime is unavailable.
 */
export function useOrderUpdates(userId: string | undefined, enabled: boolean, onChange: () => void): void {
  // Kept current from an effect, not during render, and declared first so it is
  // up to date before the subscription below can fire — the same shape as
  // useAsync's loader ref.
  const handlerRef = useRef(onChange);
  useEffect(() => {
    handlerRef.current = onChange;
  });

  useEffect(() => {
    if (!userId || !enabled) return;

    // Several events can land together (status + tracking in one admin action,
    // a card row moving with it); collapse them into one refetch.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handlerRef.current(), 400);
    };

    const channel = supabase
      .channel(`customer-orders:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `user_id=eq.${userId}` },
        refresh,
      )
      .subscribe();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, [userId, enabled]);
}
