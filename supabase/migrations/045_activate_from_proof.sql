-- 045: activate an AAROH card from its tap alone (DEC-2026-047 §8; contract
-- v0.18, owner.card.activate with cardId optional).
--
-- Decision:  DEC-2026-047 (card pairing; approved for the LOCAL BUILD
--            2026-11-10). This change was approved by the owner in session on
--            2026-11-15 ("Approve the build"), at Session B's request (Q-C4:
--            the /d/ page knows the proof, not the card).
-- Level:     L3 (the card state path). DEC-2026-018 cool-off plus checklist
--            before any real database. Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-041, 043 and 044 (042 is reserved by the Admin APK session).
--            Needs 041.
--
-- CHANGES
--   card_owner_activate   (041) p_card may be null: the card is then the one
--                         registered to the proof's code. Not the owner's, not
--                         registered, not pairable, retired, used or mismatched
--                         proofs are refused exactly as before, and a refusal
--                         uses no proof.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT to_regprocedure('public.card_owner_activate(uuid, uuid, text, integer)');  -- NULL until 041 is applied
--
-- ROLLBACK (begin)
-- CREATE OR REPLACE FUNCTION public.card_owner_activate(p_user uuid, p_card uuid, p_code text, p_counter integer)
-- RETURNS jsonb
-- LANGUAGE plpgsql SECURITY DEFINER
-- SET search_path TO 'public', 'pg_temp'
-- AS $$
-- DECLARE
--   v_card public.cards;
--   v_d    public.tap_device_auth;
--   v_tap  uuid;
-- BEGIN
--   SELECT * INTO v_card FROM public.cards c
--    WHERE c.id = p_card
--      AND (c.user_id = p_user OR c.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = p_user))
--    FOR UPDATE;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'card_not_found'); END IF;
--   SELECT * INTO v_d FROM public.tap_device_auth WHERE card_id = p_card FOR UPDATE;
--   IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_registered'); END IF;
--   IF v_d.public_code IS DISTINCT FROM p_code THEN RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch'); END IF;
--   IF v_card.status = 'active' THEN RETURN jsonb_build_object('ok', false, 'code', 'already_active'); END IF;
--   IF v_card.status IN ('retired', 'replaced') OR v_d.retired_at IS NOT NULL THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'card_retired');
--   END IF;
--   IF v_card.status NOT IN ('pending', 'shipped') THEN RETURN jsonb_build_object('ok', false, 'code', 'not_pairable'); END IF;
--   -- The proof's counter must be one this chip was accepted at (genuine), and newer
--   -- than any proof used before.
--   IF p_counter IS NULL OR v_d.last_counter IS NULL OR p_counter > v_d.last_counter THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch');
--   END IF;
--   IF v_d.activated_counter IS NOT NULL AND p_counter <= v_d.activated_counter THEN
--     RETURN jsonb_build_object('ok', false, 'code', 'proof_used');
--   END IF;
--   UPDATE public.tap_device_auth SET activated_counter = p_counter WHERE public_code = v_d.public_code;
--   -- A card with no Tap yet opens the owner's first Tap.
--   IF v_card.tap_profile_id IS NULL THEN
--     SELECT t.id INTO v_tap FROM public.tap_profiles t WHERE t.user_id = p_user ORDER BY t.created_at LIMIT 1;
--     IF v_tap IS NOT NULL THEN UPDATE public.cards SET tap_profile_id = v_tap WHERE id = p_card; END IF;
--   END IF;
--   PERFORM public.card_transition(p_card, 'active', 'owner', 'tap to activate');
--   INSERT INTO public.account_events (user_id, event_type, subject_type, subject_id, detail)
--   VALUES (p_user, 'card_activated', 'card', p_card::text, jsonb_build_object('method', 'tap'));
--   RETURN jsonb_build_object('ok', true, 'card', public.card_owner_card(p_card));
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.card_owner_activate(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.card_owner_activate(uuid, uuid, text, integer) TO service_role;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

CREATE OR REPLACE FUNCTION public.card_owner_activate(p_user uuid, p_card uuid, p_code text, p_counter integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_card public.cards;
  v_d    public.tap_device_auth;
  v_tap  uuid;
BEGIN
  -- 045 (DEC-2026-047 §8): the card may come from the proof alone. The
  -- proof's code is signed by the server and names the chip; the owner and
  -- every check below apply exactly as when the card is named.
  IF p_card IS NULL THEN
    SELECT d.card_id INTO p_card FROM public.tap_device_auth d WHERE d.public_code = p_code;
    IF p_card IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'card_not_found'); END IF;
  END IF;
  SELECT * INTO v_card FROM public.cards c
   WHERE c.id = p_card
     AND (c.user_id = p_user OR c.customer_id IN (SELECT cu.id FROM public.customers cu WHERE cu.user_id = p_user))
   FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'card_not_found'); END IF;
  SELECT * INTO v_d FROM public.tap_device_auth WHERE card_id = p_card FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_registered'); END IF;
  IF v_d.public_code IS DISTINCT FROM p_code THEN RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch'); END IF;
  IF v_card.status = 'active' THEN RETURN jsonb_build_object('ok', false, 'code', 'already_active'); END IF;
  IF v_card.status IN ('retired', 'replaced') OR v_d.retired_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'card_retired');
  END IF;
  IF v_card.status NOT IN ('pending', 'shipped') THEN RETURN jsonb_build_object('ok', false, 'code', 'not_pairable'); END IF;
  -- The proof's counter must be one this chip was accepted at (genuine), and newer
  -- than any proof used before.
  IF p_counter IS NULL OR v_d.last_counter IS NULL OR p_counter > v_d.last_counter THEN
    RETURN jsonb_build_object('ok', false, 'code', 'proof_mismatch');
  END IF;
  IF v_d.activated_counter IS NOT NULL AND p_counter <= v_d.activated_counter THEN
    RETURN jsonb_build_object('ok', false, 'code', 'proof_used');
  END IF;
  UPDATE public.tap_device_auth SET activated_counter = p_counter WHERE public_code = v_d.public_code;
  -- A card with no Tap yet opens the owner's first Tap.
  IF v_card.tap_profile_id IS NULL THEN
    SELECT t.id INTO v_tap FROM public.tap_profiles t WHERE t.user_id = p_user ORDER BY t.created_at LIMIT 1;
    IF v_tap IS NOT NULL THEN UPDATE public.cards SET tap_profile_id = v_tap WHERE id = p_card; END IF;
  END IF;
  PERFORM public.card_transition(p_card, 'active', 'owner', 'tap to activate');
  INSERT INTO public.account_events (user_id, event_type, subject_type, subject_id, detail)
  VALUES (p_user, 'card_activated', 'card', p_card::text, jsonb_build_object('method', 'tap'));
  RETURN jsonb_build_object('ok', true, 'card', public.card_owner_card(p_card));
END;
$$;

REVOKE ALL ON FUNCTION public.card_owner_activate(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_owner_activate(uuid, uuid, text, integer) TO service_role;
