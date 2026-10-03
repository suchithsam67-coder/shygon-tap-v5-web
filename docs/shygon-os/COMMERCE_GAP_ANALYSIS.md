# Commerce platform brief (2026-10-03): inspection and gap analysis

This answers §31 of the owner brief "Upgrade the existing e-commerce project into a complete, production-ready, full-stack e-commerce platform". The brief asks to inspect everything before changing anything. Nothing has been changed; the decision this feeds is **DEC-2026-034**.

**Correction, 2026-10-03.** Row 23 (SEO) originally listed the sitemap, robots.txt and Product/Breadcrumb JSON-LD as missing. They exist: `src/seo/build.ts` generates them at build time. The inspection's search matched that file, but the file was not read before it was recorded as missing. Row 23 and phase C5 now state what was observed.

Evidence labels follow G§67:
- **OBSERVED**: read in code, the live schema dump or the branch.
- **HYPOTHESIZED**: an inference, not verified.

## 1. What exists today (OBSERVED)

### Frontend

**Stack:** Vite 7, React 19, TypeScript and react-router 7, served from Vercel or Netlify.

**Public Tap:** `/t/:slug` is the only route in the entry bundle, with a 90 kB gzip budget (DEC-2026-019).

**Routes:** everything else lazy-loads behind `AccountApp`:

| Group | Routes |
|---|---|
| Storefront | `/shygontap` (home + builder), `/shygontap/store` (search, sort, filter), `/shygontap/store/:productId` (detail + related) |
| Auth | `/shygontap/auth` (email + password sign-up and sign-in, password reset) |
| Account | account, tap editor, tiers, customize, QR, cards (OTP activation), customizations, checkout, orders, notifications, analytics, support, settings |
| Legal | privacy, terms, cookies, refund, shipping |
| Other | 404 |

### Server
Six functions, in `netlify/functions`, mirrored by the `api/*.mjs` Vercel adapters:

| Function | Role |
|---|---|
| `create-order` | Prices server-side from `products` |
| `verify-payment` | HMAC check, then confirms with Razorpay |
| `razorpay-webhook` | Signature check, idempotent through `webhook_events` |
| `payment-mode` | Reports test or live |
| `check-delivery` | PIN-code serviceability via a public postal API |
| `card-otp` | Card activation codes over SMS |

Razorpay Checkout already offers UPI, cards, net banking and wallets.

### Database (live Supabase, `supabase/baseline/000_live_baseline.sql`)

| | Live today |
|---|---|
| Tables (30) | `products`, `card_editions`, `cards`, `inventory_movements`, `orders`, `order_items`, `payments`, `webhook_events`, `order_status_history`, `order_item_fulfillment_actions`, `entitlements`, `customizations`, `customer_customizations`, `customers`, `profiles`, `tap_profiles`, `tap_events`, `tap_event_themes`, `ui_plans`, `notifications`, `support_tickets`, `support_messages`, `account_events`, `card_otp_challenges`, `admin_users`, `admin_audit_log`, `admin_notifications`, `admin_notification_reads`, `admin_push_tokens`, `admin_allowed_email_domains` |
| Functions | 93, including 45 `admin_*` RPCs |
| RLS policies | 55 |
| Order statuses | pending → processing → shipped → delivered, plus cancelled and refunded |
| Admin roles | owner, admin, fulfilment, support, viewer, with permission strings such as `orders.refund` (`admin_has`) |

### Admin
The admin is a separate Expo app, `../shygon-tap-v5-admin`, on web and Android. Its screens:
- dashboard, orders (+ detail), customers (+ detail), support (+ detail);
- catalog, inventory, analytics, audit, administrators;
- notifications, settings, taps.

### Not merged
Branch `fix/upgraded-zip` (worktree `../shygon-tap-v5-web-upgrade-fix`) holds migrations 022–028:
- promo codes;
- delivery fields;
- a custom card;
- an email outbox with sender functions;
- admin cards and emails;
- tax / billing / inventory funnel;
- product reviews.

It is **not deployable** until DEC-2026-033 Q1/Q2 are decided and M0.3's migration 021 has landed.

## 2. Gap matrix: the brief's 33 sections against reality

**Fit** asks: does SHYGON sell something this applies to? SHYGON's catalogue is:
- 10 NFC card designs × 3 materials × 2 finishes, stock-tracked per product (`products.stock`, `low_stock_threshold`), in numbered editions;
- 4 digital experiences;
- a Customization Pass;
- one seller.

| # | Brief section | Exists (live) | On unmerged branch | Missing | Fit |
|---|---|---|---|---|---|
| 1 | Customer website | Home, store with search, sort and filter, product detail with related products, auth, account, orders, notifications, support, 5 legal pages, 404, SEO meta | Reviews | Wishlist, recently viewed, comparison, Q&A, video, zoom, cancellation-policy page | High (subset) |
| 2 | Product system | `products` (SKU, paise pricing, material × finish), editions, stock | Tax fields, reviews | Categories/brands/collections tables, attributes, bundles, cross-sell/upsell rules, back-in-stock alerts | Medium: material × finish *are* the variants |
| 3 | Cart | One configured card in `localStorage` | n/a | Server cart, multi-item, save-for-later, guest/logged-in merge, abandoned-cart tracking | High |
| 4 | Checkout | Signed-in checkout, address + PIN validation, server pricing, Razorpay, retry-safe fulfilment | Promo codes | Guest checkout (an **auth change**), saved addresses, billing address, shipping methods, gift card / store credit | High (subset) |
| 5 | Payments | Razorpay (UPI, cards, net banking, wallets), HMAC + server confirmation, webhook idempotency, test/live switch | n/a | COD, automated full/partial refunds (Razorpay refund API), invoices. **Live payments blocked by DEC-2026-024** | High; COD is an owner choice |
| 6 | Orders | Statuses, history, admin cancel (no refund), admin shipping update, e-bill | n/a | Customer cancel, reorder, returns/exchange/replacement, packed / out-for-delivery statuses, shipping labels | High |
| 7 | Inventory | Stock + `inventory_movements`, admin adjust, low-stock alert | Inventory funnel (026) | Warehouses, transfers, purchase orders, suppliers, damaged stock | **Low**: one product line, a single stock location (HYPOTHESIZED: no second warehouse exists) |
| 8 | Shipping | PIN serviceability check | Delivery fields (023) | Shipments, courier/AWB, tracking events, rate rules, labels, RTO | High: one courier aggregator |
| 9 | Delivery partner system | none | none | Whole app | **Low**: SHYGON ships by courier and has no fleet. Doc 10 §4 defers native apps |
| 10 | Returns / refunds | Refund policy page, refund columns on payments | n/a | Return requests, inspection, refund records, store-credit refunds | High: 7-day defect window in `legal.ts` |
| 11 | Customer account | Sign-up/in, reset, profile, phone, orders, notifications, tickets, settings | n/a | OTP/email verification, social login (**auth change**), saved addresses, wishlist, account deletion flow | High (subset) |
| 12 | Coupons | none live | Promo codes (023) | Rules engine beyond codes (BxGy, flash sale) | Medium |
| 13 | Loyalty / referrals | none | none | All | Low now |
| 14 | Gift cards | none | none | All | Low now |
| 15 | Reviews | none live | Reviews (028) | Moderation UI, helpful votes | Medium |
| 16 | Support | Tickets + messages (customer and admin) | n/a | Attachments, categories/priority, contact form, help centre | High (subset) |
| 17 | Notifications | In-app realtime, order SMS, admin push (Expo) | Email outbox (024) | WhatsApp (**DEC-031 open**), templates admin, customer push (doc 10 §4 defers) | High: email first |
| 18 | Admin panel | 13 screens in the Expo app | Cards/emails admin (025) | Returns, refunds, shipments, coupons, CMS/banners, settings depth | High (extend, don't redesign) |
| 19 | Roles / permissions | 5 roles + permission strings + audit log | n/a | Configurable roles, finance/marketing/delivery roles. **DEC-018 = one-person model** | Medium |
| 20 | Vendors / marketplace | none | none | All | **Out of scope**: doc 10 §4 "Organizations / multi-tenancy: do not build", DEC-025 |
| 21 | Analytics | Admin analytics + Tap analytics | Funnel (026) | Cohorts, profit, exports, date ranges | Medium |
| 22 | Marketing | none | Promo codes | Campaigns, banners, landing pages | Low now |
| 23 | SEO | Per-route title, description, canonical, OG/Twitter; prerendered HTML per public route; `sitemap.xml`, `robots.txt` and `llms.txt`; JSON-LD for Organization, WebSite, Store, FAQPage, ItemList, BreadcrumbList and Product (AggregateOffer). All generated at build by `src/seo/build.ts` | n/a | No CI check of the built output; 4 descriptions over 160 characters; product JSON-LD priced from the static copy while the page shows live prices. **All fixed in C5** | High; low risk |
| 24 | Security | RLS (55 policies), adversarial suite, CSP, server-side pricing, HMAC webhooks, secret scan in CI | n/a | Rate limiting. **SEC-1 credential rotation NOT DONE (DEC-001)**; O-1…O-12 findings open | High |
| 25 | Database | See §1 | 022–028 | Tables for every High row above | n/a |
| 26 | Backend / API | 6 functions + 93 RPCs | Email senders | One per new capability | n/a |
| 27–29 | Responsive, performance, errors | Present; budgets and tests in CI | n/a | Per new screen | n/a |
| 30 | Business settings | Admin settings screen | n/a | Tax, shipping and return-window settings | Medium |
| 31–33 | Rules, end-to-end test, definition of done | n/a | n/a | No end-to-end (Playwright) suite exists | n/a |

## 3. Constraints that apply to any option (OBSERVED)

1. **Migration numbering.** M0.3 reserves 020 and 021, and `fix/upgraded-zip` uses 022–028. New commerce migrations must start at **029**, or be renumbered at integration.
2. **Authorization** (c31f9df):
   - database, RLS and payment changes are allowed **locally, in test mode, for M0.3 only**;
   - auth, deployment, live payments and production data: **NO**.
   - The brief needs auth changes (guest checkout, OTP and social login) and live payments.
3. **Live payments** stay off until the DEC-2026-024 fix ships. This is the P1 latent defect: first-time buyer provisioning.
4. **Credential rotation** (SEC-1, DEC-2026-001) is not done.
5. **Roadmap conflict.** Doc 10 §4 says "do not build yet" for:
   - organizations/multi-tenancy (§20);
   - push notifications and native apps (§9, §17 push);
   - visual redesign (which the brief also forbids).
6. **Open decisions overlap the brief:**
   - DEC-025 (organizations);
   - DEC-027 (environments; the brief implies a production rollout);
   - DEC-030 (admin dashboard scope);
   - DEC-031 (WhatsApp/email providers);
   - DEC-032 (taxonomy);
   - DEC-033 (upgrade-zip integration).
7. **Concurrent workstreams.** Four worktrees, plus a peer session building a 3D hero in the main checkout. "The current UI" the brief protects is therefore **ambiguous** (see DEC-2026-034 Q2).
8. **Roles.** Every governance role is UNASSIGNED.

## 4. Proposed phasing if Option B of DEC-2026-034 is chosen

Each phase ends at a gate (the PASS/BLOCKED report) and needs the owner's approval.

| Phase | Content | Depends on |
|---|---|---|
| C0 | Integrate `fix/upgraded-zip`: promo codes, email outbox, reviews, tax | DEC-033 Q1/Q2, M0.3 021 |
| C1 | Server cart (multi-item, guest cart merged at sign-in), wishlist, saved addresses | C0; auth unchanged |
| C2 | Order lifecycle: customer cancel window, return/replacement request, refund records + Razorpay refund API (test mode), GST invoice | C1 |
| C3 | Shipping: shipment + AWB + tracking events via one aggregator (provider decision), statuses packed / out for delivery, notifications | C2, DEC-031 for channels |
| C4 | Admin parity in the Expo app for C1–C3, and permission strings for each | C1–C3 |
| C5 | SEO verification: a CI gate on the built output (`npm run test:seo`), fixes for what it finds, and product JSON-LD that matches the live prices and stock the page shows | none (can run any time) |

**Deferred, each with its own future DEC:**
- vendors/marketplace;
- warehouses / purchase orders / suppliers;
- delivery-partner app;
- loyalty, referrals, gift cards, store credit;
- WhatsApp and push;
- COD;
- guest checkout and social login (auth).

**Test plan per phase:**
- migrations applied in PGlite (`db:apply`);
- RLS adversarial checks extended per new table;
- function tests under `test:payments:ci`;
- the bundle budget;
- a Playwright smoke suite for each new flow (new, as part of C1).

**HYPOTHESIZED size:**
- C0–C5 is several weeks of work in gated phases.
- The full brief as written is a multi-month programme.
