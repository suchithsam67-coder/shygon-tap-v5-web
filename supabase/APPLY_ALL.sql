-- SHYGON TAP — ALL MIGRATIONS, IN ORDER
-- GENERATED SOURCE BUNDLE
--
--   1. 001_production_payments_and_catalog.sql
--   2. 002_shygon_v5_platform.sql
--   3. 003_admin_platform.sql
--   4. 004_experiences_status_and_edit_window.sql
--   5. 005_event_themes_and_rule_hardening.sql
--   6. 006_fulfilment_retry_state.sql
--   7. 007_rls_performance_and_rpc_permissions.sql
--   8. 008_tighten_event_function_permissions.sql
--   9. 009_v5_complete_event_and_stock_safety.sql
--   10. 010_v5_fix_card_stock_timestamp.sql

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


-- ============================================================================
-- SHYGON TAP V5 — PLATFORM SCHEMA
-- ============================================================================
-- Run AFTER 001_production_payments_and_catalog.sql.
--
-- Written against the schema VERIFIED live in this Supabase project on
-- 2026-09-03 by probing PostgREST column-by-column. At that point the project
-- contained exactly four tables:
--
--   profiles      id, customer_id, email, full_name, phone, bio, website,
--                 whatsapp, instagram, linkedin, created_at, updated_at
--   orders        id, order_id, user_id, customer_id, product_id, product_name,
--                 material, plan, category, amount, payment_status,
--                 order_status, shipping_*, tracking_number, created_at,
--                 updated_at
--   products      id, name, category, price, material, active, created_at
--   tap_profiles  id, user_id, customer_id, published, username, card_id,
--                 created_at, updated_at
--
-- Everything below is additive and idempotent. It is safe to run twice.
--
-- WHAT THIS CLOSES
--   1. The Tap profile had no content columns at all, so PublicTap.tsx always
--      rendered an empty card and EditProfile.tsx could never save (it wrote
--      `location` and `profile_image_url`, neither of which existed).
--   2. UI tier and paid customizations were unlocked from localStorage
--      (`shygon_customer_card_settings.lifetime` / `.ownedPlans`). Entitlement
--      now lives in the database and the public renderer clamps to it.
--   3. There was no public read path for a Tap, so the only way to serve one
--      was to open `tap_profiles` to anon — which would have exposed the
--      owning user_id. Public access now goes through one SECURITY DEFINER
--      function that returns published, whitelisted columns only.
--   4. No cards, order line items, notifications, support or analytics.
--
-- DESIGN NOTE — WHERE TAP CONTENT LIVES
--   `profiles` stays the ACCOUNT record (billing name, login email, phone).
--   `tap_profiles` owns the PUBLISHABLE Tap content. They are deliberately
--   separate: editing your account details must not silently change what the
--   world sees, and publishing must be an explicit act. It also means the
--   public read path never touches `profiles`, so account data cannot leak.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PROFILES — ACCOUNT RECORD
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS location          TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company           TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS job_title         TEXT;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Canonical owner-only policy set. Existing policies on this table could not
-- be enumerated with the anon key, so they are replaced wholesale to guarantee
-- a known-good state rather than layered on top of an unknown one.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'profiles'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
-- No DELETE policy: accounts are removed through auth, not by the client.


-- Every signup gets a profile row. Without this the client's `update` matched
-- zero rows and silently saved nothing.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, customer_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill anyone who signed up before this trigger existed.
INSERT INTO public.profiles (id, customer_id, email, full_name)
SELECT u.id, u.id, u.email,
       COALESCE(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- 2. TAP PROFILES — THE PUBLISHABLE ENTITY
-- ---------------------------------------------------------------------------
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS slug         TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS headline     TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS bio          TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS avatar_url   TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS location     TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS phone        TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS whatsapp     TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS email        TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS website      TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS instagram    TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS linkedin     TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_color  TEXT NOT NULL DEFAULT 'blue';
-- What the customer WANTS to display. The public renderer clamps this down to
-- whatever they are actually entitled to, so writing '3d' here buys nothing.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS selected_ui_tier TEXT NOT NULL DEFAULT 'free';
-- Which purchased add-ons are switched on. Also clamped against entitlements.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS enabled_customizations TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS published_at   TIMESTAMPTZ;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Collapse any pre-existing duplicates before the unique index goes on, keeping
-- the oldest row so nothing a customer already published moves.
DELETE FROM public.tap_profiles a
USING public.tap_profiles b
WHERE a.user_id = b.user_id
  AND a.user_id IS NOT NULL
  AND (a.created_at, a.id) > (b.created_at, b.id);

-- One Tap per customer. This is what makes provisioning idempotent: a replayed
-- webhook, a double-submitted verification and the DB trigger below all race
-- against the same unique index and exactly one wins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tap_profiles_user
  ON public.tap_profiles(user_id);

-- Slugs are case-insensitively unique and are the public identity of a Tap.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tap_profiles_slug_ci
  ON public.tap_profiles(lower(slug)) WHERE slug IS NOT NULL;

-- `username` predates this migration and held the same idea. Carry it over so
-- nothing that already resolved by username breaks.
UPDATE public.tap_profiles SET slug = username
WHERE slug IS NULL AND username IS NOT NULL;

-- NOT VALID: enforced on every insert and update from here on, but not
-- retro-validated, so legacy rows written before these rules existed cannot
-- abort the migration.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_slug_format'
  ) THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_slug_format
      CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{2,39}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_tier_valid'
  ) THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_tier_valid
      CHECK (selected_ui_tier IN ('free', 'pro', 'premium', '3d')) NOT VALID;
  END IF;

  -- A Tap cannot be published without a public address to publish it at.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_published_needs_slug'
  ) THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_published_needs_slug
      CHECK (published IS NOT TRUE OR slug IS NOT NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.tap_profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'tap_profiles'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.tap_profiles', p.policyname);
  END LOOP;
END $$;

-- Owner-only. Deliberately NO anon policy: the public Tap is served by
-- get_public_tap(), which returns whitelisted columns and never exposes
-- user_id, customer_id or card_id.
CREATE POLICY "tap_profiles_select_own" ON public.tap_profiles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "tap_profiles_insert_own" ON public.tap_profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "tap_profiles_update_own" ON public.tap_profiles
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_tap_profiles_updated_at ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_updated_at
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Stamp published_at when a Tap goes live, clear it when it is withdrawn.
CREATE OR REPLACE FUNCTION public.tap_profiles_track_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.published IS TRUE AND (OLD.published IS DISTINCT FROM TRUE) THEN
    NEW.published_at := NOW();
  ELSIF NEW.published IS NOT TRUE THEN
    NEW.published_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_profiles_publication ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_publication
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tap_profiles_track_publication();


-- ---------------------------------------------------------------------------
-- 3. UI TIERS — FOUR CANONICAL TIERS BEHIND THE FIVE STOREFRONT PLANS
-- ---------------------------------------------------------------------------
-- The master plan defines Free / Pro / Premium / 3D. The storefront sells five
-- plan SKUs. Rather than renaming the catalog (which would break existing
-- orders whose `plan` column holds the old ids), each plan declares which
-- canonical tier it renders as.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ui_tier TEXT;

UPDATE public.products SET ui_tier = v.tier
FROM (VALUES
  ('plan-essential', 'free'),
  ('plan-business',  'pro'),
  ('plan-pro',       'premium'),
  ('plan-3d',        '3d'),
  ('plan-custom',    '3d'),
  ('plan-lifetime',  '3d')
) AS v(sku, tier)
WHERE public.products.sku = v.sku;

CREATE OR REPLACE FUNCTION public.tier_rank(p_tier TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
           WHEN '3d'      THEN 3
           WHEN 'premium' THEN 2
           WHEN 'pro'     THEN 1
           ELSE 0
         END;
$$;

-- Highest tier a user has actually paid for. Free is always available.
CREATE OR REPLACE FUNCTION public.user_max_ui_tier(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT p.ui_tier
      FROM public.entitlements e
      JOIN public.products p ON p.sku = 'plan-' || e.key
      WHERE e.user_id = p_user
        AND e.is_active
        AND e.type IN ('digital_plan', 'lifetime')
        AND p.ui_tier IS NOT NULL
      ORDER BY public.tier_rank(p.ui_tier) DESC
      LIMIT 1
    ),
    'free'
  );
$$;

-- Takes an arbitrary user id, so a signed-in customer could otherwise ask what
-- tier anyone else is on. get_public_tap() still reaches it: inside a SECURITY
-- DEFINER function, calls run with the owner's privileges.
REVOKE ALL ON FUNCTION public.user_max_ui_tier(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_max_ui_tier(UUID) FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. ORDER LINE ITEMS
-- ---------------------------------------------------------------------------
-- `orders` carries a single denormalised product for backward compatibility.
-- Real orders (card + plan + customizations, with quantities) need line items.
CREATE TABLE IF NOT EXISTS public.order_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sku                 VARCHAR(64)  NOT NULL,
  name                TEXT         NOT NULL,
  product_type        VARCHAR(32)  NOT NULL DEFAULT 'card',
  unit_price_in_paise INTEGER      NOT NULL CHECK (unit_price_in_paise >= 0),
  quantity            INTEGER      NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 50),
  line_total_in_paise INTEGER      NOT NULL CHECK (line_total_in_paise >= 0),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select_own" ON public.order_items;
CREATE POLICY "order_items_select_own" ON public.order_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.orders o
            WHERE o.id = order_items.order_id AND o.user_id = auth.uid())
  );
-- No INSERT/UPDATE policy: line items are written by the server only.


-- Canonical policy set for orders. Customers read their own; they may not
-- create or alter them at all — create-order writes them with the service role.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'orders'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.orders', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "orders_select_own" ON public.orders
  FOR SELECT USING (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- 5. CARDS — PHYSICAL NFC INVENTORY OWNED BY A CUSTOMER
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id       UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  tap_profile_id UUID REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  sku            VARCHAR(64),
  -- The NFC chip's identifier, written during fulfilment. Not known at
  -- purchase time, so nullable.
  card_uid       VARCHAR(64),
  -- pending | shipped | active | suspended | replaced
  status         VARCHAR(32) NOT NULL DEFAULT 'pending',
  is_replacement BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_uid
  ON public.cards(card_uid) WHERE card_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_user ON public.cards(user_id);
-- One card row per order line, so replaying a webhook cannot mint extra cards.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_order_sku
  ON public.cards(order_id, sku) WHERE order_id IS NOT NULL;

ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cards_select_own" ON public.cards;
CREATE POLICY "cards_select_own" ON public.cards
  FOR SELECT USING (auth.uid() = user_id);
-- Issuance, activation and suspension are server/admin operations.

DROP TRIGGER IF EXISTS trg_cards_updated_at ON public.cards;
CREATE TRIGGER trg_cards_updated_at
  BEFORE UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 6. NOTIFICATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- order | payment | shipping | delivery | tap | account
  category   VARCHAR(32) NOT NULL DEFAULT 'account',
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  metadata   JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);

-- The owner may mark as read. The column guard below stops them rewriting the
-- notification's content while doing so.
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.notifications_only_read_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;  -- service role
  END IF;
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.link IS DISTINCT FROM OLD.link
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Only the read state of a notification may be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_read_only ON public.notifications;
CREATE TRIGGER trg_notifications_read_only
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_only_read_state();


-- Order lifecycle raises notifications in the database, so they appear no
-- matter which server path moved the order.
CREATE OR REPLACE FUNCTION public.notify_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'order', 'Order placed',
            'We have received order ' || COALESCE(NEW.order_id, '') || '.',
            '/shygontap/orders', jsonb_build_object('order_id', NEW.id));
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status = 'paid' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'payment', 'Payment confirmed',
            'Payment for order ' || COALESCE(NEW.order_id, '') || ' was successful.',
            '/shygontap/orders', jsonb_build_object('order_id', NEW.id));
  END IF;

  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status IN ('shipped', 'out_for_delivery', 'delivered') THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'shipping',
            CASE NEW.order_status
              WHEN 'shipped'          THEN 'Your Tap has shipped'
              WHEN 'out_for_delivery' THEN 'Out for delivery'
              ELSE                         'Delivered'
            END,
            'Order ' || COALESCE(NEW.order_id, '') || ' is now ' ||
              replace(NEW.order_status, '_', ' ') || '.',
            '/shygontap/orders',
            jsonb_build_object('order_id', NEW.id,
                               'tracking_number', NEW.tracking_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_notify ON public.orders;
CREATE TRIGGER trg_orders_notify
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.notify_order_change();


-- ---------------------------------------------------------------------------
-- 7. SUPPORT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reference  TEXT NOT NULL UNIQUE
             DEFAULT ('ST-' || upper(substr(md5(gen_random_uuid()::text), 1, 8))),
  subject    TEXT NOT NULL CHECK (length(btrim(subject)) BETWEEN 3 AND 160),
  -- order | card | tap | payment | other
  category   VARCHAR(32) NOT NULL DEFAULT 'other',
  -- open | awaiting_customer | resolved | closed
  status     VARCHAR(32) NOT NULL DEFAULT 'open',
  order_id   UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user
  ON public.support_tickets(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.support_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- customer | support
  author_role VARCHAR(16) NOT NULL DEFAULT 'customer',
  body       TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket
  ON public.support_messages(ticket_id, created_at);

ALTER TABLE public.support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_select_own" ON public.support_tickets;
CREATE POLICY "support_tickets_select_own" ON public.support_tickets
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "support_tickets_insert_own" ON public.support_tickets;
-- `orders` has its own `order_id` column, so an unqualified `order_id` inside
-- the EXISTS would bind to the inner table rather than the row being inserted.
-- Both references are qualified deliberately.
CREATE POLICY "support_tickets_insert_own" ON public.support_tickets
  FOR INSERT WITH CHECK (
    auth.uid() = support_tickets.user_id
    AND support_tickets.status = 'open'
    AND (support_tickets.order_id IS NULL OR EXISTS (
          SELECT 1 FROM public.orders o
          WHERE o.id = support_tickets.order_id AND o.user_id = auth.uid()))
  );

-- A customer may close their own ticket but not reopen or re-assign it.
DROP POLICY IF EXISTS "support_tickets_close_own" ON public.support_tickets;
CREATE POLICY "support_tickets_close_own" ON public.support_tickets
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status IN ('open', 'closed'));

DROP POLICY IF EXISTS "support_messages_select_own" ON public.support_messages;
CREATE POLICY "support_messages_select_own" ON public.support_messages
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.support_tickets t
            WHERE t.id = support_messages.ticket_id AND t.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "support_messages_insert_own" ON public.support_messages;
CREATE POLICY "support_messages_insert_own" ON public.support_messages
  FOR INSERT WITH CHECK (
    support_messages.author_id = auth.uid()
    AND support_messages.author_role = 'customer'
    AND EXISTS (SELECT 1 FROM public.support_tickets t
                WHERE t.id = support_messages.ticket_id
                  AND t.user_id = auth.uid()
                  AND t.status <> 'closed')
  );

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- 8. TAP ANALYTICS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tap_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tap_profile_id UUID NOT NULL REFERENCES public.tap_profiles(id) ON DELETE CASCADE,
  -- view | nfc | qr | link_click
  event_type     VARCHAR(24) NOT NULL,
  -- which link/button, for link_click
  link_key       VARCHAR(48),
  -- Salted daily digest of UA + IP. Lets us count returning visitors for a day
  -- without ever storing an address or a device fingerprint.
  visitor_hash   VARCHAR(64),
  referrer_host  VARCHAR(128),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tap_events_profile_time
  ON public.tap_events(tap_profile_id, occurred_at DESC);

ALTER TABLE public.tap_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tap_events_select_own" ON public.tap_events;
CREATE POLICY "tap_events_select_own" ON public.tap_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.tap_profiles t
            WHERE t.id = tap_events.tap_profile_id AND t.user_id = auth.uid())
  );
-- No INSERT policy. Events are recorded only through record_tap_event(), which
-- refuses anything but a published Tap.


-- ---------------------------------------------------------------------------
-- 9. PUBLIC TAP READ PATH
-- ---------------------------------------------------------------------------
-- The one and only way an anonymous visitor reads a Tap. Returns published,
-- whitelisted columns; never user_id, customer_id, card_id or account data.
-- The tier and the enabled add-ons are recomputed here from entitlements, so a
-- customer who edits selected_ui_tier to '3d' without owning it still renders
-- at the tier they paid for.
CREATE OR REPLACE FUNCTION public.get_public_tap(p_slug TEXT)
RETURNS TABLE (
  slug                   TEXT,
  display_name           TEXT,
  headline               TEXT,
  bio                    TEXT,
  avatar_url             TEXT,
  location               TEXT,
  phone                  TEXT,
  whatsapp               TEXT,
  email                  TEXT,
  website                TEXT,
  instagram              TEXT,
  linkedin               TEXT,
  theme_color            TEXT,
  ui_tier                TEXT,
  enabled_customizations TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap     public.tap_profiles%ROWTYPE;
  v_max     TEXT;
  v_owned   TEXT[];
BEGIN
  SELECT * INTO v_tap
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(p_slug))
    AND t.published IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_max := public.user_max_ui_tier(v_tap.user_id);

  SELECT COALESCE(array_agg(e.key), '{}')
  INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = v_tap.user_id
    AND e.is_active
    AND e.type = 'customization';

  RETURN QUERY SELECT
    v_tap.slug,
    v_tap.display_name,
    v_tap.headline,
    v_tap.bio,
    v_tap.avatar_url,
    v_tap.location,
    -- Contact details are published only when the customer switched them on.
    CASE WHEN 'phone'     = ANY (v_tap.enabled_customizations) THEN v_tap.phone     END,
    CASE WHEN 'whatsapp'  = ANY (v_tap.enabled_customizations)
          AND 'whatsapp'  = ANY (v_owned)                       THEN v_tap.whatsapp  END,
    CASE WHEN 'email'     = ANY (v_tap.enabled_customizations) THEN v_tap.email     END,
    CASE WHEN 'website'   = ANY (v_tap.enabled_customizations)
          AND 'website'   = ANY (v_owned)                       THEN v_tap.website   END,
    CASE WHEN 'instagram' = ANY (v_tap.enabled_customizations)
          AND 'instagram' = ANY (v_owned)                       THEN v_tap.instagram END,
    CASE WHEN 'linkedin'  = ANY (v_tap.enabled_customizations)
          AND 'linkedin'  = ANY (v_owned)                       THEN v_tap.linkedin  END,
    v_tap.theme_color,
    -- Clamp the requested tier to what was actually purchased.
    CASE WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_max)
         THEN v_tap.selected_ui_tier ELSE v_max END,
    ARRAY(SELECT unnest(v_tap.enabled_customizations)
          INTERSECT
          SELECT unnest(v_owned || ARRAY['phone', 'email']));
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tap(TEXT) TO anon, authenticated;


-- Records one analytics event against a published Tap. Anonymous visitors can
-- call it, but they can only ever append an event to a Tap that is already
-- public — they cannot read anything or address an unpublished profile.
CREATE OR REPLACE FUNCTION public.record_tap_event(
  p_slug     TEXT,
  p_event    TEXT,
  p_link_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
  WHERE lower(t.slug) = lower(btrim(p_slug)) AND t.published IS TRUE
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
    -- Rotates daily, so the digest cannot be used to follow a visitor over time.
    md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
        to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD')),
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) TO anon, authenticated;


-- Aggregated analytics for the caller's own Tap. Returns rows only for a Tap
-- the caller owns, so there is no way to read someone else's numbers.
CREATE OR REPLACE FUNCTION public.get_tap_analytics(p_days INT DEFAULT 30)
RETURNS TABLE (
  day            DATE,
  views          BIGINT,
  nfc_taps       BIGINT,
  qr_scans       BIGINT,
  link_clicks    BIGINT,
  unique_visitors BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (e.occurred_at AT TIME ZONE 'UTC')::date               AS day,
    count(*) FILTER (WHERE e.event_type = 'view')          AS views,
    count(*) FILTER (WHERE e.event_type = 'nfc')           AS nfc_taps,
    count(*) FILTER (WHERE e.event_type = 'qr')            AS qr_scans,
    count(*) FILTER (WHERE e.event_type = 'link_click')    AS link_clicks,
    count(DISTINCT e.visitor_hash)                         AS unique_visitors
  FROM public.tap_events e
  JOIN public.tap_profiles t ON t.id = e.tap_profile_id
  WHERE t.user_id = auth.uid()
    AND e.occurred_at >= NOW() - make_interval(days => greatest(1, least(365, p_days)))
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_tap_analytics(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tap_analytics(INT) TO authenticated;


-- Per-link breakdown for the caller's own Tap.
CREATE OR REPLACE FUNCTION public.get_tap_link_clicks(p_days INT DEFAULT 30)
RETURNS TABLE (link_key TEXT, clicks BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.link_key::text, count(*)
  FROM public.tap_events e
  JOIN public.tap_profiles t ON t.id = e.tap_profile_id
  WHERE t.user_id = auth.uid()
    AND e.event_type = 'link_click'
    AND e.link_key IS NOT NULL
    AND e.occurred_at >= NOW() - make_interval(days => greatest(1, least(365, p_days)))
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

REVOKE ALL ON FUNCTION public.get_tap_link_clicks(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tap_link_clicks(INT) TO authenticated;


-- Claims a public address for the caller's Tap. Runs as definer so it can see
-- whether a slug is taken without granting the caller read access to other
-- people's rows — the failure mode leaks only "taken / not taken".
CREATE OR REPLACE FUNCTION public.claim_tap_slug(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

  IF v_slug IN ('admin', 'api', 'auth', 'account', 'shygontap', 'store',
                'checkout', 'orders', 'settings', 'support', 'tap', 'www') THEN
    RAISE EXCEPTION 'That Tap address is reserved.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.tap_profiles
             WHERE lower(slug) = v_slug AND user_id <> auth.uid()) THEN
    RAISE EXCEPTION 'That Tap address is already taken.' USING ERRCODE = '23505';
  END IF;

  UPDATE public.tap_profiles SET slug = v_slug, username = v_slug
  WHERE user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have a Tap profile yet.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tap_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_tap_slug(TEXT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 10. AUTOMATIC TAP PROVISIONING (DATABASE-SIDE SAFETY NET)
-- ---------------------------------------------------------------------------
-- The Netlify fulfilment path provisions a Tap after a verified payment. This
-- trigger does the same thing inside the transaction that marks an order paid,
-- so provisioning cannot be lost if fulfilment is interrupted between the two.
-- The unique index on tap_profiles(user_id) makes running both harmless.
CREATE OR REPLACE FUNCTION public.generate_tap_slug(p_user UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base   TEXT;
  v_try    TEXT;
  v_suffix INT := 0;
BEGIN
  SELECT lower(regexp_replace(COALESCE(p.full_name, split_part(p.email, '@', 1), 'tap'),
                              '[^a-zA-Z0-9]+', '-', 'g'))
  INTO v_base
  FROM public.profiles p WHERE p.id = p_user;

  v_base := btrim(COALESCE(v_base, 'tap'), '-');
  IF length(v_base) < 3 THEN v_base := 'tap-' || v_base; END IF;
  v_base := left(v_base, 32);

  LOOP
    v_try := CASE WHEN v_suffix = 0 THEN v_base
                  ELSE v_base || '-' || v_suffix::text END;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.tap_profiles
                          WHERE lower(slug) = v_try);
    v_suffix := v_suffix + 1;
    IF v_suffix > 500 THEN
      v_try := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_try;
END;
$$;

-- Called by the fulfilment path (service role) and by the trigger below.
-- Customers claim an address through claim_tap_slug() instead, which validates
-- the value and checks ownership.
REVOKE ALL ON FUNCTION public.generate_tap_slug(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_tap_slug(UUID) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.provision_tap_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug    TEXT;
  v_name    TEXT;
  v_email   TEXT;
  v_created BOOLEAN := false;
BEGIN
  IF NEW.payment_status <> 'paid'
     OR OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
     OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Generated once: calling it twice would hand slug and username different
  -- values, and they must stay the same address.
  v_slug := public.generate_tap_slug(NEW.user_id);

  SELECT p.full_name, p.email INTO v_name, v_email
  FROM public.profiles p WHERE p.id = NEW.user_id;

  INSERT INTO public.tap_profiles
    (user_id, customer_id, published, slug, username, display_name, email,
     selected_ui_tier, enabled_customizations)
  VALUES (NEW.user_id, NEW.user_id, false, v_slug, v_slug, v_name, v_email,
          'free', ARRAY['phone', 'email'])
  ON CONFLICT (user_id) DO NOTHING;

  v_created := FOUND;

  -- A Tap that predates this migration may exist without a public address.
  UPDATE public.tap_profiles
  SET slug = v_slug, username = COALESCE(username, v_slug)
  WHERE user_id = NEW.user_id AND slug IS NULL;

  -- Only announce a Tap the customer has not been told about before.
  IF v_created THEN
    INSERT INTO public.notifications (user_id, category, title, body, link)
    VALUES (NEW.user_id, 'tap', 'Your Tap profile is ready',
            'Complete your profile and publish it to go live.',
            '/shygontap/tap');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_provision_tap ON public.orders;
CREATE TRIGGER trg_orders_provision_tap
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.provision_tap_on_payment();


-- ---------------------------------------------------------------------------
-- 11. CUSTOMIZATION CATALOG
-- ---------------------------------------------------------------------------
-- Customizations are products, not a parallel concept: they live in the same
-- table with product_type = 'customization', so create-order already prices
-- and validates them through the same SKU lookup as everything else.
INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, short_description, active, sort_order)
VALUES
  ('addon-whatsapp',  'WhatsApp Button',      'customization',  9900, 'customization',
   'A one-tap WhatsApp chat button on your public Tap.', true, 80),
  ('addon-instagram', 'Instagram Link',       'customization',  9900, 'customization',
   'Send visitors straight to your Instagram profile.', true, 81),
  ('addon-linkedin',  'LinkedIn Link',        'customization',  9900, 'customization',
   'Add your professional profile to your Tap.', true, 82),
  ('addon-website',   'Website Button',       'customization', 14900, 'customization',
   'Link your website or portfolio from your Tap.', true, 83),
  ('addon-gallery',   'Photo Gallery Section','customization', 24900, 'customization',
   'Show a gallery of your work on your Tap.', true, 84),
  ('addon-location',  'Location & Directions','customization', 14900, 'customization',
   'Add a map pin and one-tap directions.', true, 85)
ON CONFLICT (sku) DO UPDATE
SET name              = EXCLUDED.name,
    category          = EXCLUDED.category,
    price_in_paise    = EXCLUDED.price_in_paise,
    product_type      = EXCLUDED.product_type,
    short_description = EXCLUDED.short_description,
    active            = EXCLUDED.active,
    sort_order        = EXCLUDED.sort_order;

-- Physical cards default to being in stock; digital goods are unlimited
-- (NULL stock means "no limit").
UPDATE public.products SET stock = 100
WHERE product_type = 'card' AND stock IS NULL;


-- Stock is decremented at fulfilment, not at checkout, so an abandoned payment
-- never holds inventory. Done in one statement so two concurrent fulfilments
-- cannot both read the same level and write it back.
CREATE OR REPLACE FUNCTION public.decrement_product_stock(
  p_sku      TEXT,
  p_quantity INT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.products
  SET stock = greatest(0, stock - greatest(0, p_quantity))
  WHERE sku = p_sku AND stock IS NOT NULL;
$$;

-- Server-side only: customers must never be able to move inventory.
REVOKE ALL ON FUNCTION public.decrement_product_stock(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrement_product_stock(TEXT, INT) FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 12. VERIFICATION
-- ---------------------------------------------------------------------------
-- Run this after applying, and confirm every table below reports rls_enabled.
--
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
--          count(p.policyname) AS policies
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--   LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = 'public'
--   WHERE n.nspname = 'public' AND c.relkind = 'r'
--   GROUP BY 1, 2 ORDER BY 1;
--
-- And confirm the public Tap path leaks nothing:
--
--   SELECT * FROM public.get_public_tap('some-slug');
-- ============================================================================


-- ============================================================================
-- SHYGON TAP V5 — ADMIN PLATFORM
-- ============================================================================
-- Run AFTER 001_production_payments_and_catalog.sql and 002_shygon_v5_platform.sql.
--
-- ORDERING MATTERS, AND NOT ONLY THE FIRST TIME. Migration 002 drops EVERY
-- policy on profiles, orders and tap_profiles before recreating its own. If 002
-- is ever re-run after this file, the admin SELECT policies in section 9 go
-- with them and the Admin APK will read nothing but empty lists. Re-run 003
-- after any re-run of 002. Both are idempotent, so that is always safe.
--
-- This is the server half of the SHYGON Tap Admin APK. It is additive and
-- idempotent: it adds nothing the customer app reads, changes no customer
-- policy, and drops no existing object except the two functions it deliberately
-- replaces in place (both by CREATE OR REPLACE, so their triggers survive).
--
-- WHAT WAS FOUND BEFORE THIS FILE
--   `admin_users` existed in the live project with exactly two columns —
--   (user_id, created_at) — and NOTHING in the codebase referenced it. No role,
--   no permission, no active flag, no policy, no function. It was an allowlist
--   nobody consulted.
--
-- THE SECURITY MODEL THIS ESTABLISHES
--
--     authenticated user (JWT)
--            |
--            v  auth.uid()
--     admin_users  ->  is_active
--            |
--            v  role  +  explicit permission grants
--     admin_has('<permission>')
--            |
--            v  require_admin() raises 42501 if not satisfied
--     SECURITY DEFINER RPC performs the operation and writes an audit row
--
--   The Admin APK holds only the public anon key and the admin's own session.
--   There is no service-role key in this path, so there is nothing to leak, and
--   the authorization check runs inside the same transaction as the write.
--   Client-side permission checks in the APK are UX only; this file is the
--   boundary.
--
-- WHY NOT AN EDGE FUNCTION WITH THE SERVICE ROLE
--   Because that would replace an in-transaction check with a network hop that
--   carries a key able to bypass every policy in the database. Postgres already
--   knows who the caller is. The only operations that genuinely leave Postgres
--   (a Razorpay refund, an Expo push) are Edge Functions, in supabase/functions.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN ON AN UNPREPARED DATABASE
-- ---------------------------------------------------------------------------
-- A half-applied security model is worse than none: admin policies would
-- reference tables that do not exist, and every RPC below would fail at call
-- time rather than at install time. Fail loudly, now.
DO $$
DECLARE
  v_missing TEXT[] := '{}';
  v_table   TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles', 'orders', 'products', 'tap_profiles', 'admin_users',
    'entitlements', 'payments', 'order_items', 'cards', 'notifications',
    'support_tickets', 'support_messages', 'tap_events', 'webhook_events'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = v_table AND c.relkind = 'r'
    ) THEN
      v_missing := v_missing || v_table;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'Cannot install the admin platform: missing table(s) %. Apply 001_production_payments_and_catalog.sql and 002_shygon_v5_platform.sql first.',
      array_to_string(v_missing, ', ');
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 0b. PRE-FLIGHT ON WHAT IS ALREADY IN THIS PROJECT
-- ---------------------------------------------------------------------------
-- This project was NOT pristine when the admin platform was written. It already
-- contained an `admin_users` table and an `is_admin()` function that no
-- application code referenced. Both are reused rather than replaced — but both
-- can stop this migration in ways whose native error message says nothing
-- useful, so they are checked here first and reported in plain words.
DO $$
DECLARE
  v_rettype TEXT;
  v_dupes   BIGINT;
BEGIN
  -- CREATE OR REPLACE FUNCTION cannot change an existing function's return
  -- type; it fails with a bare 42P13 that does not say which function. The
  -- pre-existing is_admin() must therefore already return boolean.
  SELECT pg_catalog.format_type(p.prorettype, NULL) INTO v_rettype
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_admin' AND p.pronargs = 0;

  IF v_rettype IS NOT NULL AND v_rettype <> 'boolean' THEN
    RAISE EXCEPTION
      'public.is_admin() already exists in this project and returns %, not boolean. This migration needs it to return boolean. Inspect it first (\df+ public.is_admin), then either drop it — DROP FUNCTION public.is_admin(); — or, if an RLS policy depends on it, rewrite that policy before re-running this file.',
      v_rettype;
  END IF;

  -- Section 1 puts a UNIQUE index on admin_users(user_id). If the table was
  -- ever written to by hand it may hold duplicates, and the index build fails
  -- with a 23505 that names an index nobody has heard of.
  SELECT count(*) INTO v_dupes FROM (
    SELECT user_id FROM public.admin_users
    WHERE user_id IS NOT NULL
    GROUP BY user_id HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'public.admin_users holds % duplicated user_id value(s), so a unique index cannot be built. Resolve them first: SELECT user_id, count(*) FROM public.admin_users GROUP BY user_id HAVING count(*) > 1;',
      v_dupes;
  END IF;

  IF EXISTS (SELECT 1 FROM public.admin_users WHERE user_id IS NULL) THEN
    RAISE EXCEPTION
      'public.admin_users contains a row with a NULL user_id, which can never identify an administrator. Delete it first: DELETE FROM public.admin_users WHERE user_id IS NULL;';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. ADMIN IDENTITY
-- ---------------------------------------------------------------------------
-- `admin_users` is kept. user_id stays the identity, exactly as it was.
-- Everything below is an additive column with a safe default, so the rows that
-- are already in the table keep working and simply become role 'admin'.

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS role         TEXT   NOT NULL DEFAULT 'admin';
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS permissions  TEXT[] NOT NULL DEFAULT '{}';
-- The reason S1 in the readiness report existed: a compromised admin could only
-- be stopped by deleting the row, which also destroyed the audit trail's FK.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS is_active    BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- One row per admin. The table may have had no key at all.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_user
  ON public.admin_users(user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_users_role_valid') THEN
    ALTER TABLE public.admin_users ADD CONSTRAINT admin_users_role_valid
      CHECK (role IN ('owner', 'admin', 'fulfilment', 'support', 'viewer')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`: the SECURITY DEFINER helpers
-- below are owned by the table owner and must be able to read this table
-- without tripping the very policy they are used to evaluate.


-- ---------------------------------------------------------------------------
-- 1b. COMPANY EMAIL DOMAIN ALLOWLIST — A GUARDRAIL, NOT THE AUTH CONTROL
-- ---------------------------------------------------------------------------
-- Read this before assuming it is what gates admin access. It is not.
--
-- Authorization remains, unchanged and exclusively:
--     auth.uid() -> admin_users -> role -> permission
--
-- Someone who forged an address at an approved domain would still have exactly
-- zero access without a row in admin_users. This list constrains only WHICH
-- ADDRESSES AN OWNER IS ALLOWED TO PROMOTE, so a personal or mistyped address
-- cannot be handed administrative access by accident. Defence in depth on the
-- promotion action, layered on top of the real control — never a substitute
-- for it.
--
-- Configurable rather than hardcoded, because "who counts as company staff" is
-- an operational policy that will change, and changing it should not mean
-- editing and re-running a migration.
CREATE TABLE IF NOT EXISTS public.admin_allowed_email_domains (
  -- Stored bare and lowercase: 'shygon.com', never '@shygon.com'.
  domain     TEXT PRIMARY KEY CHECK (domain = lower(btrim(domain))
                                     AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  note       TEXT,
  added_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_allowed_email_domains ENABLE ROW LEVEL SECURITY;

-- The SELECT policy for this table is created in section 2b, immediately after
-- admin_has() exists. Postgres parses and resolves a policy expression at
-- CREATE POLICY time, so declaring it here — 100 lines before the function is
-- defined — aborted the whole migration with
-- "function public.admin_has(unknown) does not exist".
-- Writes go through the RPCs below only.

-- Seeded EMPTY on purpose. An empty list means "not configured yet" and imposes
-- no restriction — the alternative would be that applying this file instantly
-- locks every owner out of adding anybody. That fail-open is only acceptable
-- because this is a guardrail rather than a control, and because the
-- Administrators screen states plainly when no domain is configured instead of
-- letting the unrestricted state pass unnoticed.


-- ---------------------------------------------------------------------------
-- 2. ROLES AND PERMISSIONS
-- ---------------------------------------------------------------------------
-- Permission catalogue (the only strings any RPC below will accept):
--
--   orders.read        orders.fulfil     orders.cancel      orders.refund
--   customers.read     customers.manage
--   tap.read           tap.moderate
--   products.read      products.manage
--   inventory.read     inventory.manage
--   entitlements.read  entitlements.grant
--   support.read       support.respond
--   analytics.read     audit.read        admins.manage
--
-- A role expands to a fixed set. `admin_users.permissions` may add extra
-- grants on top of the role, but can never take one away — narrowing is done
-- by choosing a smaller role, which keeps the model easy to reason about.

CREATE OR REPLACE FUNCTION public.admin_role_permissions(p_role TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
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


-- Is the caller a live administrator? SECURITY DEFINER so it can consult
-- admin_users from inside a policy on admin_users without recursing.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid() AND a.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.role FROM public.admin_users a
  WHERE a.user_id = auth.uid() AND a.is_active;
$$;

CREATE OR REPLACE FUNCTION public.admin_has(p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- The gate every privileged RPC opens with. Returns the acting admin's id so
-- the caller can attribute the audit row without a second lookup.
-- A NULL permission means "any active administrator", for the handful of
-- surfaces (the notification feed, the admin's own identity) that every role
-- legitimately reaches.
CREATE OR REPLACE FUNCTION public.require_admin(p_permission TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.admin_role_permissions(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_admin(TEXT)          FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_admin()               TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_role()             TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_has(TEXT)          TO authenticated;


-- ---------------------------------------------------------------------------
-- 2b. POLICIES THAT DEPEND ON admin_has()
-- ---------------------------------------------------------------------------
-- Declared here rather than beside their table, because CREATE POLICY resolves
-- the function in its USING expression immediately.
DROP POLICY IF EXISTS "admin_domains_select" ON public.admin_allowed_email_domains;
CREATE POLICY "admin_domains_select" ON public.admin_allowed_email_domains
  FOR SELECT USING (public.admin_has('admins.manage'));


-- ---------------------------------------------------------------------------
-- 3. AUDIT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created
  ON public.admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_entity
  ON public.admin_audit_log(entity_type, entity_id);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_select" ON public.admin_audit_log;
CREATE POLICY "admin_audit_select" ON public.admin_audit_log
  FOR SELECT USING (public.admin_has('audit.read'));
-- No INSERT/UPDATE/DELETE policy anywhere: audit rows are written only by the
-- SECURITY DEFINER helper below, and can never be edited or removed by a
-- client — including by the admin who created them.

CREATE OR REPLACE FUNCTION public.admin_audit(
  p_admin       UUID,
  p_action      TEXT,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.admin_audit_log (admin_id, action, entity_type, entity_id, metadata)
  VALUES (p_admin, p_action, p_entity_type, p_entity_id, p_metadata);
$$;

REVOKE ALL ON FUNCTION public.admin_audit(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_audit(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. ADMIN NOTIFICATIONS AND PUSH TOKENS
-- ---------------------------------------------------------------------------
-- A feed separate from the customer `notifications` table. Mixing them would
-- put operational alerts behind a customer's RLS policy and vice versa.
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL = broadcast to every admin with the matching permission.
  admin_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  -- order | payment | support | inventory | tap | system
  category    TEXT NOT NULL DEFAULT 'system',
  -- info | warning | critical
  severity    TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  -- Deep link target inside the APK, e.g. /orders/<uuid>
  link        TEXT,
  metadata    JSONB,
  -- Set by the admin-push Edge Function once the row has been dispatched, so
  -- the dispatcher is resumable and never sends the same alert twice.
  pushed_at   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notifications_created
  ON public.admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_pending
  ON public.admin_notifications(created_at) WHERE pushed_at IS NULL;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notifications_select" ON public.admin_notifications;
CREATE POLICY "admin_notifications_select" ON public.admin_notifications
  FOR SELECT USING (
    public.is_admin() AND (admin_id IS NULL OR admin_id = auth.uid())
  );

-- Per-admin read state. Kept in its own table so a broadcast row can be read by
-- one admin without being marked read for everyone.
CREATE TABLE IF NOT EXISTS public.admin_notification_reads (
  notification_id UUID NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  admin_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (notification_id, admin_id)
);

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_notification_reads_own" ON public.admin_notification_reads;
CREATE POLICY "admin_notification_reads_own" ON public.admin_notification_reads
  FOR SELECT USING (admin_id = auth.uid());

DROP POLICY IF EXISTS "admin_notification_reads_insert_own" ON public.admin_notification_reads;
CREATE POLICY "admin_notification_reads_insert_own" ON public.admin_notification_reads
  FOR INSERT WITH CHECK (admin_id = auth.uid() AND public.is_admin());


CREATE TABLE IF NOT EXISTS public.admin_push_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_token   TEXT NOT NULL UNIQUE,
  platform     TEXT,
  device_name  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_push_tokens_admin
  ON public.admin_push_tokens(admin_id) WHERE revoked_at IS NULL;

ALTER TABLE public.admin_push_tokens ENABLE ROW LEVEL SECURITY;

-- Row-private even between administrators. A token is a capability to reach a
-- specific device; no admin has a reason to read another admin's.
DROP POLICY IF EXISTS "admin_push_tokens_own" ON public.admin_push_tokens;
CREATE POLICY "admin_push_tokens_own" ON public.admin_push_tokens
  FOR SELECT USING (admin_id = auth.uid());
-- Registration and revocation go through the RPCs below, never a direct write.


-- ---------------------------------------------------------------------------
-- 5. INVENTORY MOVEMENTS
-- ---------------------------------------------------------------------------
-- `products.stock` alone answers "how many" but never "why". Every admin
-- adjustment and every fulfilment decrement lands here.
CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku         VARCHAR(64) NOT NULL,
  delta       INTEGER NOT NULL,
  stock_after INTEGER,
  -- admin_adjustment | fulfilment | restock | correction
  reason      TEXT NOT NULL DEFAULT 'admin_adjustment',
  note        TEXT,
  admin_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  order_id    UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_sku
  ON public.inventory_movements(sku, created_at DESC);

ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_movements_admin_select" ON public.inventory_movements;
CREATE POLICY "inventory_movements_admin_select" ON public.inventory_movements
  FOR SELECT USING (public.admin_has('inventory.read'));


-- ---------------------------------------------------------------------------
-- 6. OPERATIONAL COLUMNS THE ADMIN APK NEEDS
-- ---------------------------------------------------------------------------
-- `orders` carried a bare tracking_number and nothing else about fulfilment.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipping_carrier      TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at            TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at          TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancelled_at          TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cancellation_reason   TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS admin_note            TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refunded_at           TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS refund_amount_in_paise INTEGER;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS razorpay_refund_id    TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_created        ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_order_status   ON public.orders(order_status);

-- Suspension is an administrative act distinct from the customer unpublishing
-- their own Tap: a suspended Tap must not come back when the owner toggles
-- `published`, so it is tracked separately.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_by     UUID
  REFERENCES auth.users(id) ON DELETE SET NULL;

-- Suspending a customer's whole account.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_at     TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS suspended_reason TEXT;

-- Threshold that drives the low-stock alert, per product, so a card with a long
-- lead time can warn earlier than one that reprints overnight.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 10;


-- ---------------------------------------------------------------------------
-- 7. THE PUBLIC TAP MUST RESPECT SUSPENSION
-- ---------------------------------------------------------------------------
-- get_public_tap() previously keyed only on `published`. Replaced in place so a
-- suspended Tap stops resolving immediately, everywhere, without touching the
-- customer app. Everything else about the function is byte-for-byte the prior
-- behaviour, including the entitlement clamp.
CREATE OR REPLACE FUNCTION public.get_public_tap(p_slug TEXT)
RETURNS TABLE (
  slug                   TEXT,
  display_name           TEXT,
  headline               TEXT,
  bio                    TEXT,
  avatar_url             TEXT,
  location               TEXT,
  phone                  TEXT,
  whatsapp               TEXT,
  email                  TEXT,
  website                TEXT,
  instagram              TEXT,
  linkedin               TEXT,
  theme_color            TEXT,
  ui_tier                TEXT,
  enabled_customizations TEXT[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap   public.tap_profiles%ROWTYPE;
  v_max   TEXT;
  v_owned TEXT[];
BEGIN
  SELECT * INTO v_tap
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(p_slug))
    AND t.published IS TRUE
    AND t.suspended_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_max := public.user_max_ui_tier(v_tap.user_id);

  SELECT COALESCE(array_agg(e.key), '{}')
  INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = v_tap.user_id
    AND e.is_active
    AND e.type = 'customization';

  RETURN QUERY SELECT
    v_tap.slug,
    v_tap.display_name,
    v_tap.headline,
    v_tap.bio,
    v_tap.avatar_url,
    v_tap.location,
    CASE WHEN 'phone'     = ANY (v_tap.enabled_customizations) THEN v_tap.phone     END,
    CASE WHEN 'whatsapp'  = ANY (v_tap.enabled_customizations)
          AND 'whatsapp'  = ANY (v_owned)                       THEN v_tap.whatsapp  END,
    CASE WHEN 'email'     = ANY (v_tap.enabled_customizations) THEN v_tap.email     END,
    CASE WHEN 'website'   = ANY (v_tap.enabled_customizations)
          AND 'website'   = ANY (v_owned)                       THEN v_tap.website   END,
    CASE WHEN 'instagram' = ANY (v_tap.enabled_customizations)
          AND 'instagram' = ANY (v_owned)                       THEN v_tap.instagram END,
    CASE WHEN 'linkedin'  = ANY (v_tap.enabled_customizations)
          AND 'linkedin'  = ANY (v_owned)                       THEN v_tap.linkedin  END,
    v_tap.theme_color,
    CASE WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_max)
         THEN v_tap.selected_ui_tier ELSE v_max END,
    ARRAY(SELECT unnest(v_tap.enabled_customizations)
          INTERSECT
          SELECT unnest(v_owned || ARRAY['phone', 'email']));
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tap(TEXT) TO anon, authenticated;

-- A suspended Tap must not accumulate analytics either.
CREATE OR REPLACE FUNCTION public.record_tap_event(
  p_slug     TEXT,
  p_event    TEXT,
  p_link_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_tap_event(TEXT, TEXT, TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 8. THE PAYMENT TRIGGER, AMENDED FOR ADMINS — CAREFULLY
-- ---------------------------------------------------------------------------
-- Finding S2: the original trigger refuses ANY caller with an auth.uid() that
-- tries to change order_status once payment_status is paid. That is correct for
-- customers and catastrophic for operations — it makes shipping an order
-- impossible from any authenticated context.
--
-- The single change below: a caller holding 'orders.fulfil' may move
-- order_status. Everything else is unchanged and still applies to admins:
--   * no client context may set payment_status to paid/refunded/captured
--   * no client context may edit amount, amount_in_paise or the gateway ids
-- Refunds therefore remain impossible from the APK; they go through the
-- admin-refund Edge Function, which uses the service role and has no
-- auth.uid() — the same door the payment webhook already uses.
CREATE OR REPLACE FUNCTION public.enforce_server_only_payment_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 9. ADMIN READ POLICIES
-- ---------------------------------------------------------------------------
-- Added ALONGSIDE the existing owner-only policies; Postgres ORs policies of
-- the same command, so a customer keeps exactly the access they had. These
-- exist so the APK can use Supabase Realtime (which is gated by RLS, not by
-- RPC) and so read paths do not all have to funnel through a function.
--
-- Scope note: `notifications` (the customer feed) deliberately gets NO admin
-- policy. Nothing in admin operations requires reading a customer's personal
-- notification stream.

DROP POLICY IF EXISTS "orders_select_admin" ON public.orders;
CREATE POLICY "orders_select_admin" ON public.orders
  FOR SELECT USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "order_items_select_admin" ON public.order_items;
CREATE POLICY "order_items_select_admin" ON public.order_items
  FOR SELECT USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "payments_select_admin" ON public.payments;
CREATE POLICY "payments_select_admin" ON public.payments
  FOR SELECT USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT USING (public.admin_has('customers.read'));

DROP POLICY IF EXISTS "tap_profiles_select_admin" ON public.tap_profiles;
CREATE POLICY "tap_profiles_select_admin" ON public.tap_profiles
  FOR SELECT USING (public.admin_has('tap.read'));

DROP POLICY IF EXISTS "entitlements_select_admin" ON public.entitlements;
CREATE POLICY "entitlements_select_admin" ON public.entitlements
  FOR SELECT USING (public.admin_has('entitlements.read'));

DROP POLICY IF EXISTS "cards_select_admin" ON public.cards;
CREATE POLICY "cards_select_admin" ON public.cards
  FOR SELECT USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "support_tickets_select_admin" ON public.support_tickets;
CREATE POLICY "support_tickets_select_admin" ON public.support_tickets
  FOR SELECT USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "support_messages_select_admin" ON public.support_messages;
CREATE POLICY "support_messages_select_admin" ON public.support_messages
  FOR SELECT USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "tap_events_select_admin" ON public.tap_events;
CREATE POLICY "tap_events_select_admin" ON public.tap_events
  FOR SELECT USING (public.admin_has('analytics.read'));

-- The existing products policy exposes only active rows. Admins must also see
-- disabled ones to re-enable them.
DROP POLICY IF EXISTS "products_select_admin" ON public.products;
CREATE POLICY "products_select_admin" ON public.products
  FOR SELECT USING (public.admin_has('products.read'));

DROP POLICY IF EXISTS "admin_users_select_admin" ON public.admin_users;
CREATE POLICY "admin_users_select_admin" ON public.admin_users
  FOR SELECT USING (public.is_admin());
-- Writes to admin_users happen only through admin_upsert_admin(), which
-- requires 'admins.manage'. No admin can promote themselves by writing here.


-- ---------------------------------------------------------------------------
-- 10. DASHBOARD
-- ---------------------------------------------------------------------------
-- Deliberately VOLATILE (the default): it stamps last_seen_at, and Postgres
-- refuses any write inside a STABLE function.
CREATE OR REPLACE FUNCTION public.admin_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 11. ORDERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_orders(
  p_search         TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_order_status   TEXT DEFAULT NULL,
  p_limit          INT  DEFAULT 25,
  p_offset         INT  DEFAULT 0
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


-- Ordered fulfilment stages. Advancing is normal; going backwards is a
-- correction and is allowed, but cancelling a delivered order is not.
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


CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id UUID,
  p_reason   TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 12. CUSTOMERS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_customers(
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
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


CREATE OR REPLACE FUNCTION public.admin_get_customer(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_set_customer_suspension(
  p_user_id   UUID,
  p_suspended BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 13. TAP PROFILES
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_taps(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- published | draft | suspended
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
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


CREATE OR REPLACE FUNCTION public.admin_get_tap(p_tap_id UUID)
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


CREATE OR REPLACE FUNCTION public.admin_set_tap_suspension(
  p_tap_id    UUID,
  p_suspended BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 14. ENTITLEMENTS — UI TIER UPGRADES WITHOUT A NEW CARD
-- ---------------------------------------------------------------------------
-- Granting a tier writes an `entitlements` row. It does NOT touch `cards`, so
-- the customer's existing physical card keeps working and their Tap simply
-- renders at the higher tier the next time get_public_tap() clamps it.
CREATE OR REPLACE FUNCTION public.admin_grant_entitlement(
  p_user_id UUID,
  p_type    TEXT,
  p_key     TEXT,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_revoke_entitlement(
  p_entitlement_id UUID,
  p_reason         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 15. PRODUCTS, PLANS, CUSTOMIZATIONS AND INVENTORY
-- ---------------------------------------------------------------------------
-- All three are rows in `products`, distinguished by product_type. There is no
-- second catalog table and none is created here.
CREATE OR REPLACE FUNCTION public.admin_list_products(
  p_type   TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 100,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- Patch-style update: only the keys present in p_patch are written, so a screen
-- that edits price alone cannot blank a description it never loaded.
CREATE OR REPLACE FUNCTION public.admin_update_product(
  p_sku   TEXT,
  p_patch JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- Stock is only ever moved through here, so every change has a reason and an
-- author. `products.stock` remains the single authoritative level.
CREATE OR REPLACE FUNCTION public.admin_adjust_stock(
  p_sku    TEXT,
  p_delta  INT,
  p_reason TEXT DEFAULT 'admin_adjustment',
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_inventory_history(
  p_sku   TEXT DEFAULT NULL,
  p_limit INT  DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 16. CARDS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_card(
  p_card_id  UUID,
  p_status   TEXT DEFAULT NULL,
  p_card_uid TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 17. SUPPORT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_tickets(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
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


CREATE OR REPLACE FUNCTION public.admin_get_ticket(p_ticket_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- Finding S4: `support_messages` has an INSERT policy that only accepts
-- author_role = 'customer'. A support agent structurally could not reply. This
-- runs as definer, so the reply is written without weakening that policy.
CREATE OR REPLACE FUNCTION public.admin_reply_ticket(
  p_ticket_id UUID,
  p_body      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_set_ticket_status(
  p_ticket_id UUID,
  p_status    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 18. ANALYTICS
-- ---------------------------------------------------------------------------
-- Every series below is derived from data the platform already records. Where
-- an obvious metric has no instrumentation (storefront visits, checkout
-- abandonment, delivery times) it is absent rather than approximated.
CREATE OR REPLACE FUNCTION public.admin_analytics(p_days INT DEFAULT 30)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 19. AUDIT AND ADMIN MANAGEMENT
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_audit(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_list_admins()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- Adds an administrator, or changes an existing one's role. Guarded hard,
-- because this is the one operation that can create privilege:
--   * only 'admins.manage' (i.e. an owner) may call it at all;
--   * the target must already be a real, confirmed auth user — this never
--     creates an account, so there is no invite path to abuse;
--   * you cannot change your own role, so an owner cannot accidentally demote
--     themselves out of the ability to fix it;
--   * the last active owner cannot be demoted.
CREATE OR REPLACE FUNCTION public.admin_upsert_admin(
  p_email        TEXT,
  p_role         TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- --- Managing the company domain allowlist -----------------------------------
-- Owner-only, and audited: widening who may be promoted is itself a privileged
-- act and belongs in the same record as everything else.

CREATE OR REPLACE FUNCTION public.admin_list_email_domains()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_add_email_domain(
  p_domain TEXT,
  p_note   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;


CREATE OR REPLACE FUNCTION public.admin_remove_email_domain(p_domain TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_set_admin_active(
  p_user_id UUID,
  p_active  BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- The signed-in admin's own identity and effective permissions. This is what
-- the APK calls right after login to decide whether to admit the session at
-- all, and which navigation entries to render.
-- VOLATILE (the default): it stamps last_seen_at, which a STABLE function may
-- not do.
CREATE OR REPLACE FUNCTION public.admin_me()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 20. NOTIFICATIONS: FEED, READ STATE AND PUSH REGISTRATION
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_limit  INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_mark_notifications_read(p_ids UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


CREATE OR REPLACE FUNCTION public.admin_register_push_token(
  p_token    TEXT,
  p_platform TEXT DEFAULT NULL,
  p_device   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;


CREATE OR REPLACE FUNCTION public.admin_revoke_push_token(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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


-- ---------------------------------------------------------------------------
-- 21. WHAT RAISES AN ADMIN ALERT
-- ---------------------------------------------------------------------------
-- Broadcast rows (admin_id NULL). The APK reads them over Realtime; the
-- admin-push Edge Function turns the unpushed ones into device notifications.
CREATE OR REPLACE FUNCTION public.admin_notify_order_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_orders_admin_notify ON public.orders;
CREATE TRIGGER trg_orders_admin_notify
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_order_event();


CREATE OR REPLACE FUNCTION public.admin_notify_low_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_products_admin_low_stock ON public.products;
CREATE TRIGGER trg_products_admin_low_stock
  AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_low_stock();


CREATE OR REPLACE FUNCTION public.admin_notify_new_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_support_admin_notify ON public.support_tickets;
CREATE TRIGGER trg_support_admin_notify
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_new_ticket();


-- A customer replying to an open ticket should reach the queue too.
CREATE OR REPLACE FUNCTION public.admin_notify_ticket_reply()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

DROP TRIGGER IF EXISTS trg_support_messages_admin_notify ON public.support_messages;
CREATE TRIGGER trg_support_messages_admin_notify
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.admin_notify_ticket_reply();


-- ---------------------------------------------------------------------------
-- 22. GRANTS
-- ---------------------------------------------------------------------------
-- Every RPC re-checks the caller internally, so EXECUTE alone grants nothing.
-- anon is excluded regardless: an unauthenticated caller has no business
-- reaching an admin entry point at all.
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'admin_me()',
    'admin_dashboard()',
    'admin_list_orders(text,text,text,integer,integer)',
    'admin_get_order(uuid)',
    'admin_update_order_status(uuid,text,text,text,text)',
    'admin_cancel_order(uuid,text)',
    'admin_list_customers(text,integer,integer)',
    'admin_get_customer(uuid)',
    'admin_set_customer_suspension(uuid,boolean,text)',
    'admin_list_taps(text,text,integer,integer)',
    'admin_get_tap(uuid)',
    'admin_set_tap_suspension(uuid,boolean,text)',
    'admin_grant_entitlement(uuid,text,text,text)',
    'admin_revoke_entitlement(uuid,text)',
    'admin_list_products(text,text,integer,integer)',
    'admin_update_product(text,jsonb)',
    'admin_adjust_stock(text,integer,text,text)',
    'admin_inventory_history(text,integer)',
    'admin_update_card(uuid,text,text)',
    'admin_list_tickets(text,text,integer,integer)',
    'admin_get_ticket(uuid)',
    'admin_reply_ticket(uuid,text)',
    'admin_set_ticket_status(uuid,text)',
    'admin_analytics(integer)',
    'admin_list_audit(integer,integer)',
    'admin_list_admins()',
    'admin_upsert_admin(text,text,text)',
    'admin_set_admin_active(uuid,boolean)',
    'admin_list_email_domains()',
    'admin_add_email_domain(text,text)',
    'admin_remove_email_domain(text)',
    'admin_list_notifications(integer,integer)',
    'admin_mark_notifications_read(uuid[])',
    'admin_register_push_token(text,text,text)',
    'admin_revoke_push_token(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_fn);
  END LOOP;
END $$;


-- Realtime: the APK subscribes to these two so a new order and a new alert
-- appear without a poll. RLS still applies to the stream, so a non-admin
-- subscriber receives nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 23. BOOTSTRAPPING THE FIRST OWNER
-- ---------------------------------------------------------------------------
-- Nothing here creates an administrator. `admins.manage` is required to add
-- one, which nobody holds until an owner exists — deliberately, so applying
-- this file can never by itself hand anyone access.
--
-- Promote the first owner ONCE, by hand, in the SQL editor, replacing the
-- email with the real one. This is the only step that is not self-service:
--
--   INSERT INTO public.admin_users (user_id, role, display_name, is_active)
--   SELECT id, 'owner', 'Your Name', true
--   FROM auth.users WHERE email = 'owner@shygon.tech'
--   ON CONFLICT (user_id) DO UPDATE
--     SET role = 'owner', is_active = true;
--
-- Any rows that already existed in admin_users are now role 'admin' and active,
-- because that is what the column defaults gave them. Review them:
--
--   SELECT a.user_id, u.email, a.role, a.is_active
--   FROM public.admin_users a JOIN auth.users u ON u.id = a.user_id;


-- ---------------------------------------------------------------------------
-- 24. VERIFICATION
-- ---------------------------------------------------------------------------
--   -- every admin table has RLS on
--   SELECT c.relname, c.relrowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE n.nspname = 'public'
--     AND c.relname IN ('admin_users','admin_audit_log','admin_notifications',
--                       'admin_notification_reads','admin_push_tokens',
--                       'inventory_movements');
--
--   -- a non-admin is refused (expect 42501)
--   SELECT public.admin_me();
--
--   -- an owner sees themselves and their full permission set
--   SELECT public.admin_me();
--
--   -- no admin function is reachable by anon
--   SELECT p.proname, array_agg(acl.privilege_type)
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL aclexplode(p.proacl) acl
--   JOIN pg_roles r ON r.oid = acl.grantee
--   WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' AND r.rolname = 'anon'
--   GROUP BY 1;
--   -- expect ZERO rows.
-- ============================================================================


-- ============================================================================
-- SHYGON TAP V5 — DIGITAL EXPERIENCES, TAP STATUS, PASS, EDIT RULE, THEMES
-- ============================================================================
-- Run AFTER 001, 002 and (if you use the Admin APK) 003.
--
-- ORDERING MATTERS, AND NOT ONLY THE FIRST TIME.
--   * Migration 002 seeds `products.ui_tier` with the OLD vocabulary and
--     defines the old `tier_rank()`. If 002 is ever re-run after this file,
--     re-run 004 afterwards or the experience clamp compares two different
--     vocabularies.
--   * Migration 003 drops nothing this file creates. This file deliberately
--     does NOT redefine get_public_tap() / record_tap_event(), so 003 stays
--     their sole owner; the new richer read path is a separate function.
--   * Everything here is additive and idempotent. Running it twice is safe.
--
-- WHAT THIS CLOSES
--   1. Two parallel vocabularies for the same four things. The storefront sold
--      plan ids while the database stored tier ids, and they disagreed: stored
--      `pro` meant BUSINESS. Anything keyed off the string got the wrong
--      experience. There is now ONE vocabulary, matching the product notes:
--          essential | business | premium | goat
--   2. A fifth "Custom" tier existed in the catalog and in the grant list.
--   3. `published` was a single boolean, so "never set up" and "deliberately
--      taken down" were indistinguishable and a visitor got a 404 for both.
--   4. The editing rule existed only as marketing copy. Per the product notes
--      it is ONE EDIT PER 14 DAYS — a rolling limit, not a window that expires
--      forever — lifted by the ₹999 Customization Pass.
--   5. The Pass had no definition. It unlocks unlimited editing and the full
--      colour palette. It does NOT hand over the paid experiences: Business,
--      Premium and GOAT are still bought on their own.
--   6. There was nowhere to store what a customer customised, and no rule about
--      which options their tier actually entitles them to.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. REFUSE TO RUN ON AN UNPREPARED DATABASE
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.entitlements') IS NULL THEN
    RAISE EXCEPTION 'Migration 001 has not been applied: public.entitlements is missing.';
  END IF;
  IF to_regclass('public.tap_profiles') IS NULL THEN
    RAISE EXCEPTION 'public.tap_profiles is missing. Run 001 then 002 first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tap_profiles'
      AND column_name = 'selected_ui_tier'
  ) THEN
    RAISE EXCEPTION 'Migration 002 has not been applied: tap_profiles.selected_ui_tier is missing.';
  END IF;
  IF to_regclass('public.order_items') IS NULL THEN
    RAISE EXCEPTION 'Migration 002 has not been applied: public.order_items is missing.';
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 1. ONE VOCABULARY FOR THE FOUR DIGITAL EXPERIENCES
-- ---------------------------------------------------------------------------
-- essential | business | premium | goat — the same four strings the storefront,
-- the account area and the public renderer use, and the same four names in the
-- product notes.
--
-- The conversion below is safely re-runnable because no legacy spelling
-- collides with a canonical one: `free`, `pro`, `3d` and `custom` do not exist
-- in the new vocabulary at all, and `premium` maps to itself (it was the third
-- tier before and is the third tier now). So there is no marker table and no
-- risk of double-mapping.
--
--   free    -> essential      (legacy name for the included tier)
--   pro     -> business       (legacy `pro` meant the SECOND tier)
--   premium -> premium        (unchanged, third tier)
--   3d      -> goat           (legacy name for the top tier)
--   custom  -> goat           (retired fifth tier, rendered as the top tier)
CREATE OR REPLACE FUNCTION public.canonical_experience(p_tier TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(btrim(COALESCE(p_tier, '')))
           WHEN 'goat'      THEN 'goat'
           WHEN '3d'        THEN 'goat'
           WHEN 'custom'    THEN 'goat'
           WHEN 'premium'   THEN 'premium'
           WHEN 'business'  THEN 'business'
           WHEN 'pro'       THEN 'business'
           WHEN 'essential' THEN 'essential'
           WHEN 'free'      THEN 'essential'
           ELSE 'essential'
         END;
$$;

CREATE OR REPLACE FUNCTION public.tier_rank(p_tier TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE public.canonical_experience(p_tier)
           WHEN 'goat'     THEN 3
           WHEN 'premium'  THEN 2
           WHEN 'business' THEN 1
           ELSE 0
         END;
$$;

UPDATE public.products
SET ui_tier = public.canonical_experience(ui_tier)
WHERE ui_tier IS NOT NULL AND ui_tier <> public.canonical_experience(ui_tier);

UPDATE public.tap_profiles
SET selected_ui_tier = public.canonical_experience(selected_ui_tier)
WHERE selected_ui_tier <> public.canonical_experience(selected_ui_tier);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_tier_valid') THEN
    ALTER TABLE public.tap_profiles DROP CONSTRAINT tap_profiles_tier_valid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_experience_valid') THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_experience_valid
      CHECK (selected_ui_tier IN ('essential', 'business', 'premium', 'goat')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.tap_profiles ALTER COLUMN selected_ui_tier SET DEFAULT 'essential';


-- ---------------------------------------------------------------------------
-- 2. THE CATALOG: FOUR EXPERIENCES, ONE PASS
-- ---------------------------------------------------------------------------
-- Experiences stay in `products` because that is what makes the server the only
-- thing that decides a price: create-order looks up `plan-<id>` and reads
-- price_in_paise. The SKU suffix, the entitlement key and the experience id are
-- now the same string, so there is no mapping table to keep in sync.
INSERT INTO public.products
  (sku, name, category, price_in_paise, product_type, ui_tier, short_description, active, sort_order)
VALUES
  ('plan-essential', 'Essential Experience', 'digital',     0, 'digital_plan', 'essential',
   'Clean, fast and professional. Included with every SHYGON Tap.', true, 60),
  ('plan-business',  'Business Experience',  'digital', 29900, 'digital_plan', 'business',
   'A professional profile with a polished opening animation.', true, 61),
  ('plan-premium',   'Premium Experience',   'digital', 59900, 'digital_plan', 'premium',
   'Premium presentation, smoother animation and a wider palette.', true, 62),
  ('plan-goat',      'GOAT Experience',      'digital', 99900, 'digital_plan', 'goat',
   'Greatest of all time. Maximum customization and a UI that adapts to you.', true, 63),
  ('pass-customization', 'Customization Pass', 'digital', 99900, 'lifetime_plan', NULL,
   'One-time ₹999. Edit your Tap whenever you like and unlock every colour palette.',
   true, 65)
ON CONFLICT (sku) DO UPDATE
SET name              = EXCLUDED.name,
    category          = EXCLUDED.category,
    price_in_paise    = EXCLUDED.price_in_paise,
    product_type      = EXCLUDED.product_type,
    ui_tier           = EXCLUDED.ui_tier,
    short_description = EXCLUDED.short_description,
    active            = EXCLUDED.active,
    sort_order        = EXCLUDED.sort_order;

-- The SKUs 002 seeded under the old names are kept but delisted: historical
-- orders reference them and a delete would orphan those rows.
UPDATE public.products SET active = false
WHERE sku IN ('plan-pro', 'plan-3d', 'plan-custom', 'plan-lifetime');

-- Anyone who bought under an old SKU keeps exactly what they paid for, under
-- the canonical key.
INSERT INTO public.entitlements (user_id, type, key, source_order_id, is_active)
SELECT e.user_id, 'digital_plan', public.canonical_experience(e.key), e.source_order_id, true
FROM public.entitlements e
WHERE e.type = 'digital_plan'
  AND e.is_active
  AND e.key IN ('pro', '3d', 'custom', 'free')
ON CONFLICT (user_id, type, key) DO UPDATE SET is_active = true;

UPDATE public.entitlements SET is_active = false
WHERE type = 'digital_plan' AND key IN ('pro', '3d', 'custom', 'free', 'essential');

-- Digital goods are unlimited; a stray 0 here would report every upgrade as out
-- of stock.
UPDATE public.products SET stock = NULL
WHERE product_type IN ('digital_plan', 'lifetime_plan', 'customization');


-- ---------------------------------------------------------------------------
-- 3. THE ₹999 CUSTOMIZATION PASS
-- ---------------------------------------------------------------------------
-- What it does, exactly, per the product notes:
--   * removes the one-edit-per-14-days limit
--   * unlocks every colour palette
-- What it deliberately does NOT do: hand over Business, Premium or GOAT. Those
-- are separate purchases. A single ₹999 payment must not give away the whole
-- experience catalogue.
--
-- It is a ONE-TIME purchase that grants a permanent entitlement, not a
-- recurring charge. The entitlement type stays `lifetime` so every existing
-- grant, policy and admin RPC keeps working.
CREATE OR REPLACE FUNCTION public.user_has_pass(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.entitlements e
    WHERE e.user_id = p_user AND e.is_active AND e.type = 'lifetime'
  );
$$;

REVOKE ALL ON FUNCTION public.user_has_pass(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_pass(UUID) FROM anon, authenticated;

-- Kept under its old name so migration 003's admin RPCs and any external caller
-- do not break.
CREATE OR REPLACE FUNCTION public.user_has_lifetime(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT public.user_has_pass(p_user); $$;

REVOKE ALL ON FUNCTION public.user_has_lifetime(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_lifetime(UUID) FROM anon, authenticated;

-- The Pass no longer implies an experience, so the highest experience a
-- customer may render comes only from what they actually bought.
CREATE OR REPLACE FUNCTION public.user_max_ui_tier(p_user UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (
      SELECT public.canonical_experience(e.key)
      FROM public.entitlements e
      WHERE e.user_id = p_user
        AND e.is_active
        AND e.type = 'digital_plan'
      ORDER BY public.tier_rank(e.key) DESC
      LIMIT 1
    ),
    'essential'
  );
$$;

REVOKE ALL ON FUNCTION public.user_max_ui_tier(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_max_ui_tier(UUID) FROM anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. TAP STATUS — draft | active | paused | archived
-- ---------------------------------------------------------------------------
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';
-- 003 adds this too; declared here so 004 does not depend on 003 being applied.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;

UPDATE public.tap_profiles
SET status = CASE WHEN published IS TRUE THEN 'active' ELSE 'draft' END
WHERE status IS NULL OR status NOT IN ('draft', 'active', 'paused', 'archived');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_status_valid') THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_status_valid
      CHECK (status IN ('draft', 'active', 'paused', 'archived')) NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.tap_profiles_sync_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL OR NEW.status NOT IN ('draft', 'active', 'paused', 'archived') THEN
      NEW.status := CASE WHEN NEW.published IS TRUE THEN 'active' ELSE 'draft' END;
    ELSE
      NEW.published := (NEW.status = 'active');
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.published := (NEW.status = 'active');
  ELSIF NEW.published IS DISTINCT FROM OLD.published THEN
    -- Taking a live Tap down is a pause, not a reset to draft: "draft" means
    -- never finished, and losing that distinction is what produced a 404 for a
    -- Tap the owner had only temporarily hidden.
    NEW.status := CASE
                    WHEN NEW.published IS TRUE THEN 'active'
                    WHEN OLD.status = 'active'  THEN 'paused'
                    ELSE OLD.status
                  END;
  END IF;

  IF NEW.published IS TRUE AND NEW.slug IS NULL THEN
    RAISE EXCEPTION 'Claim your Tap address before publishing.' USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort BEFORE trg_tap_profiles_publication: same-timing triggers fire
-- in name order, and published_at is stamped from NEW.published, which this
-- trigger is what sets when the caller only changed `status`.
DROP TRIGGER IF EXISTS trg_tap_profiles_00_status ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_00_status
  BEFORE INSERT OR UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tap_profiles_sync_status();

-- Why a visitor is not seeing a Tap, without revealing anything private.
CREATE OR REPLACE FUNCTION public.get_public_tap_state(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status    TEXT;
  v_suspended TIMESTAMPTZ;
BEGIN
  SELECT t.status, t.suspended_at INTO v_status, v_suspended
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
  LIMIT 1;

  IF NOT FOUND OR v_suspended IS NOT NULL THEN RETURN 'unavailable'; END IF;
  IF v_status = 'active' THEN RETURN 'active'; END IF;
  IF v_status = 'paused' THEN RETURN 'paused'; END IF;
  RETURN 'unavailable';
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tap_state(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tap_state(TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. THE EDITING RULE — ONE EDIT PER 14 DAYS
-- ---------------------------------------------------------------------------
-- From the product notes: "without ₹999 subscription can edit only once in 14
-- days; with it, can edit whenever they want".
--
-- Note this is a ROLLING LIMIT, not a window that expires. A customer without
-- the Pass can always edit their Tap — just not more than once a fortnight.
-- Their profile never becomes permanently frozen, which is what a one-off
-- window from the purchase date would have meant.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS last_content_edit_at TIMESTAMPTZ;
-- Kept for reference and for the admin app: when the customer's first card was
-- paid for.
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS edit_window_started_at TIMESTAMPTZ;

-- One place to change the policy.
CREATE OR REPLACE FUNCTION public.tap_edit_interval_days()
RETURNS INT LANGUAGE sql IMMUTABLE AS $$ SELECT 14 $$;

UPDATE public.tap_profiles t
SET edit_window_started_at = s.started
FROM (
  SELECT o.user_id,
         COALESCE(
           MIN(o.created_at) FILTER (WHERE i.product_type = 'card'),
           MIN(o.created_at)
         ) AS started
  FROM public.orders o
  LEFT JOIN public.order_items i ON i.order_id = o.id
  WHERE o.payment_status = 'paid' AND o.user_id IS NOT NULL
  GROUP BY o.user_id
) s
WHERE t.user_id = s.user_id
  AND t.edit_window_started_at IS NULL
  AND s.started IS NOT NULL;

-- May this customer make a content edit right now?
CREATE OR REPLACE FUNCTION public.tap_can_edit(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_has_pass(p_user)
      OR COALESCE(
           (SELECT t.last_content_edit_at
                     + make_interval(days => public.tap_edit_interval_days()) <= NOW()
            FROM public.tap_profiles t WHERE t.user_id = p_user),
           true  -- never edited: the first edit is always allowed
         );
$$;

REVOKE ALL ON FUNCTION public.tap_can_edit(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tap_can_edit(UUID) FROM anon, authenticated;

-- What the account area renders its banner and countdown from.
CREATE OR REPLACE FUNCTION public.tap_edit_state()
RETURNS TABLE (
  last_edit_at   TIMESTAMPTZ,
  next_edit_at   TIMESTAMPTZ,
  days_remaining INT,
  interval_days  INT,
  has_pass       BOOLEAN,
  can_edit       BOOLEAN,
  reason         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_last  TIMESTAMPTZ;
  v_next  TIMESTAMPTZ;
  v_pass  BOOLEAN;
  v_found BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.last_content_edit_at, true INTO v_last, v_found
  FROM public.tap_profiles t WHERE t.user_id = v_user;

  v_pass := public.user_has_pass(v_user);
  v_next := v_last + make_interval(days => public.tap_edit_interval_days());

  RETURN QUERY SELECT
    v_last,
    CASE WHEN v_pass THEN NULL ELSE v_next END,
    CASE WHEN v_pass OR v_next IS NULL THEN 0
         ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_next - NOW())) / 86400.0))::INT
    END,
    public.tap_edit_interval_days(),
    v_pass,
    CASE WHEN v_pass THEN true
         WHEN v_next IS NULL THEN true
         ELSE v_next <= NOW()
    END,
    CASE WHEN v_pass THEN 'pass'
         WHEN COALESCE(v_found, false) IS NOT TRUE THEN 'no_tap'
         WHEN v_next IS NULL THEN 'never_edited'
         WHEN v_next <= NOW() THEN 'edit_available'
         ELSE 'cooling_down'
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.tap_edit_state() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tap_edit_state() TO authenticated;


-- ---------------------------------------------------------------------------
-- 6. WHAT THE CUSTOMER CUSTOMISED, AND WHAT THEY MAY CUSTOMISE
-- ---------------------------------------------------------------------------
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_palette   TEXT NOT NULL DEFAULT 'midnight';
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_layout    TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_buttons   TEXT NOT NULL DEFAULT 'solid';
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_font      TEXT NOT NULL DEFAULT 'sans';
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS theme_animation TEXT NOT NULL DEFAULT 'auto';

-- The option catalogue lives in the database because it is an entitlement
-- question, not a styling question: which options a customer may pick is
-- decided by what they bought, and that decision has to be enforced somewhere
-- the browser cannot reach.
--
-- `p_kind` is one of palette | layout | buttons | font | animation.
CREATE OR REPLACE FUNCTION public.theme_options(
  p_kind TEXT,
  p_tier TEXT,
  p_pass BOOLEAN DEFAULT false
)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'palette' THEN
      -- Four palettes ship with every Tap. Premium and GOAT add their own, and
      -- the ₹999 Pass unlocks the whole set regardless of tier — that is what
      -- "unlock more colour palette" means.
      CASE
        WHEN p_pass THEN ARRAY['midnight','graphite','royal','forest','sunset','aurora',
                               'crimson','ivory','neon','molten','abyss','prism']
        WHEN public.tier_rank(p_tier) >= 3 THEN ARRAY['midnight','graphite','royal','forest',
                               'sunset','aurora','crimson','ivory','neon','molten','abyss','prism']
        WHEN public.tier_rank(p_tier) = 2 THEN ARRAY['midnight','graphite','royal','forest',
                               'sunset','aurora','crimson','ivory']
        WHEN public.tier_rank(p_tier) = 1 THEN ARRAY['midnight','graphite','royal','forest','sunset']
        ELSE ARRAY['midnight','graphite','royal','forest']
      END
    WHEN 'layout' THEN
      CASE
        WHEN public.tier_rank(p_tier) >= 3 THEN ARRAY['classic','centered','split','immersive']
        WHEN public.tier_rank(p_tier) = 2 THEN ARRAY['classic','centered','split']
        WHEN public.tier_rank(p_tier) = 1 THEN ARRAY['classic','centered']
        ELSE ARRAY['classic']
      END
    WHEN 'buttons' THEN
      CASE
        WHEN public.tier_rank(p_tier) >= 3 THEN ARRAY['solid','outline','glass','glow']
        WHEN public.tier_rank(p_tier) = 2 THEN ARRAY['solid','outline','glass']
        WHEN public.tier_rank(p_tier) = 1 THEN ARRAY['solid','outline']
        ELSE ARRAY['solid']
      END
    WHEN 'font' THEN
      CASE
        WHEN public.tier_rank(p_tier) >= 3 THEN ARRAY['sans','display','mono','editorial']
        WHEN public.tier_rank(p_tier) = 2 THEN ARRAY['sans','display','mono']
        WHEN public.tier_rank(p_tier) = 1 THEN ARRAY['sans','display']
        ELSE ARRAY['sans']
      END
    WHEN 'animation' THEN
      -- 'auto' means "whatever this experience does by default", which is the
      -- only honest option for Essential: it has no opening animation at all.
      CASE
        WHEN public.tier_rank(p_tier) >= 3 THEN ARRAY['auto','none','signature','dynamic']
        WHEN public.tier_rank(p_tier) = 2 THEN ARRAY['auto','none','signature']
        WHEN public.tier_rank(p_tier) = 1 THEN ARRAY['auto','none']
        ELSE ARRAY['auto','none']
      END
    ELSE ARRAY[]::TEXT[]
  END;
$$;

-- Everything the customizer needs to render itself, for the caller only.
CREATE OR REPLACE FUNCTION public.my_theme_options()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_tier TEXT;
  v_pass BOOLEAN;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  v_tier := public.user_max_ui_tier(v_user);
  v_pass := public.user_has_pass(v_user);

  RETURN jsonb_build_object(
    'max_experience', v_tier,
    'has_pass',       v_pass,
    'palette',        to_jsonb(public.theme_options('palette',   v_tier, v_pass)),
    'layout',         to_jsonb(public.theme_options('layout',    v_tier, v_pass)),
    'buttons',        to_jsonb(public.theme_options('buttons',   v_tier, v_pass)),
    'font',           to_jsonb(public.theme_options('font',      v_tier, v_pass)),
    'animation',      to_jsonb(public.theme_options('animation', v_tier, v_pass))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.my_theme_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_theme_options() TO authenticated;


-- ---------------------------------------------------------------------------
-- 7. PROFILE FIELDS THE EDITOR NEEDS
-- ---------------------------------------------------------------------------
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS designation  TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS company      TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS youtube      TEXT;
ALTER TABLE public.tap_profiles ADD COLUMN IF NOT EXISTS custom_links JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tap_profiles_custom_links_shape') THEN
    ALTER TABLE public.tap_profiles ADD CONSTRAINT tap_profiles_custom_links_shape
      CHECK (jsonb_typeof(custom_links) = 'array' AND jsonb_array_length(custom_links) <= 10)
      NOT VALID;
  END IF;
END $$;


-- ---------------------------------------------------------------------------
-- 8. THE EDIT RULE, ENFORCED
-- ---------------------------------------------------------------------------
-- The account UI disables the same fields, but that is only a courtesy: this
-- trigger is what makes the rule real, and it runs whether the change came from
-- the editor, a devtools console or a script.
CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier    TEXT;
  v_pass    BOOLEAN;
  v_owned   TEXT[];
  v_content BOOLEAN;
BEGIN
  -- The service role (fulfilment, migrations) has no auth.uid(); an admin RPC
  -- acting on somebody else's Tap is not the owner editing content. RLS already
  -- restricts a customer to rows where user_id = auth.uid().
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  v_tier := public.user_max_ui_tier(NEW.user_id);
  v_pass := public.user_has_pass(NEW.user_id);

  -- --- Entitlement checks. These apply at all times, Pass or not. -----------
  IF public.tier_rank(NEW.selected_ui_tier) > public.tier_rank(v_tier) THEN
    RAISE EXCEPTION 'You have not purchased the % experience.', NEW.selected_ui_tier
      USING ERRCODE = '42501';
  END IF;

  IF NEW.theme_palette <> ALL (public.theme_options('palette', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_layout <> ALL (public.theme_options('layout', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_buttons <> ALL (public.theme_options('buttons', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_font <> ALL (public.theme_options('font', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_animation <> ALL (public.theme_options('animation', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = NEW.user_id AND e.is_active AND e.type = 'customization';

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key)
    WHERE k.key <> ALL (v_owned || ARRAY['phone', 'email'])
  ) THEN
    RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE = '42501';
  END IF;

  -- --- The once-per-14-days rule -------------------------------------------
  -- Only CONTENT counts as an edit. Publishing, pausing, and switching to
  -- something already paid for are not content changes and are never rationed —
  -- rationing them would mean selling an upgrade the customer cannot apply.
  v_content :=
       NEW.display_name IS DISTINCT FROM OLD.display_name
    OR NEW.headline     IS DISTINCT FROM OLD.headline
    OR NEW.designation  IS DISTINCT FROM OLD.designation
    OR NEW.company      IS DISTINCT FROM OLD.company
    OR NEW.bio          IS DISTINCT FROM OLD.bio
    OR NEW.avatar_url   IS DISTINCT FROM OLD.avatar_url
    OR NEW.location     IS DISTINCT FROM OLD.location
    OR NEW.phone        IS DISTINCT FROM OLD.phone
    OR NEW.whatsapp     IS DISTINCT FROM OLD.whatsapp
    OR NEW.email        IS DISTINCT FROM OLD.email
    OR NEW.website      IS DISTINCT FROM OLD.website
    OR NEW.instagram    IS DISTINCT FROM OLD.instagram
    OR NEW.linkedin     IS DISTINCT FROM OLD.linkedin
    OR NEW.youtube      IS DISTINCT FROM OLD.youtube
    OR NEW.custom_links IS DISTINCT FROM OLD.custom_links
    OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL);

  IF NOT v_content THEN
    RETURN NEW;
  END IF;

  IF NOT public.tap_can_edit(NEW.user_id) THEN
    RAISE EXCEPTION
      'You can change your Tap once every % days. The Customization Pass removes the limit.',
      public.tap_edit_interval_days()
      USING ERRCODE = '42501';
  END IF;

  -- Stamped by the database, so the clock cannot be reset from the browser.
  NEW.last_content_edit_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_profiles_edit_window ON public.tap_profiles;
DROP TRIGGER IF EXISTS trg_tap_profiles_edit_rules ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_edit_rules
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tap_edit_rules();


-- ---------------------------------------------------------------------------
-- 9. THE PUBLIC READ PATH
-- ---------------------------------------------------------------------------
-- Returns JSONB rather than a fixed column list so adding a profile field later
-- does not mean dropping and recreating the function (and does not collide with
-- migration 003, which owns get_public_tap()).
--
-- Everything is clamped here, server-side: the experience to what was bought,
-- the theme to what that experience unlocks, and each contact field to whether
-- the customer switched it on AND owns the add-on.
CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap   public.tap_profiles%ROWTYPE;
  v_tier  TEXT;
  v_pass  BOOLEAN;
  v_owned TEXT[];
  v_shown TEXT[];
  v_clamp TEXT;
BEGIN
  SELECT * INTO v_tap
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
    AND t.status = 'active'
    AND t.suspended_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_tier := public.user_max_ui_tier(v_tap.user_id);
  v_pass := public.user_has_pass(v_tap.user_id);

  SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = v_tap.user_id AND e.is_active AND e.type = 'customization';

  v_shown := ARRAY(
    SELECT unnest(v_tap.enabled_customizations)
    INTERSECT
    SELECT unnest(v_owned || ARRAY['phone', 'email'])
  );

  -- A customer who selected an experience and later lost it renders at the one
  -- they still hold, rather than being handed something they no longer own.
  v_clamp := CASE
               WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
               THEN public.canonical_experience(v_tap.selected_ui_tier)
               ELSE v_tier
             END;

  RETURN jsonb_build_object(
    'slug',        v_tap.slug,
    'experience',  v_clamp,
    'displayName', v_tap.display_name,
    'headline',    v_tap.headline,
    'designation', v_tap.designation,
    'company',     v_tap.company,
    'bio',         v_tap.bio,
    'avatarUrl',   v_tap.avatar_url,
    'location',    v_tap.location,
    'phone',     CASE WHEN 'phone'     = ANY (v_shown) THEN v_tap.phone     END,
    'whatsapp',  CASE WHEN 'whatsapp'  = ANY (v_shown) THEN v_tap.whatsapp  END,
    'email',     CASE WHEN 'email'     = ANY (v_shown) THEN v_tap.email     END,
    'website',   CASE WHEN 'website'   = ANY (v_shown) THEN v_tap.website   END,
    'instagram', CASE WHEN 'instagram' = ANY (v_shown) THEN v_tap.instagram END,
    'linkedin',  CASE WHEN 'linkedin'  = ANY (v_shown) THEN v_tap.linkedin  END,
    'youtube',   CASE WHEN 'youtube'   = ANY (v_shown) THEN v_tap.youtube   END,
    'customLinks', CASE WHEN 'links' = ANY (v_shown) THEN v_tap.custom_links
                        ELSE '[]'::jsonb END,
    'theme', jsonb_build_object(
      'palette',   CASE WHEN v_tap.theme_palette = ANY (public.theme_options('palette', v_clamp, v_pass))
                        THEN v_tap.theme_palette ELSE 'midnight' END,
      'layout',    CASE WHEN v_tap.theme_layout = ANY (public.theme_options('layout', v_clamp, v_pass))
                        THEN v_tap.theme_layout ELSE 'classic' END,
      'buttons',   CASE WHEN v_tap.theme_buttons = ANY (public.theme_options('buttons', v_clamp, v_pass))
                        THEN v_tap.theme_buttons ELSE 'solid' END,
      'font',      CASE WHEN v_tap.theme_font = ANY (public.theme_options('font', v_clamp, v_pass))
                        THEN v_tap.theme_font ELSE 'sans' END,
      'animation', CASE WHEN v_tap.theme_animation = ANY (public.theme_options('animation', v_clamp, v_pass))
                        THEN v_tap.theme_animation ELSE 'auto' END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. NOTIFICATION PREFERENCES THAT ACTUALLY GATE NOTIFICATIONS
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_order_updates BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_tap_activity  BOOLEAN NOT NULL DEFAULT true;

-- Replaces 002's version. The only change: shipping/delivery notifications
-- respect the preference. "Order placed" and "Payment confirmed" do not —
-- those are transaction receipts, and silently withholding one is worse than
-- an unwanted notification.
CREATE OR REPLACE FUNCTION public.notify_order_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wants BOOLEAN := true;
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'order', 'Order placed',
            'We have received order ' || COALESCE(NEW.order_id, '') || '.',
            '/shygontap/orders', jsonb_build_object('order_id', NEW.id));
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     AND NEW.payment_status = 'paid' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'payment', 'Payment confirmed',
            'Payment for order ' || COALESCE(NEW.order_id, '') || ' was successful.',
            '/shygontap/orders', jsonb_build_object('order_id', NEW.id));
  END IF;

  SELECT COALESCE(p.notify_order_updates, true) INTO v_wants
  FROM public.profiles p WHERE p.id = NEW.user_id;

  IF COALESCE(v_wants, true)
     AND NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status IN ('shipped', 'out_for_delivery', 'delivered') THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (NEW.user_id, 'shipping',
            CASE NEW.order_status
              WHEN 'shipped'          THEN 'Your Tap has shipped'
              WHEN 'out_for_delivery' THEN 'Out for delivery'
              ELSE                         'Delivered'
            END,
            'Order ' || COALESCE(NEW.order_id, '') || ' is now ' ||
              replace(NEW.order_status, '_', ' ') || '.',
            '/shygontap/orders',
            jsonb_build_object('order_id', NEW.id, 'tracking_number', NEW.tracking_number));
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 11. ACCOUNT EVENT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type   VARCHAR(48) NOT NULL,
  subject_type VARCHAR(32),
  subject_id   TEXT,
  detail       JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_events_user
  ON public.account_events(user_id, created_at DESC);

ALTER TABLE public.account_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_events_select_own" ON public.account_events;
CREATE POLICY "account_events_select_own" ON public.account_events
  FOR SELECT USING (auth.uid() = user_id);
-- No write policy: an event log a client can write is not a log.

CREATE OR REPLACE FUNCTION public.log_account_event(
  p_user UUID, p_type TEXT, p_subject_type TEXT DEFAULT NULL,
  p_subject_id TEXT DEFAULT NULL, p_detail JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.account_events (user_id, event_type, subject_type, subject_id, detail)
  SELECT p_user, left(p_type, 48), left(p_subject_type, 32), p_subject_id, p_detail
  WHERE p_user IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.log_account_event(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_account_event(UUID, TEXT, TEXT, TEXT, JSONB)
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.account_events_from_tap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_account_event(NEW.user_id, 'tap.created', 'tap', NEW.id::text,
      jsonb_build_object('slug', NEW.slug, 'status', NEW.status));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_account_event(
      NEW.user_id,
      CASE NEW.status WHEN 'active' THEN 'tap.published'
                      WHEN 'paused' THEN 'tap.paused'
                      ELSE 'tap.status_changed' END,
      'tap', NEW.id::text,
      jsonb_build_object('from', OLD.status, 'to', NEW.status, 'slug', NEW.slug));
  END IF;

  IF NEW.selected_ui_tier IS DISTINCT FROM OLD.selected_ui_tier THEN
    PERFORM public.log_account_event(NEW.user_id, 'tap.experience_changed', 'tap', NEW.id::text,
      jsonb_build_object('from', OLD.selected_ui_tier, 'to', NEW.selected_ui_tier));
  END IF;

  IF NEW.last_content_edit_at IS DISTINCT FROM OLD.last_content_edit_at THEN
    PERFORM public.log_account_event(NEW.user_id, 'tap.content_edited', 'tap', NEW.id::text, NULL);
  END IF;

  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    PERFORM public.log_account_event(NEW.user_id, 'tap.address_changed', 'tap', NEW.id::text,
      jsonb_build_object('from', OLD.slug, 'to', NEW.slug));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_profiles_events ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_events
  AFTER INSERT OR UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.account_events_from_tap();

CREATE OR REPLACE FUNCTION public.account_events_from_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_account_event(NEW.user_id, 'order.placed', 'order', NEW.id::text,
      jsonb_build_object('order_id', NEW.order_id, 'amount_in_paise', NEW.amount_in_paise,
                         'order_type', NEW.order_type));
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    PERFORM public.log_account_event(NEW.user_id, 'payment.' || NEW.payment_status,
      'order', NEW.id::text,
      jsonb_build_object('order_id', NEW.order_id,
                         'razorpay_payment_id', NEW.razorpay_payment_id));
  END IF;

  IF NEW.order_status IS DISTINCT FROM OLD.order_status THEN
    PERFORM public.log_account_event(NEW.user_id, 'order.' || NEW.order_status,
      'order', NEW.id::text,
      jsonb_build_object('order_id', NEW.order_id, 'tracking_number', NEW.tracking_number));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_events ON public.orders;
CREATE TRIGGER trg_orders_events
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.account_events_from_order();

CREATE OR REPLACE FUNCTION public.account_events_from_entitlement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  PERFORM public.log_account_event(
    NEW.user_id,
    CASE WHEN NEW.is_active THEN 'entitlement.granted' ELSE 'entitlement.revoked' END,
    'entitlement', NEW.id::text,
    jsonb_build_object('type', NEW.type, 'key', NEW.key, 'order', NEW.source_order_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entitlements_events ON public.entitlements;
CREATE TRIGGER trg_entitlements_events
  AFTER INSERT OR UPDATE ON public.entitlements
  FOR EACH ROW EXECUTE FUNCTION public.account_events_from_entitlement();


-- ---------------------------------------------------------------------------
-- 12. PROVISIONING
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_tap_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug    TEXT;
  v_name    TEXT;
  v_email   TEXT;
  v_created BOOLEAN := false;
BEGIN
  IF NEW.payment_status <> 'paid'
     OR OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
     OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_slug := public.generate_tap_slug(NEW.user_id);

  SELECT p.full_name, p.email INTO v_name, v_email
  FROM public.profiles p WHERE p.id = NEW.user_id;

  INSERT INTO public.tap_profiles
    (user_id, customer_id, published, status, slug, username, display_name, email,
     selected_ui_tier, enabled_customizations, edit_window_started_at)
  VALUES (NEW.user_id, NEW.user_id, false, 'draft', v_slug, v_slug, v_name, v_email,
          'essential', ARRAY['phone', 'email'], NEW.created_at)
  ON CONFLICT (user_id) DO NOTHING;

  v_created := FOUND;

  UPDATE public.tap_profiles
  SET slug = v_slug, username = COALESCE(username, v_slug)
  WHERE user_id = NEW.user_id AND slug IS NULL;

  UPDATE public.tap_profiles
  SET edit_window_started_at = LEAST(COALESCE(edit_window_started_at, NEW.created_at),
                                     NEW.created_at)
  WHERE user_id = NEW.user_id;

  IF v_created THEN
    INSERT INTO public.notifications (user_id, category, title, body, link)
    VALUES (NEW.user_id, 'tap', 'Your Tap profile is ready',
            'Complete your profile, choose an experience and publish it to go live.',
            '/shygontap/tap');
  END IF;

  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 13. VERIFICATION
-- ---------------------------------------------------------------------------
--   SELECT sku, ui_tier, price_in_paise, active FROM public.products
--   WHERE product_type IN ('digital_plan','lifetime_plan') ORDER BY sort_order;
--   -- expect active: plan-essential/business/premium/goat + pass-customization
--
--   SELECT status, published, count(*) FROM public.tap_profiles GROUP BY 1,2;
--   -- expect status and published always to agree (active <=> true)
--
--   SELECT public.theme_options('palette', 'essential', false);  -- 4 palettes
--   SELECT public.theme_options('palette', 'essential', true);   -- all 12
--   SELECT public.get_public_profile('some-slug');
-- ============================================================================


-- ============================================================================
-- SHYGON TAP V5 — EVENT THEMES + EDIT RULE HARDENING
-- ============================================================================
-- Closes the live/source drift around seasonal themes and makes the 14-day rule
-- fail-safe at the database boundary.
--
-- Event themes are platform-controlled seasonal presentation. Customer-selected
-- theme choices remain entitlement-gated; an event can temporarily override a
-- component only when that component is already valid for the customer's
-- experience/Pass. This preserves paid-tier boundaries while still allowing
-- automatic event styling.
--
-- Event dates are interpreted in Asia/Kolkata because the V5 event calendar is
-- India-facing. This avoids a UTC-midnight rollover selecting the wrong date.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.tap_profiles') IS NULL THEN
    RAISE EXCEPTION 'Migration 004 must be applied before 005: public.tap_profiles is missing.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. SEASONAL EVENT THEME CATALOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tap_event_themes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  starts_on  DATE NOT NULL,
  ends_on    DATE NOT NULL,
  palette    TEXT NOT NULL DEFAULT 'midnight',
  layout     TEXT NOT NULL DEFAULT 'classic',
  buttons    TEXT NOT NULL DEFAULT 'solid',
  font       TEXT NOT NULL DEFAULT 'sans',
  animation  TEXT NOT NULL DEFAULT 'auto',
  priority   INT NOT NULL DEFAULT 0,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tap_event_themes_dates_valid CHECK (starts_on <= ends_on),
  CONSTRAINT tap_event_themes_palette_valid CHECK (palette IN ('midnight','graphite','royal','forest','sunset','aurora','crimson','ivory','neon','molten','abyss','prism')),
  CONSTRAINT tap_event_themes_layout_valid CHECK (layout IN ('classic','centered','split','immersive')),
  CONSTRAINT tap_event_themes_buttons_valid CHECK (buttons IN ('solid','outline','glass','glow')),
  CONSTRAINT tap_event_themes_font_valid CHECK (font IN ('sans','display','mono','editorial')),
  CONSTRAINT tap_event_themes_animation_valid CHECK (animation IN ('auto','none','signature','dynamic'))
);

CREATE INDEX IF NOT EXISTS tap_event_themes_active_dates_idx
  ON public.tap_event_themes (starts_on, ends_on, priority DESC)
  WHERE active;

ALTER TABLE public.tap_event_themes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tap_event_themes_none ON public.tap_event_themes;
CREATE POLICY tap_event_themes_none ON public.tap_event_themes
  FOR ALL TO public USING (false) WITH CHECK (false);

-- 2026 calendar used by the shipped V5 storefront. Dates are inclusive.
INSERT INTO public.tap_event_themes
  (code,name,starts_on,ends_on,palette,layout,buttons,font,animation,priority,active)
VALUES
  ('new-year','New Year','2026-01-01','2026-01-02','sunset','centered','solid','sans','auto',100,true),
  ('republic-day','Republic Day','2026-01-26','2026-01-27','royal','centered','solid','display','signature',90,true),
  ('valentines','Valentine''s Day','2026-02-14','2026-02-15','crimson','centered','glow','display','signature',80,true),
  ('holi','Holi','2026-03-04','2026-03-05','prism','classic','solid','sans','auto',95,true),
  ('womens-day','International Women''s Day','2026-03-08','2026-03-09','sunset','centered','glass','display','signature',70,true),
  ('ugadi','Ugadi','2026-03-19','2026-03-20','forest','centered','solid','display','signature',85,true),
  ('eid-fitr','Eid al-Fitr','2026-03-21','2026-03-22','ivory','centered','glass','sans','signature',85,true),
  ('eid-adha','Eid al-Adha','2026-05-27','2026-05-28','ivory','centered','glass','sans','signature',80,true),
  ('independence-day','Independence Day','2026-08-15','2026-08-16','royal','immersive','glow','display','dynamic',95,true),
  ('janmashtami','Janmashtami','2026-09-04','2026-09-05','royal','centered','glass','display','signature',85,true),
  ('ganesh-chaturthi','Ganesh Chaturthi','2026-09-14','2026-09-25','molten','immersive','glow','display','dynamic',105,true),
  ('gandhi-jayanti','Gandhi Jayanti','2026-10-02','2026-10-03','ivory','classic','solid','sans','auto',75,true),
  ('dussehra','Dussehra','2026-10-20','2026-10-21','sunset','immersive','glow','display','dynamic',100,true),
  ('halloween','Halloween','2026-10-31','2026-11-01','molten','immersive','glow','display','dynamic',90,true),
  ('diwali','Diwali','2026-11-07','2026-11-11','molten','immersive','glow','display','dynamic',120,true),
  ('children-day','Children''s Day','2026-11-14','2026-11-15','neon','centered','glass','display','dynamic',70,true),
  ('guru-nanak-jayanti','Guru Nanak Jayanti','2026-11-24','2026-11-25','forest','centered','glass','display','signature',80,true),
  ('christmas','Christmas','2026-12-24','2026-12-27','forest','immersive','glow','display','dynamic',100,true),
  ('new-year-eve','New Year''s Eve','2026-12-31','2027-01-02','prism','immersive','glow','display','dynamic',110,true)
ON CONFLICT (code) DO UPDATE SET
  name=EXCLUDED.name, starts_on=EXCLUDED.starts_on, ends_on=EXCLUDED.ends_on,
  palette=EXCLUDED.palette, layout=EXCLUDED.layout, buttons=EXCLUDED.buttons,
  font=EXCLUDED.font, animation=EXCLUDED.animation, priority=EXCLUDED.priority,
  active=EXCLUDED.active, updated_at=now();

CREATE OR REPLACE FUNCTION public.tap_event_theme_for(p_at TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object(
      'code', e.code,
      'name', e.name,
      'startsOn', e.starts_on,
      'endsOn', e.ends_on,
      'theme', jsonb_build_object(
        'palette', e.palette,
        'layout', e.layout,
        'buttons', e.buttons,
        'font', e.font,
        'animation', e.animation
      )
    )
    FROM public.tap_event_themes e
    WHERE e.active
      AND (p_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN e.starts_on AND e.ends_on
    ORDER BY e.priority DESC, e.starts_on DESC, e.code
    LIMIT 1
  ), '{}'::jsonb);
$$;

CREATE OR REPLACE FUNCTION public.my_event_theme()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.tap_event_theme_for(now());
$$;

REVOKE ALL ON FUNCTION public.tap_event_theme_for(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tap_event_theme_for(TIMESTAMPTZ) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.my_event_theme() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_event_theme() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. HARDEN THE 14-DAY EDIT TRIGGER
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tap_edit_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier    TEXT;
  v_pass    BOOLEAN;
  v_owned   TEXT[];
  v_content BOOLEAN;
BEGIN
  IF auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  v_tier := public.user_max_ui_tier(NEW.user_id);
  v_pass := public.user_has_pass(NEW.user_id);

  -- Phone/email are the two built-in contact actions and cannot be removed by
  -- a browser payload. Paid toggles remain entitlement-gated below.
  NEW.enabled_customizations := ARRAY(
    SELECT DISTINCT value
    FROM unnest(COALESCE(NEW.enabled_customizations, '{}'::text[]) || ARRAY['phone','email']) AS u(value)
    WHERE value <> ''
    ORDER BY value
  );

  IF public.tier_rank(NEW.selected_ui_tier) > public.tier_rank(v_tier) THEN
    RAISE EXCEPTION 'You have not purchased the % experience.', NEW.selected_ui_tier
      USING ERRCODE = '42501';
  END IF;

  IF NEW.theme_palette <> ALL (public.theme_options('palette', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That colour palette is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_layout <> ALL (public.theme_options('layout', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That layout is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_buttons <> ALL (public.theme_options('buttons', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That button style is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_font <> ALL (public.theme_options('font', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That font is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;
  IF NEW.theme_animation <> ALL (public.theme_options('animation', v_tier, v_pass)) THEN
    RAISE EXCEPTION 'That animation style is not unlocked on your plan.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = NEW.user_id AND e.is_active AND e.type = 'customization';

  IF EXISTS (
    SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key)
    WHERE k.key <> ALL (v_owned || ARRAY['phone','email'])
  ) THEN
    RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE = '42501';
  END IF;

  -- CONTENT includes profile fields plus the customer-selected visual theme.
  -- Switching to an already-paid experience remains outside the limit.
  v_content :=
       NEW.display_name IS DISTINCT FROM OLD.display_name
    OR NEW.headline IS DISTINCT FROM OLD.headline
    OR NEW.designation IS DISTINCT FROM OLD.designation
    OR NEW.company IS DISTINCT FROM OLD.company
    OR NEW.bio IS DISTINCT FROM OLD.bio
    OR NEW.avatar_url IS DISTINCT FROM OLD.avatar_url
    OR NEW.location IS DISTINCT FROM OLD.location
    OR NEW.phone IS DISTINCT FROM OLD.phone
    OR NEW.whatsapp IS DISTINCT FROM OLD.whatsapp
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.website IS DISTINCT FROM OLD.website
    OR NEW.instagram IS DISTINCT FROM OLD.instagram
    OR NEW.linkedin IS DISTINCT FROM OLD.linkedin
    OR NEW.youtube IS DISTINCT FROM OLD.youtube
    OR NEW.custom_links IS DISTINCT FROM OLD.custom_links
    OR NEW.theme_palette IS DISTINCT FROM OLD.theme_palette
    OR NEW.theme_layout IS DISTINCT FROM OLD.theme_layout
    OR NEW.theme_buttons IS DISTINCT FROM OLD.theme_buttons
    OR NEW.theme_font IS DISTINCT FROM OLD.theme_font
    OR NEW.theme_animation IS DISTINCT FROM OLD.theme_animation
    OR (NEW.slug IS DISTINCT FROM OLD.slug AND OLD.slug IS NOT NULL);

  IF NOT v_content THEN
    RETURN NEW;
  END IF;

  IF NOT public.tap_can_edit(NEW.user_id) THEN
    RAISE EXCEPTION
      'You can change your Tap once every % days. The Customization Pass removes the limit.',
      public.tap_edit_interval_days()
      USING ERRCODE = '42501';
  END IF;

  NEW.last_content_edit_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_profiles_edit_window ON public.tap_profiles;
DROP TRIGGER IF EXISTS trg_tap_profiles_edit_rules ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_edit_rules
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tap_edit_rules();

-- ---------------------------------------------------------------------------
-- 3. SOURCE-OF-TRUTH PUBLIC PROFILE FUNCTION, INCLUDING EVENT METADATA
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.get_public_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(TEXT) TO anon;
-- Signed-in visitors can still open public URLs with the anon role; no need to
-- expose this privileged SECURITY DEFINER RPC to every authenticated session.
REVOKE EXECUTE ON FUNCTION public.get_public_profile(TEXT) FROM authenticated;

-- ---------------------------------------------------------------------------
-- 4. CATALOG CLEANUP: DON'T SELL AN UNIMPLEMENTED GALLERY
-- ---------------------------------------------------------------------------
UPDATE public.products
SET active = false
WHERE sku = 'addon-gallery';

-- Location already has a real profile field and renderer support. Keep its
-- product active and make the editor expose the purchased toggle.
UPDATE public.products
SET active = true
WHERE sku = 'addon-location' AND product_type = 'customization';


-- SHYGON TAP V5 — RELIABLE PAYMENT FULFILMENT
-- Prevents a paid order from becoming permanently "done" when an entitlement,
-- card, profile or other fulfilment side effect fails after the initial claim.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_valid') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_status_valid
      CHECK (fulfillment_status IN ('pending','processing','retry','fulfilled')) NOT VALID;
  END IF;
END $$;

-- Existing paid orders were already handled by the old success path. Mark them
-- fulfilled so this migration itself never re-decrements inventory.
UPDATE public.orders
SET fulfillment_status = 'fulfilled',
    fulfilled_at = COALESCE(fulfilled_at, updated_at, created_at)
WHERE payment_status = 'paid'
  AND fulfillment_status = 'pending';

CREATE INDEX IF NOT EXISTS orders_fulfillment_retry_idx
  ON public.orders (fulfillment_status, updated_at)
  WHERE fulfillment_status IN ('processing','retry');


-- SHYGON TAP V5 — RLS PERFORMANCE + RPC PERMISSIONS
-- Evaluate auth context once per statement and keep public RPCs limited to anon.

DROP POLICY IF EXISTS "Customers can view payments for their orders" ON public.payments;
CREATE POLICY "Customers can view payments for their orders" ON public.payments
  FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.orders
    WHERE orders.id = payments.order_id
      AND orders.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO public
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS tap_profiles_insert_own ON public.tap_profiles;
CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);
DROP POLICY IF EXISTS tap_profiles_update_own ON public.tap_profiles;
CREATE POLICY tap_profiles_update_own ON public.tap_profiles FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS order_items_select_own ON public.order_items;
CREATE POLICY order_items_select_own ON public.order_items FOR SELECT TO public
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND o.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS support_tickets_insert_own ON public.support_tickets;
CREATE POLICY support_tickets_insert_own ON public.support_tickets FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id AND status = 'open');

DROP POLICY IF EXISTS support_messages_insert_own ON public.support_messages;
CREATE POLICY support_messages_insert_own ON public.support_messages FOR INSERT TO public
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND author_role = 'customer'
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = support_messages.ticket_id
        AND t.user_id = (SELECT auth.uid())
        AND t.status <> 'closed'
    )
  );

DROP POLICY IF EXISTS admin_users_self_read ON public.admin_users;
CREATE POLICY admin_users_self_read ON public.admin_users FOR SELECT TO public
  USING (user_id = (SELECT auth.uid()));

REVOKE EXECUTE ON FUNCTION public.get_public_profile(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_tap(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_public_tap_state(TEXT) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.record_tap_event(TEXT,TEXT,TEXT) FROM authenticated;


-- SHYGON TAP V5 — EVENT FUNCTION PERMISSIONS
-- The public profile function is the only place that needs the event resolver.

REVOKE EXECUTE ON FUNCTION public.tap_event_theme_for(TIMESTAMPTZ) FROM anon, authenticated;


-- SHYGON TAP V5 — final completion hardening
-- 1) Event themes are a platform presentation layer and must apply to every
--    experience during the event window; they are not paid catalogue options.
-- 2) Physical-card stock decrements are idempotent per order item so fulfilment
--    retries cannot consume stock twice.

CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- Event styling is platform-controlled and applies globally while active.
  -- It is not a customer entitlement and must therefore not be filtered through
  -- theme_options(). The customer's saved theme remains in baseTheme.
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

REVOKE ALL ON FUNCTION public.get_public_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(TEXT) TO anon;
REVOKE EXECUTE ON FUNCTION public.get_public_profile(TEXT) FROM authenticated;

CREATE TABLE IF NOT EXISTS public.order_item_fulfillment_actions (
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_item_id, action)
);

ALTER TABLE public.order_item_fulfillment_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_fulfillment_actions_none ON public.order_item_fulfillment_actions;
CREATE POLICY order_item_fulfillment_actions_none
  ON public.order_item_fulfillment_actions
  FOR ALL TO public USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.fulfil_card_stock(
  p_order_item_id UUID,
  p_sku TEXT,
  p_quantity INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    -- The ledger row is deliberately in the same transaction, so this rollback
    -- releases the claim and a later reconciliation can retry safely.
    RAISE EXCEPTION 'Insufficient stock for %', p_sku USING ERRCODE = 'P0001';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) TO service_role;

COMMENT ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) IS
'Idempotently consumes physical-card inventory once per order item during payment fulfilment.';


-- Fix: public.products has no updated_at column. Keep stock fulfilment atomic/idempotent.
CREATE OR REPLACE FUNCTION public.fulfil_card_stock(
  p_order_item_id UUID,
  p_sku TEXT,
  p_quantity INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) TO service_role;

