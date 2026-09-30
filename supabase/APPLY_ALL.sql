-- ============================================================================
-- SHYGON TAP — ALL MIGRATIONS, IN ORDER
-- ============================================================================
-- GENERATED FILE. Do not edit: change the numbered files in
-- supabase/migrations/ and re-run `npm run db:bundle`.
--
-- HOW TO APPLY
--   Supabase Dashboard → SQL Editor → New query → paste this whole file → Run.
--
-- It is one transaction, so either all of it lands or none of it does. Every
-- statement is idempotent, so running it again is safe.
--
-- Source files, in the order they appear below:
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
--   11. 012_products_anon_read_without_admin_check.sql
--   12. 013_admin_platform_live.sql
--   13. 014_realtime_customer_notifications.sql
--   14. 015_card_otp_activation.sql
--   15. 016_card_art_image_urls.sql
--   16. 017_limited_edition_numbers.sql
--   17. 018_design_collection_products.sql
--   18. 019_card_pages_and_card_ids.sql
--   19. 020_promo_codes_delivery_custom_card.sql
--   20. 021_email_outbox.sql
--   21. 022_admin_cards_and_emails.sql
--   22. 023_tax_billing_inventory_funnel.sql
--   23. 024_tier_buttons_and_card_details.sql
--   24. 025_product_reviews.sql
--
-- Generated 2026-09-30
-- ============================================================================


-- ###########################################################################
-- ## 001_production_payments_and_catalog.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 002_shygon_v5_platform.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 003_admin_platform.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 004_experiences_status_and_edit_window.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 005_event_themes_and_rule_hardening.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 006_fulfilment_retry_state.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 007_rls_performance_and_rpc_permissions.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 008_tighten_event_function_permissions.sql
-- ###########################################################################

-- SHYGON TAP V5 — EVENT FUNCTION PERMISSIONS
-- The public profile function is the only place that needs the event resolver.

REVOKE EXECUTE ON FUNCTION public.tap_event_theme_for(TIMESTAMPTZ) FROM anon, authenticated;



-- ###########################################################################
-- ## 009_v5_complete_event_and_stock_safety.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 010_v5_fix_card_stock_timestamp.sql
-- ###########################################################################

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



-- ###########################################################################
-- ## 012_products_anon_read_without_admin_check.sql
-- ###########################################################################

-- 012: anonymous catalogue reads must not call is_admin()
--
-- The live project had one SELECT policy on products, created outside these
-- migrations:
--
--   products_public_or_admin_select  TO public
--     USING ((active IS NOT FALSE) OR (SELECT is_admin()))
--
-- EXECUTE on is_admin() is (rightly) revoked from anon, and Postgres checks
-- that privilege for every function a policy references, even when the other
-- half of the OR already admits the row. So every signed-out catalogue read
-- failed with "permission denied for function is_admin" (HTTP 401): the
-- storefront fell back to its static prices and logged an error on each page.
--
-- Split into two policies that admit exactly the same rows per role:
--   anon, authenticated  -> active products     (no function call)
--   authenticated        -> everything, if is_admin()
-- Nothing is widened: anon still cannot execute is_admin(), and inactive
-- products stay visible to administrators only.
--
-- Rollback (restores the previous single policy):
--   DROP POLICY IF EXISTS "products_select_active"    ON public.products;
--   DROP POLICY IF EXISTS "products_select_admin_all" ON public.products;
--   CREATE POLICY "products_public_or_admin_select" ON public.products
--     FOR SELECT USING ((active IS NOT FALSE) OR (SELECT public.is_admin()));

BEGIN;

DROP POLICY IF EXISTS "products_public_or_admin_select" ON public.products;

DROP POLICY IF EXISTS "products_select_active" ON public.products;
CREATE POLICY "products_select_active" ON public.products
  FOR SELECT TO anon, authenticated
  USING (active IS NOT FALSE);

DROP POLICY IF EXISTS "products_select_admin_all" ON public.products;
CREATE POLICY "products_select_admin_all" ON public.products
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin()));

COMMIT;



-- ###########################################################################
-- ## 013_admin_platform_live.sql
-- ###########################################################################

-- ============================================================================
-- 013 — ADMIN PLATFORM (003) ADAPTED TO THE LIVE DATABASE
-- ============================================================================
-- Generated from 003_admin_platform.sql on 2026-09-27 for project
-- auvgvikdbhbrtsrsaslv, whose schema was built outside these migrations: it
-- already had 003's tables and columns, but none of its functions, admin read
-- policies or alert triggers, so the Admin APK stopped at "not set up".
--
-- Differences from 003, all found by comparing against live:
--   1. Every policy is TO authenticated. 003's had no role, so anon evaluated
--      admin_has()/is_admin() too — the exact failure fixed for products in 012.
--      Tightening only: every one of them is admin-only or admin-own-row.
--   2. get_public_tap(): live's newer body (hides a Tap whose card is inactive)
--      is kept; only 003's suspended_at check is added. 003's copy predates the
--      card gating and would have removed it.
--   3. admin_reply_ticket(uuid, text): live's version returned uuid, 003's
--      returns jsonb. The old one is dropped first, only if it conflicts.
--   4. Live's admin_push_tokens and inventory_movements predate 003's table
--      definitions (CREATE TABLE IF NOT EXISTS skips them), so the three
--      columns 003's functions write are added: last_seen_at, stock_after, note.
-- Everything else is 003 verbatim. Every table, column and index statement uses
-- IF NOT EXISTS. Idempotent; safe to re-run.
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
  FOR SELECT TO authenticated USING (public.admin_has('admins.manage'));


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
  FOR SELECT TO authenticated USING (public.admin_has('audit.read'));
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
  FOR SELECT TO authenticated USING (
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
  FOR SELECT TO authenticated USING (admin_id = auth.uid());

DROP POLICY IF EXISTS "admin_notification_reads_insert_own" ON public.admin_notification_reads;
CREATE POLICY "admin_notification_reads_insert_own" ON public.admin_notification_reads
  FOR INSERT TO authenticated WITH CHECK (admin_id = auth.uid() AND public.is_admin());


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
  FOR SELECT TO authenticated USING (admin_id = auth.uid());
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
  FOR SELECT TO authenticated USING (public.admin_has('inventory.read'));


-- live-adapted: columns 003's functions write that live's older tables lack.
ALTER TABLE public.admin_push_tokens   ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS stock_after  INTEGER;
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS note         TEXT;


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
-- 7. THE PUBLIC TAP MUST RESPECT SUSPENSION  (live-adapted)
-- ---------------------------------------------------------------------------
-- 003 shipped a full copy of get_public_tap(). Live has a newer body that also
-- hides a Tap whose physical card is inactive or expired (expire_tap_cards,
-- cards.status). That body is kept verbatim; the only change is the
-- `suspended_at IS NULL` condition, which is all 003 meant to add.
-- (get_public_profile, which the public page actually uses, already checks
-- suspended_at on live.)
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
AS $function$
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
$function$;

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
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "order_items_select_admin" ON public.order_items;
CREATE POLICY "order_items_select_admin" ON public.order_items
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "payments_select_admin" ON public.payments;
CREATE POLICY "payments_select_admin" ON public.payments
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_admin" ON public.profiles
  FOR SELECT TO authenticated USING (public.admin_has('customers.read'));

DROP POLICY IF EXISTS "tap_profiles_select_admin" ON public.tap_profiles;
CREATE POLICY "tap_profiles_select_admin" ON public.tap_profiles
  FOR SELECT TO authenticated USING (public.admin_has('tap.read'));

DROP POLICY IF EXISTS "entitlements_select_admin" ON public.entitlements;
CREATE POLICY "entitlements_select_admin" ON public.entitlements
  FOR SELECT TO authenticated USING (public.admin_has('entitlements.read'));

DROP POLICY IF EXISTS "cards_select_admin" ON public.cards;
CREATE POLICY "cards_select_admin" ON public.cards
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

DROP POLICY IF EXISTS "support_tickets_select_admin" ON public.support_tickets;
CREATE POLICY "support_tickets_select_admin" ON public.support_tickets
  FOR SELECT TO authenticated USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "support_messages_select_admin" ON public.support_messages;
CREATE POLICY "support_messages_select_admin" ON public.support_messages
  FOR SELECT TO authenticated USING (public.admin_has('support.read'));

DROP POLICY IF EXISTS "tap_events_select_admin" ON public.tap_events;
CREATE POLICY "tap_events_select_admin" ON public.tap_events
  FOR SELECT TO authenticated USING (public.admin_has('analytics.read'));

-- The existing products policy exposes only active rows. Admins must also see
-- disabled ones to re-enable them.
DROP POLICY IF EXISTS "products_select_admin" ON public.products;
CREATE POLICY "products_select_admin" ON public.products
  FOR SELECT TO authenticated USING (public.admin_has('products.read'));

DROP POLICY IF EXISTS "admin_users_select_admin" ON public.admin_users;
CREATE POLICY "admin_users_select_admin" ON public.admin_users
  FOR SELECT TO authenticated USING (public.is_admin());
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
-- live-adapted: live had admin_reply_ticket(uuid, text) RETURNS uuid, unused by
-- any app. The admin app expects this jsonb version; the return type cannot be
-- changed in place, so the old one is dropped first (only if it conflicts).
DO $$
BEGIN
  IF to_regprocedure('public.admin_reply_ticket(uuid,text)') IS NOT NULL
     AND (SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure('public.admin_reply_ticket(uuid,text)')) <> 'jsonb'::regtype THEN
    DROP FUNCTION public.admin_reply_ticket(uuid, text);
  END IF;
END $$;

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



-- ###########################################################################
-- ## 014_realtime_customer_notifications.sql
-- ###########################################################################

-- 014: live customer notifications
--
-- The website now listens for new rows in `notifications` over Supabase
-- Realtime (src/components/app/LiveNotifications.tsx) to show a toast, update
-- the bell and raise a desktop notification. Realtime only streams tables in
-- the `supabase_realtime` publication, which so far held `orders` and
-- `admin_notifications` (013).
--
-- Nothing is widened: Realtime applies each subscriber's RLS policy to every
-- row, so a customer still only ever receives their own notifications — the
-- same rows `notifications_select_owner_or_admin` already lets them read.
--
-- Idempotent; a no-op where the publication does not exist (local Postgres).
--
-- Rollback:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;



-- ###########################################################################
-- ## 015_card_otp_activation.sql
-- ###########################################################################

-- 015: OTP-confirmed card activation and deactivation
--
-- Customers can activate or deactivate their own NFC card from the website.
-- Each request is confirmed with a one-time password sent by SMS to the mobile
-- number on the account (netlify/functions/card-otp.mjs). The admin panel is
-- told about every change.
--
-- Split of responsibilities:
--   * card-otp.mjs (server, service role) creates a challenge, sends the SMS,
--     checks the code, then calls card_apply_verified_action().
--   * card_otp_challenges holds only a keyed HMAC of each code, with expiry and
--     attempt count. RLS is on with no policies: browsers cannot read or write
--     it at all, only the service role can.
--   * card_apply_verified_action() makes the change with exactly the live
--     rules of customer_activate_card / customer_deactivate_card (activation
--     lasts 14 days; only an active card can be deactivated; a replaced card
--     cannot change), then writes the customer notification and the admin
--     alert in the same transaction. Only the service role may execute it.
--
-- Idempotent. Rollback:
--   DROP FUNCTION IF EXISTS public.card_apply_verified_action(uuid, uuid, text);
--   DROP TABLE IF EXISTS public.card_otp_challenges;

BEGIN;

CREATE TABLE IF NOT EXISTS public.card_otp_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('activate', 'deactivate')),
  -- HMAC-SHA256(secret, id || ':' || code). The code itself is never stored.
  code_hash   TEXT NOT NULL,
  -- Last digits only, for support conversations ("sent to …6633").
  phone_last4 TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_otp_challenges_user_created
  ON public.card_otp_challenges (user_id, created_at DESC);

ALTER TABLE public.card_otp_challenges ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: nothing but the service role touches challenges.
REVOKE ALL ON public.card_otp_challenges FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.card_apply_verified_action(
  p_user_id UUID,
  p_card_id UUID,
  p_action  TEXT
)
RETURNS TABLE (
  id                    UUID,
  status                TEXT,
  activated_at          TIMESTAMPTZ,
  activation_expires_at TIMESTAMPTZ,
  deactivated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

  -- The customer: in their feed and, while the site is open, live.
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

  -- The admin panel: a deactivation may mean a lost card, so it is a warning.
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

REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) TO service_role;

COMMIT;



-- ###########################################################################
-- ## 016_card_art_image_urls.sql
-- ###########################################################################

-- 016: point the card products at the new card art.
--
-- The card photographs (/assets/cards/*.png|jpeg, the old blue-logo cards)
-- were replaced by generated SVG art in the new SHYGON design (see
-- scripts/brand/generate.mjs). products.image_url still named the old files.
-- Nothing on screen reads it today, but it is the catalogue's record of the
-- picture, so keep it true.
--
--   card-<product>-<tier>-<material>  ->  /assets/cards/<product>-<material>[-premium].svg
--
-- Only rows whose image_url still points at an old photograph are touched, so
-- a picture an administrator has since set by hand is left alone. Idempotent.

UPDATE public.products
SET image_url = '/assets/cards/'
      || substring(sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$')
      || '-'
      || substring(sku FROM '-(pvc|metal|transparent)$')
      || CASE WHEN sku LIKE '%-premium-%' THEN '-premium' ELSE '' END
      || '.svg'
WHERE sku ~ '^card-.+-(standard|premium)-(pvc|metal|transparent)$'
  AND (image_url IS NULL OR image_url ~ '^/assets/cards/.+\.(png|jpe?g)$');



-- ###########################################################################
-- ## 017_limited_edition_numbers.sql
-- ###########################################################################

-- 017: every SHYGON Tap card is a numbered limited edition, in chapters of 100.
--
-- Each card design is one numbered series (Obsidian Feather, Copper Lotus,
-- Emerald Arch, Ivory Bloom), released in chapters of 100 cards. When a paid
-- order's card is issued it takes the next serial of its design, shown as
-- "Chapter I · Nº 042 of 100"; the 101st card opens Chapter II at Nº 001. The
-- number is printed on the card and shown to the customer (Cards page, e-bill)
-- and to the admin panel.
--
--   card_editions   one row per design: its chapter size and how many cards
--                   have been issued. Public read, so the store can say how
--                   many are left in the current chapter.
--   cards           + edition_design, edition_serial (the design-wide serial,
--                   1-based), edition_count (cards on this order line),
--                   edition_chapter_size. Chapter and number derive from
--                   these: chapter = (serial-1) / size + 1, number =
--                   (serial-1) % size + 1.
--
-- Serials are assigned by a BEFORE INSERT trigger on cards, so every path that
-- issues a card (fulfilment, a replay, the admin) numbers it the same way:
--   * a replayed insert for an (order, sku) that already has its card takes no
--     serial (fulfilment inserts with ON CONFLICT DO NOTHING; without this
--     check the counter would move and leave gaps);
--   * the counter row is locked while it moves, so two cards never share a
--     serial, and a rolled-back issue gives its serial back;
--   * replacement cards take no new serial (they re-make an existing card).
--
-- Idempotent: safe to run again.

CREATE TABLE IF NOT EXISTS public.card_editions (
  design        text PRIMARY KEY,
  name          text NOT NULL,
  chapter_size  integer NOT NULL DEFAULT 100 CHECK (chapter_size > 0),
  issued        integer NOT NULL DEFAULT 0 CHECK (issued >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('business',      'Obsidian Feather', 100),
  ('restaurant',    'Copper Lotus',     100),
  ('event',         'Emerald Arch',     100),
  ('google-review', 'Ivory Bloom',      100)
ON CONFLICT (design) DO NOTHING;

ALTER TABLE public.card_editions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS card_editions_public_read ON public.card_editions;
CREATE POLICY card_editions_public_read ON public.card_editions FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.card_editions FROM anon, authenticated;
GRANT SELECT ON public.card_editions TO anon, authenticated;

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_design text;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_serial integer;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_count integer;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS edition_chapter_size integer;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_edition_serial
  ON public.cards (edition_design, edition_serial) WHERE edition_serial IS NOT NULL;

-- The design a card SKU belongs to: card-<design>-<finish>-<material>.
CREATE OR REPLACE FUNCTION public.card_design_of(p_sku text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT substring(p_sku FROM '^card-(.+)-(?:standard|premium)-(?:pvc|metal|transparent)$');
$$;

CREATE OR REPLACE FUNCTION public.cards_assign_edition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
    -- Fulfilment and a webhook replay can arrive together: take them one at a
    -- time per order line, then skip if the card already exists.
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
  -- A design with no edition row is simply not numbered.
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

REVOKE ALL ON FUNCTION public.cards_assign_edition() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cards_assign_edition ON public.cards;
CREATE TRIGGER trg_cards_assign_edition
  BEFORE INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_assign_edition();

-- Number any card issued before this migration, oldest first.
DO $$
DECLARE
  r record;
  v_qty integer;
  v_first integer;
  v_size integer;
BEGIN
  FOR r IN
    SELECT c.id, c.order_id, c.sku, public.card_design_of(c.sku) AS design
    FROM public.cards c
    WHERE c.edition_serial IS NULL
      AND NOT COALESCE(c.is_replacement, false)
      AND public.card_design_of(c.sku) IS NOT NULL
    ORDER BY c.created_at, c.id
  LOOP
    SELECT GREATEST(1, COALESCE(SUM(oi.quantity), 1))::integer INTO v_qty
    FROM public.order_items oi
    WHERE oi.order_id = r.order_id AND oi.sku = r.sku;

    UPDATE public.card_editions
    SET issued = issued + v_qty, updated_at = now()
    WHERE design = r.design
    RETURNING issued - v_qty + 1, chapter_size INTO v_first, v_size;

    IF v_first IS NOT NULL THEN
      UPDATE public.cards
      SET edition_design = r.design,
          edition_serial = v_first,
          edition_count = v_qty,
          edition_chapter_size = v_size
      WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;



-- ###########################################################################
-- ## 018_design_collection_products.sql
-- ###########################################################################

-- 018: the Design Collection — six more cards in the store.
--
-- Obsidian Smoke, Rose Marble, Carbon Aurum, Sandstone Jaali, Sapphire Night
-- and Aurora Glass (art: scripts/brand/concepts.mjs). Each is sold like the
-- four use-case cards: product x finish x material, priced here (checkout
-- reads the price from this table), 100 in stock per variant, and a numbered
-- limited edition in chapters of 100 (card_editions, migration 017).
--
-- Prices follow the Business card: 399 / 599 / 499 standard and
-- 699 / 899 / 799 premium (PVC / metal / transparent). ON CONFLICT DO NOTHING,
-- so a price or stock level an administrator has since changed is kept.
-- Requires 017. Idempotent.

INSERT INTO public.products
  (sku, name, category, material, tier, price_in_paise, product_type, image_url, short_description, stock, active, sort_order)
VALUES
  ('card-obsidian-smoke-standard-pvc', 'Shygon Tap Obsidian Smoke — PVC', 'obsidian-smoke', 'pvc', 'standard', 39900, 'card', '/assets/cards/obsidian-smoke-pvc.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 100),
  ('card-obsidian-smoke-standard-metal', 'Shygon Tap Obsidian Smoke — Metal', 'obsidian-smoke', 'metal', 'standard', 59900, 'card', '/assets/cards/obsidian-smoke-metal.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 101),
  ('card-obsidian-smoke-standard-transparent', 'Shygon Tap Obsidian Smoke — Transparent', 'obsidian-smoke', 'transparent', 'standard', 49900, 'card', '/assets/cards/obsidian-smoke-transparent.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 102),
  ('card-obsidian-smoke-premium-pvc', 'Shygon Tap Obsidian Smoke Premium — PVC', 'obsidian-smoke', 'pvc', 'premium', 69900, 'card', '/assets/cards/obsidian-smoke-pvc-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 103),
  ('card-obsidian-smoke-premium-metal', 'Shygon Tap Obsidian Smoke Premium — Metal', 'obsidian-smoke', 'metal', 'premium', 89900, 'card', '/assets/cards/obsidian-smoke-metal-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 104),
  ('card-obsidian-smoke-premium-transparent', 'Shygon Tap Obsidian Smoke Premium — Transparent', 'obsidian-smoke', 'transparent', 'premium', 79900, 'card', '/assets/cards/obsidian-smoke-transparent-premium.svg', 'Black smoke and a pressed ribbon S. Quiet and unmistakable.', 100, true, 105),
  ('card-rose-marble-standard-pvc', 'Shygon Tap Rose Marble — PVC', 'rose-marble', 'pvc', 'standard', 39900, 'card', '/assets/cards/rose-marble-pvc.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 110),
  ('card-rose-marble-standard-metal', 'Shygon Tap Rose Marble — Metal', 'rose-marble', 'metal', 'standard', 59900, 'card', '/assets/cards/rose-marble-metal.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 111),
  ('card-rose-marble-standard-transparent', 'Shygon Tap Rose Marble — Transparent', 'rose-marble', 'transparent', 'standard', 49900, 'card', '/assets/cards/rose-marble-transparent.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 112),
  ('card-rose-marble-premium-pvc', 'Shygon Tap Rose Marble Premium — PVC', 'rose-marble', 'pvc', 'premium', 69900, 'card', '/assets/cards/rose-marble-pvc-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 113),
  ('card-rose-marble-premium-metal', 'Shygon Tap Rose Marble Premium — Metal', 'rose-marble', 'metal', 'premium', 89900, 'card', '/assets/cards/rose-marble-metal-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 114),
  ('card-rose-marble-premium-transparent', 'Shygon Tap Rose Marble Premium — Transparent', 'rose-marble', 'transparent', 'premium', 79900, 'card', '/assets/cards/rose-marble-transparent-premium.svg', 'White marble, grey veining and rose-gold foil.', 100, true, 115),
  ('card-carbon-aurum-standard-pvc', 'Shygon Tap Carbon Aurum — PVC', 'carbon-aurum', 'pvc', 'standard', 39900, 'card', '/assets/cards/carbon-aurum-pvc.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 120),
  ('card-carbon-aurum-standard-metal', 'Shygon Tap Carbon Aurum — Metal', 'carbon-aurum', 'metal', 'standard', 59900, 'card', '/assets/cards/carbon-aurum-metal.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 121),
  ('card-carbon-aurum-standard-transparent', 'Shygon Tap Carbon Aurum — Transparent', 'carbon-aurum', 'transparent', 'standard', 49900, 'card', '/assets/cards/carbon-aurum-transparent.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 122),
  ('card-carbon-aurum-premium-pvc', 'Shygon Tap Carbon Aurum Premium — PVC', 'carbon-aurum', 'pvc', 'premium', 69900, 'card', '/assets/cards/carbon-aurum-pvc-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 123),
  ('card-carbon-aurum-premium-metal', 'Shygon Tap Carbon Aurum Premium — Metal', 'carbon-aurum', 'metal', 'premium', 89900, 'card', '/assets/cards/carbon-aurum-metal-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 124),
  ('card-carbon-aurum-premium-transparent', 'Shygon Tap Carbon Aurum Premium — Transparent', 'carbon-aurum', 'transparent', 'premium', 79900, 'card', '/assets/cards/carbon-aurum-transparent-premium.svg', 'Carbon-fibre weave with a gold pinstripe.', 100, true, 125),
  ('card-sandstone-jaali-standard-pvc', 'Shygon Tap Sandstone Jaali — PVC', 'sandstone-jaali', 'pvc', 'standard', 39900, 'card', '/assets/cards/sandstone-jaali-pvc.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 130),
  ('card-sandstone-jaali-standard-metal', 'Shygon Tap Sandstone Jaali — Metal', 'sandstone-jaali', 'metal', 'standard', 59900, 'card', '/assets/cards/sandstone-jaali-metal.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 131),
  ('card-sandstone-jaali-standard-transparent', 'Shygon Tap Sandstone Jaali — Transparent', 'sandstone-jaali', 'transparent', 'standard', 49900, 'card', '/assets/cards/sandstone-jaali-transparent.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 132),
  ('card-sandstone-jaali-premium-pvc', 'Shygon Tap Sandstone Jaali Premium — PVC', 'sandstone-jaali', 'pvc', 'premium', 69900, 'card', '/assets/cards/sandstone-jaali-pvc-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 133),
  ('card-sandstone-jaali-premium-metal', 'Shygon Tap Sandstone Jaali Premium — Metal', 'sandstone-jaali', 'metal', 'premium', 89900, 'card', '/assets/cards/sandstone-jaali-metal-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 134),
  ('card-sandstone-jaali-premium-transparent', 'Shygon Tap Sandstone Jaali Premium — Transparent', 'sandstone-jaali', 'transparent', 'premium', 79900, 'card', '/assets/cards/sandstone-jaali-transparent-premium.svg', 'Warm sandstone with a carved jaali lattice.', 100, true, 135),
  ('card-sapphire-night-standard-pvc', 'Shygon Tap Sapphire Night — PVC', 'sapphire-night', 'pvc', 'standard', 39900, 'card', '/assets/cards/sapphire-night-pvc.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 140),
  ('card-sapphire-night-standard-metal', 'Shygon Tap Sapphire Night — Metal', 'sapphire-night', 'metal', 'standard', 59900, 'card', '/assets/cards/sapphire-night-metal.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 141),
  ('card-sapphire-night-standard-transparent', 'Shygon Tap Sapphire Night — Transparent', 'sapphire-night', 'transparent', 'standard', 49900, 'card', '/assets/cards/sapphire-night-transparent.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 142),
  ('card-sapphire-night-premium-pvc', 'Shygon Tap Sapphire Night Premium — PVC', 'sapphire-night', 'pvc', 'premium', 69900, 'card', '/assets/cards/sapphire-night-pvc-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 143),
  ('card-sapphire-night-premium-metal', 'Shygon Tap Sapphire Night Premium — Metal', 'sapphire-night', 'metal', 'premium', 89900, 'card', '/assets/cards/sapphire-night-metal-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 144),
  ('card-sapphire-night-premium-transparent', 'Shygon Tap Sapphire Night Premium — Transparent', 'sapphire-night', 'transparent', 'premium', 79900, 'card', '/assets/cards/sapphire-night-transparent-premium.svg', 'Brushed midnight blue and a gold constellation.', 100, true, 145),
  ('card-aurora-glass-standard-pvc', 'Shygon Tap Aurora Glass — PVC', 'aurora-glass', 'pvc', 'standard', 39900, 'card', '/assets/cards/aurora-glass-pvc.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 150),
  ('card-aurora-glass-standard-metal', 'Shygon Tap Aurora Glass — Metal', 'aurora-glass', 'metal', 'standard', 59900, 'card', '/assets/cards/aurora-glass-metal.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 151),
  ('card-aurora-glass-standard-transparent', 'Shygon Tap Aurora Glass — Transparent', 'aurora-glass', 'transparent', 'standard', 49900, 'card', '/assets/cards/aurora-glass-transparent.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 152),
  ('card-aurora-glass-premium-pvc', 'Shygon Tap Aurora Glass Premium — PVC', 'aurora-glass', 'pvc', 'premium', 69900, 'card', '/assets/cards/aurora-glass-pvc-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 153),
  ('card-aurora-glass-premium-metal', 'Shygon Tap Aurora Glass Premium — Metal', 'aurora-glass', 'metal', 'premium', 89900, 'card', '/assets/cards/aurora-glass-metal-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 154),
  ('card-aurora-glass-premium-transparent', 'Shygon Tap Aurora Glass Premium — Transparent', 'aurora-glass', 'transparent', 'premium', 79900, 'card', '/assets/cards/aurora-glass-transparent-premium.svg', 'Teal and violet aurora with an iridescent edge.', 100, true, 155)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.card_editions (design, name, chapter_size) VALUES
  ('obsidian-smoke', 'Obsidian Smoke', 100),
  ('rose-marble', 'Rose Marble', 100),
  ('carbon-aurum', 'Carbon Aurum', 100),
  ('sandstone-jaali', 'Sandstone Jaali', 100),
  ('sapphire-night', 'Sapphire Night', 100),
  ('aurora-glass', 'Aurora Glass', 100)
ON CONFLICT (design) DO NOTHING;



-- ###########################################################################
-- ## 019_card_pages_and_card_ids.sql
-- ###########################################################################

-- ============================================================================
-- 019 — ONE PAGE PER CARD, PERMANENT CARD IDS, CARD MANAGEMENT, TAP ANALYTICS
-- ============================================================================
-- Run AFTER 001–018. Idempotent: safe to run twice.
--
-- WHAT CHANGES
--   1. Every card gets a permanent Card ID (cards.card_code, 8 characters, e.g.
--      K7M4Q9XD). It is what the NFC chip of a new card encodes:
--          https://shygontech.com/c/<CARD ID>
--      and it ties together the physical card, the customer, the card's page,
--      the order that bought it and its tap analytics.
--   2. One page per card. The one-Tap-per-customer unique index is lifted; each
--      newly issued card gets its own page (created and published automatically),
--      linked through cards.tap_profile_id. Cards issued before this migration
--      keep opening the page they always opened, so no printed card changes.
--   3. Card management for the customer: nickname, report lost (a lost card is
--      `suspended` with lost_at set — no new status value, so every existing
--      reader and constraint keeps working), replacement (a replacement card
--      inherits the old card's page, and the old card becomes `replaced`).
--   4. Custom page addresses: changing a slug keeps the old one as an alias, so
--      a QR or card printed with the old address still opens the page.
--   5. Tap analytics: per-card events, device type, weekly/monthly series, tap
--      history and last-tapped information.
--   6. Admin RPCs that assumed one page per customer are made multi-page safe.
--
-- WHAT DOES NOT CHANGE
--   get_public_profile(), get_public_tap(), record_tap_event() and the live-only
--   card gating are not redefined. Entitlements stay per customer: an
--   experience, the Customization Pass or an add-on bought once applies to
--   every page the customer owns.
--
-- ORDERING: re-run this file after any re-run of 002, 004, 005 or 013 — each of
-- those redefines a function this file replaces.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. COLUMNS
-- ---------------------------------------------------------------------------
-- Live already has the activation columns (created outside the migrations);
-- they are declared here so a fresh database matches it. IF NOT EXISTS leaves
-- the live definitions untouched.
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS card_type             TEXT;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activated_at          TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last_activation_at    TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activation_expires_at TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS activation_count      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS deactivated_at        TIMESTAMPTZ;

ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS card_code        TEXT;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS nickname         TEXT;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS lost_at          TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS replaces_card_id UUID;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS replaced_at      TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS last_tapped_at   TIMESTAMPTZ;
ALTER TABLE public.cards ADD COLUMN IF NOT EXISTS tap_count        BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_replaces_card_fk') THEN
    ALTER TABLE public.cards ADD CONSTRAINT cards_replaces_card_fk
      FOREIGN KEY (replaces_card_id) REFERENCES public.cards(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_nickname_length') THEN
    ALTER TABLE public.cards ADD CONSTRAINT cards_nickname_length
      CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 40) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cards_code_format') THEN
    ALTER TABLE public.cards ADD CONSTRAINT cards_code_format
      CHECK (card_code IS NULL OR card_code ~ '^[0-9A-Z]{8}$') NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_card_code
  ON public.cards (card_code) WHERE card_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cards_tap_profile ON public.cards (tap_profile_id);

ALTER TABLE public.tap_events ADD COLUMN IF NOT EXISTS card_id     UUID;
ALTER TABLE public.tap_events ADD COLUMN IF NOT EXISTS device_type VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tap_events_card_fk') THEN
    ALTER TABLE public.tap_events ADD CONSTRAINT tap_events_card_fk
      FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tap_events_card_time
  ON public.tap_events (card_id, occurred_at DESC) WHERE card_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- 1. PERMANENT CARD IDS
-- ---------------------------------------------------------------------------
-- 8 characters from a 32-letter alphabet without 0/1/I/O (nothing to misread
-- when a customer types it): 32^8 ≈ 1.1 trillion codes. Drawn from
-- gen_random_uuid()'s random bytes — the version/variant bytes are skipped.
CREATE OR REPLACE FUNCTION public.new_card_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_alpha CONSTANT TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_raw   BYTEA;
  v_code  TEXT;
  v_i     INT;
BEGIN
  LOOP
    v_raw := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    FOREACH v_i IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 7, 9] LOOP
      v_code := v_code || substr(v_alpha, (get_byte(v_raw, v_i) & 31) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.cards WHERE card_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.new_card_code() FROM PUBLIC, anon, authenticated;

-- Normalises whatever a visitor typed or a chip carries: "k7m4-q9xd" -> K7M4Q9XD.
CREATE OR REPLACE FUNCTION public.normalise_card_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_code, ''), '[^0-9A-Za-z]', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.cards_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.card_code IS NULL THEN
    NEW.card_code := public.new_card_code();
  ELSE
    NEW.card_code := public.normalise_card_code(NEW.card_code);
  END IF;

  -- A replacement re-makes an existing card: it opens the same page, so its
  -- analytics and address carry on where the old card's stopped.
  IF NEW.replaces_card_id IS NOT NULL THEN
    NEW.is_replacement := true;
    IF NEW.tap_profile_id IS NULL THEN
      SELECT c.tap_profile_id INTO NEW.tap_profile_id
      FROM public.cards c
      WHERE c.id = NEW.replaces_card_id AND c.user_id = NEW.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cards_before_insert() FROM PUBLIC, anon, authenticated;

-- Named to fire after trg_cards_assign_edition (017): BEFORE triggers run in
-- name order, and the edition trigger takes the per-line lock first.
DROP TRIGGER IF EXISTS trg_cards_code ON public.cards;
CREATE TRIGGER trg_cards_code
  BEFORE INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_before_insert();

-- Every card issued before this migration gets its ID now, one at a time so
-- the uniqueness check in new_card_code() sees the codes already handed out.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.cards WHERE card_code IS NULL ORDER BY created_at, id LOOP
    UPDATE public.cards SET card_code = public.new_card_code() WHERE id = r.id;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------------
-- 2. PAGE ADDRESSES: RESERVED WORDS, ALIASES, GENERATION
-- ---------------------------------------------------------------------------
-- When a page changes its address the old one is kept here, so anything
-- already printed with it (a QR, a card written before Card IDs) still opens
-- the page. Never readable by clients; resolved through resolve_tap_alias().
CREATE TABLE IF NOT EXISTS public.tap_slug_aliases (
  slug           TEXT PRIMARY KEY CHECK (slug = lower(slug)),
  tap_profile_id UUID NOT NULL REFERENCES public.tap_profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tap_slug_aliases_tap ON public.tap_slug_aliases (tap_profile_id);
ALTER TABLE public.tap_slug_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tap_slug_aliases FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.tap_slug_reserved(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  -- Pages live at /shygontap/<slug>, next to the app's own screens, so every
  -- screen name under /shygontap/ is reserved too.
  SELECT lower(btrim(COALESCE(p_slug, ''))) IN (
    'admin', 'api', 'auth', 'account', 'shygontap', 'store', 'checkout', 'orders',
    'settings', 'support', 'tap', 'www', 'billing', 'cards', 'card', 'c', 't',
    'shygon', 'shygontech', 'login', 'signup', 'help', 'tiers', 'customize', 'qr',
    'customizations', 'notifications', 'analytics', 'privacy-policy', 'terms',
    'cookie-policy', 'refund-policy', 'shipping-policy');
$$;

CREATE OR REPLACE FUNCTION public.tap_slug_taken(p_slug TEXT, p_except UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.tap_profiles t
                 WHERE lower(t.slug) = lower(btrim(p_slug))
                   AND t.id IS DISTINCT FROM p_except)
      OR EXISTS (SELECT 1 FROM public.tap_slug_aliases a
                 WHERE a.slug = lower(btrim(p_slug))
                   AND a.tap_profile_id IS DISTINCT FROM p_except);
$$;

REVOKE ALL ON FUNCTION public.tap_slug_taken(TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- Replaces 002's version: also avoids aliases and reserved words, because a
-- second page for the same customer is now normal (name, name-1, name-2 …).
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
  v_base := btrim(left(v_base, 32), '-');
  IF length(v_base) < 3 THEN v_base := 'tap-page'; END IF;

  LOOP
    v_try := CASE WHEN v_suffix = 0 THEN v_base ELSE v_base || '-' || v_suffix::text END;
    EXIT WHEN NOT public.tap_slug_reserved(v_try) AND NOT public.tap_slug_taken(v_try);
    v_suffix := v_suffix + 1;
    IF v_suffix > 500 THEN
      v_try := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  RETURN v_try;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_tap_slug(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_tap_slug(UUID) FROM anon, authenticated;

-- Keeps the old address when a page changes it, and hands back an alias the
-- page reclaims.
CREATE OR REPLACE FUNCTION public.tap_profiles_track_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.slug IS NOT NULL AND lower(NEW.slug) IS DISTINCT FROM lower(OLD.slug) THEN
    INSERT INTO public.tap_slug_aliases (slug, tap_profile_id)
    VALUES (lower(OLD.slug), NEW.id)
    ON CONFLICT (slug) DO UPDATE SET tap_profile_id = EXCLUDED.tap_profile_id, created_at = NOW();
  END IF;
  IF NEW.slug IS NOT NULL THEN
    DELETE FROM public.tap_slug_aliases WHERE slug = lower(NEW.slug);
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tap_profiles_track_slug() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tap_profiles_slug_alias ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_slug_alias
  AFTER UPDATE OF slug ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tap_profiles_track_slug();

-- An old address, resolved to the page's current one — only for a live page.
CREATE OR REPLACE FUNCTION public.resolve_tap_alias(p_slug TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.slug
  FROM public.tap_slug_aliases a
  JOIN public.tap_profiles t ON t.id = a.tap_profile_id
  WHERE a.slug = lower(btrim(COALESCE(p_slug, '')))
    AND t.status = 'active'
    AND t.suspended_at IS NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_tap_alias(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tap_alias(TEXT) TO anon, authenticated;

-- Claims or changes the address of ONE of the caller's pages.
CREATE OR REPLACE FUNCTION public.claim_tap_slug(p_slug TEXT, p_tap_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_slug TEXT := lower(btrim(COALESCE(p_slug, '')));
  v_cur  TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_slug !~ '^[a-z0-9][a-z0-9-]{2,39}$' THEN
    RAISE EXCEPTION 'A Tap address must be 3-40 characters: lowercase letters, numbers and hyphens.'
      USING ERRCODE = '22023';
  END IF;
  IF public.tap_slug_reserved(v_slug) THEN
    RAISE EXCEPTION 'That Tap address is reserved.' USING ERRCODE = '22023';
  END IF;

  SELECT t.slug INTO v_cur FROM public.tap_profiles t
  WHERE t.id = p_tap_id AND t.user_id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That Tap page was not found on your account.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(v_cur) = v_slug THEN
    RETURN v_slug;
  END IF;

  -- Includes old addresses of other pages, so nobody can take over a QR that
  -- is already printed.
  IF public.tap_slug_taken(v_slug, p_tap_id) THEN
    RAISE EXCEPTION 'That Tap address is already taken.' USING ERRCODE = '23505';
  END IF;

  -- Runs the 14-day rule: changing an existing address is a content edit.
  UPDATE public.tap_profiles SET slug = v_slug, username = v_slug WHERE id = p_tap_id;
  RETURN v_slug;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tap_slug(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_tap_slug(TEXT, UUID) TO authenticated;

-- The one-argument form is kept for older clients: it now names the customer's
-- first page instead of every page at once (which would collide on the second).
CREATE OR REPLACE FUNCTION public.claim_tap_slug(p_slug TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT t.id INTO v_tap FROM public.tap_profiles t
  WHERE t.user_id = auth.uid() ORDER BY t.created_at, t.id LIMIT 1;
  IF v_tap IS NULL THEN
    RAISE EXCEPTION 'You do not have a Tap profile yet.' USING ERRCODE = 'P0002';
  END IF;
  RETURN public.claim_tap_slug(p_slug, v_tap);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_tap_slug(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_tap_slug(TEXT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 3. PROVISIONING: A PAGE PER CARD, PUBLISHED AUTOMATICALLY
-- ---------------------------------------------------------------------------
-- Creates a live page for a customer. The advisory lock serialises every
-- provisioning path for one customer (payment trigger, card issue, fulfilment
-- safety net) now that no unique index does it.
DROP FUNCTION IF EXISTS public.provision_tap_page(UUID, TIMESTAMPTZ);

-- p_experience: the digital experience bought with the card (the order's
-- plan). A card bought with Essential gets an Essential page; without one, the
-- best experience the customer already owns.
CREATE OR REPLACE FUNCTION public.provision_tap_page(
  p_user       UUID,
  p_started    TIMESTAMPTZ DEFAULT NOW(),
  p_experience TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_slug  TEXT;
  v_name  TEXT;
  v_email TEXT;
  v_tier  TEXT;
  v_id    UUID;
BEGIN
  v_slug := public.generate_tap_slug(p_user);
  SELECT p.full_name, p.email INTO v_name, v_email FROM public.profiles p WHERE p.id = p_user;
  v_tier := public.canonical_experience(
    COALESCE(NULLIF(btrim(COALESCE(p_experience, '')), ''), public.user_max_ui_tier(p_user)));

  INSERT INTO public.tap_profiles
    (user_id, customer_id, status, published, published_at, slug, username, display_name,
     email, selected_ui_tier, enabled_customizations, edit_window_started_at)
  VALUES (p_user, p_user, 'active', true, NOW(), v_slug, v_slug, v_name,
          v_email, COALESCE(v_tier, 'essential'), ARRAY['phone', 'email'], p_started)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (p_user, 'tap', 'Your Tap page is live',
          'shygontech.com/shygontap/' || v_slug || ' is published. Add your details and it updates instantly.',
          '/shygontap/tap', jsonb_build_object('tap_profile_id', v_id, 'slug', v_slug));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_tap_page(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
-- Fulfilment's safety net calls it (netlify/lib/fulfilment.mjs).
GRANT EXECUTE ON FUNCTION public.provision_tap_page(UUID, TIMESTAMPTZ, TEXT) TO service_role;

-- Links a newly issued card to a page: the replaced card's page for a
-- replacement (set in cards_before_insert), otherwise a page of this customer
-- that no card uses yet, otherwise a brand-new page.
CREATE OR REPLACE FUNCTION public.cards_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap UUID := NEW.tap_profile_id;
BEGIN
  IF NEW.replaces_card_id IS NOT NULL THEN
    UPDATE public.cards
    SET status = 'replaced', replaced_at = NOW()
    WHERE id = NEW.replaces_card_id AND user_id = NEW.user_id AND status <> 'replaced';
  END IF;

  IF v_tap IS NOT NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tap-provision:' || NEW.user_id::text));

  SELECT t.id INTO v_tap
  FROM public.tap_profiles t
  WHERE t.user_id = NEW.user_id
    AND NOT EXISTS (SELECT 1 FROM public.cards c
                    WHERE c.tap_profile_id = t.id AND c.id <> NEW.id)
  ORDER BY t.created_at, t.id
  LIMIT 1;

  IF v_tap IS NULL THEN
    v_tap := public.provision_tap_page(
      NEW.user_id, NEW.created_at,
      (SELECT COALESCE(o.plan_id, o.plan, 'essential') FROM public.orders o WHERE o.id = NEW.order_id));
  END IF;

  UPDATE public.cards SET tap_profile_id = v_tap WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cards_after_insert() FROM PUBLIC, anon, authenticated;

-- AFTER INSERT, so a replayed insert that loses a unique-index race never
-- creates a page for a card that was not written.
DROP TRIGGER IF EXISTS trg_cards_link_page ON public.cards;
CREATE TRIGGER trg_cards_link_page
  AFTER INSERT ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_after_insert();

-- Replaces 004's version. The only differences: the page is created live, and
-- there is no `ON CONFLICT (user_id)` — that needed the unique index this file
-- drops. A customer who already has a page gets nothing here; a card they buy
-- gets its own page from cards_after_insert().
CREATE OR REPLACE FUNCTION public.provision_tap_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.payment_status <> 'paid'
     OR OLD.payment_status IS NOT DISTINCT FROM NEW.payment_status
     OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tap-provision:' || NEW.user_id::text));

  IF NOT EXISTS (SELECT 1 FROM public.tap_profiles WHERE user_id = NEW.user_id) THEN
    PERFORM public.provision_tap_page(
      NEW.user_id, NEW.created_at,
      CASE WHEN COALESCE(NEW.order_type, 'physical') = 'physical'
           THEN COALESCE(NEW.plan_id, NEW.plan, 'essential') END);
  END IF;

  -- A page that predates addresses may still lack one.
  UPDATE public.tap_profiles t
  SET slug = public.generate_tap_slug(NEW.user_id)
  WHERE t.user_id = NEW.user_id AND t.slug IS NULL;
  UPDATE public.tap_profiles SET username = slug
  WHERE user_id = NEW.user_id AND username IS NULL AND slug IS NOT NULL;

  UPDATE public.tap_profiles
  SET edit_window_started_at = LEAST(COALESCE(edit_window_started_at, NEW.created_at), NEW.created_at)
  WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_provision_tap ON public.orders;
CREATE TRIGGER trg_orders_provision_tap
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.provision_tap_on_payment();

-- Lift one-page-per-customer: drop whatever unique index or constraint covers
-- exactly (user_id), whatever it is called on this database.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.tap_profiles'::regclass
      AND con.contype = 'u'
      AND array_length(con.conkey, 1) = 1
      AND (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = con.conrelid AND a.attnum = con.conkey[1]) = 'user_id'
  LOOP
    EXECUTE format('ALTER TABLE public.tap_profiles DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT i.relname
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    WHERE x.indrelid = 'public.tap_profiles'::regclass
      AND x.indisunique AND NOT x.indisprimary
      AND x.indnkeyatts = 1 AND x.indexprs IS NULL AND x.indpred IS NULL
      AND (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = x.indrelid AND a.attnum = x.indkey[0]) = 'user_id'
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.relname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_tap_profiles_user_created
  ON public.tap_profiles (user_id, created_at);

-- Anything else on this database that still relies on one page per customer
-- would start failing once the index is gone. Refuse to finish rather than
-- break payments; the message names the function to review.
DO $$
DECLARE v_names TEXT;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_names
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ILIKE '%tap_profiles%'
    AND p.prosrc ~* 'on\s+conflict\s*\(\s*user_id\s*\)';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'These functions insert into tap_profiles with ON CONFLICT (user_id), which needs one page per customer: %. Update them before applying 019.', v_names;
  END IF;
END $$;

-- Pages come with cards now. A customer may still create their very first one
-- themselves (nothing in the app does, but the old policy allowed it), never
-- more — otherwise pages would be free.
CREATE OR REPLACE FUNCTION public.my_tap_count()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::int FROM public.tap_profiles WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_tap_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_tap_count() TO authenticated;

DROP POLICY IF EXISTS tap_profiles_insert_own ON public.tap_profiles;
DROP POLICY IF EXISTS "tap_profiles_insert_own" ON public.tap_profiles;
CREATE POLICY tap_profiles_insert_own ON public.tap_profiles FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id AND (SELECT public.my_tap_count()) = 0);

-- Cards issued before this migration all opened the customer's one page; they
-- still do.
UPDATE public.cards c
SET tap_profile_id = (SELECT t.id FROM public.tap_profiles t
                      WHERE t.user_id = c.user_id ORDER BY t.created_at, t.id LIMIT 1)
WHERE c.tap_profile_id IS NULL
  AND EXISTS (SELECT 1 FROM public.tap_profiles t WHERE t.user_id = c.user_id);


-- ---------------------------------------------------------------------------
-- 4. THE 14-DAY RULE, PER PAGE
-- ---------------------------------------------------------------------------
-- Each page has its own last_content_edit_at, so the rule is per page. The
-- Customization Pass still lifts it for every page.
CREATE OR REPLACE FUNCTION public.tap_page_can_edit(p_tap_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_has_pass(t.user_id)
      OR t.last_content_edit_at IS NULL
      OR t.last_content_edit_at + make_interval(days => public.tap_edit_interval_days()) <= NOW()
  FROM public.tap_profiles t WHERE t.id = p_tap_id;
$$;

REVOKE ALL ON FUNCTION public.tap_page_can_edit(UUID) FROM PUBLIC, anon, authenticated;

-- Kept for anything that still asks per customer; with several pages it is
-- true when at least one of them can be edited (it used to error instead).
CREATE OR REPLACE FUNCTION public.tap_can_edit(p_user UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_has_pass(p_user)
      OR COALESCE(
           (SELECT bool_or(t.last_content_edit_at IS NULL
                           OR t.last_content_edit_at
                              + make_interval(days => public.tap_edit_interval_days()) <= NOW())
            FROM public.tap_profiles t WHERE t.user_id = p_user),
           true);
$$;

REVOKE ALL ON FUNCTION public.tap_can_edit(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tap_can_edit(UUID) FROM anon, authenticated;

-- 005's body, with the edit window read from the row being edited.
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

  IF NOT (v_pass
          OR OLD.last_content_edit_at IS NULL
          OR OLD.last_content_edit_at + make_interval(days => public.tap_edit_interval_days()) <= NOW()) THEN
    RAISE EXCEPTION
      'You can change your Tap once every % days. The Customization Pass removes the limit.',
      public.tap_edit_interval_days()
      USING ERRCODE = '42501';
  END IF;

  NEW.last_content_edit_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_profiles_edit_rules ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_edit_rules
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tap_edit_rules();

-- tap_edit_state(), for one page.
CREATE OR REPLACE FUNCTION public.tap_page_edit_state(p_tap_id UUID)
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
  v_found BOOLEAN := false;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT t.last_content_edit_at, true INTO v_last, v_found
  FROM public.tap_profiles t WHERE t.id = p_tap_id AND t.user_id = v_user;

  v_pass := public.user_has_pass(v_user);
  v_next := v_last + make_interval(days => public.tap_edit_interval_days());

  RETURN QUERY SELECT
    v_last,
    CASE WHEN v_pass THEN NULL ELSE v_next END,
    CASE WHEN v_pass OR v_next IS NULL THEN 0
         ELSE GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_next - NOW())) / 86400.0))::INT END,
    public.tap_edit_interval_days(),
    v_pass,
    CASE WHEN COALESCE(v_found, false) IS NOT TRUE THEN false
         WHEN v_pass THEN true
         WHEN v_next IS NULL THEN true
         ELSE v_next <= NOW() END,
    CASE WHEN COALESCE(v_found, false) IS NOT TRUE THEN 'no_tap'
         WHEN v_pass THEN 'pass'
         WHEN v_next IS NULL THEN 'never_edited'
         WHEN v_next <= NOW() THEN 'edit_available'
         ELSE 'cooling_down' END;
END;
$$;

REVOKE ALL ON FUNCTION public.tap_page_edit_state(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tap_page_edit_state(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- 5. DEVICE TYPE ON EVERY TAP EVENT
-- ---------------------------------------------------------------------------
-- A coarse class from the request's user agent — mobile, tablet, desktop, bot
-- — and nothing finer. Applies to events from record_tap_event() and
-- record_card_tap() alike, without redefining either reader.
CREATE OR REPLACE FUNCTION public.device_class(p_ua TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_ua IS NULL OR btrim(p_ua) = '' THEN 'unknown'
    WHEN p_ua ~* '(bot|crawler|spider|slurp|preview|facebookexternalhit|headless)' THEN 'bot'
    WHEN p_ua ~* '(ipad|tablet|kindle|silk|playbook)' OR (p_ua ~* 'android' AND p_ua !~* 'mobile') THEN 'tablet'
    WHEN p_ua ~* '(mobi|iphone|ipod|android|blackberry|opera mini|iemobile)' THEN 'mobile'
    ELSE 'desktop'
  END;
$$;

CREATE OR REPLACE FUNCTION public.tap_events_enrich()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_ua TEXT;
BEGIN
  IF NEW.device_type IS NULL THEN
    BEGIN
      v_ua := current_setting('request.headers', true)::json ->> 'user-agent';
    EXCEPTION WHEN OTHERS THEN
      v_ua := NULL;
    END;
    NEW.device_type := public.device_class(v_ua);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tap_events_enrich ON public.tap_events;
CREATE TRIGGER trg_tap_events_enrich
  BEFORE INSERT ON public.tap_events
  FOR EACH ROW EXECUTE FUNCTION public.tap_events_enrich();


-- ---------------------------------------------------------------------------
-- 6. THE PUBLIC CARD PATH: /c/<CARD ID>
-- ---------------------------------------------------------------------------
-- What a tapped card should open. Says only what a stranger holding the card
-- needs: which page to show and how the card looks (for its opening
-- animation), or that the card is not active. The page itself is still read
-- through get_public_profile(), so every clamp that function applies holds.
CREATE OR REPLACE FUNCTION public.get_public_card(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card public.cards%ROWTYPE;
  v_tap  public.tap_profiles%ROWTYPE;
  v_sku  TEXT[];
BEGIN
  SELECT * INTO v_card FROM public.cards c
  WHERE c.card_code = public.normalise_card_code(p_code)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  IF v_card.status = 'replaced' OR v_card.lost_at IS NOT NULL THEN
    RETURN jsonb_build_object('state', 'inactive');
  END IF;
  IF v_card.status IN ('pending', 'shipped') THEN
    RETURN jsonb_build_object('state', 'not_activated');
  END IF;
  IF v_card.status <> 'active'
     OR (v_card.activation_expires_at IS NOT NULL AND v_card.activation_expires_at <= NOW()) THEN
    RETURN jsonb_build_object('state', 'inactive');
  END IF;

  SELECT * INTO v_tap FROM public.tap_profiles t WHERE t.id = v_card.tap_profile_id;
  IF NOT FOUND OR v_tap.suspended_at IS NOT NULL OR v_tap.slug IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  IF v_tap.status = 'paused' THEN
    RETURN jsonb_build_object('state', 'paused');
  END IF;
  IF v_tap.status <> 'active' THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;

  v_sku := regexp_match(COALESCE(v_card.sku, ''),
                        '^card-(.+)-(standard|premium)-(pvc|metal|transparent)$');

  RETURN jsonb_build_object(
    'state',    'active',
    'code',     v_card.card_code,
    'slug',     v_tap.slug,
    'design',   v_sku[1],
    'finish',   v_sku[2],
    'material', v_sku[3]
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_card(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(TEXT) TO anon, authenticated;

-- The analytics event for a card-opened page. Same rules as record_tap_event()
-- plus the card: only an active card on a live page can log anything, and a
-- repeat of the same event from the same visitor within 20 seconds is dropped
-- so a refresh does not count as a second tap.
CREATE OR REPLACE FUNCTION public.record_card_tap(
  p_code     TEXT,
  p_event    TEXT,
  p_link_key TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card_id UUID;
  v_tap_id  UUID;
  v_headers JSON;
  v_ua      TEXT;
  v_ip      TEXT;
  v_ref     TEXT;
  v_hash    TEXT;
BEGIN
  IF p_event NOT IN ('view', 'nfc', 'link_click') THEN
    RETURN;
  END IF;

  SELECT c.id, t.id INTO v_card_id, v_tap_id
  FROM public.cards c
  JOIN public.tap_profiles t ON t.id = c.tap_profile_id
  WHERE c.card_code = public.normalise_card_code(p_code)
    AND c.status = 'active'
    AND c.lost_at IS NULL
    AND (c.activation_expires_at IS NULL OR c.activation_expires_at > NOW())
    AND t.status = 'active'
    AND t.suspended_at IS NULL
  LIMIT 1;

  IF v_card_id IS NULL THEN
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

  v_hash := md5(COALESCE(v_ua, '') || '|' || COALESCE(v_ip, '') || '|' ||
                to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD'));

  IF EXISTS (SELECT 1 FROM public.tap_events e
             WHERE e.card_id = v_card_id
               AND e.event_type = p_event
               AND e.visitor_hash = v_hash
               AND e.link_key IS NOT DISTINCT FROM left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48)
               AND e.occurred_at > NOW() - interval '20 seconds') THEN
    RETURN;
  END IF;

  INSERT INTO public.tap_events
    (tap_profile_id, card_id, event_type, link_key, visitor_hash, referrer_host, device_type)
  VALUES (
    v_tap_id,
    v_card_id,
    p_event,
    left(NULLIF(btrim(COALESCE(p_link_key, '')), ''), 48),
    v_hash,
    left(NULLIF(split_part(split_part(COALESCE(v_ref, ''), '://', 2), '/', 1), ''), 128),
    public.device_class(v_ua)
  );

  IF p_event = 'nfc' THEN
    UPDATE public.cards SET tap_count = tap_count + 1, last_tapped_at = NOW() WHERE id = v_card_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.record_card_tap(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_card_tap(TEXT, TEXT, TEXT) TO anon, authenticated;

-- The opening a page plays when it is opened by its QR or /t/ link rather than
-- a card: the design of the newest active card on that page, if any.
CREATE OR REPLACE FUNCTION public.get_public_page_card(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object('design', m[1], 'finish', m[2], 'material', m[3])
  FROM public.tap_profiles t
  JOIN public.cards c ON c.tap_profile_id = t.id
  CROSS JOIN LATERAL regexp_match(COALESCE(c.sku, ''),
    '^card-(.+)-(standard|premium)-(pvc|metal|transparent)$') AS m
  WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
    AND t.status = 'active' AND t.suspended_at IS NULL
    AND c.status = 'active' AND c.lost_at IS NULL
    AND m IS NOT NULL
  ORDER BY c.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_page_card(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_page_card(TEXT) TO anon, authenticated;


-- ---------------------------------------------------------------------------
-- 7. ANALYTICS FOR THE CUSTOMER
-- ---------------------------------------------------------------------------
-- Everything the Analytics page shows, in one call, for the caller's own pages
-- only. Optional filters narrow it to one page or one card.
--
-- "Unique visitors" counts distinct daily visitor digests: the digest rotates
-- every day by design (002), so one person on two days counts twice. The page
-- says so.
CREATE OR REPLACE FUNCTION public.get_page_analytics(
  p_days    INT  DEFAULT 30,
  p_tap_id  UUID DEFAULT NULL,
  p_card_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_days  INT  := greatest(1, least(365, COALESCE(p_days, 30)));
  v_since TIMESTAMPTZ;
  v_out   JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  v_since := date_trunc('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata'
             - make_interval(days => v_days - 1);

  WITH mine AS (
    SELECT e.*
    FROM public.tap_events e
    JOIN public.tap_profiles t ON t.id = e.tap_profile_id
    WHERE t.user_id = v_user
      AND (p_tap_id IS NULL OR e.tap_profile_id = p_tap_id)
      AND (p_card_id IS NULL OR e.card_id = p_card_id)
  ),
  win AS (
    SELECT * FROM mine WHERE occurred_at >= v_since
  )
  SELECT jsonb_build_object(
    'days', v_days,
    'totals', (SELECT jsonb_build_object(
        'views',          count(*) FILTER (WHERE event_type = 'view'),
        'taps',           count(*) FILTER (WHERE event_type = 'nfc'),
        'qr',             count(*) FILTER (WHERE event_type = 'qr'),
        'clicks',         count(*) FILTER (WHERE event_type = 'link_click'),
        'uniqueVisitors', count(DISTINCT visitor_hash))
      FROM win),
    'lifetime', (SELECT jsonb_build_object(
        'views', count(*) FILTER (WHERE event_type = 'view'),
        'taps',  count(*) FILTER (WHERE event_type = 'nfc'),
        'qr',    count(*) FILTER (WHERE event_type = 'qr'),
        'clicks', count(*) FILTER (WHERE event_type = 'link_click'),
        'firstAt', min(occurred_at))
      FROM mine),
    'daily', COALESCE((SELECT jsonb_agg(d ORDER BY d->>'day') FROM (
        SELECT jsonb_build_object(
          'day',    to_char((occurred_at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD'),
          'views',  count(*) FILTER (WHERE event_type = 'view'),
          'taps',   count(*) FILTER (WHERE event_type = 'nfc'),
          'qr',     count(*) FILTER (WHERE event_type = 'qr'),
          'clicks', count(*) FILTER (WHERE event_type = 'link_click'),
          'unique', count(DISTINCT visitor_hash)) AS d
        FROM win GROUP BY (occurred_at AT TIME ZONE 'Asia/Kolkata')::date) s), '[]'::jsonb),
    'weekly', COALESCE((SELECT jsonb_agg(w ORDER BY w->>'week') FROM (
        SELECT jsonb_build_object(
          'week',  to_char(date_trunc('week', occurred_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM-DD'),
          'views', count(*) FILTER (WHERE event_type = 'view'),
          'taps',  count(*) FILTER (WHERE event_type = 'nfc')) AS w
        FROM mine WHERE occurred_at >= NOW() - interval '12 weeks'
        GROUP BY date_trunc('week', occurred_at AT TIME ZONE 'Asia/Kolkata')) s), '[]'::jsonb),
    'monthly', COALESCE((SELECT jsonb_agg(m ORDER BY m->>'month') FROM (
        SELECT jsonb_build_object(
          'month', to_char(date_trunc('month', occurred_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM'),
          'views', count(*) FILTER (WHERE event_type = 'view'),
          'taps',  count(*) FILTER (WHERE event_type = 'nfc')) AS m
        FROM mine WHERE occurred_at >= NOW() - interval '12 months'
        GROUP BY date_trunc('month', occurred_at AT TIME ZONE 'Asia/Kolkata')) s), '[]'::jsonb),
    'devices', COALESCE((SELECT jsonb_agg(jsonb_build_object('device', device, 'count', n) ORDER BY n DESC)
      FROM (SELECT COALESCE(device_type, 'unknown') AS device, count(*) AS n
            FROM win WHERE event_type IN ('view', 'nfc', 'qr')
            GROUP BY 1) s), '[]'::jsonb),
    'links', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', link_key, 'clicks', n) ORDER BY n DESC)
      FROM (SELECT link_key, count(*) AS n FROM win
            WHERE event_type = 'link_click' AND link_key IS NOT NULL
            GROUP BY 1) s), '[]'::jsonb),
    'cards', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', c.id, 'code', c.card_code, 'nickname', c.nickname, 'status', c.status,
          'tapProfileId', c.tap_profile_id,
          'taps', (SELECT count(*) FROM win w WHERE w.card_id = c.id AND w.event_type = 'nfc'),
          'lifetimeTaps', c.tap_count,
          'lastTappedAt', c.last_tapped_at) ORDER BY c.created_at)
      FROM public.cards c
      WHERE c.user_id = v_user
        AND (p_tap_id IS NULL OR c.tap_profile_id = p_tap_id)
        AND (p_card_id IS NULL OR c.id = p_card_id)), '[]'::jsonb),
    'lastTap', (SELECT jsonb_build_object(
          'at', e.occurred_at, 'event', e.event_type, 'device', e.device_type,
          'cardCode', c.card_code, 'cardNickname', c.nickname)
      FROM mine e LEFT JOIN public.cards c ON c.id = e.card_id
      WHERE e.event_type IN ('nfc', 'qr', 'view')
      ORDER BY e.occurred_at DESC LIMIT 1)
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.get_page_analytics(INT, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_page_analytics(INT, UUID, UUID) TO authenticated;

-- Recent activity, newest first. No visitor digest leaves the database.
CREATE OR REPLACE FUNCTION public.get_tap_history(
  p_tap_id  UUID DEFAULT NULL,
  p_card_id UUID DEFAULT NULL,
  p_limit   INT  DEFAULT 50
)
RETURNS TABLE (
  occurred_at   TIMESTAMPTZ,
  event_type    TEXT,
  device_type   TEXT,
  link_key      TEXT,
  referrer_host TEXT,
  page_slug     TEXT,
  card_code     TEXT,
  card_nickname TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.occurred_at, e.event_type::text, e.device_type::text, e.link_key::text,
         e.referrer_host::text, t.slug, c.card_code, c.nickname
  FROM public.tap_events e
  JOIN public.tap_profiles t ON t.id = e.tap_profile_id
  LEFT JOIN public.cards c ON c.id = e.card_id
  WHERE t.user_id = auth.uid()
    AND (p_tap_id IS NULL OR e.tap_profile_id = p_tap_id)
    AND (p_card_id IS NULL OR e.card_id = p_card_id)
  ORDER BY e.occurred_at DESC
  LIMIT greatest(1, least(200, COALESCE(p_limit, 50)));
$$;

REVOKE ALL ON FUNCTION public.get_tap_history(UUID, UUID, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tap_history(UUID, UUID, INT) TO authenticated;


-- ---------------------------------------------------------------------------
-- 8. CARD MANAGEMENT BY THE CUSTOMER
-- ---------------------------------------------------------------------------
-- Activation and deactivation stay behind a one-time code (card-otp, 015).
-- Naming a card and reporting it lost only need the signed-in owner: a name is
-- cosmetic, and "lost" can only switch a card off, never on.
CREATE OR REPLACE FUNCTION public.customer_set_card_nickname(p_card_id UUID, p_nickname TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT := NULLIF(btrim(regexp_replace(COALESCE(p_nickname, ''), '\s+', ' ', 'g')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF v_name IS NOT NULL AND char_length(v_name) > 40 THEN
    RAISE EXCEPTION 'A card name can be at most 40 characters.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.cards SET nickname = v_name
  WHERE id = p_card_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_set_card_nickname(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_set_card_nickname(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.customer_report_card_lost(p_card_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card  public.cards%ROWTYPE;
  v_name  TEXT;
  v_label TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_card FROM public.cards
  WHERE id = p_card_id AND user_id = auth.uid()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_card.status = 'replaced' THEN
    RAISE EXCEPTION 'This card has already been replaced.' USING ERRCODE = '22023';
  END IF;
  IF v_card.lost_at IS NOT NULL THEN
    RETURN to_jsonb(v_card);
  END IF;

  UPDATE public.cards
  SET status = 'suspended', lost_at = NOW(), deactivated_at = NOW()
  WHERE id = p_card_id;

  v_label := COALESCE(v_card.nickname, 'card ' || v_card.card_code);
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), 'A customer')
  INTO v_name FROM public.profiles p WHERE p.id = v_card.user_id;

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_card.user_id, 'tap', 'Card reported lost',
          'Your ' || v_label || ' no longer opens your page. Order a replacement to keep the same page on a new card.',
          '/shygontap/cards', jsonb_build_object('card_id', v_card.id, 'action', 'lost'));

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('tap', 'warning', 'Customer reported a card lost',
          COALESCE(v_name, 'A customer') || ' reported card ' || v_card.card_code || ' lost. It is switched off.',
          '/customers/' || v_card.user_id::text,
          jsonb_build_object('card_id', v_card.id, 'user_id', v_card.user_id, 'action', 'lost'));

  RETURN (SELECT to_jsonb(c) FROM public.cards c WHERE c.id = p_card_id);
END;
$$;

REVOKE ALL ON FUNCTION public.customer_report_card_lost(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_report_card_lost(UUID) TO authenticated;

-- 015's function, with one addition: activating a card that was reported lost
-- (and then found) clears the lost flag. Only reachable after a verified code.
CREATE OR REPLACE FUNCTION public.card_apply_verified_action(
  p_user_id UUID,
  p_card_id UUID,
  p_action  TEXT
)
RETURNS TABLE (
  id                    UUID,
  status                TEXT,
  activated_at          TIMESTAMPTZ,
  activation_expires_at TIMESTAMPTZ,
  deactivated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
        deactivated_at = NULL,
        lost_at = NULL
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
  v_label := COALESCE(NULLIF(btrim(v_card.nickname), ''), NULLIF(btrim(v_card.card_uid), ''),
                      'card ' || COALESCE(v_card.card_code, left(v_card.id::text, 8)));

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (
    p_user_id,
    'tap',
    CASE WHEN p_action = 'activate' THEN 'Card activated' ELSE 'Card deactivated' END,
    CASE WHEN p_action = 'activate'
      THEN 'Your ' || v_label || ' is active and opens your Tap.'
      ELSE 'Your ' || v_label || ' is deactivated. Tapping it no longer opens your Tap.'
    END,
    '/shygontap/cards',
    jsonb_build_object('card_id', v_card.id, 'action', p_action, 'verified_by', 'otp')
  );

  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES (
    'tap',
    CASE WHEN p_action = 'deactivate' THEN 'warning' ELSE 'info' END,
    CASE WHEN p_action = 'activate' THEN 'Customer activated a card' ELSE 'Customer deactivated a card' END,
    v_name || ' ' || CASE WHEN p_action = 'activate' THEN 'activated' ELSE 'deactivated' END
      || ' ' || v_label || ', confirmed by a one-time password.',
    '/customers/' || p_user_id::text,
    jsonb_build_object('card_id', v_card.id, 'user_id', p_user_id, 'action', p_action, 'verified_by', 'otp')
  );

  RETURN QUERY
  SELECT c.id, c.status::text, c.activated_at, c.activation_expires_at, c.deactivated_at
  FROM public.cards c
  WHERE c.id = v_card.id;
END;
$$;

REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) TO service_role;

-- 015's challenges were for SMS only; a code can now also go by email.
ALTER TABLE public.card_otp_challenges ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms';


-- ---------------------------------------------------------------------------
-- 9. THE CARD LIFE STORY, IN THE ACCOUNT EVENT LOG
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.account_events_from_card()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_account_event(NEW.user_id, 'card.issued', 'card', NEW.id::text,
      jsonb_build_object('code', NEW.card_code, 'sku', NEW.sku, 'order_id', NEW.order_id,
                         'replaces', NEW.replaces_card_id));
    RETURN NEW;
  END IF;

  IF NEW.lost_at IS NOT NULL AND OLD.lost_at IS NULL THEN
    PERFORM public.log_account_event(NEW.user_id, 'card.lost', 'card', NEW.id::text,
      jsonb_build_object('code', NEW.card_code));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.log_account_event(NEW.user_id, 'card.' || NEW.status, 'card', NEW.id::text,
      jsonb_build_object('code', NEW.card_code, 'from', OLD.status));
  END IF;

  IF NEW.nickname IS DISTINCT FROM OLD.nickname THEN
    PERFORM public.log_account_event(NEW.user_id, 'card.renamed', 'card', NEW.id::text,
      jsonb_build_object('code', NEW.card_code, 'nickname', NEW.nickname));
  END IF;

  IF NEW.tap_profile_id IS DISTINCT FROM OLD.tap_profile_id AND NEW.tap_profile_id IS NOT NULL THEN
    PERFORM public.log_account_event(NEW.user_id, 'card.linked', 'card', NEW.id::text,
      jsonb_build_object('code', NEW.card_code, 'tap_profile_id', NEW.tap_profile_id));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.account_events_from_card() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cards_events ON public.cards;
CREATE TRIGGER trg_cards_events
  AFTER INSERT OR UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.account_events_from_card();


-- ---------------------------------------------------------------------------
-- 10. ADMIN READS THAT ASSUMED ONE PAGE PER CUSTOMER
-- ---------------------------------------------------------------------------
-- 013's versions used `(SELECT … FROM tap_profiles WHERE user_id = …)` as a
-- scalar, which errors once a customer has a second page. The customer's first
-- page is still returned under the same keys; every page is added alongside.
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
        'tap_slug', (SELECT t.slug FROM public.tap_profiles t WHERE t.user_id = f.id
                     ORDER BY t.created_at, t.id LIMIT 1),
        'tap_published', (SELECT t.published IS TRUE AND t.suspended_at IS NULL
                          FROM public.tap_profiles t WHERE t.user_id = f.id
                          ORDER BY t.created_at, t.id LIMIT 1),
        'tap_count', (SELECT count(*) FROM public.tap_profiles t WHERE t.user_id = f.id),
        'card_count', (SELECT count(*) FROM public.cards c WHERE c.user_id = f.id)
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
      FROM public.tap_profiles t WHERE t.user_id = p.id
      ORDER BY t.created_at, t.id LIMIT 1),
    'taps', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'slug', t.slug, 'display_name', t.display_name,
        'status', t.status, 'published', t.published, 'published_at', t.published_at,
        'selected_ui_tier', t.selected_ui_tier,
        'suspended_at', t.suspended_at, 'created_at', t.created_at,
        'card_codes', (SELECT COALESCE(jsonb_agg(c.card_code ORDER BY c.created_at), '[]'::jsonb)
                       FROM public.cards c WHERE c.tap_profile_id = t.id))
        ORDER BY t.created_at)
      FROM public.tap_profiles t WHERE t.user_id = p.id), '[]'::jsonb),
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

-- ============================================================================
-- VERIFY
--   SELECT card_code, tap_profile_id FROM public.cards ORDER BY created_at DESC LIMIT 5;
--   SELECT public.get_public_card('<CARD ID>');
--   SELECT indexname FROM pg_indexes WHERE tablename = 'tap_profiles';
--     -- expect no unique index on (user_id)
-- ============================================================================



-- ###########################################################################
-- ## 020_promo_codes_delivery_custom_card.sql
-- ###########################################################################

-- ============================================================================
-- 020 — PROMO CODES, DELIVERY CHARGE, THE CUSTOM CARD, THE YOUTUBE ADD-ON
-- ============================================================================
-- Run AFTER 019. Idempotent.
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



-- ###########################################################################
-- ## 021_email_outbox.sql
-- ###########################################################################

-- ============================================================================
-- 021 — CUSTOMER EMAILS: AN OUTBOX FILLED BY THE DATABASE
-- ============================================================================
-- Run AFTER 020. Idempotent.
--
-- Every email a customer gets is queued here by a trigger, in the same
-- transaction as the change it describes, so it goes out no matter which path
-- made the change — the checkout, the Razorpay webhook, the Admin app moving an
-- order, or a card activated with a one-time code:
--
--   order_confirmed      payment received: the order and its e-bill
--   payment_failed       Razorpay reported the payment failed
--   order_shipped        order_status -> shipped
--   order_out_for_delivery
--   order_delivered
--   order_cancelled
--   order_refunded       payment_status -> refunded
--   card_activated / card_deactivated / card_lost / card_replaced
--
-- netlify/functions/send-emails (and the functions that change orders and
-- cards, straight after the change) claim rows with email_outbox_claim(),
-- render them, send them and report back with email_outbox_complete(). A
-- dedupe key per event means a replayed webhook never sends the same email
-- twice. Shipping and delivery emails respect the customer's "order updates"
-- preference, as the in-app notifications already do; receipts and card
-- security emails are always sent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  template            TEXT NOT NULL,
  -- The order or card the email is about.
  subject_id          UUID,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key          TEXT NOT NULL UNIQUE,
  -- pending | sending | sent | failed | skipped
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  to_email            TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_due
  ON public.email_outbox (next_attempt_at) WHERE status IN ('pending', 'sending', 'failed');
CREATE INDEX IF NOT EXISTS idx_email_outbox_user ON public.email_outbox (user_id, created_at DESC);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon;

-- Administrators can see what was sent to whom; nobody else reads it.
DROP POLICY IF EXISTS email_outbox_admin_select ON public.email_outbox;
CREATE POLICY email_outbox_admin_select ON public.email_outbox
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

CREATE OR REPLACE FUNCTION public.email_enqueue(
  p_user       UUID,
  p_template   TEXT,
  p_subject_id UUID,
  p_dedupe     TEXT,
  p_payload    JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.email_outbox (user_id, template, subject_id, dedupe_key, payload)
  SELECT p_user, p_template, p_subject_id, p_dedupe, COALESCE(p_payload, '{}'::jsonb)
  WHERE p_user IS NOT NULL
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.email_enqueue(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- ORDER EMAILS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_queue_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wants BOOLEAN := true;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'paid' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_confirmed', NEW.id,
        'order_confirmed:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    ELSIF NEW.payment_status = 'failed' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'payment_failed', NEW.id,
        'payment_failed:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    ELSIF NEW.payment_status = 'refunded' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_refunded', NEW.id,
        'order_refunded:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    END IF;
  END IF;

  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status IN ('shipped', 'out_for_delivery', 'delivered', 'cancelled') THEN
    SELECT COALESCE(p.notify_order_updates, true) INTO v_wants
    FROM public.profiles p WHERE p.id = NEW.user_id;

    IF NEW.order_status = 'cancelled' OR COALESCE(v_wants, true) THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_' || NEW.order_status, NEW.id,
        'order_' || NEW.order_status || ':' || NEW.id::text,
        jsonb_build_object('order_id', NEW.id));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_queue_emails() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_queue_emails ON public.orders;
CREATE TRIGGER trg_orders_queue_emails
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_queue_emails();


-- ---------------------------------------------------------------------------
-- CARD EMAILS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cards_queue_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stamp TEXT := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lost_at IS NOT NULL AND OLD.lost_at IS NULL THEN
    PERFORM public.email_enqueue(NEW.user_id, 'card_lost', NEW.id,
      'card_lost:' || NEW.id::text || ':' || v_stamp, jsonb_build_object('card_id', NEW.id));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_activated', NEW.id,
        'card_activated:' || NEW.id::text || ':' || v_stamp, jsonb_build_object('card_id', NEW.id));
    ELSIF NEW.status = 'suspended' AND OLD.status = 'active' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_deactivated', NEW.id,
        'card_deactivated:' || NEW.id::text || ':' || v_stamp,
        jsonb_build_object('card_id', NEW.id,
                           'expired', NEW.deactivated_at IS NULL
                                      AND NEW.activation_expires_at IS NOT NULL
                                      AND NEW.activation_expires_at <= NOW()));
    ELSIF NEW.status = 'replaced' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_replaced', NEW.id,
        'card_replaced:' || NEW.id::text, jsonb_build_object('card_id', NEW.id));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cards_queue_emails() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cards_queue_emails ON public.cards;
CREATE TRIGGER trg_cards_queue_emails
  AFTER UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_queue_emails();


-- ---------------------------------------------------------------------------
-- THE SENDER'S HALF (service role only)
-- ---------------------------------------------------------------------------
-- Claims up to p_limit due emails. A claim is a 3-minute lease: a sender that
-- dies mid-send leaves the row to be picked up again, never lost and never
-- sent by two senders at once (SKIP LOCKED).
CREATE OR REPLACE FUNCTION public.email_outbox_claim(p_limit INT DEFAULT 10)
RETURNS SETOF public.email_outbox
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.email_outbox o
  SET status = 'sending',
      attempts = o.attempts + 1,
      locked_until = NOW() + interval '3 minutes'
  WHERE o.id IN (
    SELECT q.id FROM public.email_outbox q
    WHERE q.status IN ('pending', 'sending', 'failed')
      AND q.next_attempt_at <= NOW()
      AND (q.locked_until IS NULL OR q.locked_until < NOW())
      AND q.attempts < 6
    ORDER BY q.created_at
    LIMIT greatest(1, least(50, COALESCE(p_limit, 10)))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

-- p_outcome: sent | retry (a failed attempt, try again later) | postpone (not
-- an attempt: e.g. the order is still being fulfilled) | skip (nothing to send).
CREATE OR REPLACE FUNCTION public.email_outbox_complete(
  p_id            UUID,
  p_outcome       TEXT,
  p_error         TEXT DEFAULT NULL,
  p_to            TEXT DEFAULT NULL,
  p_message_id    TEXT DEFAULT NULL,
  p_retry_seconds INT  DEFAULT 300
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_outcome = 'sent' THEN
    UPDATE public.email_outbox
    SET status = 'sent', sent_at = NOW(), locked_until = NULL, last_error = NULL,
        to_email = COALESCE(p_to, to_email), provider_message_id = p_message_id
    WHERE id = p_id;
  ELSIF p_outcome = 'postpone' THEN
    UPDATE public.email_outbox
    SET status = 'pending', attempts = greatest(0, attempts - 1), locked_until = NULL,
        next_attempt_at = NOW() + make_interval(secs => greatest(10, COALESCE(p_retry_seconds, 60)))
    WHERE id = p_id;
  ELSIF p_outcome = 'skip' THEN
    UPDATE public.email_outbox
    SET status = 'skipped', locked_until = NULL, last_error = left(p_error, 500)
    WHERE id = p_id;
  ELSE
    UPDATE public.email_outbox
    SET status = 'failed', locked_until = NULL, last_error = left(p_error, 500),
        to_email = COALESCE(p_to, to_email),
        next_attempt_at = NOW() + make_interval(secs => greatest(30, COALESCE(p_retry_seconds, 300)))
    WHERE id = p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.email_outbox_claim(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_outbox_complete(UUID, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_claim(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_outbox_complete(UUID, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;

-- ============================================================================
-- VERIFY
--   SELECT template, status, attempts, last_error, created_at
--   FROM public.email_outbox ORDER BY created_at DESC LIMIT 20;
-- ============================================================================



-- ###########################################################################
-- ## 022_admin_cards_and_emails.sql
-- ###########################################################################

-- ============================================================================
-- 022 — ADMIN APP: CARDS AND EMAILS
-- ============================================================================
-- Run AFTER 021. Idempotent. Additive: nothing existing is changed.
--
-- The Admin app reads only through SECURITY DEFINER RPCs (013's pattern), so
-- the cards (with their Card IDs, 019) and the customer email outbox (021) get
-- the same: a paged list for each, and a retry for an email that failed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_cards(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- pending | shipped | active | suspended | lost | replaced
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
  v_code   TEXT := public.normalise_card_code(p_search);
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  WITH filtered AS (
    SELECT c.*, p.full_name, p.email, t.slug, o.order_id AS order_reference
    FROM public.cards c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN public.tap_profiles t ON t.id = c.tap_profile_id
    LEFT JOIN public.orders o ON o.id = c.order_id
    WHERE (v_q IS NULL
           OR c.card_code = v_code
           OR c.card_uid ILIKE '%' || v_q || '%'
           OR c.nickname ILIKE '%' || v_q || '%'
           OR p.full_name ILIKE '%' || v_q || '%'
           OR p.email ILIKE '%' || v_q || '%'
           OR t.slug ILIKE '%' || v_q || '%'
           OR o.order_id ILIKE '%' || v_q || '%')
      AND (p_status IS NULL
           OR (p_status = 'lost' AND c.lost_at IS NOT NULL)
           OR (p_status <> 'lost' AND c.status = p_status AND (p_status <> 'suspended' OR c.lost_at IS NULL)))
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'card_code', f.card_code, 'card_uid', f.card_uid, 'nickname', f.nickname,
        'sku', f.sku, 'status', f.status, 'lost_at', f.lost_at, 'is_replacement', f.is_replacement,
        'replaces_card_id', f.replaces_card_id, 'activation_expires_at', f.activation_expires_at,
        'tap_count', f.tap_count, 'last_tapped_at', f.last_tapped_at, 'created_at', f.created_at,
        'user_id', f.user_id, 'customer_name', f.full_name, 'customer_email', f.email,
        'tap_profile_id', f.tap_profile_id, 'tap_slug', f.slug,
        'order_id', f.order_id, 'order_reference', f.order_reference,
        'edition_serial', f.edition_serial, 'edition_chapter_size', f.edition_chapter_size)
        ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_emails(
  p_status TEXT DEFAULT NULL,   -- pending | sending | sent | failed | skipped
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
  v_limit  INT := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.require_admin('orders.read');

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.email_outbox e WHERE p_status IS NULL OR e.status = p_status),
    'limit', v_limit,
    'offset', v_offset,
    'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
               FROM (SELECT status, count(*) AS n FROM public.email_outbox GROUP BY status) s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'template', e.template, 'status', e.status, 'attempts', e.attempts,
        'last_error', e.last_error, 'to_email', COALESCE(e.to_email, p.email),
        'customer_name', p.full_name, 'user_id', e.user_id, 'subject_id', e.subject_id,
        'created_at', e.created_at, 'sent_at', e.sent_at, 'next_attempt_at', e.next_attempt_at)
        ORDER BY e.created_at DESC)
      FROM (SELECT * FROM public.email_outbox x
            WHERE p_status IS NULL OR x.status = p_status
            ORDER BY x.created_at DESC LIMIT v_limit OFFSET v_offset) e
      LEFT JOIN public.profiles p ON p.id = e.user_id
    ), '[]'::jsonb)
  );
END;
$$;

-- Puts a failed or skipped email back in the queue, to go out on the next run.
CREATE OR REPLACE FUNCTION public.admin_retry_email(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
BEGIN
  UPDATE public.email_outbox
  SET status = 'pending', attempts = 0, next_attempt_at = NOW(), locked_until = NULL, last_error = NULL
  WHERE id = p_id AND status IN ('failed', 'skipped');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a failed or skipped email can be retried.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.admin_audit(v_admin, 'email.retried', 'email', p_id::text, NULL);
  RETURN (SELECT to_jsonb(e) - 'payload' FROM public.email_outbox e WHERE e.id = p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cards(TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_emails(TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_retry_email(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_cards(TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_emails(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_email(UUID) TO authenticated;



-- ###########################################################################
-- ## 023_tax_billing_inventory_funnel.sql
-- ###########################################################################

-- ============================================================================
-- 023 — GST, BILLING ADDRESS, ORDER TIMELINE, PHYSICAL CARD STOCK,
--       CANCELLATION REQUESTS, STORE FUNNEL, SUPPORT EMAILS
-- ============================================================================
-- Run AFTER 022. Idempotent. Additive: no existing table, column or function
-- that the website or the Admin app reads is changed.
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
CREATE TABLE IF NOT EXISTS public.order_status_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- order | payment | card | request
  kind        TEXT NOT NULL,
  status      TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
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
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_history (order_id, kind, status) VALUES (NEW.id, 'order', COALESCE(NEW.order_status, 'placed'));
    RETURN NEW;
  END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO public.order_status_history (order_id, kind, status) VALUES (NEW.id, 'payment', NEW.payment_status);
  END IF;
  IF NEW.order_status IS DISTINCT FROM OLD.order_status THEN
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
-- `cards` (002/019) is a customer's card, created when an order is paid. This
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
-- by the card triggers (021).
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

-- A card's whole story: its own events (019's account log), the admin actions
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
  -- A runaway or hostile client cannot flood the table.
  IF (SELECT count(*) FROM public.store_events WHERE session_id = p_session AND occurred_at > NOW() - interval '1 day') >= 300 THEN
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
-- 7. SUPPORT EMAILS (the 021 outbox)
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



-- ###########################################################################
-- ## 024_tier_buttons_and_card_details.sql
-- ###########################################################################

-- 024: contact buttons by tier, card details before checkout
--
-- 1. public.tier_buttons(tier): the buttons each digital experience includes.
--    Essential: call, email, WhatsApp. Business: + Instagram, LinkedIn, website.
--    Premium: + location, YouTube, custom links. GOAT: + photo gallery.
--    Each tier includes the ones below it. Add-ons bought separately still
--    unlock a button on any tier. The website's src/lib/tierButtons.ts mirrors
--    this table for display only; this function is what decides.
-- 2. get_public_profile / get_public_tap / enforce_tap_edit_rules use it: a
--    button shows (and may be switched on) when the PAGE's tier includes it
--    or the customer bought it. Bodies are otherwise unchanged (from 009, 013
--    and 019).
-- 3. orders.profile_details: what the customer typed on the Card details page
--    (name on card, title, contact buttons). The server copies it into the
--    new page when the order is paid. No payment data, ever.
--
-- Idempotent. Rollback: re-run 009's get_public_profile, 013's get_public_tap
-- and 019's enforce_tap_edit_rules; DROP FUNCTION public.tier_buttons(TEXT);
-- ALTER TABLE public.orders DROP COLUMN profile_details.

CREATE OR REPLACE FUNCTION public.tier_buttons(p_tier TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE lower(COALESCE(p_tier, 'essential'))
    WHEN 'goat'     THEN ARRAY['phone','email','whatsapp','instagram','linkedin','website','location','youtube','links','gallery']
    WHEN 'premium'  THEN ARRAY['phone','email','whatsapp','instagram','linkedin','website','location','youtube','links']
    WHEN 'business' THEN ARRAY['phone','email','whatsapp','instagram','linkedin','website']
    ELSE                 ARRAY['phone','email','whatsapp']
  END;
$$;
GRANT EXECUTE ON FUNCTION public.tier_buttons(TEXT) TO anon, authenticated, service_role;

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

  -- 024: a button is allowed when the page's tier includes it OR it was bought.
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.enabled_customizations) AS k(key)
    WHERE k.key <> ALL (v_owned || public.tier_buttons(NEW.selected_ui_tier))
  ) THEN
    RAISE EXCEPTION 'That add-on has not been purchased.' USING ERRCODE = '42501';
  END IF;

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

  IF NOT (v_pass
          OR OLD.last_content_edit_at IS NULL
          OR OLD.last_content_edit_at + make_interval(days => public.tap_edit_interval_days()) <= NOW()) THEN
    RAISE EXCEPTION
      'You can change your Tap once every % days. The Customization Pass removes the limit.',
      public.tap_edit_interval_days()
      USING ERRCODE = '42501';
  END IF;

  NEW.last_content_edit_at := NOW();
  RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_tap_profiles_edit_rules ON public.tap_profiles;
CREATE TRIGGER trg_tap_profiles_edit_rules
  BEFORE UPDATE ON public.tap_profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_tap_edit_rules();

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

  v_clamp := CASE
    WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
      THEN public.canonical_experience(v_tap.selected_ui_tier)
    ELSE v_tier
  END;

  -- 024: the page's own tier includes its buttons; add-ons add more.
  v_shown := ARRAY(
    SELECT unnest(v_tap.enabled_customizations)
    INTERSECT
    SELECT unnest(v_owned || public.tier_buttons(v_clamp))
  );

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
AS $function$
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
  -- 024: the page's tier includes its buttons.
  v_owned := v_owned || public.tier_buttons(CASE WHEN public.tier_rank(v_tap.selected_ui_tier)<=public.tier_rank(v_max) THEN v_tap.selected_ui_tier ELSE v_max END);
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
$function$;

REVOKE ALL ON FUNCTION public.get_public_tap(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tap(TEXT) TO anon, authenticated;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS profile_details JSONB;
COMMENT ON COLUMN public.orders.profile_details IS
  'Card details page: name on card, title, company and contact buttons. Copied into the new page on payment. Never payment data.';

-- 019's reserved names plus the new /shygontap/card-details screen.
CREATE OR REPLACE FUNCTION public.tap_slug_reserved(p_slug TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_slug, ''))) IN (
    'admin', 'api', 'auth', 'account', 'shygontap', 'store', 'checkout', 'orders',
    'settings', 'support', 'tap', 'www', 'billing', 'cards', 'card', 'c', 't',
    'shygon', 'shygontech', 'login', 'signup', 'help', 'tiers', 'customize', 'qr',
    'customizations', 'notifications', 'analytics', 'privacy-policy', 'terms',
    'cookie-policy', 'refund-policy', 'shipping-policy', 'card-details');
$$;



-- ###########################################################################
-- ## 025_product_reviews.sql
-- ###########################################################################

-- 025: verified-buyer product reviews
--
-- Star ratings and short reviews on each card's product page.
--   * Only a customer with a PAID order for that card design can review it
--     (every review is a verified purchase), once per design; writing again
--     updates their review.
--   * The public reads reviews through get_product_reviews(): first name and
--     initial only, never an email, user id or order.
--   * An administrator can hide a review (products.manage), audited.
-- The table itself has RLS on and no policies: every read and write goes
-- through the functions below.
--
-- Idempotent. Rollback: DROP FUNCTION public.get_product_reviews(TEXT, INT),
-- public.submit_product_review(TEXT, INT, TEXT, TEXT), public.my_product_review(TEXT),
-- public.admin_list_reviews(TEXT, INT, INT), public.admin_set_review_hidden(UUID, BOOLEAN, TEXT);
-- DROP TABLE public.product_reviews;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  TEXT NOT NULL CHECK (product_id ~ '^[a-z0-9-]{2,40}$'),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       TEXT CHECK (title IS NULL OR length(title) <= 80),
  body        TEXT CHECK (body IS NULL OR length(body) <= 800),
  hidden      BOOLEAN NOT NULL DEFAULT false,
  hidden_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews (product_id, created_at DESC) WHERE NOT hidden;
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_reviews FROM anon, authenticated;

-- Has this customer paid for a card of this design?
CREATE OR REPLACE FUNCTION public.bought_product(p_user UUID, p_product TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_items i ON i.order_id = o.id
    WHERE o.user_id = p_user AND o.payment_status = 'paid'
      AND i.sku ~ ('^card-' || p_product || '-(standard|premium)-(pvc|metal|transparent)$'));
$$;
REVOKE ALL ON FUNCTION public.bought_product(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_reviews(p_product TEXT, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.product_reviews WHERE product_id = p_product AND NOT hidden),
    'average', (SELECT round(avg(rating)::numeric, 1) FROM public.product_reviews WHERE product_id = p_product AND NOT hidden),
    'stars', (SELECT jsonb_object_agg(s, COALESCE(n, 0)) FROM generate_series(1, 5) s
              LEFT JOIN (SELECT rating, count(*) n FROM public.product_reviews
                         WHERE product_id = p_product AND NOT hidden GROUP BY rating) c ON c.rating = s),
    'reviews', COALESCE((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'id', pr.id, 'rating', pr.rating, 'title', pr.title, 'body', pr.body,
          'created_at', pr.created_at, 'updated', pr.updated_at > pr.created_at + interval '1 minute',
          'author', COALESCE(NULLIF(split_part(btrim(p.full_name), ' ', 1), ''), 'SHYGON customer')
                    || COALESCE(' ' || NULLIF(left(split_part(btrim(p.full_name), ' ', 2), 1), '') || '.', ''),
          'verified', true) AS r
        FROM public.product_reviews pr LEFT JOIN public.profiles p ON p.id = pr.user_id
        WHERE pr.product_id = p_product AND NOT pr.hidden
        ORDER BY pr.created_at DESC
        LIMIT least(greatest(COALESCE(p_limit, 20), 1), 50)) x), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_product_reviews(TEXT, INT) TO anon, authenticated;

-- The signed-in customer's own review, and whether they may write one.
CREATE OR REPLACE FUNCTION public.my_product_review(p_product TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'eligible', auth.uid() IS NOT NULL AND public.bought_product(auth.uid(), p_product),
    'review', (SELECT jsonb_build_object('rating', rating, 'title', title, 'body', body, 'hidden', hidden)
               FROM public.product_reviews WHERE product_id = p_product AND user_id = auth.uid()));
$$;
GRANT EXECUTE ON FUNCTION public.my_product_review(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_product_review(p_product TEXT, p_rating INT, p_title TEXT, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_title TEXT := NULLIF(left(btrim(COALESCE(p_title, '')), 80), '');
  v_body  TEXT := NULLIF(left(btrim(COALESCE(p_body, '')), 800), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to write a review.' USING ERRCODE = '42501'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Choose 1 to 5 stars.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.bought_product(v_user, p_product) THEN
    RAISE EXCEPTION 'Only customers who bought this card can review it.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.product_reviews (product_id, user_id, rating, title, body)
  VALUES (p_product, v_user, p_rating, v_title, v_body)
  ON CONFLICT (product_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating, title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW();
  RETURN public.my_product_review(p_product);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_product_review(TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_product_review(TEXT, INT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_reviews(p_product TEXT DEFAULT NULL, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('products.read');
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.product_reviews WHERE p_product IS NULL OR product_id = p_product),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT pr.id, pr.product_id, pr.rating, pr.title, pr.body, pr.hidden, pr.hidden_reason, pr.created_at,
               pr.user_id, p.full_name AS customer_name, p.email AS customer_email
        FROM public.product_reviews pr LEFT JOIN public.profiles p ON p.id = pr.user_id
        WHERE p_product IS NULL OR pr.product_id = p_product
        ORDER BY pr.created_at DESC
        LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200) OFFSET greatest(COALESCE(p_offset, 0), 0)) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_reviews(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reviews(TEXT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_review_hidden(p_id UUID, p_hidden BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_row   public.product_reviews%ROWTYPE;
BEGIN
  UPDATE public.product_reviews
     SET hidden = COALESCE(p_hidden, true),
         hidden_reason = CASE WHEN COALESCE(p_hidden, true) THEN NULLIF(btrim(COALESCE(p_reason, '')), '') END
   WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_audit(v_admin, CASE WHEN v_row.hidden THEN 'review.hidden' ELSE 'review.shown' END,
    'review', p_id::text, jsonb_build_object('product', v_row.product_id, 'reason', p_reason));
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_review_hidden(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_review_hidden(UUID, BOOLEAN, TEXT) TO authenticated;

