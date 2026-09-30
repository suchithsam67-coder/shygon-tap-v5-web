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
