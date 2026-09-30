-- SHYGON TAP V5 — final completion hardening
-- 1) Event themes are a platform presentation layer and must apply to every
--    experience during the event window; they are not paid catalogue options.
-- 2) Physical-card stock decrements are idempotent per order item so fulfilment
--    retries cannot consume stock twice.

CREATE OR REPLACE FUNCTION public.get_public_profile(p_slug TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tap         public.tap_profiles%ROWTYPE;
  v_tier        TEXT;
  v_pass        BOOLEAN;
  v_owned       TEXT[];
  v_shown       TEXT[];
  v_clamp       TEXT;
  v_event       JSONB;
  v_event_theme JSONB;
  v_base        JSONB;
  v_eff         JSONB;
BEGIN
  SELECT * INTO v_tap
  FROM public.tap_profiles t
  WHERE lower(t.slug) = lower(btrim(COALESCE(p_slug, '')))
    AND t.status = 'active'
    AND t.suspended_at IS NULL
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_tier := public.user_max_ui_tier(v_tap.user_id);
  v_pass := public.user_has_pass(v_tap.user_id);

  SELECT COALESCE(array_agg(e.key), '{}') INTO v_owned
  FROM public.entitlements e
  WHERE e.user_id = v_tap.user_id AND e.is_active AND e.type = 'customization';

  v_shown := ARRAY(
    SELECT unnest(v_tap.enabled_customizations)
    INTERSECT
    SELECT unnest(v_owned || ARRAY['phone','email'])
  );

  v_clamp := CASE
    WHEN public.tier_rank(v_tap.selected_ui_tier) <= public.tier_rank(v_tier)
      THEN public.canonical_experience(v_tap.selected_ui_tier)
    ELSE v_tier
  END;

  v_base := jsonb_build_object(
    'palette', CASE WHEN v_tap.theme_palette = ANY(public.theme_options('palette', v_clamp, v_pass)) THEN v_tap.theme_palette ELSE 'midnight' END,
    'layout', CASE WHEN v_tap.theme_layout = ANY(public.theme_options('layout', v_clamp, v_pass)) THEN v_tap.theme_layout ELSE 'classic' END,
    'buttons', CASE WHEN v_tap.theme_buttons = ANY(public.theme_options('buttons', v_clamp, v_pass)) THEN v_tap.theme_buttons ELSE 'solid' END,
    'font', CASE WHEN v_tap.theme_font = ANY(public.theme_options('font', v_clamp, v_pass)) THEN v_tap.theme_font ELSE 'sans' END,
    'animation', CASE WHEN v_tap.theme_animation = ANY(public.theme_options('animation', v_clamp, v_pass)) THEN v_tap.theme_animation ELSE 'auto' END
  );

  v_event := public.tap_event_theme_for(now());
  v_event_theme := COALESCE(v_event->'theme', '{}'::jsonb);

  -- Event styling is platform-controlled and applies globally while active.
  -- It is not a customer entitlement and must therefore not be filtered through
  -- theme_options(). The customer's saved theme remains in baseTheme.
  v_eff := jsonb_build_object(
    'palette', COALESCE(NULLIF(v_event_theme->>'palette',''), v_base->>'palette'),
    'layout', COALESCE(NULLIF(v_event_theme->>'layout',''), v_base->>'layout'),
    'buttons', COALESCE(NULLIF(v_event_theme->>'buttons',''), v_base->>'buttons'),
    'font', COALESCE(NULLIF(v_event_theme->>'font',''), v_base->>'font'),
    'animation', COALESCE(NULLIF(v_event_theme->>'animation',''), v_base->>'animation')
  );

  RETURN jsonb_build_object(
    'slug', v_tap.slug,
    'experience', v_clamp,
    'displayName', v_tap.display_name,
    'headline', v_tap.headline,
    'designation', v_tap.designation,
    'company', v_tap.company,
    'bio', v_tap.bio,
    'avatarUrl', v_tap.avatar_url,
    'location', CASE WHEN 'location' = ANY(v_shown) THEN v_tap.location END,
    'phone', CASE WHEN 'phone' = ANY(v_shown) THEN v_tap.phone END,
    'whatsapp', CASE WHEN 'whatsapp' = ANY(v_shown) THEN v_tap.whatsapp END,
    'email', CASE WHEN 'email' = ANY(v_shown) THEN v_tap.email END,
    'website', CASE WHEN 'website' = ANY(v_shown) THEN v_tap.website END,
    'instagram', CASE WHEN 'instagram' = ANY(v_shown) THEN v_tap.instagram END,
    'linkedin', CASE WHEN 'linkedin' = ANY(v_shown) THEN v_tap.linkedin END,
    'youtube', CASE WHEN 'youtube' = ANY(v_shown) THEN v_tap.youtube END,
    'customLinks', CASE WHEN 'links' = ANY(v_shown) THEN v_tap.custom_links ELSE '[]'::jsonb END,
    'theme', v_eff,
    'baseTheme', v_base,
    'activeEvent', NULLIF(v_event, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_profile(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(TEXT) TO anon;
REVOKE EXECUTE ON FUNCTION public.get_public_profile(TEXT) FROM authenticated;

CREATE TABLE IF NOT EXISTS public.order_item_fulfillment_actions (
  order_item_id UUID NOT NULL REFERENCES public.order_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (order_item_id, action)
);

ALTER TABLE public.order_item_fulfillment_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_fulfillment_actions_none ON public.order_item_fulfillment_actions;
CREATE POLICY order_item_fulfillment_actions_none
  ON public.order_item_fulfillment_actions
  FOR ALL TO public USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.fulfil_card_stock(
  p_order_item_id UUID,
  p_sku TEXT,
  p_quantity INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INT;
  v_updated INT;
BEGIN
  IF p_order_item_id IS NULL OR NULLIF(btrim(p_sku), '') IS NULL OR p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Invalid stock fulfilment request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.order_item_fulfillment_actions(order_item_id, action)
  VALUES (p_order_item_id, 'stock_decrement')
  ON CONFLICT (order_item_id, action) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE public.products
  SET stock = stock - p_quantity
  WHERE sku = p_sku
    AND product_type = 'card'
    AND stock IS NOT NULL
    AND stock >= p_quantity;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    -- The ledger row is deliberately in the same transaction, so this rollback
    -- releases the claim and a later reconciliation can retry safely.
    RAISE EXCEPTION 'Insufficient stock for %', p_sku USING ERRCODE = 'P0001';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) TO service_role;

COMMENT ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) IS
'Idempotently consumes physical-card inventory once per order item during payment fulfilment.';
