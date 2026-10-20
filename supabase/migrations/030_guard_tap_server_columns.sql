-- 030: a Tap owner cannot write the columns SHYGON manages on their Tap
-- (AB-1, AB-2, AB-3: found in the AAROH backend audit of 2026-10-19).
--
-- Decision:  the owner's AAROH backend brief of 2026-10-19 ("the owner must not
--            be able to grant themselves paid entitlements ... enforce these
--            restrictions in the backend"); DEC-2026-038 (PROPOSED). Migration
--            numbering N-1. APPROVED by the owner 2026-10-19 (DEC-2026-038 Q5, in session).
--            Approval of the design is not approval to apply: see Level.
-- Level:     L3 (a trigger guarding authorization-relevant columns). Under
--            DEC-2026-018 it needs a 24-hour cool-off plus the checklist review
--            before it is approved or applied. Never applied by tooling to
--            production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028 and 029. It does NOT change enforce_tap_edit_rules (frozen; its
--            production body has drifted, V6-106 / F-4) or any other function.
-- Data:      none read, written or backfilled.
--
-- THE PROBLEM (CONFIRMED locally on the live baseline + 020-029; production
-- UNVERIFIED because its enforce_tap_edit_rules differs, V6-106)
--   tap_profiles_update_own lets the owner UPDATE every column of their own
--   row, and enforce_tap_edit_rules checks only the content and theme columns.
--   AB-1  The owner clears last_content_edit_at (not a content column, so no
--         check runs) and then edits again at once: the 14-day edit window that
--         only the paid Customization Pass removes is bypassed, at will.
--   AB-2  The owner's first address can be written directly (slug changes are
--         checked only once a slug exists), skipping claim_tap_slug's format
--         rule and reserved list: /t/admin, /t/shygontap, /t/support ...
--   AB-3  card_id, provisioned_at, published_at, edit_window_started_at,
--         username and ui_plan_id accept any value the owner sends.
--   The app never writes these columns from the browser (src/services/tap.ts
--   TapDraft, setTapStatus; the address goes through claim_tap_slug).
--
-- THE FIX
--   A BEFORE UPDATE trigger refuses, with SQLSTATE 42501, a change to any of
--   those columns made by a CLIENT role (anon or authenticated). The caller
--   test is 020's: SECURITY DEFINER functions (claim_tap_slug, provisioning,
--   the admin RPCs) run as their owner, and the server runs as service_role,
--   so neither is affected. The trigger is named 01_ so it runs right after
--   the status sync (00_) and before enforce_tap_edit_rules, which itself
--   stamps last_content_edit_at for a real content edit: the guard sees only
--   what the client sent.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.tap_profiles'::regclass
--      AND NOT tgisinternal ORDER BY 1;     -- no trg_tap_profiles_01_guard_server_columns yet
--   SELECT count(*) FROM public.tap_profiles;   -- 0 on 2026-10-18 (A14): nothing to repair
--
-- ROLLBACK (begin)
-- DROP TRIGGER IF EXISTS trg_tap_profiles_01_guard_server_columns ON public.tap_profiles;
-- DROP FUNCTION IF EXISTS public.guard_tap_server_columns();
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.guard_tap_server_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF NEW.slug IS DISTINCT FROM OLD.slug OR NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'Choose your Tap address with claim_tap_slug.' USING ERRCODE = '42501';
  END IF;
  IF NEW.last_content_edit_at IS DISTINCT FROM OLD.last_content_edit_at
     OR NEW.edit_window_started_at IS DISTINCT FROM OLD.edit_window_started_at
     OR NEW.provisioned_at IS DISTINCT FROM OLD.provisioned_at
     OR NEW.published_at IS DISTINCT FROM OLD.published_at
     OR NEW.card_id IS DISTINCT FROM OLD.card_id
     OR NEW.ui_plan_id IS DISTINCT FROM OLD.ui_plan_id THEN
    RAISE EXCEPTION 'That field is managed by SHYGON.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_tap_server_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_tap_server_columns() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_tap_server_columns() TO service_role;

DROP TRIGGER IF EXISTS trg_tap_profiles_01_guard_server_columns ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_01_guard_server_columns
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_tap_server_columns();
