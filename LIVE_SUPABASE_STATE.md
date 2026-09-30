# Live Supabase state

Project: `auvgvikdbhbrtsrsaslv` (`shygon-tap-v5`, ap-south-1).

The live database has the V5 event calendar, 14-day edit interval, server-side edit/entitlement enforcement, retryable fulfilment, atomic/idempotent physical-card stock consumption, and hardened RPC permissions.

Current verification performed during this pass:
- 14-day interval: 14 days.
- Active event catalogue: 19 events.
- 14 September 2026 resolves to Ganesh Chaturthi with the configured molten/immersive/glow/display/dynamic theme.
- Stock fulfilment was exercised twice for the same order item inside a transaction; the operation completed without a duplicate-decrement error, and the transaction was rolled back.
- The stock fulfilment RPC is executable only by `service_role`; anonymous and authenticated roles are revoked.

## 2026-09-27 — migration 012 applied to live

`supabase/migrations/012_products_anon_read_without_admin_check.sql` was run in
the SQL editor. The live `products` table had a single SELECT policy created
outside the migrations, `products_public_or_admin_select`
(`active IS NOT FALSE OR (SELECT is_admin())`, TO public). EXECUTE on
`is_admin()` is revoked from `anon`, so every signed-out catalogue read failed
with 42501 / HTTP 401. It is now two policies:

- `products_select_active` — TO anon, authenticated — `active IS NOT FALSE`
- `products_select_admin_all` — TO authenticated — `(SELECT is_admin())`

Verified afterwards with the publishable key: anon read 200 (34 active rows,
0 inactive), anon `is_admin()` still 401. Rollback SQL is in the file header.

The publishable key in `.env` was also replaced: the previous
`sb_publishable_44sF…` belonged to the deleted project and is rejected.

Other public-role SELECT policies that call `is_admin()` (cards, notifications,
orders, profiles, support_messages, support_tickets, tap_events) have the same
shape. The app never reads those signed out, so they were left unchanged.

## 2026-09-27 — migration 013 (admin platform) applied to live

Live already had 003's tables and columns but none of its functions, admin
read policies or alert triggers, so the Admin APK stopped at "not set up".
`supabase/migrations/013_admin_platform_live.sql` is 003 adapted to this
database (differences are listed in its header). Order of work:

1. `supabase/tests/013_live_dry_run.sql` was run first. It applies 013 inside a
   transaction, calls every admin read RPC as the owner, checks the anonymous
   paths, then raises so everything rolls back. Result: every admin RPC ok;
   anon products/public profile/public tap ok; anon admin RPCs denied. The one
   ERR (anon SELECT on orders -> "permission denied for function is_admin")
   predates 013: live's `orders_select_owner_or_admin` policy is TO public.
2. 013 was then run in the SQL editor.

Verified afterwards: 45 admin_* functions (43 from 003 + live's
admin_set_product_inventory and admin_update_order_shipping, left as they
were); admin_reply_ticket returns jsonb; 19/19 admin policies TO authenticated;
4 alert triggers; realtime publication = orders, admin_notifications; the
three added columns present; get_public_tap keeps live's card gating plus the
suspension check. Owner: shygontech@gmail.com (owner, active).

Not exercised yet because live has no rows: admin_get_order, admin_get_tap,
admin_set_tap_suspension, admin_reply_ticket.

Known, pre-existing, harmless: the *_select_owner_or_admin policies on cards,
notifications, orders, profiles, support_messages, support_tickets and
tap_events are TO public and call is_admin(), so a signed-out read of those
tables errors instead of returning nothing. No app reads them signed out.

## 2026-09-27 — migration 014 (live customer notifications) applied to live

`supabase/migrations/014_realtime_customer_notifications.sql` adds
`public.notifications` to the `supabase_realtime` publication, which now holds
admin_notifications, notifications and orders. RLS still decides what each
subscriber receives.

Consumers:
- Website: `src/components/app/LiveNotifications.tsx` (toast, live bell count,
  desktop notification while the tab is in the background).
- Admin app: `src/lib/liveAlerts.tsx` (banner on every screen for new
  admin_notifications rows, desktop notification on web).

Verified end to end for the admin app: a test row inserted into
admin_notifications ("Test alert: live notifications are on", id
674a5042-3454-4750-a26e-e508ac5616f2) appeared as a banner on the Customers
screen within about a second.

## 2026-09-28 — migration 015 (card OTP) applied to live

`supabase/migrations/015_card_otp_activation.sql`: table
`card_otp_challenges` (RLS on, no policies, revoked from anon/authenticated)
and `card_apply_verified_action(uuid, uuid, text)` (SECURITY DEFINER, execute
granted to service_role only). It applies the same rules as the live
`customer_activate_card` / `customer_deactivate_card` (activation lasts 14
days; only an active card can be deactivated; replaced cards cannot change),
then writes a customer notification and an admin alert (severity warning for
deactivation, link /customers/<user_id>).

Verified: table and function exist; anon read of the table 401; anon and
authenticated cannot execute the function; the store still loads.

Called only by `netlify/functions/card-otp.mjs`, which needs SMS_PROVIDER and
its credentials in Netlify (see .env.example). Until then it answers 503
"Text messages are not set up yet".

Live rule worth reviewing: customer_activate_card (and so this flow) sets
activation_expires_at = now() + 14 days, and expire_tap_cards() suspends
cards whose activation has expired — a card stops opening its Tap 14 days
after activation unless renewed.

## 016_card_art_image_urls.sql — APPLIED 2026-09-28

Points products.image_url for the card SKUs at the new SVG card art
(/assets/cards/<product>-<material>[-premium].svg). The old card photographs
were retired. Nothing on screen reads image_url; this keeps the catalogue
record accurate. Verified: card products now name the .svg art.
Touches only rows still pointing at an old .png/.jpeg; idempotent. Tested on
Postgres (PGlite) with custom URLs left alone.

## 017_limited_edition_numbers.sql — APPLIED 2026-09-28

Every card is a numbered limited edition, per design, in chapters of 100
(`card_editions`: business Obsidian Feather, restaurant Copper Lotus, event
Emerald Arch, google-review Ivory Bloom). A BEFORE INSERT trigger on `cards`
gives each issued card the next serial of its design (edition_design,
edition_serial, edition_count, edition_chapter_size); chapter = (serial-1)/100+1,
number = (serial-1)%100+1. Webhook replays take no number; replacements take
none. Verified on live: anon can read card_editions (the store shows
"Chapter I · N of 100 left"), anon cannot update it, the trigger function is
not callable. Tested on Postgres (PGlite): replay, multi-card line, rollover
to Chapter II at serial 101, backfill.

## 018_design_collection_products.sql — APPLIED 2026-09-28

The Design Collection: six more cards (obsidian-smoke, rose-marble,
carbon-aurum, sandstone-jaali, sapphire-night, aurora-glass). 36 product rows
(finish x material, Business prices, stock 100 each) and six card_editions rows
(chapters of 100). Verified: 36 new card rows, 10 editions in total.

## 019_order_confirmation_sms.sql — APPLIED 2026-09-29

Two columns on orders (confirmation_sms_at, confirmation_sms_status) that make
the order confirmation text exactly-once. Verified on live: both columns exist
(timestamptz, text). The text itself still needs SMS_PROVIDER set on the host.
