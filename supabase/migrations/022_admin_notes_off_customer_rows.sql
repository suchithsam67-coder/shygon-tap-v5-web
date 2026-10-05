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
