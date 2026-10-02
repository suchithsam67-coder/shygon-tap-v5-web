-- 027: contact buttons by tier, card details before checkout
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
--    and 022).
-- 3. orders.profile_details: what the customer typed on the Card details page
--    (name on card, title, contact buttons). The server copies it into the
--    new page when the order is paid. No payment data, ever.
--
-- Idempotent. Rollback: re-run 009's get_public_profile, 013's get_public_tap
-- and 022's enforce_tap_edit_rules; DROP FUNCTION public.tier_buttons(TEXT);
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

  -- 027: a button is allowed when the page's tier includes it OR it was bought.
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

  -- 027: the page's own tier includes its buttons; add-ons add more.
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
  -- 027: the page's tier includes its buttons.
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

-- 022's reserved names plus the new /shygontap/card-details screen.
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
