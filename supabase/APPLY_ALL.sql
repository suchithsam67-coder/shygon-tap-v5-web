-- ============================================================================
-- SHYGON — MIGRATIONS 020 ONWARD, IN ORDER (live-baseline migrations only)
-- ============================================================================
-- GENERATED FILE. Do not edit: change the numbered files in
-- supabase/migrations/ and re-run `npm run db:bundle`.
--
-- Contains ONLY the migrations written for the live schema baseline
-- (DEC-2026-023 Option A). The 001–019 history is NOT in this file and must
-- never be re-applied to live.
--
-- Production gate (human only): apply each migration only after its own
-- VERIFY ON LIVE queries (see its header) and its DEC-2026-018 approval
-- (24-hour cool-off + checklist). Every migration here is idempotent and
-- carries tested rollback SQL in its header (supabase/tests/migration-rollbacks.mjs).
--
-- Source files, in the order they appear below:
--   1. 020_guard_suspension_columns.sql
--   2. 021_resolve_customer_id.sql
--   3. 022_admin_notes_off_customer_rows.sql
--   4. 023_taps_only_after_payment.sql
--   5. 024_owner_or_admin_policies_to_authenticated.sql
--   6. 025_public_tap_privacy_and_analytics.sql
--   7. 026_orders_outlive_account_deletion.sql
--   8. 027_aaroh_catalog.sql
--   9. 028_guard_suspension_on_insert.sql
--   10. 029_emergency_contacts_and_alerts.sql
--   11. 030_guard_tap_server_columns.sql
--   12. 031_return_to_owner_relay.sql
--   13. 032_consent_ledger_and_connect.sql
--   14. 033_prive_demo.sql
--   15. 034_modes_and_info.sql
--   16. 035_public_profile_respects_mode.sql
-- ============================================================================

-- ###########################################################################
-- ## 020_guard_suspension_columns.sql
-- ###########################################################################

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


-- ###########################################################################
-- ## 021_resolve_customer_id.sql
-- ###########################################################################

-- 021: the database resolves customers.id itself (I-1, I-2, I-3), and the Tap
-- created on a first payment is an unpublished draft (D-U4).
--
-- Decision:  DEC-2026-024 Option A (I-1…I-3) + owner decision D-U4;
--            DEC-2026-029 Option A (identity contract B1–B7, rule B2);
--            M0.3 unit U4 (M0_3_IMPLEMENTATION_SCOPE.md §2 point 4, §3 U4).
--            Owner decisions of 2026-10-05 (superseding those of 2026-10-03):
--            the draft notification wording, and the deterministic
--            customer-code collision fallback (both below).
-- Level:     L3 (payment fulfilment, an RLS-adjacent trigger on client-writable
--            tables, and a frozen function body). Under DEC-2026-018 it needs a
--            24-hour cool-off plus the checklist review before it is approved or
--            applied. Never applied by tooling to production; db:push only
--            reaches allowlisted non-production projects.
-- Origin:    the live schema baseline (DEC-2026-023 Option A). Depends on 020
--            only by number; neither migration reads the other's objects.
-- Data:      no existing row is read for rewriting, updated, deleted or
--            backfilled. New customers rows are created on demand only, for an
--            account that has none (see customer_id_for). Schema objects plus
--            one changed function body.
--
-- THE PROBLEM (confirmed on the live baseline, M0.3 U4 stage 1)
--   customers.id (C) is a random UUID that sign-up (handle_new_user) creates.
--   profiles.customer_id and tap_profiles.customer_id are NOT NULL foreign keys
--   to it. V5 writes the auth user id (U) into those columns instead:
--     I-1  provision_tap_on_payment inserts tap_profiles.customer_id = U, so the
--          fulfilment claim on a first-time buyer's order fails with 23503 and
--          rolls back: the payment is captured but the order is never marked
--          paid (netlify/lib/fulfilment.mjs:93).
--     I-2  Settings / Checkout save profiles.customer_id = U: 23503
--          (src/pages/Settings.tsx:89, src/pages/Checkout.tsx:333).
--     I-3  the fulfilment safety net inserts tap_profiles.customer_id = U: 23503
--          (netlify/lib/fulfilment.mjs:334).
--   And O-12: once I-1 works, provision_tap_on_payment publishes the new Tap at
--   once, with the buyer's name and account email visible to anyone.
--
-- WHAT THIS MIGRATION DOES
--   1. public.customer_id_for(uuid): returns the account's customers.id,
--      creating the customers row if the account has none (accounts older than
--      the sign-up trigger). SECURITY DEFINER; not executable by anon,
--      authenticated or PUBLIC.
--        The new row mirrors handle_new_user: user_id, registered_email and
--        registered_phone from auth.users, and the code
--          'CUST-' || upper(first 10 hex digits of the user id)
--        Collision fallback (owner decision 2026-10-05, observation O-13): the
--        code is UNIQUE, so if another customer already holds it, the helper
--        does not fail. It lengthens the code deterministically, one hex digit
--        at a time (11, 12 … 32 digits, the whole user id), and keeps the first
--        code that is free: the shortest unique one. If even the 32-digit code
--        is taken (only possible for a code set by hand), it appends -2, -3 …
--        up to -1000, then refuses with 23505. The same account and the same
--        existing codes always give the same result. Every attempt is
--        INSERT … ON CONFLICT DO NOTHING, so an existing customer is never
--        overwritten; a concurrent call for the same account ends with the one
--        row that won.
--        handle_new_user itself is NOT changed: sign-up still fails on a code
--        collision (O-13 stays open there).
--   2. public.resolve_customer_id(): a trigger on profiles and tap_profiles,
--      BEFORE INSERT and BEFORE UPDATE OF customer_id, applying scope §2 point 4:
--        - a value equal to the row's own account (profiles.id,
--          tap_profiles.user_id) is mapped to that account's customers.id;
--        - from a client (anon / authenticated), any other value that is not
--          the caller's own customers.id is refused with 42501, and so is a
--          client write of customer_id on a row that is not the caller's;
--        - from the server, any other value is left alone (the foreign key
--          still decides);
--        - NULL is left alone (NOT NULL still decides), and an UPDATE that
--          leaves customer_id unchanged is not a change.
--      Who is a client is decided exactly as in 020: by the calling database
--      role (current_user). It is read in the triggers' WHEN clauses, which
--      run as the caller, and passed to the function as a fixed trigger
--      argument. The function itself runs as its owner, because customers is
--      closed to every API role (customers_api_none). A SECURITY DEFINER
--      function writing these tables (handle_new_user, provision_tap_on_payment)
--      therefore counts as the server, as it does for the 020 guard.
--   3. public.provision_tap_on_payment(), D-U4: the Tap created on a first
--      payment is a draft (status 'draft', published false) instead of being
--      published, and its notification reads (owner decisions: title
--      2026-10-05, body 2026-10-03):
--        title 'Your SHYGON Tap draft is ready'
--        body  'Your Tap page has been created. Review and publish it from your SHYGON dashboard.'
--      Nothing else in the body changes. It still inserts customer_id = the
--      user id, which the trigger in 2 now maps (scope §2 point 5). Signature,
--      SECURITY DEFINER, search_path, grants and the trg_orders_provision_tap
--      trigger are unchanged (CREATE OR REPLACE keeps grants).
--
-- WHAT IS NOT CHANGED
--   handle_new_user; every policy and every grant on existing tables and
--   functions; netlify/, api/ and src/ (fulfilment.mjs, Settings.tsx,
--   Checkout.tsx, create-order.mjs); orders.customer_id, which correctly holds
--   the auth user id (FK auth.users; rule B4); cards.customer_id;
--   tap_profiles.user_id stays nullable (a row without one is left alone).
--
-- KNOWN, NOT FIXED HERE
--   O-14 (pre-existing on live): the tap_profiles_insert_own policy lets a
--   signed-in customer insert their own Tap row directly, active and
--   published, without a paid order. They can already read their own
--   customers.id from their profile row, so this migration does not create
--   the capability. Closing it needs a policy change (not authorized in M0.3).
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT ascii(tgenabled::text) FROM pg_trigger
--    WHERE tgname = 'trg_orders_provision_tap';             -- 79 ('O', enabled)
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid IN ('public.profiles'::regclass, 'public.tap_profiles'::regclass)
--      AND NOT tgisinternal;                                -- no customer_id trigger yet
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.provision_tap_on_payment()'::regprocedure;
--                                                           -- must match the baseline body
--   SELECT has_table_privilege(current_user, 'auth.users', 'SELECT');  -- true (helper reads it)
--   SELECT count(*) FROM auth.users u
--    WHERE NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.user_id = u.id);
--                                                           -- accounts the helper would complete
--
-- ROLLBACK (begin)
-- DROP TRIGGER IF EXISTS trg_profiles_customer_id_client ON public.profiles;
-- DROP TRIGGER IF EXISTS trg_profiles_customer_id_server ON public.profiles;
-- DROP TRIGGER IF EXISTS trg_tap_profiles_customer_id_client ON public.tap_profiles;
-- DROP TRIGGER IF EXISTS trg_tap_profiles_customer_id_server ON public.tap_profiles;
-- DROP FUNCTION IF EXISTS public.resolve_customer_id();
-- DROP FUNCTION IF EXISTS public.customer_id_for(uuid);
-- CREATE OR REPLACE FUNCTION public.provision_tap_on_payment() RETURNS trigger
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_slug TEXT;
--   v_name TEXT;
--   v_email TEXT;
--   v_experience TEXT;
--   v_created BOOLEAN := false;
-- BEGIN
--   IF NEW.payment_status <> 'paid'
--      OR OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
--      OR NEW.user_id IS NULL THEN
--     RETURN NEW;
--   END IF;
--
--   v_experience := public.canonical_experience(COALESCE(NULLIF(NEW.plan_id, ''), 'essential'));
--   IF v_experience NOT IN ('essential', 'business', 'premium', 'goat') THEN
--     v_experience := 'essential';
--   END IF;
--
--   v_slug := public.generate_tap_slug(NEW.user_id);
--
--   SELECT p.full_name, p.email INTO v_name, v_email
--   FROM public.profiles p
--   WHERE p.id = NEW.user_id;
--
--   INSERT INTO public.tap_profiles
--     (user_id, customer_id, published, status, slug, username, display_name, email,
--      selected_ui_tier, enabled_customizations, edit_window_started_at)
--   VALUES (
--     NEW.user_id, NEW.user_id, true, 'active', v_slug, v_slug, v_name, v_email,
--     v_experience, ARRAY['phone', 'email'], NEW.created_at
--   )
--   ON CONFLICT (user_id) DO NOTHING;
--
--   v_created := FOUND;
--
--   -- Existing customers keep their chosen experience unless this paid order
--   -- explicitly purchases a new higher experience. Never unpause an existing Tap.
--   IF NOT v_created AND v_experience <> 'essential' THEN
--     UPDATE public.tap_profiles
--     SET selected_ui_tier = v_experience
--     WHERE user_id = NEW.user_id
--       AND public.tier_rank(v_experience) > public.tier_rank(selected_ui_tier);
--   END IF;
--
--   UPDATE public.tap_profiles
--   SET slug = v_slug, username = COALESCE(username, v_slug)
--   WHERE user_id = NEW.user_id AND slug IS NULL;
--
--   UPDATE public.tap_profiles
--   SET edit_window_started_at = LEAST(
--     COALESCE(edit_window_started_at, NEW.created_at),
--     NEW.created_at
--   )
--   WHERE user_id = NEW.user_id;
--
--   IF v_created THEN
--     INSERT INTO public.notifications (user_id, category, title, body, link)
--     VALUES (
--       NEW.user_id,
--       'tap',
--       'Your SHYGON Tap is live',
--       'Your Tap page has been created automatically. Complete your profile whenever you are ready.',
--       '/shygontap/tap'
--     );
--   END IF;
--
--   RETURN NEW;
-- END;
-- $$;
-- ROLLBACK (end)
--   The block above restores the baseline exactly (supabase/baseline/
--   000_live_baseline.sql, TOC entry 464); identity-contract.mjs runs it and
--   compares. customers rows the helper created stay: each is a valid row for
--   its own account, which other rows may reference by then.
--
-- Idempotent: safe to run more than once.

-- 1. ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.customer_id_for(p_user uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  v_id      uuid;
  v_email   text;
  v_phone   text;
  v_hex     text;
  v_code    text;
  v_digits  int := 10;  -- the handle_new_user format
  v_suffix  int := 1;
BEGIN
  IF p_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT c.id INTO v_id FROM public.customers c WHERE c.user_id = p_user;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- No account, nothing to create: the caller's foreign key decides.
  SELECT u.email, u.phone INTO v_email, v_phone FROM auth.users u WHERE u.id = p_user;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Deterministic: 10, 11 … 32 hex digits of the user id, then the full id
  -- with -2, -3 … -1000. The first free code wins.
  v_hex := upper(replace(p_user::text, '-', ''));
  LOOP
    IF v_digits <= 32 THEN
      v_code := 'CUST-' || substr(v_hex, 1, v_digits);
      v_digits := v_digits + 1;
    ELSE
      v_suffix := v_suffix + 1;
      IF v_suffix > 1000 THEN
        RAISE EXCEPTION 'No free customer code for this account.' USING ERRCODE = '23505';
      END IF;
      v_code := 'CUST-' || v_hex || '-' || v_suffix::text;
    END IF;

    -- No conflict target: a clash on user_id (a concurrent call won) or on the
    -- code (another customer holds it) both insert nothing and update nothing.
    INSERT INTO public.customers (user_id, customer_id, registered_email, registered_phone)
    VALUES (p_user, v_code, v_email, v_phone)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      RETURN v_id;
    END IF;

    SELECT c.id INTO v_id FROM public.customers c WHERE c.user_id = p_user;
    IF FOUND THEN
      RETURN v_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_id_for(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_id_for(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_id_for(uuid) TO service_role;

-- 2. ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_customer_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
DECLARE
  -- Fixed by the trigger definition (see the WHEN clauses below), never by the
  -- caller: trigger functions cannot be called directly.
  v_client boolean := TG_ARGV[0] = 'client';
  v_owner  uuid;
  v_own    uuid;
BEGIN
  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.customer_id IS NOT DISTINCT FROM OLD.customer_id THEN
    RETURN NEW;
  END IF;

  -- PL/pgSQL compiles this function separately for each table it is attached
  -- to, so each branch only ever sees its own table's columns.
  IF TG_TABLE_NAME = 'profiles' THEN
    v_owner := NEW.id;
  ELSE
    v_owner := NEW.user_id;
  END IF;

  -- RLS only lets a client write its own rows. Refusing here as well means no
  -- customers row is created for another account inside a doomed statement.
  IF v_client AND (auth.uid() IS NULL OR v_owner IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'The customer record is assigned by SHYGON and cannot be chosen.'
      USING ERRCODE = '42501';
  END IF;

  -- The account's own user id: replace it with the account's customers.id.
  IF v_owner IS NOT NULL AND NEW.customer_id = v_owner THEN
    v_own := public.customer_id_for(v_owner);
    IF v_own IS NOT NULL THEN
      NEW.customer_id := v_own;
    END IF;
    RETURN NEW;
  END IF;

  -- Any other value: a client may only send its own customers.id (rule B2).
  IF v_client THEN
    SELECT c.id INTO v_own FROM public.customers c WHERE c.user_id = v_owner;
    IF v_own IS NULL OR NEW.customer_id <> v_own THEN
      RAISE EXCEPTION 'The customer record is assigned by SHYGON and cannot be chosen.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- A trigger function is never called directly. Mirror the live convention for
-- trigger functions (and 020): no PUBLIC/client EXECUTE. The triggers still
-- fire for every role.
REVOKE ALL ON FUNCTION public.resolve_customer_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_customer_id() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_customer_id() TO service_role;

-- Two triggers per table, one per kind of caller. A WHEN clause is evaluated
-- as the role running the statement, before the function switches to its
-- owner, so current_user there is the caller, exactly as in the 020 guard.
DROP TRIGGER IF EXISTS trg_profiles_customer_id_client ON public.profiles;
CREATE TRIGGER trg_profiles_customer_id_client
  BEFORE INSERT OR UPDATE OF customer_id ON public.profiles
  FOR EACH ROW
  WHEN (current_user IN ('anon', 'authenticated'))
  EXECUTE FUNCTION public.resolve_customer_id('client');

DROP TRIGGER IF EXISTS trg_profiles_customer_id_server ON public.profiles;
CREATE TRIGGER trg_profiles_customer_id_server
  BEFORE INSERT OR UPDATE OF customer_id ON public.profiles
  FOR EACH ROW
  WHEN (current_user NOT IN ('anon', 'authenticated'))
  EXECUTE FUNCTION public.resolve_customer_id('server');

DROP TRIGGER IF EXISTS trg_tap_profiles_customer_id_client ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_customer_id_client
  BEFORE INSERT OR UPDATE OF customer_id ON public.tap_profiles
  FOR EACH ROW
  WHEN (current_user IN ('anon', 'authenticated'))
  EXECUTE FUNCTION public.resolve_customer_id('client');

DROP TRIGGER IF EXISTS trg_tap_profiles_customer_id_server ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_customer_id_server
  BEFORE INSERT OR UPDATE OF customer_id ON public.tap_profiles
  FOR EACH ROW
  WHEN (current_user NOT IN ('anon', 'authenticated'))
  EXECUTE FUNCTION public.resolve_customer_id('server');

-- 3. ---------------------------------------------------------------------------
-- The live body (baseline TOC entry 464) with exactly four literals changed:
-- published true -> false, status 'active' -> 'draft', and the notification's
-- title and body. identity-contract.mjs proves that is the whole difference.

CREATE OR REPLACE FUNCTION public.provision_tap_on_payment() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_slug TEXT;
  v_name TEXT;
  v_email TEXT;
  v_experience TEXT;
  v_created BOOLEAN := false;
BEGIN
  IF NEW.payment_status <> 'paid'
     OR OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
     OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_experience := public.canonical_experience(COALESCE(NULLIF(NEW.plan_id, ''), 'essential'));
  IF v_experience NOT IN ('essential', 'business', 'premium', 'goat') THEN
    v_experience := 'essential';
  END IF;

  v_slug := public.generate_tap_slug(NEW.user_id);

  SELECT p.full_name, p.email INTO v_name, v_email
  FROM public.profiles p
  WHERE p.id = NEW.user_id;

  INSERT INTO public.tap_profiles
    (user_id, customer_id, published, status, slug, username, display_name, email,
     selected_ui_tier, enabled_customizations, edit_window_started_at)
  VALUES (
    NEW.user_id, NEW.user_id, false, 'draft', v_slug, v_slug, v_name, v_email,
    v_experience, ARRAY['phone', 'email'], NEW.created_at
  )
  ON CONFLICT (user_id) DO NOTHING;

  v_created := FOUND;

  -- Existing customers keep their chosen experience unless this paid order
  -- explicitly purchases a new higher experience. Never unpause an existing Tap.
  IF NOT v_created AND v_experience <> 'essential' THEN
    UPDATE public.tap_profiles
    SET selected_ui_tier = v_experience
    WHERE user_id = NEW.user_id
      AND public.tier_rank(v_experience) > public.tier_rank(selected_ui_tier);
  END IF;

  UPDATE public.tap_profiles
  SET slug = v_slug, username = COALESCE(username, v_slug)
  WHERE user_id = NEW.user_id AND slug IS NULL;

  UPDATE public.tap_profiles
  SET edit_window_started_at = LEAST(
    COALESCE(edit_window_started_at, NEW.created_at),
    NEW.created_at
  )
  WHERE user_id = NEW.user_id;

  IF v_created THEN
    INSERT INTO public.notifications (user_id, category, title, body, link)
    VALUES (
      NEW.user_id,
      'tap',
      'Your SHYGON Tap draft is ready',
      'Your Tap page has been created. Review and publish it from your SHYGON dashboard.',
      '/shygontap/tap'
    );
  END IF;

  RETURN NEW;
END;
$$;


-- ###########################################################################
-- ## 022_admin_notes_off_customer_rows.sql
-- ###########################################################################

-- 022: an administrator's internal order note is no longer readable by the
-- customer who placed the order (F2).
--
-- Decision:  DEC-2026-035 (SHYGON V6; backlog V6-010, approved with the Stage 1
--            audit on 2026-10-05; migration numbering N-1). F2 was moved to the
--            backlog by DEC-2026-022 and is brought into V6 by that approval.
-- Level:     L3 (data visible to customers; two frozen admin_* function bodies).
--            Under DEC-2026-018 it needs a 24-hour cool-off plus the checklist
--            review before it is approved or applied. Never applied by tooling
--            to production; db:push only reaches allowlisted non-production
--            projects.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-021.
--            Adapted from supabase/proposed/011_admin_notes_off_customer_rows.sql,
--            which targeted the old repository schema; the function bodies below
--            are the LIVE ones with only the approved edits.
-- Data:      MOVES data. The text of every non-blank orders.admin_note is copied
--            into order_admin_notes, then orders.admin_note is set to NULL.
--            Nothing is deleted: the rollback copies the notes back.
--
-- THE PROBLEM (live baseline; audit V6-010)
--   orders.admin_note holds the administrator's free-text note, written by
--   admin_update_order_status. The customer's policy orders_select_owner_or_admin
--   is row-level, so a customer reads every column of their own order, note
--   included, with one request (GET /rest/v1/orders?select=order_id,admin_note).
--
-- THE FIX
--   1. public.order_admin_notes(order_id PK -> orders, note, updated_by,
--      updated_at): RLS on, no policies, no anon/authenticated grant. Only
--      SECURITY DEFINER admin functions (and the server) reach it.
--   2. Existing notes are copied into it.
--   3. admin_get_order(uuid) still returns order.admin_note, now read from the
--      new table: same JSON shape for the admin app (DEC-2026-016).
--   4. admin_update_order_status(...) writes the note to the new table instead
--      of the order row. Same signature and semantics: a blank note keeps the
--      existing one. Nothing else in either body changes.
--   5. orders.admin_note is cleared. The column is kept (NULL), so a stale admin
--      build reading it gets null rather than an error.
--   Why a table and not column privileges: a column REVOKE needs table-level
--   SELECT revoked and every other column re-granted, and would change what
--   Realtime sends for orders. A separate table leaves orders access unchanged.
--
-- SIDE EFFECTS of step 5 (an UPDATE on orders, only for rows that had a note):
--   trg_orders_updated_at moves updated_at to now(). No order trigger reacts to
--   admin_note: account events, notifications, admin notifications, status
--   history and Tap provisioning only fire on payment or status changes
--   (verified in supabase/tests/admin-notes.mjs).
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid IN ('public.admin_get_order(uuid)'::regprocedure,
--                  'public.admin_update_order_status(uuid,text,text,text,text)'::regprocedure);
--                                         -- must match the baseline bodies
--   SELECT to_regclass('public.order_admin_notes');            -- NULL (not created yet)
--   SELECT count(*) FROM public.orders WHERE NULLIF(btrim(admin_note), '') IS NOT NULL;
--                                         -- notes that will be moved
--   SELECT pubname FROM pg_publication_tables WHERE tablename = 'orders';
--                                         -- Realtime on orders: after this, it carries admin_note = NULL
--
-- ROLLBACK (begin)
-- CREATE TABLE IF NOT EXISTS public.order_admin_notes (order_id uuid PRIMARY KEY, note text NOT NULL);
-- UPDATE public.orders o SET admin_note = n.note
--   FROM public.order_admin_notes n
--  WHERE n.order_id = o.id AND o.admin_note IS DISTINCT FROM n.note;
-- CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id uuid) RETURNS jsonb
--     LANGUAGE plpgsql STABLE SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_out JSONB;
-- BEGIN
--   PERFORM public.require_admin('orders.read');
--
--   SELECT jsonb_build_object(
--     'order', to_jsonb(o) - 'customer_id',
--     'customer', (SELECT jsonb_build_object(
--         'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
--         'phone', pr.phone, 'suspended_at', pr.suspended_at)
--       FROM public.profiles pr WHERE pr.id = o.user_id),
--     'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
--       FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
--     -- raw_payload is the full gateway body; it is not needed to operate an
--     -- order and is not sent to a mobile device.
--     'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
--         'id', pay.id, 'provider', pay.provider,
--         'provider_order_id', pay.provider_order_id,
--         'provider_payment_id', pay.provider_payment_id,
--         'status', pay.status, 'amount_in_paise', pay.amount_in_paise,
--         'created_at', pay.created_at, 'verified_at', pay.verified_at)
--         ORDER BY pay.created_at DESC)
--       FROM public.payments pay WHERE pay.order_id = o.id), '[]'::jsonb),
--     'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
--       FROM public.cards c WHERE c.order_id = o.id), '[]'::jsonb),
--     'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
--         'action', a.action, 'metadata', a.metadata,
--         'created_at', a.created_at,
--         'admin_name', au.display_name)
--         ORDER BY a.created_at DESC)
--       FROM public.admin_audit_log a
--       LEFT JOIN public.admin_users au ON au.user_id = a.admin_id
--       WHERE a.entity_type = 'order' AND a.entity_id = o.id::text), '[]'::jsonb)
--   ) INTO v_out
--   FROM public.orders o
--   WHERE o.id = p_order_id;
--
--   IF v_out IS NULL THEN
--     RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
--   END IF;
--
--   RETURN v_out;
-- END;
-- $$;
-- CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_admin UUID := public.require_admin('orders.fulfil');
--   v_old   public.orders%ROWTYPE;
-- BEGIN
--   IF p_status NOT IN ('placed','processing','packed','shipped',
--                       'out_for_delivery','delivered') THEN
--     RAISE EXCEPTION 'Unknown fulfilment status "%".', p_status USING ERRCODE = '22023';
--   END IF;
--
--   SELECT * INTO v_old FROM public.orders WHERE id = p_order_id FOR UPDATE;
--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
--   END IF;
--
--   IF v_old.order_status = 'cancelled' THEN
--     RAISE EXCEPTION 'A cancelled order cannot be moved back into fulfilment.'
--       USING ERRCODE = '22023';
--   END IF;
--
--   -- Shipping something nobody has paid for is almost always a mistake, and the
--   -- database is the only place that can reliably refuse it.
--   IF v_old.payment_status <> 'paid'
--      AND p_status IN ('shipped', 'out_for_delivery', 'delivered') THEN
--     RAISE EXCEPTION 'This order has not been paid, so it cannot be marked %.', p_status
--       USING ERRCODE = '22023';
--   END IF;
--
--   IF p_status IN ('shipped', 'out_for_delivery', 'delivered')
--      AND COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''),
--                   NULLIF(btrim(COALESCE(v_old.tracking_number, '')), '')) IS NULL THEN
--     RAISE EXCEPTION 'Add a tracking number before marking this order %.', p_status
--       USING ERRCODE = '22023';
--   END IF;
--
--   UPDATE public.orders SET
--     order_status     = p_status,
--     tracking_number  = COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''), tracking_number),
--     shipping_carrier = COALESCE(NULLIF(btrim(COALESCE(p_carrier, '')), ''), shipping_carrier),
--     admin_note       = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
--     shipped_at       = CASE WHEN p_status = 'shipped'   AND shipped_at   IS NULL
--                             THEN NOW() ELSE shipped_at END,
--     delivered_at     = CASE WHEN p_status = 'delivered' AND delivered_at IS NULL
--                             THEN NOW() ELSE delivered_at END
--   WHERE id = p_order_id;
--
--   -- Cards leave the building with the order they belong to.
--   IF p_status IN ('shipped', 'out_for_delivery') THEN
--     UPDATE public.cards SET status = 'shipped'
--     WHERE order_id = p_order_id AND status = 'pending';
--   ELSIF p_status = 'delivered' THEN
--     UPDATE public.cards SET status = 'active'
--     WHERE order_id = p_order_id AND status IN ('pending', 'shipped');
--   END IF;
--
--   PERFORM public.admin_audit(v_admin, 'order.status_changed', 'order', p_order_id::text,
--     jsonb_build_object('from', v_old.order_status, 'to', p_status,
--                        'tracking', p_tracking, 'carrier', p_carrier));
--
--   RETURN public.admin_get_order(p_order_id);
-- END;
-- $$;
-- DROP TABLE IF EXISTS public.order_admin_notes;
-- ROLLBACK (end)
--   The block restores the live bodies exactly (supabase/baseline/
--   000_live_baseline.sql) and puts every note back on its order;
--   supabase/tests/admin-notes.mjs runs it and compares.
--
-- Idempotent: safe to run more than once.

-- 1. The admin-only home for internal notes -----------------------------------
CREATE TABLE IF NOT EXISTS public.order_admin_notes (
  order_id   uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  note       text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_admin_notes ENABLE ROW LEVEL SECURITY;

-- No policies on purpose. Supabase's default privileges grant new tables to the
-- API roles, so take that back explicitly; the server keeps access.
REVOKE ALL ON TABLE public.order_admin_notes FROM PUBLIC;
REVOKE ALL ON TABLE public.order_admin_notes FROM anon, authenticated;
GRANT ALL ON TABLE public.order_admin_notes TO service_role;

COMMENT ON TABLE public.order_admin_notes IS
  'Internal administrator note per order (F2, migration 022). Read and written only by admin_* SECURITY DEFINER functions. Never exposed to customers.';

-- 2. Copy existing notes (before the functions switch, so no note is ever hidden)
INSERT INTO public.order_admin_notes (order_id, note, updated_at)
SELECT o.id, btrim(o.admin_note), o.updated_at
FROM public.orders o
WHERE NULLIF(btrim(COALESCE(o.admin_note, '')), '') IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

-- 3. admin_get_order: the live body, with order.admin_note read from the new table
CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  SELECT jsonb_build_object(
    'order', (to_jsonb(o) - 'customer_id') || jsonb_build_object('admin_note',
        (SELECT n.note FROM public.order_admin_notes n WHERE n.order_id = o.id)),
    'customer', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
        'phone', pr.phone, 'suspended_at', pr.suspended_at)
      FROM public.profiles pr WHERE pr.id = o.user_id),
    'items', COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at)
      FROM public.order_items i WHERE i.order_id = o.id), '[]'::jsonb),
    -- raw_payload is the full gateway body; it is not needed to operate an
    -- order and is not sent to a mobile device.
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', pay.id, 'provider', pay.provider,
        'provider_order_id', pay.provider_order_id,
        'provider_payment_id', pay.provider_payment_id,
        'status', pay.status, 'amount_in_paise', pay.amount_in_paise,
        'created_at', pay.created_at, 'verified_at', pay.verified_at)
        ORDER BY pay.created_at DESC)
      FROM public.payments pay WHERE pay.order_id = o.id), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
      FROM public.cards c WHERE c.order_id = o.id), '[]'::jsonb),
    'history', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'action', a.action, 'metadata', a.metadata,
        'created_at', a.created_at,
        'admin_name', au.display_name)
        ORDER BY a.created_at DESC)
      FROM public.admin_audit_log a
      LEFT JOIN public.admin_users au ON au.user_id = a.admin_id
      WHERE a.entity_type = 'order' AND a.entity_id = o.id::text), '[]'::jsonb)
  ) INTO v_out
  FROM public.orders o
  WHERE o.id = p_order_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;

-- 4. admin_update_order_status: the live body, with the note written to the new table
CREATE OR REPLACE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_old   public.orders%ROWTYPE;
BEGIN
  IF p_status NOT IN ('placed','processing','packed','shipped',
                      'out_for_delivery','delivered') THEN
    RAISE EXCEPTION 'Unknown fulfilment status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.order_status = 'cancelled' THEN
    RAISE EXCEPTION 'A cancelled order cannot be moved back into fulfilment.'
      USING ERRCODE = '22023';
  END IF;

  -- Shipping something nobody has paid for is almost always a mistake, and the
  -- database is the only place that can reliably refuse it.
  IF v_old.payment_status <> 'paid'
     AND p_status IN ('shipped', 'out_for_delivery', 'delivered') THEN
    RAISE EXCEPTION 'This order has not been paid, so it cannot be marked %.', p_status
      USING ERRCODE = '22023';
  END IF;

  IF p_status IN ('shipped', 'out_for_delivery', 'delivered')
     AND COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''),
                  NULLIF(btrim(COALESCE(v_old.tracking_number, '')), '')) IS NULL THEN
    RAISE EXCEPTION 'Add a tracking number before marking this order %.', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET
    order_status     = p_status,
    tracking_number  = COALESCE(NULLIF(btrim(COALESCE(p_tracking, '')), ''), tracking_number),
    shipping_carrier = COALESCE(NULLIF(btrim(COALESCE(p_carrier, '')), ''), shipping_carrier),
    shipped_at       = CASE WHEN p_status = 'shipped'   AND shipped_at   IS NULL
                            THEN NOW() ELSE shipped_at END,
    delivered_at     = CASE WHEN p_status = 'delivered' AND delivered_at IS NULL
                            THEN NOW() ELSE delivered_at END
  WHERE id = p_order_id;

  -- The note is internal: it lives in order_admin_notes, which no customer can
  -- read, not on the customer's own order row. A blank note keeps the existing one.
  IF NULLIF(btrim(COALESCE(p_note, '')), '') IS NOT NULL THEN
    INSERT INTO public.order_admin_notes (order_id, note, updated_by, updated_at)
    VALUES (p_order_id, btrim(p_note), v_admin, NOW())
    ON CONFLICT (order_id) DO UPDATE
      SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;

  -- Cards leave the building with the order they belong to.
  IF p_status IN ('shipped', 'out_for_delivery') THEN
    UPDATE public.cards SET status = 'shipped'
    WHERE order_id = p_order_id AND status = 'pending';
  ELSIF p_status = 'delivered' THEN
    UPDATE public.cards SET status = 'active'
    WHERE order_id = p_order_id AND status IN ('pending', 'shipped');
  END IF;

  PERFORM public.admin_audit(v_admin, 'order.status_changed', 'order', p_order_id::text,
    jsonb_build_object('from', v_old.order_status, 'to', p_status,
                       'tracking', p_tracking, 'carrier', p_carrier));

  RETURN public.admin_get_order(p_order_id);
END;
$$;

-- 5. Close the leak: the customer's own order row no longer carries the note
UPDATE public.orders SET admin_note = NULL WHERE admin_note IS NOT NULL;


-- ###########################################################################
-- ## 023_taps_only_after_payment.sql
-- ###########################################################################

-- 023: a customer can no longer create a Tap row directly. A Tap exists only
-- after payment (O-14).
--
-- Decision:  DEC-2026-035 D-6 (owner, 2026-10-05: "Taps only after payment");
--            backlog V6-012; migration numbering N-1.
-- Level:     L3 (an RLS policy). Under DEC-2026-018 it needs a 24-hour cool-off
--            plus the checklist review before it is approved or applied. Never
--            applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-022.
-- Data:      none. Existing Taps, whoever created them, are untouched.
--
-- THE PROBLEM (live baseline; observation O-14, confirmed 2026-10-03)
--   The policy tap_profiles_insert_own lets any signed-in account insert its own
--   tap_profiles row. With status 'active' the row is published at once, so an
--   account that never paid gets a public Tap. The customers.id the row needs is
--   readable from the account's own profile row, and since 021 the account's
--   own user id is accepted as well.
--
-- THE FIX
--   Drop tap_profiles_insert_own. With row level security on and no INSERT
--   policy, every INSERT from anon or authenticated is refused (42501).
--   Taps keep being created by:
--     - provision_tap_on_payment(): SECURITY DEFINER, runs as the owner (021 draft);
--     - the fulfilment safety net and other server code: service_role
--       (BYPASSRLS on Supabase);
--     - an administrator, through SECURITY DEFINER functions.
--   The browser never inserts Tap rows (src/services/tap.ts only selects,
--   updates and calls RPCs), so no V5 screen changes. Owners still edit,
--   publish and pause their own Tap through tap_profiles_update_own (unchanged).
--   Grants are not changed: the policy, not the grant, is the control here, as
--   on every other table.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT policyname, cmd, roles::text, with_check FROM pg_policies
--    WHERE tablename = 'tap_profiles' AND cmd = 'INSERT';
--                                         -- exactly tap_profiles_insert_own
--   SELECT count(*) FROM public.tap_profiles t
--    WHERE NOT EXISTS (SELECT 1 FROM public.orders o
--                       WHERE o.user_id = t.user_id AND o.payment_status = 'paid');
--                                         -- Taps without a paid order (O-14 exposure so far)
--
-- ROLLBACK (begin)
-- DROP POLICY IF EXISTS tap_profiles_insert_own ON public.tap_profiles;
-- CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT
--   WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

DROP POLICY IF EXISTS tap_profiles_insert_own ON public.tap_profiles;


-- ###########################################################################
-- ## 024_owner_or_admin_policies_to_authenticated.sql
-- ###########################################################################

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


-- ###########################################################################
-- ## 025_public_tap_privacy_and_analytics.sql
-- ###########################################################################

-- 025: the public Tap's privacy and analytics hardening (V6 Stage 3).
--   a) the unused legacy reader get_public_tap() is no longer callable by
--      visitors (V6-071);
--   b) Tap analytics hash visitors with a random daily salt instead of a bare
--      MD5 of their IP address and browser (V6-073);
--   c) Tap analytics count a repeated event once and cap one visitor's events
--      per Tap (V6-032);
--   d) a Tap owner can hide their phone number or email address from the
--      public Tap without deleting it (V6-071).
--
-- Decision:  DEC-2026-035 (SHYGON V6; backlog V6-071, V6-073 and V6-032,
--            approved with the Stage 1 audit on 2026-10-05; privacy = hardening;
--            migration numbering N-1). Stage 3 run authorized by the owner on
--            2026-10-06 ("complete software").
-- Level:     L3 (a function grant, two function bodies, a new table). Under
--            DEC-2026-018 it needs a 24-hour cool-off plus the checklist review
--            before it is approved or applied. Never applied by tooling to
--            production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-024.
--            record_tap_event and enforce_tap_edit_rules below are the LIVE
--            bodies with exactly two and one replacements
--            (supabase/tests/admin-contract.mjs proves it).
-- Data:      none changed. tap_events rows written before this keep their old
--            MD5 hashes; the day this is applied may count a returning visitor
--            twice in "unique visitors".
--
-- THE PROBLEMS (live baseline; Stage 3 review)
--   1. get_public_tap(text) is EXECUTE-granted to anon and authenticated. The
--      app reads the public Tap through get_public_profile(text) only; nothing
--      in this repository calls get_public_tap. It still answers anyone, and
--      it is older and looser than get_public_profile: it returns `location`
--      whether or not the owner switched it on or owns the Location add-on.
--      CONFIRMED on the live baseline (supabase/tests/public-tap.mjs): for an
--      active Tap with an address and Location off, anon gets the address from
--      get_public_tap and null from get_public_profile. (A paused Tap is not
--      exposed: trg_tap_profiles_00_status keeps `published` false.)
--   2. record_tap_event stores visitor_hash = md5(user agent | IP | date). With
--      no secret in it, anyone holding the hash can recover the IP address by
--      trying every IPv4 address with common user agents.
--   3. record_tap_event writes every call. One script can inflate a Tap's
--      view and click counts without limit.
--   4. The owner cannot hide their phone or email. get_public_profile shows a
--      contact only when it is in enabled_customizations, but the trigger
--      enforce_tap_edit_rules adds 'phone' and 'email' back to that list on
--      every update the owner makes. The only way to keep a number off the
--      public page is to delete it from the Tap.
--
-- THE FIX
--   1. REVOKE EXECUTE on get_public_tap(text) FROM anon, authenticated.
--      service_role keeps it. The function body is unchanged.
--   2. public.tap_visitor_salts(day PK, salt): one random salt per UTC day, RLS
--      on, no policies, no anon/authenticated grant. record_tap_event hashes
--      sha256(salt | user agent | IP) and deletes salts older than yesterday,
--      so yesterday's hashes can no longer be recomputed by anyone.
--   3. record_tap_event skips an event identical to one the same visitor sent
--      on the same Tap in the last 10 seconds, and any event once that visitor
--      has 60 on that Tap in the last hour. A new index serves both checks.
--   4. enforce_tap_edit_rules keeps the owner's list as given. It still refuses
--      an add-on that was not bought (phone and email need none), and nothing
--      else in it changes. get_public_profile already withholds any contact not
--      on the list, so the public page follows the owner's switch.
--   Signatures, grants, SECURITY DEFINER and search_path are unchanged.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid = 'public.record_tap_event(text,text,text)'::regprocedure;
--                                         -- must match the baseline body
--   SELECT has_function_privilege('anon', 'public.get_public_tap(text)', 'EXECUTE');
--                                         -- true (to be revoked)
--   SELECT md5(prosrc) FROM pg_proc
--    WHERE oid = 'public.enforce_tap_edit_rules()'::regprocedure; -- must match the baseline body
--   SELECT to_regclass('public.tap_visitor_salts');             -- NULL (not created yet)
--   Whether any external client (the admin APK) calls get_public_tap: check
--   the API logs for /rest/v1/rpc/get_public_tap before applying.
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text DEFAULT NULL::text) RETURNS void
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_tap_id  UUID;
--   v_headers JSON;
--   v_ua      TEXT;
--   v_ip      TEXT;
--   v_ref     TEXT;
-- BEGIN
--   IF p_event NOT IN ('view', 'nfc', 'qr', 'link_click') THEN
--     RETURN;
--   END IF;
--
--   SELECT t.id INTO v_tap_id
--   FROM public.tap_profiles t
--   WHERE lower(t.slug) = lower(btrim(p_slug))
--     AND t.published IS TRUE
--     AND t.suspended_at IS NULL
--   LIMIT 1;
--
--   IF v_tap_id IS NULL THEN
--     RETURN;
--   END IF;
--
--   BEGIN
--     v_headers := current_setting('request.headers', true)::json;
--     v_ua  := v_headers ->> 'user-agent';
--     v_ip  := split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1);
--     v_ref := v_headers ->> 'referer';
--   EXCEPTION WHEN OTHERS THEN
--     v_ua := NULL; v_ip := NULL; v_ref := NULL;
--   END;
--
--   INSERT INTO public.tap_events
--     (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
--   VALUES (
--     v_tap_id,
--     p_event,
--     left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),
--     md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
--         to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
--     left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
--   );
-- END;
-- $$;
-- CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules() RETURNS trigger
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$ DECLARE v_tier TEXT;v_pass BOOLEAN;v_owned TEXT[];v_content BOOLEAN; BEGIN IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF; v_tier:=public.user_max_ui_tier(NEW.user_id); v_pass:=public.user_has_pass(NEW.user_id); NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[]) || ARRAY['phone','email']) AS u(value) WHERE value<>'' ORDER BY value); IF public.tier_rank(NEW.selected_ui_tier)>public.tier_rank(v_tier) THEN RAISE EXCEPTION 'You have not purchased the % experience.',NEW.selected_ui_tier USING ERRCODE='42501'; END IF; IF NEW.theme_palette<>ALL(public.theme_options('palette',v_tier,v_pass)) THEN RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_layout<>ALL(public.theme_options('layout',v_tier,v_pass)) THEN RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_buttons<>ALL(public.theme_options('buttons',v_tier,v_pass)) THEN RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_font<>ALL(public.theme_options('font',v_tier,v_pass)) THEN RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_animation<>ALL(public.theme_options('animation',v_tier,v_pass)) THEN RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned FROM public.entitlements e WHERE e.user_id=NEW.user_id AND e.is_active AND e.type='customization'; IF EXISTS(SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key) WHERE k.key<>ALL(v_owned||ARRAY['phone','email'])) THEN RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE='42501'; END IF; v_content:=NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.designation IS DISTINCT FROM OLD.designation OR NEW.company IS DISTINCT FROM OLD.company OR NEW.bio IS DISTINCT FROM OLD.bio OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.location IS DISTINCT FROM OLD.location OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.website IS DISTINCT FROM OLD.website OR NEW.instagram IS DISTINCT FROM OLD.instagram OR NEW.linkedin IS DISTINCT FROM OLD.linkedin OR NEW.youtube IS DISTINCT FROM OLD.youtube OR NEW.custom_links IS DISTINCT FROM OLD.custom_links OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons OR NEW.theme_font IS DISTINCT FROM OLD.theme_font OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL); IF NOT v_content THEN RETURN NEW; END IF; IF NOT public.tap_can_edit(NEW.user_id) THEN RAISE EXCEPTION 'You can change your Tap once every % days. The Customization Pass removes the limit.',public.tap_edit_interval_days() USING ERRCODE='42501'; END IF; NEW.last_content_edit_at:=NOW(); RETURN NEW; END; $$;
-- GRANT ALL ON FUNCTION public.get_public_tap(text) TO anon;
-- GRANT ALL ON FUNCTION public.get_public_tap(text) TO authenticated;
-- DROP INDEX IF EXISTS public.idx_tap_events_profile_visitor_time;
-- DROP TABLE IF EXISTS public.tap_visitor_salts;
-- ROLLBACK (end)
--   The block restores both live bodies exactly, gives get_public_tap back to the
--   API roles, and drops the salt table and index; supabase/tests/
--   migration-rollbacks.mjs runs it and compares the catalogue.
--
-- Idempotent: safe to run more than once.

-- 1. The legacy public reader: server only -------------------------------------
REVOKE ALL ON FUNCTION public.get_public_tap(text) FROM anon;
REVOKE ALL ON FUNCTION public.get_public_tap(text) FROM authenticated;

-- 2. Daily visitor salts ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tap_visitor_salts (
  day  date PRIMARY KEY,
  salt text NOT NULL
);

ALTER TABLE public.tap_visitor_salts ENABLE ROW LEVEL SECURITY;

-- No policies on purpose. Supabase's default privileges grant new tables to the
-- API roles, so take that back explicitly; only record_tap_event (SECURITY
-- DEFINER) reads and writes it.
REVOKE ALL ON TABLE public.tap_visitor_salts FROM PUBLIC;
REVOKE ALL ON TABLE public.tap_visitor_salts FROM anon, authenticated;
GRANT ALL ON TABLE public.tap_visitor_salts TO service_role;

COMMENT ON TABLE public.tap_visitor_salts IS
  'One random salt per UTC day for Tap visitor hashes (V6-073, migration 025). Deleted after two days. Never exposed.';

-- 3. The dedupe and rate-limit lookups ----------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tap_events_profile_visitor_time
  ON public.tap_events USING btree (tap_profile_id, visitor_hash, occurred_at DESC);

-- 4. record_tap_event: the live body, salted hash + dedupe + cap ---------------------
CREATE OR REPLACE FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tap_id  UUID;
  v_headers JSON;
  v_ua      TEXT;
  v_ip      TEXT;
  v_ref     TEXT;
  v_day     DATE;
  v_salt    TEXT;
  v_hash    TEXT;
  v_link    TEXT;
BEGIN
  IF p_event NOT IN ('view', 'nfc', 'qr', 'link_click') THEN
    RETURN;
  END IF;

  SELECT t.id INTO v_tap_id
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(p_slug))
    AND t.published IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;

  IF v_tap_id IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    v_headers := current_setting('request.headers', true)::json;
    v_ua  := v_headers ->> 'user-agent';
    v_ip  := split_part(COALESCE(v_headers ->> 'x-forwarded-for', ''), ',', 1);
    v_ref := v_headers ->> 'referer';
  EXCEPTION WHEN OTHERS THEN
    v_ua := NULL; v_ip := NULL; v_ref := NULL;
  END;

  -- V6-073: the visitor hash is salted with a random value per UTC day. The
  -- salt never leaves the database and is deleted after two days, so a hash
  -- cannot be reversed to an IP address and user agent by brute force, nor
  -- linked across days. Unique visitors per day still count correctly.
  v_day := (NOW() AT TIME ZONE 'UTC')::date;
  INSERT INTO public.tap_visitor_salts (day, salt)
  VALUES (v_day, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
  ON CONFLICT (day) DO NOTHING;
  SELECT s.salt INTO v_salt FROM public.tap_visitor_salts s WHERE s.day = v_day;
  DELETE FROM public.tap_visitor_salts WHERE day < v_day - 1;
  v_hash := encode(sha256(convert_to(
    v_salt || '|' || COALESCE(v_ua, '') || '|' || COALESCE(v_ip, ''), 'UTF8')), 'hex');
  v_link := left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48);

  -- V6-032: the same visitor sending the same event within 10 seconds counts
  -- once (double taps, reloads), and no visitor records more than 60 events
  -- on one Tap in an hour. Both read idx_tap_events_profile_visitor_time.
  IF EXISTS (
       SELECT 1 FROM public.tap_events e
       WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash
         AND e.event_type = p_event AND e.link_key IS NOT DISTINCT FROM v_link
         AND e.occurred_at > NOW() - INTERVAL '10 seconds')
     OR (SELECT count(*) FROM public.tap_events e
         WHERE e.tap_profile_id = v_tap_id AND e.visitor_hash = v_hash
           AND e.occurred_at > NOW() - INTERVAL '1 hour') >= 60 THEN
    RETURN;
  END IF;

  INSERT INTO public.tap_events
    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
  VALUES (
    v_tap_id,
    p_event,
    v_link,
    v_hash,
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
  );
END;
$$;


-- 5. enforce_tap_edit_rules: the live body, without forcing phone and email on --------
CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ DECLARE v_tier TEXT;v_pass BOOLEAN;v_owned TEXT[];v_content BOOLEAN; BEGIN IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF; v_tier:=public.user_max_ui_tier(NEW.user_id); v_pass:=public.user_has_pass(NEW.user_id); NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[])) AS u(value) WHERE value<>'' ORDER BY value); IF public.tier_rank(NEW.selected_ui_tier)>public.tier_rank(v_tier) THEN RAISE EXCEPTION 'You have not purchased the % experience.',NEW.selected_ui_tier USING ERRCODE='42501'; END IF; IF NEW.theme_palette<>ALL(public.theme_options('palette',v_tier,v_pass)) THEN RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_layout<>ALL(public.theme_options('layout',v_tier,v_pass)) THEN RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_buttons<>ALL(public.theme_options('buttons',v_tier,v_pass)) THEN RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_font<>ALL(public.theme_options('font',v_tier,v_pass)) THEN RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_animation<>ALL(public.theme_options('animation',v_tier,v_pass)) THEN RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned FROM public.entitlements e WHERE e.user_id=NEW.user_id AND e.is_active AND e.type='customization'; IF EXISTS(SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key) WHERE k.key<>ALL(v_owned||ARRAY['phone','email'])) THEN RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE='42501'; END IF; v_content:=NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.designation IS DISTINCT FROM OLD.designation OR NEW.company IS DISTINCT FROM OLD.company OR NEW.bio IS DISTINCT FROM OLD.bio OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.location IS DISTINCT FROM OLD.location OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.website IS DISTINCT FROM OLD.website OR NEW.instagram IS DISTINCT FROM OLD.instagram OR NEW.linkedin IS DISTINCT FROM OLD.linkedin OR NEW.youtube IS DISTINCT FROM OLD.youtube OR NEW.custom_links IS DISTINCT FROM OLD.custom_links OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons OR NEW.theme_font IS DISTINCT FROM OLD.theme_font OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL); IF NOT v_content THEN RETURN NEW; END IF; IF NOT public.tap_can_edit(NEW.user_id) THEN RAISE EXCEPTION 'You can change your Tap once every % days. The Customization Pass removes the limit.',public.tap_edit_interval_days() USING ERRCODE='42501'; END IF; NEW.last_content_edit_at:=NOW(); RETURN NEW; END; $$;



-- ###########################################################################
-- ## 026_orders_outlive_account_deletion.sql
-- ###########################################################################

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


-- ###########################################################################
-- ## 027_aaroh_catalog.sql
-- ###########################################################################

-- 027: SHYGON Version 1 — AAROH joins the card catalogue. Ten editions, each
-- in two finishes, alongside the SHYGON TAP V5 cards (which stay listed).
--
-- Decision:  DEC-2026-037 (simultaneous V5 + AAROH store, 2026-10-13/14). The
--            owner chose the ten editions of the AAROH design system (E01-E10,
--            "use the same number of cards and everything same") at the
--            proposed launch prices: Standard (Tier A) ₹999, Premium Finish
--            (Tier B) ₹1,499. It replaces the earlier 027 draft
--            (DEC-2026-036 A-1), which delisted every V5 card; the owner now
--            wants V5 on sale too. Migration numbering N-1.
-- Level:     L3 (supabase/migrations/**). Under DEC-2026-018 it needs a
--            24-hour cool-off plus the checklist review before it is approved
--            or applied. Never applied by tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026.
-- Changes:
--   - public.products: 20 rows inserted (10 editions x Standard/Premium). No
--     existing row changes. Stock is 0: the owner sets the counted inventory
--     when card sales open, so nothing can be sold that has not been made.
--   - public.card_editions: 10 rows inserted, one numbered series per edition
--     (chapters of 100, migration 017). Both finishes share their edition's
--     series.
--   - public.card_design_of(text): also recognises AAROH SKUs
--     (card-aaroh-<edition>-<standard|premium>; they carry no material, which
--     is not yet confirmed with the manufacturer), so issued AAROH cards are
--     numbered. V5 SKUs map exactly as before.
--   No table, column, policy or grant change.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT sku FROM public.products WHERE sku LIKE 'card-aaroh-%';
--        -- 0 rows (the INSERT skips existing SKUs; investigate any row found)
--   SELECT design FROM public.card_editions WHERE design LIKE 'aaroh-%';
--        -- 0 rows
--   SELECT prosrc FROM pg_proc WHERE proname = 'card_design_of';
--        -- matches the body in the rollback below (migration 017)
--
-- ROLLBACK (begin)
-- DELETE FROM public.products p
-- WHERE p.sku IN ('card-aaroh-obsidian-standard', 'card-aaroh-obsidian-premium',
--                 'card-aaroh-aureate-standard', 'card-aaroh-aureate-premium',
--                 'card-aaroh-monolith-standard', 'card-aaroh-monolith-premium',
--                 'card-aaroh-ivory-veil-standard', 'card-aaroh-ivory-veil-premium',
--                 'card-aaroh-cobalt-standard', 'card-aaroh-cobalt-premium',
--                 'card-aaroh-emerald-cipher-standard', 'card-aaroh-emerald-cipher-premium',
--                 'card-aaroh-prism-standard', 'card-aaroh-prism-premium',
--                 'card-aaroh-carbon-weave-standard', 'card-aaroh-carbon-weave-premium',
--                 'card-aaroh-heritage-geometry-standard', 'card-aaroh-heritage-geometry-premium',
--                 'card-aaroh-liquid-form-standard', 'card-aaroh-liquid-form-premium')
--   AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.sku = p.sku);
-- UPDATE public.products SET active = false WHERE sku LIKE 'card-aaroh-%';
-- DELETE FROM public.card_editions
-- WHERE design IN ('aaroh-obsidian', 'aaroh-aureate',
--                 'aaroh-monolith', 'aaroh-ivory-veil',
--                 'aaroh-cobalt', 'aaroh-emerald-cipher',
--                 'aaroh-prism', 'aaroh-carbon-weave',
--                 'aaroh-heritage-geometry', 'aaroh-liquid-form') AND issued = 0;
-- CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text) RETURNS text
--     LANGUAGE sql IMMUTABLE
--     AS $_$
--   SELECT substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$');
-- $_$;
-- ROLLBACK (end)
--
-- A row that was ordered is never deleted, only delisted; an edition that has
-- issued cards keeps its counter. Idempotent: safe to run more than once.

INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
VALUES
  ('card-aaroh-obsidian-standard', 'SHYGON AAROH Obsidian', 'aaroh-obsidian', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/obsidian-standard-front-600.webp', 'AAROH card, Obsidian edition, Standard (Tier A).', 0, true, 200),
  ('card-aaroh-obsidian-premium', 'SHYGON AAROH Obsidian — Premium Finish', 'aaroh-obsidian', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/obsidian-premium-front-600.webp', 'AAROH card, Obsidian edition, Premium Finish (Tier B).', 0, true, 201),
  ('card-aaroh-aureate-standard', 'SHYGON AAROH Aureate', 'aaroh-aureate', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/aureate-standard-front-600.webp', 'AAROH card, Aureate edition, Standard (Tier A).', 0, true, 210),
  ('card-aaroh-aureate-premium', 'SHYGON AAROH Aureate — Premium Finish', 'aaroh-aureate', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/aureate-premium-front-600.webp', 'AAROH card, Aureate edition, Premium Finish (Tier B).', 0, true, 211),
  ('card-aaroh-monolith-standard', 'SHYGON AAROH Monolith', 'aaroh-monolith', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/monolith-standard-front-600.webp', 'AAROH card, Monolith edition, Standard (Tier A).', 0, true, 220),
  ('card-aaroh-monolith-premium', 'SHYGON AAROH Monolith — Premium Finish', 'aaroh-monolith', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/monolith-premium-front-600.webp', 'AAROH card, Monolith edition, Premium Finish (Tier B).', 0, true, 221),
  ('card-aaroh-ivory-veil-standard', 'SHYGON AAROH Ivory Veil', 'aaroh-ivory-veil', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/ivory-veil-standard-front-600.webp', 'AAROH card, Ivory Veil edition, Standard (Tier A).', 0, true, 230),
  ('card-aaroh-ivory-veil-premium', 'SHYGON AAROH Ivory Veil — Premium Finish', 'aaroh-ivory-veil', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/ivory-veil-premium-front-600.webp', 'AAROH card, Ivory Veil edition, Premium Finish (Tier B).', 0, true, 231),
  ('card-aaroh-cobalt-standard', 'SHYGON AAROH Cobalt', 'aaroh-cobalt', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/cobalt-standard-front-600.webp', 'AAROH card, Cobalt edition, Standard (Tier A).', 0, true, 240),
  ('card-aaroh-cobalt-premium', 'SHYGON AAROH Cobalt — Premium Finish', 'aaroh-cobalt', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/cobalt-premium-front-600.webp', 'AAROH card, Cobalt edition, Premium Finish (Tier B).', 0, true, 241),
  ('card-aaroh-emerald-cipher-standard', 'SHYGON AAROH Emerald Cipher', 'aaroh-emerald-cipher', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/emerald-cipher-standard-front-600.webp', 'AAROH card, Emerald Cipher edition, Standard (Tier A).', 0, true, 250),
  ('card-aaroh-emerald-cipher-premium', 'SHYGON AAROH Emerald Cipher — Premium Finish', 'aaroh-emerald-cipher', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/emerald-cipher-premium-front-600.webp', 'AAROH card, Emerald Cipher edition, Premium Finish (Tier B).', 0, true, 251),
  ('card-aaroh-prism-standard', 'SHYGON AAROH Prism', 'aaroh-prism', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/prism-standard-front-600.webp', 'AAROH card, Prism edition, Standard (Tier A).', 0, true, 260),
  ('card-aaroh-prism-premium', 'SHYGON AAROH Prism — Premium Finish', 'aaroh-prism', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/prism-premium-front-600.webp', 'AAROH card, Prism edition, Premium Finish (Tier B).', 0, true, 261),
  ('card-aaroh-carbon-weave-standard', 'SHYGON AAROH Carbon Weave', 'aaroh-carbon-weave', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/carbon-weave-standard-front-600.webp', 'AAROH card, Carbon Weave edition, Standard (Tier A).', 0, true, 270),
  ('card-aaroh-carbon-weave-premium', 'SHYGON AAROH Carbon Weave — Premium Finish', 'aaroh-carbon-weave', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/carbon-weave-premium-front-600.webp', 'AAROH card, Carbon Weave edition, Premium Finish (Tier B).', 0, true, 271),
  ('card-aaroh-heritage-geometry-standard', 'SHYGON AAROH Heritage Geometry', 'aaroh-heritage-geometry', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/heritage-geometry-standard-front-600.webp', 'AAROH card, Heritage Geometry edition, Standard (Tier A).', 0, true, 280),
  ('card-aaroh-heritage-geometry-premium', 'SHYGON AAROH Heritage Geometry — Premium Finish', 'aaroh-heritage-geometry', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/heritage-geometry-premium-front-600.webp', 'AAROH card, Heritage Geometry edition, Premium Finish (Tier B).', 0, true, 281),
  ('card-aaroh-liquid-form-standard', 'SHYGON AAROH Liquid Form', 'aaroh-liquid-form', NULL, 'standard', 99900, 'card',
   '/assets/aaroh/liquid-form-standard-front-600.webp', 'AAROH card, Liquid Form edition, Standard (Tier A).', 0, true, 290),
  ('card-aaroh-liquid-form-premium', 'SHYGON AAROH Liquid Form — Premium Finish', 'aaroh-liquid-form', NULL, 'premium', 149900, 'card',
   '/assets/aaroh/liquid-form-premium-front-600.webp', 'AAROH card, Liquid Form edition, Premium Finish (Tier B).', 0, true, 291)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('aaroh-obsidian', 'AAROH Obsidian', 100),
  ('aaroh-aureate', 'AAROH Aureate', 100),
  ('aaroh-monolith', 'AAROH Monolith', 100),
  ('aaroh-ivory-veil', 'AAROH Ivory Veil', 100),
  ('aaroh-cobalt', 'AAROH Cobalt', 100),
  ('aaroh-emerald-cipher', 'AAROH Emerald Cipher', 100),
  ('aaroh-prism', 'AAROH Prism', 100),
  ('aaroh-carbon-weave', 'AAROH Carbon Weave', 100),
  ('aaroh-heritage-geometry', 'AAROH Heritage Geometry', 100),
  ('aaroh-liquid-form', 'AAROH Liquid Form', 100)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT COALESCE(
    substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$'),
    substring(p_sku FROM '^card-(aaroh-[a-z0-9-]+)-(?:standard|premium)$')
  );
$_$;


-- ###########################################################################
-- ## 028_guard_suspension_on_insert.sql
-- ###########################################################################

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


-- ###########################################################################
-- ## 029_emergency_contacts_and_alerts.sql
-- ###########################################################################

-- 029: SHYGON AAROH emergency contacts and alerts (the emergency module's data,
-- state machine and audit trail).
--
-- Decision:  the owner's AAROH backend brief of 2026-10-19 ("real emergency
--            contact system"); DEC-2026-038 (PROPOSED, filed with this
--            migration): scope, the visitor-initiated alert, the provider and
--            retention. Design inputs: doc 03 §3.1 (sensitive data isolated from
--            tap_profiles, never in a public RPC), doc 04 §4.1 (emergency is a
--            separate, purpose-bound channel: default off, rate-limited, owner
--            notified, audited), doc 05 §2 (3 per day per device), doc 07 T18
--            (relay, never reveal; no medical data). Migration numbering N-1:
--            027 is held aside (DEC-2026-037), 028 is the suspension guard.
--            APPROVED by the owner 2026-10-19 (DEC-2026-038 Q1, in session).
--            Approval of the design is not approval to apply: see Level.
-- Level:     L3 (new tables holding third-party personal data; new privileged
--            functions). Under DEC-2026-018 it needs a 24-hour cool-off plus the
--            checklist review before it is approved or applied. Never applied by
--            tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026 and
--            028. It reads and writes only its own new tables, plus three
--            existing ones through their documented columns: inserts into
--            notifications (the owner's in-app notice) and admin_notifications
--            (an abuse report), and reads tap_profiles / profiles (state checks,
--            the owner's name for the message).
-- Data:      none changed. New tables start empty.
--
-- WHAT IT ADDS
--   Tables (RLS on, NO policies, no grant to anon or authenticated: a browser
--   can never read or write them, whatever its token says):
--     emergency_settings            one row per owner: visitor alerts on/off
--     emergency_contacts            the owner's trusted contacts (name, E.164)
--     emergency_contact_challenges  contact verification codes (HMAC only)
--     emergency_events              one alert: who started it, its state
--     emergency_event_recipients    one row per contact per alert
--     emergency_delivery_attempts   one row per provider call (append-only)
--     emergency_audit               every security-relevant step (append-only)
--   Functions: SECURITY DEFINER, EXECUTE for service_role only (the server
--   function netlify/functions/emergency.mjs), except
--   admin_list_emergency_events, which any signed-in caller may execute and
--   which refuses everyone without the support.read permission.
--
-- RULES IT ENFORCES (each is tested in supabase/tests/emergency-db.mjs)
--   - Only VERIFIED contacts are ever alerted. At most 5 contacts per owner;
--     one row per number per owner. Changing a number clears its verification.
--   - Verification: 10-minute code, 5 tries, 45 s between sends to a contact,
--     5 sends per owner per hour, 3 sends per phone number per 24 h across ALL
--     owners (so nobody can use SHYGON to text a stranger repeatedly).
--   - Idempotency: (owner, initiator, idempotency key) is unique; a repeat
--     returns the first alert and sends nothing.
--   - Owner alerts: one in progress per 2 minutes, 5 per hour, 10 per 24 h.
--   - Visitor alerts (initiator 'public'): only when the owner switched them on
--     (default OFF) with an acknowledgement, has a verified contact, and the
--     Tap is published and neither the Tap nor the account is suspended.
--     3 per owner per 24 h; 15 minutes between alerts from one Tap; 1 per
--     visitor per Tap and 3 per visitor per 24 h; 50 per hour platform-wide.
--     The owner is told in-app every time; a reported alert switches visitor
--     alerts off.
--   - Delivery: at most 3 provider attempts per recipient; a recipient is
--     claimed with a 90-second lease and an attempt number (a stale attempt
--     cannot overwrite a newer one). "accepted" means the provider took the
--     message; only a provider delivery receipt makes it "delivered".
--   - Retention: recipients' full numbers are erased 7 days after the alert
--     completes; alerts (with recipients and attempts) are deleted after 180
--     days; verification codes after 24 h; audit rows after 400 days. Deleting
--     an account deletes all of it (ON DELETE CASCADE from auth.users).
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.emergency_contacts'), to_regclass('public.emergency_events');
--                                          -- both NULL
--   SELECT count(*) FROM pg_proc WHERE proname LIKE 'emergency\_%'
--                                           OR proname = 'admin_list_emergency_events';
--                                          -- 0
--   SELECT has_function_privilege('authenticated', 'public.require_admin(text)', 'EXECUTE');
--                                          -- true (used by the admin RPC)
--   And confirm the production default privileges still grant new tables and
--   functions to anon/authenticated (Supabase's default): this file revokes them.
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.admin_list_emergency_events(text, integer, integer);
-- DROP FUNCTION IF EXISTS public.emergency_purge();
-- DROP FUNCTION IF EXISTS public.emergency_report(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_cancel(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_event_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_events_for(uuid, integer);
-- DROP FUNCTION IF EXISTS public.emergency_provider_status(text, text, text, text);
-- DROP FUNCTION IF EXISTS public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text);
-- DROP FUNCTION IF EXISTS public.emergency_claim_due(uuid, integer);
-- DROP FUNCTION IF EXISTS public.emergency_requeue_not_sent(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_alert_open(uuid, text, text, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_public_target(text);
-- DROP FUNCTION IF EXISTS public.emergency_verification_confirm(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_verification_abort(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_verification_start(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_settings_set(uuid, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.emergency_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_contact_remove(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_contact_save(uuid, uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.emergency_contacts_for(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_event_refresh(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_disable_public_if_unready(uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_log(uuid, uuid, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.emergency_owner_name(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_mask_phone(text);
-- DROP TABLE IF EXISTS public.emergency_audit;
-- DROP TABLE IF EXISTS public.emergency_delivery_attempts;
-- DROP TABLE IF EXISTS public.emergency_event_recipients;
-- DROP TABLE IF EXISTS public.emergency_events;
-- DROP TABLE IF EXISTS public.emergency_contact_challenges;
-- DROP TABLE IF EXISTS public.emergency_contacts;
-- DROP TABLE IF EXISTS public.emergency_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.emergency_settings (
  user_id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_alerts_enabled    boolean NOT NULL DEFAULT false,
  public_alerts_changed_at timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  relationship text CHECK (relationship IS NULL OR length(relationship) <= 40),
  phone_e164   text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel      text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_contacts_one_per_number UNIQUE (user_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON public.emergency_contacts (user_id);

-- contact_id is SET NULL on delete so the per-number send limit survives a
-- contact being removed and added again.
CREATE TABLE IF NOT EXISTS public.emergency_contact_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  phone_digest text NOT NULL,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_contact ON public.emergency_contact_challenges (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_user ON public.emergency_contact_challenges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_digest ON public.emergency_contact_challenges (phone_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emergency_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiator        text NOT NULL CHECK (initiator IN ('owner', 'public')),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  tap_profile_id   uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  visitor_digest   text,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'partial', 'failed', 'not_sent', 'cancelled')),
  recipient_count  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  reported_at      timestamptz,
  report_reason    text CHECK (report_reason IS NULL OR length(report_reason) <= 300),
  CONSTRAINT emergency_events_idempotent UNIQUE (user_id, initiator, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_emergency_events_user ON public.emergency_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_initiator ON public.emergency_events (initiator, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_tap ON public.emergency_events (tap_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_visitor ON public.emergency_events (visitor_digest, created_at DESC)
  WHERE visitor_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.emergency_event_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.emergency_events(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  contact_name        text NOT NULL,
  phone_last4         text NOT NULL,
  phone_e164          text,
  channel             text NOT NULL DEFAULT 'sms',
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sending', 'retry_wait', 'accepted', 'delivered',
                                        'undelivered', 'failed', 'not_sent', 'cancelled')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  lease_until         timestamptz,
  provider            text,
  provider_message_id text,
  provider_status     text,
  last_error          text,
  accepted_at         timestamptz,
  delivered_at        timestamptz,
  failed_at           timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_recipients_event ON public.emergency_event_recipients (event_id);
CREATE INDEX IF NOT EXISTS idx_emergency_recipients_due ON public.emergency_event_recipients (status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_recipients_provider_message
  ON public.emergency_event_recipients (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.emergency_delivery_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id        uuid NOT NULL REFERENCES public.emergency_event_recipients(id) ON DELETE CASCADE,
  attempt_no          integer NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  outcome             text CHECK (outcome IS NULL OR outcome IN
                        ('accepted', 'rejected', 'transient', 'timeout', 'not_configured', 'lease_expired')),
  provider            text,
  provider_message_id text,
  http_status         integer,
  error_code          text,
  CONSTRAINT emergency_attempts_one_per_number UNIQUE (recipient_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS public.emergency_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   uuid REFERENCES public.emergency_events(id) ON DELETE SET NULL,
  actor      text NOT NULL CHECK (actor IN ('owner', 'public', 'system', 'provider', 'admin')),
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_audit_user ON public.emergency_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_audit_event ON public.emergency_audit (event_id);

-- Closed to every API client. RLS is on with no policies, and the client roles
-- hold no privilege at all (Supabase grants new tables to them by default).
-- The server role keeps what the tables need; the two append-only tables
-- cannot be changed or deleted by it (only by the definer functions below and
-- by the account-deletion cascade).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['emergency_settings', 'emergency_contacts', 'emergency_contact_challenges',
                           'emergency_events', 'emergency_event_recipients', 'emergency_delivery_attempts',
                           'emergency_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.emergency_audit, public.emergency_delivery_attempts FROM service_role;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "+91 ••••• 06633": enough to recognise the number, not enough to reuse it
-- (the format card-otp shows).
CREATE OR REPLACE FUNCTION public.emergency_mask_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE WHEN p_phone IS NULL THEN NULL
              ELSE left(p_phone, 3) || ' ••••• ' || right(p_phone, 5) END;
$$;

-- The owner's name as it may appear in a text message: letters, spaces and
-- . ' - only, at most 30 characters, so a name cannot carry a link or
-- instructions to a stranger's phone.
CREATE OR REPLACE FUNCTION public.emergency_owner_name(p_user uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(t.display_name), ''))
    INTO v
    FROM (SELECT p_user AS id) x
    LEFT JOIN public.profiles p ON p.id = x.id
    LEFT JOIN public.tap_profiles t ON t.user_id = x.id;
  v := btrim(regexp_replace(COALESCE(v, ''), '[^[:alpha:][:space:].''-]', '', 'g'));
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  IF v = '' THEN RETURN 'A SHYGON member'; END IF;
  RETURN left(v, 30);
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_log(p_user uuid, p_event uuid, p_actor text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.emergency_audit (user_id, event_id, actor, action, detail)
  VALUES (p_user, p_event, p_actor, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- Visitor alerts need a verified contact. When the last one goes, they are
-- switched off rather than left "on" with nobody to reach.
CREATE OR REPLACE FUNCTION public.emergency_disable_public_if_unready(p_user uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  UPDATE public.emergency_settings
     SET public_alerts_enabled = false, public_alerts_changed_at = now(), updated_at = now()
   WHERE user_id = p_user AND public_alerts_enabled;
  IF FOUND THEN
    PERFORM public.emergency_log(p_user, NULL, 'system', 'settings.public_alerts.disabled', jsonb_build_object('reason', p_reason));
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- Contacts and settings (the owner's; p_user is the caller the server verified)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.emergency_contacts_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'relationship', c.relationship,
           'phone', public.emergency_mask_phone(c.phone_e164), 'channel', c.channel,
           'verified', c.verified_at IS NOT NULL, 'verifiedAt', c.verified_at,
           'createdAt', c.created_at, 'updatedAt', c.updated_at) ORDER BY c.created_at), '[]'::jsonb)
    FROM public.emergency_contacts c
   WHERE c.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.emergency_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'publicAlertsEnabled', COALESCE(s.public_alerts_enabled, false),
    'publicAlertsChangedAt', s.public_alerts_changed_at,
    'contacts', (SELECT count(*) FROM public.emergency_contacts c WHERE c.user_id = x.id),
    'verifiedContacts', (SELECT count(*) FROM public.emergency_contacts c WHERE c.user_id = x.id AND c.verified_at IS NOT NULL),
    'maxContacts', 5,
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t
                                   WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL))
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.emergency_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.emergency_contact_save(p_user uuid, p_contact_id uuid, p_name text, p_relationship text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_rel  text := NULLIF(btrim(COALESCE(p_relationship, '')), '');
  v_old  public.emergency_contacts;
  v_row  public.emergency_contacts;
  v_off  boolean := false;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'emergency:unauthenticated' USING ERRCODE = '42501'; END IF;
  IF length(v_name) < 1 OR length(v_name) > 80 THEN RAISE EXCEPTION 'emergency:invalid_name' USING ERRCODE = '22023'; END IF;
  IF v_rel IS NOT NULL AND length(v_rel) > 40 THEN RAISE EXCEPTION 'emergency:invalid_relationship' USING ERRCODE = '22023'; END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'emergency:invalid_phone' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));

  IF p_contact_id IS NULL THEN
    IF (SELECT count(*) FROM public.emergency_contacts WHERE user_id = p_user) >= 5 THEN
      RAISE EXCEPTION 'emergency:too_many_contacts' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      INSERT INTO public.emergency_contacts (user_id, name, relationship, phone_e164)
      VALUES (p_user, v_name, v_rel, p_phone)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'emergency:duplicate_contact' USING ERRCODE = 'P0001';
    END;
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.added',
      jsonb_build_object('contactId', v_row.id, 'last4', right(v_row.phone_e164, 4)));
  ELSE
    SELECT * INTO v_old FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
    BEGIN
      UPDATE public.emergency_contacts
         SET name = v_name, relationship = v_rel, phone_e164 = p_phone,
             verified_at = CASE WHEN v_old.phone_e164 = p_phone THEN v_old.verified_at END,
             updated_at = now()
       WHERE id = p_contact_id
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'emergency:duplicate_contact' USING ERRCODE = 'P0001';
    END;
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.updated',
      jsonb_build_object('contactId', v_row.id, 'numberChanged', v_old.phone_e164 <> p_phone,
                         'last4', right(v_row.phone_e164, 4)));
    IF v_old.phone_e164 <> p_phone THEN
      v_off := public.emergency_disable_public_if_unready(p_user, 'no_verified_contact');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'relationship', v_row.relationship,
    'phone', public.emergency_mask_phone(v_row.phone_e164), 'channel', v_row.channel,
    'verified', v_row.verified_at IS NOT NULL, 'verifiedAt', v_row.verified_at,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at,
    'publicAlertsDisabled', v_off);
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_contact_remove(p_user uuid, p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_last4 text; v_off boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  DELETE FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user
  RETURNING right(phone_e164, 4) INTO v_last4;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.removed',
    jsonb_build_object('contactId', p_contact_id, 'last4', v_last4));
  v_off := public.emergency_disable_public_if_unready(p_user, 'no_verified_contact');
  RETURN jsonb_build_object('removed', true, 'publicAlertsDisabled', v_off);
END;
$$;

-- Both directions need p_acknowledge: the owner has been shown what visitor
-- alerts do (on) or that visitors can no longer reach their contacts (off).
CREATE OR REPLACE FUNCTION public.emergency_settings_set(p_user uuid, p_public_alerts_enabled boolean, p_acknowledge boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_public_alerts_enabled IS NULL THEN RAISE EXCEPTION 'emergency:invalid_setting' USING ERRCODE = '22023'; END IF;
  IF p_acknowledge IS NOT TRUE THEN RAISE EXCEPTION 'emergency:acknowledge_required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  IF p_public_alerts_enabled AND NOT EXISTS (
       SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'emergency:no_verified_contacts' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.emergency_settings AS s (user_id, public_alerts_enabled, public_alerts_changed_at, updated_at)
  VALUES (p_user, p_public_alerts_enabled, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET public_alerts_enabled = EXCLUDED.public_alerts_enabled,
        public_alerts_changed_at = CASE WHEN s.public_alerts_enabled IS DISTINCT FROM EXCLUDED.public_alerts_enabled
                                        THEN now() ELSE s.public_alerts_changed_at END,
        updated_at = now();
  PERFORM public.emergency_log(p_user, NULL, 'owner',
    CASE WHEN p_public_alerts_enabled THEN 'settings.public_alerts.enabled' ELSE 'settings.public_alerts.disabled' END,
    jsonb_build_object('acknowledged', true));
  RETURN public.emergency_settings_for(p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- Contact verification. The server makes the code and its HMAC; the database
-- keeps only the HMAC and enforces the limits.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.emergency_verification_start(p_user uuid, p_contact_id uuid, p_challenge_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c      public.emergency_contacts;
  v_digest text;
  v_last   timestamptz;
  v_wait   integer;
  v_exp    timestamptz := now() + interval '10 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  SELECT * INTO v_c FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.verified_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_verified' USING ERRCODE = 'P0001'; END IF;

  SELECT max(created_at) INTO v_last FROM public.emergency_contact_challenges WHERE contact_id = p_contact_id;
  v_wait := CEIL(EXTRACT(EPOCH FROM (v_last + interval '45 seconds' - now())))::int;
  IF v_wait > 0 THEN
    RAISE EXCEPTION 'emergency:verify_cooldown' USING ERRCODE = 'P0001', DETAIL = v_wait::text;
  END IF;
  IF (SELECT count(*) FROM public.emergency_contact_challenges
       WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'emergency:verify_rate_limited' USING ERRCODE = 'P0001', DETAIL = '3600';
  END IF;
  v_digest := encode(sha256(convert_to(v_c.phone_e164, 'UTF8')), 'hex');
  IF (SELECT count(*) FROM public.emergency_contact_challenges
       WHERE phone_digest = v_digest AND created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'emergency:number_rate_limited' USING ERRCODE = 'P0001', DETAIL = '86400';
  END IF;

  -- One open code per contact: a new one retires the old.
  UPDATE public.emergency_contact_challenges SET consumed_at = now()
   WHERE contact_id = p_contact_id AND consumed_at IS NULL;
  INSERT INTO public.emergency_contact_challenges (id, user_id, contact_id, phone_digest, code_hash, expires_at)
  VALUES (p_challenge_id, p_user, p_contact_id, v_digest, p_code_hash, v_exp);
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verification.requested',
    jsonb_build_object('contactId', p_contact_id, 'last4', right(v_c.phone_e164, 4)));

  RETURN jsonb_build_object('phone', v_c.phone_e164, 'phoneMasked', public.emergency_mask_phone(v_c.phone_e164),
                            'ownerName', public.emergency_owner_name(p_user), 'expiresAt', v_exp);
END;
$$;

-- The text never left: retire the code so it cannot be guessed at.
CREATE OR REPLACE FUNCTION public.emergency_verification_abort(p_user uuid, p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.emergency_contact_challenges SET consumed_at = now()
   WHERE id = p_challenge_id AND user_id = p_user AND consumed_at IS NULL;
  PERFORM public.emergency_log(p_user, NULL, 'system', 'contact.verification.not_sent',
    jsonb_build_object('challengeId', p_challenge_id));
END;
$$;

-- Returns {ok, code, attemptsLeft?, contact?}; refusals are values, not
-- exceptions, so a wrong guess still counts.
CREATE OR REPLACE FUNCTION public.emergency_verification_confirm(p_user uuid, p_contact_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_ch public.emergency_contact_challenges; v_left integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'contact_not_found');
  END IF;
  SELECT * INTO v_ch FROM public.emergency_contact_challenges
   WHERE contact_id = p_contact_id AND user_id = p_user AND consumed_at IS NULL
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_challenge'); END IF;
  IF v_ch.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'code_expired'); END IF;
  IF v_ch.attempts >= 5 THEN RETURN jsonb_build_object('ok', false, 'code', 'too_many_attempts'); END IF;

  IF v_ch.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE public.emergency_contact_challenges SET attempts = attempts + 1 WHERE id = v_ch.id;
    v_left := 5 - (v_ch.attempts + 1);
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verification.wrong_code',
      jsonb_build_object('contactId', p_contact_id, 'attemptsLeft', v_left));
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_left > 0 THEN 'wrong_code' ELSE 'too_many_attempts' END,
                              'attemptsLeft', v_left);
  END IF;

  UPDATE public.emergency_contact_challenges SET consumed_at = now() WHERE id = v_ch.id AND consumed_at IS NULL;
  UPDATE public.emergency_contacts SET verified_at = now(), updated_at = now() WHERE id = p_contact_id;
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verified', jsonb_build_object('contactId', p_contact_id));
  RETURN jsonb_build_object('ok', true, 'contact',
    (SELECT e FROM jsonb_array_elements(public.emergency_contacts_for(p_user)) e WHERE e->>'id' = p_contact_id::text));
END;
$$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

-- Whether a visitor on /t/<slug> may raise an alert, and for whom. NULL for an
-- unknown, unpublished or suspended Tap, a suspended account, visitor alerts
-- off, or no verified contact: the caller cannot tell these apart.
CREATE OR REPLACE FUNCTION public.emergency_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id)
    FROM public.tap_profiles t
    JOIN public.emergency_settings s ON s.user_id = t.user_id AND s.public_alerts_enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL
     AND p.suspended_at IS NULL
     AND EXISTS (SELECT 1 FROM public.emergency_contacts c WHERE c.user_id = t.user_id AND c.verified_at IS NOT NULL)
   LIMIT 1;
$$;

-- Status of one alert, from its recipients. "sent" = every message accepted by
-- the provider (receipt not confirmed); "delivered" = every one confirmed by a
-- provider receipt; "partial" = some reached the provider, some failed;
-- "not_sent" = nothing could be sent because no provider is configured.
CREATE OR REPLACE FUNCTION public.emergency_event_refresh(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total int; v_pending int; v_started int; v_delivered int; v_accepted int; v_not_sent int;
  v_cancelled_at timestamptz; v_status text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('queued', 'sending', 'retry_wait')),
         count(*) FILTER (WHERE attempts > 0),
         count(*) FILTER (WHERE status = 'delivered'),
         count(*) FILTER (WHERE status = 'accepted'),
         count(*) FILTER (WHERE status = 'not_sent')
    INTO v_total, v_pending, v_started, v_delivered, v_accepted, v_not_sent
    FROM public.emergency_event_recipients WHERE event_id = p_event_id;
  SELECT cancelled_at INTO v_cancelled_at FROM public.emergency_events WHERE id = p_event_id;

  v_status := CASE
    WHEN v_pending > 0 THEN CASE WHEN v_started > 0 THEN 'sending' ELSE 'queued' END
    WHEN v_total > 0 AND v_delivered = v_total THEN 'delivered'
    WHEN v_total > 0 AND v_delivered + v_accepted = v_total THEN 'sent'
    WHEN v_delivered + v_accepted > 0 THEN 'partial'
    WHEN v_cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN v_total > 0 AND v_not_sent = v_total THEN 'not_sent'
    ELSE 'failed'
  END;

  UPDATE public.emergency_events
     SET status = v_status,
         completed_at = CASE WHEN v_pending = 0 THEN COALESCE(completed_at, now()) END,
         updated_at = now()
   WHERE id = p_event_id;
  RETURN v_status;
END;
$$;

-- Opens an alert. Returns {ok:true, eventId, replayed} or {ok:false, code,
-- retryAfter?, eventId?}. Refusals are returned (not raised) so the refusal is
-- audited.
CREATE OR REPLACE FUNCTION public.emergency_alert_open(p_user uuid, p_initiator text, p_idempotency_key text,
                                                       p_tap_profile_id uuid DEFAULT NULL, p_visitor_digest text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event  public.emergency_events;
  v_code   text;
  v_wait   integer;
  v_recent uuid;
  v_n      integer;
BEGIN
  IF p_user IS NULL OR p_initiator NOT IN ('owner', 'public') THEN
    RAISE EXCEPTION 'emergency:invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));

  SELECT * INTO v_event FROM public.emergency_events
   WHERE user_id = p_user AND initiator = p_initiator AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'eventId', v_event.id, 'replayed', true);
  END IF;

  IF p_initiator = 'owner' THEN
    SELECT id INTO v_recent FROM public.emergency_events
     WHERE user_id = p_user AND initiator = 'owner' AND cancelled_at IS NULL
       AND created_at > now() - interval '2 minutes'
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_code := 'alert_in_progress';
    ELSE
      SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now())))::int, count(*)
        INTO v_wait, v_n FROM public.emergency_events
       WHERE user_id = p_user AND initiator = 'owner' AND created_at > now() - interval '1 hour';
      IF v_n >= 5 THEN v_code := 'alert_rate_limited';
      ELSE
        SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - now())))::int, count(*)
          INTO v_wait, v_n FROM public.emergency_events
         WHERE user_id = p_user AND initiator = 'owner' AND created_at > now() - interval '24 hours';
        IF v_n >= 10 THEN v_code := 'alert_rate_limited'; ELSE v_wait := NULL; END IF;
      END IF;
    END IF;
  ELSE
    -- The target is re-checked inside the lock: the owner may have switched
    -- visitor alerts off, or the Tap gone dark, since the server looked.
    IF p_tap_profile_id IS NULL OR p_visitor_digest IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.tap_profiles t
           JOIN public.emergency_settings s ON s.user_id = t.user_id AND s.public_alerts_enabled
           LEFT JOIN public.profiles p ON p.id = t.user_id
          WHERE t.id = p_tap_profile_id AND t.user_id = p_user
            AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL AND p.suspended_at IS NULL) THEN
      v_code := 'unavailable';
    ELSIF (SELECT count(*) FROM public.emergency_events
            WHERE initiator = 'public' AND created_at > now() - interval '1 hour') >= 50 THEN
      v_code := 'service_busy'; v_wait := 600;
    ELSIF (SELECT count(*) FROM public.emergency_events
            WHERE user_id = p_user AND initiator = 'public' AND created_at > now() - interval '24 hours') >= 3 THEN
      v_code := 'alert_rate_limited';
      SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - now())))::int INTO v_wait
        FROM public.emergency_events WHERE user_id = p_user AND initiator = 'public' AND created_at > now() - interval '24 hours';
    ELSIF EXISTS (SELECT 1 FROM public.emergency_events
                   WHERE tap_profile_id = p_tap_profile_id AND initiator = 'public' AND created_at > now() - interval '15 minutes') THEN
      v_code := 'alert_rate_limited';
      SELECT CEIL(EXTRACT(EPOCH FROM (max(created_at) + interval '15 minutes' - now())))::int INTO v_wait
        FROM public.emergency_events WHERE tap_profile_id = p_tap_profile_id AND initiator = 'public';
    ELSIF EXISTS (SELECT 1 FROM public.emergency_events
                   WHERE visitor_digest = p_visitor_digest AND tap_profile_id = p_tap_profile_id
                     AND created_at > now() - interval '24 hours')
       OR (SELECT count(*) FROM public.emergency_events
            WHERE visitor_digest = p_visitor_digest AND created_at > now() - interval '24 hours') >= 3 THEN
      v_code := 'alert_rate_limited'; v_wait := 86400;
    END IF;
  END IF;

  IF v_code IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    v_code := CASE WHEN p_initiator = 'public' THEN 'unavailable' ELSE 'no_verified_contacts' END;
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.emergency_log(p_user, NULL, p_initiator, 'alert.refused',
      jsonb_build_object('code', v_code, 'tapProfileId', p_tap_profile_id));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1), 'eventId', v_recent);
  END IF;

  INSERT INTO public.emergency_events (user_id, initiator, idempotency_key, tap_profile_id, visitor_digest)
  VALUES (p_user, p_initiator, p_idempotency_key,
          CASE WHEN p_initiator = 'public' THEN p_tap_profile_id END,
          CASE WHEN p_initiator = 'public' THEN p_visitor_digest END)
  RETURNING * INTO v_event;

  INSERT INTO public.emergency_event_recipients (event_id, contact_id, contact_name, phone_last4, phone_e164, channel)
  SELECT v_event.id, c.id, c.name, right(c.phone_e164, 4), c.phone_e164, c.channel
    FROM public.emergency_contacts c
   WHERE c.user_id = p_user AND c.verified_at IS NOT NULL
   ORDER BY c.created_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.emergency_events SET recipient_count = v_n WHERE id = v_event.id;

  PERFORM public.emergency_log(p_user, v_event.id, p_initiator, 'alert.created',
    jsonb_build_object('recipients', v_n, 'tapProfileId', v_event.tap_profile_id));

  IF p_initiator = 'public' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (p_user, 'security', 'Your emergency contacts were alerted',
            'Someone using your SHYGON profile sent an emergency alert to your emergency contacts. '
            || 'If this was not a real emergency, report it from your emergency settings.',
            '/shygontap/emergency', jsonb_build_object('emergencyEventId', v_event.id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'eventId', v_event.id, 'replayed', false);
END;
$$;

-- Claims recipients that are due for a provider attempt. Each claim gets a
-- 90-second lease and the next attempt number; an attempt whose lease ran
-- out (the server died mid-send, so the outcome is unknown) is closed as
-- lease_expired and counts toward the three attempts.
CREATE OR REPLACE FUNCTION public.emergency_claim_due(p_event_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (recipient_id uuid, attempt_no integer, event_id uuid, initiator text, phone_e164 text,
               owner_name text, event_created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r record; v_n integer;
BEGIN
  FOR r IN
    SELECT x.id, x.event_id, x.attempts FROM public.emergency_event_recipients x
     WHERE x.status = 'sending' AND x.lease_until < now()
       AND (p_event_id IS NULL OR x.event_id = p_event_id)
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.emergency_delivery_attempts a SET finished_at = now(), outcome = 'lease_expired'
     WHERE a.recipient_id = r.id AND a.attempt_no = r.attempts AND a.outcome IS NULL;
    UPDATE public.emergency_event_recipients x
       SET status = CASE WHEN r.attempts >= 3 THEN 'failed' ELSE 'retry_wait' END,
           failed_at = CASE WHEN r.attempts >= 3 THEN now() END,
           last_error = 'lease_expired', lease_until = NULL, next_attempt_at = now(), updated_at = now()
     WHERE x.id = r.id;
    PERFORM public.emergency_event_refresh(r.event_id);
  END LOOP;

  FOR r IN
    SELECT x.id, x.event_id, x.phone_e164, e.initiator, e.user_id, e.created_at
      FROM public.emergency_event_recipients x
      JOIN public.emergency_events e ON e.id = x.event_id
     WHERE x.status IN ('queued', 'retry_wait') AND x.next_attempt_at <= now() AND x.attempts < 3
       AND x.phone_e164 IS NOT NULL AND e.cancelled_at IS NULL
       AND (p_event_id IS NULL OR x.event_id = p_event_id)
     ORDER BY x.next_attempt_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
     FOR UPDATE OF x SKIP LOCKED
  LOOP
    UPDATE public.emergency_event_recipients x
       SET status = 'sending', attempts = x.attempts + 1, lease_until = now() + interval '90 seconds', updated_at = now()
     WHERE x.id = r.id
    RETURNING x.attempts INTO v_n;
    INSERT INTO public.emergency_delivery_attempts (recipient_id, attempt_no) VALUES (r.id, v_n);
    PERFORM public.emergency_event_refresh(r.event_id);
    recipient_id := r.id; attempt_no := v_n; event_id := r.event_id; initiator := r.initiator;
    phone_e164 := r.phone_e164; owner_name := public.emergency_owner_name(r.user_id); event_created_at := r.created_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Records one provider call. p_outcome: accepted (the provider took it),
-- rejected (refused for good: bad number, opted out), transient (5xx, 429,
-- network), timeout (no answer: it may or may not have gone), not_configured.
-- Only the holder of the current attempt number can record it.
CREATE OR REPLACE FUNCTION public.emergency_attempt_finish(p_recipient_id uuid, p_attempt_no integer, p_outcome text,
                                                           p_provider text, p_provider_message_id text, p_provider_status text,
                                                           p_http_status integer, p_error_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.emergency_event_recipients; v_status text; v_user uuid;
BEGIN
  IF p_outcome NOT IN ('accepted', 'rejected', 'transient', 'timeout', 'not_configured') THEN
    RAISE EXCEPTION 'emergency:invalid_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.emergency_event_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND OR v_r.status <> 'sending' OR v_r.attempts <> p_attempt_no THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_attempt');
  END IF;

  v_status := CASE p_outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'rejected' THEN 'failed'
    WHEN 'not_configured' THEN 'not_sent'
    ELSE CASE WHEN v_r.attempts >= 3 THEN 'failed' ELSE 'retry_wait' END
  END;

  UPDATE public.emergency_delivery_attempts
     SET finished_at = now(), outcome = p_outcome, provider = p_provider,
         provider_message_id = left(p_provider_message_id, 128), http_status = p_http_status,
         error_code = left(p_error_code, 64)
   WHERE recipient_id = p_recipient_id AND attempt_no = p_attempt_no AND outcome IS NULL;

  UPDATE public.emergency_event_recipients
     SET status = v_status, lease_until = NULL,
         provider = COALESCE(p_provider, provider),
         provider_message_id = COALESCE(left(p_provider_message_id, 128), provider_message_id),
         provider_status = COALESCE(left(p_provider_status, 32), provider_status),
         last_error = CASE WHEN p_outcome = 'accepted' THEN NULL ELSE left(COALESCE(p_error_code, p_outcome), 64) END,
         accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
         failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
         next_attempt_at = CASE WHEN v_status = 'retry_wait'
                                THEN now() + CASE WHEN v_r.attempts = 1 THEN interval '30 seconds' ELSE interval '2 minutes' END
                                ELSE next_attempt_at END,
         updated_at = now()
   WHERE id = p_recipient_id;

  SELECT user_id INTO v_user FROM public.emergency_events WHERE id = v_r.event_id;
  PERFORM public.emergency_log(v_user, v_r.event_id, 'system', 'delivery.attempt',
    jsonb_build_object('recipientId', p_recipient_id, 'attemptNo', p_attempt_no, 'outcome', p_outcome,
                       'provider', p_provider, 'httpStatus', p_http_status, 'errorCode', left(p_error_code, 64)));
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'eventStatus', public.emergency_event_refresh(v_r.event_id));
END;
$$;

-- A provider delivery receipt. Moves an accepted message to delivered or
-- undelivered; never moves a message backwards.
CREATE OR REPLACE FUNCTION public.emergency_provider_status(p_provider text, p_provider_message_id text, p_status text, p_error_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.emergency_event_recipients; v_new text; v_user uuid;
BEGIN
  SELECT * INTO v_r FROM public.emergency_event_recipients
   WHERE provider = p_provider AND provider_message_id = p_provider_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false); END IF;

  v_new := CASE WHEN lower(p_status) IN ('delivered', 'read') THEN 'delivered'
                WHEN lower(p_status) IN ('undelivered', 'failed') THEN 'undelivered' END;
  IF v_new IS NOT NULL AND v_r.status = 'accepted' THEN
    UPDATE public.emergency_event_recipients
       SET status = v_new, provider_status = left(lower(p_status), 32),
           delivered_at = CASE WHEN v_new = 'delivered' THEN now() END,
           failed_at = CASE WHEN v_new = 'undelivered' THEN now() ELSE failed_at END,
           last_error = CASE WHEN v_new = 'undelivered' THEN left(COALESCE(p_error_code, 'undelivered'), 64) END,
           updated_at = now()
     WHERE id = v_r.id;
  ELSIF v_r.status = 'accepted' THEN
    UPDATE public.emergency_event_recipients SET provider_status = left(lower(p_status), 32), updated_at = now()
     WHERE id = v_r.id;
  END IF;

  SELECT user_id INTO v_user FROM public.emergency_events WHERE id = v_r.event_id;
  PERFORM public.emergency_log(v_user, v_r.event_id, 'provider', 'delivery.receipt',
    jsonb_build_object('recipientId', v_r.id, 'providerStatus', left(lower(p_status), 32),
                       'applied', v_new IS NOT NULL AND v_r.status = 'accepted', 'errorCode', left(p_error_code, 64)));
  RETURN jsonb_build_object('matched', true, 'eventStatus', public.emergency_event_refresh(v_r.event_id));
END;
$$;

-- The owner retries recipients that could not be sent because no provider was
-- configured. Requeued only if attempts remain; the attempt limit still holds.
CREATE OR REPLACE FUNCTION public.emergency_requeue_not_sent(p_user uuid, p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.emergency_event_recipients
     SET status = 'queued', next_attempt_at = now(), updated_at = now()
   WHERE event_id = p_event_id AND status = 'not_sent' AND attempts < 3 AND phone_e164 IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.retry', jsonb_build_object('requeued', v_n));
    PERFORM public.emergency_event_refresh(p_event_id);
  END IF;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_event_detail(p_user uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'initiator', e.initiator, 'status', e.status,
    'createdAt', e.created_at, 'updatedAt', e.updated_at, 'completedAt', e.completed_at,
    'cancelledAt', e.cancelled_at, 'reportedAt', e.reported_at,
    'recipients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.contact_name, 'phone', '••••• ' || r.phone_last4, 'channel', r.channel,
               'status', r.status, 'attempts', r.attempts, 'provider', r.provider,
               'acceptedAt', r.accepted_at, 'deliveredAt', r.delivered_at, 'failedAt', r.failed_at,
               'nextAttemptAt', CASE WHEN r.status = 'retry_wait' THEN r.next_attempt_at END,
               'lastError', r.last_error) ORDER BY r.contact_name)
        FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb))
  FROM public.emergency_events e
  WHERE e.id = p_event_id AND e.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.emergency_events_for(p_user uuid, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT e.created_at, jsonb_build_object(
      'id', e.id, 'initiator', e.initiator, 'status', e.status,
      'createdAt', e.created_at, 'completedAt', e.completed_at, 'cancelledAt', e.cancelled_at,
      'reportedAt', e.reported_at,
      'counts', (SELECT jsonb_build_object(
                   'total', count(*),
                   'delivered', count(*) FILTER (WHERE r.status = 'delivered'),
                   'accepted', count(*) FILTER (WHERE r.status = 'accepted'),
                   'pending', count(*) FILTER (WHERE r.status IN ('queued', 'sending', 'retry_wait')),
                   'failed', count(*) FILTER (WHERE r.status IN ('failed', 'undelivered')),
                   'notSent', count(*) FILTER (WHERE r.status = 'not_sent'),
                   'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'))
                 FROM public.emergency_event_recipients r WHERE r.event_id = e.id)) AS j
    FROM public.emergency_events e
    WHERE e.user_id = p_user
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ) x;
$$;

-- Stops recipients that have not been sent yet. A message already accepted by
-- the provider cannot be recalled; one being sent right now finishes.
CREATE OR REPLACE FUNCTION public.emergency_cancel(p_user uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_e public.emergency_events; v_n integer;
BEGIN
  SELECT * INTO v_e FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.emergency_event_recipients
                  WHERE event_id = p_event_id AND status IN ('queued', 'retry_wait', 'not_sent', 'sending')) THEN
    RAISE EXCEPTION 'emergency:already_complete' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.emergency_event_recipients SET status = 'cancelled', updated_at = now()
   WHERE event_id = p_event_id AND status IN ('queued', 'retry_wait', 'not_sent');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.emergency_events SET cancelled_at = now(), updated_at = now() WHERE id = p_event_id;
  PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.cancelled', jsonb_build_object('stopped', v_n));
  PERFORM public.emergency_event_refresh(p_event_id);
  RETURN public.emergency_event_detail(p_user, p_event_id) || jsonb_build_object('stopped', v_n);
END;
$$;

-- The owner says an alert was unwanted or abusive. A reported visitor alert
-- switches visitor alerts off; the SHYGON team is told.
CREATE OR REPLACE FUNCTION public.emergency_report(p_user uuid, p_event_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_e public.emergency_events; v_off boolean := false;
BEGIN
  SELECT * INTO v_e FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_e.reported_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_reported' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.emergency_events
     SET reported_at = now(), report_reason = left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300), updated_at = now()
   WHERE id = p_event_id;
  IF v_e.initiator = 'public' THEN
    UPDATE public.emergency_settings
       SET public_alerts_enabled = false, public_alerts_changed_at = now(), updated_at = now()
     WHERE user_id = p_user AND public_alerts_enabled;
    v_off := FOUND;
  END IF;
  PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.reported',
    jsonb_build_object('initiator', v_e.initiator, 'publicAlertsDisabled', v_off));
  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('security', 'warning', 'Emergency alert reported',
          'A customer reported an emergency alert as unwanted. Investigate with admin_list_emergency_events.',
          NULL, jsonb_build_object('emergencyEventId', p_event_id, 'initiator', v_e.initiator));
  RETURN jsonb_build_object('reported', true, 'publicAlertsDisabled', v_off);
END;
$$;

-- Retention (run by the dispatcher sweep). Returns what it removed.
CREATE OR REPLACE FUNCTION public.emergency_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_scrubbed int; v_events int; v_codes int; v_audit int;
BEGIN
  UPDATE public.emergency_event_recipients r SET phone_e164 = NULL, updated_at = now()
    FROM public.emergency_events e
   WHERE e.id = r.event_id AND r.phone_e164 IS NOT NULL
     AND r.status NOT IN ('queued', 'sending', 'retry_wait')
     AND (e.completed_at < now() - interval '7 days' OR e.created_at < now() - interval '30 days');
  GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
  DELETE FROM public.emergency_events WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_events = ROW_COUNT;
  DELETE FROM public.emergency_contact_challenges WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_codes = ROW_COUNT;
  DELETE FROM public.emergency_audit WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  RETURN jsonb_build_object('numbersErased', v_scrubbed, 'eventsDeleted', v_events,
                            'codesDeleted', v_codes, 'auditDeleted', v_audit);
END;
$$;

-- ---------------------------------------------------------------------------
-- Administration: investigate failed or reported alerts. No contact names and
-- no numbers beyond the last four digits. Every read is in admin_audit_log.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_emergency_events(p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid := public.require_admin('support.read'); v_out jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT e.created_at, jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'initiator', e.initiator, 'status', e.status,
      'createdAt', e.created_at, 'completedAt', e.completed_at, 'cancelledAt', e.cancelled_at,
      'reportedAt', e.reported_at, 'reportReason', e.report_reason,
      'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'id', r.id, 'last4', r.phone_last4, 'status', r.status, 'attempts', r.attempts,
                       'provider', r.provider, 'providerMessageId', r.provider_message_id,
                       'providerStatus', r.provider_status, 'lastError', r.last_error,
                       'attemptLog', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                        'attemptNo', a.attempt_no, 'startedAt', a.started_at, 'finishedAt', a.finished_at,
                                        'outcome', a.outcome, 'httpStatus', a.http_status, 'errorCode', a.error_code)
                                        ORDER BY a.attempt_no), '[]'::jsonb)
                                      FROM public.emergency_delivery_attempts a WHERE a.recipient_id = r.id)))
                     FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb)) AS j
    FROM public.emergency_events e
    WHERE p_status IS NULL OR e.status = p_status OR (p_status = 'reported' AND e.reported_at IS NOT NULL)
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;
  PERFORM public.admin_audit(v_admin, 'emergency.events.read', 'emergency_event', NULL,
    jsonb_build_object('status', p_status, 'limit', p_limit, 'offset', p_offset));
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the server only, except the admin RPC (it checks the caller itself).
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.emergency_mask_phone(text)',
    'public.emergency_owner_name(uuid)',
    'public.emergency_log(uuid, uuid, text, text, jsonb)',
    'public.emergency_disable_public_if_unready(uuid, text)',
    'public.emergency_contacts_for(uuid)',
    'public.emergency_settings_for(uuid)',
    'public.emergency_contact_save(uuid, uuid, text, text, text)',
    'public.emergency_contact_remove(uuid, uuid)',
    'public.emergency_settings_set(uuid, boolean, boolean)',
    'public.emergency_verification_start(uuid, uuid, uuid, text)',
    'public.emergency_verification_abort(uuid, uuid)',
    'public.emergency_verification_confirm(uuid, uuid, text)',
    'public.emergency_public_target(text)',
    'public.emergency_event_refresh(uuid)',
    'public.emergency_alert_open(uuid, text, text, uuid, text)',
    'public.emergency_claim_due(uuid, integer)',
    'public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text)',
    'public.emergency_provider_status(text, text, text, text)',
    'public.emergency_requeue_not_sent(uuid, uuid)',
    'public.emergency_event_detail(uuid, uuid)',
    'public.emergency_events_for(uuid, integer)',
    'public.emergency_cancel(uuid, uuid)',
    'public.emergency_report(uuid, uuid, text)',
    'public.emergency_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_emergency_events(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_emergency_events(text, integer, integer) TO authenticated, service_role;


-- ###########################################################################
-- ## 030_guard_tap_server_columns.sql
-- ###########################################################################

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


-- ###########################################################################
-- ## 031_return_to_owner_relay.sql
-- ###########################################################################

-- 031: SHYGON AAROH Return-to-Owner relay (SHYGON Rescue, minimal): a finder
-- sends a protected message to a Tap's owner; the owner replies; neither side
-- sees the other's details unless they write them.
--
-- Decision:  the owner's AAROH master requirements of 2026-10-19 ("Real
--            Return-to-Owner relay: allow a finder to send a protected request
--            without automatically revealing the owner's private phone number")
--            and backend brief (protected relay, owner notification, replies,
--            abuse reports, blocking, rate limits, no duplicate submissions);
--            DEC-2026-038 Q12 (PROPOSED). Design: doc 03 §3.4 (rescue_threads,
--            rescue_messages), doc 05 §2 (finder endpoints and limits), doc 07
--            T6 (spam and harassment controls), doc 08 (lost mode).
--            APPROVED by the owner 2026-10-19 (DEC-2026-038 Q12, in session).
--            Approval of the design is not approval to apply: see Level.
-- Level:     L3 (new tables holding messages between strangers; privileged
--            functions). DEC-2026-018 24-hour cool-off plus checklist review
--            before approval or application. Never applied by tooling to
--            production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-030. Reads tap_profiles and profiles; inserts into
--            notifications (the owner's notice, never the message text) and
--            admin_notifications (a report).
-- Data:      none changed. New tables start empty.
--
-- SCOPE (what the requirement approves, and no more)
--   Built: owner opt-in (default OFF) per account; a finder on /t/<slug> starts
--   a thread with a first message and receives a secret finder token; follow-
--   ups and polling with that token; the owner lists, reads, replies, closes,
--   blocks and reports; retention.
--   NOT built (BLOCKED): item lifecycle (protected / lost / found / retired)
--   and device-bound rescue items need the card registry and the card status
--   vocabulary (DEC-2026-028, card release deferred by DEC-2026-035); a bot
--   check (no Turnstile key exists); text-message or push notice to the owner
--   (the account phone is unverified, F4; no provider configured).
--
-- RULES IT ENFORCES (supabase/tests/rescue.mjs)
--   - The finder never receives an owner field (no name beyond the public Tap,
--     no number, no email); the owner sees only what the finder writes.
--   - Messages: 1-500 characters; links are removed for both sides.
--   - Finder: 3 new threads per hour and 10 per day per finder digest (an HMAC
--     of the host-reported client address, never stored in clear); 5 new
--     threads per owner per day; 10 follow-ups per thread per hour; at most 3
--     finder messages in a row without an owner reply; 60 polls per thread per
--     hour; the token stops working 14 days after the thread's last activity.
--   - Duplicates: a thread is unique per (owner, idempotency key) and a message
--     per (thread, client key); a repeat returns the first and adds nothing.
--   - Block: the thread closes and that finder digest cannot open a thread to
--     this owner for 90 days. Report: the same, plus a notice to SHYGON.
--   - Retention: threads (with messages) deleted 90 days after they close; an
--     open thread idle for 30 days is closed; blocks expire after 90 days.
--     Deleting the account deletes all of it.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.rescue_threads');   -- NULL
--   SELECT count(*) FROM pg_proc WHERE proname LIKE 'rescue\_%' OR proname = 'admin_list_rescue_reports';  -- 0
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.admin_list_rescue_reports(integer, integer);
-- DROP FUNCTION IF EXISTS public.rescue_purge();
-- DROP FUNCTION IF EXISTS public.rescue_thread_moderate(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_owner_reply(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_thread_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.rescue_threads_for(uuid, integer);
-- DROP FUNCTION IF EXISTS public.rescue_finder_view(text);
-- DROP FUNCTION IF EXISTS public.rescue_finder_post(text, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_thread_open(uuid, uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_public_target(text);
-- DROP FUNCTION IF EXISTS public.rescue_settings_set(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.rescue_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.rescue_clean_text(text, integer);
-- DROP FUNCTION IF EXISTS public.rescue_log(uuid, uuid, text, text, jsonb);
-- DROP TABLE IF EXISTS public.rescue_audit;
-- DROP TABLE IF EXISTS public.rescue_blocks;
-- DROP TABLE IF EXISTS public.rescue_messages;
-- DROP TABLE IF EXISTS public.rescue_threads;
-- DROP TABLE IF EXISTS public.rescue_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.rescue_settings (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  public_hint text CHECK (public_hint IS NULL OR length(public_hint) <= 140),
  changed_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rescue_threads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_profile_id    uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  finder_token_hash text NOT NULL UNIQUE,
  finder_digest     text NOT NULL,
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'owner_replied', 'closed', 'blocked', 'spam')),
  finder_unanswered integer NOT NULL DEFAULT 0,
  owner_unread      integer NOT NULL DEFAULT 0,
  poll_window_start timestamptz,
  poll_count        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  reported_at       timestamptz,
  report_reason     text CHECK (report_reason IS NULL OR length(report_reason) <= 300),
  CONSTRAINT rescue_threads_idempotent UNIQUE (owner_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_rescue_threads_owner ON public.rescue_threads (owner_user_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_rescue_threads_finder ON public.rescue_threads (finder_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rescue_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES public.rescue_threads(id) ON DELETE CASCADE,
  sender     text NOT NULL CHECK (sender IN ('finder', 'owner', 'system')),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  client_key text CHECK (client_key IS NULL OR client_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rescue_messages_idempotent UNIQUE (thread_id, client_key)
);
CREATE INDEX IF NOT EXISTS idx_rescue_messages_thread ON public.rescue_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.rescue_blocks (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finder_digest text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, finder_digest)
);

CREATE TABLE IF NOT EXISTS public.rescue_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id  uuid REFERENCES public.rescue_threads(id) ON DELETE SET NULL,
  actor      text NOT NULL CHECK (actor IN ('owner', 'finder', 'system', 'admin')),
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rescue_audit_user ON public.rescue_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rescue_settings', 'rescue_threads', 'rescue_messages', 'rescue_blocks', 'rescue_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.rescue_audit FROM service_role;
END $$;

CREATE OR REPLACE FUNCTION public.rescue_log(p_user uuid, p_thread uuid, p_actor text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.rescue_audit (user_id, thread_id, actor, action, detail)
  VALUES (p_user, p_thread, p_actor, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- Trims, collapses control characters and removes links (a link never takes the
-- punctuation that ends a sentence). NULL if nothing is left.
CREATE OR REPLACE FUNCTION public.rescue_clean_text(p_text text, p_max integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT NULLIF(left(btrim(regexp_replace(
           regexp_replace(COALESCE(p_text, ''), '[[:cntrl:]]+', ' ', 'g'),
           '(https?://|www\.)[^[:space:]]*[^[:space:].,;:!?)]|(?<![@[:alnum:]._-])[[:alnum:]-]+(\.[[:alnum:]-]+)*\.(com|in|net|org|io|co|me|app|link|xyz|info|biz|ly|gl|to)\M(/[^[:space:]]*[^[:space:].,;:!?)])?',
           '[link removed]', 'gi')), p_max), '');
$$;

CREATE OR REPLACE FUNCTION public.rescue_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE(s.enabled, false),
    'publicHint', s.public_hint,
    'changedAt', s.changed_at,
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t
                                   WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL),
    'openThreads', (SELECT count(*) FROM public.rescue_threads r
                     WHERE r.owner_user_id = x.id AND r.status IN ('open', 'owner_replied')),
    'unread', (SELECT COALESCE(sum(r.owner_unread), 0) FROM public.rescue_threads r WHERE r.owner_user_id = x.id))
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.rescue_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.rescue_settings_set(p_user uuid, p_enabled boolean, p_public_hint text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_hint text := public.rescue_clean_text(p_public_hint, 140);
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'rescue:invalid_setting' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.rescue_settings AS s (user_id, enabled, public_hint, changed_at, updated_at)
  VALUES (p_user, p_enabled, v_hint, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, public_hint = EXCLUDED.public_hint,
        changed_at = CASE WHEN s.enabled IS DISTINCT FROM EXCLUDED.enabled THEN now() ELSE s.changed_at END,
        updated_at = now();
  PERFORM public.rescue_log(p_user, NULL, 'owner', CASE WHEN p_enabled THEN 'settings.enabled' ELSE 'settings.disabled' END, '{}'::jsonb);
  RETURN public.rescue_settings_for(p_user);
END;
$$;

-- Whether a finder on /t/<slug> may write to the owner. NULL in every other
-- case (unknown, unpublished, paused or suspended Tap, suspended account,
-- relay off): the caller cannot tell them apart.
CREATE OR REPLACE FUNCTION public.rescue_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id, 'publicHint', s.public_hint)
    FROM public.tap_profiles t
    JOIN public.rescue_settings s ON s.user_id = t.user_id AND s.enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL AND p.suspended_at IS NULL
   LIMIT 1;
$$;

-- A finder's first message. p_token_hash is the SHA-256 of the finder token the
-- server derived; the token itself is never stored. Returns {ok, threadId,
-- replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.rescue_thread_open(p_user uuid, p_tap_profile_id uuid, p_idempotency_key text,
                                                     p_finder_digest text, p_token_hash text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_body text := public.rescue_clean_text(p_body, 500);
  v_thread public.rescue_threads;
  v_code text;
  v_wait integer;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rescue:' || p_user::text, 0));

  SELECT * INTO v_thread FROM public.rescue_threads WHERE owner_user_id = p_user AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'threadId', v_thread.id, 'replayed', true); END IF;

  IF v_body IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_message'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tap_profiles t
                   JOIN public.rescue_settings s ON s.user_id = t.user_id AND s.enabled
                   LEFT JOIN public.profiles p ON p.id = t.user_id
                  WHERE t.id = p_tap_profile_id AND t.user_id = p_user AND t.status = 'active'
                    AND t.published IS TRUE AND t.suspended_at IS NULL AND p.suspended_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.rescue_blocks b
                 WHERE b.owner_user_id = p_user AND b.finder_digest = p_finder_digest AND b.expires_at > now()) THEN
    v_code := 'unavailable';
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '1 hour') >= 3 THEN
    v_code := 'rate_limited';
    SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now())))::int INTO v_wait
      FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '1 hour';
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '24 hours') >= 10 THEN
    v_code := 'rate_limited'; v_wait := 86400;
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE owner_user_id = p_user AND created_at > now() - interval '24 hours') >= 5 THEN
    v_code := 'rate_limited'; v_wait := 86400;
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.rescue_log(p_user, NULL, 'finder', 'thread.refused', jsonb_build_object('code', v_code));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1));
  END IF;

  INSERT INTO public.rescue_threads (owner_user_id, tap_profile_id, finder_token_hash, finder_digest, idempotency_key,
                                     finder_unanswered, owner_unread)
  VALUES (p_user, p_tap_profile_id, p_token_hash, p_finder_digest, p_idempotency_key, 1, 1)
  RETURNING * INTO v_thread;
  INSERT INTO public.rescue_messages (thread_id, sender, body) VALUES (v_thread.id, 'finder', v_body);
  PERFORM public.rescue_log(p_user, v_thread.id, 'finder', 'thread.opened', '{}'::jsonb);

  -- Never the message text in a notification (doc 07 T6).
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (p_user, 'rescue', 'Someone sent you a message through SHYGON',
          'A person who found your card or opened your profile wrote to you. Your number was not shared. Read and reply in your account.',
          '/shygontap/return-to-owner', jsonb_build_object('rescueThreadId', v_thread.id));

  RETURN jsonb_build_object('ok', true, 'threadId', v_thread.id, 'replayed', false);
END;
$$;

-- A finder's follow-up. Returns {ok} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.rescue_finder_post(p_token_hash text, p_body text, p_client_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads; v_body text := public.rescue_clean_text(p_body, 500); v_n integer;
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE finder_token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_t.status IN ('blocked', 'spam') THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_not_found'); END IF;
  IF v_t.last_activity_at < now() - interval '14 days' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_expired'); END IF;
  IF v_t.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_closed'); END IF;
  IF p_client_key IS NULL OR p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key'); END IF;
  IF EXISTS (SELECT 1 FROM public.rescue_messages WHERE thread_id = v_t.id AND client_key = p_client_key) THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true);
  END IF;
  IF v_body IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_message'); END IF;
  IF v_t.finder_unanswered >= 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'awaiting_owner'); END IF;
  SELECT count(*) INTO v_n FROM public.rescue_messages
   WHERE thread_id = v_t.id AND sender = 'finder' AND created_at > now() - interval '1 hour';
  IF v_n >= 10 THEN RETURN jsonb_build_object('ok', false, 'code', 'rate_limited', 'retryAfter', 3600); END IF;

  INSERT INTO public.rescue_messages (thread_id, sender, body, client_key) VALUES (v_t.id, 'finder', v_body, p_client_key);
  UPDATE public.rescue_threads
     SET finder_unanswered = finder_unanswered + 1, owner_unread = owner_unread + 1, last_activity_at = now()
   WHERE id = v_t.id;
  PERFORM public.rescue_log(v_t.owner_user_id, v_t.id, 'finder', 'message.sent', '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'replayed', false);
END;
$$;

-- What the finder sees: the thread's status and messages, nothing about the owner.
CREATE OR REPLACE FUNCTION public.rescue_finder_view(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE finder_token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_t.status IN ('blocked', 'spam') THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_not_found'); END IF;
  IF v_t.last_activity_at < now() - interval '14 days' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_expired'); END IF;
  IF v_t.poll_window_start IS NULL OR v_t.poll_window_start < now() - interval '1 hour' THEN
    UPDATE public.rescue_threads SET poll_window_start = now(), poll_count = 1 WHERE id = v_t.id;
  ELSIF v_t.poll_count >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
      'retryAfter', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_t.poll_window_start + interval '1 hour' - now())))::int));
  ELSE
    UPDATE public.rescue_threads SET poll_count = poll_count + 1 WHERE id = v_t.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'thread', jsonb_build_object(
    'status', v_t.status,
    'canWrite', v_t.status IN ('open', 'owner_replied') AND v_t.finder_unanswered < 3,
    'expiresAt', v_t.last_activity_at + interval '14 days',
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
                                           ORDER BY m.created_at), '[]'::jsonb)
                   FROM public.rescue_messages m WHERE m.thread_id = v_t.id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_threads_for(p_user uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb)
  FROM (
    SELECT r.last_activity_at AS at, jsonb_build_object(
      'id', r.id, 'status', r.status, 'createdAt', r.created_at, 'lastActivityAt', r.last_activity_at,
      'closedAt', r.closed_at, 'reportedAt', r.reported_at, 'unread', r.owner_unread,
      'messages', (SELECT count(*) FROM public.rescue_messages m WHERE m.thread_id = r.id),
      'preview', (SELECT left(m.body, 80) FROM public.rescue_messages m WHERE m.thread_id = r.id AND m.sender = 'finder'
                   ORDER BY m.created_at DESC LIMIT 1)) AS j
    FROM public.rescue_threads r
    WHERE r.owner_user_id = p_user
    ORDER BY r.last_activity_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  ) x;
$$;

-- The owner opens a thread: its messages, and the unread count goes to zero.
CREATE OR REPLACE FUNCTION public.rescue_thread_detail(p_user uuid, p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  UPDATE public.rescue_threads SET owner_unread = 0 WHERE id = p_thread_id AND owner_user_id = p_user RETURNING * INTO v_t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_t.id, 'status', v_t.status, 'createdAt', v_t.created_at, 'lastActivityAt', v_t.last_activity_at,
    'closedAt', v_t.closed_at, 'reportedAt', v_t.reported_at,
    'finderCanWrite', v_t.status IN ('open', 'owner_replied') AND v_t.finder_unanswered < 3,
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.sender, 'body', m.body, 'at', m.created_at)
                                           ORDER BY m.created_at), '[]'::jsonb)
                   FROM public.rescue_messages m WHERE m.thread_id = v_t.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_owner_reply(p_user uuid, p_thread_id uuid, p_body text, p_client_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads; v_body text := public.rescue_clean_text(p_body, 500);
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE id = p_thread_id AND owner_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rescue:thread_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_client_key IS NULL OR p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RAISE EXCEPTION 'rescue:invalid_idempotency_key' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.rescue_messages WHERE thread_id = v_t.id AND client_key = p_client_key) THEN
    RETURN public.rescue_thread_detail(p_user, p_thread_id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_t.status NOT IN ('open', 'owner_replied') THEN RAISE EXCEPTION 'rescue:thread_closed' USING ERRCODE = 'P0001'; END IF;
  IF v_body IS NULL THEN RAISE EXCEPTION 'rescue:invalid_message' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.rescue_messages (thread_id, sender, body, client_key) VALUES (v_t.id, 'owner', v_body, p_client_key);
  UPDATE public.rescue_threads SET status = 'owner_replied', finder_unanswered = 0, last_activity_at = now() WHERE id = v_t.id;
  PERFORM public.rescue_log(p_user, v_t.id, 'owner', 'message.sent', '{}'::jsonb);
  RETURN public.rescue_thread_detail(p_user, p_thread_id) || jsonb_build_object('replayed', false);
END;
$$;

-- close · block (closes, and refuses that finder for 90 days) · report (block,
-- marked spam, SHYGON told).
CREATE OR REPLACE FUNCTION public.rescue_thread_moderate(p_user uuid, p_thread_id uuid, p_action text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  IF p_action NOT IN ('close', 'block', 'report') THEN RAISE EXCEPTION 'rescue:invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_t FROM public.rescue_threads WHERE id = p_thread_id AND owner_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rescue:thread_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'close' THEN
    IF v_t.status NOT IN ('open', 'owner_replied') THEN RAISE EXCEPTION 'rescue:thread_closed' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.rescue_threads SET status = 'closed', closed_at = now(), owner_unread = 0 WHERE id = v_t.id;
  ELSE
    IF v_t.status IN ('blocked', 'spam') THEN RAISE EXCEPTION 'rescue:already_blocked' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.rescue_threads
       SET status = CASE WHEN p_action = 'report' THEN 'spam' ELSE 'blocked' END,
           closed_at = COALESCE(closed_at, now()), owner_unread = 0,
           reported_at = CASE WHEN p_action = 'report' THEN now() END,
           report_reason = CASE WHEN p_action = 'report' THEN left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300) END
     WHERE id = v_t.id;
    INSERT INTO public.rescue_blocks (owner_user_id, finder_digest, expires_at)
    VALUES (p_user, v_t.finder_digest, now() + interval '90 days')
    ON CONFLICT (owner_user_id, finder_digest) DO UPDATE SET expires_at = EXCLUDED.expires_at;
    IF p_action = 'report' THEN
      INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
      VALUES ('security', 'warning', 'Return-to-owner message reported',
              'A customer reported a finder message as abusive. Review it with admin_list_rescue_reports.',
              NULL, jsonb_build_object('rescueThreadId', v_t.id));
    END IF;
  END IF;
  PERFORM public.rescue_log(p_user, v_t.id, 'owner', 'thread.' || p_action, '{}'::jsonb);
  RETURN public.rescue_thread_detail(p_user, p_thread_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_closed int; v_deleted int; v_blocks int; v_audit int;
BEGIN
  UPDATE public.rescue_threads SET status = 'closed', closed_at = now()
   WHERE status IN ('open', 'owner_replied') AND last_activity_at < now() - interval '30 days';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  DELETE FROM public.rescue_threads WHERE closed_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.rescue_blocks WHERE expires_at < now();
  GET DIAGNOSTICS v_blocks = ROW_COUNT;
  DELETE FROM public.rescue_audit WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  RETURN jsonb_build_object('threadsClosed', v_closed, 'threadsDeleted', v_deleted, 'blocksExpired', v_blocks, 'auditDeleted', v_audit);
END;
$$;

-- Moderation: reported threads only, with their messages (the reason SHYGON was
-- told). Every read is in admin_audit_log.
CREATE OR REPLACE FUNCTION public.admin_list_rescue_reports(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid := public.require_admin('support.read'); v_out jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT r.reported_at AS at, jsonb_build_object(
      'id', r.id, 'ownerUserId', r.owner_user_id, 'reportedAt', r.reported_at, 'reportReason', r.report_reason,
      'createdAt', r.created_at,
      'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
                                             ORDER BY m.created_at), '[]'::jsonb)
                     FROM public.rescue_messages m WHERE m.thread_id = r.id)) AS j
    FROM public.rescue_threads r
    WHERE r.reported_at IS NOT NULL
    ORDER BY r.reported_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;
  PERFORM public.admin_audit(v_admin, 'rescue.reports.read', 'rescue_thread', NULL, jsonb_build_object('limit', p_limit, 'offset', p_offset));
  RETURN v_out;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.rescue_log(uuid, uuid, text, text, jsonb)',
    'public.rescue_clean_text(text, integer)',
    'public.rescue_settings_for(uuid)',
    'public.rescue_settings_set(uuid, boolean, text)',
    'public.rescue_public_target(text)',
    'public.rescue_thread_open(uuid, uuid, text, text, text, text)',
    'public.rescue_finder_post(text, text, text)',
    'public.rescue_finder_view(text)',
    'public.rescue_threads_for(uuid, integer)',
    'public.rescue_thread_detail(uuid, uuid)',
    'public.rescue_owner_reply(uuid, uuid, text, text)',
    'public.rescue_thread_moderate(uuid, uuid, text, text)',
    'public.rescue_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_rescue_reports(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_rescue_reports(integer, integer) TO authenticated, service_role;


-- ###########################################################################
-- ## 032_consent_ledger_and_connect.sql
-- ###########################################################################

-- 032: SHYGON Connect between two SHYGON accounts, on a consent ledger:
-- requests, decisions (accept / decline / block), sharing and revocation.
--
-- Decision:  DEC-2026-038 Q13 = A, approved 2026-10-19 ("next stage = the
--            consent ledger plus Connect requests, decisions and revocations");
--            the owner's master requirement 7 ("record requests, decisions and
--            revocations"). Design: doc 03 §3.4 (connections, consent_grants),
--            doc 04 §4.1-4.2 (a connection is an audience; consent is data;
--            revocation is immediate for future reads; already-copied data
--            cannot be un-shared). The policy choices this file makes where the
--            docs are silent are DEC-2026-039 Q1-Q7, APPROVED by the owner
--            2026-10-20 (in session). Approval of the design is not approval
--            to apply: see Level.
-- Level:     L3 (new tables holding who-knows-whom and shared personal data;
--            privileged functions). DEC-2026-018 cool-off plus checklist review
--            before approval or application. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-031 (it reuses 031's rescue_clean_text for the note). Reads
--            profiles and tap_profiles; inserts notifications.
-- Data:      none changed. New tables start empty.
--
-- MODEL
--   connect_settings  per account: whether others may send it requests (OFF
--                     by default).
--   connections       one row per request between two accounts: requested ->
--                     accepted | declined | blocked | expired, accepted ->
--                     removed. At most one open (requested or accepted)
--                     connection per pair, in either direction.
--   consent_grants    the ledger. A row says: grantor lets grantee read these
--                     fields of the grantor's account profile, for this
--                     purpose, from granted_at until revoked_at. Rows are never
--                     edited except to revoke; a change of what is shared is a
--                     revocation plus a new row (version + 1). The effective
--                     consent is the un-revoked row.
--   connect_audit     every request, decision, share change and revocation.
--
-- RULES (supabase/tests/connect.mjs)
--   - Shareable fields: phone, email, company, job_title from the grantor's
--     own account profile, read LIVE while the grant is active (so a revocation
--     stops future reads). They are self-reported: nothing here verifies them.
--     The name shown is the account's full name (or Tap name), as the identity
--     of the request.
--   - A request: signed-in requester, a published, unsuspended Tap whose owner
--     switched Connect on; not to oneself; neither side suspended; not blocked
--     by the target; not within 30 days of a decline by the target; 5 requests
--     per hour and 20 per day per requester; 50 open incoming per target; an
--     optional note (<= 200 characters, links removed). The requester's grant
--     starts with the request, so the target can see who is asking.
--   - Decline revokes the requester's grant; block also refuses that requester
--     for good (until the target removes the block by connecting later); remove
--     (either side) revokes every grant both ways. Requests not decided within
--     30 days expire, and their grants are revoked.
--   - Only the two parties see a connection; nobody else, including the
--     target's other connections.
--   - Retention: connections that ended (declined, expired, removed) are
--     deleted 180 days after they ended, with their grants; the account
--     cascade deletes everything of an account.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.consent_grants'), to_regclass('public.connections');   -- both NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.connect_purge();
-- DROP FUNCTION IF EXISTS public.connect_consents_for(uuid);
-- DROP FUNCTION IF EXISTS public.connect_list(uuid, text);
-- DROP FUNCTION IF EXISTS public.connect_remove(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.connect_share(uuid, uuid, text[]);
-- DROP FUNCTION IF EXISTS public.connect_decide(uuid, uuid, text, text[]);
-- DROP FUNCTION IF EXISTS public.connect_request(uuid, text, text[], text, text);
-- DROP FUNCTION IF EXISTS public.connect_public_target(text);
-- DROP FUNCTION IF EXISTS public.connect_settings_set(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.connect_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.connect_grant(uuid, uuid, uuid, text[]);
-- DROP FUNCTION IF EXISTS public.connect_revoke_grants(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.connect_party(uuid);
-- DROP FUNCTION IF EXISTS public.connect_fields(text[]);
-- DROP FUNCTION IF EXISTS public.connect_log(uuid, uuid, text, jsonb);
-- DROP TRIGGER IF EXISTS trg_consent_grants_append_only ON public.consent_grants;
-- DROP FUNCTION IF EXISTS public.consent_grants_append_only();
-- DROP TABLE IF EXISTS public.connect_audit;
-- DROP TABLE IF EXISTS public.consent_grants;
-- DROP TABLE IF EXISTS public.connections;
-- DROP TABLE IF EXISTS public.connect_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.connect_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_tap_profile_id uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'accepted', 'declined', 'blocked', 'expired', 'removed')),
  note                  text CHECK (note IS NULL OR length(note) <= 200),
  idempotency_key       text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  ended_at              timestamptz,
  ended_by              uuid,
  CONSTRAINT connections_not_self CHECK (requester_user_id <> target_user_id),
  CONSTRAINT connections_idempotent UNIQUE (requester_user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_open_per_pair
  ON public.connections (LEAST(requester_user_id, target_user_id), GREATEST(requester_user_id, target_user_id))
  WHERE status IN ('requested', 'accepted');
CREATE INDEX IF NOT EXISTS idx_connections_requester ON public.connections (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connections_target ON public.connections (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.consent_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_kind    text NOT NULL DEFAULT 'user' CHECK (grantee_kind IN ('user')),
  grantee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_kind   text NOT NULL DEFAULT 'profile_fields' CHECK (resource_kind IN ('profile_fields')),
  scope           text[] NOT NULL CHECK (scope <@ ARRAY['phone', 'email', 'company', 'job_title']::text[]),
  purpose         text NOT NULL DEFAULT 'connect' CHECK (purpose IN ('connect')),
  connection_id   uuid NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  version         integer NOT NULL DEFAULT 1,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoke_reason   text CHECK (revoke_reason IS NULL OR revoke_reason IN
                    ('changed', 'declined', 'blocked', 'removed', 'expired')),
  CONSTRAINT consent_grants_version UNIQUE (connection_id, grantor_user_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_grants_one_active
  ON public.consent_grants (connection_id, grantor_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_grants_grantee ON public.consent_grants (grantee_user_id) WHERE revoked_at IS NULL;

-- The ledger is append-only: a row can only be revoked, once, and nothing else
-- about it can change (also for the server role; only deletion by retention or
-- the account cascade removes rows).
CREATE OR REPLACE FUNCTION public.consent_grants_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL
     OR (NEW.id, NEW.grantor_user_id, NEW.grantee_kind, NEW.grantee_user_id, NEW.resource_kind, NEW.scope,
         NEW.purpose, NEW.connection_id, NEW.version, NEW.granted_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.id, OLD.grantor_user_id, OLD.grantee_kind, OLD.grantee_user_id, OLD.resource_kind, OLD.scope,
         OLD.purpose, OLD.connection_id, OLD.version, OLD.granted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'consent_grants rows are append-only: only an un-revoked row may be revoked, once'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.consent_grants_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consent_grants_append_only() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consent_grants_append_only() TO service_role;
DROP TRIGGER IF EXISTS trg_consent_grants_append_only ON public.consent_grants;
CREATE TRIGGER trg_consent_grants_append_only
  BEFORE UPDATE ON public.consent_grants
  FOR EACH ROW EXECUTE FUNCTION public.consent_grants_append_only();

CREATE TABLE IF NOT EXISTS public.connect_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.connections(id) ON DELETE SET NULL,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_audit_user ON public.connect_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connect_settings', 'connections', 'consent_grants', 'connect_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.connect_audit FROM service_role;
  REVOKE DELETE, TRUNCATE ON public.consent_grants FROM service_role;
END $$;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.connect_log(p_user uuid, p_connection uuid, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.connect_audit (user_id, connection_id, action, detail)
  VALUES (p_user, p_connection, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- A requested field list, validated and de-duplicated; NULL if any is unknown.
CREATE OR REPLACE FUNCTION public.connect_fields(p_fields text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE WHEN COALESCE(p_fields, '{}') <@ ARRAY['phone', 'email', 'company', 'job_title']::text[]
              THEN ARRAY(SELECT DISTINCT f FROM unnest(COALESCE(p_fields, '{}')) AS f ORDER BY f)
         END;
$$;

-- How a party appears to the other: a name and, if published, their Tap address.
CREATE OR REPLACE FUNCTION public.connect_party(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'name', COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(t.display_name), ''), 'A SHYGON member'),
    'tapSlug', CASE WHEN t.status = 'active' AND t.suspended_at IS NULL THEN t.slug END)
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.profiles p ON p.id = x.id
  LEFT JOIN public.tap_profiles t ON t.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.connect_revoke_grants(p_connection uuid, p_grantor uuid, p_by uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.consent_grants
     SET revoked_at = now(), revoked_by = p_by, revoke_reason = p_reason
   WHERE connection_id = p_connection AND revoked_at IS NULL
     AND (p_grantor IS NULL OR grantor_user_id = p_grantor);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Replaces the grantor's current grant on a connection (append-only: revoke, then insert version + 1).
CREATE OR REPLACE FUNCTION public.connect_grant(p_connection uuid, p_grantor uuid, p_grantee uuid, p_scope text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_version integer;
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.consent_grants
   WHERE connection_id = p_connection AND grantor_user_id = p_grantor;
  PERFORM public.connect_revoke_grants(p_connection, p_grantor, p_grantor, 'changed');
  INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id, version)
  VALUES (p_grantor, p_grantee, p_scope, p_connection, v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE(s.enabled, false),
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL),
    'pendingIncoming', (SELECT count(*) FROM public.connections c WHERE c.target_user_id = x.id AND c.status = 'requested'),
    'connections', (SELECT count(*) FROM public.connections c WHERE (c.target_user_id = x.id OR c.requester_user_id = x.id) AND c.status = 'accepted'),
    'shareableFields', ARRAY['phone', 'email', 'company', 'job_title'])
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.connect_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.connect_settings_set(p_user uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'connect:invalid_setting' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.connect_settings AS s (user_id, enabled, updated_at) VALUES (p_user, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  PERFORM public.connect_log(p_user, NULL, CASE WHEN p_enabled THEN 'settings.enabled' ELSE 'settings.disabled' END);
  RETURN public.connect_settings_for(p_user);
END;
$$;

-- Who a request to /t/<slug> would reach; NULL when Connect is not available there.
CREATE OR REPLACE FUNCTION public.connect_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id)
    FROM public.tap_profiles t
    JOIN public.connect_settings s ON s.user_id = t.user_id AND s.enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL AND p.suspended_at IS NULL
   LIMIT 1;
$$;

-- A request. Returns {ok, connectionId, replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.connect_request(p_requester uuid, p_slug text, p_share text[], p_note text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_target jsonb := public.connect_public_target(p_slug);
  v_target_user uuid;
  v_scope text[] := public.connect_fields(p_share);
  v_note text := NULLIF(public.rescue_clean_text(p_note, 200), '');
  v_c public.connections;
  v_code text;
  v_wait integer;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  IF v_scope IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_share'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('connect:' || p_requester::text, 0));

  SELECT * INTO v_c FROM public.connections WHERE requester_user_id = p_requester AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'connectionId', v_c.id, 'replayed', true); END IF;

  v_target_user := (v_target->>'userId')::uuid;
  IF v_target IS NULL THEN
    v_code := 'unavailable';
  ELSIF v_target_user = p_requester THEN
    v_code := 'self';
  ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requester AND suspended_at IS NOT NULL) THEN
    v_code := 'unavailable';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE requester_user_id = p_requester AND target_user_id = v_target_user AND status = 'blocked') THEN
    v_code := 'unavailable';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE LEAST(requester_user_id, target_user_id) = LEAST(p_requester, v_target_user)
                   AND GREATEST(requester_user_id, target_user_id) = GREATEST(p_requester, v_target_user)
                   AND status IN ('requested', 'accepted')) THEN
    v_code := 'already_connected';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE requester_user_id = p_requester AND target_user_id = v_target_user AND status = 'declined'
                   AND ended_at > now() - interval '30 days') THEN
    v_code := 'recently_declined'; v_wait := 30 * 86400;
  ELSIF (SELECT count(*) FROM public.connections WHERE requester_user_id = p_requester AND created_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.connections WHERE requester_user_id = p_requester AND created_at > now() - interval '24 hours') >= 20 THEN
    v_code := 'rate_limited'; v_wait := 3600;
  ELSIF (SELECT count(*) FROM public.connections WHERE target_user_id = v_target_user AND status = 'requested') >= 50 THEN
    v_code := 'target_busy';
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.connect_log(p_requester, NULL, 'request.refused', jsonb_build_object('code', v_code));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1));
  END IF;

  INSERT INTO public.connections (requester_user_id, target_user_id, target_tap_profile_id, note, idempotency_key)
  VALUES (p_requester, v_target_user, (v_target->>'tapProfileId')::uuid, v_note, p_idempotency_key)
  RETURNING * INTO v_c;
  PERFORM public.connect_grant(v_c.id, p_requester, v_target_user, v_scope);
  PERFORM public.connect_log(p_requester, v_c.id, 'request.sent', jsonb_build_object('scope', v_scope));
  PERFORM public.connect_log(v_target_user, v_c.id, 'request.received', '{}'::jsonb);
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_target_user, 'connect', 'New connection request',
          (public.connect_party(p_requester)->>'name') || ' wants to connect with you on SHYGON.',
          '/shygontap/connections', jsonb_build_object('connectionId', v_c.id));
  RETURN jsonb_build_object('ok', true, 'connectionId', v_c.id, 'replayed', false);
END;
$$;

-- accept (with the target's own share) · decline · block. Target only, while requested.
CREATE OR REPLACE FUNCTION public.connect_decide(p_user uuid, p_connection uuid, p_decision text, p_share text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_scope text[] := public.connect_fields(p_share);
BEGIN
  IF p_decision NOT IN ('accept', 'decline', 'block') THEN RAISE EXCEPTION 'connect:invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_c FROM public.connections WHERE id = p_connection AND target_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status <> 'requested' THEN RAISE EXCEPTION 'connect:already_decided' USING ERRCODE = 'P0001'; END IF;
  IF p_decision = 'accept' THEN
    IF v_scope IS NULL THEN RAISE EXCEPTION 'connect:invalid_share' USING ERRCODE = '22023'; END IF;
    UPDATE public.connections SET status = 'accepted', decided_at = now() WHERE id = v_c.id;
    PERFORM public.connect_grant(v_c.id, p_user, v_c.requester_user_id, v_scope);
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (v_c.requester_user_id, 'connect', 'Connection accepted',
            (public.connect_party(p_user)->>'name') || ' accepted your connection request.',
            '/shygontap/connections', jsonb_build_object('connectionId', v_c.id));
  ELSE
    UPDATE public.connections
       SET status = CASE WHEN p_decision = 'block' THEN 'blocked' ELSE 'declined' END,
           decided_at = now(), ended_at = now(), ended_by = p_user
     WHERE id = v_c.id;
    PERFORM public.connect_revoke_grants(v_c.id, NULL, p_user, CASE WHEN p_decision = 'block' THEN 'blocked' ELSE 'declined' END);
  END IF;
  PERFORM public.connect_log(p_user, v_c.id,
    CASE p_decision WHEN 'accept' THEN 'request.accepted' WHEN 'decline' THEN 'request.declined' ELSE 'request.blocked' END,
    CASE WHEN p_decision = 'accept' THEN jsonb_build_object('scope', v_scope) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Change what I share on an open connection (append-only: a new grant version).
CREATE OR REPLACE FUNCTION public.connect_share(p_user uuid, p_connection uuid, p_share text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_scope text[] := public.connect_fields(p_share); v_other uuid;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'connect:invalid_share' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_c FROM public.connections
   WHERE id = p_connection AND (requester_user_id = p_user OR target_user_id = p_user) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status NOT IN ('requested', 'accepted') OR (v_c.status = 'requested' AND v_c.target_user_id = p_user) THEN
    RAISE EXCEPTION 'connect:not_open' USING ERRCODE = 'P0001';
  END IF;
  v_other := CASE WHEN v_c.requester_user_id = p_user THEN v_c.target_user_id ELSE v_c.requester_user_id END;
  PERFORM public.connect_grant(v_c.id, p_user, v_other, v_scope);
  PERFORM public.connect_log(p_user, v_c.id, 'share.changed', jsonb_build_object('scope', v_scope));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Either party ends the connection (or withdraws a request); every grant both ways is revoked.
CREATE OR REPLACE FUNCTION public.connect_remove(p_user uuid, p_connection uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_n integer;
BEGIN
  SELECT * INTO v_c FROM public.connections
   WHERE id = p_connection AND (requester_user_id = p_user OR target_user_id = p_user) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status NOT IN ('requested', 'accepted') THEN RAISE EXCEPTION 'connect:not_open' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.connections SET status = 'removed', ended_at = now(), ended_by = p_user WHERE id = v_c.id;
  v_n := public.connect_revoke_grants(v_c.id, NULL, p_user, 'removed');
  PERFORM public.connect_log(p_user, v_c.id, 'connection.removed', jsonb_build_object('grantsRevoked', v_n));
  RETURN jsonb_build_object('ok', true, 'grantsRevoked', v_n);
END;
$$;

-- My connections, each with the other party, what each side shares and the
-- other side's shared values, read live and only under an active grant.
CREATE OR REPLACE FUNCTION public.connect_list(p_user uuid, p_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb)
  FROM (
    SELECT COALESCE(c.decided_at, c.created_at) AS at, jsonb_build_object(
      'id', c.id,
      'direction', CASE WHEN c.requester_user_id = p_user THEN 'outgoing' ELSE 'incoming' END,
      -- A requester never learns that they were blocked: a block shows as declined.
      'status', CASE WHEN c.status = 'blocked' AND c.requester_user_id = p_user THEN 'declined' ELSE c.status END,
      'note', c.note,
      'createdAt', c.created_at, 'decidedAt', c.decided_at, 'endedAt', c.ended_at,
      'other', public.connect_party(o.other),
      'iShare', COALESCE((SELECT to_jsonb(g.scope) FROM public.consent_grants g
                           WHERE g.connection_id = c.id AND g.grantor_user_id = p_user AND g.revoked_at IS NULL), '[]'::jsonb),
      'theyShare', COALESCE((SELECT jsonb_object_agg(f, jsonb_build_object(
                                 'value', CASE f WHEN 'phone' THEN pr.phone WHEN 'email' THEN pr.email
                                                 WHEN 'company' THEN pr.company WHEN 'job_title' THEN pr.job_title END,
                                 'provenance', 'self_reported'))
                              FROM public.consent_grants g
                              CROSS JOIN LATERAL unnest(g.scope) AS f
                              LEFT JOIN public.profiles pr ON pr.id = g.grantor_user_id
                             WHERE g.connection_id = c.id AND g.grantor_user_id = o.other AND g.grantee_user_id = p_user
                               AND g.revoked_at IS NULL
                               AND c.status IN ('requested', 'accepted')), '{}'::jsonb)) AS j
    FROM public.connections c
    CROSS JOIN LATERAL (SELECT CASE WHEN c.requester_user_id = p_user THEN c.target_user_id ELSE c.requester_user_id END AS other) o
    WHERE (c.requester_user_id = p_user OR c.target_user_id = p_user)
      AND (p_filter IS NULL OR c.status = p_filter)
    LIMIT 200
  ) x;
$$;

-- My consent ledger: every grant I gave or received, revoked ones included.
CREATE OR REPLACE FUNCTION public.connect_consents_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id, 'connectionId', g.connection_id,
    'direction', CASE WHEN g.grantor_user_id = p_user THEN 'given' ELSE 'received' END,
    'other', public.connect_party(CASE WHEN g.grantor_user_id = p_user THEN g.grantee_user_id ELSE g.grantor_user_id END),
    'scope', g.scope, 'purpose', g.purpose, 'version', g.version,
    'grantedAt', g.granted_at, 'revokedAt', g.revoked_at, 'revokeReason', g.revoke_reason) ORDER BY g.granted_at DESC), '[]'::jsonb)
  FROM public.consent_grants g
  WHERE g.grantor_user_id = p_user OR g.grantee_user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.connect_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_expired int := 0; v_deleted int; r record;
BEGIN
  FOR r IN SELECT id, target_user_id FROM public.connections WHERE status = 'requested' AND created_at < now() - interval '30 days' FOR UPDATE LOOP
    UPDATE public.connections SET status = 'expired', ended_at = now() WHERE id = r.id;
    PERFORM public.connect_revoke_grants(r.id, NULL, NULL, 'expired');
    v_expired := v_expired + 1;
  END LOOP;
  DELETE FROM public.connections WHERE status IN ('declined', 'expired', 'removed') AND ended_at < now() - interval '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('requestsExpired', v_expired, 'connectionsDeleted', v_deleted);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.connect_log(uuid, uuid, text, jsonb)',
    'public.connect_fields(text[])',
    'public.connect_party(uuid)',
    'public.connect_revoke_grants(uuid, uuid, uuid, text)',
    'public.connect_grant(uuid, uuid, uuid, text[])',
    'public.connect_settings_for(uuid)',
    'public.connect_settings_set(uuid, boolean)',
    'public.connect_public_target(text)',
    'public.connect_request(uuid, text, text[], text, text)',
    'public.connect_decide(uuid, uuid, text, text[])',
    'public.connect_share(uuid, uuid, text[])',
    'public.connect_remove(uuid, uuid)',
    'public.connect_list(uuid, text)',
    'public.connect_consents_for(uuid)',
    'public.connect_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;


-- ###########################################################################
-- ## 033_prive_demo.sql
-- ###########################################################################

-- 033: SHYGON Privé, demo only: sample hotels owned by SHYGON, and guest
-- service requests that are really stored and progressed inside SHYGON, but
-- never reach, and are never presented as reaching, a real hotel.
--
-- Decision:  DEC-2026-038 Q6, changed to A by the owner on 2026-10-20
--            ("Privé demo-only: build the demo-only Privé (labelled sample
--            hotels, SHYGON-owned test data, no real hotel integrations)");
--            the 2026-10-19 briefs (a demo request "may be genuinely created
--            and updated inside the SHYGON demo environment, but it must never
--            be represented as having reached a real hotel"). The choices this
--            file makes are DEC-2026-040 Q1-Q5, APPROVED by the owner 2026-10-20
--            (in session). Approval of the design is not approval to apply:
--            see Level.
-- Level:     L3 (new tables, seed rows, privileged functions). DEC-2026-018
--            cool-off plus checklist review before approval or application.
--            Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-032.
-- Data:      inserts three SAMPLE hotels (fictional, owned by SHYGON, every
--            row is_demo = true). Nothing else is read or changed.
--
-- MODEL
--   prive_demo_hotels          the sample catalogue. is_demo is always true
--                              (CHECK); each row carries its demo label.
--   prive_demo_requests        a signed-in account's demo service request at
--                              a sample hotel. is_demo always true (CHECK).
--   prive_demo_request_events  every step, by the guest or by the SHYGON demo
--                              simulator (append-only).
--   The "hotel" is a simulator inside SHYGON: received -> acknowledged (after
--   20 s) -> in progress (after 1 min) -> completed (after 3 min). There is no
--   hotel system behind it, and nothing here calls one.
--
-- RULES (supabase/tests/prive.mjs)
--   - Catalogue and requests are closed to every client role; the server
--     function /api/prive is the only way in.
--   - A request: signed-in account, a sample hotel, one of that hotel's
--     sample services; idempotency key; 10 per hour and 50 per day per
--     account; cancel while not completed.
--   - Retention: requests (with their events) deleted 30 days after creation;
--     the account cascade deletes them with the account.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.prive_demo_hotels');   -- NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.prive_demo_purge();
-- DROP FUNCTION IF EXISTS public.prive_demo_request_cancel(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.prive_demo_requests_for(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.prive_demo_request_create(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.prive_demo_advance_due();
-- DROP FUNCTION IF EXISTS public.prive_demo_hotels_list();
-- DROP TABLE IF EXISTS public.prive_demo_request_events;
-- DROP TABLE IF EXISTS public.prive_demo_requests;
-- DROP TABLE IF EXISTS public.prive_demo_hotels;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.prive_demo_hotels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  name        text NOT NULL CHECK (name LIKE 'SHYGON Demo %'),
  city        text NOT NULL,
  description text NOT NULL,
  services    jsonb NOT NULL,
  is_demo     boolean NOT NULL DEFAULT true CHECK (is_demo),
  demo_label  text NOT NULL DEFAULT 'Sample hotel (demo). Not a real property.',
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.prive_demo_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hotel_id        uuid NOT NULL REFERENCES public.prive_demo_hotels(id) ON DELETE CASCADE,
  service         text NOT NULL,
  status          text NOT NULL DEFAULT 'received'
                  CHECK (status IN ('received', 'acknowledged', 'in_progress', 'completed', 'cancelled')),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  is_demo         boolean NOT NULL DEFAULT true CHECK (is_demo),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  CONSTRAINT prive_demo_requests_idempotent UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_prive_demo_requests_user ON public.prive_demo_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prive_demo_requests_open ON public.prive_demo_requests (status, updated_at)
  WHERE status IN ('received', 'acknowledged', 'in_progress');

CREATE TABLE IF NOT EXISTS public.prive_demo_request_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.prive_demo_requests(id) ON DELETE CASCADE,
  status     text NOT NULL,
  actor      text NOT NULL CHECK (actor IN ('guest', 'demo_hotel_simulator')),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prive_demo_events_request ON public.prive_demo_request_events (request_id, at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prive_demo_hotels', 'prive_demo_requests', 'prive_demo_request_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.prive_demo_request_events FROM service_role;
END $$;

-- The sample catalogue: fictional properties owned by SHYGON. The first one and
-- its services match the frontend's walkthrough ("SHYGON Demo Residence").
INSERT INTO public.prive_demo_hotels (slug, name, city, description, services, sort_order) VALUES
  ('demo-residence', 'SHYGON Demo Residence', 'Sample city',
   'A sample hotel for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"fresh_towels","label":"Fresh towels"},{"id":"housekeeping","label":"Housekeeping"},{"id":"late_checkout","label":"Late check-out"},{"id":"restaurant_table","label":"A table at the restaurant"}]', 1),
  ('demo-seaside', 'SHYGON Demo Seaside', 'Sample coast',
   'A sample beach hotel for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"fresh_towels","label":"Fresh towels"},{"id":"room_service","label":"Room service"},{"id":"airport_transfer","label":"Airport transfer"}]', 2),
  ('demo-hills', 'SHYGON Demo Hills', 'Sample hills',
   'A sample hill retreat for trying SHYGON Privé. Not a real property; nothing here reaches a hotel.',
   '[{"id":"housekeeping","label":"Housekeeping"},{"id":"spa","label":"A spa slot"},{"id":"late_checkout","label":"Late check-out"}]', 3)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.prive_demo_hotels_list()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'slug', h.slug, 'name', h.name, 'city', h.city, 'description', h.description,
    'services', h.services, 'demo', h.is_demo, 'label', h.demo_label) ORDER BY h.sort_order), '[]'::jsonb)
  FROM public.prive_demo_hotels h;
$$;

-- The SHYGON demo "hotel desk": moves each open request one step when its time
-- comes. Called by the sweep and before every read, so it also works without a
-- schedule.
CREATE OR REPLACE FUNCTION public.prive_demo_advance_due()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r record; v_next text; v_n integer := 0;
BEGIN
  FOR r IN
    SELECT id, status, created_at FROM public.prive_demo_requests
     WHERE status IN ('received', 'acknowledged', 'in_progress')
     FOR UPDATE SKIP LOCKED
  LOOP
    v_next := CASE
      WHEN r.status = 'received' AND r.created_at <= now() - interval '20 seconds' THEN 'acknowledged'
      WHEN r.status = 'acknowledged' AND r.created_at <= now() - interval '1 minute' THEN 'in_progress'
      WHEN r.status = 'in_progress' AND r.created_at <= now() - interval '3 minutes' THEN 'completed'
    END;
    CONTINUE WHEN v_next IS NULL;
    UPDATE public.prive_demo_requests
       SET status = v_next, updated_at = now(), completed_at = CASE WHEN v_next = 'completed' THEN now() END
     WHERE id = r.id;
    INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (r.id, v_next, 'demo_hotel_simulator');
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Returns {ok, requestId, replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.prive_demo_request_create(p_user uuid, p_hotel_slug text, p_service text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_hotel public.prive_demo_hotels; v_r public.prive_demo_requests;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('prive:' || p_user::text, 0));
  SELECT * INTO v_r FROM public.prive_demo_requests WHERE user_id = p_user AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'requestId', v_r.id, 'replayed', true); END IF;

  SELECT * INTO v_hotel FROM public.prive_demo_hotels WHERE slug = lower(btrim(COALESCE(p_hotel_slug, '')));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'hotel_not_found'); END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hotel.services) s WHERE s->>'id' = p_service) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_service');
  END IF;
  IF (SELECT count(*) FROM public.prive_demo_requests WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 10
     OR (SELECT count(*) FROM public.prive_demo_requests WHERE user_id = p_user AND created_at > now() - interval '24 hours') >= 50 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited', 'retryAfter', 3600);
  END IF;

  INSERT INTO public.prive_demo_requests (user_id, hotel_id, service, idempotency_key)
  VALUES (p_user, v_hotel.id, p_service, p_idempotency_key)
  RETURNING * INTO v_r;
  INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (v_r.id, 'received', 'guest');
  RETURN jsonb_build_object('ok', true, 'requestId', v_r.id, 'replayed', false);
END;
$$;

-- My demo requests (or one), each with its hotel, its service label and its steps.
CREATE OR REPLACE FUNCTION public.prive_demo_requests_for(p_user uuid, p_request uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'demo', r.is_demo, 'status', r.status,
    'hotel', jsonb_build_object('slug', h.slug, 'name', h.name, 'label', h.demo_label),
    'service', jsonb_build_object('id', r.service,
                 'label', (SELECT s->>'label' FROM jsonb_array_elements(h.services) s WHERE s->>'id' = r.service LIMIT 1)),
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'completedAt', r.completed_at, 'cancelledAt', r.cancelled_at,
    'steps', (SELECT COALESCE(jsonb_agg(jsonb_build_object('status', e.status, 'by', e.actor, 'at', e.at) ORDER BY e.at), '[]'::jsonb)
                FROM public.prive_demo_request_events e WHERE e.request_id = r.id)) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.prive_demo_requests r
  JOIN public.prive_demo_hotels h ON h.id = r.hotel_id
  WHERE r.user_id = p_user AND (p_request IS NULL OR r.id = p_request);
$$;

CREATE OR REPLACE FUNCTION public.prive_demo_request_cancel(p_user uuid, p_request uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.prive_demo_requests;
BEGIN
  SELECT * INTO v_r FROM public.prive_demo_requests WHERE id = p_request AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'prive:request_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_r.status IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'prive:already_closed' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.prive_demo_requests SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_r.id;
  INSERT INTO public.prive_demo_request_events (request_id, status, actor) VALUES (v_r.id, 'cancelled', 'guest');
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.prive_demo_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.prive_demo_requests WHERE created_at < now() - interval '30 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('demoRequestsDeleted', v_n, 'advanced', public.prive_demo_advance_due());
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.prive_demo_hotels_list()',
    'public.prive_demo_advance_due()',
    'public.prive_demo_request_create(uuid, text, text, text)',
    'public.prive_demo_requests_for(uuid, uuid)',
    'public.prive_demo_request_cancel(uuid, uuid)',
    'public.prive_demo_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;


-- ###########################################################################
-- ## 034_modes_and_info.sql
-- ###########################################################################

-- 034: Modes v1 and Info. One active public experience per Tap (Business by
-- default, or Info: a public page about a physical object, place or service
-- point), chosen by the Tap's owner through /api/modes.
--
-- Decision:  DEC-2026-041 (revision 3, owner's conditional direction of
--            2026-10-20), implementation scope approved by the owner on
--            2026-10-24 ("Info mode (Recommended)": migration 034, /api/modes,
--            a new public reader, the 'unavailable' fallback, privacy canary
--            tests; title 120 / short description 280 and the category list
--            as proposed; production get_public_profile left untouched).
-- Level:     L3 (new tables, a catalogue seed, privileged functions, one new
--            anonymous reader). DEC-2026-018 cool-off plus checklist before any
--            real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-033. Not 027 (held aside, DEC-2026-037).
--
-- MODEL
--   tap_mode_catalog  the SHYGON-defined modes and their kill switch.
--                     'business' is on; 'info' is OFF in this seed.
--   info_pages        one Info record per account (v1): title, short
--                     description, category, detailed information. Plain
--                     text only: no image, no language, no links, no
--                     Business data (DEC-2026-041 SQ-3, SQ-4, CQ-2, BQ-3).
--   tap_mode_state    a Tap's active mode. No row means Business, so every
--                     existing Tap behaves exactly as before.
--   tap_mode_audit    who changed what and when: field NAMES only, never values.
--
-- RULES (supabase/tests/modes.mjs)
--   - All four tables are closed to every client role. /api/modes (owner) and
--     get_public_tap_mode (visitors) are the only ways in.
--   - Switching: the owner's own Tap, not suspended, the mode on in the
--     catalogue, Info complete (title and short description), the expected
--     version, an idempotency key. Switching to Business is always allowed.
--   - Fallback (BQ-2): Info switched off by SHYGON, missing or invalid gives
--     the neutral "unavailable" answer (null), never the Business profile.
--   - No 14-day window and no fixed quota on Info (Q0.6, RQ-1). An Info save
--     never touches tap_profiles.
--
-- BACKWARD COMPATIBILITY (BQ-1, readiness report §0.12)
--   get_public_profile is NOT changed. A Tap on Info would still return its
--   Business payload through that legacy reader, so 'info' is seeded OFF.
--   Do not set tap_mode_catalog.enabled = true for 'info' on any real database
--   until BQ-1's change to get_public_profile is approved and applied.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.info_pages');                       -- NULL
--   SELECT to_regprocedure('public.get_public_tap_mode(text)');    -- NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.get_public_tap_mode(text);
-- DROP FUNCTION IF EXISTS public.modes_preview(uuid, text);
-- DROP FUNCTION IF EXISTS public.modes_info_clear(uuid);
-- DROP FUNCTION IF EXISTS public.modes_info_save(uuid, jsonb, integer);
-- DROP FUNCTION IF EXISTS public.modes_info_get(uuid);
-- DROP FUNCTION IF EXISTS public.modes_owner_activate(uuid, text, integer, text);
-- DROP FUNCTION IF EXISTS public.modes_owner_state(uuid);
-- DROP FUNCTION IF EXISTS public.modes_info_public(public.info_pages);
-- DROP FUNCTION IF EXISTS public.modes_info_missing(public.info_pages);
-- DROP FUNCTION IF EXISTS public.modes_text_problem(text, integer, boolean);
-- DROP TABLE IF EXISTS public.tap_mode_audit;
-- DROP TABLE IF EXISTS public.tap_mode_state;
-- DROP TABLE IF EXISTS public.info_pages;
-- DROP TABLE IF EXISTS public.tap_mode_catalog;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.tap_mode_catalog (
  mode       text PRIMARY KEY CHECK (mode IN ('business', 'info')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tap_mode_catalog (mode, enabled) VALUES ('business', true), ('info', false)
ON CONFLICT (mode) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.info_pages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  title                text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
  short_description    text CHECK (short_description IS NULL OR char_length(short_description) BETWEEN 1 AND 280),
  category             text CHECK (category IS NULL OR category IN ('place', 'product', 'equipment', 'exhibit', 'service_point', 'instructions')),
  detailed_information text CHECK (detailed_information IS NULL OR char_length(detailed_information) BETWEEN 1 AND 2000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tap_mode_state (
  tap_profile_id       uuid PRIMARY KEY REFERENCES public.tap_profiles(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active_mode          text NOT NULL DEFAULT 'business' REFERENCES public.tap_mode_catalog(mode),
  previous_mode        text REFERENCES public.tap_mode_catalog(mode),
  version              integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  changed_at           timestamptz NOT NULL DEFAULT now(),
  last_idempotency_key text CHECK (last_idempotency_key IS NULL OR last_idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  last_result          jsonb
);
CREATE INDEX IF NOT EXISTS idx_tap_mode_state_user ON public.tap_mode_state (user_id);

CREATE TABLE IF NOT EXISTS public.tap_mode_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_profile_id uuid,
  action         text NOT NULL CHECK (action IN ('activate', 'info_save', 'info_clear')),
  from_mode      text,
  to_mode        text,
  fields         text[] NOT NULL DEFAULT '{}',
  actor          text NOT NULL DEFAULT 'owner' CHECK (actor IN ('owner', 'system')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tap_mode_audit_user ON public.tap_mode_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tap_mode_catalog', 'info_pages', 'tap_mode_state', 'tap_mode_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  -- The audit is append-only, even for the server role.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.tap_mode_audit FROM service_role;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers

-- Why a value may not be stored, or NULL when it may. Plain text only: no
-- control characters (newlines only where multiline), nothing that looks
-- like markup, within the length limit. The value is already trimmed.
CREATE OR REPLACE FUNCTION public.modes_text_problem(p_value text, p_max integer, p_multiline boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN char_length(p_value) > p_max THEN 'too_long'
    WHEN (CASE WHEN p_multiline THEN translate(p_value, E'\n', '') ELSE p_value END) ~ '[[:cntrl:]]' THEN 'control_characters'
    WHEN p_value ~ '<[[:space:]]*[A-Za-z/!?]' THEN 'markup'
    ELSE NULL
  END
$$;

-- The required fields an Info record still lacks (or holds in an invalid form).
CREATE OR REPLACE FUNCTION public.modes_info_missing(p_info public.info_pages)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN p_info.id IS NULL OR p_info.title IS NULL
           OR public.modes_text_problem(p_info.title, 120, false) IS NOT NULL THEN 'title' END,
    CASE WHEN p_info.id IS NULL OR p_info.short_description IS NULL
           OR public.modes_text_problem(p_info.short_description, 280, false) IS NOT NULL THEN 'shortDescription' END
  ], NULL)
$$;

-- What a visitor may see of an Info record: the allowlist, nothing else.
CREATE OR REPLACE FUNCTION public.modes_info_public(p_info public.info_pages)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'title', p_info.title,
    'shortDescription', p_info.short_description,
    'category', p_info.category,
    'detailedInformation', p_info.detailed_information,
    'updatedAt', p_info.updated_at)
$$;

-- ---------------------------------------------------------------------------
-- Owner functions (service_role only; /api/modes passes the verified user)

CREATE OR REPLACE FUNCTION public.modes_owner_state(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_info public.info_pages;
  v_info_on boolean;
  v_missing text[];
  v_active text;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
  SELECT enabled INTO v_info_on FROM public.tap_mode_catalog WHERE mode = 'info';
  v_missing := public.modes_info_missing(v_info);
  v_active := COALESCE(v_state.active_mode, 'business');
  RETURN jsonb_build_object(
    'ok', true,
    'activeMode', v_active,
    'version', COALESCE(v_state.version, 0),
    'changedAt', v_state.changed_at,
    'modes', jsonb_build_array(
      jsonb_build_object('mode', 'business', 'available', true,
        'reason', CASE WHEN v_active = 'business' THEN 'active' ELSE 'ready' END),
      CASE
        WHEN NOT COALESCE(v_info_on, false) THEN
          jsonb_build_object('mode', 'info', 'available', false, 'reason', 'not_available')
        WHEN cardinality(v_missing) > 0 THEN
          jsonb_build_object('mode', 'info', 'available', false, 'reason', 'needs_setup', 'missing', to_jsonb(v_missing))
        ELSE
          jsonb_build_object('mode', 'info', 'available', true,
            'reason', CASE WHEN v_active = 'info' THEN 'active' ELSE 'ready' END)
      END));
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_owner_activate(p_user uuid, p_mode text, p_expected_version integer, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_info public.info_pages;
  v_enabled boolean;
  v_missing text[];
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  INSERT INTO public.tap_mode_state (tap_profile_id, user_id) VALUES (v_tap.id, p_user)
  ON CONFLICT (tap_profile_id) DO NOTHING;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id FOR UPDATE;

  -- The same request again: the first answer, nothing changed.
  IF v_state.last_idempotency_key = p_idempotency_key AND v_state.last_result IS NOT NULL THEN
    RETURN v_state.last_result || jsonb_build_object('replayed', true);
  END IF;

  IF v_tap.suspended_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND suspended_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tap_suspended');
  END IF;
  SELECT enabled INTO v_enabled FROM public.tap_mode_catalog WHERE mode = p_mode;
  IF NOT COALESCE(v_enabled, false) THEN RETURN jsonb_build_object('ok', false, 'code', 'mode_unavailable'); END IF;
  IF p_expected_version IS DISTINCT FROM v_state.version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version', 'current',
      jsonb_build_object('activeMode', v_state.active_mode, 'version', v_state.version));
  END IF;
  IF p_mode = 'info' THEN
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
    v_missing := public.modes_info_missing(v_info);
    IF cardinality(v_missing) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'needs_setup', 'missing', to_jsonb(v_missing));
    END IF;
  END IF;

  IF p_mode <> v_state.active_mode THEN
    UPDATE public.tap_mode_state
       SET previous_mode = active_mode, active_mode = p_mode, version = version + 1, changed_at = now()
     WHERE tap_profile_id = v_tap.id
     RETURNING * INTO v_state;
    INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, from_mode, to_mode)
    VALUES (p_user, v_tap.id, 'activate', v_state.previous_mode, v_state.active_mode);
  END IF;
  v_result := jsonb_build_object('ok', true, 'activeMode', v_state.active_mode, 'previousMode', v_state.previous_mode,
    'version', v_state.version, 'changedAt', v_state.changed_at, 'replayed', false);
  UPDATE public.tap_mode_state SET last_idempotency_key = p_idempotency_key, last_result = v_result
   WHERE tap_profile_id = v_tap.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_info_get(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
  v_state public.tap_mode_state;
  v_on boolean;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'info';
  RETURN jsonb_build_object(
    'ok', true,
    'info', CASE WHEN v_info.id IS NULL THEN NULL
                 ELSE public.modes_info_public(v_info) || jsonb_build_object('version', v_info.version) END,
    'publicationStatus', CASE
      WHEN cardinality(public.modes_info_missing(v_info)) > 0 THEN 'draft'
      WHEN COALESCE(v_state.active_mode, 'business') <> 'info' THEN 'ready'
      WHEN NOT COALESCE(v_on, false) OR v_tap.status <> 'active' OR v_tap.suspended_at IS NOT NULL THEN 'unavailable'
      ELSE 'live' END);
END;
$$;

-- p_fields: any of { title, shortDescription, category, detailedInformation }.
-- A key that is present sets the field (null or empty clears it); a key that is
-- absent leaves it. p_expected_version is 0 before the first save.
CREATE OR REPLACE FUNCTION public.modes_info_save(p_user uuid, p_fields jsonb, p_expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
  v_state public.tap_mode_state;
  v_new public.info_pages;
  v_key text;
  v_val text;
  v_problem text;
  v_fields text[] := '{}';
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM COALESCE(v_info.version, 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version', 'current', jsonb_build_object('version', COALESCE(v_info.version, 0)));
  END IF;

  v_new := v_info;
  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    IF v_key NOT IN ('title', 'shortDescription', 'category', 'detailedInformation') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', 'unknown');
    END IF;
    IF jsonb_typeof(p_fields -> v_key) NOT IN ('string', 'null') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', 'not_text');
    END IF;
    v_val := NULLIF(btrim(replace(p_fields ->> v_key, E'\r\n', E'\n')), '');
    v_problem := CASE v_key
      WHEN 'title' THEN public.modes_text_problem(v_val, 120, false)
      WHEN 'shortDescription' THEN public.modes_text_problem(v_val, 280, false)
      WHEN 'detailedInformation' THEN public.modes_text_problem(v_val, 2000, true)
      WHEN 'category' THEN CASE WHEN v_val IS NULL OR v_val IN ('place', 'product', 'equipment', 'exhibit', 'service_point', 'instructions')
                                THEN NULL ELSE 'not_allowed' END
    END;
    IF v_problem IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', v_problem);
    END IF;
    CASE v_key
      WHEN 'title' THEN v_new.title := v_val;
      WHEN 'shortDescription' THEN v_new.short_description := v_val;
      WHEN 'category' THEN v_new.category := v_val;
      WHEN 'detailedInformation' THEN v_new.detailed_information := v_val;
    END CASE;
    v_fields := v_fields || v_key;
  END LOOP;

  -- While Info is live it may not become incomplete (F-6): switch to Business first.
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  IF COALESCE(v_state.active_mode, 'business') = 'info' AND cardinality(public.modes_info_missing(v_new)) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'mode_active');
  END IF;

  IF v_info.id IS NULL THEN
    INSERT INTO public.info_pages (owner_user_id, title, short_description, category, detailed_information)
    VALUES (p_user, v_new.title, v_new.short_description, v_new.category, v_new.detailed_information)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.info_pages
       SET title = v_new.title, short_description = v_new.short_description, category = v_new.category,
           detailed_information = v_new.detailed_information, version = version + 1, updated_at = now()
     WHERE id = v_info.id
     RETURNING * INTO v_new;
  END IF;
  INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, fields) VALUES (p_user, v_tap.id, 'info_save', v_fields);
  RETURN public.modes_info_get(p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_info_clear(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_cleared boolean;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  IF COALESCE(v_state.active_mode, 'business') = 'info' THEN RETURN jsonb_build_object('ok', false, 'code', 'mode_active'); END IF;
  DELETE FROM public.info_pages WHERE owner_user_id = p_user;
  v_cleared := FOUND;
  IF v_cleared THEN
    INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action) VALUES (p_user, v_tap.id, 'info_clear');
  END IF;
  RETURN jsonb_build_object('ok', true, 'cleared', v_cleared);
END;
$$;

-- Exactly what a visitor would get for that mode on the owner's own Tap.
CREATE OR REPLACE FUNCTION public.modes_preview(p_user uuid, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  IF p_mode = 'business' THEN
    RETURN jsonb_build_object('ok', true, 'mode', 'business', 'view',
      CASE WHEN v_tap.slug IS NULL THEN NULL ELSE public.get_public_profile(v_tap.slug) END);
  ELSIF p_mode = 'info' THEN
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
    RETURN jsonb_build_object('ok', true, 'mode', 'info', 'view',
      CASE WHEN cardinality(public.modes_info_missing(v_info)) > 0 THEN NULL ELSE public.modes_info_public(v_info) END);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'invalid_mode');
END;
$$;

-- ---------------------------------------------------------------------------
-- The public reader (visitors; anon). One answer per Tap address:
--   { mode: 'business', profile: <get_public_profile payload> }
--   { mode: 'info', info: <allowlisted Info fields> }
--   null: no live Tap, or the neutral "unavailable" (Info switched off,
--         missing or invalid). Never the Business profile as a fallback.
CREATE OR REPLACE FUNCTION public.get_public_tap_mode(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_mode text;
  v_on boolean;
  v_info public.info_pages;
  v_profile jsonb;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles t
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, ''))) AND t.status = 'active' AND t.suspended_at IS NULL
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  v_mode := COALESCE(v_mode, 'business');
  IF v_mode = 'business' THEN
    v_profile := public.get_public_profile(v_tap.slug);
    RETURN CASE WHEN v_profile IS NULL THEN NULL ELSE jsonb_build_object('mode', 'business', 'profile', v_profile) END;
  END IF;
  IF v_mode = 'info' THEN
    SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'info';
    IF NOT COALESCE(v_on, false) THEN RETURN NULL; END IF;
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = v_tap.user_id;
    IF cardinality(public.modes_info_missing(v_info)) > 0
       OR public.modes_text_problem(v_info.detailed_information, 2000, true) IS NOT NULL THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('mode', 'info', 'info', public.modes_info_public(v_info));
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.modes_text_problem(text, integer, boolean)',
    'public.modes_info_missing(public.info_pages)',
    'public.modes_info_public(public.info_pages)',
    'public.modes_owner_state(uuid)',
    'public.modes_owner_activate(uuid, text, integer, text)',
    'public.modes_info_get(uuid)',
    'public.modes_info_save(uuid, jsonb, integer)',
    'public.modes_info_clear(uuid)',
    'public.modes_preview(uuid, text)',
    'public.get_public_tap_mode(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  -- The public reader, and only it, is open to visitors.
  GRANT EXECUTE ON FUNCTION public.get_public_tap_mode(text) TO anon, authenticated;
END $$;


-- ###########################################################################
-- ## 035_public_profile_respects_mode.sql
-- ###########################################################################

-- 035: get_public_profile respects the Tap's active mode (BQ-1).
--
-- Decision:  DEC-2026-041 BQ-1. The owner approved building it on 2026-10-24
--            ("BQ-1 fix (Recommended)": the old public profile reader returns
--            nothing while a Tap is on Info; shape unchanged; every other Tap
--            byte-identical; written against the repo baseline, production's
--            drifted copy still waits for the rebaseline, V6-106).
-- Level:     L3 (a frozen public function's body). DEC-2026-018 cool-off plus
--            checklist before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-034. Needs 034 (tap_mode_state).
--
-- CHANGE (one guard, nothing else; admin-contract APPROVED_BODY_CHANGES pins it)
--   After the Tap lookup, get_public_profile returns NULL while the Tap's
--   active mode is not 'business'. A Tap with no mode state, or on Business,
--   gets the byte-identical payload (supabase/tests/golden-public-tap.mjs).
--   Same signature, return type, security, search_path and grants.
--
-- EFFECT
--   - Business is never public through the legacy reader while Info is shown,
--     and never as a fallback (BQ-2), so Info may be switched on in
--     tap_mode_catalog once this migration is applied. That switch stays a
--     per-environment owner decision.
--   - An older client (it calls only get_public_profile) shows its existing
--     "Tap not found" page for a Tap on Info: get_public_profile is NULL and
--     get_public_tap_state still answers 'active' (readiness report §0.12).
--   - owner.preview for Business also answers null while the Tap is on Info.
--
-- PRODUCTION (BLOCKED, V6-106 / G2): production's get_public_profile has
--   drifted from the baseline (pageTemplate, tier_buttons, tap_card_features).
--   Applying this file there would replace that body with the baseline one.
--   Re-base it on the fresh production capture first.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_public_profile(text)'::regprocedure;
--     -- must equal the baseline body hash acbaff4f0fb3014a0a080cbf15267cd9
--     -- (production's differs today: STOP and re-base, see PRODUCTION)
--   SELECT to_regclass('public.tap_mode_state');   -- NOT NULL (034 applied)
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_tap         public.tap_profiles%ROWTYPE;
--   v_tier        TEXT;
--   v_pass        BOOLEAN;
--   v_owned       TEXT[];
--   v_shown       TEXT[];
--   v_clamp       TEXT;
--   v_event       JSONB;
--   v_event_theme JSONB;
--   v_base        JSONB;
--   v_eff         JSONB;
-- BEGIN
--   SELECT * INTO v_tap
--   FROM public.tap_profiles t
--   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
--     AND t.status = 'active'
--     AND t.suspended_at IS NULL
--   LIMIT 1;
--   IF NOT FOUND THEN RETURN NULL; END IF;
--
--   v_tier := public.user_max_ui_tier(v_tap.user_id);
--   v_pass := public.user_has_pass(v_tap.user_id);
--
--   SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
--   FROM public.entitlements e
--   WHERE e.user_id = v_tap.user_id AND e.is_active AND e.type = 'customization';
--
--   v_shown := ARRAY(
--     SELECT unnest(v_tap.enabled_customizations)
--     INTERSECT
--     SELECT unnest(v_owned || ARRAY['phone','email'])
--   );
--
--   v_clamp := CASE
--     WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
--       THEN public.canonical_experience(v_tap.selected_ui_tier)
--     ELSE v_tier
--   END;
--
--   v_base := jsonb_build_object(
--     'palette', CASE WHEN v_tap.theme_palette = ANY(public.theme_options('palette', v_clamp, v_pass)) THEN v_tap.theme_palette ELSE 'midnight' END,
--     'layout', CASE WHEN v_tap.theme_layout = ANY(public.theme_options('layout', v_clamp, v_pass)) THEN v_tap.theme_layout ELSE 'classic' END,
--     'buttons', CASE WHEN v_tap.theme_buttons = ANY(public.theme_options('buttons', v_clamp, v_pass)) THEN v_tap.theme_buttons ELSE 'solid' END,
--     'font', CASE WHEN v_tap.theme_font = ANY(public.theme_options('font', v_clamp, v_pass)) THEN v_tap.theme_font ELSE 'sans' END,
--     'animation', CASE WHEN v_tap.theme_animation = ANY(public.theme_options('animation', v_clamp, v_pass)) THEN v_tap.theme_animation ELSE 'auto' END
--   );
--
--   v_event := public.tap_event_theme_for(now());
--   v_event_theme := COALESCE(v_event->'theme', '{}'::jsonb);
--
--   v_eff := jsonb_build_object(
--     'palette', COALESCE(NULLIF(v_event_theme->>'palette',''), v_base->>'palette'),
--     'layout', COALESCE(NULLIF(v_event_theme->>'layout',''), v_base->>'layout'),
--     'buttons', COALESCE(NULLIF(v_event_theme->>'buttons',''), v_base->>'buttons'),
--     'font', COALESCE(NULLIF(v_event_theme->>'font',''), v_base->>'font'),
--     'animation', COALESCE(NULLIF(v_event_theme->>'animation',''), v_base->>'animation')
--   );
--
--   RETURN jsonb_build_object(
--     'slug', v_tap.slug,
--     'experience', v_clamp,
--     'displayName', v_tap.display_name,
--     'headline', v_tap.headline,
--     'designation', v_tap.designation,
--     'company', v_tap.company,
--     'bio', v_tap.bio,
--     'avatarUrl', v_tap.avatar_url,
--     'location', CASE WHEN 'location' = ANY(v_shown) THEN v_tap.location END,
--     'phone', CASE WHEN 'phone' = ANY(v_shown) THEN v_tap.phone END,
--     'whatsapp', CASE WHEN 'whatsapp' = ANY(v_shown) THEN v_tap.whatsapp END,
--     'email', CASE WHEN 'email' = ANY(v_shown) THEN v_tap.email END,
--     'website', CASE WHEN 'website' = ANY(v_shown) THEN v_tap.website END,
--     'instagram', CASE WHEN 'instagram' = ANY(v_shown) THEN v_tap.instagram END,
--     'linkedin', CASE WHEN 'linkedin' = ANY(v_shown) THEN v_tap.linkedin END,
--     'youtube', CASE WHEN 'youtube' = ANY(v_shown) THEN v_tap.youtube END,
--     'customLinks', CASE WHEN 'links' = ANY(v_shown) THEN v_tap.custom_links ELSE '[]'::jsonb END,
--     'theme', v_eff,
--     'baseTheme', v_base,
--     'activeEvent', NULLIF(v_event, '{}'::jsonb)
--   );
-- END;
-- $function$;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tap         public.tap_profiles%ROWTYPE;
  v_tier        TEXT;
  v_pass        BOOLEAN;
  v_owned       TEXT[];
  v_shown       TEXT[];
  v_clamp       TEXT;
  v_event       JSONB;
  v_event_theme JSONB;
  v_base        JSONB;
  v_eff         JSONB;
BEGIN
  SELECT * INTO v_tap
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
    AND t.status = 'active'
    AND t.suspended_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- BQ-1 (migration 035, DEC-2026-041): while the Tap shows another mode
  -- (Info), its Business profile is not public through this reader either.
  IF EXISTS (SELECT 1 FROM public.tap_mode_state s
             WHERE s.tap_profile_id = v_tap.id AND s.active_mode <> 'business') THEN
    RETURN NULL;
  END IF;

  v_tier := public.user_max_ui_tier(v_tap.user_id);
  v_pass := public.user_has_pass(v_tap.user_id);

  SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = v_tap.user_id AND e.is_active AND e.type = 'customization';

  v_shown := ARRAY(
    SELECT unnest(v_tap.enabled_customizations)
    INTERSECT
    SELECT unnest(v_owned || ARRAY['phone','email'])
  );

  v_clamp := CASE
    WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
      THEN public.canonical_experience(v_tap.selected_ui_tier)
    ELSE v_tier
  END;

  v_base := jsonb_build_object(
    'palette', CASE WHEN v_tap.theme_palette = ANY(public.theme_options('palette', v_clamp, v_pass)) THEN v_tap.theme_palette ELSE 'midnight' END,
    'layout', CASE WHEN v_tap.theme_layout = ANY(public.theme_options('layout', v_clamp, v_pass)) THEN v_tap.theme_layout ELSE 'classic' END,
    'buttons', CASE WHEN v_tap.theme_buttons = ANY(public.theme_options('buttons', v_clamp, v_pass)) THEN v_tap.theme_buttons ELSE 'solid' END,
    'font', CASE WHEN v_tap.theme_font = ANY(public.theme_options('font', v_clamp, v_pass)) THEN v_tap.theme_font ELSE 'sans' END,
    'animation', CASE WHEN v_tap.theme_animation = ANY(public.theme_options('animation', v_clamp, v_pass)) THEN v_tap.theme_animation ELSE 'auto' END
  );

  v_event := public.tap_event_theme_for(now());
  v_event_theme := COALESCE(v_event->'theme', '{}'::jsonb);

  v_eff := jsonb_build_object(
    'palette', COALESCE(NULLIF(v_event_theme->>'palette',''), v_base->>'palette'),
    'layout', COALESCE(NULLIF(v_event_theme->>'layout',''), v_base->>'layout'),
    'buttons', COALESCE(NULLIF(v_event_theme->>'buttons',''), v_base->>'buttons'),
    'font', COALESCE(NULLIF(v_event_theme->>'font',''), v_base->>'font'),
    'animation', COALESCE(NULLIF(v_event_theme->>'animation',''), v_base->>'animation')
  );

  RETURN jsonb_build_object(
    'slug', v_tap.slug,
    'experience', v_clamp,
    'displayName', v_tap.display_name,
    'headline', v_tap.headline,
    'designation', v_tap.designation,
    'company', v_tap.company,
    'bio', v_tap.bio,
    'avatarUrl', v_tap.avatar_url,
    'location', CASE WHEN 'location' = ANY(v_shown) THEN v_tap.location END,
    'phone', CASE WHEN 'phone' = ANY(v_shown) THEN v_tap.phone END,
    'whatsapp', CASE WHEN 'whatsapp' = ANY(v_shown) THEN v_tap.whatsapp END,
    'email', CASE WHEN 'email' = ANY(v_shown) THEN v_tap.email END,
    'website', CASE WHEN 'website' = ANY(v_shown) THEN v_tap.website END,
    'instagram', CASE WHEN 'instagram' = ANY(v_shown) THEN v_tap.instagram END,
    'linkedin', CASE WHEN 'linkedin' = ANY(v_shown) THEN v_tap.linkedin END,
    'youtube', CASE WHEN 'youtube' = ANY(v_shown) THEN v_tap.youtube END,
    'customLinks', CASE WHEN 'links' = ANY(v_shown) THEN v_tap.custom_links ELSE '[]'::jsonb END,
    'theme', v_eff,
    'baseTheme', v_base,
    'activeEvent', NULLIF(v_event, '{}'::jsonb)
  );
END;
$function$;

