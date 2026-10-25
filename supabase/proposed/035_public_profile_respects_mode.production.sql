-- =============================================================================
-- 035 (production variant): get_public_profile respects the Tap's active mode
-- (BQ-1), re-based on PRODUCTION's body instead of the repository baseline
-- =============================================================================
--
-- STATUS: PROPOSED. Lives in supabase/proposed/, not supabase/migrations/, so
-- `npm run db:push` and APPLY_ALL.sql cannot run it. It changes a frozen public
-- production function, so it needs the owner's approval and the DEC-2026-018
-- cool-off and checklist (L3). Nothing here was run against production.
--
-- WHY A PRODUCTION VARIANT (V6-106)
--   migrations/035 adds the BQ-1 guard to the 2026-09-30 baseline body
--   (md5 acbaff4f0fb3014a0a080cbf15267cd9). Production has changed that body
--   since: it returns a 'pageTemplate' key, shows the page tier's own buttons
--   (public.tier_buttons) and carries two comments. Applied to production,
--   migrations/035 would silently remove all of that. This file adds the same
--   one guard to production's body and keeps everything else.
--
-- EVIDENCE (read docs/governance/evidence/; labels as in DEC-2026-041)
--   - INFERRED from OBSERVED evidence, NOT a fresh capture: the production body
--     below was rebuilt in isolated PGlite from the owner's read-only export of
--     production's supabase_migrations.schema_migrations, 2026-10-18 (sha256
--     a9fd38c7791c54e253413a7f366efc6f9b15451b245d96ed85e11236d2a87bce),
--     replayed in order on the 2026-09-30 baseline (sha256
--     c12b46eba81e1102f568339f10e6892c3d000282c8cefda7caf8fd9a99a50655).
--   - OBSERVED 2026-10-18 (owner, VERIFY-LIVE-DRIFT.sql): that replay matched
--     production's public schema, all seven changed function bodies equal by
--     hash with carriage returns removed.
--   - Production may have changed since 2026-10-18. The PRE-CHECK below and the
--     VERIFY ON LIVE queries are what make that safe: on any other body this
--     file refuses to run.
--
-- CHANGE (one guard, nothing else; supabase/tests/bq1-production.mjs pins it)
--   After the Tap lookup, get_public_profile returns NULL while the Tap's
--   active mode is not 'business' (tap_mode_state, migration 034). Regardless
--   of the catalogue kill switch: the guard reads the Tap's state only. A Tap
--   with no mode state, or on Business, gets production's byte-identical
--   payload, 'pageTemplate' included. Same signature (p_slug text) -> jsonb,
--   plpgsql STABLE SECURITY DEFINER, search_path public, pg_temp, owner
--   postgres. No GRANT or REVOKE: CREATE OR REPLACE keeps the function's
--   privileges (captured: postgres:EXECUTE, anon:EXECUTE, service_role:EXECUTE).
--
-- HASHES (md5 of pg_proc.prosrc with carriage returns removed, the convention
-- the 2026-10-18 comparison used; whether the live body stores CRs is not known)
--   captured production body  4a70098823695f40395d7c32439ffc98
--   after this file           d267acb378c604576f950c3da651faa1
--
-- PRE-CHECK (inside the transaction below; any failure aborts with nothing changed)
--   the body is the captured production one (or already this file's: a re-run);
--   every attribute CREATE OR REPLACE would otherwise silently reset is as
--   captured: a plpgsql function, STABLE, SECURITY DEFINER, search_path
--   public, pg_temp, owner postgres; the EXECUTE grants are exactly
--   anon:EXECUTE, postgres:EXECUTE, service_role:EXECUTE (CREATE OR REPLACE keeps grants, so a drifted grant set
--   would otherwise survive unseen); and public.tap_mode_state exists (034
--   applied first). OpenCode review OC-2b, 2026-10-25: P-1, P-2.
--
-- VERIFY ON LIVE before applying (read-only, human; STOP on any difference):
--   SELECT md5(replace(p.prosrc, chr(13), '')) AS body_md5,
--          pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig,
--          p.provolatile, pg_get_function_arguments(p.oid) AS args,
--          pg_get_function_result(p.oid) AS result, p.proacl
--   FROM pg_proc p WHERE p.oid = 'public.get_public_profile(text)'::regprocedure;
--     -- body_md5 4a70098823695f40395d7c32439ffc98; owner postgres; prosecdef true;
--     -- proconfig {"search_path=public, pg_temp"}; provolatile s;
--     -- args p_slug text; result jsonb; proacl EXECUTE for postgres:EXECUTE, anon:EXECUTE, service_role:EXECUTE
--     -- (record proacl as returned: the fresh capture is the reference)
--   SELECT to_regclass('public.tap_mode_state');            -- NOT NULL (034)
--   SELECT mode, enabled FROM public.tap_mode_catalog;       -- info false until the owner decides
-- VERIFY AFTER: the same first query gives body_md5 d267acb378c604576f950c3da651faa1 and the same
--   owner, prosecdef, proconfig, provolatile, args, result and proacl.
--
-- ADOPTION: after the fresh capture (V6-106) confirms the hash above, this body
--   becomes migrations/035 in the chain re-based on the new baseline, and the
--   baseline-derived 035 is retired with the old baseline. Never through db:push.
--
-- ROLLBACK: guarded like the forward direction (OC-2b P-3). It runs only when
-- the body is this file's (or already the captured one), and restores the
-- captured definition. It touches no grant: the pre-check pinned them, and
-- neither direction changes them.
-- ROLLBACK (begin)
-- BEGIN;
-- DO $rollback_check$
-- BEGIN
--   IF (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
--       WHERE p.oid = to_regprocedure('public.get_public_profile(text)'))
--      NOT IN ('d267acb378c604576f950c3da651faa1', '4a70098823695f40395d7c32439ffc98') THEN
--     RAISE EXCEPTION '035 (production) rollback: get_public_profile is neither this file''s body nor the captured one; stop';
--   END IF;
-- END
-- $rollback_check$;
--
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
--   v_clamp := CASE
--     WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
--       THEN public.canonical_experience(v_tap.selected_ui_tier)
--     ELSE v_tier
--   END;
--
--   -- 024: the page's own tier includes its buttons; add-ons add more.
--   v_shown := ARRAY(
--     SELECT unnest(v_tap.enabled_customizations)
--     INTERSECT
--     SELECT unnest(v_owned || public.tier_buttons(v_clamp))
--   );
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
--   -- Event styling is platform-controlled and applies globally while active.
--   -- It is not a customer entitlement and must therefore not be filtered through
--   -- theme_options(). The customer's saved theme remains in baseTheme.
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
--     'pageTemplate', v_tap.page_template,
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
-- COMMIT;
-- ROLLBACK (end)
-- VERIFY AFTER ROLLBACK: body_md5 4a70098823695f40395d7c32439ffc98 and every other field as captured.
--
-- Idempotent: safe to run more than once.

BEGIN;

DO $precheck$
DECLARE
  v_md5 text;
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_volatile "char";
  v_kind "char";
  v_language text;
  v_grants text[];
BEGIN
  SELECT md5(replace(p.prosrc, chr(13), '')), pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig,
         p.provolatile, p.prokind, l.lanname,
         (SELECT array_agg(g.entry ORDER BY g.entry COLLATE "C")
            FROM (SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                         || ':' || a.privilege_type AS entry
                    FROM aclexplode(p.proacl) a) g)
    INTO v_md5, v_owner, v_definer, v_config, v_volatile, v_kind, v_language, v_grants
  FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = to_regprocedure('public.get_public_profile(text)');
  IF v_md5 IS NULL OR v_md5 NOT IN ('4a70098823695f40395d7c32439ffc98', 'd267acb378c604576f950c3da651faa1') THEN
    RAISE EXCEPTION '035 (production): get_public_profile is not the captured production body (md5 %); stop and re-capture (V6-106)', v_md5;
  END IF;
  IF v_owner <> 'postgres' OR NOT v_definer OR v_config IS DISTINCT FROM ARRAY['search_path=public, pg_temp']
     OR v_volatile <> 's' OR v_kind <> 'f' OR v_language <> 'plpgsql' THEN
    RAISE EXCEPTION '035 (production): get_public_profile attributes differ from the capture (owner %, definer %, config %, volatility %, kind %, language %)',
      v_owner, v_definer, v_config, v_volatile, v_kind, v_language;
  END IF;
  IF v_grants IS DISTINCT FROM ARRAY['anon:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE'] THEN
    RAISE EXCEPTION '035 (production): get_public_profile EXECUTE grants differ from the capture (%); stop and re-capture', v_grants;
  END IF;
  IF to_regclass('public.tap_mode_state') IS NULL THEN
    RAISE EXCEPTION '035 (production): needs migration 034 (public.tap_mode_state)';
  END IF;
END
$precheck$;

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
    'pageTemplate', v_tap.page_template,
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

COMMIT;
