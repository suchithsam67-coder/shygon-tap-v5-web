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
