-- 026: deleting a customer's sign-in can no longer delete their orders and
-- payment records.
--
-- Decision:  V6-072 (account data export and deletion, DEC-2026-035 Stage 4);
--            the published Privacy Policy, "How long we keep it": orders,
--            invoices and payment records are kept "for as long as Indian tax
--            and company law requires (up to 8 years)"; D-12 (owner: confirm
--            the deletion procedure, docs/runbooks/RUNBOOK-account-deletion.md);
--            migration numbering N-1.
-- Level:     L3 (a constraint on the orders table). Under DEC-2026-018 it needs
--            a 24-hour cool-off plus the checklist review before it is approved
--            or applied. Never applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-025.
-- Data:      none. No row is read into the app or changed. Only what a future
--            DELETE of an auth.users row does to that account's orders changes.
--
-- THE PROBLEM (live baseline)
--   orders.user_id references auth.users ON DELETE CASCADE, and payments,
--   order_items and order_status_history cascade from orders. Deleting a
--   customer's sign-in, which is what Authentication > Users > Delete user in
--   the Supabase dashboard does, therefore deletes every order and payment
--   record the customer ever made, silently and irreversibly. Those are the
--   records the Privacy Policy and tax law say are kept. Nothing in the code
--   deletes users today: the risk is the action an operator would reach for
--   when handling a deletion request.
--
-- THE FIX
--   orders_user_id_fkey becomes ON DELETE RESTRICT. Deleting a sign-in that
--   still has orders now fails (23001) and changes nothing; the runbook
--   anonymises such an account instead. A sign-in with no orders deletes
--   exactly as before. payments, order_items and order_status_history keep
--   their CASCADE from orders: an order is not deleted while it must be kept.
--   One ALTER TABLE statement, so the constraint is never absent. It is added
--   NOT VALID (no scan under the lock) and then validated, which reads
--   orders while still allowing writes; every order has its account today, so
--   validation succeeds.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.orders'::regclass AND contype = 'f' ORDER BY 1;
--        -- orders_customer_id_fkey ... ON DELETE SET NULL
--        -- orders_user_id_fkey     ... ON DELETE CASCADE   (the problem)
--   SELECT count(*) FROM public.orders o
--    WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = o.user_id);
--        -- 0, or VALIDATE CONSTRAINT fails and nothing is changed
--
-- ROLLBACK (begin)
-- ALTER TABLE public.orders
--   DROP CONSTRAINT IF EXISTS orders_user_id_fkey,
--   ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_user_id_fkey,
  ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_user_id_fkey;
