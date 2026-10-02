-- ============================================================================
-- 023 — PROMO CODES, DELIVERY CHARGE, THE CUSTOM CARD, THE YOUTUBE ADD-ON
-- ============================================================================
-- Run AFTER 022. Idempotent.
--
--   * Promo codes: percentage off the cart value (the items, before delivery),
--     with optional start/expiry dates, a total usage limit, a per-customer
--     limit, a minimum order and a cap. DRAGON (30%) and NEWTAP (20%) are
--     seeded. The browser can only ask whether a code is valid; the discount a
--     customer is charged is decided again by /api/create-order, which reserves
--     the code against the order. The use is counted when the order is paid.
--   * Delivery: ₹49 on every order with a physical card, stored as a product
--     (`delivery-standard`) so the price lives in the catalogue like every
--     other price and can be changed without a deploy.
--   * The custom card: `card-custom-<finish>-<material>`, a flat ₹799 in every
--     material and finish. Not a limited edition (no card_editions row).
--   * YouTube becomes a purchasable add-on (`addon-youtube`, ₹99), so the
--     YouTube link the editor and public page already support can be switched on.
--   * orders gains subtotal / discount / delivery / promo columns, and
--     replaces_card_id for a replacement card order.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. ORDER MONEY
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS subtotal_in_paise     INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS discount_in_paise     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivery_fee_in_paise INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS promo_code            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS replaces_card_id      UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_replaces_card_fk') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_replaces_card_fk
      FOREIGN KEY (replaces_card_id) REFERENCES public.cards(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_money_non_negative') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_money_non_negative
      CHECK (discount_in_paise >= 0 AND delivery_fee_in_paise >= 0
             AND (subtotal_in_paise IS NULL OR subtotal_in_paise >= 0)) NOT VALID;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 2. CATALOGUE: DELIVERY, THE CUSTOM CARD, YOUTUBE
-- ---------------------------------------------------------------------------
-- ON CONFLICT DO NOTHING throughout: a price an administrator has changed since
-- is kept.
INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, short_description, stock, active, sort_order)
VALUES
  ('delivery-standard', 'Delivery', 'delivery', 4900, 'delivery',
   'Standard delivery for physical SHYGON Tap cards, anywhere in India.', NULL, true, 900)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
VALUES
  ('card-custom-standard-pvc', 'Shygon Tap Custom — PVC', 'custom', 'pvc', 'standard', 79900, 'card', '/assets/cards/custom-pvc.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 160),
  ('card-custom-standard-metal', 'Shygon Tap Custom — Metal', 'custom', 'metal', 'standard', 79900, 'card', '/assets/cards/custom-metal.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 161),
  ('card-custom-standard-transparent', 'Shygon Tap Custom — Transparent', 'custom', 'transparent', 'standard', 79900, 'card', '/assets/cards/custom-transparent.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 162),
  ('card-custom-premium-pvc', 'Shygon Tap Custom Premium — PVC', 'custom', 'pvc', 'premium', 79900, 'card', '/assets/cards/custom-pvc-premium.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 163),
  ('card-custom-premium-metal', 'Shygon Tap Custom Premium — Metal', 'custom', 'metal', 'premium', 79900, 'card', '/assets/cards/custom-metal-premium.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 164),
  ('card-custom-premium-transparent', 'Shygon Tap Custom Premium — Transparent', 'custom', 'transparent', 'premium', 79900, 'card', '/assets/cards/custom-transparent-premium.svg', 'Your own artwork, printed on a SHYGON Tap card.', 100, true, 165)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, short_description, active, sort_order)
VALUES
  ('addon-youtube', 'YouTube Button', 'customization', 9900, 'customization',
   'Send visitors to your YouTube channel from your Tap.', true, 86)
ON CONFLICT (sku) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 3. PROMO CODES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.promo_codes (
  code                  TEXT PRIMARY KEY
                        CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]{3,32}$'),
  description           TEXT,
  discount_percent      INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 100),
  -- all | physical (orders with a card) | digital (upgrades, the Pass, add-ons)
  applies_to            TEXT NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'physical', 'digital')),
  min_subtotal_in_paise INTEGER NOT NULL DEFAULT 0 CHECK (min_subtotal_in_paise >= 0),
  max_discount_in_paise INTEGER CHECK (max_discount_in_paise IS NULL OR max_discount_in_paise > 0),
  starts_at             TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  max_uses              INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_customer INTEGER CHECK (max_uses_per_customer IS NULL OR max_uses_per_customer > 0),
  times_used            INTEGER NOT NULL DEFAULT 0,
  active                BOOLEAN NOT NULL DEFAULT true,
  created_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.promo_codes (code, description, discount_percent) VALUES
  ('DRAGON', '30% off the cart value', 30),
  ('NEWTAP', '20% off the cart value', 20)
ON CONFLICT (code) DO NOTHING;

-- One row per order that used a code. `reserved` when the order is created,
-- `redeemed` when it is paid. An unpaid reservation stops counting after 30
-- minutes, so an abandoned checkout never uses up a limited code.
CREATE TABLE IF NOT EXISTS public.promo_redemptions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code              TEXT NOT NULL REFERENCES public.promo_codes(code) ON UPDATE CASCADE,
  order_id          UUID NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subtotal_in_paise INTEGER NOT NULL CHECK (subtotal_in_paise >= 0),
  discount_in_paise INTEGER NOT NULL CHECK (discount_in_paise >= 0),
  status            TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'redeemed', 'released')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON public.promo_redemptions (code, status, created_at);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_user ON public.promo_redemptions (user_id, code);

-- Failed lookups per customer, so the codes cannot be guessed by brute force.
CREATE TABLE IF NOT EXISTS public.promo_code_attempts (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT,
  ok         BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_promo_code_attempts_user ON public.promo_code_attempts (user_id, created_at DESC);

ALTER TABLE public.promo_codes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_redemptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promo_codes, public.promo_redemptions, public.promo_code_attempts FROM anon;

-- Customers never read the code list; they ask check_promo_code() about one
-- code. Administrators read everything.
DROP POLICY IF EXISTS promo_codes_admin_select ON public.promo_codes;
CREATE POLICY promo_codes_admin_select ON public.promo_codes
  FOR SELECT TO authenticated USING (public.admin_has('products.read'));

DROP POLICY IF EXISTS promo_redemptions_own_select ON public.promo_redemptions;
CREATE POLICY promo_redemptions_own_select ON public.promo_redemptions
  FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS promo_redemptions_admin_select ON public.promo_redemptions;
CREATE POLICY promo_redemptions_admin_select ON public.promo_redemptions
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));
-- promo_code_attempts: no policy at all.

DROP TRIGGER IF EXISTS trg_promo_codes_updated_at ON public.promo_codes;
CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON public.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ₹ in the messages, from paise.
CREATE OR REPLACE FUNCTION public.format_rupees(p_paise INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '₹' || CASE WHEN p_paise % 100 = 0 THEN (p_paise / 100)::text
                     ELSE to_char(p_paise / 100.0, 'FM999999990.00') END;
$$;

-- The single decision about a code. Internal: it takes any customer id.
CREATE OR REPLACE FUNCTION public.promo_evaluate(
  p_code        TEXT,
  p_user        UUID,
  p_subtotal    INTEGER,
  p_order_type  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code     TEXT := upper(btrim(COALESCE(p_code, '')));
  v_promo    public.promo_codes%ROWTYPE;
  v_kind     TEXT := CASE WHEN COALESCE(p_order_type, 'physical') = 'physical' THEN 'physical' ELSE 'digital' END;
  v_used     BIGINT;
  v_mine     BIGINT;
  v_discount INTEGER;
  v_fail     JSONB := jsonb_build_object('ok', false, 'code', v_code);
BEGIN
  IF v_code = '' THEN
    RETURN v_fail || jsonb_build_object('message', 'Enter a promo code.');
  END IF;

  SELECT * INTO v_promo FROM public.promo_codes WHERE code = v_code;
  IF NOT FOUND OR NOT v_promo.active THEN
    RETURN v_fail || jsonb_build_object('message', 'This promo code is not valid.');
  END IF;
  IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > NOW() THEN
    RETURN v_fail || jsonb_build_object('message', 'This promo code is not active yet.');
  END IF;
  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at <= NOW() THEN
    RETURN v_fail || jsonb_build_object('message', 'This promo code has expired.');
  END IF;
  IF v_promo.applies_to <> 'all' AND v_promo.applies_to <> v_kind THEN
    RETURN v_fail || jsonb_build_object('message',
      CASE v_promo.applies_to WHEN 'physical' THEN 'This promo code only applies to card orders.'
                              ELSE 'This promo code only applies to digital upgrades.' END);
  END IF;
  IF COALESCE(p_subtotal, 0) < v_promo.min_subtotal_in_paise THEN
    RETURN v_fail || jsonb_build_object('message',
      'This promo code needs a cart value of at least ' || public.format_rupees(v_promo.min_subtotal_in_paise) || '.');
  END IF;

  SELECT count(*) FILTER (WHERE TRUE),
         count(*) FILTER (WHERE r.user_id = p_user)
  INTO v_used, v_mine
  FROM public.promo_redemptions r
  WHERE r.code = v_code
    AND (r.status = 'redeemed' OR (r.status = 'reserved' AND r.created_at > NOW() - interval '30 minutes'));

  IF v_promo.max_uses IS NOT NULL AND v_used >= v_promo.max_uses THEN
    RETURN v_fail || jsonb_build_object('message', 'This promo code has reached its usage limit.');
  END IF;
  IF v_promo.max_uses_per_customer IS NOT NULL AND v_mine >= v_promo.max_uses_per_customer THEN
    RETURN v_fail || jsonb_build_object('message', 'You have already used this promo code.');
  END IF;

  v_discount := floor(COALESCE(p_subtotal, 0)::numeric * v_promo.discount_percent / 100)::int;
  IF v_promo.max_discount_in_paise IS NOT NULL THEN
    v_discount := least(v_discount, v_promo.max_discount_in_paise);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'code', v_code,
    'percent', v_promo.discount_percent,
    'discountInPaise', v_discount,
    'description', v_promo.description,
    'message', v_code || ' applied — ' || v_promo.discount_percent || '% off');
END;
$$;

REVOKE ALL ON FUNCTION public.promo_evaluate(TEXT, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
-- create-order quotes with it before creating the Razorpay order.
GRANT EXECUTE ON FUNCTION public.promo_evaluate(TEXT, UUID, INTEGER, TEXT) TO service_role;

-- What the checkout calls to show a discount. Display only: the order is
-- priced again on the server. Fifteen wrong codes in an hour locks the
-- customer out of guessing for the rest of that hour.
CREATE OR REPLACE FUNCTION public.check_promo_code(
  p_code              TEXT,
  p_subtotal_in_paise INTEGER,
  p_order_type        TEXT DEFAULT 'physical'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   UUID := auth.uid();
  v_failed BIGINT;
  v_result JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_failed FROM public.promo_code_attempts
  WHERE user_id = v_user AND NOT ok AND created_at > NOW() - interval '1 hour';
  IF v_failed >= 15 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Too many attempts. Please try again in an hour.');
  END IF;

  v_result := public.promo_evaluate(p_code, v_user, p_subtotal_in_paise, p_order_type);
  INSERT INTO public.promo_code_attempts (user_id, code, ok)
  VALUES (v_user, left(upper(btrim(COALESCE(p_code, ''))), 40), (v_result->>'ok')::boolean);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.check_promo_code(TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_promo_code(TEXT, INTEGER, TEXT) TO authenticated;

-- Server only (create-order). Locks the code, re-checks every limit and records
-- the reservation against the order in one step, so two checkouts cannot both
-- take the last use.
CREATE OR REPLACE FUNCTION public.promo_reserve(
  p_code       TEXT,
  p_user       UUID,
  p_order_id   UUID,
  p_subtotal   INTEGER,
  p_order_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM 1 FROM public.promo_codes WHERE code = upper(btrim(COALESCE(p_code, ''))) FOR UPDATE;
  v_result := public.promo_evaluate(p_code, p_user, p_subtotal, p_order_type);
  IF NOT (v_result->>'ok')::boolean THEN
    RETURN v_result;
  END IF;

  INSERT INTO public.promo_redemptions (code, order_id, user_id, subtotal_in_paise, discount_in_paise)
  VALUES (v_result->>'code', p_order_id, p_user, p_subtotal, (v_result->>'discountInPaise')::int)
  ON CONFLICT (order_id) DO NOTHING;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.promo_reserve(TEXT, UUID, UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promo_reserve(TEXT, UUID, UUID, INTEGER, TEXT) TO service_role;

-- A paid order uses its code for good.
CREATE OR REPLACE FUNCTION public.promo_redeem_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
BEGIN
  IF NEW.payment_status = 'paid' AND OLD.payment_status IS DISTINCT FROM 'paid' THEN
    UPDATE public.promo_redemptions
    SET status = 'redeemed', redeemed_at = NOW()
    WHERE order_id = NEW.id AND status <> 'redeemed'
    RETURNING code INTO v_code;
    IF v_code IS NOT NULL THEN
      UPDATE public.promo_codes SET times_used = times_used + 1 WHERE code = v_code;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.promo_redeem_on_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_promo_redeem ON public.orders;
CREATE TRIGGER trg_orders_promo_redeem
  AFTER UPDATE OF payment_status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.promo_redeem_on_payment();


-- ---------------------------------------------------------------------------
-- 4. PROMO CODE MANAGEMENT (for the Admin app)
-- ---------------------------------------------------------------------------
-- Same pattern as every other admin RPC (013): require_admin() inside the
-- transaction, and an audit row for every change.
CREATE OR REPLACE FUNCTION public.admin_list_promo_codes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('products.read');
  RETURN COALESCE((
    SELECT jsonb_agg(to_jsonb(p) || jsonb_build_object(
      'redeemed', (SELECT count(*) FROM public.promo_redemptions r
                   WHERE r.code = p.code AND r.status = 'redeemed'),
      'discount_given_in_paise', (SELECT COALESCE(sum(r.discount_in_paise), 0) FROM public.promo_redemptions r
                                  WHERE r.code = p.code AND r.status = 'redeemed'))
      ORDER BY p.created_at DESC)
    FROM public.promo_codes p), '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_promo_code(
  p_code                  TEXT,
  p_discount_percent      INTEGER,
  p_description           TEXT        DEFAULT NULL,
  p_starts_at             TIMESTAMPTZ DEFAULT NULL,
  p_expires_at            TIMESTAMPTZ DEFAULT NULL,
  p_max_uses              INTEGER     DEFAULT NULL,
  p_max_uses_per_customer INTEGER     DEFAULT NULL,
  p_min_subtotal_in_paise INTEGER     DEFAULT 0,
  p_max_discount_in_paise INTEGER     DEFAULT NULL,
  p_applies_to            TEXT        DEFAULT 'all',
  p_active                BOOLEAN     DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_code  TEXT := upper(btrim(COALESCE(p_code, '')));
BEGIN
  IF v_code !~ '^[A-Z0-9_-]{3,32}$' THEN
    RAISE EXCEPTION 'A promo code is 3-32 letters, numbers, - or _.' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NOT NULL AND p_starts_at IS NOT NULL AND p_expires_at <= p_starts_at THEN
    RAISE EXCEPTION 'The expiry must be after the start.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.promo_codes AS p
    (code, description, discount_percent, applies_to, min_subtotal_in_paise, max_discount_in_paise,
     starts_at, expires_at, max_uses, max_uses_per_customer, active, created_by)
  VALUES
    (v_code, NULLIF(btrim(COALESCE(p_description, '')), ''), p_discount_percent,
     COALESCE(p_applies_to, 'all'), COALESCE(p_min_subtotal_in_paise, 0), p_max_discount_in_paise,
     p_starts_at, p_expires_at, p_max_uses, p_max_uses_per_customer, COALESCE(p_active, true), v_admin)
  ON CONFLICT (code) DO UPDATE SET
    description           = EXCLUDED.description,
    discount_percent      = EXCLUDED.discount_percent,
    applies_to            = EXCLUDED.applies_to,
    min_subtotal_in_paise = EXCLUDED.min_subtotal_in_paise,
    max_discount_in_paise = EXCLUDED.max_discount_in_paise,
    starts_at             = EXCLUDED.starts_at,
    expires_at            = EXCLUDED.expires_at,
    max_uses              = EXCLUDED.max_uses,
    max_uses_per_customer = EXCLUDED.max_uses_per_customer,
    active                = EXCLUDED.active;

  PERFORM public.admin_audit(v_admin, 'promo.saved', 'promo_code', v_code,
    jsonb_build_object('percent', p_discount_percent, 'expires_at', p_expires_at,
                       'max_uses', p_max_uses, 'max_uses_per_customer', p_max_uses_per_customer,
                       'active', p_active));

  RETURN (SELECT to_jsonb(p) FROM public.promo_codes p WHERE p.code = v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_promo_code_active(p_code TEXT, p_active BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_code  TEXT := upper(btrim(COALESCE(p_code, '')));
BEGIN
  UPDATE public.promo_codes SET active = COALESCE(p_active, false) WHERE code = v_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promo code not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.admin_audit(v_admin,
    CASE WHEN p_active THEN 'promo.enabled' ELSE 'promo.disabled' END, 'promo_code', v_code, NULL);
  RETURN (SELECT to_jsonb(p) FROM public.promo_codes p WHERE p.code = v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_promo_codes() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_upsert_promo_code(TEXT, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_promo_code_active(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_promo_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_promo_code(TEXT, INTEGER, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_promo_code_active(TEXT, BOOLEAN) TO authenticated;

-- ============================================================================
-- VERIFY
--   SELECT code, discount_percent, active FROM public.promo_codes;   -- DRAGON 30, NEWTAP 20
--   SELECT sku, price_in_paise FROM public.products
--   WHERE sku IN ('delivery-standard', 'card-custom-standard-pvc', 'addon-youtube');
-- ============================================================================
