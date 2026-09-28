-- =============================================================================
-- 011 — Move the admin's internal order note off the customer-readable row
-- =============================================================================
--
-- STATUS: PROPOSED. Lives in supabase/proposed/, not supabase/migrations/, so
-- `npm run db:push` (which applies every file in migrations/) cannot run it by
-- accident. It changes production functions and moves data, so it needs the
-- owner's approval. To adopt it, move it into supabase/migrations/.
--
-- THE PROBLEM
-- Migration 003 added orders.admin_note and has admin_update_order_status write
-- the admin's free-text note there. But orders_select_own grants a customer
-- their WHOLE order row — RLS is row-level, not column-level — so any customer
-- can read the note on their own order with one request:
--
--   GET /rest/v1/orders?select=order_id,admin_note     (their own session)
--
-- Verified against migrations 001–010 as the real `authenticated` role: an
-- admin note written through admin_update_order_status came back verbatim.
-- The customer web app never displays it; it does not need to for this to leak.
--
-- WHY A TABLE, NOT COLUMN PRIVILEGES
-- Revoking SELECT on one column means revoking table-level SELECT and
-- re-granting every other column: brittle, and every future column would need
-- remembering. It would also change what Supabase Realtime can read on
-- `orders`, which the admin app subscribes to — not something PGlite can test.
-- A separate admin-only table changes nothing about `orders` access at all.
--
-- ADMIN APP CONTRACT: UNCHANGED
-- admin_get_order still returns order.admin_note in the same JSON position, and
-- admin_update_order_status keeps its signature and semantics (a blank note
-- keeps the existing one). The admin app needs no change.
--
-- ORDERING — each step is safe to stop after:
--   1. create the table        (nothing reads it yet)
--   2. replace the two RPCs    (notes not yet copied: admins briefly see none)
--   3. copy existing notes     (both copies exist; nothing lost)
--   4. clear the old copies    (the leak is closed)
--
-- SIDE EFFECT: step 4 is an UPDATE on orders, so trg_orders_updated_at moves
-- updated_at to now() on the orders that had a note. No other trigger reacts:
-- no status or payment field changes. Verified: no notifications, no Tap
-- provisioning.
--
-- The column orders.admin_note is kept (left NULL) rather than dropped, so a
-- stale admin build reading it gets null instead of an error.
-- =============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.admin_get_order(uuid)') IS NULL
     OR to_regprocedure('public.require_admin(text)') IS NULL THEN
    RAISE EXCEPTION '011 needs migration 003 (admin platform) applied first.';
  END IF;
END $$;

-- 1. The admin-only home for internal notes -----------------------------------
CREATE TABLE IF NOT EXISTS public.order_admin_notes (
  order_id   UUID PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  note       TEXT NOT NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.order_admin_notes ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: nothing but the SECURITY DEFINER admin RPCs may read
-- or write it. The admin app is RPC-only, so it needs no table grant either.
REVOKE ALL ON TABLE public.order_admin_notes FROM PUBLIC, anon, authenticated;

-- 2. The two RPCs, from 003, changed only where noted -------------------------
CREATE OR REPLACE FUNCTION public.admin_update_order_status(
  p_order_id  UUID,
  p_status    TEXT,
  p_tracking  TEXT DEFAULT NULL,
  p_carrier   TEXT DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- The note is internal. It goes to order_admin_notes, which no customer can
  -- read, rather than onto the customer's own order row. Same semantics as
  -- before: a blank note leaves the existing one in place.
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

CREATE OR REPLACE FUNCTION public.admin_get_order(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_out JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  SELECT jsonb_build_object(
    -- admin_note is spliced back in from order_admin_notes, so the admin app
    -- receives the same keys and values it has always read.
    'order', (to_jsonb(o) - 'customer_id' - 'admin_note')
             || jsonb_build_object('admin_note',
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

-- 3. Copy existing notes ------------------------------------------------------
INSERT INTO public.order_admin_notes (order_id, note, updated_at)
SELECT o.id, btrim(o.admin_note), COALESCE(o.updated_at, NOW())
FROM public.orders o
WHERE NULLIF(btrim(COALESCE(o.admin_note, '')), '') IS NOT NULL
ON CONFLICT (order_id) DO NOTHING;

-- 4. Clear the customer-readable copies ---------------------------------------
-- Only rows whose note is now safely in order_admin_notes.
UPDATE public.orders o
SET admin_note = NULL
WHERE o.admin_note IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.order_admin_notes n WHERE n.order_id = o.id);
