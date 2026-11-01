-- 035: get_public_profile respects the Tap's active mode (BQ-1).
--
-- Decision:  DEC-2026-041 BQ-1. The owner approved building it on 2026-10-24
--            ("BQ-1 fix (Recommended)": the old public profile reader returns
--            nothing while a Tap is on Info; shape unchanged; every other Tap
--            byte-identical; written against the repo baseline, production's
--            drifted copy still waits for the rebaseline, V6-106).
-- Level:     L3 (a frozen public function's body). DEC-2026-018 cool-off plus
--            checklist before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-034. Needs 034 (tap_mode_state).
--
-- CHANGE (one guard, nothing else; admin-contract APPROVED_BODY_CHANGES pins it)
--   After the Tap lookup, get_public_profile returns NULL while the Tap's
--   active mode is not 'business'. A Tap with no mode state, or on Business,
--   gets the byte-identical payload (supabase/tests/golden-public-tap.mjs).
--   Same signature, return type, security, search_path and grants.
--
-- EFFECT
--   - Business is never public through the legacy reader while Info is shown,
--     and never as a fallback (BQ-2), so Info may be switched on in
--     tap_mode_catalog once this migration is applied. That switch stays a
--     per-environment owner decision.
--   - An older client (it calls only get_public_profile) shows its existing
--     "Tap not found" page for a Tap on Info: get_public_profile is NULL and
--     get_public_tap_state still answers 'active' (readiness report §0.12).
--   - owner.preview for Business also answers null while the Tap is on Info.
--
-- PRODUCTION (BLOCKED, V6-106 / G2): production's get_public_profile has
--   drifted from the baseline (pageTemplate, tier_buttons, tap_card_features).
--   Applying this file there would replace that body with the baseline one.
--   Re-base it on the fresh production capture first.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.get_public_profile(text)'::regprocedure;
--     -- must equal the baseline body hash acbaff4f0fb3014a0a080cbf15267cd9
--     -- (production's differs today: STOP and re-base, see PRODUCTION)
--   SELECT to_regclass('public.tap_mode_state');   -- NOT NULL (034 applied)
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO 'public', 'pg_temp'
-- AS $function$
-- DECLARE
--   v_tap         public.tap_profiles%ROWTYPE;
--   v_tier        TEXT;
--   v_pass        BOOLEAN;
--   v_owned       TEXT[];
--   v_shown       TEXT[];
--   v_clamp       TEXT;
--   v_event       JSONB;
--   v_event_theme JSONB;
--   v_base        JSONB;
--   v_eff         JSONB;
-- BEGIN
--   SELECT * INTO v_tap
--   FROM public.tap_profiles t
--   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
--     AND t.status = 'active'
--     AND t.suspended_at IS NULL
--   LIMIT 1;
--   IF NOT FOUND THEN RETURN NULL; END IF;
--
--   v_tier := public.user_max_ui_tier(v_tap.user_id);
--   v_pass := public.user_has_pass(v_tap.user_id);
--
--   SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
--   FROM public.entitlements e
--   WHERE e.user_id = v_tap.user_id AND e.is_active AND e.type = 'customization';
--
--   v_shown := ARRAY(
--     SELECT unnest(v_tap.enabled_customizations)
--     INTERSECT
--     SELECT unnest(v_owned || ARRAY['phone','email'])
--   );
--
--   v_clamp := CASE
--     WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
--       THEN public.canonical_experience(v_tap.selected_ui_tier)
--     ELSE v_tier
--   END;
--
--   v_base := jsonb_build_object(
--     'palette', CASE WHEN v_tap.theme_palette = ANY(public.theme_options('palette', v_clamp, v_pass)) THEN v_tap.theme_palette ELSE 'midnight' END,
--     'layout', CASE WHEN v_tap.theme_layout = ANY(public.theme_options('layout', v_clamp, v_pass)) THEN v_tap.theme_layout ELSE 'classic' END,
--     'buttons', CASE WHEN v_tap.theme_buttons = ANY(public.theme_options('buttons', v_clamp, v_pass)) THEN v_tap.theme_buttons ELSE 'solid' END,
--     'font', CASE WHEN v_tap.theme_font = ANY(public.theme_options('font', v_clamp, v_pass)) THEN v_tap.theme_font ELSE 'sans' END,
--     'animation', CASE WHEN v_tap.theme_animation = ANY(public.theme_options('animation', v_clamp, v_pass)) THEN v_tap.theme_animation ELSE 'auto' END
--   );
--
--   v_event := public.tap_event_theme_for(now());
--   v_event_theme := COALESCE(v_event->'theme', '{}'::jsonb);
--
--   v_eff := jsonb_build_object(
--     'palette', COALESCE(NULLIF(v_event_theme->>'palette',''), v_base->>'palette'),
--     'layout', COALESCE(NULLIF(v_event_theme->>'layout',''), v_base->>'layout'),
--     'buttons', COALESCE(NULLIF(v_event_theme->>'buttons',''), v_base->>'buttons'),
--     'font', COALESCE(NULLIF(v_event_theme->>'font',''), v_base->>'font'),
--     'animation', COALESCE(NULLIF(v_event_theme->>'animation',''), v_base->>'animation')
--   );
--
--   RETURN jsonb_build_object(
--     'slug', v_tap.slug,
--     'experience', v_clamp,
--     'displayName', v_tap.display_name,
--     'headline', v_tap.headline,
--     'designation', v_tap.designation,
--     'company', v_tap.company,
--     'bio', v_tap.bio,
--     'avatarUrl', v_tap.avatar_url,
--     'location', CASE WHEN 'location' = ANY(v_shown) THEN v_tap.location END,
--     'phone', CASE WHEN 'phone' = ANY(v_shown) THEN v_tap.phone END,
--     'whatsapp', CASE WHEN 'whatsapp' = ANY(v_shown) THEN v_tap.whatsapp END,
--     'email', CASE WHEN 'email' = ANY(v_shown) THEN v_tap.email END,
--     'website', CASE WHEN 'website' = ANY(v_shown) THEN v_tap.website END,
--     'instagram', CASE WHEN 'instagram' = ANY(v_shown) THEN v_tap.instagram END,
--     'linkedin', CASE WHEN 'linkedin' = ANY(v_shown) THEN v_tap.linkedin END,
--     'youtube', CASE WHEN 'youtube' = ANY(v_shown) THEN v_tap.youtube END,
--     'customLinks', CASE WHEN 'links' = ANY(v_shown) THEN v_tap.custom_links ELSE '[]'::jsonb END,
--     'theme', v_eff,
--     'baseTheme', v_base,
--     'activeEvent', NULLIF(v_event, '{}'::jsonb)
--   );
-- END;
-- $function$;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

-- Refuse to run without 034. plpgsql resolves tap_mode_state only when the
-- function first runs, so without this check 035 would install a reader that
-- fails for every slug (OpenCode review 2026-10-25 #7).
DO $needs_034$
BEGIN
  IF to_regclass('public.tap_mode_state') IS NULL THEN
    RAISE EXCEPTION '035: needs migration 034 (public.tap_mode_state); nothing changed';
  END IF;
END
$needs_034$;

CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  -- BQ-1 (migration 035, DEC-2026-041): while the Tap shows another mode
  -- (Info), its Business profile is not public through this reader either.
  IF EXISTS (SELECT 1 FROM public.tap_mode_state s
             WHERE s.tap_profile_id = v_tap.id AND s.active_mode <> 'business') THEN
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
$function$;
