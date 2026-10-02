--
-- PostgreSQL database dump
--

\restrict ICsbJ8Xnl9dEc6d5rap6E5VxBmFnOW9OvVTqJHxpPzANR5I4BsBNc1SfheWGu8i

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.6

-- Started on 2026-09-30 20:24:52

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 46 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- TOC entry 4434 (class 0 OID 0)
-- Dependencies: 46
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- TOC entry 484 (class 1255 OID 25929)
-- Name: account_events_from_entitlement(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.account_events_from_entitlement() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN
 IF TG_OP='UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN RETURN NEW; END IF;
 PERFORM public.log_account_event(NEW.user_id,CASE WHEN NEW.is_active THEN 'entitlement.granted' ELSE 'entitlement.revoked' END,'entitlement',NEW.id::text,jsonb_build_object('type',NEW.type,'key',NEW.key,'order',NEW.source_order_id)); RETURN NEW; END; $$;


--
-- TOC entry 483 (class 1255 OID 25927)
-- Name: account_events_from_order(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.account_events_from_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN
 IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN PERFORM public.log_account_event(NEW.user_id,'order.placed','order',NEW.id::text,jsonb_build_object('order_id',NEW.order_id,'amount_in_paise',NEW.amount_in_paise,'order_type',NEW.order_type)); RETURN NEW; END IF;
 IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN PERFORM public.log_account_event(NEW.user_id,'payment.'||NEW.payment_status,'order',NEW.id::text,jsonb_build_object('order_id',NEW.order_id,'razorpay_payment_id',NEW.razorpay_payment_id)); END IF;
 IF NEW.order_status IS DISTINCT FROM OLD.order_status THEN PERFORM public.log_account_event(NEW.user_id,'order.'||NEW.order_status,'order',NEW.id::text,jsonb_build_object('order_id',NEW.order_id,'tracking_number',NEW.tracking_number)); END IF;
 RETURN NEW; END; $$;


--
-- TOC entry 482 (class 1255 OID 25925)
-- Name: account_events_from_tap(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.account_events_from_tap() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN
 IF TG_OP='INSERT' THEN PERFORM public.log_account_event(NEW.user_id,'tap.created','tap',NEW.id::text,jsonb_build_object('slug',NEW.slug,'status',NEW.status)); RETURN NEW; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN PERFORM public.log_account_event(NEW.user_id,CASE NEW.status WHEN 'active' THEN 'tap.published' WHEN 'paused' THEN 'tap.paused' ELSE 'tap.status_changed' END,'tap',NEW.id::text,jsonb_build_object('from',OLD.status,'to',NEW.status,'slug',NEW.slug)); END IF;
 IF NEW.selected_ui_tier IS DISTINCT FROM OLD.selected_ui_tier THEN PERFORM public.log_account_event(NEW.user_id,'tap.experience_changed','tap',NEW.id::text,jsonb_build_object('from',OLD.selected_ui_tier,'to',NEW.selected_ui_tier)); END IF;
 IF NEW.last_content_edit_at IS DISTINCT FROM OLD.last_content_edit_at THEN PERFORM public.log_account_event(NEW.user_id,'tap.content_edited','tap',NEW.id::text,NULL); END IF;
 IF NEW.slug IS DISTINCT FROM OLD.slug THEN PERFORM public.log_account_event(NEW.user_id,'tap.address_changed','tap',NEW.id::text,jsonb_build_object('from',OLD.slug,'to',NEW.slug)); END IF;
 RETURN NEW; END; $$;


--
-- TOC entry 533 (class 1255 OID 50192)
-- Name: admin_add_email_domain(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_add_email_domain(p_domain text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  -- Accepts either 'shygon.com' or '@shygon.com' and normalises; typing the
  -- leading @ is the obvious mistake to make here.
  v_domain TEXT := lower(btrim(ltrim(btrim(COALESCE(p_domain, '')), '@')));
BEGIN
  IF v_domain !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'That is not a valid domain name.' USING ERRCODE = '22023';
  END IF;

  -- Adding a public mailbox provider would make the guardrail meaningless,
  -- because anybody in the world can create an address there in a minute.
  IF v_domain IN ('gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
                  'live.com', 'yahoo.com', 'yahoo.co.in', 'icloud.com',
                  'proton.me', 'protonmail.com', 'rediffmail.com', 'aol.com',
                  'mail.com', 'yandex.com', 'zoho.com') THEN
    RAISE EXCEPTION
      'Refusing to allow "%": anyone can create an address at a public mail provider, which would make this restriction meaningless. Use a domain your company controls.',
      v_domain
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_allowed_email_domains (domain, note, added_by)
  VALUES (v_domain, NULLIF(btrim(COALESCE(p_note, '')), ''), v_admin)
  ON CONFLICT (domain) DO UPDATE
    SET note = COALESCE(EXCLUDED.note, admin_allowed_email_domains.note);

  PERFORM public.admin_audit(v_admin, 'admin_domain.added', 'admin_domain', v_domain,
    jsonb_build_object('note', p_note));

  RETURN public.admin_list_email_domains();
END;
$_$;


--
-- TOC entry 521 (class 1255 OID 50179)
-- Name: admin_adjust_stock(text, integer, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_adjust_stock(p_sku text, p_delta integer, p_reason text DEFAULT 'admin_adjustment'::text, p_note text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('inventory.manage');
  v_after INT;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'Stock adjustment cannot be zero.' USING ERRCODE = '22023';
  END IF;
  IF abs(p_delta) > 100000 THEN
    RAISE EXCEPTION 'Stock adjustment is unreasonably large.' USING ERRCODE = '22023';
  END IF;
  IF p_reason NOT IN ('admin_adjustment', 'restock', 'correction', 'damage') THEN
    RAISE EXCEPTION 'Unknown stock movement reason "%".', p_reason USING ERRCODE = '22023';
  END IF;

  -- Single statement, so two admins adjusting at once cannot both read the same
  -- level and write it back.
  UPDATE public.products
  SET stock = greatest(0, COALESCE(stock, 0) + p_delta)
  WHERE sku = p_sku
  RETURNING stock INTO v_after;

  IF v_after IS NULL THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.inventory_movements (sku, delta, stock_after, reason, note, admin_id)
  VALUES (p_sku, p_delta, v_after, p_reason, NULLIF(btrim(COALESCE(p_note, '')), ''), v_admin);

  PERFORM public.admin_audit(v_admin, 'inventory.adjusted', 'product', p_sku,
    jsonb_build_object('delta', p_delta, 'stock_after', v_after, 'reason', p_reason));

  RETURN jsonb_build_object('sku', p_sku, 'stock', v_after);
END;
$$;


--
-- TOC entry 528 (class 1255 OID 50186)
-- Name: admin_analytics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_analytics(p_days integer DEFAULT 30) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_days  INT := least(greatest(COALESCE(p_days, 30), 1), 365);
  v_from  TIMESTAMPTZ := date_trunc('day', NOW()) - make_interval(days => v_days - 1);
BEGIN
  PERFORM public.require_admin('analytics.read');

  RETURN jsonb_build_object(
    'days', v_days,
    'from', v_from,

    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'day', d.day,
        'orders',              COALESCE(o.orders, 0),
        'paid_orders',         COALESCE(o.paid_orders, 0),
        'revenue_in_paise',    COALESCE(o.revenue, 0),
        'new_customers',       COALESCE(c.new_customers, 0),
        'tap_views',           COALESCE(t.views, 0),
        'tap_engagements',     COALESCE(t.engagements, 0)
      ) ORDER BY d.day)
      -- generate_series has no (date, date, interval) form; it returns
      -- timestamps, so the axis is cast back to date to join the daily rollups.
      FROM (SELECT g::date AS day
            FROM generate_series(v_from, date_trunc('day', NOW()), INTERVAL '1 day') g) d
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               count(*) AS orders,
               count(*) FILTER (WHERE payment_status = 'paid') AS paid_orders,
               COALESCE(sum(amount_in_paise) FILTER (WHERE payment_status = 'paid'), 0) AS revenue
        FROM public.orders WHERE created_at >= v_from GROUP BY 1
      ) o ON o.day = d.day
      LEFT JOIN (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS new_customers
        FROM public.profiles WHERE created_at >= v_from GROUP BY 1
      ) c ON c.day = d.day
      LEFT JOIN (
        SELECT (occurred_at AT TIME ZONE 'UTC')::date AS day,
               count(*) FILTER (WHERE event_type = 'view') AS views,
               count(*) FILTER (WHERE event_type IN ('nfc','qr','link_click')) AS engagements
        FROM public.tap_events WHERE occurred_at >= v_from GROUP BY 1
      ) t ON t.day = d.day
    ), '[]'::jsonb),

    'totals', (SELECT jsonb_build_object(
        'orders',           count(*),
        'paid_orders',      count(*) FILTER (WHERE payment_status = 'paid'),
        'failed_orders',    count(*) FILTER (WHERE payment_status = 'failed'),
        'cancelled_orders', count(*) FILTER (WHERE order_status = 'cancelled'),
        'revenue_in_paise', COALESCE(sum(amount_in_paise)
                              FILTER (WHERE payment_status = 'paid'), 0),
        -- Of the orders that were started in this window, how many were paid.
        -- This is payment completion, not storefront conversion: the storefront
        -- has no visit instrumentation, so true conversion is not computable.
        'payment_completion_rate', CASE WHEN count(*) = 0 THEN NULL
            ELSE round(100.0 * count(*) FILTER (WHERE payment_status = 'paid')
                       / count(*), 1) END)
      FROM public.orders WHERE created_at >= v_from),

    'top_products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'sku', s.sku, 'name', s.name, 'units', s.units,
        'revenue_in_paise', s.revenue) ORDER BY s.revenue DESC)
      FROM (
        SELECT oi.sku, max(oi.name) AS name,
               sum(oi.quantity) AS units,
               sum(oi.line_total_in_paise) AS revenue
        FROM public.order_items oi
        JOIN public.orders o ON o.id = oi.order_id
        WHERE o.payment_status = 'paid' AND o.created_at >= v_from
        GROUP BY oi.sku
        ORDER BY 4 DESC
        LIMIT 10
      ) s), '[]'::jsonb),

    'tier_distribution', (SELECT COALESCE(jsonb_object_agg(t.tier, t.n), '{}'::jsonb)
      FROM (
        SELECT COALESCE(best.ui_tier, 'free') AS tier, count(*) AS n
        FROM public.profiles p
        LEFT JOIN (
          SELECT e.user_id,
                 (array_agg(pl.ui_tier ORDER BY public.tier_rank(pl.ui_tier) DESC))[1]
                   AS ui_tier
          FROM public.entitlements e
          JOIN public.products pl ON pl.sku = 'plan-' || e.key
          WHERE e.is_active
            AND e.type IN ('digital_plan', 'lifetime')
            AND pl.ui_tier IS NOT NULL
          GROUP BY e.user_id
        ) best ON best.user_id = p.id
        GROUP BY 1
      ) t),

    'customizations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('key', e.key, 'count', e.n)
             ORDER BY e.n DESC)
      FROM (SELECT key, count(*) AS n FROM public.entitlements
            WHERE type = 'customization' AND is_active GROUP BY 1) e), '[]'::jsonb),

    'tap_engagement', (SELECT jsonb_build_object(
        'views',       count(*) FILTER (WHERE event_type = 'view'),
        'nfc_taps',    count(*) FILTER (WHERE event_type = 'nfc'),
        'qr_scans',    count(*) FILTER (WHERE event_type = 'qr'),
        'link_clicks', count(*) FILTER (WHERE event_type = 'link_click'),
        'active_profiles', count(DISTINCT tap_profile_id))
      FROM public.tap_events WHERE occurred_at >= v_from)
  );
END;
$$;


--
-- TOC entry 505 (class 1255 OID 50140)
-- Name: admin_audit(uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_audit(p_admin uuid, p_action text, p_entity_type text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (p_admin, p_action, p_entity_type, p_entity_id, p_metadata);
$$;


--
-- TOC entry 510 (class 1255 OID 50168)
-- Name: admin_cancel_order(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_cancel_order(p_order_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('orders.cancel');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_old    public.orders%ROWTYPE;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_old.order_status = 'delivered' THEN
    RAISE EXCEPTION 'A delivered order cannot be cancelled. Issue a refund instead.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET
    order_status        = 'cancelled',
    cancelled_at        = NOW(),
    cancellation_reason = v_reason
  WHERE id = p_order_id;

  UPDATE public.cards SET status = 'suspended'
  WHERE order_id = p_order_id AND status IN ('pending', 'shipped');

  -- Cancelling does NOT refund. The money side stays with the gateway and the
  -- Edge Function, so this can never silently look like the customer got paid
  -- back when they did not.
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  SELECT v_old.user_id, 'order', 'Order cancelled',
         'Order ' || COALESCE(v_old.order_id, '') || ' was cancelled. ' || v_reason,
         '/shygontap/orders', jsonb_build_object('order_id', p_order_id)
  WHERE v_old.user_id IS NOT NULL;

  PERFORM public.admin_audit(v_admin, 'order.cancelled', 'order', p_order_id::text,
    jsonb_build_object('reason', v_reason, 'previous_status', v_old.order_status));

  RETURN public.admin_get_order(p_order_id);
END;
$$;


--
-- TOC entry 506 (class 1255 OID 50163)
-- Name: admin_dashboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_dashboard() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('analytics.read');
  v_out   JSONB;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', NOW(),

    'customers', (SELECT jsonb_build_object(
        'total',    count(*),
        'new_7d',   count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '7 days'),
        'new_30d',  count(*) FILTER (WHERE p.created_at >= NOW() - INTERVAL '30 days'),
        'suspended',count(*) FILTER (WHERE p.suspended_at IS NOT NULL))
      FROM public.profiles p),

    'taps', (SELECT jsonb_build_object(
        'total',     count(*),
        'published', count(*) FILTER (WHERE t.published IS TRUE AND t.suspended_at IS NULL),
        'draft',     count(*) FILTER (WHERE t.published IS NOT TRUE AND t.suspended_at IS NULL),
        'suspended', count(*) FILTER (WHERE t.suspended_at IS NOT NULL))
      FROM public.tap_profiles t),

    'orders', (SELECT jsonb_build_object(
        'total',            count(*),
        'today',            count(*) FILTER (WHERE o.created_at >= date_trunc('day', NOW())),
        'pending_payment',  count(*) FILTER (WHERE o.payment_status = 'pending'),
        'failed_payment',   count(*) FILTER (WHERE o.payment_status = 'failed'),
        'paid',             count(*) FILTER (WHERE o.payment_status = 'paid'),
        'refunded',         count(*) FILTER (WHERE o.payment_status = 'refunded'),
        'awaiting_fulfilment', count(*) FILTER (
              WHERE o.payment_status = 'paid'
                AND o.order_status IN ('placed', 'processing', 'packed')),
        'processing',       count(*) FILTER (WHERE o.order_status = 'processing'),
        'packed',           count(*) FILTER (WHERE o.order_status = 'packed'),
        'shipped',          count(*) FILTER (WHERE o.order_status = 'shipped'),
        'out_for_delivery', count(*) FILTER (WHERE o.order_status = 'out_for_delivery'),
        'delivered',        count(*) FILTER (WHERE o.order_status = 'delivered'),
        'cancelled',        count(*) FILTER (WHERE o.order_status = 'cancelled'))
      FROM public.orders o),

    -- Derived from paid orders. There is no separate revenue ledger in this
    -- system and one is deliberately not invented here.
    'revenue', (SELECT jsonb_build_object(
        'lifetime_in_paise', COALESCE(sum(o.amount_in_paise), 0),
        'today_in_paise',    COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= date_trunc('day', NOW())), 0),
        'last_7d_in_paise',  COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= NOW() - INTERVAL '7 days'), 0),
        'last_30d_in_paise', COALESCE(sum(o.amount_in_paise)
                                FILTER (WHERE o.created_at >= NOW() - INTERVAL '30 days'), 0),
        'refunded_in_paise', COALESCE((SELECT sum(r.refund_amount_in_paise)
                                       FROM public.orders r
                                       WHERE r.refund_amount_in_paise IS NOT NULL), 0))
      FROM public.orders o WHERE o.payment_status = 'paid'),

    'inventory', (SELECT jsonb_build_object(
        'tracked_skus',  count(*),
        'units_on_hand', COALESCE(sum(pr.stock), 0),
        'low_stock',     count(*) FILTER (WHERE pr.stock > 0 AND pr.stock <= pr.low_stock_threshold),
        'out_of_stock',  count(*) FILTER (WHERE pr.stock <= 0))
      FROM public.products pr
      WHERE pr.stock IS NOT NULL AND pr.active IS NOT FALSE),

    -- The ORDER BY lives on the aggregate, not only on the subquery: without it
    -- jsonb_agg's row order is not guaranteed, so the scarcest item could stop
    -- appearing first.
    'low_stock_items', (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.stock ASC), '[]'::jsonb)
      FROM (
        SELECT pr.stock AS stock,
               jsonb_build_object(
                 'sku', pr.sku, 'name', pr.name,
                 'stock', pr.stock, 'threshold', pr.low_stock_threshold) AS x
        FROM public.products pr
        WHERE pr.stock IS NOT NULL
          AND pr.active IS NOT FALSE
          AND pr.stock <= pr.low_stock_threshold
        ORDER BY pr.stock ASC
        LIMIT 12
      ) s),

    'cards', (SELECT jsonb_build_object(
        'total',     count(*),
        'pending',   count(*) FILTER (WHERE c.status = 'pending'),
        'shipped',   count(*) FILTER (WHERE c.status = 'shipped'),
        'active',    count(*) FILTER (WHERE c.status = 'active'),
        'suspended', count(*) FILTER (WHERE c.status = 'suspended'))
      FROM public.cards c),

    'entitlements', (SELECT jsonb_build_object(
        'digital_plans',  count(*) FILTER (WHERE e.type = 'digital_plan'),
        'lifetime',       count(*) FILTER (WHERE e.type = 'lifetime'),
        'customizations', count(*) FILTER (WHERE e.type = 'customization'))
      FROM public.entitlements e WHERE e.is_active),

    -- Set-based rather than calling user_max_ui_tier() once per customer: the
    -- dashboard is the most frequently hit query in the whole app.
    'tier_distribution', (SELECT COALESCE(jsonb_object_agg(t.tier, t.n), '{}'::jsonb)
      FROM (
        SELECT COALESCE(best.ui_tier, 'free') AS tier, count(*) AS n
        FROM public.profiles p
        LEFT JOIN (
          SELECT e.user_id,
                 (array_agg(pl.ui_tier ORDER BY public.tier_rank(pl.ui_tier) DESC))[1]
                   AS ui_tier
          FROM public.entitlements e
          JOIN public.products pl ON pl.sku = 'plan-' || e.key
          WHERE e.is_active
            AND e.type IN ('digital_plan', 'lifetime')
            AND pl.ui_tier IS NOT NULL
          GROUP BY e.user_id
        ) best ON best.user_id = p.id
        GROUP BY 1
      ) t),

    'support', (SELECT jsonb_build_object(
        'open',              count(*) FILTER (WHERE s.status = 'open'),
        'awaiting_customer', count(*) FILTER (WHERE s.status = 'awaiting_customer'),
        'resolved',          count(*) FILTER (WHERE s.status = 'resolved'),
        'closed',            count(*) FILTER (WHERE s.status = 'closed'))
      FROM public.support_tickets s),

    'recent_orders', (SELECT COALESCE(jsonb_agg(s.x ORDER BY s.created_at DESC), '[]'::jsonb)
      FROM (
        SELECT o.created_at,
               jsonb_build_object(
                 'id', o.id, 'reference', o.order_id,
                 'customer_name', pr.full_name, 'product_name', o.product_name,
                 'amount_in_paise', o.amount_in_paise,
                 'payment_status', o.payment_status,
                 'order_status', o.order_status,
                 'created_at', o.created_at) AS x
        FROM public.orders o
        LEFT JOIN public.profiles pr ON pr.id = o.user_id
        ORDER BY o.created_at DESC
        LIMIT 8
      ) s)
  ) INTO v_out;

  UPDATE public.admin_users SET last_seen_at = NOW() WHERE user_id = v_admin;

  RETURN v_out;
END;
$$;


--
-- TOC entry 512 (class 1255 OID 50170)
-- Name: admin_get_customer(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_customer(p_user_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('customers.read');

  SELECT jsonb_build_object(
    -- Whitelisted. `profiles` also holds the customer's own social handles and
    -- bio, which administration does not require.
    'customer', jsonb_build_object(
      'id', p.id, 'full_name', p.full_name, 'email', p.email, 'phone', p.phone,
      'company', p.company, 'job_title', p.job_title, 'location', p.location,
      'created_at', p.created_at, 'suspended_at', p.suspended_at,
      'suspended_reason', p.suspended_reason,
      'ui_tier', public.user_max_ui_tier(p.id)),
    'tap', (SELECT jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'display_name', t.display_name,
        'published', t.published, 'published_at', t.published_at,
        'selected_ui_tier', t.selected_ui_tier,
        'enabled_customizations', t.enabled_customizations,
        'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
        'created_at', t.created_at)
      FROM public.tap_profiles t WHERE t.user_id = p.id),
    'entitlements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'type', e.type, 'key', e.key,
        'is_active', e.is_active, 'granted_at', e.granted_at,
        'source_order_id', e.source_order_id) ORDER BY e.granted_at DESC)
      FROM public.entitlements e WHERE e.user_id = p.id), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
      FROM public.cards c WHERE c.user_id = p.id), '[]'::jsonb),
    'orders', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', o.id, 'reference', o.order_id, 'product_name', o.product_name,
        'amount_in_paise', o.amount_in_paise, 'payment_status', o.payment_status,
        'order_status', o.order_status, 'created_at', o.created_at)
        ORDER BY o.created_at DESC)
      FROM public.orders o WHERE o.user_id = p.id), '[]'::jsonb),
    'tickets', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'reference', s.reference, 'subject', s.subject,
        'status', s.status, 'created_at', s.created_at) ORDER BY s.created_at DESC)
      FROM public.support_tickets s WHERE s.user_id = p.id), '[]'::jsonb)
  ) INTO v_out
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


--
-- TOC entry 508 (class 1255 OID 50166)
-- Name: admin_get_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_order(p_order_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  SELECT jsonb_build_object(
    'order', to_jsonb(o) - 'customer_id',
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


--
-- TOC entry 515 (class 1255 OID 50173)
-- Name: admin_get_tap(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_tap(p_tap_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('tap.read');

  SELECT jsonb_build_object(
    'tap', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'display_name', t.display_name,
      'headline', t.headline, 'bio', t.bio, 'avatar_url', t.avatar_url,
      'location', t.location, 'theme_color', t.theme_color,
      'published', t.published, 'published_at', t.published_at,
      'selected_ui_tier', t.selected_ui_tier,
      'entitled_ui_tier', public.user_max_ui_tier(t.user_id),
      'enabled_customizations', t.enabled_customizations,
      'suspended_at', t.suspended_at, 'suspended_reason', t.suspended_reason,
      'provisioned_at', t.provisioned_at, 'created_at', t.created_at,
      'user_id', t.user_id),
    'owner', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email,
        'suspended_at', pr.suspended_at)
      FROM public.profiles pr WHERE pr.id = t.user_id),
    'cards', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
      FROM public.cards c WHERE c.user_id = t.user_id), '[]'::jsonb),
    'engagement', (SELECT jsonb_build_object(
        'views',       count(*) FILTER (WHERE ev.event_type = 'view'),
        'nfc_taps',    count(*) FILTER (WHERE ev.event_type = 'nfc'),
        'qr_scans',    count(*) FILTER (WHERE ev.event_type = 'qr'),
        'link_clicks', count(*) FILTER (WHERE ev.event_type = 'link_click'),
        'last_event',  max(ev.occurred_at))
      FROM public.tap_events ev WHERE ev.tap_profile_id = t.id)
  ) INTO v_out
  FROM public.tap_profiles t
  WHERE t.id = p_tap_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Tap profile not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


--
-- TOC entry 525 (class 1255 OID 50183)
-- Name: admin_get_ticket(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_ticket(p_ticket_id uuid) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('support.read');

  SELECT jsonb_build_object(
    'ticket', to_jsonb(s),
    'customer', (SELECT jsonb_build_object(
        'id', pr.id, 'full_name', pr.full_name, 'email', pr.email, 'phone', pr.phone)
      FROM public.profiles pr WHERE pr.id = s.user_id),
    'order', (SELECT jsonb_build_object(
        'id', o.id, 'reference', o.order_id, 'product_name', o.product_name,
        'payment_status', o.payment_status, 'order_status', o.order_status)
      FROM public.orders o WHERE o.id = s.order_id),
    'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', m.id, 'author_role', m.author_role, 'body', m.body,
        'created_at', m.created_at,
        'author_name', COALESCE(au.display_name, cp.full_name))
        ORDER BY m.created_at)
      FROM public.support_messages m
      LEFT JOIN public.admin_users au ON au.user_id = m.author_id
                                      AND m.author_role = 'support'
      LEFT JOIN public.profiles cp    ON cp.id = m.author_id
                                      AND m.author_role = 'customer'
      WHERE m.ticket_id = s.id), '[]'::jsonb)
  ) INTO v_out
  FROM public.support_tickets s
  WHERE s.id = p_ticket_id;

  IF v_out IS NULL THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_out;
END;
$$;


--
-- TOC entry 517 (class 1255 OID 50175)
-- Name: admin_grant_entitlement(uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_grant_entitlement(p_user_id uuid, p_type text, p_key text, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('entitlements.grant');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_key    TEXT := lower(btrim(COALESCE(p_key, '')));
BEGIN
  IF p_type NOT IN ('digital_plan', 'lifetime', 'customization', 'card') THEN
    RAISE EXCEPTION 'Unknown entitlement type "%".', p_type USING ERRCODE = '22023';
  END IF;
  IF v_key = '' THEN
    RAISE EXCEPTION 'An entitlement key is required.' USING ERRCODE = '22023';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required when granting an entitlement by hand.'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  -- The key must correspond to something the catalog actually sells, so a typo
  -- cannot create an entitlement no renderer will ever recognise.
  IF p_type = 'digital_plan' AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE sku = 'plan-' || v_key AND product_type = 'digital_plan') THEN
    RAISE EXCEPTION 'No digital plan with key "%" exists in the catalog.', v_key
      USING ERRCODE = '22023';
  END IF;
  IF p_type = 'customization' AND NOT EXISTS (
      SELECT 1 FROM public.products WHERE sku = 'addon-' || v_key AND product_type = 'customization') THEN
    RAISE EXCEPTION 'No customization with key "%" exists in the catalog.', v_key
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.entitlements (user_id, type, key, is_active)
  VALUES (p_user_id, p_type, v_key, true)
  ON CONFLICT (user_id, type, key) DO UPDATE SET is_active = true;

  INSERT INTO public.notifications (user_id, category, title, body, link)
  VALUES (p_user_id, 'account', 'Your SHYGON Tap was upgraded',
          'A new feature has been added to your account. Your existing card keeps working.',
          '/shygontap/tap');

  PERFORM public.admin_audit(v_admin, 'entitlement.granted', 'customer', p_user_id::text,
    jsonb_build_object('type', p_type, 'key', v_key, 'reason', v_reason));

  RETURN public.admin_get_customer(p_user_id);
END;
$$;


--
-- TOC entry 503 (class 1255 OID 50136)
-- Name: admin_has(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_has(p_permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid()
      AND a.is_active
      AND (
        p_permission = ANY (public.admin_role_permissions(a.role))
        OR p_permission = ANY (a.permissions)
      )
  );
$$;


--
-- TOC entry 522 (class 1255 OID 50180)
-- Name: admin_inventory_history(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_inventory_history(p_sku text DEFAULT NULL::text, p_limit integer DEFAULT 50) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit INT := least(greatest(COALESCE(p_limit, 50), 1), 200);
BEGIN
  PERFORM public.require_admin('inventory.read');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'sku', m.sku, 'delta', m.delta, 'stock_after', m.stock_after,
      'reason', m.reason, 'note', m.note, 'created_at', m.created_at,
      'admin_name', au.display_name)
      ORDER BY m.created_at DESC)
    FROM (SELECT * FROM public.inventory_movements
          WHERE p_sku IS NULL OR sku = p_sku
          ORDER BY created_at DESC LIMIT v_limit) m
    LEFT JOIN public.admin_users au ON au.user_id = m.admin_id
  ), '[]'::jsonb);
END;
$$;


--
-- TOC entry 530 (class 1255 OID 50189)
-- Name: admin_list_admins(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_admins() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.require_admin('admins.manage');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', a.user_id, 'display_name', a.display_name,
      'email', p.email, 'role', a.role, 'permissions', a.permissions,
      'is_active', a.is_active, 'created_at', a.created_at,
      'last_seen_at', a.last_seen_at,
      'effective_permissions',
        public.admin_role_permissions(a.role) || a.permissions)
      ORDER BY a.created_at)
    FROM public.admin_users a
    LEFT JOIN public.profiles p ON p.id = a.user_id
  ), '[]'::jsonb);
END;
$$;


--
-- TOC entry 529 (class 1255 OID 50188)
-- Name: admin_list_audit(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_audit(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT := least(greatest(COALESCE(p_limit, 50), 1), 200);
  v_offset INT := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.require_admin('audit.read');

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.admin_audit_log),
    'limit', v_limit, 'offset', v_offset,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'action', a.action, 'entity_type', a.entity_type,
        'entity_id', a.entity_id, 'metadata', a.metadata,
        'created_at', a.created_at,
        'admin_name', COALESCE(au.display_name, 'Removed administrator'),
        'admin_role', au.role) ORDER BY a.created_at DESC)
      FROM (SELECT * FROM public.admin_audit_log
            ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) a
      LEFT JOIN public.admin_users au ON au.user_id = a.admin_id
    ), '[]'::jsonb));
END;
$$;


--
-- TOC entry 511 (class 1255 OID 50169)
-- Name: admin_list_customers(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_customers(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('customers.read');

  WITH filtered AS (
    SELECT p.id, p.full_name, p.email, p.phone, p.created_at, p.suspended_at
    FROM public.profiles p
    WHERE v_q IS NULL
       OR p.full_name ILIKE '%' || v_q || '%'
       OR p.email     ILIKE '%' || v_q || '%'
       OR p.phone     ILIKE '%' || v_q || '%'
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'full_name', f.full_name, 'email', f.email,
        'phone', f.phone, 'created_at', f.created_at,
        'suspended_at', f.suspended_at,
        'ui_tier', public.user_max_ui_tier(f.id),
        'order_count', (SELECT count(*) FROM public.orders o WHERE o.user_id = f.id),
        'paid_total_in_paise', COALESCE((SELECT sum(o.amount_in_paise)
            FROM public.orders o
            WHERE o.user_id = f.id AND o.payment_status = 'paid'), 0),
        'tap_slug', (SELECT t.slug FROM public.tap_profiles t WHERE t.user_id = f.id),
        'tap_published', (SELECT t.published IS TRUE AND t.suspended_at IS NULL
                          FROM public.tap_profiles t WHERE t.user_id = f.id)
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


--
-- TOC entry 532 (class 1255 OID 50191)
-- Name: admin_list_email_domains(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_email_domains() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  PERFORM public.require_admin('admins.manage');

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'domain', d.domain, 'note', d.note, 'created_at', d.created_at,
      'added_by_name', au.display_name) ORDER BY d.domain)
    FROM public.admin_allowed_email_domains d
    LEFT JOIN public.admin_users au ON au.user_id = d.added_by
  ), '[]'::jsonb);
END;
$$;


--
-- TOC entry 537 (class 1255 OID 50196)
-- Name: admin_list_notifications(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_notifications(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid    UUID := public.require_admin();
  v_limit  INT  := least(greatest(COALESCE(p_limit, 50), 1), 200);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  RETURN jsonb_build_object(
    'unread', (SELECT count(*) FROM public.admin_notifications n
               WHERE (n.admin_id IS NULL OR n.admin_id = v_uid)
                 AND NOT EXISTS (SELECT 1 FROM public.admin_notification_reads r
                                 WHERE r.notification_id = n.id AND r.admin_id = v_uid)),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', n.id, 'category', n.category, 'severity', n.severity,
        'title', n.title, 'body', n.body, 'link', n.link,
        'metadata', n.metadata, 'created_at', n.created_at,
        'read', EXISTS (SELECT 1 FROM public.admin_notification_reads r
                        WHERE r.notification_id = n.id AND r.admin_id = v_uid))
        ORDER BY n.created_at DESC)
      FROM (SELECT * FROM public.admin_notifications
            WHERE admin_id IS NULL OR admin_id = v_uid
            ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) n
    ), '[]'::jsonb));
END;
$$;


--
-- TOC entry 507 (class 1255 OID 50165)
-- Name: admin_list_orders(text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_orders(p_search text DEFAULT NULL::text, p_payment_status text DEFAULT NULL::text, p_order_status text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  -- Filtering and paging happen here, in the database. The APK never pulls a
  -- whole table down to filter it on the device.
  WITH filtered AS (
    SELECT o.*, pr.full_name, pr.email AS customer_email
    FROM public.orders o
    LEFT JOIN public.profiles pr ON pr.id = o.user_id
    WHERE (p_payment_status IS NULL OR o.payment_status = p_payment_status)
      AND (p_order_status   IS NULL OR o.order_status   = p_order_status)
      AND (v_q IS NULL
           OR o.order_id     ILIKE '%' || v_q || '%'
           OR o.product_name ILIKE '%' || v_q || '%'
           OR pr.full_name   ILIKE '%' || v_q || '%'
           OR pr.email       ILIKE '%' || v_q || '%'
           OR o.tracking_number ILIKE '%' || v_q || '%'
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


--
-- TOC entry 519 (class 1255 OID 50177)
-- Name: admin_list_products(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_products(p_type text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 100), 1), 200);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('products.read');

  WITH filtered AS (
    SELECT * FROM public.products pr
    WHERE (p_type IS NULL OR pr.product_type = p_type)
      AND (v_q IS NULL
           OR pr.name ILIKE '%' || v_q || '%'
           OR pr.sku  ILIKE '%' || v_q || '%'
           OR pr.category ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'sku', f.sku, 'name', f.name, 'category', f.category,
        'material', f.material, 'tier', f.tier, 'ui_tier', f.ui_tier,
        'price_in_paise', f.price_in_paise, 'product_type', f.product_type,
        'short_description', f.short_description, 'image_url', f.image_url,
        'stock', f.stock, 'low_stock_threshold', f.low_stock_threshold,
        'active', f.active, 'sort_order', f.sort_order,
        'units_sold', COALESCE((SELECT sum(oi.quantity)
            FROM public.order_items oi
            JOIN public.orders o ON o.id = oi.order_id
            WHERE oi.sku = f.sku AND o.payment_status = 'paid'), 0)
      ) ORDER BY f.sort_order NULLS LAST, f.name)
      FROM (SELECT * FROM filtered ORDER BY sort_order NULLS LAST, name
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


--
-- TOC entry 514 (class 1255 OID 50172)
-- Name: admin_list_taps(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_taps(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('tap.read');

  WITH filtered AS (
    SELECT t.*, pr.full_name AS owner_name, pr.email AS owner_email
    FROM public.tap_profiles t
    LEFT JOIN public.profiles pr ON pr.id = t.user_id
    WHERE (p_status IS NULL
           OR (p_status = 'published' AND t.published IS TRUE AND t.suspended_at IS NULL)
           OR (p_status = 'draft'     AND t.published IS NOT TRUE AND t.suspended_at IS NULL)
           OR (p_status = 'suspended' AND t.suspended_at IS NOT NULL))
      AND (v_q IS NULL
           OR t.slug         ILIKE '%' || v_q || '%'
           OR t.display_name ILIKE '%' || v_q || '%'
           OR pr.full_name   ILIKE '%' || v_q || '%'
           OR pr.email       ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'slug', f.slug, 'display_name', f.display_name,
        'headline', f.headline, 'user_id', f.user_id,
        'owner_name', f.owner_name, 'owner_email', f.owner_email,
        'published', f.published, 'published_at', f.published_at,
        'suspended_at', f.suspended_at,
        'selected_ui_tier', f.selected_ui_tier,
        'entitled_ui_tier', public.user_max_ui_tier(f.user_id),
        'created_at', f.created_at
      ) ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


--
-- TOC entry 524 (class 1255 OID 50182)
-- Name: admin_list_tickets(text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_list_tickets(p_status text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('support.read');

  WITH filtered AS (
    SELECT s.*, pr.full_name AS customer_name, pr.email AS customer_email
    FROM public.support_tickets s
    LEFT JOIN public.profiles pr ON pr.id = s.user_id
    WHERE (p_status IS NULL OR s.status = p_status)
      AND (v_q IS NULL
           OR s.reference ILIKE '%' || v_q || '%'
           OR s.subject   ILIKE '%' || v_q || '%'
           OR pr.full_name ILIKE '%' || v_q || '%'
           OR pr.email     ILIKE '%' || v_q || '%')
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'reference', f.reference, 'subject', f.subject,
        'category', f.category, 'status', f.status, 'order_id', f.order_id,
        'user_id', f.user_id, 'customer_name', f.customer_name,
        'customer_email', f.customer_email,
        'created_at', f.created_at, 'updated_at', f.updated_at,
        'message_count', (SELECT count(*) FROM public.support_messages m
                          WHERE m.ticket_id = f.id),
        'last_author', (SELECT m.author_role FROM public.support_messages m
                        WHERE m.ticket_id = f.id
                        ORDER BY m.created_at DESC LIMIT 1)
      ) ORDER BY f.updated_at DESC)
      FROM (SELECT * FROM filtered ORDER BY updated_at DESC
            LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit,
                            'offset', v_offset, 'rows', v_rows);
END;
$$;


--
-- TOC entry 538 (class 1255 OID 50197)
-- Name: admin_mark_notifications_read(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_mark_notifications_read(p_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := public.require_admin();
BEGIN
  INSERT INTO public.admin_notification_reads (notification_id, admin_id)
  SELECT n.id, v_uid
  FROM public.admin_notifications n
  WHERE (n.admin_id IS NULL OR n.admin_id = v_uid)
    AND (p_ids IS NULL OR n.id = ANY (p_ids))
  ON CONFLICT DO NOTHING;

  RETURN public.admin_list_notifications(50, 0);
END;
$$;


--
-- TOC entry 536 (class 1255 OID 50195)
-- Name: admin_me(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_me() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_out JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'user_id', a.user_id,
    'display_name', COALESCE(a.display_name, p.full_name),
    'email', p.email,
    'role', a.role,
    'is_active', a.is_active,
    'permissions', public.admin_role_permissions(a.role) || a.permissions,
    'created_at', a.created_at,
    'last_seen_at', a.last_seen_at
  ) INTO v_out
  FROM public.admin_users a
  LEFT JOIN public.profiles p ON p.id = a.user_id
  WHERE a.user_id = v_uid AND a.is_active;

  IF v_out IS NULL THEN
    -- Deliberately the same refusal a non-admin gets, with no hint about
    -- whether the account exists but is deactivated.
    RAISE EXCEPTION 'This account does not have administrator access.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.admin_users SET last_seen_at = NOW() WHERE user_id = v_uid;

  RETURN v_out;
END;
$$;


--
-- TOC entry 542 (class 1255 OID 50202)
-- Name: admin_notify_low_stock(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_notify_low_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.stock IS NULL OR OLD.stock IS NULL OR NEW.stock >= OLD.stock THEN
    RETURN NEW;
  END IF;

  -- Fires on the crossing only, so a product sitting below the threshold does
  -- not raise an alert on every single sale.
  IF NEW.stock <= NEW.low_stock_threshold AND OLD.stock > NEW.low_stock_threshold THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('inventory',
            CASE WHEN NEW.stock <= 0 THEN 'critical' ELSE 'warning' END,
            CASE WHEN NEW.stock <= 0 THEN 'Out of stock' ELSE 'Low stock' END,
            NEW.name || ' is down to ' || NEW.stock || ' unit(s).',
            '/inventory',
            jsonb_build_object('sku', NEW.sku, 'stock', NEW.stock));
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 543 (class 1255 OID 50204)
-- Name: admin_notify_new_ticket(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_notify_new_ticket() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('support', 'info', 'New support request',
          NEW.reference || ' — ' || NEW.subject,
          '/support/' || NEW.id::text,
          jsonb_build_object('ticket_id', NEW.id, 'reference', NEW.reference));
  RETURN NEW;
END;
$$;


--
-- TOC entry 541 (class 1255 OID 50200)
-- Name: admin_notify_order_event(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_notify_order_event() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_name TEXT;
BEGIN
  SELECT full_name INTO v_name FROM public.profiles WHERE id = NEW.user_id;

  IF TG_OP = 'UPDATE'
     AND NEW.payment_status = 'paid'
     AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('order', 'info',
            'New paid order — ' || chr(8377) ||
              to_char(COALESCE(NEW.amount_in_paise, 0) / 100.0, 'FM999999990D00'),
            COALESCE(v_name, 'A customer') || ' paid for ' ||
              COALESCE(NEW.product_name, 'an order') || '.',
            '/orders/' || NEW.id::text,
            jsonb_build_object('order_id', NEW.id, 'reference', NEW.order_id));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.payment_status = 'failed'
     AND OLD.payment_status IS DISTINCT FROM 'failed' THEN
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('payment', 'warning', 'Payment failed',
            'Payment failed for order ' || COALESCE(NEW.order_id, '') || '.',
            '/orders/' || NEW.id::text,
            jsonb_build_object('order_id', NEW.id));
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 544 (class 1255 OID 50206)
-- Name: admin_notify_ticket_reply(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_notify_ticket_reply() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_ref TEXT;
BEGIN
  IF NEW.author_role <> 'customer' THEN
    RETURN NEW;
  END IF;

  SELECT reference INTO v_ref FROM public.support_tickets WHERE id = NEW.ticket_id;

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('support', 'info', 'Customer replied',
          COALESCE(v_ref, 'A ticket') || ' has a new customer message.',
          '/support/' || NEW.ticket_id::text,
          jsonb_build_object('ticket_id', NEW.ticket_id));

  UPDATE public.support_tickets SET status = 'open'
  WHERE id = NEW.ticket_id AND status = 'awaiting_customer';

  RETURN NEW;
END;
$$;


--
-- TOC entry 539 (class 1255 OID 50198)
-- Name: admin_register_push_token(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_register_push_token(p_token text, p_platform text DEFAULT NULL::text, p_device text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_uid   UUID := public.require_admin();
  v_token TEXT := btrim(COALESCE(p_token, ''));
BEGIN
  -- Only Expo's own token shapes are stored, so a stray string can never end up
  -- being posted to the push service.
  IF v_token !~ '^(ExponentPushToken\[[^]]+\]|ExpoPushToken\[[^]]+\])$' THEN
    RAISE EXCEPTION 'That is not a valid Expo push token.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_push_tokens (admin_id, expo_token, platform, device_name)
  VALUES (v_uid, v_token, left(COALESCE(p_platform, ''), 32),
          left(COALESCE(p_device, ''), 120))
  ON CONFLICT (expo_token) DO UPDATE
    SET admin_id     = EXCLUDED.admin_id,
        platform     = EXCLUDED.platform,
        device_name  = EXCLUDED.device_name,
        last_seen_at = NOW(),
        revoked_at   = NULL;

  RETURN jsonb_build_object('registered', true);
END;
$_$;


--
-- TOC entry 534 (class 1255 OID 50193)
-- Name: admin_remove_email_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_remove_email_domain(p_domain text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  v_domain TEXT := lower(btrim(ltrim(btrim(COALESCE(p_domain, '')), '@')));
  v_left   INT;
BEGIN
  DELETE FROM public.admin_allowed_email_domains WHERE domain = v_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That domain is not on the list.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_left FROM public.admin_allowed_email_domains;

  PERFORM public.admin_audit(v_admin, 'admin_domain.removed', 'admin_domain', v_domain,
    -- Recorded explicitly, because removing the last entry silently turns the
    -- guardrail off and that must be visible in the log afterwards.
    jsonb_build_object('remaining', v_left,
                       'restriction_now_disabled', v_left = 0));

  RETURN public.admin_list_email_domains();
END;
$$;


--
-- TOC entry 526 (class 1255 OID 50184)
-- Name: admin_reply_ticket(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_reply_ticket(p_ticket_id uuid, p_body text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('support.respond');
  v_body  TEXT := btrim(COALESCE(p_body, ''));
  v_row   public.support_tickets%ROWTYPE;
BEGIN
  IF length(v_body) < 1 OR length(v_body) > 4000 THEN
    RAISE EXCEPTION 'A reply must be between 1 and 4000 characters.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'closed' THEN
    RAISE EXCEPTION 'This ticket is closed. Reopen it before replying.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.support_messages (ticket_id, author_id, author_role, body)
  VALUES (p_ticket_id, v_admin, 'support', v_body);

  UPDATE public.support_tickets SET status = 'awaiting_customer'
  WHERE id = p_ticket_id AND status = 'open';

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_row.user_id, 'account', 'SHYGON Support replied',
          'There is a new reply on ' || v_row.reference || '.',
          '/shygontap/support', jsonb_build_object('ticket_id', p_ticket_id));

  PERFORM public.admin_audit(v_admin, 'support.replied', 'ticket', p_ticket_id::text,
    jsonb_build_object('reference', v_row.reference));

  RETURN public.admin_get_ticket(p_ticket_id);
END;
$$;


--
-- TOC entry 518 (class 1255 OID 50176)
-- Name: admin_revoke_entitlement(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_entitlement(p_entitlement_id uuid, p_reason text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('entitlements.grant');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_row    public.entitlements%ROWTYPE;
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to revoke an entitlement.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.entitlements WHERE id = p_entitlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entitlement not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Deactivated, never deleted: an entitlement that came from a real payment is
  -- part of the order's history and must stay reconcilable.
  UPDATE public.entitlements SET is_active = false WHERE id = p_entitlement_id;

  PERFORM public.admin_audit(v_admin, 'entitlement.revoked', 'customer', v_row.user_id::text,
    jsonb_build_object('entitlement_id', p_entitlement_id, 'type', v_row.type,
                       'key', v_row.key, 'source_order_id', v_row.source_order_id,
                       'reason', v_reason));

  RETURN public.admin_get_customer(v_row.user_id);
END;
$$;


--
-- TOC entry 540 (class 1255 OID 50199)
-- Name: admin_revoke_push_token(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_revoke_push_token(p_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := public.require_admin();
BEGIN
  UPDATE public.admin_push_tokens
  SET revoked_at = NOW()
  WHERE expo_token = btrim(COALESCE(p_token, '')) AND admin_id = v_uid;

  RETURN jsonb_build_object('revoked', true);
END;
$$;


--
-- TOC entry 502 (class 1255 OID 50135)
-- Name: admin_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_role() RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT a.role FROM public.admin_users a
  WHERE a.user_id = auth.uid() AND a.is_active;
$$;


--
-- TOC entry 501 (class 1255 OID 50134)
-- Name: admin_role_permissions(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_role_permissions(p_role text) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE p_role
    WHEN 'owner' THEN ARRAY[
      'orders.read','orders.fulfil','orders.cancel','orders.refund',
      'customers.read','customers.manage',
      'tap.read','tap.moderate',
      'products.read','products.manage',
      'inventory.read','inventory.manage',
      'entitlements.read','entitlements.grant',
      'support.read','support.respond',
      'analytics.read','audit.read','admins.manage']
    -- 'admin' is everything an owner can do EXCEPT creating other admins.
    -- Privilege escalation is the one thing a day-to-day operator must not
    -- be able to do to themselves.
    WHEN 'admin' THEN ARRAY[
      'orders.read','orders.fulfil','orders.cancel','orders.refund',
      'customers.read','customers.manage',
      'tap.read','tap.moderate',
      'products.read','products.manage',
      'inventory.read','inventory.manage',
      'entitlements.read','entitlements.grant',
      'support.read','support.respond',
      'analytics.read','audit.read']
    WHEN 'fulfilment' THEN ARRAY[
      'orders.read','orders.fulfil',
      'customers.read','tap.read',
      'products.read','inventory.read','inventory.manage',
      'analytics.read']
    WHEN 'support' THEN ARRAY[
      'orders.read','customers.read','tap.read',
      'entitlements.read','support.read','support.respond',
      'products.read','analytics.read']
    WHEN 'viewer' THEN ARRAY[
      'orders.read','customers.read','tap.read','products.read',
      'inventory.read','entitlements.read','support.read','analytics.read']
    ELSE ARRAY[]::TEXT[]
  END;
$$;


--
-- TOC entry 535 (class 1255 OID 50194)
-- Name: admin_set_admin_active(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_admin_active(p_user_id uuid, p_active boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('admins.manage');
BEGIN
  -- Locking yourself out and leaving nobody able to unlock the account is not
  -- a recoverable state from a phone.
  IF p_user_id = v_admin AND NOT p_active THEN
    RAISE EXCEPTION 'You cannot deactivate your own administrator account.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT p_active AND (SELECT role FROM public.admin_users WHERE user_id = p_user_id) = 'owner'
     AND (SELECT count(*) FROM public.admin_users
          WHERE role = 'owner' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'This is the last active owner. Promote another owner first.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.admin_users
  SET is_active = p_active, updated_at = NOW()
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator not found.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_active THEN 'admin.activated' ELSE 'admin.deactivated' END,
    'admin', p_user_id::text, NULL);

  RETURN public.admin_list_admins();
END;
$$;


--
-- TOC entry 513 (class 1255 OID 50171)
-- Name: admin_set_customer_suspension(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('customers.manage');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF p_suspended AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to suspend an account.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END
  WHERE id = p_user_id;

  -- A suspended account's public Tap must come down with it.
  UPDATE public.tap_profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END,
    suspended_by     = CASE WHEN p_suspended THEN v_admin ELSE NULL END
  WHERE user_id = p_user_id;

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_suspended THEN 'customer.suspended' ELSE 'customer.reactivated' END,
    'customer', p_user_id::text, jsonb_build_object('reason', v_reason));

  RETURN public.admin_get_customer(p_user_id);
END;
$$;


--
-- TOC entry 468 (class 1255 OID 25822)
-- Name: admin_set_product_inventory(uuid, integer, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_product_inventory(p_product_id uuid, p_stock integer, p_active boolean DEFAULT NULL::boolean) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE='42501'; END IF;
  IF p_stock < 0 THEN RAISE EXCEPTION 'stock cannot be negative'; END IF;
  UPDATE public.products SET stock=p_stock, active=COALESCE(p_active,active) WHERE id=p_product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product not found'; END IF;
END; $$;


--
-- TOC entry 516 (class 1255 OID 50174)
-- Name: admin_set_tap_suspension(uuid, boolean, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_tap_suspension(p_tap_id uuid, p_suspended boolean, p_reason text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('tap.moderate');
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_user   UUID;
  v_slug   TEXT;
BEGIN
  IF p_suspended AND v_reason IS NULL THEN
    RAISE EXCEPTION 'A reason is required to suspend a Tap profile.' USING ERRCODE = '22023';
  END IF;

  SELECT user_id, slug INTO v_user, v_slug
  FROM public.tap_profiles WHERE id = p_tap_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tap profile not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.tap_profiles SET
    suspended_at     = CASE WHEN p_suspended THEN NOW() ELSE NULL END,
    suspended_reason = CASE WHEN p_suspended THEN v_reason ELSE NULL END,
    suspended_by     = CASE WHEN p_suspended THEN v_admin ELSE NULL END
  WHERE id = p_tap_id;

  -- The customer is told, so a Tap never silently stops resolving.
  INSERT INTO public.notifications (user_id, category, title, body, link)
  VALUES (v_user, 'tap',
    CASE WHEN p_suspended THEN 'Your Tap profile was suspended'
         ELSE 'Your Tap profile was restored' END,
    CASE WHEN p_suspended THEN v_reason
         ELSE 'Your Tap profile is available again.' END,
    '/shygontap/tap');

  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_suspended THEN 'tap.suspended' ELSE 'tap.restored' END,
    'tap', p_tap_id::text,
    jsonb_build_object('slug', v_slug, 'reason', v_reason));

  RETURN public.admin_get_tap(p_tap_id);
END;
$$;


--
-- TOC entry 527 (class 1255 OID 50185)
-- Name: admin_set_ticket_status(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_set_ticket_status(p_ticket_id uuid, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('support.respond');
  v_old   TEXT;
BEGIN
  IF p_status NOT IN ('open', 'awaiting_customer', 'resolved', 'closed') THEN
    RAISE EXCEPTION 'Unknown ticket status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT status INTO v_old FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.support_tickets SET status = p_status WHERE id = p_ticket_id;

  PERFORM public.admin_audit(v_admin, 'support.status_changed', 'ticket', p_ticket_id::text,
    jsonb_build_object('from', v_old, 'to', p_status));

  RETURN public.admin_get_ticket(p_ticket_id);
END;
$$;


--
-- TOC entry 523 (class 1255 OID 50181)
-- Name: admin_update_card(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_card(p_card_id uuid, p_status text DEFAULT NULL::text, p_card_uid text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_uid   TEXT := NULLIF(btrim(COALESCE(p_card_uid, '')), '');
  v_row   public.cards%ROWTYPE;
BEGIN
  IF p_status IS NOT NULL
     AND p_status NOT IN ('pending','shipped','active','suspended','replaced') THEN
    RAISE EXCEPTION 'Unknown card status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row FROM public.cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002';
  END IF;

  -- A chip identifier, once written, is physically fixed. Rewriting it would
  -- silently re-point a card that is already in a customer's wallet.
  IF v_uid IS NOT NULL AND v_row.card_uid IS NOT NULL AND v_row.card_uid <> v_uid THEN
    RAISE EXCEPTION 'This card already has a chip id. Issue a replacement instead.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.cards SET
    status   = COALESCE(p_status, status),
    card_uid = COALESCE(v_uid, card_uid)
  WHERE id = p_card_id;

  PERFORM public.admin_audit(v_admin, 'card.updated', 'card', p_card_id::text,
    jsonb_build_object('status', p_status, 'card_uid_set', v_uid IS NOT NULL));

  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id);
END;
$$;


--
-- TOC entry 467 (class 1255 OID 25821)
-- Name: admin_update_order_shipping(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_order_shipping(p_order_id uuid, p_order_status text, p_tracking_number text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'admin access required' USING ERRCODE='42501'; END IF;
  IF p_order_status NOT IN ('pending','processing','shipped','delivered','cancelled','refunded') THEN RAISE EXCEPTION 'invalid order status'; END IF;
  UPDATE public.orders SET order_status=p_order_status, tracking_number=NULLIF(btrim(p_tracking_number),'') WHERE id=p_order_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'order not found'; END IF;
END; $$;


--
-- TOC entry 509 (class 1255 OID 50167)
-- Name: admin_update_order_status(uuid, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text DEFAULT NULL::text, p_carrier text DEFAULT NULL::text, p_note text DEFAULT NULL::text) RETURNS jsonb
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
    admin_note       = COALESCE(NULLIF(btrim(COALESCE(p_note, '')), ''), admin_note),
    shipped_at       = CASE WHEN p_status = 'shipped'   AND shipped_at   IS NULL
                            THEN NOW() ELSE shipped_at END,
    delivered_at     = CASE WHEN p_status = 'delivered' AND delivered_at IS NULL
                            THEN NOW() ELSE delivered_at END
  WHERE id = p_order_id;

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


--
-- TOC entry 520 (class 1255 OID 50178)
-- Name: admin_update_product(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_update_product(p_sku text, p_patch jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_old   public.products%ROWTYPE;
  v_price INT;
BEGIN
  SELECT * INTO v_old FROM public.products WHERE sku = p_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_patch ? 'price_in_paise' THEN
    v_price := (p_patch ->> 'price_in_paise')::INT;
    IF v_price IS NULL OR v_price < 0 THEN
      RAISE EXCEPTION 'Price must be zero or more (in paise).' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_patch ? 'low_stock_threshold'
     AND (p_patch ->> 'low_stock_threshold')::INT < 0 THEN
    RAISE EXCEPTION 'The low stock threshold cannot be negative.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.products SET
    name              = COALESCE(p_patch ->> 'name', name),
    short_description = CASE WHEN p_patch ? 'short_description'
                             THEN p_patch ->> 'short_description' ELSE short_description END,
    description       = CASE WHEN p_patch ? 'description'
                             THEN p_patch ->> 'description' ELSE description END,
    image_url         = CASE WHEN p_patch ? 'image_url'
                             THEN p_patch ->> 'image_url' ELSE image_url END,
    badge             = CASE WHEN p_patch ? 'badge'
                             THEN p_patch ->> 'badge' ELSE badge END,
    -- Kept in sync: `price` (rupees) is what pre-existing code reads,
    -- `price_in_paise` is what the checkout charges. They must never diverge.
    price_in_paise    = COALESCE(v_price, price_in_paise),
    price             = CASE WHEN v_price IS NOT NULL
                             THEN v_price / 100.0 ELSE price END,
    active            = CASE WHEN p_patch ? 'active'
                             THEN (p_patch ->> 'active')::BOOLEAN ELSE active END,
    low_stock_threshold = CASE WHEN p_patch ? 'low_stock_threshold'
                             THEN (p_patch ->> 'low_stock_threshold')::INT
                             ELSE low_stock_threshold END,
    sort_order        = CASE WHEN p_patch ? 'sort_order'
                             THEN (p_patch ->> 'sort_order')::INT ELSE sort_order END
  WHERE sku = p_sku;

  PERFORM public.admin_audit(v_admin, 'product.updated', 'product', p_sku,
    jsonb_build_object(
      'patch', p_patch,
      'previous', jsonb_build_object('name', v_old.name,
                                     'price_in_paise', v_old.price_in_paise,
                                     'active', v_old.active)));

  RETURN (SELECT to_jsonb(pr) FROM public.products pr WHERE pr.sku = p_sku);
END;
$$;


--
-- TOC entry 531 (class 1255 OID 50190)
-- Name: admin_upsert_admin(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_upsert_admin(p_email text, p_role text, p_display_name text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_admin  UUID := public.require_admin('admins.manage');
  v_email  TEXT := lower(btrim(COALESCE(p_email, '')));
  v_target UUID;
  v_old    TEXT;
BEGIN
  IF p_role NOT IN ('owner', 'admin', 'fulfilment', 'support', 'viewer') THEN
    RAISE EXCEPTION 'Unknown role "%".', p_role USING ERRCODE = '22023';
  END IF;

  -- The company-domain guardrail (section 1b). Skipped entirely when no domain
  -- has been configured, which is the documented "not set up yet" state.
  IF EXISTS (SELECT 1 FROM public.admin_allowed_email_domains) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.admin_allowed_email_domains d
      WHERE d.domain = lower(split_part(v_email, '@', 2))
    ) THEN
      RAISE EXCEPTION
        'Administrator accounts must use a company email address (%). "%" is not on the approved list.',
        (SELECT string_agg('@' || domain, ', ' ORDER BY domain)
         FROM public.admin_allowed_email_domains),
        v_email
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT u.id INTO v_target FROM auth.users u WHERE lower(u.email) = v_email;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'No SHYGON account exists for %. Ask them to sign up first.', v_email
      USING ERRCODE = 'P0002';
  END IF;

  IF v_target = v_admin THEN
    RAISE EXCEPTION 'You cannot change your own role.' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_old FROM public.admin_users WHERE user_id = v_target;

  IF v_old = 'owner' AND p_role <> 'owner'
     AND (SELECT count(*) FROM public.admin_users WHERE role = 'owner' AND is_active) <= 1 THEN
    RAISE EXCEPTION 'This is the last active owner. Promote another owner first.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_users (user_id, role, display_name, is_active)
  VALUES (v_target, p_role,
          NULLIF(btrim(COALESCE(p_display_name, '')), ''), true)
  ON CONFLICT (user_id) DO UPDATE
    SET role         = EXCLUDED.role,
        -- Unqualified on purpose: ON CONFLICT resolves the bare table name to
        -- the existing row; a schema-qualified reference is a syntax error here.
        display_name = COALESCE(EXCLUDED.display_name, admin_users.display_name),
        is_active    = true,
        updated_at   = NOW();

  PERFORM public.admin_audit(v_admin,
    CASE WHEN v_old IS NULL THEN 'admin.created' ELSE 'admin.role_changed' END,
    'admin', v_target::text,
    jsonb_build_object('email', v_email, 'from', v_old, 'to', p_role));

  RETURN public.admin_list_admins();
END;
$$;


--
-- TOC entry 469 (class 1255 OID 25880)
-- Name: canonical_experience(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_experience(p_tier text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE lower(btrim(COALESCE(p_tier, '')))
    WHEN 'goat' THEN 'goat' WHEN '3d' THEN 'goat' WHEN 'custom' THEN 'goat'
    WHEN 'premium' THEN 'premium' WHEN 'business' THEN 'business' WHEN 'pro' THEN 'business'
    WHEN 'essential' THEN 'essential' WHEN 'free' THEN 'essential' ELSE 'essential' END;
$$;


--
-- TOC entry 545 (class 1255 OID 50259)
-- Name: card_apply_verified_action(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_apply_verified_action(p_user_id uuid, p_card_id uuid, p_action text) RETURNS TABLE(id uuid, status text, activated_at timestamp with time zone, activation_expires_at timestamp with time zone, deactivated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_card  public.cards%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
  v_name  TEXT;
  v_label TEXT;
BEGIN
  SELECT * INTO v_card
  FROM public.cards c
  WHERE c.id = p_card_id AND c.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_card.status = 'replaced' THEN
    RAISE EXCEPTION 'This card has been replaced' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'activate' THEN
    UPDATE public.cards c
    SET status = 'active',
        activated_at = v_now,
        last_activation_at = v_now,
        activation_expires_at = v_now + interval '14 days',
        activation_count = COALESCE(c.activation_count, 0) + 1,
        deactivated_at = NULL
    WHERE c.id = v_card.id;
  ELSIF p_action = 'deactivate' THEN
    IF v_card.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Card is not active' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cards c
    SET status = 'suspended',
        deactivated_at = v_now
    WHERE c.id = v_card.id;
  ELSE
    RAISE EXCEPTION 'Unknown card action' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), 'A customer')
  INTO v_name
  FROM public.profiles p
  WHERE p.id = p_user_id;
  v_name := COALESCE(v_name, 'A customer');
  v_label := COALESCE(NULLIF(btrim(v_card.card_uid), ''), 'card ' || left(v_card.id::text, 8));

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (
    p_user_id,
    'tap',
    CASE WHEN p_action = 'activate' THEN 'Card activated' ELSE 'Card deactivated' END,
    CASE WHEN p_action = 'activate'
      THEN 'Your card ' || v_label || ' is active and opens your Tap.'
      ELSE 'Your card ' || v_label || ' is deactivated. Tapping it no longer opens your Tap.'
    END,
    '/shygontap/cards',
    jsonb_build_object('card_id', v_card.id, 'action', p_action, 'verified_by', 'sms_otp')
  );

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES (
    'tap',
    CASE WHEN p_action = 'deactivate' THEN 'warning' ELSE 'info' END,
    CASE WHEN p_action = 'activate' THEN 'Customer activated a card' ELSE 'Customer deactivated a card' END,
    v_name || ' ' || CASE WHEN p_action = 'activate' THEN 'activated' ELSE 'deactivated' END
      || ' ' || v_label || ', confirmed by SMS one-time password.',
    '/customers/' || p_user_id::text,
    jsonb_build_object('card_id', v_card.id, 'user_id', p_user_id, 'action', p_action, 'verified_by', 'sms_otp')
  );

  RETURN QUERY
  SELECT c.id, c.status::text, c.activated_at, c.activation_expires_at, c.deactivated_at
  FROM public.cards c
  WHERE c.id = v_card.id;
END;
$$;


--
-- TOC entry 546 (class 1255 OID 50274)
-- Name: card_design_of(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.card_design_of(p_sku text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$');
$_$;


--
-- TOC entry 547 (class 1255 OID 50275)
-- Name: cards_assign_edition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cards_assign_edition() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_design text;
  v_qty    integer := 1;
  v_first  integer;
  v_size   integer;
BEGIN
  IF NEW.edition_serial IS NOT NULL OR COALESCE(NEW.is_replacement, false) THEN
    RETURN NEW;
  END IF;

  v_design := public.card_design_of(NEW.sku);
  IF v_design IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.order_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('card-edition:' || NEW.order_id::text || ':' || NEW.sku));
    IF EXISTS (SELECT 1 FROM public.cards c WHERE c.order_id = NEW.order_id AND c.sku = NEW.sku) THEN
      RETURN NEW;
    END IF;
    SELECT GREATEST(1, COALESCE(SUM(oi.quantity), 1))::integer INTO v_qty
    FROM public.order_items oi
    WHERE oi.order_id = NEW.order_id AND oi.sku = NEW.sku;
  END IF;

  UPDATE public.card_editions
  SET issued = issued + v_qty, updated_at = now()
  WHERE design = v_design
  RETURNING issued - v_qty + 1, chapter_size INTO v_first, v_size;
  IF v_first IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.edition_design := v_design;
  NEW.edition_serial := v_first;
  NEW.edition_count := v_qty;
  NEW.edition_chapter_size := v_size;
  RETURN NEW;
END;
$$;


--
-- TOC entry 497 (class 1255 OID 49965)
-- Name: cards_issue_activation_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cards_issue_activation_code() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.activation_code IS NULL OR btrim(NEW.activation_code) = '' THEN
    NEW.activation_code := 'SHY-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4)) || '-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 4));
  END IF;
  RETURN NEW;
END;
$$;


--
-- TOC entry 462 (class 1255 OID 25798)
-- Name: claim_tap_slug(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_tap_slug(p_slug text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_slug TEXT := lower(btrim(p_slug));
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' THEN
    RAISE EXCEPTION 'A Tap address must be 3-40 characters: lowercase letters, numbers and hyphens.'
      USING ERRCODE = '22023';
  END IF;

  IF v_slug IN (
    'admin', 'api', 'auth', 'account', 'shygontap', 'store', 'checkout',
    'orders', 'settings', 'support', 'tap', 'www', 'tiers', 'customize',
    'qr', 'cards', 'customizations', 'notifications', 'analytics',
    'privacy-policy', 'terms', 'cookie-policy', 'refund-policy', 'shipping-policy'
  ) THEN
    RAISE EXCEPTION 'That Tap address is reserved.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tap_profiles
    WHERE lower(slug) = v_slug AND user_id <> auth.uid()
  ) THEN
    RAISE EXCEPTION 'That Tap address is already taken.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.tap_profiles SET slug = v_slug, username = v_slug
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have a Tap profile yet.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_slug;
END;
$_$;


--
-- TOC entry 498 (class 1255 OID 49968)
-- Name: customer_activate_card(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_activate_card(p_card_id uuid, p_activation_code text) RETURNS TABLE(id uuid, status text, activated_at timestamp with time zone, activation_expires_at timestamp with time zone, activation_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_card public.cards%ROWTYPE; v_now TIMESTAMPTZ := now(); v_code TEXT := upper(regexp_replace(btrim(coalesce(p_activation_code, '')), '\s+', '', 'g'));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_card FROM public.cards WHERE id = p_card_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found' USING ERRCODE = 'P0002'; END IF;
  IF v_code IS NULL OR v_code = '' OR v_code <> upper(v_card.activation_code) THEN RAISE EXCEPTION 'Invalid card activation code' USING ERRCODE = '22023'; END IF;
  IF v_card.status = 'replaced' THEN RAISE EXCEPTION 'This card has been replaced' USING ERRCODE = '22023'; END IF;
  UPDATE public.cards SET status='active', activated_at=v_now, last_activation_at=v_now,
    activation_expires_at=v_now + interval '14 days', activation_count=activation_count+1, deactivated_at=NULL
  WHERE id=v_card.id;
  RETURN QUERY SELECT c.id,c.status,c.activated_at,c.activation_expires_at,c.activation_count FROM public.cards c WHERE c.id=v_card.id;
END;
$$;


--
-- TOC entry 499 (class 1255 OID 49969)
-- Name: customer_deactivate_card(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.customer_deactivate_card(p_card_id uuid, p_activation_code text) RETURNS TABLE(id uuid, status text, activated_at timestamp with time zone, activation_expires_at timestamp with time zone, activation_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_card public.cards%ROWTYPE; v_code TEXT := upper(regexp_replace(btrim(coalesce(p_activation_code, '')), '\s+', '', 'g'));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_card FROM public.cards WHERE id=p_card_id AND user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found' USING ERRCODE = 'P0002'; END IF;
  IF v_code IS NULL OR v_code = '' OR v_code <> upper(v_card.activation_code) THEN RAISE EXCEPTION 'Invalid card activation code' USING ERRCODE = '22023'; END IF;
  IF v_card.status <> 'active' THEN RAISE EXCEPTION 'Card is not active' USING ERRCODE = '22023'; END IF;
  UPDATE public.cards SET status='suspended', deactivated_at=now() WHERE id=v_card.id;
  RETURN QUERY SELECT c.id,c.status,c.activated_at,c.activation_expires_at,c.activation_count FROM public.cards c WHERE c.id=v_card.id;
END;
$$;


--
-- TOC entry 465 (class 1255 OID 25802)
-- Name: decrement_product_stock(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_product_stock(p_sku text, p_quantity integer) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ UPDATE public.products SET stock=greatest(0,stock-greatest(0,p_quantity)) WHERE sku=p_sku AND stock IS NOT NULL $$;


--
-- TOC entry 451 (class 1255 OID 25561)
-- Name: enforce_server_only_payment_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_server_only_payment_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_protected TEXT[] := ARRAY['paid', 'refunded', 'captured'];
BEGIN
  -- service_role / server-side fulfilment has no auth.uid().
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.payment_status = ANY (v_protected) THEN
      RAISE EXCEPTION 'payment_status % may only be set by the server', NEW.payment_status
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status = ANY (v_protected) THEN
    RAISE EXCEPTION 'payment_status % may only be set by the server', NEW.payment_status
      USING ERRCODE = '42501';
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.amount_in_paise IS DISTINCT FROM OLD.amount_in_paise
     OR NEW.razorpay_order_id IS DISTINCT FROM OLD.razorpay_order_id
     OR NEW.razorpay_payment_id IS DISTINCT FROM OLD.razorpay_payment_id THEN
    RAISE EXCEPTION 'Order amount and payment references are server-managed'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.payment_status = ANY (v_protected)
     AND NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NOT public.admin_has('orders.fulfil') THEN
    RAISE EXCEPTION 'Fulfilment status of a paid order is server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 479 (class 1255 OID 25901)
-- Name: enforce_tap_edit_rules(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_tap_edit_rules() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ DECLARE v_tier TEXT;v_pass BOOLEAN;v_owned TEXT[];v_content BOOLEAN; BEGIN IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN RETURN NEW; END IF; v_tier:=public.user_max_ui_tier(NEW.user_id); v_pass:=public.user_has_pass(NEW.user_id); NEW.enabled_customizations:=ARRAY(SELECT DISTINCT value FROM unnest(COALESCE(NEW.enabled_customizations,'{}'::text[]) || ARRAY['phone','email']) AS u(value) WHERE value<>'' ORDER BY value); IF public.tier_rank(NEW.selected_ui_tier)>public.tier_rank(v_tier) THEN RAISE EXCEPTION 'You have not purchased the % experience.',NEW.selected_ui_tier USING ERRCODE='42501'; END IF; IF NEW.theme_palette<>ALL(public.theme_options('palette',v_tier,v_pass)) THEN RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_layout<>ALL(public.theme_options('layout',v_tier,v_pass)) THEN RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_buttons<>ALL(public.theme_options('buttons',v_tier,v_pass)) THEN RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_font<>ALL(public.theme_options('font',v_tier,v_pass)) THEN RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE='42501'; END IF; IF NEW.theme_animation<>ALL(public.theme_options('animation',v_tier,v_pass)) THEN RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE='42501'; END IF; SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned FROM public.entitlements e WHERE e.user_id=NEW.user_id AND e.is_active AND e.type='customization'; IF EXISTS(SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key) WHERE k.key<>ALL(v_owned||ARRAY['phone','email'])) THEN RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE='42501'; END IF; v_content:=NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.headline IS DISTINCT FROM OLD.headline OR NEW.designation IS DISTINCT FROM OLD.designation OR NEW.company IS DISTINCT FROM OLD.company OR NEW.bio IS DISTINCT FROM OLD.bio OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url OR NEW.location IS DISTINCT FROM OLD.location OR NEW.phone IS DISTINCT FROM OLD.phone OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp OR NEW.email IS DISTINCT FROM OLD.email OR NEW.website IS DISTINCT FROM OLD.website OR NEW.instagram IS DISTINCT FROM OLD.instagram OR NEW.linkedin IS DISTINCT FROM OLD.linkedin OR NEW.youtube IS DISTINCT FROM OLD.youtube OR NEW.custom_links IS DISTINCT FROM OLD.custom_links OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons OR NEW.theme_font IS DISTINCT FROM OLD.theme_font OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL); IF NOT v_content THEN RETURN NEW; END IF; IF NOT public.tap_can_edit(NEW.user_id) THEN RAISE EXCEPTION 'You can change your Tap once every % days. The Customization Pass removes the limit.',public.tap_edit_interval_days() USING ERRCODE='42501'; END IF; NEW.last_content_edit_at:=NOW(); RETURN NEW; END; $$;


--
-- TOC entry 500 (class 1255 OID 49970)
-- Name: expire_tap_cards(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.expire_tap_cards() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.cards SET status='suspended', deactivated_at=COALESCE(deactivated_at,now())
  WHERE status='active' AND activation_expires_at IS NOT NULL AND activation_expires_at <= now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END;
$$;


--
-- TOC entry 488 (class 1255 OID 26027)
-- Name: fulfil_card_stock(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_inserted INT;
  v_updated INT;
BEGIN
  IF p_order_item_id IS NULL OR NULLIF(btrim(p_sku), '') IS NULL OR p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid stock fulfilment request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_item_fulfillment_actions(order_item_id, action)
  VALUES (p_order_item_id, 'stock_decrement')
  ON CONFLICT (order_item_id, action) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.products
  SET stock = stock - p_quantity
  WHERE sku = p_sku
    AND product_type = 'card'
    AND stock IS NOT NULL
    AND stock >= p_quantity;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RAISE EXCEPTION 'Insufficient stock for %', p_sku USING ERRCODE = 'P0001';
  END IF;

  RETURN TRUE;
END;
$$;


--
-- TOC entry 4496 (class 0 OID 0)
-- Dependencies: 488
-- Name: FUNCTION fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer) IS 'Idempotently consumes physical-card inventory once per order item during payment fulfilment.';


--
-- TOC entry 487 (class 1255 OID 25968)
-- Name: fulfil_order(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fulfil_order(p_order_id uuid) RETURNS TABLE(newly_fulfilled boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_order public.orders%ROWTYPE; v_item RECORD; v_payment public.payments%ROWTYPE; v_total BIGINT; v_experience TEXT; v_slot INTEGER;
BEGIN
SELECT * INTO v_order FROM public.orders WHERE id=p_order_id FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Order not found: %',p_order_id USING ERRCODE='P0002'; END IF;
IF v_order.payment_status='paid' THEN RETURN QUERY SELECT false; RETURN; END IF;
IF v_order.payment_status NOT IN ('pending','created','payment_pending','failed') THEN RAISE EXCEPTION 'Order cannot be fulfilled from payment status %',v_order.payment_status USING ERRCODE='22023'; END IF;
IF COALESCE(v_order.amount_in_paise,0)<=0 THEN RAISE EXCEPTION 'Order has an invalid amount.' USING ERRCODE='22023'; END IF;
SELECT * INTO v_payment FROM public.payments p WHERE p.order_id=v_order.id AND p.status='paid' ORDER BY p.created_at DESC LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'Verified payment record is missing.' USING ERRCODE='42501'; END IF;
IF v_payment.provider_order_id IS DISTINCT FROM v_order.razorpay_order_id THEN RAISE EXCEPTION 'Payment order mismatch.' USING ERRCODE='42501'; END IF;
IF v_payment.amount_in_paise IS DISTINCT FROM v_order.amount_in_paise THEN RAISE EXCEPTION 'Payment amount mismatch.' USING ERRCODE='42501'; END IF;
SELECT COALESCE(SUM(line_total_in_paise),0) INTO v_total FROM public.order_items WHERE order_id=v_order.id;
IF EXISTS(SELECT 1 FROM public.order_items WHERE order_id=v_order.id) AND v_total<>v_order.amount_in_paise THEN RAISE EXCEPTION 'Order total mismatch.' USING ERRCODE='42501'; END IF;
IF EXISTS(SELECT 1 FROM public.order_items WHERE order_id=v_order.id) THEN
FOR v_item IN SELECT sku,name,product_type,quantity FROM public.order_items WHERE order_id=v_order.id ORDER BY id LOOP
IF v_item.quantity IS NULL OR v_item.quantity<1 THEN RAISE EXCEPTION 'Invalid item quantity.' USING ERRCODE='22023'; END IF;
CASE v_item.product_type
WHEN 'card' THEN
 INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'card',v_item.sku,v_order.id,true)
 ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
 FOR v_slot IN 1..v_item.quantity LOOP
   INSERT INTO public.cards(user_id,order_id,sku,status,is_replacement,card_slot)
   VALUES(v_order.user_id,v_order.id,v_item.sku,'pending',v_item.name ILIKE '%replacement%',v_slot)
   ON CONFLICT(order_id,sku,card_slot) DO NOTHING;
 END LOOP;
 UPDATE public.products SET stock=stock-v_item.quantity WHERE sku=v_item.sku AND (stock IS NULL OR stock>=v_item.quantity);
 IF NOT FOUND THEN RAISE EXCEPTION 'Insufficient stock for %.',v_item.name USING ERRCODE='23514'; END IF;
WHEN 'digital_plan' THEN
 v_experience:=public.canonical_experience(regexp_replace(v_item.sku,'^plan-',''));
 IF v_experience IS NOT NULL AND v_experience<>'essential' THEN
  INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'digital_plan',v_experience,v_order.id,true)
  ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
 END IF;
WHEN 'lifetime_plan' THEN
 INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'lifetime','lifetime',v_order.id,true)
 ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
WHEN 'customization' THEN
 INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'customization',regexp_replace(v_item.sku,'^addon-',''),v_order.id,true)
 ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
ELSE RAISE EXCEPTION 'Unknown product type: %',v_item.product_type USING ERRCODE='22023';
END CASE;
END LOOP;
ELSE
IF v_order.order_type='lifetimeCustomization' THEN
 INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'lifetime','lifetime',v_order.id,true) ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
ELSIF v_order.order_type='digitalUpgrade' THEN
 v_experience:=public.canonical_experience(COALESCE(v_order.plan_id,v_order.plan));
 IF v_experience IS NOT NULL AND v_experience<>'essential' THEN INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'digital_plan',v_experience,v_order.id,true) ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id; END IF;
ELSE
 INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'card',COALESCE(v_order.product_id,'card'),v_order.id,true) ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id;
 v_experience:=public.canonical_experience(COALESCE(v_order.plan_id,v_order.plan));
 IF v_experience IS NOT NULL AND v_experience<>'essential' THEN INSERT INTO public.entitlements(user_id,type,key,source_order_id,is_active) VALUES(v_order.user_id,'digital_plan',v_experience,v_order.id,true) ON CONFLICT(user_id,type,key) DO UPDATE SET is_active=true,source_order_id=EXCLUDED.source_order_id; END IF;
END IF;
END IF;
UPDATE public.orders SET payment_status='paid',order_status='processing',razorpay_payment_id=COALESCE(razorpay_payment_id,v_payment.provider_payment_id),updated_at=NOW() WHERE id=v_order.id;
RETURN QUERY SELECT true;
END; $$;


--
-- TOC entry 463 (class 1255 OID 25799)
-- Name: generate_tap_slug(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_tap_slug(p_user uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_base TEXT;
  v_try TEXT;
  v_suffix INT := 0;
BEGIN
  SELECT lower(regexp_replace(
    COALESCE(p.full_name, split_part(p.email, '@', 1), 'tap'),
    '[^a-zA-Z0-9]+', '-', 'g'
  ))
  INTO v_base
  FROM public.profiles p
  WHERE p.id = p_user;

  v_base := btrim(COALESCE(v_base, 'tap'), '-');
  IF length(v_base) < 3 THEN v_base := 'tap-' || v_base; END IF;
  v_base := left(v_base, 32);

  LOOP
    v_try := CASE
      WHEN v_suffix = 0 THEN v_base
      ELSE v_base || '-' || v_suffix::text
    END;

    IF v_try IN (
      'admin', 'api', 'auth', 'account', 'shygontap', 'store', 'checkout',
      'orders', 'settings', 'support', 'tap', 'www', 'tiers', 'customize',
      'qr', 'cards', 'customizations', 'notifications', 'analytics',
      'privacy-policy', 'terms', 'cookie-policy', 'refund-policy', 'shipping-policy'
    ) THEN
      v_suffix := v_suffix + 1;
      CONTINUE;
    END IF;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.tap_profiles WHERE lower(slug) = v_try
    );

    v_suffix := v_suffix + 1;
    IF v_suffix > 500 THEN
      v_try := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_try;
END;
$$;


--
-- TOC entry 550 (class 1255 OID 50322)
-- Name: get_card_tap_history(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_card_tap_history(p_card_id uuid, p_limit integer DEFAULT 10) RETURNS TABLE(occurred_at timestamp with time zone, event_type text, link_key text, referrer_host text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN p_limit := 10; END IF;
  RETURN QUERY
  SELECT e.occurred_at, e.event_type::TEXT, e.link_key::TEXT, e.referrer_host::TEXT
  FROM public.tap_events e JOIN public.cards c ON c.tap_profile_id = e.tap_profile_id
  WHERE c.id = p_card_id AND c.user_id = auth.uid()
  ORDER BY e.occurred_at DESC LIMIT p_limit;
END;
$$;


--
-- TOC entry 480 (class 1255 OID 25903)
-- Name: get_public_profile(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_profile(p_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
$$;


--
-- TOC entry 458 (class 1255 OID 25794)
-- Name: get_public_tap(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_tap(p_slug text) RETURNS TABLE(slug text, display_name text, headline text, bio text, avatar_url text, location text, phone text, whatsapp text, email text, website text, instagram text, linkedin text, theme_color text, ui_tier text, enabled_customizations text[])
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_tap public.tap_profiles%ROWTYPE; v_max TEXT; v_owned TEXT[];
        v_has_cards BOOLEAN; v_has_active_card BOOLEAN;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles t
  WHERE lower(t.slug)=lower(btrim(p_slug)) AND t.published IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM public.expire_tap_cards();
  SELECT EXISTS(SELECT 1 FROM public.cards c WHERE c.tap_profile_id=v_tap.id OR c.user_id=v_tap.user_id) INTO v_has_cards;
  SELECT EXISTS(
    SELECT 1 FROM public.cards c
    WHERE (c.tap_profile_id=v_tap.id OR c.user_id=v_tap.user_id)
      AND c.status='active' AND (c.activation_expires_at IS NULL OR c.activation_expires_at>now())
  ) INTO v_has_active_card;
  IF v_has_cards AND NOT v_has_active_card THEN RETURN; END IF;
  v_max := public.user_max_ui_tier(v_tap.user_id);
  SELECT COALESCE(array_agg(e.key),'{}') INTO v_owned
  FROM public.entitlements e WHERE e.user_id=v_tap.user_id AND e.is_active AND e.type='customization';
  RETURN QUERY SELECT v_tap.slug,v_tap.display_name,v_tap.headline,v_tap.bio,v_tap.avatar_url,v_tap.location,
    CASE WHEN 'phone'=ANY(v_tap.enabled_customizations) THEN v_tap.phone END,
    CASE WHEN 'whatsapp'=ANY(v_tap.enabled_customizations) AND 'whatsapp'=ANY(v_owned) THEN v_tap.whatsapp END,
    CASE WHEN 'email'=ANY(v_tap.enabled_customizations) THEN v_tap.email END,
    CASE WHEN 'website'=ANY(v_tap.enabled_customizations) AND 'website'=ANY(v_owned) THEN v_tap.website END,
    CASE WHEN 'instagram'=ANY(v_tap.enabled_customizations) AND 'instagram'=ANY(v_owned) THEN v_tap.instagram END,
    CASE WHEN 'linkedin'=ANY(v_tap.enabled_customizations) AND 'linkedin'=ANY(v_owned) THEN v_tap.linkedin END,
    v_tap.theme_color,
    CASE WHEN public.tier_rank(v_tap.selected_ui_tier)<=public.tier_rank(v_max) THEN v_tap.selected_ui_tier ELSE v_max END,
    ARRAY(SELECT unnest(v_tap.enabled_customizations) INTERSECT SELECT unnest(v_owned || ARRAY['phone','email']));
END;
$$;


--
-- TOC entry 473 (class 1255 OID 25895)
-- Name: get_public_tap_state(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_public_tap_state(p_slug text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_status TEXT; v_suspended TIMESTAMPTZ; BEGIN SELECT t.status,t.suspended_at INTO v_status,v_suspended FROM public.tap_profiles t WHERE lower(t.slug)=lower(btrim(COALESCE(p_slug,''))) LIMIT 1; IF NOT FOUND OR v_suspended IS NOT NULL THEN RETURN 'unavailable'; END IF; IF v_status='active' THEN RETURN 'active'; END IF; IF v_status='paused' THEN RETURN 'paused'; END IF; RETURN 'unavailable'; END; $$;


--
-- TOC entry 460 (class 1255 OID 25796)
-- Name: get_tap_analytics(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_tap_analytics(p_days integer DEFAULT 30) RETURNS TABLE(day date, views bigint, nfc_taps bigint, qr_scans bigint, link_clicks bigint, unique_visitors bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT (e.occurred_at AT TIME ZONE 'UTC')::date,count(*) FILTER(WHERE e.event_type='view'),count(*) FILTER(WHERE e.event_type='nfc'),count(*) FILTER(WHERE e.event_type='qr'),count(*) FILTER(WHERE e.event_type='link_click'),count(DISTINCT e.visitor_hash) FROM public.tap_events e JOIN public.tap_profiles t ON t.id=e.tap_profile_id WHERE t.user_id=auth.uid() AND e.occurred_at>=NOW()-make_interval(days=>greatest(1,least(365,p_days))) GROUP BY 1 ORDER BY 1 $$;


--
-- TOC entry 461 (class 1255 OID 25797)
-- Name: get_tap_link_clicks(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_tap_link_clicks(p_days integer DEFAULT 30) RETURNS TABLE(link_key text, clicks bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT e.link_key,count(*) FROM public.tap_events e JOIN public.tap_profiles t ON t.id=e.tap_profile_id WHERE t.user_id=auth.uid() AND e.event_type='link_click' AND e.link_key IS NOT NULL AND e.occurred_at>=NOW()-make_interval(days=>greatest(1,least(365,p_days))) GROUP BY 1 ORDER BY 2 DESC $$;


--
-- TOC entry 453 (class 1255 OID 25666)
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_customer_id uuid;
  v_customer_code text;
begin
  insert into public.customers (user_id, customer_id, registered_email, registered_phone)
  values (
    new.id,
    'CUST-' || upper(substr(replace(new.id::text, '-', ''), 1, 10)),
    new.email,
    coalesce(new.phone, null)
  )
  on conflict (user_id) do update
    set registered_email = excluded.registered_email,
        registered_phone = excluded.registered_phone,
        updated_at = now()
  returning id, customer_id into v_customer_id, v_customer_code;

  if v_customer_id is null then
    select id, customer_id into v_customer_id, v_customer_code
    from public.customers
    where user_id = new.id;
  end if;

  insert into public.profiles(id, customer_id, email, full_name)
  values (
    new.id,
    v_customer_id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict(id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  return new;
end;
$$;


--
-- TOC entry 466 (class 1255 OID 25810)
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid() AND a.is_active
  );
$$;


--
-- TOC entry 481 (class 1255 OID 25924)
-- Name: log_account_event(uuid, text, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_account_event(p_user uuid, p_type text, p_subject_type text DEFAULT NULL::text, p_subject_id text DEFAULT NULL::text, p_detail jsonb DEFAULT NULL::jsonb) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
INSERT INTO public.account_events(user_id,event_type,subject_type,subject_id,detail)
SELECT p_user,left(p_type,48),left(p_subject_type,32),p_subject_id,p_detail WHERE p_user IS NOT NULL;
$$;


--
-- TOC entry 486 (class 1255 OID 25967)
-- Name: my_event_theme(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_event_theme() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.tap_event_theme_for(now()); $$;


--
-- TOC entry 478 (class 1255 OID 25900)
-- Name: my_theme_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.my_theme_options() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ DECLARE v_user UUID:=auth.uid();v_tier TEXT;v_pass BOOLEAN;BEGIN IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501';END IF;v_tier:=public.user_max_ui_tier(v_user);v_pass:=public.user_has_pass(v_user);RETURN jsonb_build_object('max_experience',v_tier,'has_pass',v_pass,'palette',to_jsonb(public.theme_options('palette',v_tier,v_pass)),'layout',to_jsonb(public.theme_options('layout',v_tier,v_pass)),'buttons',to_jsonb(public.theme_options('buttons',v_tier,v_pass)),'font',to_jsonb(public.theme_options('font',v_tier,v_pass)),'animation',to_jsonb(public.theme_options('animation',v_tier,v_pass)));END; $$;


--
-- TOC entry 456 (class 1255 OID 25725)
-- Name: notifications_only_read_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notifications_only_read_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN IF auth.uid() IS NULL THEN RETURN NEW; END IF; IF NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.link IS DISTINCT FROM OLD.link OR NEW.category IS DISTINCT FROM OLD.category OR NEW.metadata IS DISTINCT FROM OLD.metadata OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Only the read state of a notification may be changed' USING ERRCODE='42501'; END IF; RETURN NEW; END; $$;


--
-- TOC entry 457 (class 1255 OID 25727)
-- Name: notify_order_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_order_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN IF TG_OP='INSERT' THEN INSERT INTO public.notifications(user_id,category,title,body,link,metadata) VALUES(NEW.user_id,'order','Order placed','We have received order '||COALESCE(NEW.order_id,'')||'.','/shygontap/orders',jsonb_build_object('order_id',NEW.id)); ELSIF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NEW.payment_status='paid' THEN INSERT INTO public.notifications(user_id,category,title,body,link,metadata) VALUES(NEW.user_id,'payment','Payment confirmed','Payment for order '||COALESCE(NEW.order_id,'')||' was successful.','/shygontap/orders',jsonb_build_object('order_id',NEW.id)); ELSIF NEW.order_status IS DISTINCT FROM OLD.order_status AND NEW.order_status IN('shipped','out_for_delivery','delivered') THEN INSERT INTO public.notifications(user_id,category,title,body,link,metadata) VALUES(NEW.user_id,'shipping',CASE NEW.order_status WHEN 'shipped' THEN 'Your Tap has shipped' WHEN 'out_for_delivery' THEN 'Out for delivery' ELSE 'Delivered' END,'Order '||COALESCE(NEW.order_id,'')||' is now '||replace(NEW.order_status,'_',' ')||'.','/shygontap/orders',jsonb_build_object('order_id',NEW.id,'tracking_number',NEW.tracking_number)); END IF; RETURN NEW; END; $$;


--
-- TOC entry 464 (class 1255 OID 25800)
-- Name: provision_tap_on_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provision_tap_on_payment() RETURNS trigger
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
    NEW.user_id, NEW.user_id, true, 'active', v_slug, v_slug, v_name, v_email,
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
      'Your SHYGON Tap is live',
      'Your Tap page has been created automatically. Complete your profile whenever you are ready.',
      '/shygontap/tap'
    );
  END IF;

  RETURN NEW;
END;
$$;


--
-- TOC entry 548 (class 1255 OID 50319)
-- Name: record_order_status_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_order_status_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.order_status IS DISTINCT FROM OLD.order_status
     OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
     OR NEW.shipping_carrier IS DISTINCT FROM OLD.shipping_carrier THEN
    INSERT INTO public.order_status_history(order_id, status, tracking_number, shipping_carrier)
    VALUES (NEW.id, COALESCE(NEW.order_status, 'placed'), NEW.tracking_number, NEW.shipping_carrier);
  END IF;
  RETURN NEW;
END;
$$;


--
-- TOC entry 459 (class 1255 OID 25795)
-- Name: record_tap_event(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_tap_id  UUID;
  v_headers JSON;
  v_ua      TEXT;
  v_ip      TEXT;
  v_ref     TEXT;
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

  INSERT INTO public.tap_events
    (tap_profile_id, event_type, link_key, visitor_hash, referrer_host)
  VALUES (
    v_tap_id,
    p_event,
    left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),
    md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
        to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
  );
END;
$$;


--
-- TOC entry 551 (class 1255 OID 50323)
-- Name: request_card_replacement(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.request_card_replacement(p_card_id uuid, p_reason text DEFAULT 'Lost card'::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_card public.cards; v_ticket public.support_tickets;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE id = p_card_id AND user_id = auth.uid() FOR UPDATE;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'Card not found' USING ERRCODE = '42501'; END IF;
  IF COALESCE(v_card.status, '') = 'replaced' THEN RAISE EXCEPTION 'This card has already been replaced' USING ERRCODE = '22023'; END IF;
  UPDATE public.cards SET status = 'suspended', card_status = 'suspended', deactivated_at = now(), updated_at = now() WHERE id = v_card.id;
  INSERT INTO public.support_tickets(user_id, subject, category, status, order_id) VALUES (auth.uid(), 'Card replacement request', 'card', 'open', v_card.order_id) RETURNING * INTO v_ticket;
  INSERT INTO public.notifications(user_id, category, title, body, link, metadata) VALUES (auth.uid(), 'account', 'Replacement request received', 'Your card has been suspended and a replacement request has been opened.', '/shygontap/support', jsonb_build_object('card_id', v_card.id, 'ticket_id', v_ticket.id));
  RETURN v_ticket.reference;
END;
$$;


--
-- TOC entry 504 (class 1255 OID 50137)
-- Name: require_admin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.require_admin(p_permission text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.is_admin() THEN
    -- Same message for "not an admin" and "deactivated admin": a signed-in
    -- customer poking at these RPCs learns nothing about who is an admin.
    RAISE EXCEPTION 'This account does not have administrator access.'
      USING ERRCODE = '42501';
  END IF;

  IF p_permission IS NOT NULL AND NOT public.admin_has(p_permission) THEN
    RAISE EXCEPTION 'Your role does not permit this action (%).', p_permission
      USING ERRCODE = '42501';
  END IF;

  RETURN v_uid;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 310 (class 1259 OID 17581)
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    card_id text NOT NULL,
    customer_id uuid,
    tap_profile_id uuid,
    card_type text DEFAULT 'standard'::text NOT NULL,
    card_status text DEFAULT 'inventory'::text NOT NULL,
    nfc_url text,
    qr_code_url text,
    assigned_at timestamp with time zone,
    activated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    order_id uuid,
    sku character varying(64),
    card_uid character varying(64),
    status character varying(32) DEFAULT 'pending'::character varying,
    is_replacement boolean DEFAULT false NOT NULL,
    card_slot integer DEFAULT 1 NOT NULL,
    activation_code text NOT NULL,
    deactivated_at timestamp with time zone,
    activation_expires_at timestamp with time zone,
    activation_count integer DEFAULT 0 NOT NULL,
    last_activation_at timestamp with time zone,
    edition_design text,
    edition_serial integer,
    edition_count integer,
    edition_chapter_size integer,
    nickname character varying(40),
    CONSTRAINT cards_nickname_length CHECK (((nickname IS NULL) OR ((char_length(btrim((nickname)::text)) >= 1) AND (char_length(btrim((nickname)::text)) <= 40)))),
    CONSTRAINT cards_status_check CHECK ((card_status = ANY (ARRAY['inventory'::text, 'assigned'::text, 'active'::text, 'suspended'::text, 'replacement'::text, 'retired'::text])))
);


--
-- TOC entry 549 (class 1255 OID 50321)
-- Name: set_card_nickname(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_card_nickname(p_card_id uuid, p_nickname text) RETURNS public.cards
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_card public.cards; v_name TEXT := NULLIF(btrim(COALESCE(p_nickname, '')), '');
BEGIN
  IF p_card_id IS NULL THEN RAISE EXCEPTION 'Card is required' USING ERRCODE = '22023'; END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 40 THEN RAISE EXCEPTION 'Card nickname must be 40 characters or fewer' USING ERRCODE = '22023'; END IF;
  UPDATE public.cards SET nickname = v_name, updated_at = now() WHERE id = p_card_id AND user_id = auth.uid() RETURNING * INTO v_card;
  IF v_card.id IS NULL THEN RAISE EXCEPTION 'Card not found' USING ERRCODE = '42501'; END IF;
  RETURN v_card;
END;
$$;


--
-- TOC entry 475 (class 1255 OID 25897)
-- Name: tap_can_edit(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tap_can_edit(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
SELECT public.user_has_pass(p_user) OR COALESCE((SELECT t.last_content_edit_at + make_interval(days=>public.tap_edit_interval_days()) <= NOW() FROM public.tap_profiles t WHERE t.user_id=p_user),true); $$;


--
-- TOC entry 474 (class 1255 OID 25896)
-- Name: tap_edit_interval_days(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tap_edit_interval_days() RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT 14 $$;


--
-- TOC entry 476 (class 1255 OID 25898)
-- Name: tap_edit_state(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tap_edit_state() RETURNS TABLE(last_edit_at timestamp with time zone, next_edit_at timestamp with time zone, days_remaining integer, interval_days integer, has_pass boolean, can_edit boolean, reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE v_user UUID:=auth.uid();v_last TIMESTAMPTZ;v_next TIMESTAMPTZ;v_pass BOOLEAN;v_found BOOLEAN; BEGIN IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF; SELECT t.last_content_edit_at,true INTO v_last,v_found FROM public.tap_profiles t WHERE t.user_id=v_user; v_pass:=public.user_has_pass(v_user); v_next:=CASE WHEN v_last IS NULL THEN NULL ELSE v_last+make_interval(days=>public.tap_edit_interval_days()) END; RETURN QUERY SELECT v_last,CASE WHEN v_pass THEN NULL ELSE v_next END,CASE WHEN v_pass OR v_next IS NULL THEN 0 ELSE GREATEST(0,CEIL(EXTRACT(EPOCH FROM(v_next-NOW()))/86400.0))::INT END,public.tap_edit_interval_days(),v_pass,CASE WHEN v_pass OR v_next IS NULL THEN true ELSE v_next<=NOW() END,CASE WHEN v_pass THEN 'pass' WHEN NOT COALESCE(v_found,false) THEN 'no_tap' WHEN v_next IS NULL THEN 'never_edited' WHEN v_next<=NOW() THEN 'edit_available' ELSE 'cooling_down' END; END; $$;


--
-- TOC entry 485 (class 1255 OID 25958)
-- Name: tap_event_theme_for(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tap_event_theme_for(p_at timestamp with time zone DEFAULT now()) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT COALESCE((SELECT jsonb_build_object('code',e.code,'name',e.name,'startsOn',e.starts_on,'endsOn',e.ends_on,'theme',jsonb_build_object('palette',e.palette,'layout',e.layout,'buttons',e.buttons,'font',e.font,'animation',e.animation)) FROM public.tap_event_themes e WHERE e.active AND (p_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN e.starts_on AND e.ends_on ORDER BY e.priority DESC,e.starts_on DESC,e.code LIMIT 1),'{}'::jsonb); $$;


--
-- TOC entry 472 (class 1255 OID 25893)
-- Name: tap_profiles_sync_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tap_profiles_sync_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.status IS NULL OR NEW.status NOT IN ('draft','active','paused','archived') THEN NEW.status:=CASE WHEN NEW.published THEN 'active' ELSE 'draft' END; ELSE NEW.published:=(NEW.status='active'); END IF;
   IF NEW.published AND NEW.slug IS NULL THEN RAISE EXCEPTION 'Claim your Tap address before publishing.' USING ERRCODE='22023'; END IF; RETURN NEW;
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.published:=(NEW.status='active');
 ELSIF NEW.published IS DISTINCT FROM OLD.published THEN NEW.status:=CASE WHEN NEW.published THEN 'active' WHEN OLD.status='active' THEN 'paused' ELSE OLD.status END; END IF;
 IF NEW.published AND NEW.slug IS NULL THEN RAISE EXCEPTION 'Claim your Tap address before publishing.' USING ERRCODE='22023'; END IF; RETURN NEW;
END; $$;


--
-- TOC entry 477 (class 1255 OID 25899)
-- Name: theme_options(text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.theme_options(p_kind text, p_tier text, p_pass boolean DEFAULT false) RETURNS text[]
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT CASE p_kind
WHEN 'palette' THEN CASE WHEN p_pass OR public.tier_rank(p_tier)>=3 THEN ARRAY['midnight','graphite','royal','forest','sunset','aurora','crimson','ivory','neon','molten','abyss','prism'] WHEN public.tier_rank(p_tier)=2 THEN ARRAY['midnight','graphite','royal','forest','sunset','aurora','crimson','ivory'] WHEN public.tier_rank(p_tier)=1 THEN ARRAY['midnight','graphite','royal','forest','sunset'] ELSE ARRAY['midnight','graphite','royal','forest'] END
WHEN 'layout' THEN CASE WHEN public.tier_rank(p_tier)>=3 THEN ARRAY['classic','centered','split','immersive'] WHEN public.tier_rank(p_tier)=2 THEN ARRAY['classic','centered','split'] WHEN public.tier_rank(p_tier)=1 THEN ARRAY['classic','centered'] ELSE ARRAY['classic'] END
WHEN 'buttons' THEN CASE WHEN public.tier_rank(p_tier)>=3 THEN ARRAY['solid','outline','glass','glow'] WHEN public.tier_rank(p_tier)=2 THEN ARRAY['solid','outline','glass'] WHEN public.tier_rank(p_tier)=1 THEN ARRAY['solid','outline'] ELSE ARRAY['solid'] END
WHEN 'font' THEN CASE WHEN public.tier_rank(p_tier)>=3 THEN ARRAY['sans','display','mono','editorial'] WHEN public.tier_rank(p_tier)=2 THEN ARRAY['sans','display','mono'] WHEN public.tier_rank(p_tier)=1 THEN ARRAY['sans','display'] ELSE ARRAY['sans'] END
WHEN 'animation' THEN CASE WHEN public.tier_rank(p_tier)>=3 THEN ARRAY['auto','none','signature','dynamic'] WHEN public.tier_rank(p_tier)=2 THEN ARRAY['auto','none','signature'] WHEN public.tier_rank(p_tier)=1 THEN ARRAY['auto','none'] ELSE ARRAY['auto','none'] END
ELSE ARRAY[]::TEXT[] END; $$;


--
-- TOC entry 454 (class 1255 OID 25677)
-- Name: tier_rank(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tier_rank(p_tier text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT CASE public.canonical_experience(p_tier) WHEN 'goat' THEN 3 WHEN 'premium' THEN 2 WHEN 'business' THEN 1 ELSE 0 END;
$$;


--
-- TOC entry 452 (class 1255 OID 25621)
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_temp'
    AS $$ BEGIN NEW.updated_at:=NOW(); RETURN NEW; END; $$;


--
-- TOC entry 471 (class 1255 OID 25884)
-- Name: user_has_lifetime(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_lifetime(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT public.user_has_pass(p_user); $$;


--
-- TOC entry 470 (class 1255 OID 25883)
-- Name: user_has_pass(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_has_pass(p_user uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$ SELECT EXISTS(SELECT 1 FROM public.entitlements e WHERE e.user_id=p_user AND e.is_active AND e.type='lifetime'); $$;


--
-- TOC entry 455 (class 1255 OID 25678)
-- Name: user_max_ui_tier(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.user_max_ui_tier(p_user uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
SELECT COALESCE((SELECT public.canonical_experience(e.key) FROM public.entitlements e WHERE e.user_id=p_user AND e.is_active AND e.type='digital_plan' ORDER BY public.tier_rank(e.key) DESC LIMIT 1),'essential'); $$;


--
-- TOC entry 324 (class 1259 OID 25908)
-- Name: account_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_type character varying(48) NOT NULL,
    subject_type character varying(32),
    subject_id text,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 331 (class 1259 OID 41784)
-- Name: admin_allowed_email_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_allowed_email_domains (
    domain text NOT NULL,
    note text,
    added_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 332 (class 1259 OID 41797)
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 334 (class 1259 OID 41832)
-- Name: admin_notification_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notification_reads (
    notification_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 333 (class 1259 OID 41814)
-- Name: admin_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    category text NOT NULL,
    severity text DEFAULT 'info'::text NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    read_at timestamp with time zone,
    pushed_at timestamp with time zone
);


--
-- TOC entry 335 (class 1259 OID 41848)
-- Name: admin_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_push_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    expo_token text NOT NULL,
    platform text,
    device_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 305 (class 1259 OID 17478)
-- Name: admin_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_users (
    user_id uuid NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    permissions text[] DEFAULT '{}'::text[] NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    display_name text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone,
    CONSTRAINT admin_users_role_valid CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'fulfilment'::text, 'support'::text, 'viewer'::text])))
);


--
-- TOC entry 343 (class 1259 OID 50260)
-- Name: card_editions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_editions (
    design text NOT NULL,
    name text NOT NULL,
    chapter_size integer DEFAULT 100 NOT NULL,
    issued integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_editions_chapter_size_check CHECK ((chapter_size > 0)),
    CONSTRAINT card_editions_issued_check CHECK ((issued >= 0))
);


--
-- TOC entry 342 (class 1259 OID 50237)
-- Name: card_otp_challenges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.card_otp_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    card_id uuid NOT NULL,
    action text NOT NULL,
    code_hash text NOT NULL,
    phone_last4 text,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT card_otp_challenges_action_check CHECK ((action = ANY (ARRAY['activate'::text, 'deactivate'::text])))
);


--
-- TOC entry 312 (class 1259 OID 17622)
-- Name: customer_customizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_customizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    tap_profile_id uuid NOT NULL,
    customization_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customer_customization_status_check CHECK ((status = ANY (ARRAY['active'::text, 'revoked'::text])))
);


--
-- TOC entry 306 (class 1259 OID 17493)
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer_id text NOT NULL,
    registered_email text,
    registered_phone text,
    account_status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customers_status_check CHECK ((account_status = ANY (ARRAY['active'::text, 'suspended'::text, 'disabled'::text])))
);


--
-- TOC entry 311 (class 1259 OID 17606)
-- Name: customizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    price integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT customizations_price_check CHECK ((price >= 0))
);


--
-- TOC entry 317 (class 1259 OID 25584)
-- Name: entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entitlements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type character varying(32) NOT NULL,
    key character varying(64) NOT NULL,
    source_order_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 336 (class 1259 OID 41864)
-- Name: inventory_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sku text NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    admin_id uuid,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    stock_after integer,
    note text
);


--
-- TOC entry 320 (class 1259 OID 25707)
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category character varying(32) DEFAULT 'account'::character varying NOT NULL,
    title text NOT NULL,
    body text,
    link text,
    metadata jsonb,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 326 (class 1259 OID 26013)
-- Name: order_item_fulfillment_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_item_fulfillment_actions (
    order_item_id uuid NOT NULL,
    action text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 319 (class 1259 OID 25679)
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    sku character varying(64) NOT NULL,
    name text NOT NULL,
    product_type character varying(32) DEFAULT 'card'::character varying NOT NULL,
    unit_price_in_paise integer NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    line_total_in_paise integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT order_items_line_total_in_paise_check CHECK ((line_total_in_paise >= 0)),
    CONSTRAINT order_items_quantity_check CHECK (((quantity > 0) AND (quantity <= 50))),
    CONSTRAINT order_items_unit_price_in_paise_check CHECK ((unit_price_in_paise >= 0))
);


--
-- TOC entry 345 (class 1259 OID 50303)
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    status text NOT NULL,
    tracking_number text,
    shipping_carrier text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 314 (class 1259 OID 25513)
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id text NOT NULL,
    user_id uuid NOT NULL,
    customer_id uuid,
    product_id text,
    product_name text,
    material text,
    plan text,
    category text,
    amount numeric(12,2),
    payment_status text DEFAULT 'pending'::text NOT NULL,
    order_status text DEFAULT 'placed'::text NOT NULL,
    shipping_name text,
    shipping_phone text,
    shipping_address text,
    shipping_city text,
    shipping_state text,
    shipping_pincode text,
    tracking_number text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    razorpay_order_id character varying(128),
    razorpay_payment_id character varying(128),
    amount_in_paise integer,
    order_type character varying(32) DEFAULT 'physical'::character varying,
    tier character varying(32),
    plan_id character varying(32),
    fulfillment_status text DEFAULT 'pending'::text NOT NULL,
    fulfilled_at timestamp with time zone,
    shipping_carrier text,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    admin_note text,
    refunded_at timestamp with time zone,
    refund_amount_in_paise integer,
    razorpay_refund_id text,
    confirmation_sms_at timestamp with time zone,
    confirmation_sms_status text,
    promo_code character varying(32),
    discount_in_paise integer DEFAULT 0 NOT NULL,
    delivery_fee_in_paise integer DEFAULT 0 NOT NULL,
    custom_note text,
    email_status text DEFAULT 'not_configured'::text NOT NULL,
    email_sent_at timestamp with time zone,
    email_provider_id text,
    CONSTRAINT orders_custom_note_length CHECK (((custom_note IS NULL) OR (char_length(custom_note) <= 80))),
    CONSTRAINT orders_delivery_fee_nonnegative CHECK ((delivery_fee_in_paise >= 0)),
    CONSTRAINT orders_discount_nonnegative CHECK ((discount_in_paise >= 0)),
    CONSTRAINT orders_email_status_check CHECK ((email_status = ANY (ARRAY['not_configured'::text, 'pending'::text, 'sent'::text, 'failed'::text])))
);


--
-- TOC entry 316 (class 1259 OID 25563)
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    provider character varying(32) DEFAULT 'razorpay'::character varying NOT NULL,
    provider_order_id character varying(128) NOT NULL,
    provider_payment_id character varying(128) NOT NULL,
    status character varying(32) DEFAULT 'created'::character varying NOT NULL,
    amount_in_paise integer NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    verified_at timestamp with time zone,
    CONSTRAINT payments_amount_in_paise_check CHECK ((amount_in_paise >= 0))
);


--
-- TOC entry 315 (class 1259 OID 25537)
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text,
    price numeric(12,2),
    material text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sku character varying(64),
    tier character varying(32),
    price_in_paise integer,
    description text,
    short_description text,
    image_url text,
    features jsonb DEFAULT '[]'::jsonb,
    badge character varying(32),
    stock integer,
    product_type character varying(32) DEFAULT 'card'::character varying,
    sort_order integer DEFAULT 0,
    ui_tier text,
    low_stock_threshold integer DEFAULT 10 NOT NULL
);


--
-- TOC entry 307 (class 1259 OID 17514)
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    full_name text,
    bio text,
    profile_image_url text,
    phone text,
    whatsapp text,
    email text,
    instagram text,
    linkedin text,
    website text,
    location text,
    show_phone boolean DEFAULT true NOT NULL,
    show_whatsapp boolean DEFAULT true NOT NULL,
    show_email boolean DEFAULT true NOT NULL,
    show_instagram boolean DEFAULT true NOT NULL,
    show_linkedin boolean DEFAULT true NOT NULL,
    show_website boolean DEFAULT true NOT NULL,
    show_location boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    company text,
    job_title text,
    notify_order_updates boolean DEFAULT true NOT NULL,
    notify_tap_activity boolean DEFAULT true NOT NULL,
    suspended_at timestamp with time zone,
    suspended_reason text
);


--
-- TOC entry 322 (class 1259 OID 25755)
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ticket_id uuid NOT NULL,
    author_id uuid,
    author_role character varying(16) DEFAULT 'customer'::character varying NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_messages_body_check CHECK (((length(btrim(body)) >= 1) AND (length(btrim(body)) <= 4000)))
);


--
-- TOC entry 321 (class 1259 OID 25729)
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    reference text DEFAULT ('ST-'::text || upper(substr(md5((gen_random_uuid())::text), 1, 8))) NOT NULL,
    subject text NOT NULL,
    category character varying(32) DEFAULT 'other'::character varying NOT NULL,
    status character varying(32) DEFAULT 'open'::character varying NOT NULL,
    order_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_tickets_subject_check CHECK (((length(btrim(subject)) >= 3) AND (length(btrim(subject)) <= 160)))
);


--
-- TOC entry 325 (class 1259 OID 25932)
-- Name: tap_event_themes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tap_event_themes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    palette text DEFAULT 'midnight'::text NOT NULL,
    layout text DEFAULT 'classic'::text NOT NULL,
    buttons text DEFAULT 'solid'::text NOT NULL,
    font text DEFAULT 'sans'::text NOT NULL,
    animation text DEFAULT 'auto'::text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tap_event_themes_animation_valid CHECK ((animation = ANY (ARRAY['auto'::text, 'none'::text, 'signature'::text, 'dynamic'::text]))),
    CONSTRAINT tap_event_themes_buttons_valid CHECK ((buttons = ANY (ARRAY['solid'::text, 'outline'::text, 'glass'::text, 'glow'::text]))),
    CONSTRAINT tap_event_themes_dates CHECK ((ends_on >= starts_on)),
    CONSTRAINT tap_event_themes_font_valid CHECK ((font = ANY (ARRAY['sans'::text, 'display'::text, 'mono'::text, 'editorial'::text]))),
    CONSTRAINT tap_event_themes_layout_valid CHECK ((layout = ANY (ARRAY['classic'::text, 'centered'::text, 'split'::text, 'immersive'::text]))),
    CONSTRAINT tap_event_themes_palette_valid CHECK ((palette = ANY (ARRAY['midnight'::text, 'graphite'::text, 'royal'::text, 'forest'::text, 'sunset'::text, 'aurora'::text, 'crimson'::text, 'ivory'::text, 'neon'::text, 'molten'::text, 'abyss'::text, 'prism'::text])))
);


--
-- TOC entry 323 (class 1259 OID 25780)
-- Name: tap_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tap_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tap_profile_id uuid NOT NULL,
    event_type character varying(24) NOT NULL,
    link_key character varying(48),
    visitor_hash character varying(64),
    referrer_host character varying(128),
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 309 (class 1259 OID 17555)
-- Name: tap_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tap_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    username text NOT NULL,
    ui_plan_id uuid,
    published boolean DEFAULT false NOT NULL,
    suspended boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    card_id uuid,
    slug text,
    display_name text,
    headline text,
    bio text,
    avatar_url text,
    location text,
    phone text,
    whatsapp text,
    email text,
    website text,
    instagram text,
    linkedin text,
    theme_color text DEFAULT 'blue'::text NOT NULL,
    selected_ui_tier text DEFAULT 'essential'::text NOT NULL,
    enabled_customizations text[] DEFAULT '{}'::text[] NOT NULL,
    published_at timestamp with time zone,
    provisioned_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    suspended_at timestamp with time zone,
    last_content_edit_at timestamp with time zone,
    edit_window_started_at timestamp with time zone,
    designation text,
    company text,
    youtube text,
    custom_links jsonb DEFAULT '[]'::jsonb NOT NULL,
    theme_palette text DEFAULT 'midnight'::text NOT NULL,
    theme_layout text DEFAULT 'classic'::text NOT NULL,
    theme_buttons text DEFAULT 'solid'::text NOT NULL,
    theme_font text DEFAULT 'sans'::text NOT NULL,
    theme_animation text DEFAULT 'auto'::text NOT NULL,
    suspended_reason text,
    suspended_by uuid
);


--
-- TOC entry 308 (class 1259 OID 17538)
-- Name: ui_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ui_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    price integer DEFAULT 0 NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    opening_animation text,
    is_3d boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ui_plans_price_check CHECK ((price >= 0))
);


--
-- TOC entry 318 (class 1259 OID 25606)
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(32) DEFAULT 'razorpay'::character varying NOT NULL,
    event_id character varying(128) NOT NULL,
    event_type character varying(64) NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- TOC entry 4099 (class 2606 OID 25916)
-- Name: account_events account_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_events
    ADD CONSTRAINT account_events_pkey PRIMARY KEY (id);


--
-- TOC entry 4109 (class 2606 OID 41791)
-- Name: admin_allowed_email_domains admin_allowed_email_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_allowed_email_domains
    ADD CONSTRAINT admin_allowed_email_domains_pkey PRIMARY KEY (domain);


--
-- TOC entry 4111 (class 2606 OID 41806)
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- TOC entry 4119 (class 2606 OID 41837)
-- Name: admin_notification_reads admin_notification_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notification_reads
    ADD CONSTRAINT admin_notification_reads_pkey PRIMARY KEY (notification_id, admin_id);


--
-- TOC entry 4115 (class 2606 OID 41824)
-- Name: admin_notifications admin_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 4121 (class 2606 OID 41856)
-- Name: admin_push_tokens admin_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_push_tokens
    ADD CONSTRAINT admin_push_tokens_pkey PRIMARY KEY (id);


--
-- TOC entry 3999 (class 2606 OID 17487)
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_pkey PRIMARY KEY (user_id);


--
-- TOC entry 4132 (class 2606 OID 50271)
-- Name: card_editions card_editions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_editions
    ADD CONSTRAINT card_editions_pkey PRIMARY KEY (design);


--
-- TOC entry 4129 (class 2606 OID 50247)
-- Name: card_otp_challenges card_otp_challenges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_otp_challenges
    ADD CONSTRAINT card_otp_challenges_pkey PRIMARY KEY (id);


--
-- TOC entry 4029 (class 2606 OID 17595)
-- Name: cards cards_card_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_card_id_key UNIQUE (card_id);


--
-- TOC entry 3973 (class 2606 OID 25972)
-- Name: cards cards_card_slot_positive; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.cards
    ADD CONSTRAINT cards_card_slot_positive CHECK ((card_slot > 0)) NOT VALID;


--
-- TOC entry 4032 (class 2606 OID 17593)
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- TOC entry 4045 (class 2606 OID 17633)
-- Name: customer_customizations customer_customizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_customizations
    ADD CONSTRAINT customer_customizations_pkey PRIMARY KEY (id);


--
-- TOC entry 4047 (class 2606 OID 17635)
-- Name: customer_customizations customer_customizations_tap_profile_id_customization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_customizations
    ADD CONSTRAINT customer_customizations_tap_profile_id_customization_id_key UNIQUE (tap_profile_id, customization_id);


--
-- TOC entry 4002 (class 2606 OID 17508)
-- Name: customers customers_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_customer_id_key UNIQUE (customer_id);


--
-- TOC entry 4004 (class 2606 OID 17504)
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- TOC entry 4007 (class 2606 OID 17506)
-- Name: customers customers_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_key UNIQUE (user_id);


--
-- TOC entry 4040 (class 2606 OID 17621)
-- Name: customizations customizations_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customizations
    ADD CONSTRAINT customizations_code_key UNIQUE (code);


--
-- TOC entry 4042 (class 2606 OID 17619)
-- Name: customizations customizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customizations
    ADD CONSTRAINT customizations_pkey PRIMARY KEY (id);


--
-- TOC entry 4070 (class 2606 OID 25591)
-- Name: entitlements entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_pkey PRIMARY KEY (id);


--
-- TOC entry 4072 (class 2606 OID 25593)
-- Name: entitlements entitlements_user_type_key_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_user_type_key_unique UNIQUE (user_id, type, key);


--
-- TOC entry 4127 (class 2606 OID 41872)
-- Name: inventory_movements inventory_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_pkey PRIMARY KEY (id);


--
-- TOC entry 4084 (class 2606 OID 25716)
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- TOC entry 4107 (class 2606 OID 26020)
-- Name: order_item_fulfillment_actions order_item_fulfillment_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_fulfillment_actions
    ADD CONSTRAINT order_item_fulfillment_actions_pkey PRIMARY KEY (order_item_id, action);


--
-- TOC entry 4081 (class 2606 OID 25692)
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- TOC entry 4135 (class 2606 OID 50311)
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- TOC entry 3982 (class 2606 OID 26001)
-- Name: orders orders_fulfillment_status_valid; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.orders
    ADD CONSTRAINT orders_fulfillment_status_valid CHECK ((fulfillment_status = ANY (ARRAY['pending'::text, 'processing'::text, 'retry'::text, 'fulfilled'::text]))) NOT VALID;


--
-- TOC entry 4058 (class 2606 OID 25526)
-- Name: orders orders_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_id_key UNIQUE (order_id);


--
-- TOC entry 4060 (class 2606 OID 25524)
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- TOC entry 4066 (class 2606 OID 25574)
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- TOC entry 4068 (class 2606 OID 25576)
-- Name: payments payments_provider_payment_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_provider_payment_id_key UNIQUE (provider_payment_id);


--
-- TOC entry 4063 (class 2606 OID 25546)
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- TOC entry 4010 (class 2606 OID 17532)
-- Name: profiles profiles_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_customer_id_key UNIQUE (customer_id);


--
-- TOC entry 4012 (class 2606 OID 17530)
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- TOC entry 4094 (class 2606 OID 25765)
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- TOC entry 4088 (class 2606 OID 25742)
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- TOC entry 4090 (class 2606 OID 25744)
-- Name: support_tickets support_tickets_reference_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_reference_key UNIQUE (reference);


--
-- TOC entry 4103 (class 2606 OID 25956)
-- Name: tap_event_themes tap_event_themes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_event_themes
    ADD CONSTRAINT tap_event_themes_code_key UNIQUE (code);


--
-- TOC entry 4105 (class 2606 OID 25954)
-- Name: tap_event_themes tap_event_themes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_event_themes
    ADD CONSTRAINT tap_event_themes_pkey PRIMARY KEY (id);


--
-- TOC entry 4097 (class 2606 OID 25786)
-- Name: tap_events tap_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_events
    ADD CONSTRAINT tap_events_pkey PRIMARY KEY (id);


--
-- TOC entry 4022 (class 2606 OID 17568)
-- Name: tap_profiles tap_profiles_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_customer_id_key UNIQUE (customer_id);


--
-- TOC entry 3971 (class 2606 OID 25881)
-- Name: tap_profiles tap_profiles_experience_valid; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.tap_profiles
    ADD CONSTRAINT tap_profiles_experience_valid CHECK ((selected_ui_tier = ANY (ARRAY['essential'::text, 'business'::text, 'premium'::text, 'goat'::text]))) NOT VALID;


--
-- TOC entry 4024 (class 2606 OID 17566)
-- Name: tap_profiles tap_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_pkey PRIMARY KEY (id);


--
-- TOC entry 3972 (class 2606 OID 25892)
-- Name: tap_profiles tap_profiles_status_valid; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.tap_profiles
    ADD CONSTRAINT tap_profiles_status_valid CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text]))) NOT VALID;


--
-- TOC entry 4027 (class 2606 OID 17570)
-- Name: tap_profiles tap_profiles_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_username_key UNIQUE (username);


--
-- TOC entry 4014 (class 2606 OID 17554)
-- Name: ui_plans ui_plans_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_plans
    ADD CONSTRAINT ui_plans_code_key UNIQUE (code);


--
-- TOC entry 4016 (class 2606 OID 17552)
-- Name: ui_plans ui_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ui_plans
    ADD CONSTRAINT ui_plans_pkey PRIMARY KEY (id);


--
-- TOC entry 4076 (class 2606 OID 25615)
-- Name: webhook_events webhook_events_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_event_id_key UNIQUE (event_id);


--
-- TOC entry 4078 (class 2606 OID 25613)
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- TOC entry 4030 (class 1259 OID 17653)
-- Name: cards_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cards_customer_id_idx ON public.cards USING btree (customer_id);


--
-- TOC entry 4033 (class 1259 OID 17654)
-- Name: cards_tap_profile_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cards_tap_profile_id_idx ON public.cards USING btree (tap_profile_id);


--
-- TOC entry 4043 (class 1259 OID 17655)
-- Name: customer_customizations_customer_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customer_customizations_customer_id_idx ON public.customer_customizations USING btree (customer_id);


--
-- TOC entry 4005 (class 1259 OID 17651)
-- Name: customers_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX customers_user_id_idx ON public.customers USING btree (user_id);


--
-- TOC entry 4100 (class 1259 OID 25922)
-- Name: idx_account_events_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_account_events_user ON public.account_events USING btree (user_id, created_at DESC);


--
-- TOC entry 4112 (class 1259 OID 41812)
-- Name: idx_admin_audit_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_created ON public.admin_audit_log USING btree (created_at DESC);


--
-- TOC entry 4113 (class 1259 OID 41813)
-- Name: idx_admin_audit_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_audit_entity ON public.admin_audit_log USING btree (entity_type, entity_id);


--
-- TOC entry 4116 (class 1259 OID 41830)
-- Name: idx_admin_notifications_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notifications_created ON public.admin_notifications USING btree (created_at DESC);


--
-- TOC entry 4117 (class 1259 OID 41831)
-- Name: idx_admin_notifications_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_notifications_pending ON public.admin_notifications USING btree (created_at) WHERE (pushed_at IS NULL);


--
-- TOC entry 4122 (class 1259 OID 41863)
-- Name: idx_admin_push_tokens_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_push_tokens_admin ON public.admin_push_tokens USING btree (admin_id) WHERE (revoked_at IS NULL);


--
-- TOC entry 4123 (class 1259 OID 41862)
-- Name: idx_admin_push_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_admin_push_tokens_token ON public.admin_push_tokens USING btree (expo_token);


--
-- TOC entry 4000 (class 1259 OID 41783)
-- Name: idx_admin_users_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_admin_users_user ON public.admin_users USING btree (user_id);


--
-- TOC entry 4130 (class 1259 OID 50258)
-- Name: idx_card_otp_challenges_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_card_otp_challenges_user_created ON public.card_otp_challenges USING btree (user_id, created_at DESC);


--
-- TOC entry 4034 (class 1259 OID 49967)
-- Name: idx_cards_activation_code; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cards_activation_code ON public.cards USING btree (activation_code);


--
-- TOC entry 4035 (class 1259 OID 50273)
-- Name: idx_cards_edition_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cards_edition_serial ON public.cards USING btree (edition_design, edition_serial) WHERE (edition_serial IS NOT NULL);


--
-- TOC entry 4036 (class 1259 OID 25971)
-- Name: idx_cards_order_sku_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cards_order_sku_slot ON public.cards USING btree (order_id, sku, card_slot) WHERE (order_id IS NOT NULL);


--
-- TOC entry 4037 (class 1259 OID 25704)
-- Name: idx_cards_uid; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cards_uid ON public.cards USING btree (card_uid) WHERE (card_uid IS NOT NULL);


--
-- TOC entry 4038 (class 1259 OID 25703)
-- Name: idx_cards_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_user ON public.cards USING btree (user_id);


--
-- TOC entry 4048 (class 1259 OID 25985)
-- Name: idx_customer_customizations_customization_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_customizations_customization_id ON public.customer_customizations USING btree (customization_id);


--
-- TOC entry 4073 (class 1259 OID 25986)
-- Name: idx_entitlements_source_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_source_order_id ON public.entitlements USING btree (source_order_id);


--
-- TOC entry 4074 (class 1259 OID 25604)
-- Name: idx_entitlements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entitlements_user ON public.entitlements USING btree (user_id);


--
-- TOC entry 4124 (class 1259 OID 50145)
-- Name: idx_inventory_movements_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_sku ON public.inventory_movements USING btree (sku, created_at DESC);


--
-- TOC entry 4125 (class 1259 OID 41883)
-- Name: idx_inventory_movements_sku_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_movements_sku_created ON public.inventory_movements USING btree (sku, created_at DESC);


--
-- TOC entry 4082 (class 1259 OID 25722)
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- TOC entry 4079 (class 1259 OID 25698)
-- Name: idx_order_items_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order ON public.order_items USING btree (order_id);


--
-- TOC entry 4049 (class 1259 OID 50148)
-- Name: idx_orders_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created ON public.orders USING btree (created_at DESC);


--
-- TOC entry 4050 (class 1259 OID 25987)
-- Name: idx_orders_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_id ON public.orders USING btree (customer_id);


--
-- TOC entry 4051 (class 1259 OID 50150)
-- Name: idx_orders_order_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_status ON public.orders USING btree (order_status);


--
-- TOC entry 4052 (class 1259 OID 50149)
-- Name: idx_orders_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_status ON public.orders USING btree (payment_status);


--
-- TOC entry 4053 (class 1259 OID 25559)
-- Name: idx_orders_razorpay_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_orders_razorpay_order_id ON public.orders USING btree (razorpay_order_id) WHERE (razorpay_order_id IS NOT NULL);


--
-- TOC entry 4054 (class 1259 OID 25560)
-- Name: idx_orders_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_created ON public.orders USING btree (user_id, created_at DESC);


--
-- TOC entry 4055 (class 1259 OID 25548)
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);


--
-- TOC entry 4064 (class 1259 OID 25582)
-- Name: idx_payments_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order ON public.payments USING btree (order_id);


--
-- TOC entry 4061 (class 1259 OID 25619)
-- Name: idx_products_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_products_sku ON public.products USING btree (sku);


--
-- TOC entry 4008 (class 1259 OID 25547)
-- Name: idx_profiles_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_customer_id ON public.profiles USING btree (customer_id);


--
-- TOC entry 4091 (class 1259 OID 25988)
-- Name: idx_support_messages_author_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_author_id ON public.support_messages USING btree (author_id);


--
-- TOC entry 4092 (class 1259 OID 25989)
-- Name: idx_support_messages_ticket_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_ticket_id ON public.support_messages USING btree (ticket_id);


--
-- TOC entry 4085 (class 1259 OID 25990)
-- Name: idx_support_tickets_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_order_id ON public.support_tickets USING btree (order_id);


--
-- TOC entry 4086 (class 1259 OID 25991)
-- Name: idx_support_tickets_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_tickets_user_id ON public.support_tickets USING btree (user_id);


--
-- TOC entry 4095 (class 1259 OID 25792)
-- Name: idx_tap_events_profile_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tap_events_profile_time ON public.tap_events USING btree (tap_profile_id, occurred_at DESC);


--
-- TOC entry 4017 (class 1259 OID 25673)
-- Name: idx_tap_profiles_slug_ci; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tap_profiles_slug_ci ON public.tap_profiles USING btree (lower(slug)) WHERE (slug IS NOT NULL);


--
-- TOC entry 4018 (class 1259 OID 25992)
-- Name: idx_tap_profiles_ui_plan_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tap_profiles_ui_plan_id ON public.tap_profiles USING btree (ui_plan_id);


--
-- TOC entry 4019 (class 1259 OID 25672)
-- Name: idx_tap_profiles_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_tap_profiles_user ON public.tap_profiles USING btree (user_id);


--
-- TOC entry 4020 (class 1259 OID 25549)
-- Name: idx_tap_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tap_profiles_user_id ON public.tap_profiles USING btree (user_id);


--
-- TOC entry 4133 (class 1259 OID 50317)
-- Name: order_status_history_order_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX order_status_history_order_created_idx ON public.order_status_history USING btree (order_id, created_at DESC);


--
-- TOC entry 4056 (class 1259 OID 26002)
-- Name: orders_fulfillment_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orders_fulfillment_retry_idx ON public.orders USING btree (fulfillment_status, updated_at) WHERE (fulfillment_status = ANY (ARRAY['processing'::text, 'retry'::text]));


--
-- TOC entry 4101 (class 1259 OID 25996)
-- Name: tap_event_themes_active_dates_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tap_event_themes_active_dates_idx ON public.tap_event_themes USING btree (starts_on, ends_on, priority DESC) WHERE active;


--
-- TOC entry 4025 (class 1259 OID 17652)
-- Name: tap_profiles_username_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tap_profiles_username_idx ON public.tap_profiles USING btree (username);


--
-- TOC entry 4178 (class 2620 OID 50320)
-- Name: orders orders_status_history_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_status_history_trigger AFTER INSERT OR UPDATE OF order_status, tracking_number, shipping_carrier ON public.orders FOR EACH ROW EXECUTE FUNCTION public.record_order_status_history();


--
-- TOC entry 4176 (class 2620 OID 49966)
-- Name: cards trg_cards_activation_code; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cards_activation_code BEFORE INSERT ON public.cards FOR EACH ROW EXECUTE FUNCTION public.cards_issue_activation_code();


--
-- TOC entry 4177 (class 2620 OID 50276)
-- Name: cards trg_cards_assign_edition; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cards_assign_edition BEFORE INSERT ON public.cards FOR EACH ROW EXECUTE FUNCTION public.cards_assign_edition();


--
-- TOC entry 4186 (class 2620 OID 25930)
-- Name: entitlements trg_entitlements_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_entitlements_events AFTER INSERT OR UPDATE ON public.entitlements FOR EACH ROW EXECUTE FUNCTION public.account_events_from_entitlement();


--
-- TOC entry 4187 (class 2620 OID 25726)
-- Name: notifications trg_notifications_read_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_notifications_read_only BEFORE UPDATE ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.notifications_only_read_state();


--
-- TOC entry 4179 (class 2620 OID 50201)
-- Name: orders trg_orders_admin_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_admin_notify AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.admin_notify_order_event();


--
-- TOC entry 4180 (class 2620 OID 25928)
-- Name: orders trg_orders_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_events AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.account_events_from_order();


--
-- TOC entry 4181 (class 2620 OID 25728)
-- Name: orders trg_orders_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_notify AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.notify_order_change();


--
-- TOC entry 4182 (class 2620 OID 50324)
-- Name: orders trg_orders_provision_tap; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_provision_tap AFTER UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.provision_tap_on_payment();


--
-- TOC entry 4183 (class 2620 OID 25562)
-- Name: orders trg_orders_server_only_payment_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_server_only_payment_status BEFORE INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_server_only_payment_status();


--
-- TOC entry 4184 (class 2620 OID 25622)
-- Name: orders trg_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 4185 (class 2620 OID 50203)
-- Name: products trg_products_admin_low_stock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_products_admin_low_stock AFTER UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION public.admin_notify_low_stock();


--
-- TOC entry 4172 (class 2620 OID 25623)
-- Name: profiles trg_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- TOC entry 4188 (class 2620 OID 50205)
-- Name: support_tickets trg_support_admin_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_admin_notify AFTER INSERT ON public.support_tickets FOR EACH ROW EXECUTE FUNCTION public.admin_notify_new_ticket();


--
-- TOC entry 4189 (class 2620 OID 50207)
-- Name: support_messages trg_support_messages_admin_notify; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_support_messages_admin_notify AFTER INSERT ON public.support_messages FOR EACH ROW EXECUTE FUNCTION public.admin_notify_ticket_reply();


--
-- TOC entry 4173 (class 2620 OID 25894)
-- Name: tap_profiles trg_tap_profiles_00_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tap_profiles_00_status BEFORE INSERT OR UPDATE ON public.tap_profiles FOR EACH ROW EXECUTE FUNCTION public.tap_profiles_sync_status();


--
-- TOC entry 4174 (class 2620 OID 25998)
-- Name: tap_profiles trg_tap_profiles_edit_rules; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tap_profiles_edit_rules BEFORE UPDATE ON public.tap_profiles FOR EACH ROW EXECUTE FUNCTION public.enforce_tap_edit_rules();


--
-- TOC entry 4175 (class 2620 OID 25926)
-- Name: tap_profiles trg_tap_profiles_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_tap_profiles_events AFTER INSERT OR UPDATE ON public.tap_profiles FOR EACH ROW EXECUTE FUNCTION public.account_events_from_tap();


--
-- TOC entry 4159 (class 2606 OID 25917)
-- Name: account_events account_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_events
    ADD CONSTRAINT account_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4161 (class 2606 OID 41792)
-- Name: admin_allowed_email_domains admin_allowed_email_domains_added_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_allowed_email_domains
    ADD CONSTRAINT admin_allowed_email_domains_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- TOC entry 4162 (class 2606 OID 41807)
-- Name: admin_audit_log admin_audit_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE RESTRICT;


--
-- TOC entry 4164 (class 2606 OID 41843)
-- Name: admin_notification_reads admin_notification_reads_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notification_reads
    ADD CONSTRAINT admin_notification_reads_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4165 (class 2606 OID 41838)
-- Name: admin_notification_reads admin_notification_reads_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notification_reads
    ADD CONSTRAINT admin_notification_reads_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.admin_notifications(id) ON DELETE CASCADE;


--
-- TOC entry 4163 (class 2606 OID 41825)
-- Name: admin_notifications admin_notifications_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_notifications
    ADD CONSTRAINT admin_notifications_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4166 (class 2606 OID 41857)
-- Name: admin_push_tokens admin_push_tokens_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_push_tokens
    ADD CONSTRAINT admin_push_tokens_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4136 (class 2606 OID 17488)
-- Name: admin_users admin_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_users
    ADD CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4169 (class 2606 OID 50253)
-- Name: card_otp_challenges card_otp_challenges_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_otp_challenges
    ADD CONSTRAINT card_otp_challenges_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- TOC entry 4170 (class 2606 OID 50248)
-- Name: card_otp_challenges card_otp_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.card_otp_challenges
    ADD CONSTRAINT card_otp_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4142 (class 2606 OID 17596)
-- Name: cards cards_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;


--
-- TOC entry 4143 (class 2606 OID 17601)
-- Name: cards cards_tap_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_tap_profile_id_fkey FOREIGN KEY (tap_profile_id) REFERENCES public.tap_profiles(id) ON DELETE SET NULL;


--
-- TOC entry 4144 (class 2606 OID 17636)
-- Name: customer_customizations customer_customizations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_customizations
    ADD CONSTRAINT customer_customizations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- TOC entry 4145 (class 2606 OID 17646)
-- Name: customer_customizations customer_customizations_customization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_customizations
    ADD CONSTRAINT customer_customizations_customization_id_fkey FOREIGN KEY (customization_id) REFERENCES public.customizations(id) ON DELETE RESTRICT;


--
-- TOC entry 4146 (class 2606 OID 17641)
-- Name: customer_customizations customer_customizations_tap_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_customizations
    ADD CONSTRAINT customer_customizations_tap_profile_id_fkey FOREIGN KEY (tap_profile_id) REFERENCES public.tap_profiles(id) ON DELETE CASCADE;


--
-- TOC entry 4137 (class 2606 OID 17509)
-- Name: customers customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4150 (class 2606 OID 25599)
-- Name: entitlements entitlements_source_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_source_order_id_fkey FOREIGN KEY (source_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4151 (class 2606 OID 25594)
-- Name: entitlements entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entitlements
    ADD CONSTRAINT entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4167 (class 2606 OID 41873)
-- Name: inventory_movements inventory_movements_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- TOC entry 4168 (class 2606 OID 41878)
-- Name: inventory_movements inventory_movements_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_movements
    ADD CONSTRAINT inventory_movements_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4153 (class 2606 OID 25717)
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4160 (class 2606 OID 26021)
-- Name: order_item_fulfillment_actions order_item_fulfillment_actions_order_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_item_fulfillment_actions
    ADD CONSTRAINT order_item_fulfillment_actions_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;


--
-- TOC entry 4152 (class 2606 OID 25693)
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 4171 (class 2606 OID 50312)
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 4147 (class 2606 OID 25532)
-- Name: orders orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- TOC entry 4148 (class 2606 OID 25527)
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4149 (class 2606 OID 25577)
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- TOC entry 4138 (class 2606 OID 17533)
-- Name: profiles profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- TOC entry 4156 (class 2606 OID 25771)
-- Name: support_messages support_messages_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- TOC entry 4157 (class 2606 OID 25766)
-- Name: support_messages support_messages_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.support_tickets(id) ON DELETE CASCADE;


--
-- TOC entry 4154 (class 2606 OID 25750)
-- Name: support_tickets support_tickets_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- TOC entry 4155 (class 2606 OID 25745)
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4158 (class 2606 OID 25787)
-- Name: tap_events tap_events_tap_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_events
    ADD CONSTRAINT tap_events_tap_profile_id_fkey FOREIGN KEY (tap_profile_id) REFERENCES public.tap_profiles(id) ON DELETE CASCADE;


--
-- TOC entry 4139 (class 2606 OID 17571)
-- Name: tap_profiles tap_profiles_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- TOC entry 4140 (class 2606 OID 41884)
-- Name: tap_profiles tap_profiles_suspended_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_suspended_by_fkey FOREIGN KEY (suspended_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- TOC entry 4141 (class 2606 OID 17576)
-- Name: tap_profiles tap_profiles_ui_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tap_profiles
    ADD CONSTRAINT tap_profiles_ui_plan_id_fkey FOREIGN KEY (ui_plan_id) REFERENCES public.ui_plans(id);


--
-- TOC entry 4384 (class 3256 OID 26003)
-- Name: payments Customers can view payments for their orders; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Customers can view payments for their orders" ON public.payments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders
  WHERE ((orders.id = payments.order_id) AND (orders.user_id = ( SELECT auth.uid() AS uid))))));


--
-- TOC entry 4356 (class 0 OID 25908)
-- Dependencies: 324
-- Name: account_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_events ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4382 (class 3256 OID 25983)
-- Name: account_events account_events_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY account_events_select_own ON public.account_events FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4395 (class 3256 OID 41895)
-- Name: admin_allowed_email_domains admin_allowed_domains_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_allowed_domains_admin_select ON public.admin_allowed_email_domains FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- TOC entry 4359 (class 0 OID 41784)
-- Dependencies: 331
-- Name: admin_allowed_email_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_allowed_email_domains ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4360 (class 0 OID 41797)
-- Dependencies: 332
-- Name: admin_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4403 (class 3256 OID 50139)
-- Name: admin_audit_log admin_audit_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_audit_select ON public.admin_audit_log FOR SELECT TO authenticated USING (public.admin_has('audit.read'::text));


--
-- TOC entry 4402 (class 3256 OID 50138)
-- Name: admin_allowed_email_domains admin_domains_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_domains_select ON public.admin_allowed_email_domains FOR SELECT TO authenticated USING (public.admin_has('admins.manage'::text));


--
-- TOC entry 4362 (class 0 OID 41832)
-- Dependencies: 334
-- Name: admin_notification_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4406 (class 3256 OID 50143)
-- Name: admin_notification_reads admin_notification_reads_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_insert_own ON public.admin_notification_reads FOR INSERT TO authenticated WITH CHECK (((admin_id = auth.uid()) AND public.is_admin()));


--
-- TOC entry 4405 (class 3256 OID 50142)
-- Name: admin_notification_reads admin_notification_reads_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_own ON public.admin_notification_reads FOR SELECT TO authenticated USING ((admin_id = auth.uid()));


--
-- TOC entry 4399 (class 3256 OID 41900)
-- Name: admin_notification_reads admin_notification_reads_own_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_own_delete ON public.admin_notification_reads FOR DELETE TO authenticated USING ((admin_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4397 (class 3256 OID 41898)
-- Name: admin_notification_reads admin_notification_reads_own_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_own_insert ON public.admin_notification_reads FOR INSERT TO authenticated WITH CHECK ((admin_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4396 (class 3256 OID 41897)
-- Name: admin_notification_reads admin_notification_reads_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_own_select ON public.admin_notification_reads FOR SELECT TO authenticated USING ((admin_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4398 (class 3256 OID 41899)
-- Name: admin_notification_reads admin_notification_reads_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notification_reads_own_update ON public.admin_notification_reads FOR UPDATE TO authenticated USING ((admin_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((admin_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4361 (class 0 OID 41814)
-- Dependencies: 333
-- Name: admin_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4404 (class 3256 OID 50141)
-- Name: admin_notifications admin_notifications_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_notifications_select ON public.admin_notifications FOR SELECT TO authenticated USING ((public.is_admin() AND ((admin_id IS NULL) OR (admin_id = auth.uid()))));


--
-- TOC entry 4363 (class 0 OID 41848)
-- Dependencies: 335
-- Name: admin_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4407 (class 3256 OID 50144)
-- Name: admin_push_tokens admin_push_tokens_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_push_tokens_own ON public.admin_push_tokens FOR SELECT TO authenticated USING ((admin_id = auth.uid()));


--
-- TOC entry 4338 (class 0 OID 17478)
-- Dependencies: 305
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4420 (class 3256 OID 50162)
-- Name: admin_users admin_users_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_users_select_admin ON public.admin_users FOR SELECT TO authenticated USING (public.is_admin());


--
-- TOC entry 4394 (class 3256 OID 41890)
-- Name: admin_users admin_users_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_users_self_read ON public.admin_users FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4366 (class 0 OID 50260)
-- Dependencies: 343
-- Name: card_editions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_editions ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4421 (class 3256 OID 50272)
-- Name: card_editions card_editions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY card_editions_public_read ON public.card_editions FOR SELECT USING (true);


--
-- TOC entry 4365 (class 0 OID 50237)
-- Dependencies: 342
-- Name: card_otp_challenges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.card_otp_challenges ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4343 (class 0 OID 17581)
-- Dependencies: 310
-- Name: cards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4415 (class 3256 OID 50157)
-- Name: cards cards_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_select_admin ON public.cards FOR SELECT TO authenticated USING (public.admin_has('orders.read'::text));


--
-- TOC entry 4373 (class 3256 OID 25974)
-- Name: cards cards_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cards_select_owner_or_admin ON public.cards FOR SELECT USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4345 (class 0 OID 17622)
-- Dependencies: 312
-- Name: customer_customizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customer_customizations ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4369 (class 3256 OID 25962)
-- Name: customer_customizations customer_customizations_api_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_customizations_api_none ON public.customer_customizations USING (false) WITH CHECK (false);


--
-- TOC entry 4339 (class 0 OID 17493)
-- Dependencies: 306
-- Name: customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4370 (class 3256 OID 25963)
-- Name: customers customers_api_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_api_none ON public.customers USING (false) WITH CHECK (false);


--
-- TOC entry 4344 (class 0 OID 17606)
-- Dependencies: 311
-- Name: customizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.customizations ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4371 (class 3256 OID 25964)
-- Name: customizations customizations_api_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customizations_api_none ON public.customizations USING (false) WITH CHECK (false);


--
-- TOC entry 4349 (class 0 OID 25584)
-- Dependencies: 317
-- Name: entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4414 (class 3256 OID 50156)
-- Name: entitlements entitlements_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlements_select_admin ON public.entitlements FOR SELECT TO authenticated USING (public.admin_has('entitlements.read'::text));


--
-- TOC entry 4383 (class 3256 OID 25984)
-- Name: entitlements entitlements_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY entitlements_select_own ON public.entitlements FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- TOC entry 4364 (class 0 OID 41864)
-- Dependencies: 336
-- Name: inventory_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4408 (class 3256 OID 50146)
-- Name: inventory_movements inventory_movements_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_movements_admin_select ON public.inventory_movements FOR SELECT TO authenticated USING (public.admin_has('inventory.read'::text));


--
-- TOC entry 4352 (class 0 OID 25707)
-- Dependencies: 320
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4374 (class 3256 OID 25975)
-- Name: notifications notifications_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_select_owner_or_admin ON public.notifications FOR SELECT USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4390 (class 3256 OID 26009)
-- Name: notifications notifications_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- TOC entry 4358 (class 0 OID 26013)
-- Dependencies: 326
-- Name: order_item_fulfillment_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_item_fulfillment_actions ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4393 (class 3256 OID 26026)
-- Name: order_item_fulfillment_actions order_item_fulfillment_actions_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_item_fulfillment_actions_none ON public.order_item_fulfillment_actions USING (false) WITH CHECK (false);


--
-- TOC entry 4351 (class 0 OID 25679)
-- Dependencies: 319
-- Name: order_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4410 (class 3256 OID 50152)
-- Name: order_items order_items_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_select_admin ON public.order_items FOR SELECT TO authenticated USING (public.admin_has('orders.read'::text));


--
-- TOC entry 4389 (class 3256 OID 26008)
-- Name: order_items order_items_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_items_select_own ON public.order_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_items.order_id) AND (o.user_id = ( SELECT auth.uid() AS uid))))));


--
-- TOC entry 4367 (class 0 OID 50303)
-- Dependencies: 345
-- Name: order_status_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4422 (class 3256 OID 50318)
-- Name: order_status_history order_status_history_customer_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY order_status_history_customer_read ON public.order_status_history FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.orders o
  WHERE ((o.id = order_status_history.order_id) AND (o.user_id = auth.uid())))));


--
-- TOC entry 4346 (class 0 OID 25513)
-- Dependencies: 314
-- Name: orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4409 (class 3256 OID 50151)
-- Name: orders orders_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_select_admin ON public.orders FOR SELECT TO authenticated USING (public.admin_has('orders.read'::text));


--
-- TOC entry 4375 (class 3256 OID 25976)
-- Name: orders orders_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY orders_select_owner_or_admin ON public.orders FOR SELECT USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4348 (class 0 OID 25563)
-- Dependencies: 316
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4411 (class 3256 OID 50153)
-- Name: payments payments_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_select_admin ON public.payments FOR SELECT TO authenticated USING (public.admin_has('orders.read'::text));


--
-- TOC entry 4347 (class 0 OID 25537)
-- Dependencies: 315
-- Name: products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4400 (class 3256 OID 50050)
-- Name: products products_select_active; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_select_active ON public.products FOR SELECT TO authenticated, anon USING ((active IS NOT FALSE));


--
-- TOC entry 4419 (class 3256 OID 50161)
-- Name: products products_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_select_admin ON public.products FOR SELECT TO authenticated USING (public.admin_has('products.read'::text));


--
-- TOC entry 4401 (class 3256 OID 50051)
-- Name: products products_select_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_select_admin_all ON public.products FOR SELECT TO authenticated USING (( SELECT public.is_admin() AS is_admin));


--
-- TOC entry 4340 (class 0 OID 17514)
-- Dependencies: 307
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4385 (class 3256 OID 26004)
-- Name: profiles profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- TOC entry 4412 (class 3256 OID 50154)
-- Name: profiles profiles_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_admin ON public.profiles FOR SELECT TO authenticated USING (public.admin_has('customers.read'::text));


--
-- TOC entry 4376 (class 3256 OID 25977)
-- Name: profiles profiles_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_owner_or_admin ON public.profiles FOR SELECT USING (((id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4386 (class 3256 OID 26005)
-- Name: profiles profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING ((( SELECT auth.uid() AS uid) = id)) WITH CHECK ((( SELECT auth.uid() AS uid) = id));


--
-- TOC entry 4354 (class 0 OID 25755)
-- Dependencies: 322
-- Name: support_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4392 (class 3256 OID 26011)
-- Name: support_messages support_messages_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_messages_insert_own ON public.support_messages FOR INSERT WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND ((author_role)::text = 'customer'::text) AND (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_messages.ticket_id) AND (t.user_id = ( SELECT auth.uid() AS uid)) AND ((t.status)::text <> 'closed'::text))))));


--
-- TOC entry 4417 (class 3256 OID 50159)
-- Name: support_messages support_messages_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_messages_select_admin ON public.support_messages FOR SELECT TO authenticated USING (public.admin_has('support.read'::text));


--
-- TOC entry 4378 (class 3256 OID 25979)
-- Name: support_messages support_messages_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_messages_select_owner_or_admin ON public.support_messages FOR SELECT USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.support_tickets t
  WHERE ((t.id = support_messages.ticket_id) AND (t.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- TOC entry 4353 (class 0 OID 25729)
-- Dependencies: 321
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4391 (class 3256 OID 26010)
-- Name: support_tickets support_tickets_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_tickets_insert_own ON public.support_tickets FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND ((status)::text = 'open'::text)));


--
-- TOC entry 4416 (class 3256 OID 50158)
-- Name: support_tickets support_tickets_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_tickets_select_admin ON public.support_tickets FOR SELECT TO authenticated USING (public.admin_has('support.read'::text));


--
-- TOC entry 4377 (class 3256 OID 25978)
-- Name: support_tickets support_tickets_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY support_tickets_select_owner_or_admin ON public.support_tickets FOR SELECT USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4357 (class 0 OID 25932)
-- Dependencies: 325
-- Name: tap_event_themes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tap_event_themes ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4379 (class 3256 OID 25997)
-- Name: tap_event_themes tap_event_themes_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_event_themes_none ON public.tap_event_themes USING (false) WITH CHECK (false);


--
-- TOC entry 4355 (class 0 OID 25780)
-- Dependencies: 323
-- Name: tap_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tap_events ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4418 (class 3256 OID 50160)
-- Name: tap_events tap_events_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_events_select_admin ON public.tap_events FOR SELECT TO authenticated USING (public.admin_has('analytics.read'::text));


--
-- TOC entry 4380 (class 3256 OID 25980)
-- Name: tap_events tap_events_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_events_select_owner_or_admin ON public.tap_events FOR SELECT USING ((( SELECT public.is_admin() AS is_admin) OR (EXISTS ( SELECT 1
   FROM public.tap_profiles t
  WHERE ((t.id = tap_events.tap_profile_id) AND (t.user_id = ( SELECT auth.uid() AS uid)))))));


--
-- TOC entry 4342 (class 0 OID 17555)
-- Dependencies: 309
-- Name: tap_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tap_profiles ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4387 (class 3256 OID 26006)
-- Name: tap_profiles tap_profiles_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- TOC entry 4413 (class 3256 OID 50155)
-- Name: tap_profiles tap_profiles_select_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_profiles_select_admin ON public.tap_profiles FOR SELECT TO authenticated USING (public.admin_has('tap.read'::text));


--
-- TOC entry 4381 (class 3256 OID 25981)
-- Name: tap_profiles tap_profiles_select_owner_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_profiles_select_owner_or_admin ON public.tap_profiles FOR SELECT USING (((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT public.is_admin() AS is_admin)));


--
-- TOC entry 4388 (class 3256 OID 26007)
-- Name: tap_profiles tap_profiles_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tap_profiles_update_own ON public.tap_profiles FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- TOC entry 4341 (class 0 OID 17538)
-- Dependencies: 308
-- Name: ui_plans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ui_plans ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4372 (class 3256 OID 25965)
-- Name: ui_plans ui_plans_api_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ui_plans_api_none ON public.ui_plans USING (false) WITH CHECK (false);


--
-- TOC entry 4350 (class 0 OID 25606)
-- Dependencies: 318
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4368 (class 3256 OID 25966)
-- Name: webhook_events webhook_events_api_none; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_events_api_none ON public.webhook_events USING (false) WITH CHECK (false);


--
-- TOC entry 4435 (class 0 OID 0)
-- Dependencies: 46
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- TOC entry 4436 (class 0 OID 0)
-- Dependencies: 484
-- Name: FUNCTION account_events_from_entitlement(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.account_events_from_entitlement() FROM PUBLIC;
GRANT ALL ON FUNCTION public.account_events_from_entitlement() TO service_role;


--
-- TOC entry 4437 (class 0 OID 0)
-- Dependencies: 483
-- Name: FUNCTION account_events_from_order(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.account_events_from_order() FROM PUBLIC;
GRANT ALL ON FUNCTION public.account_events_from_order() TO service_role;


--
-- TOC entry 4438 (class 0 OID 0)
-- Dependencies: 482
-- Name: FUNCTION account_events_from_tap(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.account_events_from_tap() FROM PUBLIC;
GRANT ALL ON FUNCTION public.account_events_from_tap() TO service_role;


--
-- TOC entry 4439 (class 0 OID 0)
-- Dependencies: 533
-- Name: FUNCTION admin_add_email_domain(p_domain text, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_add_email_domain(p_domain text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_add_email_domain(p_domain text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_add_email_domain(p_domain text, p_note text) TO service_role;


--
-- TOC entry 4440 (class 0 OID 0)
-- Dependencies: 521
-- Name: FUNCTION admin_adjust_stock(p_sku text, p_delta integer, p_reason text, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_adjust_stock(p_sku text, p_delta integer, p_reason text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_adjust_stock(p_sku text, p_delta integer, p_reason text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_adjust_stock(p_sku text, p_delta integer, p_reason text, p_note text) TO service_role;


--
-- TOC entry 4441 (class 0 OID 0)
-- Dependencies: 528
-- Name: FUNCTION admin_analytics(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_analytics(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_analytics(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_analytics(p_days integer) TO service_role;


--
-- TOC entry 4442 (class 0 OID 0)
-- Dependencies: 505
-- Name: FUNCTION admin_audit(p_admin uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_audit(p_admin uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_audit(p_admin uuid, p_action text, p_entity_type text, p_entity_id text, p_metadata jsonb) TO service_role;


--
-- TOC entry 4443 (class 0 OID 0)
-- Dependencies: 510
-- Name: FUNCTION admin_cancel_order(p_order_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_cancel_order(p_order_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_cancel_order(p_order_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_cancel_order(p_order_id uuid, p_reason text) TO service_role;


--
-- TOC entry 4444 (class 0 OID 0)
-- Dependencies: 506
-- Name: FUNCTION admin_dashboard(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_dashboard() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_dashboard() TO authenticated;
GRANT ALL ON FUNCTION public.admin_dashboard() TO service_role;


--
-- TOC entry 4445 (class 0 OID 0)
-- Dependencies: 512
-- Name: FUNCTION admin_get_customer(p_user_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_customer(p_user_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_customer(p_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_customer(p_user_id uuid) TO service_role;


--
-- TOC entry 4446 (class 0 OID 0)
-- Dependencies: 508
-- Name: FUNCTION admin_get_order(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_order(p_order_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_order(p_order_id uuid) TO service_role;


--
-- TOC entry 4447 (class 0 OID 0)
-- Dependencies: 515
-- Name: FUNCTION admin_get_tap(p_tap_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_tap(p_tap_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_tap(p_tap_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_tap(p_tap_id uuid) TO service_role;


--
-- TOC entry 4448 (class 0 OID 0)
-- Dependencies: 525
-- Name: FUNCTION admin_get_ticket(p_ticket_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_get_ticket(p_ticket_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_get_ticket(p_ticket_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.admin_get_ticket(p_ticket_id uuid) TO service_role;


--
-- TOC entry 4449 (class 0 OID 0)
-- Dependencies: 517
-- Name: FUNCTION admin_grant_entitlement(p_user_id uuid, p_type text, p_key text, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_grant_entitlement(p_user_id uuid, p_type text, p_key text, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_grant_entitlement(p_user_id uuid, p_type text, p_key text, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_grant_entitlement(p_user_id uuid, p_type text, p_key text, p_reason text) TO service_role;


--
-- TOC entry 4450 (class 0 OID 0)
-- Dependencies: 503
-- Name: FUNCTION admin_has(p_permission text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_has(p_permission text) TO anon;
GRANT ALL ON FUNCTION public.admin_has(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_has(p_permission text) TO service_role;


--
-- TOC entry 4451 (class 0 OID 0)
-- Dependencies: 522
-- Name: FUNCTION admin_inventory_history(p_sku text, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_inventory_history(p_sku text, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_inventory_history(p_sku text, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_inventory_history(p_sku text, p_limit integer) TO service_role;


--
-- TOC entry 4452 (class 0 OID 0)
-- Dependencies: 530
-- Name: FUNCTION admin_list_admins(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_admins() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_admins() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_admins() TO service_role;


--
-- TOC entry 4453 (class 0 OID 0)
-- Dependencies: 529
-- Name: FUNCTION admin_list_audit(p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_audit(p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_audit(p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_audit(p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4454 (class 0 OID 0)
-- Dependencies: 511
-- Name: FUNCTION admin_list_customers(p_search text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_customers(p_search text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_customers(p_search text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_customers(p_search text, p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4455 (class 0 OID 0)
-- Dependencies: 532
-- Name: FUNCTION admin_list_email_domains(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_email_domains() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_email_domains() TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_email_domains() TO service_role;


--
-- TOC entry 4456 (class 0 OID 0)
-- Dependencies: 537
-- Name: FUNCTION admin_list_notifications(p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_notifications(p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_notifications(p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_notifications(p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4457 (class 0 OID 0)
-- Dependencies: 507
-- Name: FUNCTION admin_list_orders(p_search text, p_payment_status text, p_order_status text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_orders(p_search text, p_payment_status text, p_order_status text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_orders(p_search text, p_payment_status text, p_order_status text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_orders(p_search text, p_payment_status text, p_order_status text, p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4458 (class 0 OID 0)
-- Dependencies: 519
-- Name: FUNCTION admin_list_products(p_type text, p_search text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_products(p_type text, p_search text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_products(p_type text, p_search text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_products(p_type text, p_search text, p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4459 (class 0 OID 0)
-- Dependencies: 514
-- Name: FUNCTION admin_list_taps(p_search text, p_status text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_taps(p_search text, p_status text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_taps(p_search text, p_status text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_taps(p_search text, p_status text, p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4460 (class 0 OID 0)
-- Dependencies: 524
-- Name: FUNCTION admin_list_tickets(p_status text, p_search text, p_limit integer, p_offset integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_list_tickets(p_status text, p_search text, p_limit integer, p_offset integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_list_tickets(p_status text, p_search text, p_limit integer, p_offset integer) TO authenticated;
GRANT ALL ON FUNCTION public.admin_list_tickets(p_status text, p_search text, p_limit integer, p_offset integer) TO service_role;


--
-- TOC entry 4461 (class 0 OID 0)
-- Dependencies: 538
-- Name: FUNCTION admin_mark_notifications_read(p_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_mark_notifications_read(p_ids uuid[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_mark_notifications_read(p_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.admin_mark_notifications_read(p_ids uuid[]) TO service_role;


--
-- TOC entry 4462 (class 0 OID 0)
-- Dependencies: 536
-- Name: FUNCTION admin_me(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_me() FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_me() TO authenticated;
GRANT ALL ON FUNCTION public.admin_me() TO service_role;


--
-- TOC entry 4463 (class 0 OID 0)
-- Dependencies: 542
-- Name: FUNCTION admin_notify_low_stock(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_notify_low_stock() TO anon;
GRANT ALL ON FUNCTION public.admin_notify_low_stock() TO authenticated;
GRANT ALL ON FUNCTION public.admin_notify_low_stock() TO service_role;


--
-- TOC entry 4464 (class 0 OID 0)
-- Dependencies: 543
-- Name: FUNCTION admin_notify_new_ticket(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_notify_new_ticket() TO anon;
GRANT ALL ON FUNCTION public.admin_notify_new_ticket() TO authenticated;
GRANT ALL ON FUNCTION public.admin_notify_new_ticket() TO service_role;


--
-- TOC entry 4465 (class 0 OID 0)
-- Dependencies: 541
-- Name: FUNCTION admin_notify_order_event(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_notify_order_event() TO anon;
GRANT ALL ON FUNCTION public.admin_notify_order_event() TO authenticated;
GRANT ALL ON FUNCTION public.admin_notify_order_event() TO service_role;


--
-- TOC entry 4466 (class 0 OID 0)
-- Dependencies: 544
-- Name: FUNCTION admin_notify_ticket_reply(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_notify_ticket_reply() TO anon;
GRANT ALL ON FUNCTION public.admin_notify_ticket_reply() TO authenticated;
GRANT ALL ON FUNCTION public.admin_notify_ticket_reply() TO service_role;


--
-- TOC entry 4467 (class 0 OID 0)
-- Dependencies: 539
-- Name: FUNCTION admin_register_push_token(p_token text, p_platform text, p_device text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_register_push_token(p_token text, p_platform text, p_device text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_register_push_token(p_token text, p_platform text, p_device text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_register_push_token(p_token text, p_platform text, p_device text) TO service_role;


--
-- TOC entry 4468 (class 0 OID 0)
-- Dependencies: 534
-- Name: FUNCTION admin_remove_email_domain(p_domain text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_remove_email_domain(p_domain text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_remove_email_domain(p_domain text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_remove_email_domain(p_domain text) TO service_role;


--
-- TOC entry 4469 (class 0 OID 0)
-- Dependencies: 526
-- Name: FUNCTION admin_reply_ticket(p_ticket_id uuid, p_body text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_reply_ticket(p_ticket_id uuid, p_body text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_reply_ticket(p_ticket_id uuid, p_body text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_reply_ticket(p_ticket_id uuid, p_body text) TO service_role;


--
-- TOC entry 4470 (class 0 OID 0)
-- Dependencies: 518
-- Name: FUNCTION admin_revoke_entitlement(p_entitlement_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_entitlement(p_entitlement_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_entitlement(p_entitlement_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_revoke_entitlement(p_entitlement_id uuid, p_reason text) TO service_role;


--
-- TOC entry 4471 (class 0 OID 0)
-- Dependencies: 540
-- Name: FUNCTION admin_revoke_push_token(p_token text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_revoke_push_token(p_token text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_revoke_push_token(p_token text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_revoke_push_token(p_token text) TO service_role;


--
-- TOC entry 4472 (class 0 OID 0)
-- Dependencies: 502
-- Name: FUNCTION admin_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.admin_role() TO anon;
GRANT ALL ON FUNCTION public.admin_role() TO authenticated;
GRANT ALL ON FUNCTION public.admin_role() TO service_role;


--
-- TOC entry 4473 (class 0 OID 0)
-- Dependencies: 501
-- Name: FUNCTION admin_role_permissions(p_role text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_role_permissions(p_role text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_role_permissions(p_role text) TO anon;
GRANT ALL ON FUNCTION public.admin_role_permissions(p_role text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_role_permissions(p_role text) TO service_role;


--
-- TOC entry 4474 (class 0 OID 0)
-- Dependencies: 535
-- Name: FUNCTION admin_set_admin_active(p_user_id uuid, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_admin_active(p_user_id uuid, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_admin_active(p_user_id uuid, p_active boolean) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_admin_active(p_user_id uuid, p_active boolean) TO service_role;


--
-- TOC entry 4475 (class 0 OID 0)
-- Dependencies: 513
-- Name: FUNCTION admin_set_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_customer_suspension(p_user_id uuid, p_suspended boolean, p_reason text) TO service_role;


--
-- TOC entry 4476 (class 0 OID 0)
-- Dependencies: 468
-- Name: FUNCTION admin_set_product_inventory(p_product_id uuid, p_stock integer, p_active boolean); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_product_inventory(p_product_id uuid, p_stock integer, p_active boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_product_inventory(p_product_id uuid, p_stock integer, p_active boolean) TO service_role;


--
-- TOC entry 4477 (class 0 OID 0)
-- Dependencies: 516
-- Name: FUNCTION admin_set_tap_suspension(p_tap_id uuid, p_suspended boolean, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_tap_suspension(p_tap_id uuid, p_suspended boolean, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_tap_suspension(p_tap_id uuid, p_suspended boolean, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_tap_suspension(p_tap_id uuid, p_suspended boolean, p_reason text) TO service_role;


--
-- TOC entry 4478 (class 0 OID 0)
-- Dependencies: 527
-- Name: FUNCTION admin_set_ticket_status(p_ticket_id uuid, p_status text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_set_ticket_status(p_ticket_id uuid, p_status text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_set_ticket_status(p_ticket_id uuid, p_status text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_set_ticket_status(p_ticket_id uuid, p_status text) TO service_role;


--
-- TOC entry 4479 (class 0 OID 0)
-- Dependencies: 523
-- Name: FUNCTION admin_update_card(p_card_id uuid, p_status text, p_card_uid text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_card(p_card_id uuid, p_status text, p_card_uid text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_card(p_card_id uuid, p_status text, p_card_uid text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_update_card(p_card_id uuid, p_status text, p_card_uid text) TO service_role;


--
-- TOC entry 4480 (class 0 OID 0)
-- Dependencies: 467
-- Name: FUNCTION admin_update_order_shipping(p_order_id uuid, p_order_status text, p_tracking_number text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_order_shipping(p_order_id uuid, p_order_status text, p_tracking_number text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_order_shipping(p_order_id uuid, p_order_status text, p_tracking_number text) TO service_role;


--
-- TOC entry 4481 (class 0 OID 0)
-- Dependencies: 509
-- Name: FUNCTION admin_update_order_status(p_order_id uuid, p_status text, p_tracking text, p_carrier text, p_note text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text, p_carrier text, p_note text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text, p_carrier text, p_note text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_update_order_status(p_order_id uuid, p_status text, p_tracking text, p_carrier text, p_note text) TO service_role;


--
-- TOC entry 4482 (class 0 OID 0)
-- Dependencies: 520
-- Name: FUNCTION admin_update_product(p_sku text, p_patch jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_update_product(p_sku text, p_patch jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_update_product(p_sku text, p_patch jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.admin_update_product(p_sku text, p_patch jsonb) TO service_role;


--
-- TOC entry 4483 (class 0 OID 0)
-- Dependencies: 531
-- Name: FUNCTION admin_upsert_admin(p_email text, p_role text, p_display_name text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.admin_upsert_admin(p_email text, p_role text, p_display_name text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.admin_upsert_admin(p_email text, p_role text, p_display_name text) TO authenticated;
GRANT ALL ON FUNCTION public.admin_upsert_admin(p_email text, p_role text, p_display_name text) TO service_role;


--
-- TOC entry 4484 (class 0 OID 0)
-- Dependencies: 469
-- Name: FUNCTION canonical_experience(p_tier text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.canonical_experience(p_tier text) TO anon;
GRANT ALL ON FUNCTION public.canonical_experience(p_tier text) TO authenticated;
GRANT ALL ON FUNCTION public.canonical_experience(p_tier text) TO service_role;


--
-- TOC entry 4485 (class 0 OID 0)
-- Dependencies: 545
-- Name: FUNCTION card_apply_verified_action(p_user_id uuid, p_card_id uuid, p_action text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.card_apply_verified_action(p_user_id uuid, p_card_id uuid, p_action text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.card_apply_verified_action(p_user_id uuid, p_card_id uuid, p_action text) TO service_role;


--
-- TOC entry 4486 (class 0 OID 0)
-- Dependencies: 546
-- Name: FUNCTION card_design_of(p_sku text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.card_design_of(p_sku text) TO anon;
GRANT ALL ON FUNCTION public.card_design_of(p_sku text) TO authenticated;
GRANT ALL ON FUNCTION public.card_design_of(p_sku text) TO service_role;


--
-- TOC entry 4487 (class 0 OID 0)
-- Dependencies: 547
-- Name: FUNCTION cards_assign_edition(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.cards_assign_edition() FROM PUBLIC;
GRANT ALL ON FUNCTION public.cards_assign_edition() TO service_role;


--
-- TOC entry 4488 (class 0 OID 0)
-- Dependencies: 497
-- Name: FUNCTION cards_issue_activation_code(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cards_issue_activation_code() TO anon;
GRANT ALL ON FUNCTION public.cards_issue_activation_code() TO authenticated;
GRANT ALL ON FUNCTION public.cards_issue_activation_code() TO service_role;


--
-- TOC entry 4489 (class 0 OID 0)
-- Dependencies: 462
-- Name: FUNCTION claim_tap_slug(p_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_tap_slug(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_tap_slug(p_slug text) TO authenticated;
GRANT ALL ON FUNCTION public.claim_tap_slug(p_slug text) TO service_role;


--
-- TOC entry 4490 (class 0 OID 0)
-- Dependencies: 498
-- Name: FUNCTION customer_activate_card(p_card_id uuid, p_activation_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.customer_activate_card(p_card_id uuid, p_activation_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.customer_activate_card(p_card_id uuid, p_activation_code text) TO authenticated;
GRANT ALL ON FUNCTION public.customer_activate_card(p_card_id uuid, p_activation_code text) TO service_role;


--
-- TOC entry 4491 (class 0 OID 0)
-- Dependencies: 499
-- Name: FUNCTION customer_deactivate_card(p_card_id uuid, p_activation_code text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.customer_deactivate_card(p_card_id uuid, p_activation_code text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.customer_deactivate_card(p_card_id uuid, p_activation_code text) TO authenticated;
GRANT ALL ON FUNCTION public.customer_deactivate_card(p_card_id uuid, p_activation_code text) TO service_role;


--
-- TOC entry 4492 (class 0 OID 0)
-- Dependencies: 465
-- Name: FUNCTION decrement_product_stock(p_sku text, p_quantity integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.decrement_product_stock(p_sku text, p_quantity integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.decrement_product_stock(p_sku text, p_quantity integer) TO service_role;


--
-- TOC entry 4493 (class 0 OID 0)
-- Dependencies: 451
-- Name: FUNCTION enforce_server_only_payment_status(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_server_only_payment_status() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_server_only_payment_status() TO service_role;


--
-- TOC entry 4494 (class 0 OID 0)
-- Dependencies: 479
-- Name: FUNCTION enforce_tap_edit_rules(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enforce_tap_edit_rules() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enforce_tap_edit_rules() TO service_role;


--
-- TOC entry 4495 (class 0 OID 0)
-- Dependencies: 500
-- Name: FUNCTION expire_tap_cards(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.expire_tap_cards() FROM PUBLIC;
GRANT ALL ON FUNCTION public.expire_tap_cards() TO service_role;


--
-- TOC entry 4497 (class 0 OID 0)
-- Dependencies: 488
-- Name: FUNCTION fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fulfil_card_stock(p_order_item_id uuid, p_sku text, p_quantity integer) TO service_role;


--
-- TOC entry 4498 (class 0 OID 0)
-- Dependencies: 487
-- Name: FUNCTION fulfil_order(p_order_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fulfil_order(p_order_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fulfil_order(p_order_id uuid) TO service_role;


--
-- TOC entry 4499 (class 0 OID 0)
-- Dependencies: 463
-- Name: FUNCTION generate_tap_slug(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.generate_tap_slug(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.generate_tap_slug(p_user uuid) TO service_role;


--
-- TOC entry 4500 (class 0 OID 0)
-- Dependencies: 550
-- Name: FUNCTION get_card_tap_history(p_card_id uuid, p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_card_tap_history(p_card_id uuid, p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_card_tap_history(p_card_id uuid, p_limit integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_card_tap_history(p_card_id uuid, p_limit integer) TO service_role;


--
-- TOC entry 4501 (class 0 OID 0)
-- Dependencies: 480
-- Name: FUNCTION get_public_profile(p_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_profile(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_profile(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.get_public_profile(p_slug text) TO service_role;


--
-- TOC entry 4502 (class 0 OID 0)
-- Dependencies: 458
-- Name: FUNCTION get_public_tap(p_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_tap(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_tap(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.get_public_tap(p_slug text) TO service_role;
GRANT ALL ON FUNCTION public.get_public_tap(p_slug text) TO authenticated;


--
-- TOC entry 4503 (class 0 OID 0)
-- Dependencies: 473
-- Name: FUNCTION get_public_tap_state(p_slug text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_public_tap_state(p_slug text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_public_tap_state(p_slug text) TO anon;
GRANT ALL ON FUNCTION public.get_public_tap_state(p_slug text) TO service_role;


--
-- TOC entry 4504 (class 0 OID 0)
-- Dependencies: 460
-- Name: FUNCTION get_tap_analytics(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_tap_analytics(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_tap_analytics(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_tap_analytics(p_days integer) TO service_role;


--
-- TOC entry 4505 (class 0 OID 0)
-- Dependencies: 461
-- Name: FUNCTION get_tap_link_clicks(p_days integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.get_tap_link_clicks(p_days integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.get_tap_link_clicks(p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.get_tap_link_clicks(p_days integer) TO service_role;


--
-- TOC entry 4506 (class 0 OID 0)
-- Dependencies: 453
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- TOC entry 4507 (class 0 OID 0)
-- Dependencies: 466
-- Name: FUNCTION is_admin(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT ALL ON FUNCTION public.is_admin() TO service_role;
GRANT ALL ON FUNCTION public.is_admin() TO authenticated;


--
-- TOC entry 4508 (class 0 OID 0)
-- Dependencies: 481
-- Name: FUNCTION log_account_event(p_user uuid, p_type text, p_subject_type text, p_subject_id text, p_detail jsonb); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.log_account_event(p_user uuid, p_type text, p_subject_type text, p_subject_id text, p_detail jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION public.log_account_event(p_user uuid, p_type text, p_subject_type text, p_subject_id text, p_detail jsonb) TO service_role;


--
-- TOC entry 4509 (class 0 OID 0)
-- Dependencies: 486
-- Name: FUNCTION my_event_theme(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_event_theme() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_event_theme() TO authenticated;
GRANT ALL ON FUNCTION public.my_event_theme() TO service_role;


--
-- TOC entry 4510 (class 0 OID 0)
-- Dependencies: 478
-- Name: FUNCTION my_theme_options(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.my_theme_options() FROM PUBLIC;
GRANT ALL ON FUNCTION public.my_theme_options() TO authenticated;
GRANT ALL ON FUNCTION public.my_theme_options() TO service_role;


--
-- TOC entry 4511 (class 0 OID 0)
-- Dependencies: 456
-- Name: FUNCTION notifications_only_read_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notifications_only_read_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notifications_only_read_state() TO service_role;


--
-- TOC entry 4512 (class 0 OID 0)
-- Dependencies: 457
-- Name: FUNCTION notify_order_change(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.notify_order_change() FROM PUBLIC;
GRANT ALL ON FUNCTION public.notify_order_change() TO service_role;


--
-- TOC entry 4513 (class 0 OID 0)
-- Dependencies: 464
-- Name: FUNCTION provision_tap_on_payment(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.provision_tap_on_payment() FROM PUBLIC;
GRANT ALL ON FUNCTION public.provision_tap_on_payment() TO service_role;


--
-- TOC entry 4514 (class 0 OID 0)
-- Dependencies: 548
-- Name: FUNCTION record_order_status_history(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_order_status_history() FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_order_status_history() TO service_role;


--
-- TOC entry 4515 (class 0 OID 0)
-- Dependencies: 459
-- Name: FUNCTION record_tap_event(p_slug text, p_event text, p_link_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text) TO anon;
GRANT ALL ON FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text) TO service_role;
GRANT ALL ON FUNCTION public.record_tap_event(p_slug text, p_event text, p_link_key text) TO authenticated;


--
-- TOC entry 4516 (class 0 OID 0)
-- Dependencies: 551
-- Name: FUNCTION request_card_replacement(p_card_id uuid, p_reason text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.request_card_replacement(p_card_id uuid, p_reason text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.request_card_replacement(p_card_id uuid, p_reason text) TO authenticated;
GRANT ALL ON FUNCTION public.request_card_replacement(p_card_id uuid, p_reason text) TO service_role;


--
-- TOC entry 4517 (class 0 OID 0)
-- Dependencies: 504
-- Name: FUNCTION require_admin(p_permission text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.require_admin(p_permission text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.require_admin(p_permission text) TO anon;
GRANT ALL ON FUNCTION public.require_admin(p_permission text) TO authenticated;
GRANT ALL ON FUNCTION public.require_admin(p_permission text) TO service_role;


--
-- TOC entry 4518 (class 0 OID 0)
-- Dependencies: 310
-- Name: TABLE cards; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cards TO anon;
GRANT ALL ON TABLE public.cards TO authenticated;
GRANT ALL ON TABLE public.cards TO service_role;


--
-- TOC entry 4519 (class 0 OID 0)
-- Dependencies: 549
-- Name: FUNCTION set_card_nickname(p_card_id uuid, p_nickname text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.set_card_nickname(p_card_id uuid, p_nickname text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.set_card_nickname(p_card_id uuid, p_nickname text) TO authenticated;
GRANT ALL ON FUNCTION public.set_card_nickname(p_card_id uuid, p_nickname text) TO service_role;


--
-- TOC entry 4520 (class 0 OID 0)
-- Dependencies: 475
-- Name: FUNCTION tap_can_edit(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tap_can_edit(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tap_can_edit(p_user uuid) TO service_role;


--
-- TOC entry 4521 (class 0 OID 0)
-- Dependencies: 474
-- Name: FUNCTION tap_edit_interval_days(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tap_edit_interval_days() TO anon;
GRANT ALL ON FUNCTION public.tap_edit_interval_days() TO authenticated;
GRANT ALL ON FUNCTION public.tap_edit_interval_days() TO service_role;


--
-- TOC entry 4522 (class 0 OID 0)
-- Dependencies: 476
-- Name: FUNCTION tap_edit_state(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tap_edit_state() FROM PUBLIC;
GRANT ALL ON FUNCTION public.tap_edit_state() TO authenticated;
GRANT ALL ON FUNCTION public.tap_edit_state() TO service_role;


--
-- TOC entry 4523 (class 0 OID 0)
-- Dependencies: 485
-- Name: FUNCTION tap_event_theme_for(p_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.tap_event_theme_for(p_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.tap_event_theme_for(p_at timestamp with time zone) TO service_role;


--
-- TOC entry 4524 (class 0 OID 0)
-- Dependencies: 472
-- Name: FUNCTION tap_profiles_sync_status(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tap_profiles_sync_status() TO anon;
GRANT ALL ON FUNCTION public.tap_profiles_sync_status() TO authenticated;
GRANT ALL ON FUNCTION public.tap_profiles_sync_status() TO service_role;


--
-- TOC entry 4525 (class 0 OID 0)
-- Dependencies: 477
-- Name: FUNCTION theme_options(p_kind text, p_tier text, p_pass boolean); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.theme_options(p_kind text, p_tier text, p_pass boolean) TO anon;
GRANT ALL ON FUNCTION public.theme_options(p_kind text, p_tier text, p_pass boolean) TO authenticated;
GRANT ALL ON FUNCTION public.theme_options(p_kind text, p_tier text, p_pass boolean) TO service_role;


--
-- TOC entry 4526 (class 0 OID 0)
-- Dependencies: 454
-- Name: FUNCTION tier_rank(p_tier text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.tier_rank(p_tier text) TO anon;
GRANT ALL ON FUNCTION public.tier_rank(p_tier text) TO authenticated;
GRANT ALL ON FUNCTION public.tier_rank(p_tier text) TO service_role;


--
-- TOC entry 4527 (class 0 OID 0)
-- Dependencies: 452
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- TOC entry 4528 (class 0 OID 0)
-- Dependencies: 471
-- Name: FUNCTION user_has_lifetime(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_has_lifetime(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_lifetime(p_user uuid) TO service_role;


--
-- TOC entry 4529 (class 0 OID 0)
-- Dependencies: 470
-- Name: FUNCTION user_has_pass(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_has_pass(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_has_pass(p_user uuid) TO service_role;


--
-- TOC entry 4530 (class 0 OID 0)
-- Dependencies: 455
-- Name: FUNCTION user_max_ui_tier(p_user uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.user_max_ui_tier(p_user uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.user_max_ui_tier(p_user uuid) TO service_role;


--
-- TOC entry 4531 (class 0 OID 0)
-- Dependencies: 324
-- Name: TABLE account_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.account_events TO anon;
GRANT ALL ON TABLE public.account_events TO authenticated;
GRANT ALL ON TABLE public.account_events TO service_role;


--
-- TOC entry 4532 (class 0 OID 0)
-- Dependencies: 331
-- Name: TABLE admin_allowed_email_domains; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_allowed_email_domains TO service_role;


--
-- TOC entry 4533 (class 0 OID 0)
-- Dependencies: 332
-- Name: TABLE admin_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_audit_log TO service_role;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;


--
-- TOC entry 4534 (class 0 OID 0)
-- Dependencies: 334
-- Name: TABLE admin_notification_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_notification_reads TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.admin_notification_reads TO authenticated;


--
-- TOC entry 4535 (class 0 OID 0)
-- Dependencies: 333
-- Name: TABLE admin_notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_notifications TO service_role;
GRANT SELECT ON TABLE public.admin_notifications TO authenticated;


--
-- TOC entry 4536 (class 0 OID 0)
-- Dependencies: 335
-- Name: TABLE admin_push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_push_tokens TO anon;
GRANT ALL ON TABLE public.admin_push_tokens TO authenticated;
GRANT ALL ON TABLE public.admin_push_tokens TO service_role;


--
-- TOC entry 4537 (class 0 OID 0)
-- Dependencies: 305
-- Name: TABLE admin_users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.admin_users TO anon;
GRANT ALL ON TABLE public.admin_users TO authenticated;
GRANT ALL ON TABLE public.admin_users TO service_role;


--
-- TOC entry 4538 (class 0 OID 0)
-- Dependencies: 343
-- Name: TABLE card_editions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.card_editions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.card_editions TO authenticated;
GRANT ALL ON TABLE public.card_editions TO service_role;


--
-- TOC entry 4539 (class 0 OID 0)
-- Dependencies: 342
-- Name: TABLE card_otp_challenges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.card_otp_challenges TO service_role;


--
-- TOC entry 4540 (class 0 OID 0)
-- Dependencies: 312
-- Name: TABLE customer_customizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customer_customizations TO anon;
GRANT ALL ON TABLE public.customer_customizations TO authenticated;
GRANT ALL ON TABLE public.customer_customizations TO service_role;


--
-- TOC entry 4541 (class 0 OID 0)
-- Dependencies: 306
-- Name: TABLE customers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customers TO anon;
GRANT ALL ON TABLE public.customers TO authenticated;
GRANT ALL ON TABLE public.customers TO service_role;


--
-- TOC entry 4542 (class 0 OID 0)
-- Dependencies: 311
-- Name: TABLE customizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.customizations TO anon;
GRANT ALL ON TABLE public.customizations TO authenticated;
GRANT ALL ON TABLE public.customizations TO service_role;


--
-- TOC entry 4543 (class 0 OID 0)
-- Dependencies: 317
-- Name: TABLE entitlements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.entitlements TO anon;
GRANT ALL ON TABLE public.entitlements TO authenticated;
GRANT ALL ON TABLE public.entitlements TO service_role;


--
-- TOC entry 4544 (class 0 OID 0)
-- Dependencies: 336
-- Name: TABLE inventory_movements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.inventory_movements TO service_role;


--
-- TOC entry 4545 (class 0 OID 0)
-- Dependencies: 320
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- TOC entry 4546 (class 0 OID 0)
-- Dependencies: 326
-- Name: TABLE order_item_fulfillment_actions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_item_fulfillment_actions TO anon;
GRANT ALL ON TABLE public.order_item_fulfillment_actions TO authenticated;
GRANT ALL ON TABLE public.order_item_fulfillment_actions TO service_role;


--
-- TOC entry 4547 (class 0 OID 0)
-- Dependencies: 319
-- Name: TABLE order_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_items TO anon;
GRANT ALL ON TABLE public.order_items TO authenticated;
GRANT ALL ON TABLE public.order_items TO service_role;


--
-- TOC entry 4548 (class 0 OID 0)
-- Dependencies: 345
-- Name: TABLE order_status_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.order_status_history TO anon;
GRANT ALL ON TABLE public.order_status_history TO authenticated;
GRANT ALL ON TABLE public.order_status_history TO service_role;


--
-- TOC entry 4549 (class 0 OID 0)
-- Dependencies: 314
-- Name: TABLE orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.orders TO anon;
GRANT ALL ON TABLE public.orders TO authenticated;
GRANT ALL ON TABLE public.orders TO service_role;


--
-- TOC entry 4550 (class 0 OID 0)
-- Dependencies: 316
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- TOC entry 4551 (class 0 OID 0)
-- Dependencies: 315
-- Name: TABLE products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.products TO anon;
GRANT ALL ON TABLE public.products TO authenticated;
GRANT ALL ON TABLE public.products TO service_role;


--
-- TOC entry 4552 (class 0 OID 0)
-- Dependencies: 307
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;


--
-- TOC entry 4553 (class 0 OID 0)
-- Dependencies: 322
-- Name: TABLE support_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_messages TO anon;
GRANT ALL ON TABLE public.support_messages TO authenticated;
GRANT ALL ON TABLE public.support_messages TO service_role;


--
-- TOC entry 4554 (class 0 OID 0)
-- Dependencies: 321
-- Name: TABLE support_tickets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.support_tickets TO anon;
GRANT ALL ON TABLE public.support_tickets TO authenticated;
GRANT ALL ON TABLE public.support_tickets TO service_role;


--
-- TOC entry 4555 (class 0 OID 0)
-- Dependencies: 325
-- Name: TABLE tap_event_themes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tap_event_themes TO anon;
GRANT ALL ON TABLE public.tap_event_themes TO authenticated;
GRANT ALL ON TABLE public.tap_event_themes TO service_role;


--
-- TOC entry 4556 (class 0 OID 0)
-- Dependencies: 323
-- Name: TABLE tap_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tap_events TO anon;
GRANT ALL ON TABLE public.tap_events TO authenticated;
GRANT ALL ON TABLE public.tap_events TO service_role;


--
-- TOC entry 4557 (class 0 OID 0)
-- Dependencies: 309
-- Name: TABLE tap_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.tap_profiles TO anon;
GRANT ALL ON TABLE public.tap_profiles TO authenticated;
GRANT ALL ON TABLE public.tap_profiles TO service_role;


--
-- TOC entry 4558 (class 0 OID 0)
-- Dependencies: 308
-- Name: TABLE ui_plans; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ui_plans TO anon;
GRANT ALL ON TABLE public.ui_plans TO authenticated;
GRANT ALL ON TABLE public.ui_plans TO service_role;


--
-- TOC entry 4559 (class 0 OID 0)
-- Dependencies: 318
-- Name: TABLE webhook_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.webhook_events TO anon;
GRANT ALL ON TABLE public.webhook_events TO authenticated;
GRANT ALL ON TABLE public.webhook_events TO service_role;


--
-- TOC entry 2585 (class 826 OID 16494)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 2586 (class 826 OID 16495)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 2584 (class 826 OID 16493)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 2588 (class 826 OID 16497)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 2583 (class 826 OID 16492)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- TOC entry 2587 (class 826 OID 16496)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- Completed on 2026-09-30 20:24:58

--
-- PostgreSQL database dump complete
--

\unrestrict ICsbJ8Xnl9dEc6d5rap6E5VxBmFnOW9OvVTqJHxpPzANR5I4BsBNc1SfheWGu8i

