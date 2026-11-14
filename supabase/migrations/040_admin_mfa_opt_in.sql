-- 040: administrator multi-factor authentication, step 2 of DEC-2026-046
-- option A (V01 task T-12): the OPT-IN rule. An administrator who has a verified
-- second factor (Supabase Auth TOTP) must use a session that has it (aal2) for
-- every admin function, policy and the live feed. An administrator without a
-- factor is unaffected until SHYGON flips the mandatory switch (step 3), which
-- ships OFF. Nobody is locked out by this migration.
--
-- Decision:  DEC-2026-046, option A approved and step 2 approved for the LOCAL
--            BUILD by the owner in session on 2026-11-10 ("Approve T-12 option
--            A"; Q1-Q5 as recommended). Step 1 (the admin app's screens), the
--            two admin edge functions (Codex, after V6-094) and step 3 follow
--            their own approvals.
-- Level:     L3 (frozen authorization functions: is_admin, admin_has,
--            require_admin, admin_me; doc 12 §2). DEC-2026-018 cool-off plus
--            checklist before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-039. Needs Supabase Auth's MFA table (auth.mfa_factors) and
--            auth.jwt(), both present on every hosted project.
--
-- THE REFUSAL
--   An active administrator whose session lacks a required factor gets
--   'admin:mfa_required' (SQLSTATE P0001), not 42501. The current admin app
--   signs the operator out on 42501 or on "administrator access" / "does not
--   permit" (src/lib/supabase.ts isAuthorizationError); on this refusal it shows
--   its "blocked" state instead and keeps the session.
--
-- CHANGES TO FROZEN FUNCTIONS (each approved, exactly, in admin-contract)
--   is_admin(), admin_has(text)   ... AND public.admin_mfa_satisfied()
--   require_admin(text), admin_me()   the distinct refusal right after the
--                                      "Not authenticated." check.
--   Their outputs, signatures and grants are unchanged.
--
-- NEW
--   admin_security_settings   one closed row: the mandatory switch (OFF).
--   admin_mfa_required()      for the caller: the switch, or a verified factor.
--   admin_mfa_satisfied()     not required, or the session's aal is aal2.
--   admin_mfa_pending()       an active administrator who is not satisfied.
--   admin_mfa_status()        for the admin app (authenticated; administrators
--                             only, checked inside): { factorEnrolled, aal,
--                             required, satisfied, requiredForAll }. It never
--                             requires the second factor itself.
--   admin_mfa_set_required(p_on, p_force, p_by)  service only (step 3): refuses
--                             to switch ON while an active administrator has no
--                             verified factor, unless forced.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('auth.mfa_factors'), to_regprocedure('auth.jwt()');   -- both NOT NULL
--   SELECT count(*) FROM public.admin_users WHERE is_active;                  -- who is affected
--   SELECT md5(replace(prosrc, E'\r', '')) FROM pg_proc WHERE oid = 'public.is_admin()'::regprocedure;
--     -- as in the baseline, CR-normalised (the live bodies keep CRLF; 040 writes LF)
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
--     LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM public.admin_users a
--     WHERE a.user_id = auth.uid() AND a.is_active
--   );
-- $$;
-- CREATE OR REPLACE FUNCTION public.admin_has(p_permission text) RETURNS boolean
--     LANGUAGE sql STABLE SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
--   SELECT EXISTS (
--     SELECT 1 FROM public.admin_users a
--     WHERE a.user_id = auth.uid()
--       AND a.is_active
--       AND (
--         p_permission = ANY (public.admin_role_permissions(a.role))
--         OR p_permission = ANY (a.permissions)
--       )
--   );
-- $$;
-- CREATE OR REPLACE FUNCTION public.require_admin(p_permission text DEFAULT NULL::text) RETURNS uuid
--     LANGUAGE plpgsql STABLE SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_uid UUID := auth.uid();
-- BEGIN
--   IF v_uid IS NULL THEN
--     RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
--   END IF;
--
--   IF NOT public.is_admin() THEN
--     -- Same message for "not an admin" and "deactivated admin": a signed-in
--     -- customer poking at these RPCs learns nothing about who is an admin.
--     RAISE EXCEPTION 'This account does not have administrator access.'
--       USING ERRCODE = '42501';
--   END IF;
--
--   IF p_permission IS NOT NULL AND NOT public.admin_has(p_permission) THEN
--     RAISE EXCEPTION 'Your role does not permit this action (%).', p_permission
--       USING ERRCODE = '42501';
--   END IF;
--
--   RETURN v_uid;
-- END;
-- $$;
-- CREATE OR REPLACE FUNCTION public.admin_me() RETURNS jsonb
--     LANGUAGE plpgsql SECURITY DEFINER
--     SET search_path TO 'public', 'pg_temp'
--     AS $$
-- DECLARE
--   v_uid UUID := auth.uid();
--   v_out JSONB;
-- BEGIN
--   IF v_uid IS NULL THEN
--     RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
--   END IF;
--
--   SELECT jsonb_build_object(
--     'user_id', a.user_id,
--     'display_name', COALESCE(a.display_name, p.full_name),
--     'email', p.email,
--     'role', a.role,
--     'is_active', a.is_active,
--     'permissions', public.admin_role_permissions(a.role) || a.permissions,
--     'created_at', a.created_at,
--     'last_seen_at', a.last_seen_at
--   ) INTO v_out
--   FROM public.admin_users a
--   LEFT JOIN public.profiles p ON p.id = a.user_id
--   WHERE a.user_id = v_uid AND a.is_active;
--
--   IF v_out IS NULL THEN
--     -- Deliberately the same refusal a non-admin gets, with no hint about
--     -- whether the account exists but is deactivated.
--     RAISE EXCEPTION 'This account does not have administrator access.'
--       USING ERRCODE = '42501';
--   END IF;
--
--   UPDATE public.admin_users SET last_seen_at = NOW() WHERE user_id = v_uid;
--
--   RETURN v_out;
-- END;
-- $$;
--
-- DROP FUNCTION IF EXISTS public.admin_mfa_status();
-- DROP FUNCTION IF EXISTS public.admin_mfa_set_required(boolean, boolean, text);
-- DROP FUNCTION IF EXISTS public.admin_mfa_pending();
-- DROP FUNCTION IF EXISTS public.admin_mfa_satisfied();
-- DROP FUNCTION IF EXISTS public.admin_mfa_required();
-- DROP TABLE IF EXISTS public.admin_security_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

DO $needs$
BEGIN
  IF to_regclass('auth.mfa_factors') IS NULL OR to_regprocedure('auth.jwt()') IS NULL THEN
    RAISE EXCEPTION '040: needs Supabase Auth MFA (auth.mfa_factors, auth.jwt()); nothing changed';
  END IF;
END
$needs$;

CREATE TABLE IF NOT EXISTS public.admin_security_settings (
  id           smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mfa_required boolean NOT NULL DEFAULT false,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  changed_by   text CHECK (changed_by IS NULL OR length(changed_by) <= 120)
);
INSERT INTO public.admin_security_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.admin_security_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_security_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.admin_security_settings TO service_role;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_mfa_required()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  -- Required of the caller once SHYGON switches it on for everyone (step 3), or
  -- as soon as the caller has a verified factor of their own (step 2, opt-in).
  SELECT COALESCE((SELECT s.mfa_required FROM public.admin_security_settings s WHERE s.id = 1), false)
      OR EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = auth.uid() AND f.status = 'verified');
$$;

CREATE OR REPLACE FUNCTION public.admin_mfa_satisfied()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT NOT public.admin_mfa_required() OR COALESCE(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

CREATE OR REPLACE FUNCTION public.admin_mfa_pending()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = auth.uid() AND a.is_active)
     AND NOT public.admin_mfa_satisfied();
$$;

CREATE OR REPLACE FUNCTION public.admin_mfa_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;
  -- Administrators only, but without the second factor: this is how the app
  -- learns that it must ask for one.
  IF NOT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = v_uid AND a.is_active) THEN
    RAISE EXCEPTION 'This account does not have administrator access.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'factorEnrolled', EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = v_uid AND f.status = 'verified'),
    'aal', COALESCE(auth.jwt() ->> 'aal', 'aal1'),
    'required', public.admin_mfa_required(),
    'satisfied', public.admin_mfa_satisfied(),
    'requiredForAll', COALESCE((SELECT s.mfa_required FROM public.admin_security_settings s WHERE s.id = 1), false));
END;
$$;

-- Step 3, by an operator with the service key, never from an administrator's
-- own session: refuses ON while an active administrator has no verified factor.
CREATE OR REPLACE FUNCTION public.admin_mfa_set_required(p_on boolean, p_force boolean DEFAULT false, p_by text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_missing integer;
BEGIN
  IF p_on IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_request'); END IF;
  SELECT count(*)::integer INTO v_missing FROM public.admin_users a
   WHERE a.is_active
     AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = a.user_id AND f.status = 'verified');
  IF p_on AND v_missing > 0 AND NOT COALESCE(p_force, false) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'admins_without_factor', 'count', v_missing);
  END IF;
  UPDATE public.admin_security_settings
     SET mfa_required = p_on, changed_at = now(), changed_by = left(p_by, 120)
   WHERE id = 1;
  RETURN jsonb_build_object('ok', true, 'requiredForAll', p_on, 'adminsWithoutFactor', v_missing);
END;
$$;

-- The frozen functions, edited exactly as approved.
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid() AND a.is_active
  )
  -- DEC-2026-046 (migration 040): and, where a second factor is required, the
  -- session has it (aal2).
  AND public.admin_mfa_satisfied();
$$;

CREATE OR REPLACE FUNCTION public.admin_has(p_permission text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.user_id = auth.uid()
      AND a.is_active
      AND (
        p_permission = ANY (public.admin_role_permissions(a.role))
        OR p_permission = ANY (a.permissions)
      )
  )
  -- DEC-2026-046 (migration 040): and, where a second factor is required, the
  -- session has it (aal2).
  AND public.admin_mfa_satisfied();
$$;

CREATE OR REPLACE FUNCTION public.require_admin(p_permission text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  -- DEC-2026-046 (migration 040): an active administrator whose session lacks a
  -- required second factor gets its own refusal, not 42501, so the admin app can
  -- ask for the code instead of signing them out.
  IF public.admin_mfa_pending() THEN
    RAISE EXCEPTION 'admin:mfa_required' USING ERRCODE = 'P0001',
      HINT = 'Complete multi-factor authentication (aal2), then try again.';
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

CREATE OR REPLACE FUNCTION public.admin_me() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_out JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.' USING ERRCODE = '42501';
  END IF;

  -- DEC-2026-046 (migration 040): an active administrator whose session lacks a
  -- required second factor gets its own refusal, not 42501, so the admin app can
  -- ask for the code instead of signing them out.
  IF public.admin_mfa_pending() THEN
    RAISE EXCEPTION 'admin:mfa_required' USING ERRCODE = 'P0001',
      HINT = 'Complete multi-factor authentication (aal2), then try again.';
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

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.admin_mfa_required()', 'public.admin_mfa_satisfied()', 'public.admin_mfa_pending()',
    'public.admin_mfa_status()', 'public.admin_mfa_set_required(boolean, boolean, text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
  -- The admin app asks for its own status with an administrator's session.
  GRANT EXECUTE ON FUNCTION public.admin_mfa_status() TO authenticated;
END $$;
