-- ============================================================================
-- SHYGON TAP V5 (WEB) — PRODUCTION PAYMENTS, ENTITLEMENTS & CATALOG
-- ============================================================================
-- Written against the schema that is ACTUALLY live in this Supabase project
-- (profiles, orders, products, tap_profiles), not against the unapplied
-- 001_shygon_v5_schema_and_rls.sql. Everything here is additive and idempotent.
--
-- Problems this closes:
--   1. orders had no razorpay_order_id, so a webhook had no way to find the
--      order a payment belonged to — server-side fulfilment was impossible.
--   2. The browser marked orders paid:
--        supabase.from('orders').update({ payment_status: 'paid' })
--      Any signed-in customer could do that without paying.
--   3. Entitlements (digital plan, ₹999 lifetime) lived in localStorage under
--      'shygon_customer_card_settings' — editable in devtools.
--   4. No idempotency ledger, so a redelivered webhook double-granted.
--   5. products was too thin to drive a catalog (no sku, price in paise,
--      tier, description or image).

-- ---------------------------------------------------------------------------
-- 1. ORDERS — LINK TO RAZORPAY, AND STOP THE CLIENT MARKING ANYTHING PAID
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_order_id   VARCHAR(128);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(128);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount_in_paise     INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_type          VARCHAR(32) DEFAULT 'physical';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tier                VARCHAR(32);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS plan_id             VARCHAR(32);

-- One SHYGON order per Razorpay order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_razorpay_order_id
  ON public.orders(razorpay_order_id)
  WHERE razorpay_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON public.orders(user_id, created_at DESC);

-- The heart of the fix. payment_status may only reach a paid/refunded state
-- from a context with no auth.uid() — i.e. the service-role key used by the
-- Netlify functions. A browser session (anon key + user JWT) always has
-- auth.uid() set, so it can create an order but never declare it paid.
CREATE OR REPLACE FUNCTION public.enforce_server_only_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  -- UPDATE: block any client transition into a paid state, and block editing
  -- the money, the gateway ids or the fulfilment status of a paid order.
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
     AND NEW.order_status IS DISTINCT FROM OLD.order_status THEN
    RAISE EXCEPTION 'Fulfilment status of a paid order is server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_server_only_payment_status ON public.orders;
CREATE TRIGGER trg_orders_server_only_payment_status
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_server_only_payment_status();

-- ---------------------------------------------------------------------------
-- 2. PAYMENTS LEDGER
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  provider            VARCHAR(32)  NOT NULL DEFAULT 'razorpay',
  provider_order_id   VARCHAR(128) NOT NULL,
  provider_payment_id VARCHAR(128) NOT NULL UNIQUE,
  status              VARCHAR(32)  NOT NULL DEFAULT 'created',
  amount_in_paise     INTEGER      NOT NULL CHECK (amount_in_paise >= 0),
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  verified_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON public.payments(order_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Read-only for the owner; all writes are service-role (which bypasses RLS).
DROP POLICY IF EXISTS "Customers can view payments for their orders" ON public.payments;
CREATE POLICY "Customers can view payments for their orders"
  ON public.payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders
      WHERE orders.id = payments.order_id
        AND orders.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. ENTITLEMENTS — REPLACES THE localStorage UNLOCK
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.entitlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'digital_plan' | 'lifetime' | 'card'
  type            VARCHAR(32) NOT NULL,
  -- plan id ('business', 'pro', '3d', 'custom'), 'lifetime', or a card sku
  key             VARCHAR(64) NOT NULL,
  source_order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT entitlements_user_type_key_unique UNIQUE (user_id, type, key)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_user ON public.entitlements(user_id);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;

-- Customers may READ their entitlements. There is deliberately no INSERT or
-- UPDATE policy: only the server (service role) may grant one.
DROP POLICY IF EXISTS "Customers can view their entitlements" ON public.entitlements;
CREATE POLICY "Customers can view their entitlements"
  ON public.entitlements FOR SELECT
  USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 4. WEBHOOK IDEMPOTENCY LEDGER
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    VARCHAR(32)  NOT NULL DEFAULT 'razorpay',
  event_id    VARCHAR(128) NOT NULL UNIQUE,
  event_type  VARCHAR(64)  NOT NULL,
  received_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- No policies at all: service-role only. Nothing client-side reads this.

-- ---------------------------------------------------------------------------
-- 5. PRODUCTS — ENOUGH TO DRIVE A REAL CATALOG
-- ---------------------------------------------------------------------------
-- The live table had only (id, name, category, price, material, active), which
-- cannot express the (product x tier x material) price matrix the store sells,
-- and had nothing to render a product page from.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku              VARCHAR(64);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tier             VARCHAR(32);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price_in_paise   INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description      TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS short_description TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url        TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS features         JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS badge            VARCHAR(32);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock            INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS product_type     VARCHAR(32) DEFAULT 'card';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sort_order       INTEGER DEFAULT 0;

-- Deliberately NOT a partial index. ON CONFLICT (sku) below can only infer a
-- partial unique index if the seed also repeats its WHERE clause; a plain
-- unique index avoids that footgun and still permits many NULL skus, because
-- Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku
  ON public.products(sku);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view active products" ON public.products;
CREATE POLICY "Anyone can view active products"
  ON public.products FOR SELECT
  USING (active IS NOT FALSE);

-- --- Seed: card variants (product x tier x material) ------------------------
-- Prices mirror src/data/shygonTapData.ts. Once seeded, the server reads price
-- from here rather than from a constant compiled into the Netlify function.
INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, active, sort_order)
VALUES
  ('card-business-standard-pvc',          'Shygon Tap Business — PVC',                'business',      'pvc',         'standard', 39900,  'card', '/assets/cards/business-pvc.png',              'Share your identity, contact details and work in one tap.', true, 10),
  ('card-business-standard-metal',        'Shygon Tap Business — Metal',              'business',      'metal',       'standard', 59900,  'card', '/assets/cards/business-metal.jpeg',           'Share your identity, contact details and work in one tap.', true, 11),
  ('card-business-standard-transparent',  'Shygon Tap Business — Transparent',        'business',      'transparent', 'standard', 49900,  'card', '/assets/cards/business-transparent.jpeg',     'Share your identity, contact details and work in one tap.', true, 12),
  ('card-business-premium-pvc',           'Shygon Tap Business Premium — PVC',        'business',      'pvc',         'premium',  69900,  'card', '/assets/cards/business-pvc.png',              'Premium finish business card.', true, 13),
  ('card-business-premium-metal',         'Shygon Tap Business Premium — Metal',      'business',      'metal',       'premium',  89900,  'card', '/assets/cards/business-metal.jpeg',           'Premium finish business card.', true, 14),
  ('card-business-premium-transparent',   'Shygon Tap Business Premium — Transparent','business',      'transparent', 'premium',  79900,  'card', '/assets/cards/business-transparent.jpeg',     'Premium finish business card.', true, 15),

  ('card-restaurant-standard-pvc',         'Shygon Tap Restaurant — PVC',              'restaurant',    'pvc',         'standard', 39900, 'card', '/assets/cards/restaurant-pvc.png',            'A contactless front door to your menu and guest experience.', true, 20),
  ('card-restaurant-standard-metal',       'Shygon Tap Restaurant — Metal',            'restaurant',    'metal',       'standard', 59900, 'card', '/assets/cards/restaurant-metal.jpeg',         'A contactless front door to your menu and guest experience.', true, 21),
  ('card-restaurant-standard-transparent', 'Shygon Tap Restaurant — Transparent',      'restaurant',    'transparent', 'standard', 49900, 'card', '/assets/cards/restaurant-transparent.jpeg',   'A contactless front door to your menu and guest experience.', true, 22),
  ('card-restaurant-premium-pvc',          'Shygon Tap Restaurant Premium — PVC',      'restaurant',    'pvc',         'premium',  59900, 'card', '/assets/cards/restaurant-pvc.png',            'Premium finish restaurant card.', true, 23),
  ('card-restaurant-premium-metal',        'Shygon Tap Restaurant Premium — Metal',    'restaurant',    'metal',       'premium',  69900, 'card', '/assets/cards/restaurant-metal.jpeg',         'Premium finish restaurant card.', true, 24),
  ('card-restaurant-premium-transparent',  'Shygon Tap Restaurant Premium — Transparent','restaurant',  'transparent', 'premium',  69900, 'card', '/assets/cards/restaurant-transparent.jpeg',   'Premium finish restaurant card.', true, 25),

  ('card-event-standard-pvc',              'Shygon Tap Event — PVC',                   'event',         'pvc',         'standard', 29900, 'card', '/assets/cards/event-pvc.png',                 'Connect guests to the entire event experience in one tap.', true, 30),
  ('card-event-standard-metal',            'Shygon Tap Event — Metal',                 'event',         'metal',       'standard', 49900, 'card', '/assets/cards/event-metal.jpeg',              'Connect guests to the entire event experience in one tap.', true, 31),
  ('card-event-standard-transparent',      'Shygon Tap Event — Transparent',           'event',         'transparent', 'standard', 49900, 'card', '/assets/cards/event-transparent.jpeg',        'Connect guests to the entire event experience in one tap.', true, 32),
  ('card-event-premium-pvc',               'Shygon Tap Event Premium — PVC',           'event',         'pvc',         'premium',  49900, 'card', '/assets/cards/event-pvc.png',                 'Premium finish event card.', true, 33),
  ('card-event-premium-metal',             'Shygon Tap Event Premium — Metal',         'event',         'metal',       'premium',  59900, 'card', '/assets/cards/event-metal.jpeg',              'Premium finish event card.', true, 34),
  ('card-event-premium-transparent',       'Shygon Tap Event Premium — Transparent',   'event',         'transparent', 'premium',  59900, 'card', '/assets/cards/event-transparent.jpeg',        'Premium finish event card.', true, 35),

  ('card-google-review-standard-pvc',         'Shygon Tap Google Review — PVC',            'google-review', 'pvc',         'standard', 39900, 'card', '/assets/cards/google-review-pvc.png',         'Turn great customer moments into more Google reviews.', true, 40),
  ('card-google-review-standard-metal',       'Shygon Tap Google Review — Metal',          'google-review', 'metal',       'standard', 59900, 'card', '/assets/cards/google-review-metal.png',       'Turn great customer moments into more Google reviews.', true, 41),
  ('card-google-review-standard-transparent', 'Shygon Tap Google Review — Transparent',    'google-review', 'transparent', 'standard', 49900, 'card', '/assets/cards/google-review-transparent.png', 'Turn great customer moments into more Google reviews.', true, 42),
  ('card-google-review-premium-pvc',          'Shygon Tap Google Review Premium — PVC',    'google-review', 'pvc',         'premium',  59900, 'card', '/assets/cards/google-review-pvc.png',         'Premium finish review card.', true, 43),
  ('card-google-review-premium-metal',        'Shygon Tap Google Review Premium — Metal',  'google-review', 'metal',       'premium',  69900, 'card', '/assets/cards/google-review-metal.png',       'Premium finish review card.', true, 44),
  ('card-google-review-premium-transparent',  'Shygon Tap Google Review Premium — Transparent','google-review','transparent','premium',69900, 'card', '/assets/cards/google-review-transparent.png', 'Premium finish review card.', true, 45)
ON CONFLICT (sku) DO UPDATE
SET name              = EXCLUDED.name,
    category          = EXCLUDED.category,
    material          = EXCLUDED.material,
    tier              = EXCLUDED.tier,
    price_in_paise    = EXCLUDED.price_in_paise,
    product_type      = EXCLUDED.product_type,
    image_url         = EXCLUDED.image_url,
    short_description = EXCLUDED.short_description,
    active            = EXCLUDED.active,
    sort_order        = EXCLUDED.sort_order;

-- --- Seed: digital plans and the lifetime add-on ----------------------------
INSERT INTO public.products
  (sku, name, category, tier, price_in_paise, product_type, short_description, active, sort_order)
VALUES
  ('plan-essential', 'Essential Digital Experience', 'digital', NULL,     0,      'digital_plan',   'Included with every Shygon Tap card.', true, 60),
  ('plan-business',  'Business Digital Experience',  'digital', NULL,     29900,  'digital_plan',   'A more polished digital profile.', true, 61),
  ('plan-pro',       'Pro Digital Experience',       'digital', NULL,     59900,  'digital_plan',   'Advanced presentation and animation.', true, 62),
  ('plan-3d',        '3D Digital Experience',        'digital', NULL,     99900,  'digital_plan',   'A fully immersive 3D profile experience.', true, 63),
  ('plan-custom',    'Custom Digital Experience',    'digital', NULL,     149900, 'digital_plan',   'Bespoke build tailored to your brand.', true, 64),
  ('plan-lifetime',  'Lifetime Customization Plan',  'digital', NULL,     99900,  'lifetime_plan',  'Edit your Tap any time, for life.', true, 65)
ON CONFLICT (sku) DO UPDATE
SET name              = EXCLUDED.name,
    category          = EXCLUDED.category,
    price_in_paise    = EXCLUDED.price_in_paise,
    product_type      = EXCLUDED.product_type,
    short_description = EXCLUDED.short_description,
    active            = EXCLUDED.active,
    sort_order        = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- 6. updated_at MAINTAINED BY THE DATABASE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON public.orders;
CREATE TRIGGER trg_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
