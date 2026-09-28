-- SHYGON TAP V5 — RELIABLE PAYMENT FULFILMENT
-- Prevents a paid order from becoming permanently "done" when an entitlement,
-- card, profile or other fulfilment side effect fails after the initial claim.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_fulfillment_status_valid') THEN
    ALTER TABLE public.orders ADD CONSTRAINT orders_fulfillment_status_valid
      CHECK (fulfillment_status IN ('pending','processing','retry','fulfilled')) NOT VALID;
  END IF;
END $$;

-- Existing paid orders were already handled by the old success path. Mark them
-- fulfilled so this migration itself never re-decrements inventory.
UPDATE public.orders
SET fulfillment_status = 'fulfilled',
    fulfilled_at = COALESCE(fulfilled_at, updated_at, created_at)
WHERE payment_status = 'paid'
  AND fulfillment_status = 'pending';

CREATE INDEX IF NOT EXISTS orders_fulfillment_retry_idx
  ON public.orders (fulfillment_status, updated_at)
  WHERE fulfillment_status IN ('processing','retry');
