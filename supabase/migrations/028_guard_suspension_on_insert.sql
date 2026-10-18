-- 028: a customer cannot create a row that is already suspended (F1, the
-- INSERT half of 020).
--
-- Decision:  F1, DEC-2026-022 Position A (M0.3 U3, migration 020); the owner's
--            suspension-guard brief of 2026-10-16; migration numbering N-1
--            (DEC-2026-035). Numbered 028, not 027: 027 is the AAROH catalogue
--            migration the owner held aside on 2026-10-16 (DEC-2026-037, not yet
--            filed); it is not in this chain. PROPOSED: not yet reviewed or approved.
-- Level:     L3 (a trigger guarding authorization-relevant columns). Under
--            DEC-2026-018 it needs a 24-hour cool-off plus the checklist review
--            before it is approved or applied, together with 020-026. Never
--            applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026.
-- Data:      none read, written or backfilled. Existing rows are not checked.
--
-- THE PROBLEM (found 2026-10-16 while auditing 020; supabase/tests/suspension-guard.mjs)
--   020 guards UPDATE only: "a customer inserting their own row cannot undo an
--   administrator's action". On the live baseline a signed-in account may
--   insert only its own profiles row, and only an account that has none (one
--   created before the sign-up trigger). That insert fails there anyway (I-1,
--   23503 on profiles_customer_id_fkey). 021 fixes I-1. So after 020-026 such an
--   account CAN insert its own profile, and can insert it already suspended:
--   suspended_at set and any suspended_reason, such as "Suspended by SHYGON
--   Trust & Safety". The administrators' console then shows a suspension SHYGON
--   never made. On tap_profiles a client insert has been refused by RLS since
--   023, so the guard there is defence in depth.
--
-- THE FIX
--   A BEFORE INSERT trigger on each table refuses a new row from a CLIENT role
--   (anon or authenticated) that carries any suspension value, with SQLSTATE
--   42501 and 020's message. The values are profiles.suspended_at and
--   suspended_reason, and tap_profiles.suspended_at, suspended_reason and
--   suspended_by. A new row without them, which is every insert the app makes,
--   is unaffected.
--
--   The rule and the caller test are 020's. SECURITY DEFINER functions (sign-up,
--   provisioning, the admin RPCs) run as their owner. The server runs as
--   service_role. Neither is a client role.
--
--   An upsert (INSERT ... ON CONFLICT DO UPDATE) fires BEFORE INSERT on the
--   proposed row first. So a client upsert that sends a non-null suspension
--   value is refused even when the stored value is the same. The app never
--   sends these columns.
--
--   The triggers are named zz_..._insert so they run last among the BEFORE
--   INSERT triggers on each table (they fire in name order), after 021's
--   customer_id triggers.
--
--   Additive: 020's function and triggers, and every policy, grant and other
--   function, are unchanged.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid IN ('public.tap_profiles'::regclass, 'public.profiles'::regclass)
--      AND NOT tgisinternal ORDER BY 1;
--        -- 020's trg_*_zz_guard_suspension present (020 applied first);
--        -- no trg_*_zz_guard_suspension_insert yet
--   SELECT member.rolname AS role, granted.rolname AS member_of
--     FROM pg_auth_members m
--     JOIN pg_roles granted ON granted.oid = m.roleid
--     JOIN pg_roles member ON member.oid = m.member
--    WHERE member.rolname IN ('anon', 'authenticated', 'authenticator') ORDER BY 1, 2;
--        -- anon, authenticated: no rows (they inherit nothing)
--        -- authenticator: anon, authenticated, service_role, plus at most
--        -- Supabase's own administrative roles. A custom role that Auth could
--        -- issue to a signed-in user must be added to the client-role list in
--        -- 020 and here before applying.
--
-- ROLLBACK (begin)
-- DROP TRIGGER IF EXISTS trg_tap_profiles_zz_guard_suspension_insert ON public.tap_profiles;
-- DROP TRIGGER IF EXISTS trg_profiles_zz_guard_suspension_insert ON public.profiles;
-- DROP FUNCTION IF EXISTS public.guard_suspension_columns_on_insert();
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.guard_suspension_columns_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  -- As in 020: only direct client requests are refused. Inside a SECURITY
  -- DEFINER function current_user is the function owner, and server-side
  -- callers use their own roles.
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- PL/pgSQL compiles this function separately for each table it is attached
  -- to, so each branch only ever sees its own table's columns.
  IF TG_TABLE_NAME = 'tap_profiles' THEN
    IF NEW.suspended_at IS NOT NULL
       OR NEW.suspended_reason IS NOT NULL
       OR NEW.suspended_by IS NOT NULL THEN
      RAISE EXCEPTION 'Suspension can only be changed by SHYGON support.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'profiles' THEN
    IF NEW.suspended_at IS NOT NULL
       OR NEW.suspended_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Suspension can only be changed by SHYGON support.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A trigger function is never called directly. Mirror 020 and the live
-- convention for trigger functions: no PUBLIC/client EXECUTE. The trigger still
-- fires for every role.
REVOKE ALL ON FUNCTION public.guard_suspension_columns_on_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_suspension_columns_on_insert() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_suspension_columns_on_insert() TO service_role;

DROP TRIGGER IF EXISTS trg_tap_profiles_zz_guard_suspension_insert ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_zz_guard_suspension_insert
  BEFORE INSERT ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_suspension_columns_on_insert();

DROP TRIGGER IF EXISTS trg_profiles_zz_guard_suspension_insert ON public.profiles;
CREATE TRIGGER trg_profiles_zz_guard_suspension_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_suspension_columns_on_insert();
