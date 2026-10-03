-- 020: a customer cannot un-suspend their own Tap or account (F1).
--
-- Decision:  DEC-2026-022 Position A (M0.3 = F1 + F3 + F4); M0.3 unit U3.
-- Level:     L3 (a trigger guarding authorization-relevant columns). Under
--            DEC-2026-018 it needs a 24-hour cool-off plus the checklist review
--            before it is approved or applied. Never applied by tooling to
--            production; db:push only reaches allowlisted non-production projects.
-- Origin:    the live schema baseline (DEC-2026-023 Option A).
-- Data:      no data is read, written or backfilled. Schema objects only.
--
-- THE PROBLEM (confirmed on the live baseline, M0.3 U3 stage 1)
--   The policies tap_profiles_update_own and profiles_update_own let the
--   owner UPDATE any column of their own row, and `authenticated` may update
--   every column. So a signed-in customer could clear or rewrite the
--   suspension an administrator set:
--     tap_profiles.suspended_at / suspended_reason / suspended_by
--     profiles.suspended_at / suspended_reason
--   and make a suspended Tap public again, without any audit row.
--
-- THE GUARD
--   A BEFORE UPDATE trigger on each table refuses, with SQLSTATE 42501, any
--   change to those columns made by a CLIENT role: `anon` or `authenticated`,
--   the roles PostgREST uses for browser requests. It compares old and new
--   values (IS DISTINCT FROM), so an update that leaves them unchanged, such as
--   an upsert re-sending the same values, still works.
--
--   Everything else is unaffected:
--     - admin_set_tap_suspension / admin_set_customer_suspension are SECURITY
--       DEFINER functions. They run as their owner, not as `authenticated`, so
--       they keep suspending, recording the reason and the administrator, and
--       restoring, exactly as before. Their bodies are NOT changed: who may
--       call them is still decided by require_admin('tap.moderate' /
--       'customers.manage').
--     - The server (service_role) and the database owner are not client
--       roles.
--     - Customers' updates to every other column behave exactly as before.
--   No policy, grant or existing function is changed.
--
--   Doc 12 §3 M0.3 leaves the mechanism open ("check app.admin_action ... or
--   compare to caller privilege - pick one, document, test both paths"). This
--   is the caller-privilege option, chosen because it needs no edit to the
--   frozen admin_* functions (scope point 3, confirmed by the owner).
--   Consequence: any SECURITY DEFINER function can write these columns, so a
--   new definer function that customers may call must not touch them. Today
--   only the two admin functions above do (live baseline, OBSERVED).
--
--   The trigger is named zz_ so it runs LAST among the BEFORE UPDATE triggers
--   on each table (they fire in name order). It therefore judges the final
--   row, after every other trigger has run.
--
--   Not guarded, deliberately (M0_3_IMPLEMENTATION_SCOPE.md U3):
--     - tap_profiles.suspended, the legacy boolean: nothing on live reads it;
--     - tap_profiles.status: live has no "suspended" status value. Suspension
--       is suspended_at, which the public resolver checks.
--   INSERT is not guarded: doc 12 specifies BEFORE UPDATE, and a customer
--   inserting their own row cannot undo an administrator's action.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid IN ('public.tap_profiles'::regclass, 'public.profiles'::regclass)
--      AND NOT tgisinternal;   -- no other guard already present
--   SELECT proname, proowner::regrole, prosecdef FROM pg_proc
--    WHERE proname IN ('admin_set_tap_suspension', 'admin_set_customer_suspension');
--   -- both must be SECURITY DEFINER (true), owned by a non-client role
--
-- ROLLBACK
--   DROP TRIGGER IF EXISTS trg_tap_profiles_zz_guard_suspension ON public.tap_profiles;
--   DROP TRIGGER IF EXISTS trg_profiles_zz_guard_suspension ON public.profiles;
--   DROP FUNCTION IF EXISTS public.guard_suspension_columns();
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.guard_suspension_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  -- Only direct client requests are refused. Inside a SECURITY DEFINER
  -- function (the admin suspension RPCs) current_user is the function owner,
  -- and server-side callers use their own roles.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- PL/pgSQL compiles this function separately for each table it is attached
  -- to, so each branch only ever sees its own table's columns.
  IF TG_TABLE_NAME = 'tap_profiles' THEN
    IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason
       OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by THEN
      RAISE EXCEPTION 'Suspension can only be changed by SHYGON support.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.suspended_reason IS DISTINCT FROM OLD.suspended_reason THEN
      RAISE EXCEPTION 'Suspension can only be changed by SHYGON support.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A trigger function is never called directly. Mirror the live convention for
-- trigger functions (enforce_tap_edit_rules): no PUBLIC/client EXECUTE. The
-- trigger still fires for every role.
REVOKE ALL ON FUNCTION public.guard_suspension_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_suspension_columns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_suspension_columns() TO service_role;

DROP TRIGGER IF EXISTS trg_tap_profiles_zz_guard_suspension ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_zz_guard_suspension
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_suspension_columns();

DROP TRIGGER IF EXISTS trg_profiles_zz_guard_suspension ON public.profiles;
CREATE TRIGGER trg_profiles_zz_guard_suspension
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_suspension_columns();
