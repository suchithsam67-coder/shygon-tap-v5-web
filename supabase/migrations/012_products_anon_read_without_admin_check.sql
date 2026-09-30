-- 012: anonymous catalogue reads must not call is_admin()
--
-- The live project had one SELECT policy on products, created outside these
-- migrations:
--
--   products_public_or_admin_select  TO public
--     USING ((active IS NOT FALSE) OR (SELECT is_admin()))
--
-- EXECUTE on is_admin() is (rightly) revoked from anon, and Postgres checks
-- that privilege for every function a policy references, even when the other
-- half of the OR already admits the row. So every signed-out catalogue read
-- failed with "permission denied for function is_admin" (HTTP 401): the
-- storefront fell back to its static prices and logged an error on each page.
--
-- Split into two policies that admit exactly the same rows per role:
--   anon, authenticated  -> active products     (no function call)
--   authenticated        -> everything, if is_admin()
-- Nothing is widened: anon still cannot execute is_admin(), and inactive
-- products stay visible to administrators only.
--
-- Rollback (restores the previous single policy):
--   DROP POLICY IF EXISTS "products_select_active"    ON public.products;
--   DROP POLICY IF EXISTS "products_select_admin_all" ON public.products;
--   CREATE POLICY "products_public_or_admin_select" ON public.products
--     FOR SELECT USING ((active IS NOT FALSE) OR (SELECT public.is_admin()));

BEGIN;

DROP POLICY IF EXISTS "products_public_or_admin_select" ON public.products;

DROP POLICY IF EXISTS "products_select_active" ON public.products;
CREATE POLICY "products_select_active" ON public.products
  FOR SELECT TO anon, authenticated
  USING (active IS NOT FALSE);

DROP POLICY IF EXISTS "products_select_admin_all" ON public.products;
CREATE POLICY "products_select_admin_all" ON public.products
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

COMMIT;
