-- 034: Modes v1 and Info. One active public experience per Tap (Business by
-- default, or Info: a public page about a physical object, place or service
-- point), chosen by the Tap's owner through /api/modes.
--
-- Decision:  DEC-2026-041 (revision 3, owner's conditional direction of
--            2026-10-20), implementation scope approved by the owner on
--            2026-10-24 ("Info mode (Recommended)": migration 034, /api/modes,
--            a new public reader, the 'unavailable' fallback, privacy canary
--            tests; title 120 / short description 280 and the category list
--            as proposed; production get_public_profile left untouched).
-- Level:     L3 (new tables, a catalogue seed, privileged functions, one new
--            anonymous reader). DEC-2026-018 cool-off plus checklist before any
--            real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-033. Not 027 (held aside, DEC-2026-037).
--
-- MODEL
--   tap_mode_catalog  the SHYGON-defined modes and their kill switch.
--                     'business' is on; 'info' is OFF in this seed.
--   info_pages        one Info record per account (v1): title, short
--                     description, category, detailed information. Plain
--                     text only: no image, no language, no links, no
--                     Business data (DEC-2026-041 SQ-3, SQ-4, CQ-2, BQ-3).
--   tap_mode_state    a Tap's active mode. No row means Business, so every
--                     existing Tap behaves exactly as before.
--   tap_mode_audit    who changed what and when: field NAMES only, never values.
--
-- RULES (supabase/tests/modes.mjs)
--   - All four tables are closed to every client role. /api/modes (owner) and
--     get_public_tap_mode (visitors) are the only ways in.
--   - Switching: the owner's own Tap, not suspended, the mode on in the
--     catalogue, Info complete (title and short description), the expected
--     version, an idempotency key. Switching to Business is always allowed.
--   - Fallback (BQ-2): Info switched off by SHYGON, missing or invalid gives
--     the neutral "unavailable" answer (null), never the Business profile.
--   - No 14-day window and no fixed quota on Info (Q0.6, RQ-1). An Info save
--     never touches tap_profiles.
--
-- BACKWARD COMPATIBILITY (BQ-1, readiness report §0.12)
--   get_public_profile is NOT changed. A Tap on Info would still return its
--   Business payload through that legacy reader, so 'info' is seeded OFF.
--   Do not set tap_mode_catalog.enabled = true for 'info' on any real database
--   until BQ-1's change to get_public_profile is approved and applied.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.info_pages');                       -- NULL
--   SELECT to_regprocedure('public.get_public_tap_mode(text)');    -- NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.get_public_tap_mode(text);
-- DROP FUNCTION IF EXISTS public.modes_preview(uuid, text);
-- DROP FUNCTION IF EXISTS public.modes_info_clear(uuid);
-- DROP FUNCTION IF EXISTS public.modes_info_save(uuid, jsonb, integer);
-- DROP FUNCTION IF EXISTS public.modes_info_get(uuid);
-- DROP FUNCTION IF EXISTS public.modes_owner_activate(uuid, text, integer, text);
-- DROP FUNCTION IF EXISTS public.modes_owner_state(uuid);
-- DROP FUNCTION IF EXISTS public.modes_info_public(public.info_pages);
-- DROP FUNCTION IF EXISTS public.modes_info_missing(public.info_pages);
-- DROP FUNCTION IF EXISTS public.modes_text_problem(text, integer, boolean);
-- DROP TABLE IF EXISTS public.tap_mode_audit;
-- DROP TABLE IF EXISTS public.tap_mode_state;
-- DROP TABLE IF EXISTS public.info_pages;
-- DROP TABLE IF EXISTS public.tap_mode_catalog;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.tap_mode_catalog (
  mode       text PRIMARY KEY CHECK (mode IN ('business', 'info')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.tap_mode_catalog (mode, enabled) VALUES ('business', true), ('info', false)
ON CONFLICT (mode) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.info_pages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  title                text CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 120),
  short_description    text CHECK (short_description IS NULL OR char_length(short_description) BETWEEN 1 AND 280),
  category             text CHECK (category IS NULL OR category IN ('place', 'product', 'equipment', 'exhibit', 'service_point', 'instructions')),
  detailed_information text CHECK (detailed_information IS NULL OR char_length(detailed_information) BETWEEN 1 AND 2000),
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tap_mode_state (
  tap_profile_id       uuid PRIMARY KEY REFERENCES public.tap_profiles(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  active_mode          text NOT NULL DEFAULT 'business' REFERENCES public.tap_mode_catalog(mode),
  previous_mode        text REFERENCES public.tap_mode_catalog(mode),
  version              integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  changed_at           timestamptz NOT NULL DEFAULT now(),
  last_idempotency_key text CHECK (last_idempotency_key IS NULL OR last_idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  last_result          jsonb
);
CREATE INDEX IF NOT EXISTS idx_tap_mode_state_user ON public.tap_mode_state (user_id);

CREATE TABLE IF NOT EXISTS public.tap_mode_audit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_profile_id uuid,
  action         text NOT NULL CHECK (action IN ('activate', 'info_save', 'info_clear')),
  from_mode      text,
  to_mode        text,
  fields         text[] NOT NULL DEFAULT '{}',
  actor          text NOT NULL DEFAULT 'owner' CHECK (actor IN ('owner', 'system')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tap_mode_audit_user ON public.tap_mode_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tap_mode_catalog', 'info_pages', 'tap_mode_state', 'tap_mode_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  -- The audit is append-only, even for the server role.
  REVOKE UPDATE, DELETE, TRUNCATE ON public.tap_mode_audit FROM service_role;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers

-- Why a value may not be stored, or NULL when it may. Plain text only: no
-- control characters (newlines only where multiline), nothing that looks
-- like markup, within the length limit. The value is already trimmed.
CREATE OR REPLACE FUNCTION public.modes_text_problem(p_value text, p_max integer, p_multiline boolean)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN char_length(p_value) > p_max THEN 'too_long'
    WHEN (CASE WHEN p_multiline THEN translate(p_value, E'\n', '') ELSE p_value END) ~ '[[:cntrl:]]' THEN 'control_characters'
    WHEN p_value ~ '<[[:space:]]*[A-Za-z/!?]' THEN 'markup'
    ELSE NULL
  END
$$;

-- The required fields an Info record still lacks (or holds in an invalid form).
CREATE OR REPLACE FUNCTION public.modes_info_missing(p_info public.info_pages)
RETURNS text[]
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN p_info.id IS NULL OR p_info.title IS NULL
           OR public.modes_text_problem(p_info.title, 120, false) IS NOT NULL THEN 'title' END,
    CASE WHEN p_info.id IS NULL OR p_info.short_description IS NULL
           OR public.modes_text_problem(p_info.short_description, 280, false) IS NOT NULL THEN 'shortDescription' END
  ], NULL)
$$;

-- What a visitor may see of an Info record: the allowlist, nothing else.
CREATE OR REPLACE FUNCTION public.modes_info_public(p_info public.info_pages)
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'title', p_info.title,
    'shortDescription', p_info.short_description,
    'category', p_info.category,
    'detailedInformation', p_info.detailed_information,
    'updatedAt', p_info.updated_at)
$$;

-- ---------------------------------------------------------------------------
-- Owner functions (service_role only; /api/modes passes the verified user)

CREATE OR REPLACE FUNCTION public.modes_owner_state(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_info public.info_pages;
  v_info_on boolean;
  v_missing text[];
  v_active text;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
  SELECT enabled INTO v_info_on FROM public.tap_mode_catalog WHERE mode = 'info';
  v_missing := public.modes_info_missing(v_info);
  v_active := COALESCE(v_state.active_mode, 'business');
  RETURN jsonb_build_object(
    'ok', true,
    'activeMode', v_active,
    'version', COALESCE(v_state.version, 0),
    'changedAt', v_state.changed_at,
    'modes', jsonb_build_array(
      jsonb_build_object('mode', 'business', 'available', true,
        'reason', CASE WHEN v_active = 'business' THEN 'active' ELSE 'ready' END),
      CASE
        WHEN NOT COALESCE(v_info_on, false) THEN
          jsonb_build_object('mode', 'info', 'available', false, 'reason', 'not_available')
        WHEN cardinality(v_missing) > 0 THEN
          jsonb_build_object('mode', 'info', 'available', false, 'reason', 'needs_setup', 'missing', to_jsonb(v_missing))
        ELSE
          jsonb_build_object('mode', 'info', 'available', true,
            'reason', CASE WHEN v_active = 'info' THEN 'active' ELSE 'ready' END)
      END));
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_owner_activate(p_user uuid, p_mode text, p_expected_version integer, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_info public.info_pages;
  v_enabled boolean;
  v_missing text[];
  v_result jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  INSERT INTO public.tap_mode_state (tap_profile_id, user_id) VALUES (v_tap.id, p_user)
  ON CONFLICT (tap_profile_id) DO NOTHING;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id FOR UPDATE;

  -- The same request again: the first answer, nothing changed.
  IF v_state.last_idempotency_key = p_idempotency_key AND v_state.last_result IS NOT NULL THEN
    RETURN v_state.last_result || jsonb_build_object('replayed', true);
  END IF;

  IF v_tap.suspended_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND suspended_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'tap_suspended');
  END IF;
  SELECT enabled INTO v_enabled FROM public.tap_mode_catalog WHERE mode = p_mode;
  IF NOT COALESCE(v_enabled, false) THEN RETURN jsonb_build_object('ok', false, 'code', 'mode_unavailable'); END IF;
  IF p_expected_version IS DISTINCT FROM v_state.version THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version', 'current',
      jsonb_build_object('activeMode', v_state.active_mode, 'version', v_state.version));
  END IF;
  IF p_mode = 'info' THEN
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
    v_missing := public.modes_info_missing(v_info);
    IF cardinality(v_missing) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'needs_setup', 'missing', to_jsonb(v_missing));
    END IF;
  END IF;

  IF p_mode <> v_state.active_mode THEN
    UPDATE public.tap_mode_state
       SET previous_mode = active_mode, active_mode = p_mode, version = version + 1, changed_at = now()
     WHERE tap_profile_id = v_tap.id
     RETURNING * INTO v_state;
    INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, from_mode, to_mode)
    VALUES (p_user, v_tap.id, 'activate', v_state.previous_mode, v_state.active_mode);
  END IF;
  v_result := jsonb_build_object('ok', true, 'activeMode', v_state.active_mode, 'previousMode', v_state.previous_mode,
    'version', v_state.version, 'changedAt', v_state.changed_at, 'replayed', false);
  UPDATE public.tap_mode_state SET last_idempotency_key = p_idempotency_key, last_result = v_result
   WHERE tap_profile_id = v_tap.id;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_info_get(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
  v_state public.tap_mode_state;
  v_on boolean;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'info';
  RETURN jsonb_build_object(
    'ok', true,
    'info', CASE WHEN v_info.id IS NULL THEN NULL
                 ELSE public.modes_info_public(v_info) || jsonb_build_object('version', v_info.version) END,
    'publicationStatus', CASE
      WHEN cardinality(public.modes_info_missing(v_info)) > 0 THEN 'draft'
      WHEN COALESCE(v_state.active_mode, 'business') <> 'info' THEN 'ready'
      WHEN NOT COALESCE(v_on, false) OR v_tap.status <> 'active' OR v_tap.suspended_at IS NOT NULL THEN 'unavailable'
      ELSE 'live' END);
END;
$$;

-- p_fields: any of { title, shortDescription, category, detailedInformation }.
-- A key that is present sets the field (null or empty clears it); a key that is
-- absent leaves it. p_expected_version is 0 before the first save.
CREATE OR REPLACE FUNCTION public.modes_info_save(p_user uuid, p_fields jsonb, p_expected_version integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
  v_state public.tap_mode_state;
  v_new public.info_pages;
  v_key text;
  v_val text;
  v_problem text;
  v_fields text[] := '{}';
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_request');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user FOR UPDATE;
  IF p_expected_version IS DISTINCT FROM COALESCE(v_info.version, 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_version', 'current', jsonb_build_object('version', COALESCE(v_info.version, 0)));
  END IF;

  v_new := v_info;
  FOR v_key IN SELECT jsonb_object_keys(p_fields) LOOP
    IF v_key NOT IN ('title', 'shortDescription', 'category', 'detailedInformation') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', 'unknown');
    END IF;
    IF jsonb_typeof(p_fields -> v_key) NOT IN ('string', 'null') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', 'not_text');
    END IF;
    v_val := NULLIF(btrim(replace(p_fields ->> v_key, E'\r\n', E'\n')), '');
    v_problem := CASE v_key
      WHEN 'title' THEN public.modes_text_problem(v_val, 120, false)
      WHEN 'shortDescription' THEN public.modes_text_problem(v_val, 280, false)
      WHEN 'detailedInformation' THEN public.modes_text_problem(v_val, 2000, true)
      WHEN 'category' THEN CASE WHEN v_val IS NULL OR v_val IN ('place', 'product', 'equipment', 'exhibit', 'service_point', 'instructions')
                                THEN NULL ELSE 'not_allowed' END
    END;
    IF v_problem IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_field', 'field', v_key, 'reason', v_problem);
    END IF;
    CASE v_key
      WHEN 'title' THEN v_new.title := v_val;
      WHEN 'shortDescription' THEN v_new.short_description := v_val;
      WHEN 'category' THEN v_new.category := v_val;
      WHEN 'detailedInformation' THEN v_new.detailed_information := v_val;
    END CASE;
    v_fields := v_fields || v_key;
  END LOOP;

  -- While Info is live it may not become incomplete (F-6): switch to Business first.
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  IF COALESCE(v_state.active_mode, 'business') = 'info' AND cardinality(public.modes_info_missing(v_new)) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'mode_active');
  END IF;

  IF v_info.id IS NULL THEN
    INSERT INTO public.info_pages (owner_user_id, title, short_description, category, detailed_information)
    VALUES (p_user, v_new.title, v_new.short_description, v_new.category, v_new.detailed_information)
    RETURNING * INTO v_new;
  ELSE
    UPDATE public.info_pages
       SET title = v_new.title, short_description = v_new.short_description, category = v_new.category,
           detailed_information = v_new.detailed_information, version = version + 1, updated_at = now()
     WHERE id = v_info.id
     RETURNING * INTO v_new;
  END IF;
  INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, fields) VALUES (p_user, v_tap.id, 'info_save', v_fields);
  RETURN public.modes_info_get(p_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.modes_info_clear(p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_state public.tap_mode_state;
  v_cleared boolean;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  IF COALESCE(v_state.active_mode, 'business') = 'info' THEN RETURN jsonb_build_object('ok', false, 'code', 'mode_active'); END IF;
  DELETE FROM public.info_pages WHERE owner_user_id = p_user;
  v_cleared := FOUND;
  IF v_cleared THEN
    INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action) VALUES (p_user, v_tap.id, 'info_clear');
  END IF;
  RETURN jsonb_build_object('ok', true, 'cleared', v_cleared);
END;
$$;

-- Exactly what a visitor would get for that mode on the owner's own Tap.
CREATE OR REPLACE FUNCTION public.modes_preview(p_user uuid, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_info public.info_pages;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  IF p_mode = 'business' THEN
    RETURN jsonb_build_object('ok', true, 'mode', 'business', 'view',
      CASE WHEN v_tap.slug IS NULL THEN NULL ELSE public.get_public_profile(v_tap.slug) END);
  ELSIF p_mode = 'info' THEN
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
    RETURN jsonb_build_object('ok', true, 'mode', 'info', 'view',
      CASE WHEN cardinality(public.modes_info_missing(v_info)) > 0 THEN NULL ELSE public.modes_info_public(v_info) END);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'invalid_mode');
END;
$$;

-- ---------------------------------------------------------------------------
-- The public reader (visitors; anon). One answer per Tap address:
--   { mode: 'business', profile: <get_public_profile payload> }
--   { mode: 'info', info: <allowlisted Info fields> }
--   null: no live Tap, or the neutral "unavailable" (Info switched off,
--         missing or invalid). Never the Business profile as a fallback.
CREATE OR REPLACE FUNCTION public.get_public_tap_mode(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_tap public.tap_profiles;
  v_mode text;
  v_on boolean;
  v_info public.info_pages;
  v_profile jsonb;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles t
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, ''))) AND t.status = 'active' AND t.suspended_at IS NULL
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  v_mode := COALESCE(v_mode, 'business');
  IF v_mode = 'business' THEN
    v_profile := public.get_public_profile(v_tap.slug);
    RETURN CASE WHEN v_profile IS NULL THEN NULL ELSE jsonb_build_object('mode', 'business', 'profile', v_profile) END;
  END IF;
  IF v_mode = 'info' THEN
    SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'info';
    IF NOT COALESCE(v_on, false) THEN RETURN NULL; END IF;
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = v_tap.user_id;
    IF cardinality(public.modes_info_missing(v_info)) > 0
       OR public.modes_text_problem(v_info.detailed_information, 2000, true) IS NOT NULL THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('mode', 'info', 'info', public.modes_info_public(v_info));
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.modes_text_problem(text, integer, boolean)',
    'public.modes_info_missing(public.info_pages)',
    'public.modes_info_public(public.info_pages)',
    'public.modes_owner_state(uuid)',
    'public.modes_owner_activate(uuid, text, integer, text)',
    'public.modes_info_get(uuid)',
    'public.modes_info_save(uuid, jsonb, integer)',
    'public.modes_info_clear(uuid)',
    'public.modes_preview(uuid, text)',
    'public.get_public_tap_mode(text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  -- The public reader, and only it, is open to visitors.
  GRANT EXECUTE ON FUNCTION public.get_public_tap_mode(text) TO anon, authenticated;
END $$;
