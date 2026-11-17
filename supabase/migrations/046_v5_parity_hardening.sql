-- 046: V5 release-audit parity for V6 (audit/2026-11-15 on shygon-tap-website).
--
-- Decision:  the owner, in session on 2026-11-16: "Approve all three" (the V6
--            hardening, the CI update and the rebase plan; local only), after
--            the coordinator's parity request. The V5 fixes it mirrors were
--            made on the V5 line (054; 057 for the card codes, which the
--            coordinator asked V6 to reuse as is, so the rebase has one design).
-- Level:     L3 (a client privilege on orders; the card one-time-code limits).
--            DEC-2026-018 cool-off plus checklist before any real database.
--            Never applied by tooling.
-- Origin:    the live schema baseline (DEC-2026-023 Option A), after 020-026,
--            028-041 and 043-045 (042 is reserved by the Admin APK session).
--            Needs 022 (order_admin_notes). On the rebase (F-30) V5's 054 and
--            057 supersede the column grant and the two card-code functions;
--            only order_admin_note_append stays V6's.
--
-- WHAT IT FIXES
--   B-1 (V5 audit), still open in V6: 022 moved the administrator's note into
--       the closed order_admin_notes, but supabase/functions/admin-refund wrote
--       the refund reason into orders.admin_note, which a customer can SELECT on
--       their own orders (orders_select_own + the table-level grant).
--       - order_admin_note_append(): the one place an internal note is added
--         (service only); admin-refund now calls it;
--       - customers lose SELECT on orders.admin_note (column-level grant of every
--         other column, as V5's 054). Admins read notes through the admin_*
--         SECURITY DEFINER functions, which this does not touch.
--       NOTE for later migrations: a column added to public.orders after this one
--       is NOT readable by customers until granted: GRANT SELECT (col) ON
--       public.orders TO authenticated;
--   The card-otp race (found in V6, confirmed and fixed on V5 as 057): the
--   function read this hour's codes and the attempt count, then wrote, in
--   separate requests, so parallel requests passed "5 codes an hour, 45 s
--   apart" and "5 attempts per code". V5's 057 design, unchanged:
--       - card_otp_begin(): a per-account advisory lock, both send limits and
--         the insert in one call;
--       - card_otp_take_attempt(): spends one attempt with a conditional UPDATE
--         (attempts < 5) BEFORE the code is compared, and returns the hash.
--       V6's card_otp_challenges has no `channel` column (V5 added it after the
--       2026-09-30 baseline), so p_channel is accepted and not stored here;
--       the signature is V5's so card-otp.mjs calls the same thing on both lines.
--
-- VERIFY ON LIVE before applying (read-only, human):
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'orders' AND grantee IN ('anon', 'authenticated');      -- table-level SELECT today
--   SELECT to_regprocedure('public.card_otp_begin(uuid,uuid,uuid,text,text,text,text,timestamptz)');
--                                                    -- not NULL once V5's 057 is applied: then skip this part
--
-- ROLLBACK (begin)
-- DROP FUNCTION IF EXISTS public.card_otp_take_attempt(uuid, uuid);
-- DROP FUNCTION IF EXISTS public.card_otp_begin(uuid, uuid, uuid, text, text, text, text, timestamptz);
-- DROP FUNCTION IF EXISTS public.order_admin_note_append(uuid, text, uuid);
-- DO $$
-- DECLARE v_cols text;
-- BEGIN
--   SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO v_cols
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name <> 'admin_note';
--   EXECUTE format('REVOKE SELECT (%s) ON public.orders FROM authenticated', v_cols);
-- END $$;
-- GRANT SELECT ON public.orders TO anon, authenticated;
-- ROLLBACK (end)
--
-- Idempotent: safe to run more than once.

-- B-1 ------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.order_admin_note_append(p_order uuid, p_line text, p_by uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_line text := NULLIF(btrim(left(COALESCE(p_line, ''), 2000)), '');
BEGIN
  IF p_order IS NULL OR v_line IS NULL THEN RETURN; END IF;
  INSERT INTO public.order_admin_notes AS n (order_id, note, updated_by, updated_at)
  VALUES (p_order, v_line, p_by, now())
  ON CONFLICT (order_id) DO UPDATE
    SET note = n.note || E'\n' || EXCLUDED.note,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;

DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'orders' AND column_name <> 'admin_note';
  EXECUTE 'REVOKE SELECT ON public.orders FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.orders TO authenticated', v_cols);
END $$;

-- card-otp (V5's 057, unchanged apart from the channel column) ----------------

CREATE OR REPLACE FUNCTION public.card_otp_begin(
  p_challenge   uuid,
  p_user        uuid,
  p_card        uuid,
  p_action      text,
  p_code_hash   text,
  p_phone_last4 text,
  p_channel     text,
  p_expires_at  timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
  v_last  timestamptz;
  v_wait  int;
BEGIN
  -- One sender at a time per account; held until the transaction ends.
  PERFORM pg_advisory_xact_lock(hashtextextended('card_otp:' || p_user::text, 0));

  SELECT count(*), max(created_at) INTO v_count, v_last
    FROM public.card_otp_challenges
   WHERE user_id = p_user AND created_at >= now() - interval '1 hour';

  IF v_count >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'hourly');
  END IF;
  IF v_last IS NOT NULL AND v_last > now() - interval '45 seconds' THEN
    v_wait := ceil(extract(epoch FROM (v_last + interval '45 seconds' - now())))::int;
    RETURN jsonb_build_object('ok', false, 'reason', 'cooldown', 'retryAfter', greatest(v_wait, 1));
  END IF;

  -- V6: no channel column before the rebase (V5's 057 stores COALESCE(p_channel, 'sms')).
  INSERT INTO public.card_otp_challenges
    (id, user_id, card_id, action, code_hash, phone_last4, expires_at)
  VALUES
    (p_challenge, p_user, p_card, p_action, p_code_hash, p_phone_last4, p_expires_at);

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.card_otp_take_attempt(p_challenge uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.card_otp_challenges%ROWTYPE;
BEGIN
  UPDATE public.card_otp_challenges
     SET attempts = attempts + 1
   WHERE id = p_challenge AND user_id = p_user
     AND consumed_at IS NULL AND expires_at > now() AND attempts < 5
  RETURNING * INTO v_row;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'cardId', v_row.card_id, 'action', v_row.action,
                              'codeHash', v_row.code_hash, 'attempts', v_row.attempts);
  END IF;

  SELECT * INTO v_row FROM public.card_otp_challenges WHERE id = p_challenge AND user_id = p_user;
  IF NOT FOUND OR v_row.consumed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'used');
  ELSIF v_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired');
  END IF;
  RETURN jsonb_build_object('ok', false, 'reason', 'attempts');
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.order_admin_note_append(uuid, text, uuid)',
    'public.card_otp_begin(uuid, uuid, uuid, text, text, text, text, timestamptz)',
    'public.card_otp_take_attempt(uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
