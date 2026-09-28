-- SHYGON TAP V5 — RLS PERFORMANCE + RPC PERMISSIONS
-- Evaluate auth context once per statement and keep public RPCs limited to anon.

DROP POLICY IF EXISTS "Customers can view payments for their orders" ON public.payments;
CREATE POLICY "Customers can view payments for their orders" ON public.payments
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = payments.order_id
      AND orders.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO public
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS tap_profiles_insert_own ON public.tap_profiles;
CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS tap_profiles_update_own ON public.tap_profiles;
CREATE POLICY tap_profiles_update_own ON public.tap_profiles FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS order_items_select_own ON public.order_items;
CREATE POLICY order_items_select_own ON public.order_items FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS support_tickets_insert_own ON public.support_tickets;
CREATE POLICY support_tickets_insert_own ON public.support_tickets FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id AND status = 'open');

DROP POLICY IF EXISTS support_messages_insert_own ON public.support_messages;
CREATE POLICY support_messages_insert_own ON public.support_messages FOR INSERT TO public
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND author_role = 'customer'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND t.user_id = (SELECT auth.uid())
        AND t.status <> 'closed'
    )
  );

DROP POLICY IF EXISTS admin_users_self_read ON public.admin_users;
CREATE POLICY admin_users_self_read ON public.admin_users FOR SELECT TO public
  USING (user_id = (SELECT auth.uid()));

REVOKE EXECUTE ON FUNCTION public.get_public_profile(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_tap(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_tap_state(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_tap_event(TEXT,TEXT,TEXT) FROM authenticated;
