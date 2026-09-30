-- 015: OTP-confirmed card activation and deactivation
--
-- Customers can activate or deactivate their own NFC card from the website.
-- Each request is confirmed with a one-time password sent by SMS to the mobile
-- number on the account (netlify/functions/card-otp.mjs). The admin panel is
-- told about every change.
--
-- Split of responsibilities:
--   * card-otp.mjs (server, service role) creates a challenge, sends the SMS,
--     checks the code, then calls card_apply_verified_action().
--   * card_otp_challenges holds only a keyed HMAC of each code, with expiry and
--     attempt count. RLS is on with no policies: browsers cannot read or write
--     it at all, only the service role can.
--   * card_apply_verified_action() makes the change with exactly the live
--     rules of customer_activate_card / customer_deactivate_card (activation
--     lasts 14 days; only an active card can be deactivated; a replaced card
--     cannot change), then writes the customer notification and the admin
--     alert in the same transaction. Only the service role may execute it.
--
-- Idempotent. Rollback:
--   DROP FUNCTION IF EXISTS public.card_apply_verified_action(uuid, uuid, text);
--   DROP TABLE IF EXISTS public.card_otp_challenges;

BEGIN;

CREATE TABLE IF NOT EXISTS public.card_otp_challenges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     UUID NOT NULL REFERENCES public.cards(id) ON DELETE CASCADE,
  action      TEXT NOT NULL CHECK (action IN ('activate', 'deactivate')),
  -- HMAC-SHA256(secret, id || ':' || code). The code itself is never stored.
  code_hash   TEXT NOT NULL,
  -- Last digits only, for support conversations ("sent to …6633").
  phone_last4 TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_otp_challenges_user_created
  ON public.card_otp_challenges (user_id, created_at DESC);

ALTER TABLE public.card_otp_challenges ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: nothing but the service role touches challenges.
REVOKE ALL ON public.card_otp_challenges FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.card_apply_verified_action(
  p_user_id UUID,
  p_card_id UUID,
  p_action  TEXT
)
RETURNS TABLE (
  id                    UUID,
  status                TEXT,
  activated_at          TIMESTAMPTZ,
  activation_expires_at TIMESTAMPTZ,
  deactivated_at        TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card  public.cards%ROWTYPE;
  v_now   TIMESTAMPTZ := now();
  v_name  TEXT;
  v_label TEXT;
BEGIN
  SELECT * INTO v_card
  FROM public.cards c
  WHERE c.id = p_card_id AND c.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_card.status = 'replaced' THEN
    RAISE EXCEPTION 'This card has been replaced' USING ERRCODE = '22023';
  END IF;

  IF p_action = 'activate' THEN
    UPDATE public.cards c
    SET status = 'active',
        activated_at = v_now,
        last_activation_at = v_now,
        activation_expires_at = v_now + interval '14 days',
        activation_count = COALESCE(c.activation_count, 0) + 1,
        deactivated_at = NULL
    WHERE c.id = v_card.id;
  ELSIF p_action = 'deactivate' THEN
    IF v_card.status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'Card is not active' USING ERRCODE = '22023';
    END IF;
    UPDATE public.cards c
    SET status = 'suspended',
        deactivated_at = v_now
    WHERE c.id = v_card.id;
  ELSE
    RAISE EXCEPTION 'Unknown card action' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), 'A customer')
  INTO v_name
  FROM public.profiles p
  WHERE p.id = p_user_id;
  v_name := COALESCE(v_name, 'A customer');
  v_label := COALESCE(NULLIF(btrim(v_card.card_uid), ''), 'card ' || left(v_card.id::text, 8));

  -- The customer: in their feed and, while the site is open, live.
  INSERT INTO public.notifications (user_id, category, title, body, link, metadata)
  VALUES (
    p_user_id,
    'tap',
    CASE WHEN p_action = 'activate' THEN 'Card activated' ELSE 'Card deactivated' END,
    CASE WHEN p_action = 'activate'
      THEN 'Your card ' || v_label || ' is active and opens your Tap.'
      ELSE 'Your card ' || v_label || ' is deactivated. Tapping it no longer opens your Tap.'
    END,
    '/shygontap/cards',
    jsonb_build_object('card_id', v_card.id, 'action', p_action, 'verified_by', 'sms_otp')
  );

  -- The admin panel: a deactivation may mean a lost card, so it is a warning.
  INSERT INTO public.admin_notifications (category, severity, title, body, link, metadata)
  VALUES (
    'tap',
    CASE WHEN p_action = 'deactivate' THEN 'warning' ELSE 'info' END,
    CASE WHEN p_action = 'activate' THEN 'Customer activated a card' ELSE 'Customer deactivated a card' END,
    v_name || ' ' || CASE WHEN p_action = 'activate' THEN 'activated' ELSE 'deactivated' END
      || ' ' || v_label || ', confirmed by SMS one-time password.',
    '/customers/' || p_user_id::text,
    jsonb_build_object('card_id', v_card.id, 'user_id', p_user_id, 'action', p_action, 'verified_by', 'sms_otp')
  );

  RETURN QUERY
  SELECT c.id, c.status::text, c.activated_at, c.activation_expires_at, c.deactivated_at
  FROM public.cards c
  WHERE c.id = v_card.id;
END;
$$;

REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.card_apply_verified_action(UUID, UUID, TEXT) TO service_role;

COMMIT;
