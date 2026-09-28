-- 014: live customer notifications
--
-- The website now listens for new rows in `notifications` over Supabase
-- Realtime (src/components/app/LiveNotifications.tsx) to show a toast, update
-- the bell and raise a desktop notification. Realtime only streams tables in
-- the `supabase_realtime` publication, which so far held `orders` and
-- `admin_notifications` (013).
--
-- Nothing is widened: Realtime applies each subscriber's RLS policy to every
-- row, so a customer still only ever receives their own notifications — the
-- same rows `notifications_select_owner_or_admin` already lets them read.
--
-- Idempotent; a no-op where the publication does not exist (local Postgres).
--
-- Rollback:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;
