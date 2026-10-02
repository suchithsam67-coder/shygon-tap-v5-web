-- ============================================================================
-- 024 — CUSTOMER EMAILS: AN OUTBOX FILLED BY THE DATABASE
-- ============================================================================
-- Run AFTER 023. Idempotent.
--
-- Every email a customer gets is queued here by a trigger, in the same
-- transaction as the change it describes, so it goes out no matter which path
-- made the change — the checkout, the Razorpay webhook, the Admin app moving an
-- order, or a card activated with a one-time code:
--
--   order_confirmed      payment received: the order and its e-bill
--   payment_failed       Razorpay reported the payment failed
--   order_shipped        order_status -> shipped
--   order_out_for_delivery
--   order_delivered
--   order_cancelled
--   order_refunded       payment_status -> refunded
--   card_activated / card_deactivated / card_lost / card_replaced
--
-- netlify/functions/send-emails (and the functions that change orders and
-- cards, straight after the change) claim rows with email_outbox_claim(),
-- render them, send them and report back with email_outbox_complete(). A
-- dedupe key per event means a replayed webhook never sends the same email
-- twice. Shipping and delivery emails respect the customer's "order updates"
-- preference, as the in-app notifications already do; receipts and card
-- security emails are always sent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.email_outbox (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  template            TEXT NOT NULL,
  -- The order or card the email is about.
  subject_id          UUID,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key          TEXT NOT NULL UNIQUE,
  -- pending | sending | sent | failed | skipped
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  next_attempt_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  to_email            TEXT,
  provider_message_id TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_due
  ON public.email_outbox (next_attempt_at) WHERE status IN ('pending', 'sending', 'failed');
CREATE INDEX IF NOT EXISTS idx_email_outbox_user ON public.email_outbox (user_id, created_at DESC);

ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_outbox FROM anon;

-- Administrators can see what was sent to whom; nobody else reads it.
DROP POLICY IF EXISTS email_outbox_admin_select ON public.email_outbox;
CREATE POLICY email_outbox_admin_select ON public.email_outbox
  FOR SELECT TO authenticated USING (public.admin_has('orders.read'));

CREATE OR REPLACE FUNCTION public.email_enqueue(
  p_user       UUID,
  p_template   TEXT,
  p_subject_id UUID,
  p_dedupe     TEXT,
  p_payload    JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.email_outbox (user_id, template, subject_id, dedupe_key, payload)
  SELECT p_user, p_template, p_subject_id, p_dedupe, COALESCE(p_payload, '{}'::jsonb)
  WHERE p_user IS NOT NULL
  ON CONFLICT (dedupe_key) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.email_enqueue(UUID, TEXT, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;


-- ---------------------------------------------------------------------------
-- ORDER EMAILS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_queue_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wants BOOLEAN := true;
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    IF NEW.payment_status = 'paid' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_confirmed', NEW.id,
        'order_confirmed:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    ELSIF NEW.payment_status = 'failed' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'payment_failed', NEW.id,
        'payment_failed:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    ELSIF NEW.payment_status = 'refunded' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_refunded', NEW.id,
        'order_refunded:' || NEW.id::text, jsonb_build_object('order_id', NEW.id));
    END IF;
  END IF;

  IF NEW.order_status IS DISTINCT FROM OLD.order_status
     AND NEW.order_status IN ('shipped', 'out_for_delivery', 'delivered', 'cancelled') THEN
    SELECT COALESCE(p.notify_order_updates, true) INTO v_wants
    FROM public.profiles p WHERE p.id = NEW.user_id;

    IF NEW.order_status = 'cancelled' OR COALESCE(v_wants, true) THEN
      PERFORM public.email_enqueue(NEW.user_id, 'order_' || NEW.order_status, NEW.id,
        'order_' || NEW.order_status || ':' || NEW.id::text,
        jsonb_build_object('order_id', NEW.id));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.orders_queue_emails() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_queue_emails ON public.orders;
CREATE TRIGGER trg_orders_queue_emails
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_queue_emails();


-- ---------------------------------------------------------------------------
-- CARD EMAILS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cards_queue_emails()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stamp TEXT := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSMS');
BEGIN
  IF NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.lost_at IS NOT NULL AND OLD.lost_at IS NULL THEN
    PERFORM public.email_enqueue(NEW.user_id, 'card_lost', NEW.id,
      'card_lost:' || NEW.id::text || ':' || v_stamp, jsonb_build_object('card_id', NEW.id));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'active' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_activated', NEW.id,
        'card_activated:' || NEW.id::text || ':' || v_stamp, jsonb_build_object('card_id', NEW.id));
    ELSIF NEW.status = 'suspended' AND OLD.status = 'active' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_deactivated', NEW.id,
        'card_deactivated:' || NEW.id::text || ':' || v_stamp,
        jsonb_build_object('card_id', NEW.id,
                           'expired', NEW.deactivated_at IS NULL
                                      AND NEW.activation_expires_at IS NOT NULL
                                      AND NEW.activation_expires_at <= NOW()));
    ELSIF NEW.status = 'replaced' THEN
      PERFORM public.email_enqueue(NEW.user_id, 'card_replaced', NEW.id,
        'card_replaced:' || NEW.id::text, jsonb_build_object('card_id', NEW.id));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cards_queue_emails() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cards_queue_emails ON public.cards;
CREATE TRIGGER trg_cards_queue_emails
  AFTER UPDATE ON public.cards
  FOR EACH ROW EXECUTE FUNCTION public.cards_queue_emails();


-- ---------------------------------------------------------------------------
-- THE SENDER'S HALF (service role only)
-- ---------------------------------------------------------------------------
-- Claims up to p_limit due emails. A claim is a 3-minute lease: a sender that
-- dies mid-send leaves the row to be picked up again, never lost and never
-- sent by two senders at once (SKIP LOCKED).
CREATE OR REPLACE FUNCTION public.email_outbox_claim(p_limit INT DEFAULT 10)
RETURNS SETOF public.email_outbox
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.email_outbox o
  SET status = 'sending',
      attempts = o.attempts + 1,
      locked_until = NOW() + interval '3 minutes'
  WHERE o.id IN (
    SELECT q.id FROM public.email_outbox q
    WHERE q.status IN ('pending', 'sending', 'failed')
      AND q.next_attempt_at <= NOW()
      AND (q.locked_until IS NULL OR q.locked_until < NOW())
      AND q.attempts < 6
    ORDER BY q.created_at
    LIMIT greatest(1, least(50, COALESCE(p_limit, 10)))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING o.*;
$$;

-- p_outcome: sent | retry (a failed attempt, try again later) | postpone (not
-- an attempt: e.g. the order is still being fulfilled) | skip (nothing to send).
CREATE OR REPLACE FUNCTION public.email_outbox_complete(
  p_id            UUID,
  p_outcome       TEXT,
  p_error         TEXT DEFAULT NULL,
  p_to            TEXT DEFAULT NULL,
  p_message_id    TEXT DEFAULT NULL,
  p_retry_seconds INT  DEFAULT 300
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_outcome = 'sent' THEN
    UPDATE public.email_outbox
    SET status = 'sent', sent_at = NOW(), locked_until = NULL, last_error = NULL,
        to_email = COALESCE(p_to, to_email), provider_message_id = p_message_id
    WHERE id = p_id;
  ELSIF p_outcome = 'postpone' THEN
    UPDATE public.email_outbox
    SET status = 'pending', attempts = greatest(0, attempts - 1), locked_until = NULL,
        next_attempt_at = NOW() + make_interval(secs => greatest(10, COALESCE(p_retry_seconds, 60)))
    WHERE id = p_id;
  ELSIF p_outcome = 'skip' THEN
    UPDATE public.email_outbox
    SET status = 'skipped', locked_until = NULL, last_error = left(p_error, 500)
    WHERE id = p_id;
  ELSE
    UPDATE public.email_outbox
    SET status = 'failed', locked_until = NULL, last_error = left(p_error, 500),
        to_email = COALESCE(p_to, to_email),
        next_attempt_at = NOW() + make_interval(secs => greatest(30, COALESCE(p_retry_seconds, 300)))
    WHERE id = p_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.email_outbox_claim(INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.email_outbox_complete(UUID, TEXT, TEXT, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_outbox_claim(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.email_outbox_complete(UUID, TEXT, TEXT, TEXT, TEXT, INT) TO service_role;

-- ============================================================================
-- VERIFY
--   SELECT template, status, attempts, last_error, created_at
--   FROM public.email_outbox ORDER BY created_at DESC LIMIT 20;
-- ============================================================================
