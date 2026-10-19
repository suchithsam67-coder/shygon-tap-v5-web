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
--   8. 028_guard_suspension_on_insert.sql
--   9. 029_emergency_contacts_and_alerts.sql
--   10. 030_guard_tap_server_columns.sql
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
--            PROPOSED: not yet reviewed or approved.
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
--            numbering N-1. PROPOSED: not yet reviewed or approved.
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

