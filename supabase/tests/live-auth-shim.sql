-- Auth-schema objects that the live schema baseline omits (M0.3 U1; DEC-2026-023 Option A).
--
-- supabase/baseline/000_live_baseline.sql is `pg_dump --schema=public`, so it
-- leaves out the auth schema, including the sign-up trigger on auth.users that
-- runs public.handle_new_user(). Migration 002 created that trigger on live as
-- `on_auth_user_created` (AFTER INSERT ON auth.users). The owner's production
-- counts of 2026-10-02 (customers rows whose id differs from the user id)
-- show that sign-up does create customers rows. The live handle_new_user() body
-- reads NEW.phone, so the stand-in auth.users gets that column.
--
-- VERIFY ON LIVE: the auth.users trigger list (SCHEMA_DRIFT_REPORT.md §3).
--
-- This is test scaffolding, loaded after the baseline (the trigger refers to
-- public.handle_new_user). It is not part of the baseline and makes no claim
-- about how Supabase implements auth.

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone TEXT;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
