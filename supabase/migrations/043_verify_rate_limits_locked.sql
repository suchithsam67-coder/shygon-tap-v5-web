-- 043: Verified Tap rate limits decided under locks (OpenCode review OC-6,
-- finding #2).
--
-- Decision:  DEC-2026-043 (Verified Tap; approved for the LOCAL BUILD
--            2026-10-31). The OC-6 fixes were approved by the owner in session
--            on 2026-11-12 ("Approve both").
-- Level:     L3 (the Verified Tap decision path). DEC-2026-018 cool-off plus
--            checklist before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-041. Needs 037. Number 042 is reserved by the Admin APK
--            session (coordinated 2026-11-11), so this is 043.
--
-- CHANGES
--   verify_tap_result   (037) re-counts both rate limits where the verdict is
--                       decided: 30 checks per visitor an hour (under a
--                       transaction advisory lock on the visitor digest) and 20
--                       refused checks per card an hour (under the card row's
--                       FOR UPDATE lock). Over a limit it answers
--                       'rate_limited' and decides, consumes and records
--                       nothing. verify_device_lookup keeps its early, cheap
--                       check unchanged.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regprocedure('public.verify_tap_result(text, boolean, text, integer, text)');  -- NULL until 037 is applied
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.verify_tap_result(p_code text, p_crypto_ok boolean, p_uid_hmac text, p_counter integer, p_visitor text)
-- RETURNS jsonb
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_d public.tap_device_auth;
--   v_card public.cards;
--   v_verdict text;
-- BEGIN
--   SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code FOR UPDATE;
--   IF NOT FOUND THEN RETURN jsonb_build_object('verdict', 'unavailable'); END IF;
--   IF p_crypto_ok IS NOT TRUE OR p_uid_hmac IS DISTINCT FROM v_d.uid_hmac THEN
--     v_verdict := 'not_confirmed';
--   ELSIF v_d.retired_at IS NOT NULL OR p_counter IS NULL OR p_counter < 0 OR p_counter >= 16777215 THEN
--     v_verdict := 'needs_service';
--   ELSIF v_d.last_counter IS NOT NULL AND p_counter <= v_d.last_counter THEN
--     v_verdict := 'already_checked';
--   ELSE
--     UPDATE public.tap_device_auth SET last_counter = p_counter, last_verified_at = now() WHERE public_code = p_code;
--     v_verdict := 'genuine';
--   END IF;
--   INSERT INTO public.tap_verify_events (public_code, verdict, visitor_digest) VALUES (p_code, v_verdict, p_visitor);
--   IF v_verdict <> 'genuine' THEN RETURN jsonb_build_object('verdict', v_verdict); END IF;
--   -- The edition line (U4): only after 'genuine', and only from a complete record.
--   SELECT * INTO v_card FROM public.cards WHERE id = v_d.card_id;
--   RETURN jsonb_build_object('verdict', 'genuine', 'edition',
--     CASE WHEN v_card.edition_design IS NOT NULL AND v_card.edition_serial IS NOT NULL AND v_card.edition_count IS NOT NULL
--          THEN jsonb_build_object('design', v_card.edition_design, 'number', v_card.edition_serial,
--                                  'of', v_card.edition_count, 'chapterSize', v_card.edition_chapter_size)
--          ELSE NULL END);
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.verify_tap_result(text, boolean, text, integer, text) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.verify_tap_result(text, boolean, text, integer, text) TO service_role;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

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
  -- OC-6 #2 (043): verify_device_lookup counts the rate limits before a
  -- concurrent check has written its event, so a burst could pass them. They
  -- are counted again here, where the decision is made: one visitor's checks
  -- are serialised by a transaction advisory lock, one card's by its row lock.
  -- Locks are always taken in that order (visitor, then card), so two checks
  -- never wait on each other in a cycle. Over a limit, nothing is decided,
  -- consumed or recorded.
  IF p_visitor IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('verify-visitor|' || p_visitor, 0));
    IF (SELECT count(*) FROM public.tap_verify_events
          WHERE visitor_digest = p_visitor AND created_at > now() - interval '1 hour') >= 30 THEN
      RETURN jsonb_build_object('verdict', 'rate_limited', 'retryAfter', 3600);
    END IF;
  END IF;
  SELECT * INTO v_d FROM public.tap_device_auth WHERE public_code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('verdict', 'unavailable'); END IF;
  IF (SELECT count(*) FROM public.tap_verify_events
        WHERE public_code = p_code AND verdict = 'not_confirmed' AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('verdict', 'rate_limited', 'retryAfter', 3600);
  END IF;
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

REVOKE ALL ON FUNCTION public.verify_tap_result(text, boolean, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_tap_result(text, boolean, text, integer, text) TO service_role;
