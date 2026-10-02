-- ============================================================================
-- 022 — ONE PAGE PER CARD, PERMANENT CARD IDS, CARD MANAGEMENT, TAP ANALYTICS
-- ============================================================================
-- Idempotent: safe to run twice.
--
-- WHAT CHANGES
--   1. Every card gets a permanent Card ID (cards.card_code, 8 characters, e.g.
--      K7M4Q9XD). It is what the NFC chip of a new card encodes:
--          https://shygontech.com/c/<CARD ID>
--      and it ties together the physical card, the customer, the card's page,
--      the order that bought it and its tap analytics.
--   2. One page per card. The one-Tap-per-customer unique index is lifted; each
--      newly issued card gets its own page, created as an unpublished draft
--      (owner decision D-U4, observation O-12: nothing goes public until the
--      customer publishes it), linked through cards.tap_profile_id. Cards
--      issued before this migration keep opening the page they always opened,
--      so no printed card changes.
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
--
-- ORIGIN (DEC-2026-023): written for the live schema baseline
-- (supabase/baseline/000_live_baseline.sql) after M0.3's 020 and 021. It is NOT
-- applied to production by tooling, and it refuses to run while the live
-- constraints below make one page per card impossible (section -1).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- -1. PRECONDITIONS (fail closed, before anything changes)
-- ---------------------------------------------------------------------------
-- Two live-schema facts break this feature midway, after part of it would
-- already have been applied. Both are owner decisions, not something this
-- file may change on its own (DEC-2026-033):
--   * tap_profiles_customer_id_key: UNIQUE (customer_id) allows ONE page per
--     customer record, so a second card's page can never be inserted
--     (identity contract DEC-2026-029; page model).
--   * cards.card_id NOT NULL with no default (I-4, DEC-2026-024; card model
--     DEC-2026-028): every card insert that does not invent a legacy card_id
--     fails, so no card (and no page) is ever issued.
DO $$
DECLARE
  v_problems TEXT[] := '{}';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.tap_profiles'::regclass
               AND conname = 'tap_profiles_customer_id_key') THEN
    v_problems := v_problems || 'tap_profiles_customer_id_key (one page per customer record)'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'cards' AND column_name = 'card_id'
               AND is_nullable = 'NO' AND column_default IS NULL) THEN
    v_problems := v_problems || 'cards.card_id NOT NULL without a default (I-4)'::text;
  END IF;
  IF array_length(v_problems, 1) > 0 THEN
    RAISE EXCEPTION 'Migration 022 cannot run on this database: %. These need an owner decision first (DEC-2026-033). Nothing was changed.',
      array_to_string(v_problems, '; ');
  END IF;
END $$;


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
-- 3. PROVISIONING: A PAGE PER CARD, AS A DRAFT
-- ---------------------------------------------------------------------------
-- Creates a draft page for a customer. Drafts are never public: the customer
-- publishes the page themselves (owner decision D-U4; observation O-12 —
-- publishing on payment would put the account's name and email in front of
-- anonymous visitors without any action from the customer). The advisory
-- lock serialises every provisioning path for one customer (payment trigger,
-- card issue, fulfilment safety net) now that no unique index does it.
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
  v_slug     TEXT;
  v_name     TEXT;
  v_email    TEXT;
  v_tier     TEXT;
  v_id       UUID;
  v_customer UUID;
BEGIN
  -- DEC-2026-029 (B1, B2): the page belongs to the auth user (user_id); its
  -- customer_id is the customer RECORD, resolved here from the user and never
  -- taken from a caller. On live, customers.id is a random id created at
  -- sign-up, so writing the user id there fails the foreign key (I-1,
  -- DEC-2026-024). A database without a customers table (the repository's
  -- history chain) keys it on the user, as it always did.
  IF to_regclass('public.customers') IS NOT NULL THEN
    EXECUTE 'SELECT c.id FROM public.customers c WHERE c.user_id = $1' INTO v_customer USING p_user;
    IF v_customer IS NULL THEN
      RAISE EXCEPTION 'No customer record for this account, so no page can be created (DEC-2026-029).'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    v_customer := p_user;
  END IF;

  v_slug := public.generate_tap_slug(p_user);
  SELECT p.full_name, p.email INTO v_name, v_email FROM public.profiles p WHERE p.id = p_user;
  v_tier := public.canonical_experience(
    COALESCE(NULLIF(btrim(COALESCE(p_experience, '')), ''), public.user_max_ui_tier(p_user)));
  -- Same guard as live provision_tap_on_payment: anything else fails
  -- tap_profiles_experience_valid.
  IF v_tier IS NULL OR v_tier NOT IN ('essential', 'business', 'premium', 'goat') THEN
    v_tier := 'essential';
  END IF;

  INSERT INTO public.tap_profiles
    (user_id, customer_id, status, published, published_at, slug, username, display_name,
     email, selected_ui_tier, enabled_customizations, edit_window_started_at)
  VALUES (p_user, v_customer, 'draft', false, NULL, v_slug, v_slug, v_name,
          v_email, v_tier, ARRAY['phone', 'email'], p_started)
  RETURNING id INTO v_id;

  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (p_user, 'tap', 'Your new Tap page is ready',
          'A page for your card is waiting as a draft. Add your details and publish it when you are ready; nobody can see it until then.',
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
  v_tap  UUID := NEW.tap_profile_id;
  v_plan TEXT;
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

  v_plan := (SELECT COALESCE(o.plan_id, o.plan, 'essential') FROM public.orders o WHERE o.id = NEW.order_id);

  IF v_tap IS NULL THEN
    v_tap := public.provision_tap_page(NEW.user_id, NEW.created_at, v_plan);
  ELSE
    -- An existing page with no card yet takes the experience bought with this
    -- card, never a lower one (live raised the customer's page on payment).
    v_plan := public.canonical_experience(v_plan);
    IF v_plan IN ('business', 'premium', 'goat') THEN
      UPDATE public.tap_profiles t
      SET selected_ui_tier = v_plan
      WHERE t.id = v_tap AND public.tier_rank(v_plan) > public.tier_rank(t.selected_ui_tier);
    END IF;
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

-- Replaces the live version (and 004's). Differences: the page comes from
-- provision_tap_page() — a draft (D-U4) with a resolved customer_id
-- (DEC-2026-029) — and there is no `ON CONFLICT (user_id)`, which needed the
-- unique index this file drops. A customer who already has a page gets no new
-- one here; a card they buy gets its own page from cards_after_insert().
-- Kept from live: buying a higher experience as a digital upgrade raises the
-- customer's pages to it. (With a card, it goes to that card's page:
-- provision_tap_page / cards_after_insert.)
CREATE OR REPLACE FUNCTION public.provision_tap_on_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_experience TEXT;
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

  -- Live behaviour: a paid digital upgrade switches the customer's pages up
  -- to the experience it bought. Never down, and a paused page stays paused.
  v_experience := public.canonical_experience(COALESCE(NULLIF(NEW.plan_id, ''), 'essential'));
  IF COALESCE(NEW.order_type, 'physical') <> 'physical'
     AND v_experience IN ('business', 'premium', 'goat') THEN
    UPDATE public.tap_profiles
    SET selected_ui_tier = v_experience
    WHERE user_id = NEW.user_id
      AND public.tier_rank(v_experience) > public.tier_rank(selected_ui_tier);
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
    RAISE EXCEPTION 'These functions insert into tap_profiles with ON CONFLICT (user_id), which needs one page per customer: %. Update them before applying 022.', v_names;
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
