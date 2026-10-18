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

