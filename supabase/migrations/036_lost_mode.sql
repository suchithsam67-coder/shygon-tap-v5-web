-- 036: Lost mode (U2). A Tap whose owner has lost the card shows only "Found
-- this card?" and the existing Return to Owner message form (031): nothing of
-- Business or Info, no owner detail, no new public field.
--
-- Decision:  DEC-2026-041 amendment A-1. The owner approved U2 on 2026-10-25
--            (coordination session, relayed with the owner's words): "Approved:
--            U2 = Lost mode (option L1) now, for adults' own cards, reusing
--            Return to Owner, off until release. Keep Return to Owner on the
--            Business page too. Defer Guardian until visitor alerts are
--            reconsidered."
-- Level:     L3 (a catalogue row, privileged functions, one public reader).
--            DEC-2026-018 cool-off plus checklist before any real database.
--            Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-035. Needs 031 (Return to Owner) and 034 (modes).
--
-- CHANGE
--   - tap_mode_catalog: a 'lost' row, OFF (enabled = false), like Info. Its
--     CHECK widens to ('business', 'info', 'lost').
--   - modes_owner_state lists Lost: not_available while SHYGON has it off;
--     needs_setup ['returnToOwner'] until the owner's own Return to Owner
--     opt-in is on; ready / active.
--   - modes_owner_activate: switching to Lost needs that opt-in. It never turns
--     it on: the opt-in on the Business page stays exactly as it is (031).
--   - modes_preview 'lost': {} while Return to Owner can take a message, else null.
--   - get_public_tap_mode: { mode: 'lost' } and nothing else, while Lost is on
--     in the catalogue and rescue_public_target(slug) answers (opt-in on, Tap
--     published, account not suspended); otherwise null, never Business.
--   - get_public_profile is unchanged: 035's guard already answers null for
--     every mode other than Business, Lost included.
--   - The host switch RESCUE_RELAY (off until release) is checked by
--     /api/modes and /api/rescue; the database cannot see it.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.tap_mode_state'), to_regclass('public.rescue_settings');  -- both NOT NULL
--   SELECT mode, enabled FROM public.tap_mode_catalog ORDER BY mode;  -- business true, info false; no lost yet
--
-- ROLLBACK (begin)
-- UPDATE public.tap_mode_state SET active_mode = 'business', version = version + 1, changed_at = now() WHERE active_mode = 'lost';
-- UPDATE public.tap_mode_state SET previous_mode = NULL WHERE previous_mode = 'lost';
-- DELETE FROM public.tap_mode_catalog WHERE mode = 'lost';
-- ALTER TABLE public.tap_mode_catalog DROP CONSTRAINT IF EXISTS tap_mode_catalog_mode_check;
-- ALTER TABLE public.tap_mode_catalog ADD CONSTRAINT tap_mode_catalog_mode_check CHECK (mode IN ('business', 'info'));
--
-- CREATE OR REPLACE FUNCTION public.modes_owner_state(p_user uuid)
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_tap public.tap_profiles;
--   v_state public.tap_mode_state;
--   v_info public.info_pages;
--   v_info_on boolean;
--   v_missing text[];
--   v_active text;
-- BEGIN
--   SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
--   SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
--   SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
--   SELECT enabled INTO v_info_on FROM public.tap_mode_catalog WHERE mode = 'info';
--   v_missing := public.modes_info_missing(v_info);
--   v_active := COALESCE(v_state.active_mode, 'business');
--   RETURN jsonb_build_object(
--     'ok', true,
--     'activeMode', v_active,
--     'version', COALESCE(v_state.version, 0),
--     'changedAt', v_state.changed_at,
--     'modes', jsonb_build_array(
--       jsonb_build_object('mode', 'business', 'available', true,
--         'reason', CASE WHEN v_active = 'business' THEN 'active' ELSE 'ready' END),
--       CASE
--         WHEN NOT COALESCE(v_info_on, false) THEN
--           jsonb_build_object('mode', 'info', 'available', false, 'reason', 'not_available')
--         WHEN cardinality(v_missing) > 0 THEN
--           jsonb_build_object('mode', 'info', 'available', false, 'reason', 'needs_setup', 'missing', to_jsonb(v_missing))
--         ELSE
--           jsonb_build_object('mode', 'info', 'available', true,
--             'reason', CASE WHEN v_active = 'info' THEN 'active' ELSE 'ready' END)
--       END));
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.modes_owner_activate(p_user uuid, p_mode text, p_expected_version integer, p_idempotency_key text)
-- RETURNS jsonb
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_tap public.tap_profiles;
--   v_state public.tap_mode_state;
--   v_info public.info_pages;
--   v_enabled boolean;
--   v_missing text[];
--   v_result jsonb;
-- BEGIN
--   IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
--   END IF;
--   SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1 FOR UPDATE;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
--   INSERT INTO public.tap_mode_state (tap_profile_id, user_id) VALUES (v_tap.id, p_user)
--   ON CONFLICT (tap_profile_id) DO NOTHING;
--   SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id FOR UPDATE;
--
--   -- The same request again: the first answer, nothing changed.
--   IF v_state.last_idempotency_key = p_idempotency_key AND v_state.last_result IS NOT NULL THEN
--     RETURN v_state.last_result || jsonb_build_object('replayed', true);
--   END IF;
--
--   IF v_tap.suspended_at IS NOT NULL
--      OR EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user AND suspended_at IS NOT NULL) THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'tap_suspended');
--   END IF;
--   SELECT enabled INTO v_enabled FROM public.tap_mode_catalog WHERE mode = p_mode;
--   IF NOT COALESCE(v_enabled, false) THEN RETURN jsonb_build_object('ok', false, 'code', 'mode_unavailable'); END IF;
--   IF p_expected_version IS DISTINCT FROM v_state.version THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'stale_version', 'current',
--       jsonb_build_object('activeMode', v_state.active_mode, 'version', v_state.version));
--   END IF;
--   IF p_mode = 'info' THEN
--     -- Lock order, the same in every writer: Tap, then mode state, then Info
--     -- record. A save racing this activation waits, so Info never goes live
--     -- incomplete (F-6; OpenCode review 2026-10-25 #4).
--     SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user FOR UPDATE;
--     v_missing := public.modes_info_missing(v_info);
--     IF cardinality(v_missing) > 0 THEN
--       RETURN jsonb_build_object('ok', false, 'code', 'needs_setup', 'missing', to_jsonb(v_missing));
--     END IF;
--   END IF;
--
--   IF p_mode <> v_state.active_mode THEN
--     UPDATE public.tap_mode_state
--        SET previous_mode = active_mode, active_mode = p_mode, version = version + 1, changed_at = now()
--      WHERE tap_profile_id = v_tap.id
--      RETURNING * INTO v_state;
--     INSERT INTO public.tap_mode_audit (user_id, tap_profile_id, action, from_mode, to_mode)
--     VALUES (p_user, v_tap.id, 'activate', v_state.previous_mode, v_state.active_mode);
--   END IF;
--   v_result := jsonb_build_object('ok', true, 'activeMode', v_state.active_mode, 'previousMode', v_state.previous_mode,
--     'version', v_state.version, 'changedAt', v_state.changed_at, 'replayed', false);
--   UPDATE public.tap_mode_state SET last_idempotency_key = p_idempotency_key, last_result = v_result
--    WHERE tap_profile_id = v_tap.id;
--   RETURN v_result;
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.modes_preview(p_user uuid, p_mode text)
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_tap public.tap_profiles;
--   v_info public.info_pages;
-- BEGIN
--   SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
--   IF p_mode = 'business' THEN
--     RETURN jsonb_build_object('ok', true, 'mode', 'business', 'view',
--       CASE WHEN v_tap.slug IS NULL THEN NULL ELSE public.get_public_profile(v_tap.slug) END);
--   ELSIF p_mode = 'info' THEN
--     SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
--     RETURN jsonb_build_object('ok', true, 'mode', 'info', 'view',
--       CASE WHEN cardinality(public.modes_info_missing(v_info)) > 0 THEN NULL ELSE public.modes_info_public(v_info) END);
--   END IF;
--   RETURN jsonb_build_object('ok', false, 'code', 'invalid_mode');
-- END;
-- $$;
--
-- CREATE OR REPLACE FUNCTION public.get_public_tap_mode(p_slug text)
-- RETURNS jsonb
-- LANGUAGE plpgsql STABLE SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_tap public.tap_profiles;
--   v_mode text;
--   v_on boolean;
--   v_info public.info_pages;
--   v_profile jsonb;
-- BEGIN
--   SELECT * INTO v_tap FROM public.tap_profiles t
--    WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, ''))) AND t.status = 'active' AND t.suspended_at IS NULL
--    LIMIT 1;
--   IF NOT FOUND THEN RETURN NULL; END IF;
--   SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
--   v_mode := COALESCE(v_mode, 'business');
--   IF v_mode = 'business' THEN
--     v_profile := public.get_public_profile(v_tap.slug);
--     RETURN CASE WHEN v_profile IS NULL THEN NULL ELSE jsonb_build_object('mode', 'business', 'profile', v_profile) END;
--   END IF;
--   IF v_mode = 'info' THEN
--     SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'info';
--     IF NOT COALESCE(v_on, false) THEN RETURN NULL; END IF;
--     SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = v_tap.user_id;
--     IF cardinality(public.modes_info_missing(v_info)) > 0 THEN
--       RETURN NULL;
--     END IF;
--     RETURN jsonb_build_object('mode', 'info', 'info', public.modes_info_public(v_info));
--   END IF;
--   RETURN NULL;
-- END;
-- $$;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

DO $needs$
BEGIN
  IF to_regclass('public.tap_mode_state') IS NULL OR to_regclass('public.rescue_settings') IS NULL THEN
    RAISE EXCEPTION '036: needs migrations 031 and 034; nothing changed';
  END IF;
END
$needs$;

ALTER TABLE public.tap_mode_catalog DROP CONSTRAINT IF EXISTS tap_mode_catalog_mode_check;
ALTER TABLE public.tap_mode_catalog ADD CONSTRAINT tap_mode_catalog_mode_check CHECK (mode IN ('business', 'info', 'lost'));
INSERT INTO public.tap_mode_catalog (mode, enabled) VALUES ('lost', false) ON CONFLICT (mode) DO NOTHING;

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
  v_lost_on boolean;
  v_return_to_owner boolean;
BEGIN
  SELECT * INTO v_tap FROM public.tap_profiles WHERE user_id = p_user ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_tap'); END IF;
  SELECT * INTO v_state FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user;
  SELECT enabled INTO v_info_on FROM public.tap_mode_catalog WHERE mode = 'info';
  SELECT enabled INTO v_lost_on FROM public.tap_mode_catalog WHERE mode = 'lost';
  v_return_to_owner := EXISTS (SELECT 1 FROM public.rescue_settings r WHERE r.user_id = p_user AND r.enabled);
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
      END,
      -- Lost (036): needs the owner's own Return to Owner opt-in.
      CASE
        WHEN NOT COALESCE(v_lost_on, false) THEN
          jsonb_build_object('mode', 'lost', 'available', false, 'reason', 'not_available')
        WHEN NOT v_return_to_owner THEN
          jsonb_build_object('mode', 'lost', 'available', false, 'reason', 'needs_setup', 'missing', jsonb_build_array('returnToOwner'))
        ELSE
          jsonb_build_object('mode', 'lost', 'available', true,
            'reason', CASE WHEN v_active = 'lost' THEN 'active' ELSE 'ready' END)
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
    -- Lock order, the same in every writer: Tap, then mode state, then Info
    -- record. A save racing this activation waits, so Info never goes live
    -- incomplete (F-6; OpenCode review 2026-10-25 #4).
    SELECT * INTO v_info FROM public.info_pages WHERE owner_user_id = p_user FOR UPDATE;
    v_missing := public.modes_info_missing(v_info);
    IF cardinality(v_missing) > 0 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'needs_setup', 'missing', to_jsonb(v_missing));
    END IF;
  END IF;
  -- Lost (036) reuses Return to Owner (031): the owner's own opt-in must be on.
  -- Switching to Lost never turns it on (DEC-2026-041 amendment A-1).
  IF p_mode = 'lost' AND NOT EXISTS (SELECT 1 FROM public.rescue_settings r WHERE r.user_id = p_user AND r.enabled) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'needs_setup', 'missing', jsonb_build_array('returnToOwner'));
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
  ELSIF p_mode = 'lost' THEN
    -- The "Found this card?" page carries no data at all; nothing while Return
    -- to Owner cannot take a message for this Tap.
    RETURN jsonb_build_object('ok', true, 'mode', 'lost', 'view',
      CASE WHEN v_tap.slug IS NOT NULL AND public.rescue_public_target(v_tap.slug) IS NOT NULL
           THEN '{}'::jsonb ELSE NULL END);
  END IF;
  RETURN jsonb_build_object('ok', false, 'code', 'invalid_mode');
END;
$$;

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
    IF cardinality(public.modes_info_missing(v_info)) > 0 THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('mode', 'info', 'info', public.modes_info_public(v_info));
  END IF;
  IF v_mode = 'lost' THEN
    -- Lost (036): no Business or Info field, no owner detail, no new public
    -- field. Only while SHYGON has Lost on and Return to Owner can take a
    -- message for this Tap (the owner opted in, the Tap is published, the
    -- account is not suspended); otherwise the neutral null.
    SELECT enabled INTO v_on FROM public.tap_mode_catalog WHERE mode = 'lost';
    IF NOT COALESCE(v_on, false) OR public.rescue_public_target(v_tap.slug) IS NULL THEN
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('mode', 'lost');
  END IF;
  RETURN NULL;
END;
$$;
