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
