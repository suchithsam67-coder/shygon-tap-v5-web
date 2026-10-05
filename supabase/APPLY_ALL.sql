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

