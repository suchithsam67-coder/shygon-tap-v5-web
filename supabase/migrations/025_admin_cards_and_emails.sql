-- ============================================================================
-- 025 — ADMIN APP: CARDS AND EMAILS
-- ============================================================================
-- Run AFTER 024. Idempotent. Additive: nothing existing is changed.
--
-- The Admin app reads only through SECURITY DEFINER RPCs (013's pattern), so
-- the cards (with their Card IDs, 022) and the customer email outbox (024) get
-- the same: a paged list for each, and a retry for an email that failed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_list_cards(
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,   -- pending | shipped | active | suspended | lost | replaced
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT  := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT  := greatest(COALESCE(p_offset, 0), 0);
  v_q      TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_code   TEXT := public.normalise_card_code(p_search);
  v_total  BIGINT;
  v_rows   JSONB;
BEGIN
  PERFORM public.require_admin('orders.read');

  WITH filtered AS (
    SELECT c.*, p.full_name, p.email, t.slug, o.order_id AS order_reference
    FROM public.cards c
    LEFT JOIN public.profiles p ON p.id = c.user_id
    LEFT JOIN public.tap_profiles t ON t.id = c.tap_profile_id
    LEFT JOIN public.orders o ON o.id = c.order_id
    WHERE (v_q IS NULL
           OR c.card_code = v_code
           OR c.card_uid ILIKE '%' || v_q || '%'
           OR c.nickname ILIKE '%' || v_q || '%'
           OR p.full_name ILIKE '%' || v_q || '%'
           OR p.email ILIKE '%' || v_q || '%'
           OR t.slug ILIKE '%' || v_q || '%'
           OR o.order_id ILIKE '%' || v_q || '%')
      AND (p_status IS NULL
           OR (p_status = 'lost' AND c.lost_at IS NOT NULL)
           OR (p_status <> 'lost' AND c.status = p_status AND (p_status <> 'suspended' OR c.lost_at IS NULL)))
  )
  SELECT
    (SELECT count(*) FROM filtered),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'card_code', f.card_code, 'card_uid', f.card_uid, 'nickname', f.nickname,
        'sku', f.sku, 'status', f.status, 'lost_at', f.lost_at, 'is_replacement', f.is_replacement,
        'replaces_card_id', f.replaces_card_id, 'activation_expires_at', f.activation_expires_at,
        'tap_count', f.tap_count, 'last_tapped_at', f.last_tapped_at, 'created_at', f.created_at,
        'user_id', f.user_id, 'customer_name', f.full_name, 'customer_email', f.email,
        'tap_profile_id', f.tap_profile_id, 'tap_slug', f.slug,
        'order_id', f.order_id, 'order_reference', f.order_reference,
        'edition_serial', f.edition_serial, 'edition_chapter_size', f.edition_chapter_size)
        ORDER BY f.created_at DESC)
      FROM (SELECT * FROM filtered ORDER BY created_at DESC LIMIT v_limit OFFSET v_offset) f
    ), '[]'::jsonb)
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_emails(
  p_status TEXT DEFAULT NULL,   -- pending | sending | sent | failed | skipped
  p_limit  INT  DEFAULT 25,
  p_offset INT  DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit  INT := least(greatest(COALESCE(p_limit, 25), 1), 100);
  v_offset INT := greatest(COALESCE(p_offset, 0), 0);
BEGIN
  PERFORM public.require_admin('orders.read');

  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.email_outbox e WHERE p_status IS NULL OR e.status = p_status),
    'limit', v_limit,
    'offset', v_offset,
    'counts', (SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb)
               FROM (SELECT status, count(*) AS n FROM public.email_outbox GROUP BY status) s),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'template', e.template, 'status', e.status, 'attempts', e.attempts,
        'last_error', e.last_error, 'to_email', COALESCE(e.to_email, p.email),
        'customer_name', p.full_name, 'user_id', e.user_id, 'subject_id', e.subject_id,
        'created_at', e.created_at, 'sent_at', e.sent_at, 'next_attempt_at', e.next_attempt_at)
        ORDER BY e.created_at DESC)
      FROM (SELECT * FROM public.email_outbox x
            WHERE p_status IS NULL OR x.status = p_status
            ORDER BY x.created_at DESC LIMIT v_limit OFFSET v_offset) e
      LEFT JOIN public.profiles p ON p.id = e.user_id
    ), '[]'::jsonb)
  );
END;
$$;

-- Puts a failed or skipped email back in the queue, to go out on the next run.
CREATE OR REPLACE FUNCTION public.admin_retry_email(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('orders.fulfil');
BEGIN
  UPDATE public.email_outbox
  SET status = 'pending', attempts = 0, next_attempt_at = NOW(), locked_until = NULL, last_error = NULL
  WHERE id = p_id AND status IN ('failed', 'skipped');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only a failed or skipped email can be retried.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.admin_audit(v_admin, 'email.retried', 'email', p_id::text, NULL);
  RETURN (SELECT to_jsonb(e) - 'payload' FROM public.email_outbox e WHERE e.id = p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_cards(TEXT, TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_emails(TEXT, INT, INT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_retry_email(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_cards(TEXT, TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_emails(TEXT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_email(UUID) TO authenticated;
