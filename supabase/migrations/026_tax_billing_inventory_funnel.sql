-- ============================================================================
-- 026 — GST, BILLING ADDRESS, ORDER TIMELINE, PHYSICAL CARD STOCK,
--       CANCELLATION REQUESTS, STORE FUNNEL, SUPPORT EMAILS
-- ============================================================================
-- Run AFTER 025. Idempotent. Additive: on live the only change to an existing
-- table is the new `kind` column on order_status_history (section 3).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. GST
-- ---------------------------------------------------------------------------
-- One row. Read by checkout (display) and by /api/create-order (the charge),
-- which stores the exact figures on the order so a later rate change never
-- rewrites an old invoice.
--
--   prices_include_tax = true   the listed price is what the customer pays;
--                               the invoice shows the GST inside it.
--   prices_include_tax = false  GST is added on top at checkout.
--
-- Intra-state supplies (shipping state = seller_state) are split CGST + SGST,
-- everything else is IGST.
CREATE TABLE IF NOT EXISTS public.tax_settings (
  id                 BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  enabled            BOOLEAN NOT NULL DEFAULT true,
  rate_percent       NUMERIC(5,2) NOT NULL DEFAULT 18 CHECK (rate_percent >= 0 AND rate_percent <= 40),
  prices_include_tax BOOLEAN NOT NULL DEFAULT true,
  gstin              TEXT CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  legal_name         TEXT,
  registered_address TEXT,
  seller_state       TEXT NOT NULL DEFAULT 'Karnataka',
  hsn_code           TEXT DEFAULT '8523',
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.tax_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.tax_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tax_settings_public_read ON public.tax_settings;
CREATE POLICY tax_settings_public_read ON public.tax_settings FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.tax_settings FROM anon, authenticated;
GRANT SELECT ON public.tax_settings TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_tax_settings(
  p_enabled            BOOLEAN,
  p_rate_percent       NUMERIC,
  p_prices_include_tax BOOLEAN,
  p_gstin              TEXT DEFAULT NULL,
  p_legal_name         TEXT DEFAULT NULL,
  p_registered_address TEXT DEFAULT NULL,
  p_seller_state       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
BEGIN
  UPDATE public.tax_settings SET
    enabled            = COALESCE(p_enabled, enabled),
    rate_percent       = COALESCE(p_rate_percent, rate_percent),
    prices_include_tax = COALESCE(p_prices_include_tax, prices_include_tax),
    gstin              = NULLIF(upper(btrim(COALESCE(p_gstin, gstin, ''))), ''),
    legal_name         = COALESCE(NULLIF(btrim(p_legal_name), ''), legal_name),
    registered_address = COALESCE(NULLIF(btrim(p_registered_address), ''), registered_address),
    seller_state       = COALESCE(NULLIF(btrim(p_seller_state), ''), seller_state),
    updated_at         = NOW()
  WHERE id;
  PERFORM public.admin_audit(v_admin, 'tax.updated', 'tax_settings', 'singleton',
    jsonb_build_object('enabled', p_enabled, 'rate', p_rate_percent, 'inclusive', p_prices_include_tax));
  RETURN (SELECT to_jsonb(t) FROM public.tax_settings t WHERE t.id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_tax_settings(BOOLEAN, NUMERIC, BOOLEAN, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_tax_settings(BOOLEAN, NUMERIC, BOOLEAN, TEXT, TEXT, TEXT, TEXT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 2. ORDER COLUMNS: TAX AND ADDRESSES
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_in_paise            INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS taxable_value_in_paise  INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_rate_percent        NUMERIC(5,2);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_inclusive           BOOLEAN;
-- cgst_sgst | igst | none
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tax_split               TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_gstin          TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_email          TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_address_line2  TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_locality       TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_country        TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_same_as_shipping BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_name            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_company         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_phone           TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_email           TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_address         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_address_line2   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_locality        TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_city            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_state           TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_pincode         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS billing_country         TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_requested_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_request_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_tax_non_negative') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_tax_non_negative CHECK (tax_in_paise >= 0) NOT VALID;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 3. ORDER TIMELINE
-- ---------------------------------------------------------------------------
-- Every status an order passes through, with its time, so the customer and the
-- Admin app can show "Paid 12 Oct 10:04 · Packed 13 Oct · Shipped 13 Oct …".
--
-- Live already has this table (uuid id, status, tracking_number,
-- shipping_carrier, note, created_at) and its own trigger,
-- orders_status_history_trigger, which records every order_status change. So
-- the table is only created where it is missing, `kind` is added to the live
-- one (its existing rows are all order-status rows), and the trigger below
-- leaves order-status rows to the live trigger when that exists, instead of
-- writing each one twice.
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- order | payment | card | request
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'order';
ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS note TEXT;
CREATE INDEX IF NOT EXISTS idx_order_status_history_order ON public.order_status_history (order_id, created_at);
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.order_status_history FROM anon, authenticated;
DROP POLICY IF EXISTS order_status_history_own ON public.order_status_history;
CREATE POLICY order_status_history_own ON public.order_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_status_history.order_id AND o.user_id = (SELECT auth.uid())));
DROP POLICY IF EXISTS order_status_history_admin ON public.order_status_history;
CREATE POLICY order_status_history_admin ON public.order_status_history FOR SELECT TO authenticated
  USING (public.admin_has('orders.read'));

CREATE OR REPLACE FUNCTION public.orders_track_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- Live's own history trigger already records order_status (see above).
  v_live_trigger BOOLEAN := EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass
      AND tgname = 'orders_status_history_trigger'
      AND NOT tgisinternal);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_live_trigger THEN
      INSERT INTO public.order_status_history (order_id, kind, status) VALUES (NEW.id, 'order', COALESCE(NEW.order_status, 'placed'));
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO public.order_status_history (order_id, kind, status) VALUES (NEW.id, 'payment', NEW.payment_status);
  END IF;
  IF NEW.order_status IS DISTINCT FROM OLD.order_status AND NOT v_live_trigger THEN
    INSERT INTO public.order_status_history (order_id, kind, status, note)
    VALUES (NEW.id, 'order', NEW.order_status,
            CASE WHEN NEW.order_status = 'shipped' THEN
              NULLIF(concat_ws(' · ', NEW.shipping_carrier, NEW.tracking_number), '') END);
  END IF;
  IF NEW.cancellation_requested_at IS NOT NULL AND OLD.cancellation_requested_at IS NULL THEN
    INSERT INTO public.order_status_history (order_id, kind, status, note)
    VALUES (NEW.id, 'request', 'cancellation_requested', NEW.cancellation_request_reason);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.orders_track_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_history ON public.orders;
CREATE TRIGGER trg_orders_history
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_track_history();

-- Backfill what the existing timestamps already say.
INSERT INTO public.order_status_history (order_id, kind, status, created_at)
SELECT o.id, 'order', 'placed', o.created_at FROM public.orders o
WHERE NOT EXISTS (SELECT 1 FROM public.order_status_history h WHERE h.order_id = o.id);


-- ---------------------------------------------------------------------------
-- 4. PHYSICAL CARD STOCK (blank NFC cards before they belong to anyone)
-- ---------------------------------------------------------------------------
-- `cards` (002/022) is a customer's card, created when an order is paid. This
-- is the shelf: blank cards with their chip ids, imported in batches, then
-- assigned to a paid order's card — which writes the chip id onto it.
--
--   unassigned -> assigned  (admin_assign_physical_card)
--   unassigned -> damaged | retired
CREATE TABLE IF NOT EXISTS public.physical_cards (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chip_uid    TEXT NOT NULL,
  design      TEXT NOT NULL,
  material    TEXT NOT NULL CHECK (material IN ('pvc', 'metal', 'transparent')),
  finish      TEXT NOT NULL DEFAULT 'standard' CHECK (finish IN ('standard', 'premium')),
  batch       TEXT,
  status      TEXT NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'damaged', 'retired')),
  card_id     UUID REFERENCES public.cards(id) ON DELETE SET NULL,
  note        TEXT,
  created_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_physical_cards_chip ON public.physical_cards (upper(chip_uid));
CREATE UNIQUE INDEX IF NOT EXISTS idx_physical_cards_card ON public.physical_cards (card_id) WHERE card_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_physical_cards_stock ON public.physical_cards (status, design, material, finish);
ALTER TABLE public.physical_cards ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.physical_cards FROM anon, authenticated;
DROP POLICY IF EXISTS physical_cards_admin ON public.physical_cards;
CREATE POLICY physical_cards_admin ON public.physical_cards FOR SELECT TO authenticated
  USING (public.admin_has('inventory.read'));

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS damaged_at   TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS chip_assigned_at TIMESTAMPTZ;

-- Adds a batch of blank cards. Chip ids already on file are skipped and
-- reported, never overwritten.
CREATE OR REPLACE FUNCTION public.admin_import_physical_cards(
  p_design    TEXT,
  p_material  TEXT,
  p_finish    TEXT,
  p_chip_uids TEXT[],
  p_batch     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin   UUID := public.require_admin('inventory.manage');
  v_uid     TEXT;
  v_added   INT := 0;
  v_skipped TEXT[] := '{}';
BEGIN
  IF COALESCE(array_length(p_chip_uids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Add at least one chip id.' USING ERRCODE = '22023';
  END IF;
  IF array_length(p_chip_uids, 1) > 1000 THEN
    RAISE EXCEPTION 'Import at most 1000 cards at a time.' USING ERRCODE = '22023';
  END IF;
  FOREACH v_uid IN ARRAY p_chip_uids LOOP
    v_uid := upper(btrim(v_uid));
    CONTINUE WHEN v_uid = '';
    IF v_uid !~ '^[0-9A-Z:\-]{4,64}$' THEN
      v_skipped := v_skipped || v_uid;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public.physical_cards WHERE upper(chip_uid) = v_uid)
       OR EXISTS (SELECT 1 FROM public.cards WHERE upper(card_uid) = v_uid) THEN
      v_skipped := v_skipped || v_uid;
      CONTINUE;
    END IF;
    INSERT INTO public.physical_cards (chip_uid, design, material, finish, batch, created_by)
    VALUES (v_uid, lower(btrim(p_design)), lower(btrim(p_material)), COALESCE(lower(btrim(p_finish)), 'standard'),
            NULLIF(btrim(COALESCE(p_batch, '')), ''), v_admin);
    v_added := v_added + 1;
  END LOOP;

  PERFORM public.admin_audit(v_admin, 'inventory.cards_imported', 'physical_cards', p_batch,
    jsonb_build_object('design', p_design, 'material', p_material, 'finish', p_finish,
                       'added', v_added, 'skipped', to_jsonb(v_skipped)));
  RETURN jsonb_build_object('added', v_added, 'skipped', to_jsonb(v_skipped));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_physical_cards(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 50,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INT := least(greatest(COALESCE(p_limit, 50), 1), 200);
  v_q     TEXT := NULLIF(upper(btrim(COALESCE(p_search, ''))), '');
BEGIN
  PERFORM public.require_admin('inventory.read');
  RETURN jsonb_build_object(
    'summary', COALESCE((SELECT jsonb_agg(s ORDER BY s->>'design', s->>'material', s->>'finish') FROM (
        SELECT jsonb_build_object('design', design, 'material', material, 'finish', finish,
          'unassigned', count(*) FILTER (WHERE status = 'unassigned'),
          'assigned', count(*) FILTER (WHERE status = 'assigned'),
          'damaged', count(*) FILTER (WHERE status = 'damaged')) AS s
        FROM public.physical_cards GROUP BY design, material, finish) x), '[]'::jsonb),
    'total', (SELECT count(*) FROM public.physical_cards p
              WHERE (p_status IS NULL OR p.status = p_status)
                AND (v_q IS NULL OR upper(p.chip_uid) LIKE '%' || v_q || '%' OR upper(COALESCE(p.batch, '')) LIKE '%' || v_q || '%')),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC) FROM (
        SELECT p.*, c.card_code FROM public.physical_cards p
        LEFT JOIN public.cards c ON c.id = p.card_id
        WHERE (p_status IS NULL OR p.status = p_status)
          AND (v_q IS NULL OR upper(p.chip_uid) LIKE '%' || v_q || '%' OR upper(COALESCE(p.batch, '')) LIKE '%' || v_q || '%')
        ORDER BY p.created_at DESC LIMIT v_limit OFFSET greatest(COALESCE(p_offset, 0), 0)) r), '[]'::jsonb)
  );
END;
$$;

-- Puts a physical card in a paid order's card: the chip id is written to the
-- customer's card, the shelf row is marked assigned, and the customer is told.
-- The chip must be on the shelf, unassigned, and of the same design, material
-- and finish the customer bought.
CREATE OR REPLACE FUNCTION public.admin_assign_physical_card(p_card_id UUID, p_chip_uid TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_uid   TEXT := upper(btrim(COALESCE(p_chip_uid, '')));
  v_card  public.cards%ROWTYPE;
  v_stock public.physical_cards%ROWTYPE;
  v_look  TEXT[];
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_card.status = 'replaced' THEN RAISE EXCEPTION 'A replaced card cannot take a chip.' USING ERRCODE = '22023'; END IF;
  IF v_card.card_uid IS NOT NULL THEN
    RAISE EXCEPTION 'This card already has chip %. Replace the card instead.', v_card.card_uid USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_stock FROM public.physical_cards WHERE upper(chip_uid) = v_uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chip % is not in stock. Import it first.', v_uid USING ERRCODE = 'P0002'; END IF;
  IF v_stock.status <> 'unassigned' THEN
    RAISE EXCEPTION 'Chip % is % and cannot be assigned.', v_uid, v_stock.status USING ERRCODE = '22023';
  END IF;

  v_look := regexp_match(COALESCE(v_card.sku, ''), '^card-(.+)-(standard|premium)-(pvc|metal|transparent)$');
  IF v_look IS NOT NULL AND (v_look[1] <> v_stock.design OR v_look[2] <> v_stock.finish OR v_look[3] <> v_stock.material) THEN
    RAISE EXCEPTION 'Chip % is a % % % card; this order needs % % %.', v_uid,
      v_stock.design, v_stock.finish, v_stock.material, v_look[1], v_look[2], v_look[3] USING ERRCODE = '22023';
  END IF;

  UPDATE public.physical_cards SET status = 'assigned', card_id = v_card.id, assigned_at = NOW(), updated_at = NOW()
  WHERE id = v_stock.id;
  UPDATE public.cards SET card_uid = v_stock.chip_uid, chip_assigned_at = NOW() WHERE id = v_card.id;

  IF v_card.order_id IS NOT NULL THEN
    INSERT INTO public.order_status_history (order_id, kind, status, note)
    VALUES (v_card.order_id, 'card', 'card_assigned', 'Card ' || COALESCE(v_card.card_code, ''));
  END IF;
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_card.user_id, 'shipping', 'Your card is being prepared',
          'Card ' || COALESCE(v_card.card_code, '') || ' has been made for your order and will be packed next.',
          '/shygontap/orders', jsonb_build_object('card_id', v_card.id));
  PERFORM public.admin_audit(v_admin, 'card.chip_assigned', 'card', v_card.id::text,
    jsonb_build_object('chip', v_stock.chip_uid, 'code', v_card.card_code));
  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = v_card.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_physical_card_status(p_chip_uid TEXT, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('inventory.manage');
BEGIN
  IF p_status NOT IN ('unassigned', 'damaged', 'retired') THEN
    RAISE EXCEPTION 'A shelf card can be unassigned, damaged or retired.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.physical_cards SET status = p_status, note = COALESCE(NULLIF(btrim(p_note), ''), note), updated_at = NOW()
  WHERE upper(chip_uid) = upper(btrim(p_chip_uid)) AND status <> 'assigned';
  IF NOT FOUND THEN RAISE EXCEPTION 'No unassigned shelf card with that chip id.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_audit(v_admin, 'inventory.card_' || p_status, 'physical_card', p_chip_uid, jsonb_build_object('note', p_note));
  RETURN (SELECT to_jsonb(p) FROM public.physical_cards p WHERE upper(chip_uid) = upper(btrim(p_chip_uid)));
END;
$$;

-- An administrator switching a customer's card on or off, or marking it lost
-- or damaged — for a customer who phones in. Audited; the customer is emailed
-- by the card triggers (024).
CREATE OR REPLACE FUNCTION public.admin_set_card_state(p_card_id UUID, p_action TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
  v_card  public.cards%ROWTYPE;
BEGIN
  SELECT * INTO v_card FROM public.cards WHERE id = p_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_card.status = 'replaced' THEN RAISE EXCEPTION 'This card has been replaced.' USING ERRCODE = '22023'; END IF;

  IF p_action = 'activate' THEN
    UPDATE public.cards SET status = 'active', activated_at = NOW(), last_activation_at = NOW(),
      activation_expires_at = NOW() + interval '14 days', activation_count = COALESCE(activation_count, 0) + 1,
      deactivated_at = NULL, lost_at = NULL, damaged_at = NULL
    WHERE id = p_card_id;
  ELSIF p_action = 'deactivate' THEN
    UPDATE public.cards SET status = 'suspended', deactivated_at = NOW() WHERE id = p_card_id;
  ELSIF p_action = 'lost' THEN
    UPDATE public.cards SET status = 'suspended', lost_at = NOW(), deactivated_at = NOW() WHERE id = p_card_id;
  ELSIF p_action = 'damaged' THEN
    UPDATE public.cards SET status = 'suspended', damaged_at = NOW(), deactivated_at = NOW() WHERE id = p_card_id;
  ELSIF p_action = 'shipped' THEN
    UPDATE public.cards SET status = 'shipped' WHERE id = p_card_id AND status = 'pending';
  ELSE
    RAISE EXCEPTION 'Unknown card action %.', p_action USING ERRCODE = '22023';
  END IF;

  PERFORM public.admin_audit(v_admin, 'card.' || p_action, 'card', p_card_id::text,
    jsonb_build_object('code', v_card.card_code, 'reason', p_reason, 'from', v_card.status));
  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id);
END;
$$;

-- A card's whole story: its own events (022's account log), the admin actions
-- on it, and the chain of cards it replaced or was replaced by.
CREATE OR REPLACE FUNCTION public.admin_card_history(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('orders.read');
  RETURN jsonb_build_object(
    'card', (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id),
    'events', COALESCE((SELECT jsonb_agg(e ORDER BY e->>'at') FROM (
        SELECT jsonb_build_object('at', a.created_at, 'source', 'customer', 'event', a.event_type, 'detail', a.detail) AS e
        FROM public.account_events a WHERE a.subject_type = 'card' AND a.subject_id = p_card_id::text
        UNION ALL
        SELECT jsonb_build_object('at', l.created_at, 'source', 'admin', 'event', l.action, 'detail', l.metadata,
                                  'admin', (SELECT p.full_name FROM public.profiles p WHERE p.id = l.admin_id))
        FROM public.admin_audit_log l WHERE l.entity_type = 'card' AND l.entity_id = p_card_id::text) x), '[]'::jsonb),
    'replaces', (WITH RECURSIVE back AS (
        SELECT c.id, c.card_code, c.replaces_card_id, c.created_at, 1 AS depth FROM public.cards c
        WHERE c.id = (SELECT replaces_card_id FROM public.cards WHERE id = p_card_id)
        UNION ALL
        SELECT c.id, c.card_code, c.replaces_card_id, c.created_at, b.depth + 1 FROM public.cards c
        JOIN back b ON c.id = b.replaces_card_id WHERE b.depth < 20)
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'code', card_code, 'created_at', created_at) ORDER BY depth), '[]'::jsonb) FROM back),
    'replaced_by', (SELECT jsonb_build_object('id', c.id, 'code', c.card_code, 'created_at', c.created_at)
                    FROM public.cards c WHERE c.replaces_card_id = p_card_id ORDER BY c.created_at DESC LIMIT 1),
    'physical', (SELECT to_jsonb(p) FROM public.physical_cards p WHERE p.card_id = p_card_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_import_physical_cards(TEXT, TEXT, TEXT, TEXT[], TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_physical_cards(TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_assign_physical_card(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_physical_card_status(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_card_state(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_card_history(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_import_physical_cards(TEXT, TEXT, TEXT, TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_physical_cards(TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_physical_card(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_physical_card_status(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_card_state(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_card_history(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. CUSTOMER CANCELLATION REQUESTS
-- ---------------------------------------------------------------------------
-- A customer asks; an administrator decides and refunds through the existing
-- admin-refund function (which already refuses a second refund). Allowed only
-- for a paid order that has not shipped.
CREATE OR REPLACE FUNCTION public.customer_request_cancellation(p_order_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order  public.orders%ROWTYPE;
  v_reason TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id AND user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found.' USING ERRCODE = 'P0002'; END IF;
  IF v_order.payment_status <> 'paid' THEN
    RAISE EXCEPTION 'Only a paid order can be cancelled. An unpaid checkout was never charged.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_order.order_status, 'placed') NOT IN ('placed', 'processing', 'packed') THEN
    RAISE EXCEPTION 'This order has already shipped, so it can no longer be cancelled. Contact support for a return.' USING ERRCODE = '22023';
  END IF;
  IF v_order.cancellation_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('requested_at', v_order.cancellation_requested_at, 'already', true);
  END IF;
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Tell us briefly why you want to cancel.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET cancellation_requested_at = NOW(), cancellation_request_reason = left(v_reason, 500)
  WHERE id = v_order.id;

  INSERT INTO public.support_tickets (user_id, subject, category, status, order_id)
  VALUES (v_order.user_id, left('Cancellation request · ' || COALESCE(v_order.order_id, ''), 160), 'order', 'open', v_order.id);

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('order', 'warning', 'Cancellation requested',
          'Order ' || COALESCE(v_order.order_id, '') || ': ' || left(v_reason, 200),
          '/orders/' || v_order.id::text, jsonb_build_object('order_id', v_order.id));

  PERFORM public.log_account_event(v_order.user_id, 'order.cancellation_requested', 'order', v_order.id::text,
    jsonb_build_object('reason', left(v_reason, 200)));
  RETURN jsonb_build_object('requested_at', NOW(), 'already', false);
END;
$$;
REVOKE ALL ON FUNCTION public.customer_request_cancellation(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_request_cancellation(UUID, TEXT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 6. STORE FUNNEL
-- ---------------------------------------------------------------------------
-- Anonymous storefront events against a random per-browser session id (no
-- cookies, no personal data): visit -> product view -> configure -> add to cart
-- -> checkout -> payment opened -> paid / failed.
CREATE TABLE IF NOT EXISTS public.store_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  TEXT NOT NULL,
  event       TEXT NOT NULL CHECK (event IN ('store_visit', 'product_view', 'product_configured', 'add_to_cart',
                                             'checkout_started', 'payment_opened', 'payment_success', 'payment_failed',
                                             'payment_cancelled', 'purchase_completed')),
  product     TEXT,
  value_paise INTEGER,
  user_id     UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_store_events_time ON public.store_events (occurred_at, event);
CREATE INDEX IF NOT EXISTS idx_store_events_session ON public.store_events (session_id, occurred_at);
ALTER TABLE public.store_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.store_events FROM anon, authenticated;
DROP POLICY IF EXISTS store_events_admin ON public.store_events;
CREATE POLICY store_events_admin ON public.store_events FOR SELECT TO authenticated USING (public.admin_has('analytics.read'));
GRANT SELECT ON public.store_events TO authenticated;

CREATE OR REPLACE FUNCTION public.track_store_event(
  p_session TEXT,
  p_event   TEXT,
  p_product TEXT DEFAULT NULL,
  p_value   INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_session !~ '^[A-Za-z0-9_-]{8,64}$' OR p_event NOT IN ('store_visit', 'product_view', 'product_configured',
       'add_to_cart', 'checkout_started', 'payment_opened', 'payment_success', 'payment_failed', 'payment_cancelled',
       'purchase_completed') THEN
    RETURN;
  END IF;
  -- A runaway or hostile client cannot flood the table: 300 events a day per
  -- session, and — because anyone can invent session ids — a ceiling for the
  -- whole store per minute, far above real traffic.
  IF (SELECT count(*) FROM public.store_events WHERE session_id = p_session AND occurred_at > NOW() - interval '1 day') >= 300 THEN
    RETURN;
  END IF;
  IF (SELECT count(*) FROM public.store_events WHERE occurred_at > NOW() - interval '1 minute') >= 600 THEN
    RETURN;
  END IF;
  INSERT INTO public.store_events (session_id, event, product, value_paise, user_id)
  VALUES (p_session, p_event, left(NULLIF(btrim(COALESCE(p_product, '')), ''), 64),
          CASE WHEN p_value BETWEEN 0 AND 100000000 THEN p_value END, auth.uid());
END;
$$;
REVOKE ALL ON FUNCTION public.track_store_event(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_store_event(TEXT, TEXT, TEXT, INTEGER) TO anon, authenticated;

-- Each step counts distinct sessions; purchases are also counted from paid
-- orders, which are the source of truth for money.
CREATE OR REPLACE FUNCTION public.admin_store_funnel(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_since TIMESTAMPTZ := NOW() - make_interval(days => greatest(1, least(365, COALESCE(p_days, 30))));
  v_steps JSONB;
BEGIN
  PERFORM public.require_admin('analytics.read');
  SELECT jsonb_agg(jsonb_build_object('step', s.step, 'label', s.label, 'sessions',
           (SELECT count(DISTINCT e.session_id) FROM public.store_events e
            WHERE e.occurred_at >= v_since AND e.event = ANY (s.events))) ORDER BY s.n)
  INTO v_steps
  FROM (VALUES
    (1, 'visit', 'Visitors', ARRAY['store_visit']),
    (2, 'view', 'Product views', ARRAY['product_view', 'product_configured']),
    (3, 'cart', 'Add to cart', ARRAY['add_to_cart']),
    (4, 'checkout', 'Checkout', ARRAY['checkout_started']),
    (5, 'payment', 'Payment attempts', ARRAY['payment_opened']),
    (6, 'paid', 'Successful purchases', ARRAY['payment_success', 'purchase_completed'])
  ) AS s(n, step, label, events);

  RETURN jsonb_build_object(
    'days', greatest(1, least(365, COALESCE(p_days, 30))),
    'steps', v_steps,
    'failed_payments', (SELECT count(*) FROM public.store_events WHERE occurred_at >= v_since AND event = 'payment_failed'),
    'cancelled_payments', (SELECT count(*) FROM public.store_events WHERE occurred_at >= v_since AND event = 'payment_cancelled'),
    'paid_orders', (SELECT count(*) FROM public.orders WHERE payment_status = 'paid' AND created_at >= v_since),
    'revenue_in_paise', (SELECT COALESCE(sum(amount_in_paise), 0) FROM public.orders WHERE payment_status = 'paid' AND created_at >= v_since)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_store_funnel(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_store_funnel(INT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. SUPPORT EMAILS (the 024 outbox)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_queue_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ticket public.support_tickets%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'support_tickets' THEN
    PERFORM public.email_enqueue(NEW.user_id, 'support_ticket_created', NEW.id,
      'support_ticket_created:' || NEW.id::text, jsonb_build_object('ticket_id', NEW.id));
    RETURN NEW;
  END IF;
  IF NEW.author_role = 'support' THEN
    SELECT * INTO v_ticket FROM public.support_tickets WHERE id = NEW.ticket_id;
    PERFORM public.email_enqueue(v_ticket.user_id, 'support_reply', v_ticket.id,
      'support_reply:' || NEW.id::text, jsonb_build_object('ticket_id', v_ticket.id, 'message_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.support_queue_emails() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_support_tickets_email ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_email AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.support_queue_emails();
DROP TRIGGER IF EXISTS trg_support_messages_email ON public.support_messages;
CREATE TRIGGER trg_support_messages_email AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.support_queue_emails();

-- Refund status changes that arrive by webhook (refund.processed / failed).
CREATE OR REPLACE FUNCTION public.orders_refund_from_webhook(
  p_razorpay_payment_id TEXT,
  p_refund_id TEXT,
  p_amount INTEGER,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order UUID;
BEGIN
  SELECT id INTO v_order FROM public.orders WHERE razorpay_payment_id = p_razorpay_payment_id LIMIT 1;
  IF v_order IS NULL THEN RETURN NULL; END IF;
  IF p_status = 'processed' THEN
    UPDATE public.orders SET payment_status = 'refunded', refunded_at = COALESCE(refunded_at, NOW()),
      refund_amount_in_paise = COALESCE(p_amount, refund_amount_in_paise),
      razorpay_refund_id = p_refund_id
    WHERE id = v_order AND payment_status IS DISTINCT FROM 'refunded';
  ELSIF p_status = 'failed' THEN
    -- Frees the order for another attempt; the admin is told.
    UPDATE public.orders SET razorpay_refund_id = NULL WHERE id = v_order AND razorpay_refund_id = p_refund_id AND payment_status <> 'refunded';
    INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
    VALUES ('payment', 'critical', 'A refund failed', 'Razorpay reported refund ' || p_refund_id || ' as failed.',
            '/orders/' || v_order::text, jsonb_build_object('order_id', v_order, 'refund_id', p_refund_id));
  END IF;
  RETURN v_order;
END;
$$;
REVOKE ALL ON FUNCTION public.orders_refund_from_webhook(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orders_refund_from_webhook(TEXT, TEXT, INTEGER, TEXT) TO service_role;
