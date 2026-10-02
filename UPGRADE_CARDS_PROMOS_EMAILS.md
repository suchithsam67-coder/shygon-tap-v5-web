# SHYGON Tap V5: cards, pages, promo codes, emails (2026-09-29)

Added to the existing site. The design, routes and existing flows are unchanged.

## Status: NOT ready for production (review of 2026-10-02, branch `fix/upgraded-zip`)

Do not apply these migrations to the live project and do not deploy this build yet.

* **Never paste `supabase/APPLY_ALL.sql` into the SQL editor.** It replays migrations 001–019 onto live,
  which changes 48 live objects and breaks sign-up (DEC-2026-023; `docs/governance/SCHEMA_DRIFT_REPORT.md`).
* The migrations are now **022–028** (019 is the live order-SMS migration; 020–021 are reserved for M0.3).
* **022 refuses to run on live** until two owner decisions are made (DEC-2026-033):
  1. live `tap_profiles_customer_id_key` allows one page per customer record, so "one page per card" cannot work;
  2. live `cards.card_id` is NOT NULL with no default (I-4), so no card can be issued.
* New pages are **drafts** until the customer publishes them (owner decision D-U4).
* Migrations reach production only through the approved process (DEC-2026-023), never by pasting files.

When those decisions are made and implemented, the remaining one-time setup is:

1. **Razorpay webhook:** add `refund.processed` and `refund.failed` (keep `payment.authorized`,
   `payment.captured`, `order.paid`, `payment.failed`).
2. **Environment variables** (Vercel): an email provider (Gmail SMTP or Resend) and `CRON_SECRET`
   (bottom of `.env.example`). The Vercel cron in `vercel.json` runs **once a day** (03:00 UTC); for prompt
   shipped/delivered/payment-failed emails add a Supabase Database Webhook on `email_outbox` → `/api/send-emails`.
3. **GST:** Admin app → More → *GST & invoices*: GSTIN, rate, inclusive pricing (default 18%, included).
4. **Stock:** Admin app → More → *Card stock* → import the chip ids of each printed batch.
5. **New cards:** write `https://shygontech.com/c/<CARD ID>` to each new card's NFC chip. Cards already
   printed keep working.

## What each feature is

| Feature | Where |
|---|---|
| Promo codes `DRAGON` 30%, `NEWTAP` 20% (on the cart value, before delivery) | Checkout; priced and reserved server-side (`create-order`, `promo_reserve`) |
| Expiry, start date, usage limit, per-customer limit, minimum, cap | `promo_codes` table; admin RPCs `admin_list_promo_codes`, `admin_upsert_promo_code`, `admin_set_promo_code_active` (audited) |
| ₹49 delivery on every card order | `products` row `delivery-standard` (change the price there) |
| Custom card ₹799 (any material/finish) | Store, builder, `/shygontap/store/custom`; SKUs `card-custom-*` |
| One page per card, created as a draft the customer publishes (D-U4) | DB trigger when a card is issued; replacement cards keep the old card's page |
| Permanent Card ID, nickname, activate, deactivate, report lost, replacement | *My cards* |
| Card opening animation per card design | Plays when a page is opened from a card link |
| Custom URL slug (old address keeps redirecting) | Tap profile → Change address |
| Analytics: taps, unique visitors, views, button clicks, QR, devices, daily/weekly/monthly, per card, tap history | Analytics |
| Order tracking: Placed → Payment confirmed → Preparing → Shipped → Out for delivery → Delivered | Orders (statuses set by the Admin app as before) |
| E-bill on every paid order, Billing page | Orders → View e-bill, Billing |
| Emails: order confirmation + e-bill, payment failed, shipped, out for delivery, delivered, cancelled, refunded, card activated/deactivated/lost/replaced | `email_outbox` (queued by DB triggers) → `netlify/lib/email.mjs` |
| Card one-time codes by email when SMS is not configured | `card-otp` |
| Sign out of all other devices | Settings → Security |
| Webhook refuses to fulfil if the captured amount ≠ the order amount | `razorpay-webhook` |

## Production-readiness additions (migration 026)

| Feature | Where |
|---|---|
| GST computed on the server (inclusive or added), CGST+SGST in-state / IGST otherwise, stored on the order | `create-order`, `tax_settings`; e-bill, Orders, order email |
| Billing address (or same as shipping), optional customer GSTIN | Checkout; stored on the order |
| Order timeline with timestamps | `order_status_history` (trigger) → Orders |
| Customer cancellation request (paid, not shipped) | Orders → Cancel order → support ticket + admin alert; the admin refunds |
| Refund sync from Razorpay (`refund.processed` / `refund.failed`), no double refund | `razorpay-webhook` → `orders_refund_from_webhook` |
| Physical card stock: import chip ids, assign to a paid card (design/finish/material checked), damaged, retired | Admin: Card stock, Cards → From stock |
| Admin card actions: activate, deactivate, lost, damaged, shipped, full history | Admin: Cards |
| Store funnel: visit → view → cart → checkout → payment → purchase (anonymous session ids) | `track_store_event`; Admin: Store funnel |
| Support emails: request received, reply | `email_outbox` |

## Store and checkout additions (migrations 027–028)

| Feature | Where |
|---|---|
| Buy Now → **Card details** → Delivery → Payment. Name on card, title, company and contact buttons; the new page is created already filled in once the payment is verified | `/shygontap/card-details`; `orders.profile_details`; `applyProfileDetails` in fulfilment |
| Limited-edition number shown like a watch caseback (Chapter I · Nº 037 / 100; ranges for several cards) | Card details page |
| Buttons by tier: Essential = call, email, WhatsApp · Business + Instagram, LinkedIn, website · Premium + location, YouTube, custom links · GOAT + photo gallery. Add-ons still unlock a button on any tier | `public.tier_buttons()` (public page, editor save rule) and `src/lib/tierButtons.ts` (display) |
| Quantity (1–10; experience charged once), Save for later, Recently viewed, Saved filter | Product page, Store. **Known gap:** fulfilment issues one card record per order line, so an order for 3 cards gets 1 card and 1 page. Fixing it depends on the card model (I-4, DEC-2026-028) |
| Share: native share sheet, WhatsApp, copy link | Product page |
| Verified-buyer reviews and star ratings (only paying customers, one per design, first name + initial shown) | Product page; admin app → Reviews (hide/show, audited) |
| Buy again (same design, material and finish) | Orders |

## Fixed on the way

* Card issuing used an upsert that could never match the partial unique index on `cards(order_id, sku)`,
  so no card row was ever created. It is now a plain insert. On live it still fails until I-4 is decided
  (`cards.card_id` NOT NULL, uniqueness on `(order_id, sku, card_slot)`).
* Admin customer RPCs used scalar sub-queries on `tap_profiles` that would error once a customer has two pages.

The 2026-10-02 review fixed more; see `git log fix/upgraded-zip` for each change and its evidence.

## Tests

```
npm run db:apply         # all migrations, twice (history chain)
npm run db:verify        # 23 existing + 51 upgrade checks
npm run test:functions   # checkout/payment/webhook/GST/card details (20), security (14), email templates (8)
npm run test:payments:ci # Razorpay confirmation + order SMS (15) and security, network denied
npm run build && npm run test:bundle
```
