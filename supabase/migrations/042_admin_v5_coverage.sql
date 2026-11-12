-- ============================================================================
-- 042 — ADMIN APK: COVERAGE OF THE V5 FEATURES SHIPPED AFTER THE ADMIN PLATFORM
-- ============================================================================
-- Run AFTER 001–019 (the V5 baseline, tag v5-baseline). Number 042 was agreed
-- with the V6 backend session on 2026-11-11; V6 continues from 043.
--
-- WHY THIS EXISTS
--   The admin platform (003, applied to live as 013) was written against the
--   schema of migrations 001–003. V5 then shipped 004–019, and the Admin APK
--   could see none of it:
--     006  fulfilment GRANT state — a paid customer whose purchase failed to be
--          granted ('retry') was invisible on the dashboard and in the queue
--     004  Tap status (draft/active/paused/archived) and the 14-day edit window
--     005  seasonal event themes
--     009  the per-line-item fulfilment ledger
--     015  card OTP activation attempts
--     017  limited-edition counters
--
-- WHAT THIS DOES NOT DO — deliberately
--   * It REPLACES NO EXISTING FUNCTION. Every object below is new. The admin
--     contract freezes the names and return shapes of the existing admin RPCs
--     (admin_get_order, admin_get_customer, admin_get_tap, admin_update_card
--     and the rest); changing one needs a decision and a contract bump. New
--     functions change nothing that any existing caller — the Admin APK, the V6
--     branches, or the corporate website on the same project — depends on.
--   * It CREATES NO TABLE. Read paths plus one audited toggle (event-theme
--     active). The only DDL is section 0b: five card columns declared
--     ADD COLUMN IF NOT EXISTS. They ALREADY EXIST on live — so on live every
--     one of those statements is a no-op — but no migration ever created them,
--     which is drift this file closes rather than works around (see 0b).
--   * It never returns card_otp_challenges.code_hash, and never returns a Tap's
--     personal content (custom_links, youtube, company, designation): an
--     operator needs a Tap's state, not its owner's links.
--   * It touches none of the objects the second (corporate) app owns
--     (shygontap_profiles, tap_card_features, tap_page_edit_state, …).
--
-- SECURITY MODEL — unchanged from 003/013
--   Every function opens with require_admin('<permission>'), which resolves
--   auth.uid() -> admin_users -> role -> permission inside this transaction and
--   raises 42501 otherwise. When V6's 040 (admin MFA) lands, require_admin also
--   demands aal2, and every function here inherits that with no change.
--   EXECUTE is revoked from PUBLIC and anon; granted to authenticated only.
--
-- Idempotent: CREATE OR REPLACE of new names only. Safe to re-run.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN WITHOUT WHAT THIS READS
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_name    TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'orders', 'order_items', 'cards', 'tap_profiles', 'admin_users',
    'tap_event_themes', 'order_item_fulfillment_actions',
    'card_otp_challenges', 'card_editions'
  ] LOOP
    IF to_regclass('public.' || v_name) IS NULL THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF to_regprocedure('public.require_admin(text)') IS NULL THEN
    v_missing := v_missing || 'require_admin(text) [migration 003/013]'::text;
  END IF;
  IF to_regprocedure('public.admin_audit(uuid,text,text,text,jsonb)') IS NULL THEN
    v_missing := v_missing || 'admin_audit(...) [migration 003/013]'::text;
  END IF;
  IF to_regprocedure('public.tap_edit_interval_days()') IS NULL THEN
    v_missing := v_missing || 'tap_edit_interval_days() [migration 004]'::text;
  END IF;

  -- Columns 006 and 004 add. Checked by name so a project that skipped them
  -- fails here, legibly, instead of at the first call.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'orders'
                   AND column_name = 'fulfillment_status') THEN
    v_missing := v_missing || 'orders.fulfillment_status [migration 006]'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tap_profiles'
                   AND column_name = 'status') THEN
    v_missing := v_missing || 'tap_profiles.status [migration 004]'::text;
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot install 042: missing % . Apply the V5 baseline (001–019) first.',
      array_to_string(v_missing, ', ');
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 0b. CLOSE THE CARD-ACTIVATION DRIFT BETWEEN LIVE AND THE MIGRATIONS
-- ---------------------------------------------------------------------------
-- The live project was built partly outside these migrations (see 013's
-- header). Its cards table has five activation columns that NO migration
-- creates. 015's card_apply_verified_action() reads and writes all five, and
-- section 1 below reads three of them. On live that works, because the
-- columns are there. On any database built from the migrations — a staging
-- project, a fresh dev environment, a disaster-recovery rebuild — 015's
-- activation function and this file's admin_attention() both fail at runtime
-- with "column does not exist". PL/pgSQL does not check column references when
-- a function is created, only when it runs, so that failure would not appear
-- until a customer tried to activate a card.
--
-- Declaring them here, IF NOT EXISTS, makes the chain self-consistent. The
-- types are copied exactly from the captured live baseline
-- (supabase/baseline/000_live_baseline.sql, commit 441c152), so a rebuilt
-- database matches live. On live each statement is a no-op.
--
-- Deliberately NOT declared: cards.activation_code. Live has it as
-- `text NOT NULL` with no default, so adding it would fail on any existing
-- row, and nothing in the migrations needs it; propagating a plaintext
-- activation code into new environments is not something to do in passing.
-- nickname and card_slot are also left out: no SQL reads them.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activated_at          TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS deactivated_at        TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activation_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last_activation_at    TIMESTAMPTZ;


-- ---------------------------------------------------------------------------
-- 1. WHAT NEEDS ATTENTION, IN V5 TERMS
-- ---------------------------------------------------------------------------
-- A companion to admin_dashboard(), not a replacement: the APK reads both and
-- merges them. The headline is grant failure — money taken, purchase not
-- given — which admin_dashboard() cannot see because it predates 006.
--
-- "Stuck" uses 15 minutes: fulfilment normally completes in the same request
-- as payment verification, and the retry worker runs well inside that, so a
-- paid order still pending/processing after 15 minutes is not in flight — it
-- has stalled.
CREATE OR REPLACE FUNCTION public.admin_attention()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('analytics.read');

  SELECT jsonb_build_object(
    'generated_at', now(),

    'grants', (SELECT jsonb_build_object(
        'retry',   count(*) FILTER (WHERE o.fulfillment_status = 'retry'),
        'stuck',   count(*) FILTER (WHERE o.fulfillment_status IN ('pending', 'processing')
                                      AND o.updated_at < now() - INTERVAL '15 minutes'),
        'in_flight', count(*) FILTER (WHERE o.fulfillment_status IN ('pending', 'processing')
                                        AND o.updated_at >= now() - INTERVAL '15 minutes'),
        'oldest_failing_since', min(o.updated_at) FILTER (
            WHERE o.fulfillment_status = 'retry'
               OR (o.fulfillment_status IN ('pending', 'processing')
                   AND o.updated_at < now() - INTERVAL '15 minutes')))
      FROM public.orders o
      WHERE o.payment_status = 'paid'),

    -- Cards a customer was given a window to activate and did not.
    'activation', (SELECT jsonb_build_object(
        'window_expired', count(*) FILTER (WHERE c.activated_at IS NULL
                                             AND c.deactivated_at IS NULL
                                             AND c.activation_expires_at < now()),
        'window_open',    count(*) FILTER (WHERE c.activated_at IS NULL
                                             AND c.deactivated_at IS NULL
                                             AND c.activation_expires_at >= now()))
      FROM public.cards c),

    -- A customer who hit the attempt limit in the last day is usually on the
    -- phone to support next. 5 mirrors MAX_ATTEMPTS in
    -- netlify/functions/card-otp.mjs; change both together.
    'otp_lockouts_24h', (SELECT count(*) FROM public.card_otp_challenges ch
                         WHERE ch.attempts >= 5
                           AND ch.consumed_at IS NULL
                           AND ch.created_at >= now() - INTERVAL '24 hours'),

    'taps_by_status', (SELECT COALESCE(jsonb_object_agg(s.status, s.n), '{}'::jsonb)
                       FROM (SELECT COALESCE(t.status, 'draft') AS status, count(*) AS n
                             FROM public.tap_profiles t GROUP BY 1) s),

    'event_theme_now', (SELECT jsonb_build_object(
                            'code', th.code, 'name', th.name, 'ends_on', th.ends_on)
                        FROM public.tap_event_themes th
                        WHERE th.active
                          AND current_date BETWEEN th.starts_on AND th.ends_on
                        ORDER BY th.priority DESC, th.starts_on DESC
                        LIMIT 1)
  ) INTO v_out;

  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------------
-- 2. THE ORDER QUEUE, WITH THE GRANT STATE
-- ---------------------------------------------------------------------------
-- A superset of admin_list_orders(): same filters and paging, plus a grant
-- filter and the 006/019 columns on every row. admin_list_orders() is left
-- exactly as it is.
--
-- p_fulfillment_status accepts any 006 value, or 'needs_attention' — the
-- queue an operator actually works: paid, and not fulfilled.
CREATE OR REPLACE FUNCTION public.admin_list_orders_v5(
  p_search             TEXT DEFAULT NULL,
  p_payment_status     TEXT DEFAULT NULL,
  p_order_status       TEXT DEFAULT NULL,
  p_fulfillment_status TEXT DEFAULT NULL,
  p_limit              INT  DEFAULT 25,
  p_offset             INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_grant  TEXT := NULLIF(btrim(COALESCE(p_fulfillment_status, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  IF v_grant IS NOT NULL
     AND v_grant NOT IN ('pending', 'processing', 'retry', 'fulfilled', 'needs_attention') THEN
    RAISE EXCEPTION 'Unknown fulfilment filter "%".', v_grant USING ERRCODE = '22023';
  END IF;

  WITH filtered AS (
    SELECT o.*, pr.full_name, pr.email AS customer_email
    FROM public.orders o
    LEFT JOIN public.profiles pr ON pr.id = o.user_id
    WHERE (p_payment_status IS NULL OR o.payment_status = p_payment_status)
      AND (p_order_status   IS NULL OR o.order_status   = p_order_status)
      AND (v_grant IS NULL
           OR (v_grant = 'needs_attention'
               AND o.payment_status = 'paid'
               AND o.fulfillment_status IS DISTINCT FROM 'fulfilled')
           OR o.fulfillment_status = v_grant)
      AND (v_q IS NULL
           OR o.order_id          ILIKE '%' || v_q || '%'
           OR o.product_name      ILIKE '%' || v_q || '%'
           OR pr.full_name        ILIKE '%' || v_q || '%'
           OR pr.email            ILIKE '%' || v_q || '%'
           OR o.tracking_number   ILIKE '%' || v_q || '%'
           OR o.razorpay_order_id ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id,
        'reference', f.order_id,
        'user_id', f.user_id,
        'customer_name', f.full_name,
        'customer_email', f.customer_email,
        'product_name', f.product_name,
        'order_type', f.order_type,
        'amount_in_paise', f.amount_in_paise,
        'payment_status', f.payment_status,
        'order_status', f.order_status,
        'fulfillment_status', f.fulfillment_status,
        'fulfilled_at', f.fulfilled_at,
        'confirmation_sms_status', f.confirmation_sms_status,
        'tracking_number', f.tracking_number,
        'shipping_carrier', f.shipping_carrier,
        'shipping_city', f.shipping_city,
        'created_at', f.created_at,
        'updated_at', f.updated_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


-- ---------------------------------------------------------------------------
-- 3. THE PER-LINE-ITEM FULFILMENT LEDGER (009)
-- ---------------------------------------------------------------------------
-- order_item_fulfillment_actions records each side effect once per line item
-- (its primary key is (order_item_id, action)). For an order whose grant is
-- in 'retry', this is the answer to "which part failed?": the items that have
-- an action recorded got it; the ones without did not.
CREATE OR REPLACE FUNCTION public.admin_order_item_actions(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('orders.read');

  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id) THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'order_item_id', i.id,
      'sku', i.sku,
      'name', i.name,
      'product_type', i.product_type,
      'quantity', i.quantity,
      'actions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('action', a.action, 'at', a.created_at)
                         ORDER BY a.created_at)
        FROM public.order_item_fulfillment_actions a
        WHERE a.order_item_id = i.id), '[]'::jsonb)
    ) ORDER BY i.created_at)
    FROM public.order_items i
    WHERE i.order_id = p_order_id
  ), '[]'::jsonb);
END;
$$;


-- ---------------------------------------------------------------------------
-- 4. A TAP'S V5 STATE (004)
-- ---------------------------------------------------------------------------
-- Companion to admin_get_tap(), which predates 004 and returns neither status
-- nor the edit window. Returns state only. The owner's personal content
-- (custom_links, youtube, company, designation) is deliberately absent:
-- operating a Tap does not require reading what its owner wrote on it.
CREATE OR REPLACE FUNCTION public.admin_tap_state(p_tap_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('tap.read');

  SELECT jsonb_build_object(
    'id', t.id,
    'status', COALESCE(t.status, 'draft'),
    'suspended_at', t.suspended_at,
    'last_content_edit_at', t.last_content_edit_at,
    'edit_window_started_at', t.edit_window_started_at,
    'edit_interval_days', public.tap_edit_interval_days(),
    -- Server-side so the app and the customer's own edit rule agree exactly.
    'next_edit_at', CASE WHEN t.last_content_edit_at IS NULL THEN NULL
                         ELSE t.last_content_edit_at
                              + make_interval(days => public.tap_edit_interval_days()) END,
    'theme', jsonb_build_object(
      'palette', t.theme_palette, 'layout', t.theme_layout,
      'buttons', t.theme_buttons, 'font', t.theme_font,
      'animation', t.theme_animation)
  ) INTO v_out
  FROM public.tap_profiles t
  WHERE t.id = p_tap_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Tap profile not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


-- ---------------------------------------------------------------------------
-- 5. CARD ACTIVATION ATTEMPTS (015)
-- ---------------------------------------------------------------------------
-- "My code doesn't work" is the commonest activation call. This shows support
-- what happened — how many tries, whether it expired, whether it was used —
-- and never the code: code_hash is not selected, and nothing here could be
-- used to activate a card.
CREATE OR REPLACE FUNCTION public.admin_card_activation_attempts(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('customers.read');

  IF NOT EXISTS (SELECT 1 FROM public.cards WHERE id = p_card_id) THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', ch.id,
      'action', ch.action,
      'attempts', ch.attempts,
      'max_attempts', 5,   -- MAX_ATTEMPTS in netlify/functions/card-otp.mjs
      'created_at', ch.created_at,
      'expires_at', ch.expires_at,
      'consumed_at', ch.consumed_at,
      'outcome', CASE
                   WHEN ch.consumed_at IS NOT NULL THEN 'succeeded'
                   WHEN ch.attempts >= 5            THEN 'locked_out'
                   WHEN ch.expires_at < now()       THEN 'expired'
                   ELSE 'open'
                 END
    ) ORDER BY ch.created_at DESC)
    FROM (SELECT * FROM public.card_otp_challenges
          WHERE card_id = p_card_id
          ORDER BY created_at DESC
          LIMIT 20) ch
  ), '[]'::jsonb);
END;
$$;


-- ---------------------------------------------------------------------------
-- 6. SEASONAL EVENT THEMES (005)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_event_themes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('tap.read');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', th.id, 'code', th.code, 'name', th.name,
      'starts_on', th.starts_on, 'ends_on', th.ends_on,
      'palette', th.palette, 'layout', th.layout, 'buttons', th.buttons,
      'font', th.font, 'animation', th.animation,
      'priority', th.priority, 'active', th.active,
      'in_window', current_date BETWEEN th.starts_on AND th.ends_on
    ) ORDER BY th.starts_on DESC, th.priority DESC)
    FROM public.tap_event_themes th
  ), '[]'::jsonb);
END;
$$;


-- Switching a theme on or off changes how EVERY public Tap renders for its
-- window, so it needs tap.moderate (owner/admin only) and is audited.
CREATE OR REPLACE FUNCTION public.admin_set_event_theme_active(
  p_theme_id UUID,
  p_active   BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('tap.moderate');
  v_code  TEXT;
  v_was   BOOLEAN;
BEGIN
  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Say whether the theme should be on or off.' USING ERRCODE = '22023';
  END IF;

  SELECT code, active INTO v_code, v_was
  FROM public.tap_event_themes WHERE id = p_theme_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event theme not found.' USING ERRCODE = 'P0002';
  END IF;

  -- No-op calls are not audited: re-saving the same value is not an action.
  IF v_was IS DISTINCT FROM p_active THEN
    UPDATE public.tap_event_themes
    SET active = p_active, updated_at = now()
    WHERE id = p_theme_id;

    PERFORM public.admin_audit(v_admin,
      CASE WHEN p_active THEN 'event_theme.enabled' ELSE 'event_theme.disabled' END,
      'event_theme', p_theme_id::text,
      jsonb_build_object('code', v_code));
  END IF;

  RETURN public.admin_list_event_themes();
END;
$$;


-- ---------------------------------------------------------------------------
-- 7. LIMITED-EDITION COUNTERS (017)
-- ---------------------------------------------------------------------------
-- card_editions is already public-readable (017), so this exposes nothing new;
-- it computes what an operator asks — which chapter is being sold now, and how
-- many numbers are left in it — so the APK does not re-derive the edition
-- arithmetic and get it subtly different from cards_assign_edition().
CREATE OR REPLACE FUNCTION public.admin_card_editions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('products.read');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'design', e.design,
      'name', e.name,
      'chapter_size', e.chapter_size,
      'issued', e.issued,
      -- The chapter the NEXT card will be numbered in.
      'current_chapter', (e.issued / e.chapter_size) + 1,
      'left_in_chapter', e.chapter_size - (e.issued % e.chapter_size),
      'updated_at', e.updated_at
    ) ORDER BY e.name)
    FROM public.card_editions e
  ), '[]'::jsonb);
END;
$$;


-- ---------------------------------------------------------------------------
-- 8. GRANTS
-- ---------------------------------------------------------------------------
-- Each function re-checks the caller internally, so EXECUTE alone grants
-- nothing; anon is still excluded so an unauthenticated caller cannot reach an
-- admin entry point at all.
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'admin_attention()',
    'admin_list_orders_v5(text,text,text,text,integer,integer)',
    'admin_order_item_actions(uuid)',
    'admin_tap_state(uuid)',
    'admin_card_activation_attempts(uuid)',
    'admin_list_event_themes()',
    'admin_set_event_theme_active(uuid,boolean)',
    'admin_card_editions()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_fn);
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 9. VERIFICATION (run after applying)
-- ---------------------------------------------------------------------------
--   -- every new function exists and none is executable by anon (expect 0)
--   SELECT count(*) FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) acl
--   JOIN pg_roles r ON r.oid = acl.grantee
--   WHERE n.nspname = 'public' AND r.rolname = 'anon'
--     AND p.proname IN ('admin_attention','admin_list_orders_v5',
--       'admin_order_item_actions','admin_tap_state',
--       'admin_card_activation_attempts','admin_list_event_themes',
--       'admin_set_event_theme_active','admin_card_editions');
--
--   -- as a signed-in owner: the V5 headline
--   SELECT public.admin_attention() -> 'grants';
-- ============================================================================
