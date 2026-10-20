-- 029: SHYGON AAROH emergency contacts and alerts (the emergency module's data,
-- state machine and audit trail).
--
-- Decision:  the owner's AAROH backend brief of 2026-10-19 ("real emergency
--            contact system"); DEC-2026-038 (PROPOSED, filed with this
--            migration): scope, the visitor-initiated alert, the provider and
--            retention. Design inputs: doc 03 §3.1 (sensitive data isolated from
--            tap_profiles, never in a public RPC), doc 04 §4.1 (emergency is a
--            separate, purpose-bound channel: default off, rate-limited, owner
--            notified, audited), doc 05 §2 (3 per day per device), doc 07 T18
--            (relay, never reveal; no medical data). Migration numbering N-1:
--            027 is held aside (DEC-2026-037), 028 is the suspension guard.
--            APPROVED by the owner 2026-10-19 (DEC-2026-038 Q1, in session).
--            Approval of the design is not approval to apply: see Level.
-- Level:     L3 (new tables holding third-party personal data; new privileged
--            functions). Under DEC-2026-018 it needs a 24-hour cool-off plus the
--            checklist review before it is approved or applied. Never applied by
--            tooling to production.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026 and
--            028. It reads and writes only its own new tables, plus three
--            existing ones through their documented columns: inserts into
--            notifications (the owner's in-app notice) and admin_notifications
--            (an abuse report), and reads tap_profiles / profiles (state checks,
--            the owner's name for the message).
-- Data:      none changed. New tables start empty.
--
-- WHAT IT ADDS
--   Tables (RLS on, NO policies, no grant to anon or authenticated: a browser
--   can never read or write them, whatever its token says):
--     emergency_settings            one row per owner: visitor alerts on/off
--     emergency_contacts            the owner's trusted contacts (name, E.164)
--     emergency_contact_challenges  contact verification codes (HMAC only)
--     emergency_events              one alert: who started it, its state
--     emergency_event_recipients    one row per contact per alert
--     emergency_delivery_attempts   one row per provider call (append-only)
--     emergency_audit               every security-relevant step (append-only)
--   Functions: SECURITY DEFINER, EXECUTE for service_role only (the server
--   function netlify/functions/emergency.mjs), except
--   admin_list_emergency_events, which any signed-in caller may execute and
--   which refuses everyone without the support.read permission.
--
-- RULES IT ENFORCES (each is tested in supabase/tests/emergency-db.mjs)
--   - Only VERIFIED contacts are ever alerted. At most 5 contacts per owner;
--     one row per number per owner. Changing a number clears its verification.
--   - Verification: 10-minute code, 5 tries, 45 s between sends to a contact,
--     5 sends per owner per hour, 3 sends per phone number per 24 h across ALL
--     owners (so nobody can use SHYGON to text a stranger repeatedly).
--   - Idempotency: (owner, initiator, idempotency key) is unique; a repeat
--     returns the first alert and sends nothing.
--   - Owner alerts: one in progress per 2 minutes, 5 per hour, 10 per 24 h.
--   - Visitor alerts (initiator 'public'): only when the owner switched them on
--     (default OFF) with an acknowledgement, has a verified contact, and the
--     Tap is published and neither the Tap nor the account is suspended.
--     3 per owner per 24 h; 15 minutes between alerts from one Tap; 1 per
--     visitor per Tap and 3 per visitor per 24 h; 50 per hour platform-wide.
--     The owner is told in-app every time; a reported alert switches visitor
--     alerts off.
--   - Delivery: at most 3 provider attempts per recipient; a recipient is
--     claimed with a 90-second lease and an attempt number (a stale attempt
--     cannot overwrite a newer one). "accepted" means the provider took the
--     message; only a provider delivery receipt makes it "delivered".
--   - Retention: recipients' full numbers are erased 7 days after the alert
--     completes; alerts (with recipients and attempts) are deleted after 180
--     days; verification codes after 24 h; audit rows after 400 days. Deleting
--     an account deletes all of it (ON DELETE CASCADE from auth.users).
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.emergency_contacts'), to_regclass('public.emergency_events');
--                                          -- both NULL
--   SELECT count(*) FROM pg_proc WHERE proname LIKE 'emergency\_%'
--                                           OR proname = 'admin_list_emergency_events';
--                                          -- 0
--   SELECT has_function_privilege('authenticated', 'public.require_admin(text)', 'EXECUTE');
--                                          -- true (used by the admin RPC)
--   And confirm the production default privileges still grant new tables and
--   functions to anon/authenticated (Supabase's default): this file revokes them.
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.admin_list_emergency_events(text, integer, integer);
-- DROP FUNCTION IF EXISTS public.emergency_purge();
-- DROP FUNCTION IF EXISTS public.emergency_report(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_cancel(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_event_detail(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_events_for(uuid, integer);
-- DROP FUNCTION IF EXISTS public.emergency_provider_status(text, text, text, text);
-- DROP FUNCTION IF EXISTS public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text);
-- DROP FUNCTION IF EXISTS public.emergency_claim_due(uuid, integer);
-- DROP FUNCTION IF EXISTS public.emergency_requeue_not_sent(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_alert_open(uuid, text, text, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_public_target(text);
-- DROP FUNCTION IF EXISTS public.emergency_verification_confirm(uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_verification_abort(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_verification_start(uuid, uuid, uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_settings_set(uuid, boolean, boolean);
-- DROP FUNCTION IF EXISTS public.emergency_settings_for(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_contact_remove(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.emergency_contact_save(uuid, uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.emergency_contacts_for(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_event_refresh(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_disable_public_if_unready(uuid, text);
-- DROP FUNCTION IF EXISTS public.emergency_log(uuid, uuid, text, text, jsonb);
-- DROP FUNCTION IF EXISTS public.emergency_owner_name(uuid);
-- DROP FUNCTION IF EXISTS public.emergency_mask_phone(text);
-- DROP TABLE IF EXISTS public.emergency_audit;
-- DROP TABLE IF EXISTS public.emergency_delivery_attempts;
-- DROP TABLE IF EXISTS public.emergency_event_recipients;
-- DROP TABLE IF EXISTS public.emergency_events;
-- DROP TABLE IF EXISTS public.emergency_contact_challenges;
-- DROP TABLE IF EXISTS public.emergency_contacts;
-- DROP TABLE IF EXISTS public.emergency_settings;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.emergency_settings (
  user_id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  public_alerts_enabled    boolean NOT NULL DEFAULT false,
  public_alerts_changed_at timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  relationship text CHECK (relationship IS NULL OR length(relationship) <= 40),
  phone_e164   text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  channel      text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_contacts_one_per_number UNIQUE (user_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_user ON public.emergency_contacts (user_id);

-- contact_id is SET NULL on delete so the per-number send limit survives a
-- contact being removed and added again.
CREATE TABLE IF NOT EXISTS public.emergency_contact_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  phone_digest text NOT NULL,
  code_hash    text NOT NULL,
  attempts     integer NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_contact ON public.emergency_contact_challenges (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_user ON public.emergency_contact_challenges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_challenges_digest ON public.emergency_contact_challenges (phone_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS public.emergency_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initiator        text NOT NULL CHECK (initiator IN ('owner', 'public')),
  idempotency_key  text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  tap_profile_id   uuid REFERENCES public.tap_profiles(id) ON DELETE SET NULL,
  visitor_digest   text,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'partial', 'failed', 'not_sent', 'cancelled')),
  recipient_count  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  reported_at      timestamptz,
  report_reason    text CHECK (report_reason IS NULL OR length(report_reason) <= 300),
  CONSTRAINT emergency_events_idempotent UNIQUE (user_id, initiator, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_emergency_events_user ON public.emergency_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_initiator ON public.emergency_events (initiator, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_tap ON public.emergency_events (tap_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_events_visitor ON public.emergency_events (visitor_digest, created_at DESC)
  WHERE visitor_digest IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.emergency_event_recipients (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            uuid NOT NULL REFERENCES public.emergency_events(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES public.emergency_contacts(id) ON DELETE SET NULL,
  contact_name        text NOT NULL,
  phone_last4         text NOT NULL,
  phone_e164          text,
  channel             text NOT NULL DEFAULT 'sms',
  status              text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'sending', 'retry_wait', 'accepted', 'delivered',
                                        'undelivered', 'failed', 'not_sent', 'cancelled')),
  attempts            integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  lease_until         timestamptz,
  provider            text,
  provider_message_id text,
  provider_status     text,
  last_error          text,
  accepted_at         timestamptz,
  delivered_at        timestamptz,
  failed_at           timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_recipients_event ON public.emergency_event_recipients (event_id);
CREATE INDEX IF NOT EXISTS idx_emergency_recipients_due ON public.emergency_event_recipients (status, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_emergency_recipients_provider_message
  ON public.emergency_event_recipients (provider, provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.emergency_delivery_attempts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id        uuid NOT NULL REFERENCES public.emergency_event_recipients(id) ON DELETE CASCADE,
  attempt_no          integer NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  outcome             text CHECK (outcome IS NULL OR outcome IN
                        ('accepted', 'rejected', 'transient', 'timeout', 'not_configured', 'lease_expired')),
  provider            text,
  provider_message_id text,
  http_status         integer,
  error_code          text,
  CONSTRAINT emergency_attempts_one_per_number UNIQUE (recipient_id, attempt_no)
);

CREATE TABLE IF NOT EXISTS public.emergency_audit (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   uuid REFERENCES public.emergency_events(id) ON DELETE SET NULL,
  actor      text NOT NULL CHECK (actor IN ('owner', 'public', 'system', 'provider', 'admin')),
  action     text NOT NULL,
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emergency_audit_user ON public.emergency_audit (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emergency_audit_event ON public.emergency_audit (event_id);

-- Closed to every API client. RLS is on with no policies, and the client roles
-- hold no privilege at all (Supabase grants new tables to them by default).
-- The server role keeps what the tables need; the two append-only tables
-- cannot be changed or deleted by it (only by the definer functions below and
-- by the account-deletion cascade).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['emergency_settings', 'emergency_contacts', 'emergency_contact_challenges',
                           'emergency_events', 'emergency_event_recipients', 'emergency_delivery_attempts',
                           'emergency_audit'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  REVOKE UPDATE, DELETE, TRUNCATE ON public.emergency_audit, public.emergency_delivery_attempts FROM service_role;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- "+91 ••••• 06633": enough to recognise the number, not enough to reuse it
-- (the format card-otp shows).
CREATE OR REPLACE FUNCTION public.emergency_mask_phone(p_phone text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog', 'pg_temp'
AS $$
  SELECT CASE WHEN p_phone IS NULL THEN NULL
              ELSE left(p_phone, 3) || ' ••••• ' || right(p_phone, 5) END;
$$;

-- The owner's name as it may appear in a text message: letters, spaces and
-- . ' - only, at most 30 characters, so a name cannot carry a link or
-- instructions to a stranger's phone.
CREATE OR REPLACE FUNCTION public.emergency_owner_name(p_user uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(t.display_name), ''))
    INTO v
    FROM (SELECT p_user AS id) x
    LEFT JOIN public.profiles p ON p.id = x.id
    LEFT JOIN public.tap_profiles t ON t.user_id = x.id;
  v := btrim(regexp_replace(COALESCE(v, ''), '[^[:alpha:][:space:].''-]', '', 'g'));
  v := btrim(regexp_replace(v, '\s+', ' ', 'g'));
  IF v = '' THEN RETURN 'A SHYGON member'; END IF;
  RETURN left(v, 30);
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_log(p_user uuid, p_event uuid, p_actor text, p_action text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  INSERT INTO public.emergency_audit (user_id, event_id, actor, action, detail)
  VALUES (p_user, p_event, p_actor, left(p_action, 64), COALESCE(p_detail, '{}'::jsonb));
$$;

-- Visitor alerts need a verified contact. When the last one goes, they are
-- switched off rather than left "on" with nobody to reach.
CREATE OR REPLACE FUNCTION public.emergency_disable_public_if_unready(p_user uuid, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  UPDATE public.emergency_settings
     SET public_alerts_enabled = false, public_alerts_changed_at = now(), updated_at = now()
   WHERE user_id = p_user AND public_alerts_enabled;
  IF FOUND THEN
    PERFORM public.emergency_log(p_user, NULL, 'system', 'settings.public_alerts.disabled', jsonb_build_object('reason', p_reason));
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

-- ---------------------------------------------------------------------------
-- Contacts and settings (the owner's; p_user is the caller the server verified)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.emergency_contacts_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'relationship', c.relationship,
           'phone', public.emergency_mask_phone(c.phone_e164), 'channel', c.channel,
           'verified', c.verified_at IS NOT NULL, 'verifiedAt', c.verified_at,
           'createdAt', c.created_at, 'updatedAt', c.updated_at) ORDER BY c.created_at), '[]'::jsonb)
    FROM public.emergency_contacts c
   WHERE c.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.emergency_settings_for(p_user uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'publicAlertsEnabled', COALESCE(s.public_alerts_enabled, false),
    'publicAlertsChangedAt', s.public_alerts_changed_at,
    'contacts', (SELECT count(*) FROM public.emergency_contacts c WHERE c.user_id = x.id),
    'verifiedContacts', (SELECT count(*) FROM public.emergency_contacts c WHERE c.user_id = x.id AND c.verified_at IS NOT NULL),
    'maxContacts', 5,
    'publicTapPublished', EXISTS (SELECT 1 FROM public.tap_profiles t
                                   WHERE t.user_id = x.id AND t.status = 'active' AND t.suspended_at IS NULL))
  FROM (SELECT p_user AS id) x
  LEFT JOIN public.emergency_settings s ON s.user_id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.emergency_contact_save(p_user uuid, p_contact_id uuid, p_name text, p_relationship text, p_phone text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_rel  text := NULLIF(btrim(COALESCE(p_relationship, '')), '');
  v_old  public.emergency_contacts;
  v_row  public.emergency_contacts;
  v_off  boolean := false;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'emergency:unauthenticated' USING ERRCODE = '42501'; END IF;
  IF length(v_name) < 1 OR length(v_name) > 80 THEN RAISE EXCEPTION 'emergency:invalid_name' USING ERRCODE = '22023'; END IF;
  IF v_rel IS NOT NULL AND length(v_rel) > 40 THEN RAISE EXCEPTION 'emergency:invalid_relationship' USING ERRCODE = '22023'; END IF;
  IF p_phone IS NULL OR p_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'emergency:invalid_phone' USING ERRCODE = '22023'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));

  IF p_contact_id IS NULL THEN
    IF (SELECT count(*) FROM public.emergency_contacts WHERE user_id = p_user) >= 5 THEN
      RAISE EXCEPTION 'emergency:too_many_contacts' USING ERRCODE = 'P0001';
    END IF;
    BEGIN
      INSERT INTO public.emergency_contacts (user_id, name, relationship, phone_e164)
      VALUES (p_user, v_name, v_rel, p_phone)
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'emergency:duplicate_contact' USING ERRCODE = 'P0001';
    END;
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.added',
      jsonb_build_object('contactId', v_row.id, 'last4', right(v_row.phone_e164, 4)));
  ELSE
    SELECT * INTO v_old FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
    BEGIN
      UPDATE public.emergency_contacts
         SET name = v_name, relationship = v_rel, phone_e164 = p_phone,
             verified_at = CASE WHEN v_old.phone_e164 = p_phone THEN v_old.verified_at END,
             updated_at = now()
       WHERE id = p_contact_id
      RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'emergency:duplicate_contact' USING ERRCODE = 'P0001';
    END;
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.updated',
      jsonb_build_object('contactId', v_row.id, 'numberChanged', v_old.phone_e164 <> p_phone,
                         'last4', right(v_row.phone_e164, 4)));
    IF v_old.phone_e164 <> p_phone THEN
      v_off := public.emergency_disable_public_if_unready(p_user, 'no_verified_contact');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'relationship', v_row.relationship,
    'phone', public.emergency_mask_phone(v_row.phone_e164), 'channel', v_row.channel,
    'verified', v_row.verified_at IS NOT NULL, 'verifiedAt', v_row.verified_at,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at,
    'publicAlertsDisabled', v_off);
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_contact_remove(p_user uuid, p_contact_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_last4 text; v_off boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  DELETE FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user
  RETURNING right(phone_e164, 4) INTO v_last4;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.removed',
    jsonb_build_object('contactId', p_contact_id, 'last4', v_last4));
  v_off := public.emergency_disable_public_if_unready(p_user, 'no_verified_contact');
  RETURN jsonb_build_object('removed', true, 'publicAlertsDisabled', v_off);
END;
$$;

-- Both directions need p_acknowledge: the owner has been shown what visitor
-- alerts do (on) or that visitors can no longer reach their contacts (off).
CREATE OR REPLACE FUNCTION public.emergency_settings_set(p_user uuid, p_public_alerts_enabled boolean, p_acknowledge boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_public_alerts_enabled IS NULL THEN RAISE EXCEPTION 'emergency:invalid_setting' USING ERRCODE = '22023'; END IF;
  IF p_acknowledge IS NOT TRUE THEN RAISE EXCEPTION 'emergency:acknowledge_required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  IF p_public_alerts_enabled AND NOT EXISTS (
       SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    RAISE EXCEPTION 'emergency:no_verified_contacts' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.emergency_settings AS s (user_id, public_alerts_enabled, public_alerts_changed_at, updated_at)
  VALUES (p_user, p_public_alerts_enabled, now(), now())
  ON CONFLICT (user_id) DO UPDATE
    SET public_alerts_enabled = EXCLUDED.public_alerts_enabled,
        public_alerts_changed_at = CASE WHEN s.public_alerts_enabled IS DISTINCT FROM EXCLUDED.public_alerts_enabled
                                        THEN now() ELSE s.public_alerts_changed_at END,
        updated_at = now();
  PERFORM public.emergency_log(p_user, NULL, 'owner',
    CASE WHEN p_public_alerts_enabled THEN 'settings.public_alerts.enabled' ELSE 'settings.public_alerts.disabled' END,
    jsonb_build_object('acknowledged', true));
  RETURN public.emergency_settings_for(p_user);
END;
$$;

-- ---------------------------------------------------------------------------
-- Contact verification. The server makes the code and its HMAC; the database
-- keeps only the HMAC and enforces the limits.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.emergency_verification_start(p_user uuid, p_contact_id uuid, p_challenge_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c      public.emergency_contacts;
  v_digest text;
  v_last   timestamptz;
  v_wait   integer;
  v_exp    timestamptz := now() + interval '10 minutes';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  SELECT * INTO v_c FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:contact_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_c.verified_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_verified' USING ERRCODE = 'P0001'; END IF;

  SELECT max(created_at) INTO v_last FROM public.emergency_contact_challenges WHERE contact_id = p_contact_id;
  v_wait := CEIL(EXTRACT(EPOCH FROM (v_last + interval '45 seconds' - now())))::int;
  IF v_wait > 0 THEN
    RAISE EXCEPTION 'emergency:verify_cooldown' USING ERRCODE = 'P0001', DETAIL = v_wait::text;
  END IF;
  IF (SELECT count(*) FROM public.emergency_contact_challenges
       WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'emergency:verify_rate_limited' USING ERRCODE = 'P0001', DETAIL = '3600';
  END IF;
  v_digest := encode(sha256(convert_to(v_c.phone_e164, 'UTF8')), 'hex');
  IF (SELECT count(*) FROM public.emergency_contact_challenges
       WHERE phone_digest = v_digest AND created_at > now() - interval '24 hours') >= 3 THEN
    RAISE EXCEPTION 'emergency:number_rate_limited' USING ERRCODE = 'P0001', DETAIL = '86400';
  END IF;

  -- One open code per contact: a new one retires the old.
  UPDATE public.emergency_contact_challenges SET consumed_at = now()
   WHERE contact_id = p_contact_id AND consumed_at IS NULL;
  INSERT INTO public.emergency_contact_challenges (id, user_id, contact_id, phone_digest, code_hash, expires_at)
  VALUES (p_challenge_id, p_user, p_contact_id, v_digest, p_code_hash, v_exp);
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verification.requested',
    jsonb_build_object('contactId', p_contact_id, 'last4', right(v_c.phone_e164, 4)));

  RETURN jsonb_build_object('phone', v_c.phone_e164, 'phoneMasked', public.emergency_mask_phone(v_c.phone_e164),
                            'ownerName', public.emergency_owner_name(p_user), 'expiresAt', v_exp);
END;
$$;

-- The text never left: retire the code so it cannot be guessed at.
CREATE OR REPLACE FUNCTION public.emergency_verification_abort(p_user uuid, p_challenge_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  UPDATE public.emergency_contact_challenges SET consumed_at = now()
   WHERE id = p_challenge_id AND user_id = p_user AND consumed_at IS NULL;
  PERFORM public.emergency_log(p_user, NULL, 'system', 'contact.verification.not_sent',
    jsonb_build_object('challengeId', p_challenge_id));
END;
$$;

-- Returns {ok, code, attemptsLeft?, contact?}; refusals are values, not
-- exceptions, so a wrong guess still counts.
CREATE OR REPLACE FUNCTION public.emergency_verification_confirm(p_user uuid, p_contact_id uuid, p_code_hash text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_ch public.emergency_contact_challenges; v_left integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));
  IF NOT EXISTS (SELECT 1 FROM public.emergency_contacts WHERE id = p_contact_id AND user_id = p_user) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'contact_not_found');
  END IF;
  SELECT * INTO v_ch FROM public.emergency_contact_challenges
   WHERE contact_id = p_contact_id AND user_id = p_user AND consumed_at IS NULL
   ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'no_challenge'); END IF;
  IF v_ch.expires_at <= now() THEN RETURN jsonb_build_object('ok', false, 'code', 'code_expired'); END IF;
  IF v_ch.attempts >= 5 THEN RETURN jsonb_build_object('ok', false, 'code', 'too_many_attempts'); END IF;

  IF v_ch.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE public.emergency_contact_challenges SET attempts = attempts + 1 WHERE id = v_ch.id;
    v_left := 5 - (v_ch.attempts + 1);
    PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verification.wrong_code',
      jsonb_build_object('contactId', p_contact_id, 'attemptsLeft', v_left));
    RETURN jsonb_build_object('ok', false, 'code', CASE WHEN v_left > 0 THEN 'wrong_code' ELSE 'too_many_attempts' END,
                              'attemptsLeft', v_left);
  END IF;

  UPDATE public.emergency_contact_challenges SET consumed_at = now() WHERE id = v_ch.id AND consumed_at IS NULL;
  UPDATE public.emergency_contacts SET verified_at = now(), updated_at = now() WHERE id = p_contact_id;
  PERFORM public.emergency_log(p_user, NULL, 'owner', 'contact.verified', jsonb_build_object('contactId', p_contact_id));
  RETURN jsonb_build_object('ok', true, 'contact',
    (SELECT e FROM jsonb_array_elements(public.emergency_contacts_for(p_user)) e WHERE e->>'id' = p_contact_id::text));
END;
$$;

-- ---------------------------------------------------------------------------
-- Alerts
-- ---------------------------------------------------------------------------

-- Whether a visitor on /t/<slug> may raise an alert, and for whom. NULL for an
-- unknown, unpublished or suspended Tap, a suspended account, visitor alerts
-- off, or no verified contact: the caller cannot tell these apart.
CREATE OR REPLACE FUNCTION public.emergency_public_target(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('tapProfileId', t.id, 'userId', t.user_id)
    FROM public.tap_profiles t
    JOIN public.emergency_settings s ON s.user_id = t.user_id AND s.public_alerts_enabled
    LEFT JOIN public.profiles p ON p.id = t.user_id
   WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
     AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL
     AND t.user_id IS NOT NULL
     AND p.suspended_at IS NULL
     AND EXISTS (SELECT 1 FROM public.emergency_contacts c WHERE c.user_id = t.user_id AND c.verified_at IS NOT NULL)
   LIMIT 1;
$$;

-- Status of one alert, from its recipients. "sent" = every message accepted by
-- the provider (receipt not confirmed); "delivered" = every one confirmed by a
-- provider receipt; "partial" = some reached the provider, some failed;
-- "not_sent" = nothing could be sent because no provider is configured.
CREATE OR REPLACE FUNCTION public.emergency_event_refresh(p_event_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_total int; v_pending int; v_started int; v_delivered int; v_accepted int; v_not_sent int;
  v_cancelled_at timestamptz; v_status text;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE status IN ('queued', 'sending', 'retry_wait')),
         count(*) FILTER (WHERE attempts > 0),
         count(*) FILTER (WHERE status = 'delivered'),
         count(*) FILTER (WHERE status = 'accepted'),
         count(*) FILTER (WHERE status = 'not_sent')
    INTO v_total, v_pending, v_started, v_delivered, v_accepted, v_not_sent
    FROM public.emergency_event_recipients WHERE event_id = p_event_id;
  SELECT cancelled_at INTO v_cancelled_at FROM public.emergency_events WHERE id = p_event_id;

  v_status := CASE
    WHEN v_pending > 0 THEN CASE WHEN v_started > 0 THEN 'sending' ELSE 'queued' END
    WHEN v_total > 0 AND v_delivered = v_total THEN 'delivered'
    WHEN v_total > 0 AND v_delivered + v_accepted = v_total THEN 'sent'
    WHEN v_delivered + v_accepted > 0 THEN 'partial'
    WHEN v_cancelled_at IS NOT NULL THEN 'cancelled'
    WHEN v_total > 0 AND v_not_sent = v_total THEN 'not_sent'
    ELSE 'failed'
  END;

  UPDATE public.emergency_events
     SET status = v_status,
         completed_at = CASE WHEN v_pending = 0 THEN COALESCE(completed_at, now()) END,
         updated_at = now()
   WHERE id = p_event_id;
  RETURN v_status;
END;
$$;

-- Opens an alert. Returns {ok:true, eventId, replayed} or {ok:false, code,
-- retryAfter?, eventId?}. Refusals are returned (not raised) so the refusal is
-- audited.
CREATE OR REPLACE FUNCTION public.emergency_alert_open(p_user uuid, p_initiator text, p_idempotency_key text,
                                                       p_tap_profile_id uuid DEFAULT NULL, p_visitor_digest text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_event  public.emergency_events;
  v_code   text;
  v_wait   integer;
  v_recent uuid;
  v_n      integer;
BEGIN
  IF p_user IS NULL OR p_initiator NOT IN ('owner', 'public') THEN
    RAISE EXCEPTION 'emergency:invalid_request' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_idempotency_key');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('emergency:' || p_user::text, 0));

  SELECT * INTO v_event FROM public.emergency_events
   WHERE user_id = p_user AND initiator = p_initiator AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'eventId', v_event.id, 'replayed', true);
  END IF;

  IF p_initiator = 'owner' THEN
    SELECT id INTO v_recent FROM public.emergency_events
     WHERE user_id = p_user AND initiator = 'owner' AND cancelled_at IS NULL
       AND created_at > now() - interval '2 minutes'
     ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_code := 'alert_in_progress';
    ELSE
      SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '1 hour' - now())))::int, count(*)
        INTO v_wait, v_n FROM public.emergency_events
       WHERE user_id = p_user AND initiator = 'owner' AND created_at > now() - interval '1 hour';
      IF v_n >= 5 THEN v_code := 'alert_rate_limited';
      ELSE
        SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - now())))::int, count(*)
          INTO v_wait, v_n FROM public.emergency_events
         WHERE user_id = p_user AND initiator = 'owner' AND created_at > now() - interval '24 hours';
        IF v_n >= 10 THEN v_code := 'alert_rate_limited'; ELSE v_wait := NULL; END IF;
      END IF;
    END IF;
  ELSE
    -- The target is re-checked inside the lock: the owner may have switched
    -- visitor alerts off, or the Tap gone dark, since the server looked.
    IF p_tap_profile_id IS NULL OR p_visitor_digest IS NULL OR NOT EXISTS (
         SELECT 1 FROM public.tap_profiles t
           JOIN public.emergency_settings s ON s.user_id = t.user_id AND s.public_alerts_enabled
           LEFT JOIN public.profiles p ON p.id = t.user_id
          WHERE t.id = p_tap_profile_id AND t.user_id = p_user
            AND t.status = 'active' AND t.published IS TRUE AND t.suspended_at IS NULL AND p.suspended_at IS NULL) THEN
      v_code := 'unavailable';
    ELSIF (SELECT count(*) FROM public.emergency_events
            WHERE initiator = 'public' AND created_at > now() - interval '1 hour') >= 50 THEN
      v_code := 'service_busy'; v_wait := 600;
    ELSIF (SELECT count(*) FROM public.emergency_events
            WHERE user_id = p_user AND initiator = 'public' AND created_at > now() - interval '24 hours') >= 3 THEN
      v_code := 'alert_rate_limited';
      SELECT CEIL(EXTRACT(EPOCH FROM (min(created_at) + interval '24 hours' - now())))::int INTO v_wait
        FROM public.emergency_events WHERE user_id = p_user AND initiator = 'public' AND created_at > now() - interval '24 hours';
    ELSIF EXISTS (SELECT 1 FROM public.emergency_events
                   WHERE tap_profile_id = p_tap_profile_id AND initiator = 'public' AND created_at > now() - interval '15 minutes') THEN
      v_code := 'alert_rate_limited';
      SELECT CEIL(EXTRACT(EPOCH FROM (max(created_at) + interval '15 minutes' - now())))::int INTO v_wait
        FROM public.emergency_events WHERE tap_profile_id = p_tap_profile_id AND initiator = 'public';
    ELSIF EXISTS (SELECT 1 FROM public.emergency_events
                   WHERE visitor_digest = p_visitor_digest AND tap_profile_id = p_tap_profile_id
                     AND created_at > now() - interval '24 hours')
       OR (SELECT count(*) FROM public.emergency_events
            WHERE visitor_digest = p_visitor_digest AND created_at > now() - interval '24 hours') >= 3 THEN
      v_code := 'alert_rate_limited'; v_wait := 86400;
    END IF;
  END IF;

  IF v_code IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.emergency_contacts WHERE user_id = p_user AND verified_at IS NOT NULL) THEN
    v_code := CASE WHEN p_initiator = 'public' THEN 'unavailable' ELSE 'no_verified_contacts' END;
  END IF;

  IF v_code IS NOT NULL THEN
    PERFORM public.emergency_log(p_user, NULL, p_initiator, 'alert.refused',
      jsonb_build_object('code', v_code, 'tapProfileId', p_tap_profile_id));
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'retryAfter', GREATEST(v_wait, 1), 'eventId', v_recent);
  END IF;

  INSERT INTO public.emergency_events (user_id, initiator, idempotency_key, tap_profile_id, visitor_digest)
  VALUES (p_user, p_initiator, p_idempotency_key,
          CASE WHEN p_initiator = 'public' THEN p_tap_profile_id END,
          CASE WHEN p_initiator = 'public' THEN p_visitor_digest END)
  RETURNING * INTO v_event;

  INSERT INTO public.emergency_event_recipients (event_id, contact_id, contact_name, phone_last4, phone_e164, channel)
  SELECT v_event.id, c.id, c.name, right(c.phone_e164, 4), c.phone_e164, c.channel
    FROM public.emergency_contacts c
   WHERE c.user_id = p_user AND c.verified_at IS NOT NULL
   ORDER BY c.created_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.emergency_events SET recipient_count = v_n WHERE id = v_event.id;

  PERFORM public.emergency_log(p_user, v_event.id, p_initiator, 'alert.created',
    jsonb_build_object('recipients', v_n, 'tapProfileId', v_event.tap_profile_id));

  IF p_initiator = 'public' THEN
    INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
    VALUES (p_user, 'security', 'Your emergency contacts were alerted',
            'Someone using your SHYGON profile sent an emergency alert to your emergency contacts. '
            || 'If this was not a real emergency, report it from your emergency settings.',
            '/shygontap/emergency', jsonb_build_object('emergencyEventId', v_event.id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'eventId', v_event.id, 'replayed', false);
END;
$$;

-- Claims recipients that are due for a provider attempt. Each claim gets a
-- 90-second lease and the next attempt number; an attempt whose lease ran
-- out (the server died mid-send, so the outcome is unknown) is closed as
-- lease_expired and counts toward the three attempts.
CREATE OR REPLACE FUNCTION public.emergency_claim_due(p_event_id uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE (recipient_id uuid, attempt_no integer, event_id uuid, initiator text, phone_e164 text,
               owner_name text, event_created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r record; v_n integer;
BEGIN
  FOR r IN
    SELECT x.id, x.event_id, x.attempts FROM public.emergency_event_recipients x
     WHERE x.status = 'sending' AND x.lease_until < now()
       AND (p_event_id IS NULL OR x.event_id = p_event_id)
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.emergency_delivery_attempts a SET finished_at = now(), outcome = 'lease_expired'
     WHERE a.recipient_id = r.id AND a.attempt_no = r.attempts AND a.outcome IS NULL;
    UPDATE public.emergency_event_recipients x
       SET status = CASE WHEN r.attempts >= 3 THEN 'failed' ELSE 'retry_wait' END,
           failed_at = CASE WHEN r.attempts >= 3 THEN now() END,
           last_error = 'lease_expired', lease_until = NULL, next_attempt_at = now(), updated_at = now()
     WHERE x.id = r.id;
    PERFORM public.emergency_event_refresh(r.event_id);
  END LOOP;

  FOR r IN
    SELECT x.id, x.event_id, x.phone_e164, e.initiator, e.user_id, e.created_at
      FROM public.emergency_event_recipients x
      JOIN public.emergency_events e ON e.id = x.event_id
     WHERE x.status IN ('queued', 'retry_wait') AND x.next_attempt_at <= now() AND x.attempts < 3
       AND x.phone_e164 IS NOT NULL AND e.cancelled_at IS NULL
       AND (p_event_id IS NULL OR x.event_id = p_event_id)
     ORDER BY x.next_attempt_at
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
     FOR UPDATE OF x SKIP LOCKED
  LOOP
    UPDATE public.emergency_event_recipients x
       SET status = 'sending', attempts = x.attempts + 1, lease_until = now() + interval '90 seconds', updated_at = now()
     WHERE x.id = r.id
    RETURNING x.attempts INTO v_n;
    INSERT INTO public.emergency_delivery_attempts (recipient_id, attempt_no) VALUES (r.id, v_n);
    PERFORM public.emergency_event_refresh(r.event_id);
    recipient_id := r.id; attempt_no := v_n; event_id := r.event_id; initiator := r.initiator;
    phone_e164 := r.phone_e164; owner_name := public.emergency_owner_name(r.user_id); event_created_at := r.created_at;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Records one provider call. p_outcome: accepted (the provider took it),
-- rejected (refused for good: bad number, opted out), transient (5xx, 429,
-- network), timeout (no answer: it may or may not have gone), not_configured.
-- Only the holder of the current attempt number can record it.
CREATE OR REPLACE FUNCTION public.emergency_attempt_finish(p_recipient_id uuid, p_attempt_no integer, p_outcome text,
                                                           p_provider text, p_provider_message_id text, p_provider_status text,
                                                           p_http_status integer, p_error_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.emergency_event_recipients; v_status text; v_user uuid;
BEGIN
  IF p_outcome NOT IN ('accepted', 'rejected', 'transient', 'timeout', 'not_configured') THEN
    RAISE EXCEPTION 'emergency:invalid_outcome' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM public.emergency_event_recipients WHERE id = p_recipient_id FOR UPDATE;
  IF NOT FOUND OR v_r.status <> 'sending' OR v_r.attempts <> p_attempt_no THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_attempt');
  END IF;

  v_status := CASE p_outcome
    WHEN 'accepted' THEN 'accepted'
    WHEN 'rejected' THEN 'failed'
    WHEN 'not_configured' THEN 'not_sent'
    ELSE CASE WHEN v_r.attempts >= 3 THEN 'failed' ELSE 'retry_wait' END
  END;

  UPDATE public.emergency_delivery_attempts
     SET finished_at = now(), outcome = p_outcome, provider = p_provider,
         provider_message_id = left(p_provider_message_id, 128), http_status = p_http_status,
         error_code = left(p_error_code, 64)
   WHERE recipient_id = p_recipient_id AND attempt_no = p_attempt_no AND outcome IS NULL;

  UPDATE public.emergency_event_recipients
     SET status = v_status, lease_until = NULL,
         provider = COALESCE(p_provider, provider),
         provider_message_id = COALESCE(left(p_provider_message_id, 128), provider_message_id),
         provider_status = COALESCE(left(p_provider_status, 32), provider_status),
         last_error = CASE WHEN p_outcome = 'accepted' THEN NULL ELSE left(COALESCE(p_error_code, p_outcome), 64) END,
         accepted_at = CASE WHEN v_status = 'accepted' THEN now() ELSE accepted_at END,
         failed_at = CASE WHEN v_status = 'failed' THEN now() ELSE failed_at END,
         next_attempt_at = CASE WHEN v_status = 'retry_wait'
                                THEN now() + CASE WHEN v_r.attempts = 1 THEN interval '30 seconds' ELSE interval '2 minutes' END
                                ELSE next_attempt_at END,
         updated_at = now()
   WHERE id = p_recipient_id;

  SELECT user_id INTO v_user FROM public.emergency_events WHERE id = v_r.event_id;
  PERFORM public.emergency_log(v_user, v_r.event_id, 'system', 'delivery.attempt',
    jsonb_build_object('recipientId', p_recipient_id, 'attemptNo', p_attempt_no, 'outcome', p_outcome,
                       'provider', p_provider, 'httpStatus', p_http_status, 'errorCode', left(p_error_code, 64)));
  RETURN jsonb_build_object('ok', true, 'status', v_status, 'eventStatus', public.emergency_event_refresh(v_r.event_id));
END;
$$;

-- A provider delivery receipt. Moves an accepted message to delivered or
-- undelivered; never moves a message backwards.
CREATE OR REPLACE FUNCTION public.emergency_provider_status(p_provider text, p_provider_message_id text, p_status text, p_error_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_r public.emergency_event_recipients; v_new text; v_user uuid;
BEGIN
  SELECT * INTO v_r FROM public.emergency_event_recipients
   WHERE provider = p_provider AND provider_message_id = p_provider_message_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('matched', false); END IF;

  v_new := CASE WHEN lower(p_status) IN ('delivered', 'read') THEN 'delivered'
                WHEN lower(p_status) IN ('undelivered', 'failed') THEN 'undelivered' END;
  IF v_new IS NOT NULL AND v_r.status = 'accepted' THEN
    UPDATE public.emergency_event_recipients
       SET status = v_new, provider_status = left(lower(p_status), 32),
           delivered_at = CASE WHEN v_new = 'delivered' THEN now() END,
           failed_at = CASE WHEN v_new = 'undelivered' THEN now() ELSE failed_at END,
           last_error = CASE WHEN v_new = 'undelivered' THEN left(COALESCE(p_error_code, 'undelivered'), 64) END,
           updated_at = now()
     WHERE id = v_r.id;
  ELSIF v_r.status = 'accepted' THEN
    UPDATE public.emergency_event_recipients SET provider_status = left(lower(p_status), 32), updated_at = now()
     WHERE id = v_r.id;
  END IF;

  SELECT user_id INTO v_user FROM public.emergency_events WHERE id = v_r.event_id;
  PERFORM public.emergency_log(v_user, v_r.event_id, 'provider', 'delivery.receipt',
    jsonb_build_object('recipientId', v_r.id, 'providerStatus', left(lower(p_status), 32),
                       'applied', v_new IS NOT NULL AND v_r.status = 'accepted', 'errorCode', left(p_error_code, 64)));
  RETURN jsonb_build_object('matched', true, 'eventStatus', public.emergency_event_refresh(v_r.event_id));
END;
$$;

-- The owner retries recipients that could not be sent because no provider was
-- configured. Requeued only if attempts remain; the attempt limit still holds.
CREATE OR REPLACE FUNCTION public.emergency_requeue_not_sent(p_user uuid, p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user AND cancelled_at IS NULL) THEN
    RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.emergency_event_recipients
     SET status = 'queued', next_attempt_at = now(), updated_at = now()
   WHERE event_id = p_event_id AND status = 'not_sent' AND attempts < 3 AND phone_e164 IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.retry', jsonb_build_object('requeued', v_n));
    PERFORM public.emergency_event_refresh(p_event_id);
  END IF;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.emergency_event_detail(p_user uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'initiator', e.initiator, 'status', e.status,
    'createdAt', e.created_at, 'updatedAt', e.updated_at, 'completedAt', e.completed_at,
    'cancelledAt', e.cancelled_at, 'reportedAt', e.reported_at,
    'recipients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', r.id, 'name', r.contact_name, 'phone', '••••• ' || r.phone_last4, 'channel', r.channel,
               'status', r.status, 'attempts', r.attempts, 'provider', r.provider,
               'acceptedAt', r.accepted_at, 'deliveredAt', r.delivered_at, 'failedAt', r.failed_at,
               'nextAttemptAt', CASE WHEN r.status = 'retry_wait' THEN r.next_attempt_at END,
               'lastError', r.last_error) ORDER BY r.contact_name)
        FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb))
  FROM public.emergency_events e
  WHERE e.id = p_event_id AND e.user_id = p_user;
$$;

CREATE OR REPLACE FUNCTION public.emergency_events_for(p_user uuid, p_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb)
  FROM (
    SELECT e.created_at, jsonb_build_object(
      'id', e.id, 'initiator', e.initiator, 'status', e.status,
      'createdAt', e.created_at, 'completedAt', e.completed_at, 'cancelledAt', e.cancelled_at,
      'reportedAt', e.reported_at,
      'counts', (SELECT jsonb_build_object(
                   'total', count(*),
                   'delivered', count(*) FILTER (WHERE r.status = 'delivered'),
                   'accepted', count(*) FILTER (WHERE r.status = 'accepted'),
                   'pending', count(*) FILTER (WHERE r.status IN ('queued', 'sending', 'retry_wait')),
                   'failed', count(*) FILTER (WHERE r.status IN ('failed', 'undelivered')),
                   'notSent', count(*) FILTER (WHERE r.status = 'not_sent'),
                   'cancelled', count(*) FILTER (WHERE r.status = 'cancelled'))
                 FROM public.emergency_event_recipients r WHERE r.event_id = e.id)) AS j
    FROM public.emergency_events e
    WHERE e.user_id = p_user
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 20), 100))
  ) x;
$$;

-- Stops recipients that have not been sent yet. A message already accepted by
-- the provider cannot be recalled; one being sent right now finishes.
CREATE OR REPLACE FUNCTION public.emergency_cancel(p_user uuid, p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_e public.emergency_events; v_n integer;
BEGIN
  SELECT * INTO v_e FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_e.cancelled_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_cancelled' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.emergency_event_recipients
                  WHERE event_id = p_event_id AND status IN ('queued', 'retry_wait', 'not_sent', 'sending')) THEN
    RAISE EXCEPTION 'emergency:already_complete' USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.emergency_event_recipients SET status = 'cancelled', updated_at = now()
   WHERE event_id = p_event_id AND status IN ('queued', 'retry_wait', 'not_sent');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE public.emergency_events SET cancelled_at = now(), updated_at = now() WHERE id = p_event_id;
  PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.cancelled', jsonb_build_object('stopped', v_n));
  PERFORM public.emergency_event_refresh(p_event_id);
  RETURN public.emergency_event_detail(p_user, p_event_id) || jsonb_build_object('stopped', v_n);
END;
$$;

-- The owner says an alert was unwanted or abusive. A reported visitor alert
-- switches visitor alerts off; the SHYGON team is told.
CREATE OR REPLACE FUNCTION public.emergency_report(p_user uuid, p_event_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_e public.emergency_events; v_off boolean := false;
BEGIN
  SELECT * INTO v_e FROM public.emergency_events WHERE id = p_event_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'emergency:event_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_e.reported_at IS NOT NULL THEN RAISE EXCEPTION 'emergency:already_reported' USING ERRCODE = 'P0001'; END IF;
  UPDATE public.emergency_events
     SET reported_at = now(), report_reason = left(NULLIF(btrim(COALESCE(p_reason, '')), ''), 300), updated_at = now()
   WHERE id = p_event_id;
  IF v_e.initiator = 'public' THEN
    UPDATE public.emergency_settings
       SET public_alerts_enabled = false, public_alerts_changed_at = now(), updated_at = now()
     WHERE user_id = p_user AND public_alerts_enabled;
    v_off := FOUND;
  END IF;
  PERFORM public.emergency_log(p_user, p_event_id, 'owner', 'alert.reported',
    jsonb_build_object('initiator', v_e.initiator, 'publicAlertsDisabled', v_off));
  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES ('security', 'warning', 'Emergency alert reported',
          'A customer reported an emergency alert as unwanted. Investigate with admin_list_emergency_events.',
          NULL, jsonb_build_object('emergencyEventId', p_event_id, 'initiator', v_e.initiator));
  RETURN jsonb_build_object('reported', true, 'publicAlertsDisabled', v_off);
END;
$$;

-- Retention (run by the dispatcher sweep). Returns what it removed.
CREATE OR REPLACE FUNCTION public.emergency_purge()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_scrubbed int; v_events int; v_codes int; v_audit int;
BEGIN
  UPDATE public.emergency_event_recipients r SET phone_e164 = NULL, updated_at = now()
    FROM public.emergency_events e
   WHERE e.id = r.event_id AND r.phone_e164 IS NOT NULL
     AND r.status NOT IN ('queued', 'sending', 'retry_wait')
     AND (e.completed_at < now() - interval '7 days' OR e.created_at < now() - interval '30 days');
  GET DIAGNOSTICS v_scrubbed = ROW_COUNT;
  DELETE FROM public.emergency_events WHERE created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_events = ROW_COUNT;
  DELETE FROM public.emergency_contact_challenges WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_codes = ROW_COUNT;
  DELETE FROM public.emergency_audit WHERE created_at < now() - interval '400 days';
  GET DIAGNOSTICS v_audit = ROW_COUNT;
  RETURN jsonb_build_object('numbersErased', v_scrubbed, 'eventsDeleted', v_events,
                            'codesDeleted', v_codes, 'auditDeleted', v_audit);
END;
$$;

-- ---------------------------------------------------------------------------
-- Administration: investigate failed or reported alerts. No contact names and
-- no numbers beyond the last four digits. Every read is in admin_audit_log.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_list_emergency_events(p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_admin uuid := public.require_admin('support.read'); v_out jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_out
  FROM (
    SELECT e.created_at, jsonb_build_object(
      'id', e.id, 'userId', e.user_id, 'initiator', e.initiator, 'status', e.status,
      'createdAt', e.created_at, 'completedAt', e.completed_at, 'cancelledAt', e.cancelled_at,
      'reportedAt', e.reported_at, 'reportReason', e.report_reason,
      'recipients', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                       'id', r.id, 'last4', r.phone_last4, 'status', r.status, 'attempts', r.attempts,
                       'provider', r.provider, 'providerMessageId', r.provider_message_id,
                       'providerStatus', r.provider_status, 'lastError', r.last_error,
                       'attemptLog', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                                        'attemptNo', a.attempt_no, 'startedAt', a.started_at, 'finishedAt', a.finished_at,
                                        'outcome', a.outcome, 'httpStatus', a.http_status, 'errorCode', a.error_code)
                                        ORDER BY a.attempt_no), '[]'::jsonb)
                                      FROM public.emergency_delivery_attempts a WHERE a.recipient_id = r.id)))
                     FROM public.emergency_event_recipients r WHERE r.event_id = e.id), '[]'::jsonb)) AS j
    FROM public.emergency_events e
    WHERE p_status IS NULL OR e.status = p_status OR (p_status = 'reported' AND e.reported_at IS NOT NULL)
    ORDER BY e.created_at DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200)) OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) x;
  PERFORM public.admin_audit(v_admin, 'emergency.events.read', 'emergency_event', NULL,
    jsonb_build_object('status', p_status, 'limit', p_limit, 'offset', p_offset));
  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the server only, except the admin RPC (it checks the caller itself).
-- ---------------------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.emergency_mask_phone(text)',
    'public.emergency_owner_name(uuid)',
    'public.emergency_log(uuid, uuid, text, text, jsonb)',
    'public.emergency_disable_public_if_unready(uuid, text)',
    'public.emergency_contacts_for(uuid)',
    'public.emergency_settings_for(uuid)',
    'public.emergency_contact_save(uuid, uuid, text, text, text)',
    'public.emergency_contact_remove(uuid, uuid)',
    'public.emergency_settings_set(uuid, boolean, boolean)',
    'public.emergency_verification_start(uuid, uuid, uuid, text)',
    'public.emergency_verification_abort(uuid, uuid)',
    'public.emergency_verification_confirm(uuid, uuid, text)',
    'public.emergency_public_target(text)',
    'public.emergency_event_refresh(uuid)',
    'public.emergency_alert_open(uuid, text, text, uuid, text)',
    'public.emergency_claim_due(uuid, integer)',
    'public.emergency_attempt_finish(uuid, integer, text, text, text, text, integer, text)',
    'public.emergency_provider_status(text, text, text, text)',
    'public.emergency_requeue_not_sent(uuid, uuid)',
    'public.emergency_event_detail(uuid, uuid)',
    'public.emergency_events_for(uuid, integer)',
    'public.emergency_cancel(uuid, uuid)',
    'public.emergency_report(uuid, uuid, text)',
    'public.emergency_purge()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.admin_list_emergency_events(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_emergency_events(text, integer, integer) TO authenticated, service_role;
