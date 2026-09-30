-- Fix: public.products has no updated_at column. Keep stock fulfilment atomic/idempotent.
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
    RAISE EXCEPTION 'Insufficient stock for %', p_sku USING ERRCODE = 'P0001';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_card_stock(UUID, TEXT, INT) TO service_role;
