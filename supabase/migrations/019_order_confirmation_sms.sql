-- 019: the order confirmation text message.
--
-- When a paid order is fulfilled, the server texts the customer's checkout
-- number (netlify/lib/orderMessages.mjs). These columns make that exactly
-- once — the sender claims the row by setting confirmation_sms_at where it is
-- still NULL — and record how it went for the admin panel:
--   sending | sent | no_phone | not_configured | failed
--
-- Server-only: customers' own order reads are unaffected, and no policy lets
-- a browser write them. Idempotent.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS confirmation_sms_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS confirmation_sms_status text;
