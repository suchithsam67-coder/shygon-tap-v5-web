-- 037: Verified Tap (U1). Device codes for /d/<code>, the per-device SUN state
-- (NTAG 424 DNA) and an append-only verification log, read and written only by
-- the server (/api/verify). Nothing here is reachable by a client role.
--
-- Decision:  DEC-2026-043, approved for the LOCAL BUILD by the owner in session
--            on 2026-10-31 ("Approve local build", on Session A's
--            recommendations): Q1 option A; Q4 wording option 2; Q5 a device
--            public code in 037; Q8 D-a (both keys diversified by the device
--            id); Q9 counter limit off; Q6 left to card design. Q2 (key
--            custody), Q3 (personalisation) and Q7 (inlay) stay open. Test-only
--            keys; VERIFIED_TAP off; nothing hosted.
-- Level:     L3 (new closed tables, privileged functions). DEC-2026-018 cool-off
--            plus checklist before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-036. Needs cards (baseline), tap_profiles and tap_mode_state (034).
--
-- Q5, as built: the public code lives in tap_device_auth, NOT as a column on
-- cards. Four frozen admin functions (admin_get_customer, admin_get_order,
-- admin_get_tap, admin_update_card) return whole cards rows (to_jsonb(c)), so a
-- new cards column would silently change the Admin APK's frozen return shapes
-- (doc 12 §2). The code is the table's primary key and its row is never deleted
-- (card_id ON DELETE SET NULL), so a code is never reused.
--
-- MODEL
--   tap_device_auth    one row per personalised chip: its public code (16
--                      base32 characters, 80 bits), the card, the key epoch, an
--                      HMAC of the chip UID (never the UID itself), the last
--                      accepted counter and a retirement mark. No key material.
--   tap_verify_events  append-only: code, verdict, a daily visitor digest
--                      (HMAC, not reversible), time. No UID, no address, no URL
--                      parameter. verify_purge() removes rows after 90 days.
--
-- FUNCTIONS (service_role only)
--   verify_register_device  the personalisation import (admin-only path later).
--   verify_device_lookup    code -> state (unavailable / rate_limited / lost /
--                           retired / ready) with slug, card id and epoch. Rate
--                           limits: 30 checks per visitor per hour, 20 refused
--                           checks per device per hour.
--   verify_tap_result       one tap's outcome, atomically (the device row is
--                           locked): not_confirmed / needs_service /
--                           already_checked / genuine (+ edition), logged.
--   verify_purge            retention.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regclass('public.tap_device_auth'), to_regclass('public.tap_verify_events');  -- both NULL
--   SELECT to_regclass('public.tap_mode_state');                                             -- NOT NULL (034)
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.verify_purge(interval);
-- DROP FUNCTION IF EXISTS public.verify_tap_result(text, boolean, text, integer, text);
-- DROP FUNCTION IF EXISTS public.verify_device_lookup(text, text);
-- DROP FUNCTION IF EXISTS public.verify_register_device(uuid, text, integer, text);
-- DROP TABLE IF EXISTS public.tap_verify_events;
-- DROP TABLE IF EXISTS public.tap_device_auth;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

DO $needs$
BEGIN
  IF to_regclass('public.cards') IS NULL OR to_regclass('public.tap_mode_state') IS NULL THEN
    RAISE EXCEPTION '037: needs the cards table and migration 034; nothing changed';
  END IF;
END
$needs$;

CREATE TABLE IF NOT EXISTS public.tap_device_auth (
  public_code      text PRIMARY KEY CHECK (public_code ~ '^[a-z2-7]{16}$'),
  card_id          uuid UNIQUE REFERENCES public.cards(id) ON DELETE SET NULL,
  key_epoch        integer NOT NULL CHECK (key_epoch BETWEEN 1 AND 999),
  uid_hmac         text NOT NULL CHECK (uid_hmac ~ '^[0-9a-f]{64}$'),
  last_counter     integer CHECK (last_counter IS NULL OR last_counter BETWEEN 0 AND 16777214),
  last_verified_at timestamptz,
  retired_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tap_verify_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code    text NOT NULL,
  verdict        text NOT NULL CHECK (verdict IN ('genuine', 'already_checked', 'not_confirmed', 'needs_service')),
  visitor_digest text CHECK (visitor_digest IS NULL OR visitor_digest ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tap_verify_events_code ON public.tap_verify_events (public_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tap_verify_events_visitor ON public.tap_verify_events (visitor_digest, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tap_device_auth', 'tap_verify_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
  -- The log is append-only for the server: rows are only added, or purged by age.
  REVOKE UPDATE, TRUNCATE ON public.tap_verify_events FROM service_role;
END $$;

-- ---------------------------------------------------------------------------

-- The personalisation import: one chip, its code, its key epoch and the HMAC of
-- its UID. A code is never reused, and a card has at most one chip.
CREATE OR REPLACE FUNCTION public.verify_register_device(p_card uuid, p_code text, p_key_epoch integer, p_uid_hmac text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z2-7]{16}$' THEN RAISE EXCEPTION 'verify:invalid_code' USING ERRCODE = 'P0001'; END IF;
  IF p_uid_hmac IS NULL OR p_uid_hmac !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'verify:invalid_uid' USING ERRCODE = 'P0001'; END IF;
  IF p_key_epoch IS NULL OR p_key_epoch NOT BETWEEN 1 AND 999 THEN RAISE EXCEPTION 'verify:invalid_epoch' USING ERRCODE = 'P0001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cards WHERE id = p_card) THEN RAISE EXCEPTION 'verify:no_card' USING ERRCODE = 'P0001'; END IF;
  IF EXISTS (SELECT 1 FROM public.tap_device_auth WHERE public_code = p_code) THEN
    RAISE EXCEPTION 'verify:code_used' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tap_device_auth WHERE card_id = p_card) THEN
    RAISE EXCEPTION 'verify:card_registered' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.tap_device_auth (public_code, card_id, key_epoch, uid_hmac) VALUES (p_code, p_card, p_key_epoch, p_uid_hmac);
  RETURN jsonb_build_object('ok', true, 'code', p_code);
END;
$$;

-- What the server may do with a code. Every "no" is the same neutral
-- 'unavailable': unknown code, unregistered or inactive card, Tap not live.
CREATE OR REPLACE FUNCTION public.verify_device_lookup(p_code text, p_visitor text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_d public.tap_device_auth;
  v_card public.cards;
  v_tap public.tap_profiles;
  v_mode text;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-z2-7]{16}$' THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  -- One visitor: 30 checks an hour, whatever the code (no per-code signal).
  IF p_visitor IS NOT NULL AND (SELECT count(*) FROM public.tap_verify_events
        WHERE visitor_digest = p_visitor AND created_at > now() - interval '1 hour') >= 30 THEN
    RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
  END IF;
  SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code;
  IF NOT FOUND OR v_d.card_id IS NULL THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  SELECT * INTO v_card FROM public.cards WHERE id = v_d.card_id;
  IF NOT FOUND OR v_card.status IS DISTINCT FROM 'active' OR v_card.tap_profile_id IS NULL THEN
    RETURN jsonb_build_object('state', 'unavailable');
  END IF;
  SELECT * INTO v_tap FROM public.tap_profiles t
   WHERE t.id = v_card.tap_profile_id AND t.status = 'active' AND t.suspended_at IS NULL AND t.published IS TRUE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'unavailable'); END IF;
  -- One device: 20 refused checks an hour (an 8-byte MAC cannot be guessed at that rate).
  IF (SELECT count(*) FROM public.tap_verify_events
        WHERE public_code = p_code AND verdict = 'not_confirmed' AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('state', 'rate_limited', 'retryAfter', 3600);
  END IF;
  SELECT active_mode INTO v_mode FROM public.tap_mode_state WHERE tap_profile_id = v_tap.id;
  -- A lost card (Lost mode, 036): the lifecycle answer replaces every verdict.
  IF COALESCE(v_mode, 'business') = 'lost' THEN RETURN jsonb_build_object('state', 'lost', 'slug', v_tap.slug); END IF;
  RETURN jsonb_build_object(
    'state', CASE WHEN v_d.retired_at IS NOT NULL THEN 'retired' ELSE 'ready' END,
    'slug', v_tap.slug, 'cardId', v_d.card_id, 'keyEpoch', v_d.key_epoch);
END;
$$;

-- One tap's outcome. The device row is locked, so two checks of the same tap
-- (or of n and n+1) are serialised: exactly one is ever 'genuine' per counter.
-- p_crypto_ok: whether the PICC data decrypted and the MAC matched (netlify/lib/sun.mjs).
CREATE OR REPLACE FUNCTION public.verify_tap_result(p_code text, p_crypto_ok boolean, p_uid_hmac text, p_counter integer, p_visitor text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_d public.tap_device_auth;
  v_card public.cards;
  v_verdict text;
BEGIN
  SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('verdict', 'unavailable'); END IF;
  IF p_crypto_ok IS NOT TRUE OR p_uid_hmac IS DISTINCT FROM v_d.uid_hmac THEN
    v_verdict := 'not_confirmed';
  ELSIF v_d.retired_at IS NOT NULL OR p_counter IS NULL OR p_counter < 0 OR p_counter >= 16777215 THEN
    v_verdict := 'needs_service';
  ELSIF v_d.last_counter IS NOT NULL AND p_counter <= v_d.last_counter THEN
    v_verdict := 'already_checked';
  ELSE
    UPDATE public.tap_device_auth SET last_counter = p_counter, last_verified_at = now() WHERE public_code = p_code;
    v_verdict := 'genuine';
  END IF;
  INSERT INTO public.tap_verify_events (public_code, verdict, visitor_digest) VALUES (p_code, v_verdict, p_visitor);
  IF v_verdict <> 'genuine' THEN RETURN jsonb_build_object('verdict', v_verdict); END IF;
  -- The edition line (U4): only after 'genuine', and only from a complete record.
  SELECT * INTO v_card FROM public.cards WHERE id = v_d.card_id;
  RETURN jsonb_build_object('verdict', 'genuine', 'edition',
    CASE WHEN v_card.edition_design IS NOT NULL AND v_card.edition_serial IS NOT NULL AND v_card.edition_count IS NOT NULL
         THEN jsonb_build_object('design', v_card.edition_design, 'number', v_card.edition_serial,
                                 'of', v_card.edition_count, 'chapterSize', v_card.edition_chapter_size)
         ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_purge(p_older_than interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM public.tap_verify_events WHERE created_at < now() - p_older_than;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.verify_register_device(uuid, text, integer, text)',
    'public.verify_device_lookup(text, text)',
    'public.verify_tap_result(text, boolean, text, integer, text)',
    'public.verify_purge(interval)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
