-- 025: verified-buyer product reviews
--
-- Star ratings and short reviews on each card's product page.
--   * Only a customer with a PAID order for that card design can review it
--     (every review is a verified purchase), once per design; writing again
--     updates their review.
--   * The public reads reviews through get_product_reviews(): first name and
--     initial only, never an email, user id or order.
--   * An administrator can hide a review (products.manage), audited.
-- The table itself has RLS on and no policies: every read and write goes
-- through the functions below.
--
-- Idempotent. Rollback: DROP FUNCTION public.get_product_reviews(TEXT, INT),
-- public.submit_product_review(TEXT, INT, TEXT, TEXT), public.my_product_review(TEXT),
-- public.admin_list_reviews(TEXT, INT, INT), public.admin_set_review_hidden(UUID, BOOLEAN, TEXT);
-- DROP TABLE public.product_reviews;

CREATE TABLE IF NOT EXISTS public.product_reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  TEXT NOT NULL CHECK (product_id ~ '^[a-z0-9-]{2,40}$'),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title       TEXT CHECK (title IS NULL OR length(title) <= 80),
  body        TEXT CHECK (body IS NULL OR length(body) <= 800),
  hidden      BOOLEAN NOT NULL DEFAULT false,
  hidden_reason TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON public.product_reviews (product_id, created_at DESC) WHERE NOT hidden;
ALTER TABLE public.product_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.product_reviews FROM anon, authenticated;

-- Has this customer paid for a card of this design?
CREATE OR REPLACE FUNCTION public.bought_product(p_user UUID, p_product TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.orders o
    JOIN public.order_items i ON i.order_id = o.id
    WHERE o.user_id = p_user AND o.payment_status = 'paid'
      AND i.sku ~ ('^card-' || p_product || '-(standard|premium)-(pvc|metal|transparent)$'));
$$;
REVOKE ALL ON FUNCTION public.bought_product(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_product_reviews(p_product TEXT, p_limit INT DEFAULT 20)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'count', (SELECT count(*) FROM public.product_reviews WHERE product_id = p_product AND NOT hidden),
    'average', (SELECT round(avg(rating)::numeric, 1) FROM public.product_reviews WHERE product_id = p_product AND NOT hidden),
    'stars', (SELECT jsonb_object_agg(s, COALESCE(n, 0)) FROM generate_series(1, 5) s
              LEFT JOIN (SELECT rating, count(*) n FROM public.product_reviews
                         WHERE product_id = p_product AND NOT hidden GROUP BY rating) c ON c.rating = s),
    'reviews', COALESCE((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC) FROM (
        SELECT jsonb_build_object(
          'id', pr.id, 'rating', pr.rating, 'title', pr.title, 'body', pr.body,
          'created_at', pr.created_at, 'updated', pr.updated_at > pr.created_at + interval '1 minute',
          'author', COALESCE(NULLIF(split_part(btrim(p.full_name), ' ', 1), ''), 'SHYGON customer')
                    || COALESCE(' ' || NULLIF(left(split_part(btrim(p.full_name), ' ', 2), 1), '') || '.', ''),
          'verified', true) AS r
        FROM public.product_reviews pr LEFT JOIN public.profiles p ON p.id = pr.user_id
        WHERE pr.product_id = p_product AND NOT pr.hidden
        ORDER BY pr.created_at DESC
        LIMIT least(greatest(COALESCE(p_limit, 20), 1), 50)) x), '[]'::jsonb)
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_product_reviews(TEXT, INT) TO anon, authenticated;

-- The signed-in customer's own review, and whether they may write one.
CREATE OR REPLACE FUNCTION public.my_product_review(p_product TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'eligible', auth.uid() IS NOT NULL AND public.bought_product(auth.uid(), p_product),
    'review', (SELECT jsonb_build_object('rating', rating, 'title', title, 'body', body, 'hidden', hidden)
               FROM public.product_reviews WHERE product_id = p_product AND user_id = auth.uid()));
$$;
GRANT EXECUTE ON FUNCTION public.my_product_review(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_product_review(p_product TEXT, p_rating INT, p_title TEXT, p_body TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_title TEXT := NULLIF(left(btrim(COALESCE(p_title, '')), 80), '');
  v_body  TEXT := NULLIF(left(btrim(COALESCE(p_body, '')), 800), '');
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to write a review.' USING ERRCODE = '42501'; END IF;
  IF p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Choose 1 to 5 stars.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.bought_product(v_user, p_product) THEN
    RAISE EXCEPTION 'Only customers who bought this card can review it.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.product_reviews (product_id, user_id, rating, title, body)
  VALUES (p_product, v_user, p_rating, v_title, v_body)
  ON CONFLICT (product_id, user_id) DO UPDATE
    SET rating = EXCLUDED.rating, title = EXCLUDED.title, body = EXCLUDED.body, updated_at = NOW();
  RETURN public.my_product_review(p_product);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_product_review(TEXT, INT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_product_review(TEXT, INT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_reviews(p_product TEXT DEFAULT NULL, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.require_admin('products.read');
  RETURN jsonb_build_object(
    'total', (SELECT count(*) FROM public.product_reviews WHERE p_product IS NULL OR product_id = p_product),
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
        SELECT pr.id, pr.product_id, pr.rating, pr.title, pr.body, pr.hidden, pr.hidden_reason, pr.created_at,
               pr.user_id, p.full_name AS customer_name, p.email AS customer_email
        FROM public.product_reviews pr LEFT JOIN public.profiles p ON p.id = pr.user_id
        WHERE p_product IS NULL OR pr.product_id = p_product
        ORDER BY pr.created_at DESC
        LIMIT least(greatest(COALESCE(p_limit, 50), 1), 200) OFFSET greatest(COALESCE(p_offset, 0), 0)) x), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_list_reviews(TEXT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_reviews(TEXT, INT, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_review_hidden(p_id UUID, p_hidden BOOLEAN, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin UUID := public.require_admin('products.manage');
  v_row   public.product_reviews%ROWTYPE;
BEGIN
  UPDATE public.product_reviews
     SET hidden = COALESCE(p_hidden, true),
         hidden_reason = CASE WHEN COALESCE(p_hidden, true) THEN NULLIF(btrim(COALESCE(p_reason, '')), '') END
   WHERE id = p_id
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found.' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.admin_audit(v_admin, CASE WHEN v_row.hidden THEN 'review.hidden' ELSE 'review.shown' END,
    'review', p_id::text, jsonb_build_object('product', v_row.product_id, 'reason', p_reason));
  RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_review_hidden(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_review_hidden(UUID, BOOLEAN, TEXT) TO authenticated;
