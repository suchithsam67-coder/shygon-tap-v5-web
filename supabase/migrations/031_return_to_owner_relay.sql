-- 031: SHYGON AAROH Return-to-Owner relay (SHYGON Rescue, minimal): a finder
-- sends a protected message to a Tap's owner; the owner replies; neither side
-- sees the other's details unless they write them.
--
-- Decision:  the owner's AAROH master requirements of 2026-10-19 ("Real
--            Return-to-Owner relay: allow a finder to send a protected request
--            without automatically revealing the owner's private phone number")
--            and backend brief (protected relay, owner notification, replies,
--            abuse reports, blocking, rate limits, no duplicate submissions);
--            DEC-2026-038 Q12 (PROPOSED). Design: doc 03 §3.4 (rescue_threads,
--            rescue_messages), doc 05 §2 (finder endpoints and limits), doc 07
--            T6 (spam and harassment controls), doc 08 (lost mode).
--            PROPOSED: not yet reviewed or approved.
-- Level:     L3 (new tables holding messages between strangers; privileged
--            functions). DEC-2026-018 24-hour cool-off plus checklist review
--            before approval or application. Never applied by tooling to
--            production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-030. Reads tap_profiles and profiles; inserts into
--            notifications (the owner's notice, never the message text) and
--            admin_notifications (a report).
-- Data:      none changed. New tables start empty.
--
-- SCOPE (what the requirement approves, and no more)
--   Built: owner opt-in (default OFF) per account; a finder on /t/<slug> starts
--   a thread with a first message and receives a secret finder token; follow-
--   ups and polling with that token; the owner lists, reads, replies, closes,
--   blocks and reports; retention.
--   NOT built (BLOCKED): item lifecycle (protected / lost / found / retired)
--   and device-bound rescue items need the card registry and the card status
--   vocabulary (DEC-2026-028, card release deferred by DEC-2026-035); a bot
--   check (no Turnstile key exists); text-message or push notice to the owner
--   (the account phone is unverified, F4; no provider configured).
--
-- RULES IT ENFORCES (supabase/tests/rescue.mjs)
--   - The finder never receives an owner field (no name beyond the public Tap,
--     no number, no email); the owner sees only what the finder writes.
--   - Messages: 1-500 characters; links are removed for both sides.
--   - Finder: 3 new threads per hour and 10 per day per finder digest (an HMAC
--     of the host-reported client address, never stored in clear); 5 new
--     threads per owner per day; 10 follow-ups per thread per hour; at most 3
--     finder messages in a row without an owner reply; 60 polls per thread per
--     hour; the token stops working 14 days after the thread's last activity.
--   - Duplicates: a thread is unique per (owner, idempotency key) and a message
--     per (thread, client key); a repeat returns the first and adds nothing.
--   - Block: the thread closes and that finder digest cannot open a thread to
--     this owner for 90 days. Report: the same, plus a notice to SHYGON.
--   - Retention: threads (with messages) deleted 90 days after they close; an
--     open thread idle for 30 days is closed; blocks expire after 90 days.
--     Deleting the account deletes all of it.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.rescue_threads');   -- NULL
--   SELECT count(*) FROM pg_proc WHERE proname LIKE 'rescue\_%' OR proname = 'admin_list_rescue_reports';  -- 0
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.admin_list_rescue_reports(integer, integer);
-- DROP FUNCTION IF EXISTS public.rescue_purge();
-- DROP FUNCTION IF EXISTS public.rescue_thread_moderate(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_owner_reply(uuid, uuid, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_thread_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.rescue_threads_for(uuid, integer);
-- DROP FUNCTION IF EXISTS public.rescue_finder_view(text);
-- DROP FUNCTION IF EXISTS public.rescue_finder_post(text, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_thread_open(uuid, uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.rescue_public_target(text);
-- DROP FUNCTION IF EXISTS public.rescue_settings_set(uuid, boolean, text);
-- DROP FUNCTION IF EXISTS public.rescue_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.rescue_clean_text(text, integer);
-- DROP FUNCTION IF EXISTS public.rescue_log(uuid, uuid, text, text, jsonb);
-- DROP TABLE IF EXISTS public.rescue_audit;
-- DROP TABLE IF EXISTS public.rescue_blocks;
-- DROP TABLE IF EXISTS public.rescue_messages;
-- DROP TABLE IF EXISTS public.rescue_threads;
-- DROP TABLE IF EXISTS public.rescue_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS public.rescue_settings (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT false,
  public_hint text CHECK (public_hint IS NULL OR length(public_hint) <= 140),
  changed_at  timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rescue_threads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tap_profile_id    uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  finder_token_hash text NOT NULL UNIQUE,
  finder_digest     text NOT NULL,
  idempotency_key   text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'owner_replied', 'closed', 'blocked', 'spam')),
  finder_unanswered integer NOT NULL DEFAULT 0,
  owner_unread      integer NOT NULL DEFAULT 0,
  poll_window_start timestamptz,
  poll_count        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  closed_at         timestamptz,
  reported_at       timestamptz,
  report_reason     text CHECK (report_reason IS NULL OR length(report_reason) <= 300),
  CONSTRAINT rescue_threads_idempotent UNIQUE (owner_user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_rescue_threads_owner ON public.rescue_threads (owner_user_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_rescue_threads_finder ON public.rescue_threads (finder_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS public.rescue_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  uuid NOT NULL REFERENCES public.rescue_threads(id) ON DELETE CASCADE,
  sender     text NOT NULL CHECK (sender IN ('finder', 'owner', 'system')),
  body       text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  client_key text CHECK (client_key IS NULL OR client_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rescue_messages_idempotent UNIQUE (thread_id, client_key)
);
CREATE INDEX IF NOT EXISTS idx_rescue_messages_thread ON public.rescue_messages (thread_id, created_at);

CREATE TABLE IF NOT EXISTS public.rescue_blocks (
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  finder_digest text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, finder_digest)
);

CREATE TABLE IF NOT EXISTS public.rescue_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id  uuid REFERENCES public.rescue_threads(id) ON DELETE SET NULL,
  actor      text NOT NULL CHECK (actor IN ('owner', 'finder', 'system', 'admin')),
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rescue_audit_user ON public.rescue_audit (user_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rescue_settings', 'rescue_threads', 'rescue_messages', 'rescue_blocks', 'rescue_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.rescue_audit FROM service_role;
END $$;

CREATE OR REPLACE FUNCTION public.rescue_log(p_user uuid, p_thread uuid, p_actor text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.rescue_audit (user_id, thread_id, actor, action, detail)
  VALUES (p_user, p_thread, p_actor, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- Trims, collapses control characters and removes links (a link never takes the
-- punctuation that ends a sentence). NULL if nothing is left.
CREATE OR REPLACE FUNCTION public.rescue_clean_text(p_text text, p_max integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT NULLIF(left(btrim(regexp_replace(
           regexp_replace(COALESCE(p_text, ''), '[[:cntrl:]]+', ' ', 'g'),
           '(https?://|www\.)[^[:space:]]*[^[:space:].,;:!?)]|(?<![@[:alnum:]._-])[[:alnum:]-]+(\.[[:alnum:]-]+)*\.(com|in|net|org|io|co|me|app|link|xyz|info|biz|ly|gl|to)\M(/[^[:space:]]*[^[:space:].,;:!?)])?',
           '[link removed]', 'gi')), p_max), '');
$$;

CREATE OR REPLACE FUNCTION public.rescue_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE(s.enabled, false),
    'publicHint', s.public_hint,
    'changedAt', s.changed_at,
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t
                                   WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL),
    'openThreads', (SELECT count(*) FROM public.rescue_threads r
                     WHERE r.owner_user_id = x.id AND r.status IN ('open', 'owner_replied')),
    'unread', (SELECT COALESCE(sum(r.owner_unread), 0) FROM public.rescue_threads r WHERE r.owner_user_id = x.id))
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.rescue_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.rescue_settings_set(p_user uuid, p_enabled boolean, p_public_hint text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_hint text := public.rescue_clean_text(p_public_hint, 140);
BEGIN
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'rescue:invalid_setting' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.rescue_settings AS s (user_id, enabled, public_hint, changed_at, updated_at)
  VALUES (p_user, p_enabled, v_hint, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, public_hint = EXCLUDED.public_hint,
        changed_at = CASE WHEN s.enabled IS DISTINCT FROM EXCLUDED.enabled THEN now() ELSE s.changed_at END,
        updated_at = now();
  PERFORM public.rescue_log(p_user, NULL, 'owner', CASE WHEN p_enabled THEN 'settings.enabled' ELSE 'settings.disabled' END, '{}'::jsonb);
  RETURN public.rescue_settings_for(p_user);
END;
$$;

-- Whether a finder on /t/<slug> may write to the owner. NULL in every other
-- case (unknown, unpublished, paused or suspended Tap, suspended account,
-- relay off): the caller cannot tell them apart.
CREATE OR REPLACE FUNCTION public.rescue_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id, 'publicHint', s.public_hint)
    FROM public.tap_profiles t
    JOIN public.rescue_settings s ON s.user_id = t.user_id AND s.enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL AND p.suspended_at IS NULL
   LIMIT 1;
$$;

-- A finder's first message. p_token_hash is the SHA-256 of the finder token the
-- server derived; the token itself is never stored. Returns {ok, threadId,
-- replayed} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.rescue_thread_open(p_user uuid, p_tap_profile_id uuid, p_idempotency_key text,
                                                     p_finder_digest text, p_token_hash text, p_body text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_body text := public.rescue_clean_text(p_body, 500);
  v_thread public.rescue_threads;
  v_code text;
  v_wait integer;
BEGIN
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('rescue:' || p_user::text, 0));

  SELECT * INTO v_thread FROM public.rescue_threads WHERE owner_user_id = p_user AND idempotency_key = p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'threadId', v_thread.id, 'replayed', true); END IF;

  IF v_body IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_message'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tap_profiles t
                   JOIN public.rescue_settings s ON s.user_id = t.user_id AND s.enabled
                   LEFT JOIN public.profiles p ON p.id = t.user_id
                  WHERE t.id = p_tap_profile_id AND t.user_id = p_user AND t.status = 'active'
                    AND t.published IS TRUE AND t.suspended_at IS NULL AND p.suspended_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.rescue_blocks b
                 WHERE b.owner_user_id = p_user AND b.finder_digest = p_finder_digest AND b.expires_at > now()) THEN
    v_code := 'unavailable';
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '1 hour') >= 3 THEN
    v_code := 'rate_limited';
    SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now())))::int INTO v_wait
      FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '1 hour';
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE finder_digest = p_finder_digest AND created_at > now() - interval '24 hours') >= 10 THEN
    v_code := 'rate_limited'; v_wait := 86400;
  ELSIF (SELECT count(*) FROM public.rescue_threads WHERE owner_user_id = p_user AND created_at > now() - interval '24 hours') >= 5 THEN
    v_code := 'rate_limited'; v_wait := 86400;
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.rescue_log(p_user, NULL, 'finder', 'thread.refused', jsonb_build_object('code', v_code));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1));
  END IF;

  INSERT INTO public.rescue_threads (owner_user_id, tap_profile_id, finder_token_hash, finder_digest, idempotency_key,
                                     finder_unanswered, owner_unread)
  VALUES (p_user, p_tap_profile_id, p_token_hash, p_finder_digest, p_idempotency_key, 1, 1)
  RETURNING * INTO v_thread;
  INSERT INTO public.rescue_messages (thread_id, sender, body) VALUES (v_thread.id, 'finder', v_body);
  PERFORM public.rescue_log(p_user, v_thread.id, 'finder', 'thread.opened', '{}'::jsonb);

  -- Never the message text in a notification (doc 07 T6).
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (p_user, 'rescue', 'Someone sent you a message through SHYGON',
          'A person who found your card or opened your profile wrote to you. Your number was not shared. Read and reply in your account.',
          '/shygontap/return-to-owner', jsonb_build_object('rescueThreadId', v_thread.id));

  RETURN jsonb_build_object('ok', true, 'threadId', v_thread.id, 'replayed', false);
END;
$$;

-- A finder's follow-up. Returns {ok} or {ok:false, code, retryAfter?}.
CREATE OR REPLACE FUNCTION public.rescue_finder_post(p_token_hash text, p_body text, p_client_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads; v_body text := public.rescue_clean_text(p_body, 500); v_n integer;
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE finder_token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_t.status IN ('blocked', 'spam') THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_not_found'); END IF;
  IF v_t.last_activity_at < now() - interval '14 days' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_expired'); END IF;
  IF v_t.status = 'closed' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_closed'); END IF;
  IF p_client_key IS NULL OR p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key'); END IF;
  IF EXISTS (SELECT 1 FROM public.rescue_messages WHERE thread_id = v_t.id AND client_key = p_client_key) THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true);
  END IF;
  IF v_body IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'invalid_message'); END IF;
  IF v_t.finder_unanswered >= 3 THEN RETURN jsonb_build_object('ok', false, 'code', 'awaiting_owner'); END IF;
  SELECT count(*) INTO v_n FROM public.rescue_messages
   WHERE thread_id = v_t.id AND sender = 'finder' AND created_at > now() - interval '1 hour';
  IF v_n >= 10 THEN RETURN jsonb_build_object('ok', false, 'code', 'rate_limited', 'retryAfter', 3600); END IF;

  INSERT INTO public.rescue_messages (thread_id, sender, body, client_key) VALUES (v_t.id, 'finder', v_body, p_client_key);
  UPDATE public.rescue_threads
     SET finder_unanswered = finder_unanswered + 1, owner_unread = owner_unread + 1, last_activity_at = now()
   WHERE id = v_t.id;
  PERFORM public.rescue_log(v_t.owner_user_id, v_t.id, 'finder', 'message.sent', '{}'::jsonb);
  RETURN jsonb_build_object('ok', true, 'replayed', false);
END;
$$;

-- What the finder sees: the thread's status and messages, nothing about the owner.
CREATE OR REPLACE FUNCTION public.rescue_finder_view(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE finder_token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_t.status IN ('blocked', 'spam') THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_not_found'); END IF;
  IF v_t.last_activity_at < now() - interval '14 days' THEN RETURN jsonb_build_object('ok', false, 'code', 'thread_expired'); END IF;
  IF v_t.poll_window_start IS NULL OR v_t.poll_window_start < now() - interval '1 hour' THEN
    UPDATE public.rescue_threads SET poll_window_start = now(), poll_count = 1 WHERE id = v_t.id;
  ELSIF v_t.poll_count >= 60 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'rate_limited',
      'retryAfter', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_t.poll_window_start + interval '1 hour' - now())))::int));
  ELSE
    UPDATE public.rescue_threads SET poll_count = poll_count + 1 WHERE id = v_t.id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'thread', jsonb_build_object(
    'status', v_t.status,
    'canWrite', v_t.status IN ('open', 'owner_replied') AND v_t.finder_unanswered < 3,
    'expiresAt', v_t.last_activity_at + interval '14 days',
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
                                           ORDER BY m.created_at), '[]'::jsonb)
                   FROM public.rescue_messages m WHERE m.thread_id = v_t.id)));
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_threads_for(p_user uuid, p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb)
  FROM (
    SELECT r.last_activity_at AS at, jsonb_build_object(
      'id', r.id, 'status', r.status, 'createdAt', r.created_at, 'lastActivityAt', r.last_activity_at,
      'closedAt', r.closed_at, 'reportedAt', r.reported_at, 'unread', r.owner_unread,
      'messages', (SELECT count(*) FROM public.rescue_messages m WHERE m.thread_id = r.id),
      'preview', (SELECT left(m.body, 80) FROM public.rescue_messages m WHERE m.thread_id = r.id AND m.sender = 'finder'
                   ORDER BY m.created_at DESC LIMIT 1)) AS j
    FROM public.rescue_threads r
    WHERE r.owner_user_id = p_user
    ORDER BY r.last_activity_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 100))
  ) x;
$$;

-- The owner opens a thread: its messages, and the unread count goes to zero.
CREATE OR REPLACE FUNCTION public.rescue_thread_detail(p_user uuid, p_thread_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  UPDATE public.rescue_threads SET owner_unread = 0 WHERE id = p_thread_id AND owner_user_id = p_user RETURNING * INTO v_t;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'id', v_t.id, 'status', v_t.status, 'createdAt', v_t.created_at, 'lastActivityAt', v_t.last_activity_at,
    'closedAt', v_t.closed_at, 'reportedAt', v_t.reported_at,
    'finderCanWrite', v_t.status IN ('open', 'owner_replied') AND v_t.finder_unanswered < 3,
    'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', m.id, 'from', m.sender, 'body', m.body, 'at', m.created_at)
                                           ORDER BY m.created_at), '[]'::jsonb)
                   FROM public.rescue_messages m WHERE m.thread_id = v_t.id));
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_owner_reply(p_user uuid, p_thread_id uuid, p_body text, p_client_key text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads; v_body text := public.rescue_clean_text(p_body, 500);
BEGIN
  SELECT * INTO v_t FROM public.rescue_threads WHERE id = p_thread_id AND owner_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rescue:thread_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_client_key IS NULL OR p_client_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN RAISE EXCEPTION 'rescue:invalid_idempotency_key' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.rescue_messages WHERE thread_id = v_t.id AND client_key = p_client_key) THEN
    RETURN public.rescue_thread_detail(p_user, p_thread_id) || jsonb_build_object('replayed', true);
  END IF;
  IF v_t.status NOT IN ('open', 'owner_replied') THEN RAISE EXCEPTION 'rescue:thread_closed' USING ERRCODE = 'P0001'; END IF;
  IF v_body IS NULL THEN RAISE EXCEPTION 'rescue:invalid_message' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.rescue_messages (thread_id, sender, body, client_key) VALUES (v_t.id, 'owner', v_body, p_client_key);
  UPDATE public.rescue_threads SET status = 'owner_replied', finder_unanswered = 0, last_activity_at = now() WHERE id = v_t.id;
  PERFORM public.rescue_log(p_user, v_t.id, 'owner', 'message.sent', '{}'::jsonb);
  RETURN public.rescue_thread_detail(p_user, p_thread_id) || jsonb_build_object('replayed', false);
END;
$$;

-- close · block (closes, and refuses that finder for 90 days) · report (block,
-- marked spam, SHYGON told).
CREATE OR REPLACE FUNCTION public.rescue_thread_moderate(p_user uuid, p_thread_id uuid, p_action text, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_t public.rescue_threads;
BEGIN
  IF p_action NOT IN ('close', 'block', 'report') THEN RAISE EXCEPTION 'rescue:invalid_request' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_t FROM public.rescue_threads WHERE id = p_thread_id AND owner_user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rescue:thread_not_found' USING ERRCODE = 'P0002'; END IF;
  IF p_action = 'close' THEN
    IF v_t.status NOT IN ('open', 'owner_replied') THEN RAISE EXCEPTION 'rescue:thread_closed' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.rescue_threads SET status = 'closed', closed_at = now(), owner_unread = 0 WHERE id = v_t.id;
  ELSE
    IF v_t.status IN ('blocked', 'spam') THEN RAISE EXCEPTION 'rescue:already_blocked' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.rescue_threads
       SET status = CASE WHEN p_action = 'report' THEN 'spam' ELSE 'blocked' END,
           closed_at = COALESCE(closed_at, now()), owner_unread = 0,
           reported_at = CASE WHEN p_action = 'report' THEN now() END,
           report_reason = CASE WHEN p_action = 'report' THEN left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300) END
     WHERE id = v_t.id;
    INSERT INTO public.rescue_blocks (owner_user_id, finder_digest, expires_at)
    VALUES (p_user, v_t.finder_digest, now() + interval '90 days')
    ON CONFLICT (owner_user_id, finder_digest) DO UPDATE SET expires_at = EXCLUDED.expires_at;
    IF p_action = 'report' THEN
      INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
      VALUES ('security', 'warning', 'Return-to-owner message reported',
              'A customer reported a finder message as abusive. Review it with admin_list_rescue_reports.',
              NULL, jsonb_build_object('rescueThreadId', v_t.id));
    END IF;
  END IF;
  PERFORM public.rescue_log(p_user, v_t.id, 'owner', 'thread.' || p_action, '{}'::jsonb);
  RETURN public.rescue_thread_detail(p_user, p_thread_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rescue_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_closed int; v_deleted int; v_blocks int; v_audit int;
BEGIN
  UPDATE public.rescue_threads SET status = 'closed', closed_at = now()
   WHERE status IN ('open', 'owner_replied') AND last_activity_at < now() - interval '30 days';
  GET DIAGNOSTICS v_closed = ROW_COUNT;
  DELETE FROM public.rescue_threads WHERE closed_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.rescue_blocks WHERE expires_at < now();
  GET DIAGNOSTICS v_blocks = ROW_COUNT;
  DELETE FROM public.rescue_audit WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  RETURN jsonb_build_object('threadsClosed', v_closed, 'threadsDeleted', v_deleted, 'blocksExpired', v_blocks, 'auditDeleted', v_audit);
END;
$$;

-- Moderation: reported threads only, with their messages (the reason SHYGON was
-- told). Every read is in admin_audit_log.
CREATE OR REPLACE FUNCTION public.admin_list_rescue_reports(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid := public.require_admin('support.read'); v_out jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT r.reported_at AS at, jsonb_build_object(
      'id', r.id, 'ownerUserId', r.owner_user_id, 'reportedAt', r.reported_at, 'reportReason', r.report_reason,
      'createdAt', r.created_at,
      'messages', (SELECT COALESCE(jsonb_agg(jsonb_build_object('from', m.sender, 'body', m.body, 'at', m.created_at)
                                             ORDER BY m.created_at), '[]'::jsonb)
                     FROM public.rescue_messages m WHERE m.thread_id = r.id)) AS j
    FROM public.rescue_threads r
    WHERE r.reported_at IS NOT NULL
    ORDER BY r.reported_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;
  PERFORM public.admin_audit(v_admin, 'rescue.reports.read', 'rescue_thread', NULL, jsonb_build_object('limit', p_limit, 'offset', p_offset));
  RETURN v_out;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.rescue_log(uuid, uuid, text, text, jsonb)',
    'public.rescue_clean_text(text, integer)',
    'public.rescue_settings_for(uuid)',
    'public.rescue_settings_set(uuid, boolean, text)',
    'public.rescue_public_target(text)',
    'public.rescue_thread_open(uuid, uuid, text, text, text, text)',
    'public.rescue_finder_post(text, text, text)',
    'public.rescue_finder_view(text)',
    'public.rescue_threads_for(uuid, integer)',
    'public.rescue_thread_detail(uuid, uuid)',
    'public.rescue_owner_reply(uuid, uuid, text, text)',
    'public.rescue_thread_moderate(uuid, uuid, text, text)',
    'public.rescue_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_rescue_reports(integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_rescue_reports(integer, integer) TO authenticated, service_role;
