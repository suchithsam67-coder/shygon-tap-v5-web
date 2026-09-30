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
