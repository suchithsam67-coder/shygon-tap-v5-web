-- 032: SHYGON Connect between two SHYGON accounts, on a consent ledger:
-- requests, decisions (accept / decline / block), sharing and revocation.
--
-- Decision:  DEC-2026-038 Q13 = A, approved 2026-10-19 ("next stage = the
--            consent ledger plus Connect requests, decisions and revocations");
--            the owner's master requirement 7 ("record requests, decisions and
--            revocations"). Design: doc 03 §3.4 (connections, consent_grants),
--            doc 04 §4.1-4.2 (a connection is an audience; consent is data;
--            revocation is immediate for future reads; already-copied data
--            cannot be un-shared). The policy choices this file makes where the
--            docs are silent are DEC-2026-039 Q1-Q7, APPROVED by the owner
--            2026-10-20 (in session). Approval of the design is not approval
--            to apply: see Level.
-- Level:     L3 (new tables holding who-knows-whom and shared personal data;
--            privileged functions). DEC-2026-018 cool-off plus checklist review
--            before approval or application. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-031 (it reuses 031's rescue_clean_text for the note). Reads
--            profiles and tap_profiles; inserts notifications.
-- Data:      none changed. New tables start empty.
--
-- MODEL
--   connect_settings  per account: whether others may send it requests (OFF
--                     by default).
--   connections       one row per request between two accounts: requested ->
--                     accepted | declined | blocked | expired, accepted ->
--                     removed. At most one open (requested or accepted)
--                     connection per pair, in either direction.
--   consent_grants    the ledger. A row says: grantor lets grantee read these
--                     fields of the grantor's account profile, for this
--                     purpose, from granted_at until revoked_at. Rows are never
--                     edited except to revoke; a change of what is shared is a
--                     revocation plus a new row (version + 1). The effective
--                     consent is the un-revoked row.
--   connect_audit     every request, decision, share change and revocation.
--
-- RULES (supabase/tests/connect.mjs)
--   - Shareable fields: phone, email, company, job_title from the grantor's
--     own account profile, read LIVE while the grant is active (so a revocation
--     stops future reads). They are self-reported: nothing here verifies them.
--     The name shown is the account's full name (or Tap name), as the identity
--     of the request.
--   - A request: signed-in requester, a published, unsuspended Tap whose owner
--     switched Connect on; not to oneself; neither side suspended; not blocked
--     by the target; not within 30 days of a decline by the target; 5 requests
--     per hour and 20 per day per requester; 50 open incoming per target; an
--     optional note (<= 200 characters, links removed). The requester's grant
--     starts with the request, so the target can see who is asking.
--   - Decline revokes the requester's grant; block also refuses that requester
--     for good (until the target removes the block by connecting later); remove
--     (either side) revokes every grant both ways. Requests not decided within
--     30 days expire, and their grants are revoked.
--   - Only the two parties see a connection; nobody else, including the
--     target's other connections.
--   - Retention: connections that ended (declined, expired, removed) are
--     deleted 180 days after they ended, with their grants; the account
--     cascade deletes everything of an account.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.consent_grants'), to_regclass('public.connections');   -- both NULL
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.connect_purge();
-- DROP FUNCTION IF EXISTS public.connect_consents_for(uuid);
-- DROP FUNCTION IF EXISTS public.connect_list(uuid, text);
-- DROP FUNCTION IF EXISTS public.connect_remove(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.connect_share(uuid, uuid, text[]);
-- DROP FUNCTION IF EXISTS public.connect_decide(uuid, uuid, text, text[]);
-- DROP FUNCTION IF EXISTS public.connect_request(uuid, text, text[], text, text);
-- DROP FUNCTION IF EXISTS public.connect_public_target(text);
-- DROP FUNCTION IF EXISTS public.connect_settings_set(uuid, boolean);
-- DROP FUNCTION IF EXISTS public.connect_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.connect_grant(uuid, uuid, uuid, text[]);
-- DROP FUNCTION IF EXISTS public.connect_revoke_grants(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.connect_party(uuid);
-- DROP FUNCTION IF EXISTS public.connect_fields(text[]);
-- DROP FUNCTION IF EXISTS public.connect_log(uuid, uuid, text, jsonb);
-- DROP TRIGGER IF EXISTS trg_consent_grants_append_only ON public.consent_grants;
-- DROP FUNCTION IF EXISTS public.consent_grants_append_only();
-- DROP TABLE IF EXISTS public.connect_audit;
-- DROP TABLE IF EXISTS public.consent_grants;
-- DROP TABLE IF EXISTS public.connections;
-- DROP TABLE IF EXISTS public.connect_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.connect_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.connections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_tap_profile_id uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'accepted', 'declined', 'blocked', 'expired', 'removed')),
  note                  text CHECK (note IS NULL OR length(note) <= 200),
  idempotency_key       text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  ended_at              timestamptz,
  ended_by              uuid,
  CONSTRAINT connections_not_self CHECK (requester_user_id <> target_user_id),
  CONSTRAINT connections_idempotent UNIQUE (requester_user_id, idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_one_open_per_pair
  ON public.connections (LEAST(requester_user_id, target_user_id), GREATEST(requester_user_id, target_user_id))
  WHERE status IN ('requested', 'accepted');
CREATE INDEX IF NOT EXISTS idx_connections_requester ON public.connections (requester_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connections_target ON public.connections (target_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.consent_grants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  grantee_kind    text NOT NULL DEFAULT 'user' CHECK (grantee_kind IN ('user')),
  grantee_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_kind   text NOT NULL DEFAULT 'profile_fields' CHECK (resource_kind IN ('profile_fields')),
  scope           text[] NOT NULL CHECK (scope <@ ARRAY['phone', 'email', 'company', 'job_title']::text[]),
  purpose         text NOT NULL DEFAULT 'connect' CHECK (purpose IN ('connect')),
  connection_id   uuid NOT NULL REFERENCES public.connections(id) ON DELETE CASCADE,
  version         integer NOT NULL DEFAULT 1,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  revoke_reason   text CHECK (revoke_reason IS NULL OR revoke_reason IN
                    ('changed', 'declined', 'blocked', 'removed', 'expired')),
  CONSTRAINT consent_grants_version UNIQUE (connection_id, grantor_user_id, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_consent_grants_one_active
  ON public.consent_grants (connection_id, grantor_user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_consent_grants_grantee ON public.consent_grants (grantee_user_id) WHERE revoked_at IS NULL;

-- The ledger is append-only: a row can only be revoked, once, and nothing else
-- about it can change (also for the server role; only deletion by retention or
-- the account cascade removes rows).
CREATE OR REPLACE FUNCTION public.consent_grants_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
BEGIN
  IF OLD.revoked_at IS NOT NULL
     OR NEW.revoked_at IS NULL
     OR (NEW.id, NEW.grantor_user_id, NEW.grantee_kind, NEW.grantee_user_id, NEW.resource_kind, NEW.scope,
         NEW.purpose, NEW.connection_id, NEW.version, NEW.granted_at, NEW.expires_at)
        IS DISTINCT FROM
        (OLD.id, OLD.grantor_user_id, OLD.grantee_kind, OLD.grantee_user_id, OLD.resource_kind, OLD.scope,
         OLD.purpose, OLD.connection_id, OLD.version, OLD.granted_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'consent_grants rows are append-only: only an un-revoked row may be revoked, once'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.consent_grants_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consent_grants_append_only() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consent_grants_append_only() TO service_role;
DROP TRIGGER IF EXISTS trg_consent_grants_append_only ON public.consent_grants;
CREATE TRIGGER trg_consent_grants_append_only
  BEFORE UPDATE ON public.consent_grants
  FOR EACH ROW EXECUTE FUNCTION public.consent_grants_append_only();

CREATE TABLE IF NOT EXISTS public.connect_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.connections(id) ON DELETE SET NULL,
  action        text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_audit_user ON public.connect_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['connect_settings', 'connections', 'consent_grants', 'connect_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.connect_audit FROM service_role;
  REVOKE DELETE, TRUNCATE ON public.consent_grants FROM service_role;
END $$;

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.connect_log(p_user uuid, p_connection uuid, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.connect_audit (user_id, connection_id, action, detail)
  VALUES (p_user, p_connection, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- A requested field list, validated and de-duplicated; NULL if any is unknown.
CREATE OR REPLACE FUNCTION public.connect_fields(p_fields text[])
RETURNS text[]
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE WHEN COALESCE(p_fields, '{}') <@ ARRAY['phone', 'email', 'company', 'job_title']::text[]
              THEN ARRAY(SELECT DISTINCT f FROM unnest(COALESCE(p_fields, '{}')) AS f ORDER BY f)
         END;
$$;

-- How a party appears to the other: a name and, if published, their Tap address.
CREATE OR REPLACE FUNCTION public.connect_party(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'name', COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(t.display_name), ''), 'A SHYGON member'),
    'tapSlug', CASE WHEN t.status = 'active' AND t.suspended_at IS NULL THEN t.slug END)
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.profiles p ON p.id = x.id
  LEFT JOIN public.tap_profiles t ON t.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.connect_revoke_grants(p_connection uuid, p_grantor uuid, p_by uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.consent_grants
     SET revoked_at = now(), revoked_by = p_by, revoke_reason = p_reason
   WHERE connection_id = p_connection AND revoked_at IS NULL
     AND (p_grantor IS NULL OR grantor_user_id = p_grantor);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Replaces the grantor's current grant on a connection (append-only: revoke, then insert version + 1).
CREATE OR REPLACE FUNCTION public.connect_grant(p_connection uuid, p_grantor uuid, p_grantee uuid, p_scope text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_version integer;
BEGIN
  SELECT COALESCE(max(version), 0) + 1 INTO v_version FROM public.consent_grants
   WHERE connection_id = p_connection AND grantor_user_id = p_grantor;
  PERFORM public.connect_revoke_grants(p_connection, p_grantor, p_grantor, 'changed');
  INSERT INTO public.consent_grants (grantor_user_id, grantee_user_id, scope, connection_id, version)
  VALUES (p_grantor, p_grantee, p_scope, p_connection, v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.connect_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE(s.enabled, false),
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL),
    'pendingIncoming', (SELECT count(*) FROM public.connections c WHERE c.target_user_id = x.id AND c.status = 'requested'),
    'connections', (SELECT count(*) FROM public.connections c WHERE (c.target_user_id = x.id OR c.requester_user_id = x.id) AND c.status = 'accepted'),
    'shareableFields', ARRAY['phone', 'email', 'company', 'job_title'])
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.connect_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.connect_settings_set(p_user uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'connect:invalid_setting' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.connect_settings AS s (user_id, enabled, updated_at) VALUES (p_user, p_enabled, now())
  ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now();
  PERFORM public.connect_log(p_user, NULL, CASE WHEN p_enabled THEN 'settings.enabled' ELSE 'settings.disabled' END);
  RETURN public.connect_settings_for(p_user);
END;
$$;

-- Who a request to /t/<slug> would reach; NULL when Connect is not available there.
CREATE OR REPLACE FUNCTION public.connect_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id)
    FROM public.tap_profiles t
    JOIN public.connect_settings s ON s.user_id = t.user_id AND s.enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL AND p.suspended_at IS NULL
   LIMIT 1;
$$;

-- A request. Returns {ok, connectionId, replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.connect_request(p_requester uuid, p_slug text, p_share text[], p_note text, p_idempotency_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_target jsonb := public.connect_public_target(p_slug);
  v_target_user uuid;
  v_scope text[] := public.connect_fields(p_share);
  v_note text := NULLIF(public.rescue_clean_text(p_note, 200), '');
  v_c public.connections;
  v_code text;
  v_wait integer;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  IF v_scope IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_share'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('connect:' || p_requester::text, 0));

  SELECT * INTO v_c FROM public.connections WHERE requester_user_id = p_requester AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'connectionId', v_c.id, 'replayed', true); END IF;

  v_target_user := (v_target->>'userId')::uuid;
  IF v_target IS NULL THEN
    v_code := 'unavailable';
  ELSIF v_target_user = p_requester THEN
    v_code := 'self';
  ELSIF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_requester AND suspended_at IS NOT NULL) THEN
    v_code := 'unavailable';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE requester_user_id = p_requester AND target_user_id = v_target_user AND status = 'blocked') THEN
    v_code := 'unavailable';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE LEAST(requester_user_id, target_user_id) = LEAST(p_requester, v_target_user)
                   AND GREATEST(requester_user_id, target_user_id) = GREATEST(p_requester, v_target_user)
                   AND status IN ('requested', 'accepted')) THEN
    v_code := 'already_connected';
  ELSIF EXISTS (SELECT 1 FROM public.connections
                 WHERE requester_user_id = p_requester AND target_user_id = v_target_user AND status = 'declined'
                   AND ended_at > now() - interval '30 days') THEN
    v_code := 'recently_declined'; v_wait := 30 * 86400;
  ELSIF (SELECT count(*) FROM public.connections WHERE requester_user_id = p_requester AND created_at > now() - interval '1 hour') >= 5
     OR (SELECT count(*) FROM public.connections WHERE requester_user_id = p_requester AND created_at > now() - interval '24 hours') >= 20 THEN
    v_code := 'rate_limited'; v_wait := 3600;
  ELSIF (SELECT count(*) FROM public.connections WHERE target_user_id = v_target_user AND status = 'requested') >= 50 THEN
    v_code := 'target_busy';
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.connect_log(p_requester, NULL, 'request.refused', jsonb_build_object('code', v_code));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1));
  END IF;

  INSERT INTO public.connections (requester_user_id, target_user_id, target_tap_profile_id, note, idempotency_key)
  VALUES (p_requester, v_target_user, (v_target->>'tapProfileId')::uuid, v_note, p_idempotency_key)
  RETURNING * INTO v_c;
  PERFORM public.connect_grant(v_c.id, p_requester, v_target_user, v_scope);
  PERFORM public.connect_log(p_requester, v_c.id, 'request.sent', jsonb_build_object('scope', v_scope));
  PERFORM public.connect_log(v_target_user, v_c.id, 'request.received', '{}'::jsonb);
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (v_target_user, 'connect', 'New connection request',
          (public.connect_party(p_requester)->>'name') || ' wants to connect with you on SHYGON.',
          '/shygontap/connections', jsonb_build_object('connectionId', v_c.id));
  RETURN jsonb_build_object('ok', true, 'connectionId', v_c.id, 'replayed', false);
END;
$$;

-- accept (with the target's own share) · decline · block. Target only, while requested.
CREATE OR REPLACE FUNCTION public.connect_decide(p_user uuid, p_connection uuid, p_decision text, p_share text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_scope text[] := public.connect_fields(p_share);
BEGIN
  IF p_decision NOT IN ('accept', 'decline', 'block') THEN RAISE EXCEPTION 'connect:invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_c FROM public.connections WHERE id = p_connection AND target_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status <> 'requested' THEN RAISE EXCEPTION 'connect:already_decided' USING ERRCODE = 'P0001'; END IF;
  IF p_decision = 'accept' THEN
    IF v_scope IS NULL THEN RAISE EXCEPTION 'connect:invalid_share' USING ERRCODE = '22023'; END IF;
    UPDATE public.connections SET status = 'accepted', decided_at = now() WHERE id = v_c.id;
    PERFORM public.connect_grant(v_c.id, p_user, v_c.requester_user_id, v_scope);
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (v_c.requester_user_id, 'connect', 'Connection accepted',
            (public.connect_party(p_user)->>'name') || ' accepted your connection request.',
            '/shygontap/connections', jsonb_build_object('connectionId', v_c.id));
  ELSE
    UPDATE public.connections
       SET status = CASE WHEN p_decision = 'block' THEN 'blocked' ELSE 'declined' END,
           decided_at = now(), ended_at = now(), ended_by = p_user
     WHERE id = v_c.id;
    PERFORM public.connect_revoke_grants(v_c.id, NULL, p_user, CASE WHEN p_decision = 'block' THEN 'blocked' ELSE 'declined' END);
  END IF;
  PERFORM public.connect_log(p_user, v_c.id,
    CASE p_decision WHEN 'accept' THEN 'request.accepted' WHEN 'decline' THEN 'request.declined' ELSE 'request.blocked' END,
    CASE WHEN p_decision = 'accept' THEN jsonb_build_object('scope', v_scope) ELSE '{}'::jsonb END);
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Change what I share on an open connection (append-only: a new grant version).
CREATE OR REPLACE FUNCTION public.connect_share(p_user uuid, p_connection uuid, p_share text[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_scope text[] := public.connect_fields(p_share); v_other uuid;
BEGIN
  IF v_scope IS NULL THEN RAISE EXCEPTION 'connect:invalid_share' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_c FROM public.connections
   WHERE id = p_connection AND (requester_user_id = p_user OR target_user_id = p_user) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status NOT IN ('requested', 'accepted') OR (v_c.status = 'requested' AND v_c.target_user_id = p_user) THEN
    RAISE EXCEPTION 'connect:not_open' USING ERRCODE = 'P0001';
  END IF;
  v_other := CASE WHEN v_c.requester_user_id = p_user THEN v_c.target_user_id ELSE v_c.requester_user_id END;
  PERFORM public.connect_grant(v_c.id, p_user, v_other, v_scope);
  PERFORM public.connect_log(p_user, v_c.id, 'share.changed', jsonb_build_object('scope', v_scope));
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Either party ends the connection (or withdraws a request); every grant both ways is revoked.
CREATE OR REPLACE FUNCTION public.connect_remove(p_user uuid, p_connection uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_c public.connections; v_n integer;
BEGIN
  SELECT * INTO v_c FROM public.connections
   WHERE id = p_connection AND (requester_user_id = p_user OR target_user_id = p_user) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'connect:connection_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.status NOT IN ('requested', 'accepted') THEN RAISE EXCEPTION 'connect:not_open' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.connections SET status = 'removed', ended_at = now(), ended_by = p_user WHERE id = v_c.id;
  v_n := public.connect_revoke_grants(v_c.id, NULL, p_user, 'removed');
  PERFORM public.connect_log(p_user, v_c.id, 'connection.removed', jsonb_build_object('grantsRevoked', v_n));
  RETURN jsonb_build_object('ok', true, 'grantsRevoked', v_n);
END;
$$;

-- My connections, each with the other party, what each side shares and the
-- other side's shared values, read live and only under an active grant.
CREATE OR REPLACE FUNCTION public.connect_list(p_user uuid, p_filter text DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb)
  FROM (
    SELECT COALESCE(c.decided_at, c.created_at) AS at, jsonb_build_object(
      'id', c.id,
      'direction', CASE WHEN c.requester_user_id = p_user THEN 'outgoing' ELSE 'incoming' END,
      -- A requester never learns that they were blocked: a block shows as declined.
      'status', CASE WHEN c.status = 'blocked' AND c.requester_user_id = p_user THEN 'declined' ELSE c.status END,
      'note', c.note,
      'createdAt', c.created_at, 'decidedAt', c.decided_at, 'endedAt', c.ended_at,
      'other', public.connect_party(o.other),
      'iShare', COALESCE((SELECT to_jsonb(g.scope) FROM public.consent_grants g
                           WHERE g.connection_id = c.id AND g.grantor_user_id = p_user AND g.revoked_at IS NULL), '[]'::jsonb),
      'theyShare', COALESCE((SELECT jsonb_object_agg(f, jsonb_build_object(
                                 'value', CASE f WHEN 'phone' THEN pr.phone WHEN 'email' THEN pr.email
                                                 WHEN 'company' THEN pr.company WHEN 'job_title' THEN pr.job_title END,
                                 'provenance', 'self_reported'))
                              FROM public.consent_grants g
                              CROSS JOIN LATERAL unnest(g.scope) AS f
                              LEFT JOIN public.profiles pr ON pr.id = g.grantor_user_id
                             WHERE g.connection_id = c.id AND g.grantor_user_id = o.other AND g.grantee_user_id = p_user
                               AND g.revoked_at IS NULL
                               AND c.status IN ('requested', 'accepted')), '{}'::jsonb)) AS j
    FROM public.connections c
    CROSS JOIN LATERAL (SELECT CASE WHEN c.requester_user_id = p_user THEN c.target_user_id ELSE c.requester_user_id END AS other) o
    WHERE (c.requester_user_id = p_user OR c.target_user_id = p_user)
      AND (p_filter IS NULL OR c.status = p_filter)
    LIMIT 200
  ) x;
$$;

-- My consent ledger: every grant I gave or received, revoked ones included.
CREATE OR REPLACE FUNCTION public.connect_consents_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id, 'connectionId', g.connection_id,
    'direction', CASE WHEN g.grantor_user_id = p_user THEN 'given' ELSE 'received' END,
    'other', public.connect_party(CASE WHEN g.grantor_user_id = p_user THEN g.grantee_user_id ELSE g.grantor_user_id END),
    'scope', g.scope, 'purpose', g.purpose, 'version', g.version,
    'grantedAt', g.granted_at, 'revokedAt', g.revoked_at, 'revokeReason', g.revoke_reason) ORDER BY g.granted_at DESC), '[]'::jsonb)
  FROM public.consent_grants g
  WHERE g.grantor_user_id = p_user OR g.grantee_user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.connect_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_expired int := 0; v_deleted int; r record;
BEGIN
  FOR r IN SELECT id, target_user_id FROM public.connections WHERE status = 'requested' AND created_at < now() - interval '30 days' FOR UPDATE LOOP
    UPDATE public.connections SET status = 'expired', ended_at = now() WHERE id = r.id;
    PERFORM public.connect_revoke_grants(r.id, NULL, NULL, 'expired');
    v_expired := v_expired + 1;
  END LOOP;
  DELETE FROM public.connections WHERE status IN ('declined', 'expired', 'removed') AND ended_at < now() - interval '180 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN jsonb_build_object('requestsExpired', v_expired, 'connectionsDeleted', v_deleted);
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.connect_log(uuid, uuid, text, jsonb)',
    'public.connect_fields(text[])',
    'public.connect_party(uuid)',
    'public.connect_revoke_grants(uuid, uuid, uuid, text)',
    'public.connect_grant(uuid, uuid, uuid, text[])',
    'public.connect_settings_for(uuid)',
    'public.connect_settings_set(uuid, boolean)',
    'public.connect_public_target(text)',
    'public.connect_request(uuid, text, text[], text, text)',
    'public.connect_decide(uuid, uuid, text, text[])',
    'public.connect_share(uuid, uuid, text[])',
    'public.connect_remove(uuid, uuid)',
    'public.connect_list(uuid, text)',
    'public.connect_consents_for(uuid)',
    'public.connect_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
