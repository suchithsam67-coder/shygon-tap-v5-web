-- 024: the eight "owner or admin" read policies apply to signed-in users only,
-- and anonymous callers can no longer execute the admin permission helpers
-- (F6, O-1).
--
-- Decision:  DEC-2026-035 (SHYGON V6; backlog V6-030, approved with the Stage 1
--            audit on 2026-10-05); doc 12 M0.4 ("recreate the *_select_owner_or_admin
--            policies TO authenticated; keep semantics"); migration numbering N-1.
-- Level:     L3 (RLS policies and function grants). Under DEC-2026-018 it needs
--            a 24-hour cool-off plus the checklist review before it is approved
--            or applied. Never applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-023.
-- Data:      none.
--
-- THE PROBLEM (live baseline; F6 and observation O-1)
--   These SELECT policies have no TO clause, so they apply to every role,
--   anon included, and call is_admin():
--     cards, notifications, orders, profiles, support_messages, support_tickets,
--     tap_events, tap_profiles  (all *_select_owner_or_admin)
--   anon may not execute is_admin(), so an anonymous read of those tables fails
--   with "permission denied for function is_admin" instead of returning no rows
--   (accepted as a denial by owner decision D-U1-b, but noisy and fragile).
--   Separately, require_admin(text) and admin_has(text) are executable by anon
--   (O-1). Nothing anonymous needs them.
--
-- THE FIX
--   1. ALTER POLICY ... TO authenticated for the eight policies. Their USING
--      expressions are unchanged, so signed-in users see exactly what they saw
--      before (their own rows; admins as before). anon now matches no policy
--      on these tables and reads 0 rows, without an error.
--   2. REVOKE EXECUTE on require_admin(text) and admin_has(text) FROM anon.
--      admin_has(text) is also executable by PUBLIC on live (no REVOKE FROM
--      PUBLIC in the baseline), and anon inherits PUBLIC, so it is revoked from
--      PUBLIC too. authenticated and service_role keep their explicit grants.
--      After step 1 no policy anon evaluates calls them, and SECURITY DEFINER
--      functions call them as their owner, so no anonymous path is affected
--      (the public Tap reads through SECURITY DEFINER functions; golden-tested).
--   The function bodies and every other grant stay as they are.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT tablename, policyname, roles::text FROM pg_policies
--    WHERE policyname LIKE '%_select_owner_or_admin' ORDER BY 1;
--                                         -- eight rows, roles {public}
--   SELECT p.oid::regprocedure, has_function_privilege('anon', p.oid, 'EXECUTE')
--     FROM pg_proc p WHERE p.proname IN ('require_admin', 'admin_has');
--                                         -- true, true (to be revoked)
--   SELECT proacl FROM pg_proc WHERE oid = 'public.admin_has(text)'::regprocedure;
--                                         -- contains "=X/" (PUBLIC), revoked below
--
-- ROLLBACK (begin)
-- ALTER POLICY cards_select_owner_or_admin ON public.cards TO public;
-- ALTER POLICY notifications_select_owner_or_admin ON public.notifications TO public;
-- ALTER POLICY orders_select_owner_or_admin ON public.orders TO public;
-- ALTER POLICY profiles_select_owner_or_admin ON public.profiles TO public;
-- ALTER POLICY support_messages_select_owner_or_admin ON public.support_messages TO public;
-- ALTER POLICY support_tickets_select_owner_or_admin ON public.support_tickets TO public;
-- ALTER POLICY tap_events_select_owner_or_admin ON public.tap_events TO public;
-- ALTER POLICY tap_profiles_select_owner_or_admin ON public.tap_profiles TO public;
-- GRANT ALL ON FUNCTION public.require_admin(text) TO anon;
-- GRANT ALL ON FUNCTION public.admin_has(text) TO PUBLIC;
-- GRANT ALL ON FUNCTION public.admin_has(text) TO anon;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

ALTER POLICY cards_select_owner_or_admin ON public.cards TO authenticated;
ALTER POLICY notifications_select_owner_or_admin ON public.notifications TO authenticated;
ALTER POLICY orders_select_owner_or_admin ON public.orders TO authenticated;
ALTER POLICY profiles_select_owner_or_admin ON public.profiles TO authenticated;
ALTER POLICY support_messages_select_owner_or_admin ON public.support_messages TO authenticated;
ALTER POLICY support_tickets_select_owner_or_admin ON public.support_tickets TO authenticated;
ALTER POLICY tap_events_select_owner_or_admin ON public.tap_events TO authenticated;
ALTER POLICY tap_profiles_select_owner_or_admin ON public.tap_profiles TO authenticated;

REVOKE ALL ON FUNCTION public.require_admin(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_has(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_has(text) FROM anon;
