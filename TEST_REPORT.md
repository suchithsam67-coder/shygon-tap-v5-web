# SHYGON Tap V5 (Web) — Independent Test Report

Tested 12 September 2026 against `shygontapv5_complete.zip`. Customer website
only; the Admin APK is a separate codebase and was not exercised.

**Verdict: NOT PRODUCTION READY.** One blocker, and it is not a code problem —
the application cannot reach its database. As of 26 September 2026 the Supabase
project the repo documents as live does not resolve at all (§2.2). Everything
downstream of that is *blocked*, not passing.

The code itself is in good shape. Security architecture, RLS and payment
verification are genuinely strong and are verified by test below. The first
passes fixed four defects, including a time bomb in the existing test suite. The
26 September pass (§10) fixed seven more — among them an invisible sign-in
button — and found one P1 privacy issue whose fix is written and verified but
**awaits your approval** before it touches the database. Read §2 before
deploying anything.

---

## 1. What was run

| Suite | Result | What it proves |
|---|---|---|
| `npm run build` | PASS | TypeScript, imports, bundling, no secret leakage |
| `npm run lint` | PASS | Zero errors, zero warnings |
| `npm run db:apply` | 10/10 | Migrations 001–010 apply, and re-apply, on real Postgres |
| `npm run db:verify` | 23/23 | Business rules: catalogue, entitlements, 14-day window, seasonal themes |
| `supabase/tests/rls-adversarial.mjs` | 48/48 | **New.** Row-level security, as a real `authenticated` role |
| `netlify/tests/functions-security.mjs` | 13 pass · 1 blocked | **New.** Function auth, signatures, fail-closed behaviour |
| `supabase/tests/verify-011-admin-notes.mjs` | 16/16 | **New.** Proposed migration 011 — see §10.3. Not applied anywhere |

**122 assertions total** — 21 + 23 + 48 + 14 + 16, counted from the suite
output on 26 September: **121 pass, 0 fail, 1 blocked.** (An earlier draft said
82; that was a rough estimate. The suites have since grown.) The blocked check
needs Node 22 for supabase-js and this machine runs Node 20.18 — §4.3. It is
reported as blocked rather than counted as a pass.

### 1.1 Re-running them

```bash
npm install
npm run build
npm run lint
npm run db:apply
npm run db:verify
node supabase/tests/rls-adversarial.mjs .
node netlify/tests/functions-security.mjs .
node supabase/tests/live-auth-rls.mjs .   # needs working credentials; see §2
```

The first six need no credentials at all — they run Postgres in-process via
PGlite. That is deliberate: the database rules stay testable on any machine,
with no Docker and no Supabase project.

---

## 2. The blocker

### 2.1 What was found on 12 September

The `.env` pointed at two different Supabase projects:

| Value | Project ref | Live check, 12 Sep |
|---|---|---|
| `VITE_SUPABASE_URL` / `SUPABASE_URL` | `bzozitfwdreczzmhsjhn` | **NXDOMAIN — does not resolve** |
| `SUPABASE_SERVICE_ROLE_KEY` (JWT `ref`) | `auvgvikdbhbrtsrsaslv` | Resolved, answered `HTTP 401` — alive |
| `VITE_SUPABASE_ANON_KEY` | none encoded | **Rejected** by `auvgvikdbhbrtsrsaslv` |

Supabase's response to the publishable key was *"Invalid API key … This API key
might also be owned by another Supabase project."* It may belong to
`bzozitfwdreczzmhsjhn`; that could not be tested, because that host does not
resolve.

*Correction to earlier drafts:* this report previously said
`bzozitfwdreczzmhsjhn` "does not exist" and that "all three values disagree, so
there is no consistent set to infer." Neither was established. NXDOMAIN means
the name does not resolve — a deleted project and a paused one look identical
from outside. And the set *was* inferable: `LIVE_SUPABASE_STATE.md`, line 3,
names the live project as `auvgvikdbhbrtsrsaslv` (`shygon-tap-v5`, ap-south-1).
That file should have been read before this was called unresolvable.

On that evidence `.env` was repointed to `auvgvikdbhbrtsrsaslv` and the
service-role key installed (the previous file is kept as `.env.bak-*`). A
**read-only** check on 17 September then confirmed the project was the right one:

| Table | Rows |
|---|---|
| `products` | 39 — 24 cards, 4 active experiences, the Pass, 5 active add-ons; retired SKUs correctly inactive; none unpriced |
| `tap_event_themes` | 19 — Ganesh Chaturthi live, matching `LIVE_SUPABASE_STATE.md` |
| `admin_users` | 1 |
| `profiles` | 2 |
| `orders`, `payments`, `entitlements`, `cards`, `tap_profiles` | 0 — no customer data |

Nothing was written.

The same check found one piece of **schema drift**. On the live project
`get_public_tap` fails with `column reference "slug" is ambiguous`, while
migrations 001–010 produce a version that works — verified locally against a
*published* Tap. (The earlier local tests used an unpublished Tap, which returns
before reaching the failing query, so they could not have caught it.) Nothing
calls this function: the web app uses `get_public_profile` and
`get_public_tap_state`, both of which answered correctly on live, and the admin
app mentions it only in a comment. So it is **P3 and not user-facing** — but it
does show the live database is not an exact copy of the migrations.

### 2.2 Status on 26 September — the project no longer resolves

Re-checked on 26 September: `auvgvikdbhbrtsrsaslv.supabase.co` now returns
**NXDOMAIN**. Confirmed by Cloudflare and Google DNS-over-HTTPS independently,
with `supabase.com` resolving normally through the same method as a control.

Something changed on the Supabase side between 17 and 26 September. The most
likely explanation is that the project was **paused for inactivity**, but a
deletion looks identical from outside — only the Supabase dashboard can say
which.

**A note on this network.** Plain DNS here is intercepted by the ISP, even when
addressed to 8.8.8.8 or 1.1.1.1: names that do not exist come back as
`49.205.75.11`, which serves *"No site configured"*. That makes dead hosts look
alive. Only DNS-over-HTTPS gave trustworthy answers, and it is what the
statements above rest on.

### 2.3 To unblock

1. In the Supabase dashboard, open project `shygon-tap-v5`
   (`auvgvikdbhbrtsrsaslv`, ap-south-1). If it shows **Paused**, restore it. If
   it is missing, stop — that is a larger problem than configuration.
2. From that project's API settings, copy the **publishable key**. It is public
   by design. The service-role key already in `.env` matches this project.
3. Then run `node supabase/tests/live-auth-rls.mjs .` — it is written and stops
   at its reachability gate until the project answers.

If the project was paused for inactivity, the production site would go down the
same way the first quiet week after launch. Check the plan before launch.

---

## 3. The canonical site URL — FIXED

`VITE_SITE_URL=http://localhost:5173` had been set per the supplied `.env`
structure. The string `http://localhost:5173` was confirmed compiled into
`dist/assets/AccountApp-*.js`, and everything derived from `SITE_URL`
inherited it:

- the QR encoded on a physical card — and a card in someone's wallet cannot be reprinted
- the shareable public Tap link
- `CONTACT_EMAIL`, which rendered in the live footer as `contact@localhost:5173`
- Open Graph image URLs, and the Razorpay checkout logo

`src/lib/site.ts` was already correct — it defaults to `https://shygontech.com`
and deliberately does *not* derive from `window.location.origin`. So this was
never a code bug to find in review. It was a bug that had to be made
**impossible to ship**, which is what was done.

### 3.1 The build now refuses to produce an unshippable bundle

`vite.config.ts` validates `VITE_SITE_URL` on `vite build` and throws with a
readable explanation if it is not a public https origin. Staging is unaffected —
any https origin passes. Each case was verified:

| `VITE_SITE_URL` | Build |
|---|---|
| unset | builds — defaults to `https://shygontech.com` |
| `https://staging.shygontech.com` | builds — staging still works |
| `http://localhost:5173` | **refused** |
| `http://192.168.1.50:5173` | **refused** — LAN address |
| `http://shygontech.com` | **refused** — plain http |
| `ALLOW_LOCAL_SITE_URL=1` + localhost | builds — deliberate local preview only |

The dev server is untouched: `npm run dev` may still point anywhere.

### 3.2 The value was reset

`VITE_SITE_URL` is now commented out in `.env` with a note explaining why, and
`.env.example` documents the guard. Verified on a clean production build:

- no `localhost:5173` anywhere in `dist/`
- exactly one canonical origin baked in — `https://shygontech.com`
- the rendered footer now reads `contact@shygontech.com`
- `og:url` now reads `https://shygontech.com/`

Two vendor bundles still contain the bare word `localhost` — React Router's
internal fallback origin and supabase-js's GoTrue default. Neither is our site
URL, which is why the CI check below matches the port rather than the bare word.

A belt-and-braces CI check, now secondary to the build guard:

```bash
npm run build && ! grep -rq "localhost:5173" dist/
```

---

## 4. Defects found and fixed

### 4.1 P2 — four identical catalogue fetches per page view

Measured in the **production** build, not a StrictMode artefact: four identical
`/rest/v1/products` requests for one view of `/shygontap`, each returning the
whole products table across 18 columns.

Four components price themselves independently — hero, configurator, store grid,
product detail — and each ran its own `fetchCatalog()` on mount with no shared
cache.

Fixed in `src/services/catalog.ts` with in-flight de-duplication plus a
30-second result cache, rather than by lifting state: the callers are
deliberately independent and any may render alone. A failed load is never
cached, and `invalidateCatalog()` is exported for use after a purchase.

Verified: four concurrent mounts → **1** query; later reads within the TTL → 0
extra; concurrent failures share one attempt and recover cleanly afterwards.

### 4.2 P3 — touch targets below the accessibility minimum

Three genuine WCAG 2.5.8 failures at 375 px:

- tier-deck dots at **7×7 px**
- `.summary-demo` ("PREVIEW GOAT") at **15 px** tall
- seven footer links at **17 px**

The dots failed twice over: a 7 px dot on a 15 px pitch means a 24 px circle
centred on one overlaps its neighbour, so the spacing exception did not rescue
them either.

Fixed in `src/index.css`. The dot is now drawn as a `::before` pseudo-element
inside a 24 px button — it still *looks* 7 px while the target is finger-sized —
and the flex gap moved onto the button so the pitch is 24 px. `.summary-demo`
was padded to 44 px. Everything else (footer links, "View details", search
close, nav icons) is raised only under `@media (pointer: coarse)`, because those
are perfectly clickable with a mouse and growing them on desktop would loosen
layouts that are currently tight.

Verified on a touch-emulated 375 px viewport: **0 of 64 controls** below 24 px,
down from 12; dot pitch exactly 24 px. Re-checked at 1440 px: `pointer: coarse`
does not match, footer links are 17 px and nav icons 40 px as before, no
horizontal scroll.

### 4.3 P1 — no Node version pinned; payments would 500 in production

`@supabase/supabase-js` v2.112 constructs a `RealtimeClient` inside
`createClient`, which needs a native `WebSocket` — absent before Node 22. This
was reproduced directly:

```
createClient THROWS on Node v20.18.0 -> Node.js detected but native WebSocket not found.
```

Every Netlify Function calls `adminClient()`. On a Node 20 runtime that means
order creation, payment verification and webhook fulfilment all return `500` —
payments dead, silently, in production.

Nothing pinned the runtime: no `.nvmrc`, no `.node-version`, no `NODE_VERSION`
in `netlify.toml`, no `engines` field. It was left to Netlify's rolling default.

Fixed by adding `[build.environment] NODE_VERSION = "22"` to `netlify.toml` and
`"engines": { "node": ">=22.12.0" }` to `package.json`, each with a comment
explaining why so it is not removed later.

This is also why `functions-security.mjs` reports 13/14 locally — the machine
running the tests has Node 20.18.0, so the one assertion that needs a
constructed Supabase client cannot run. On Node 22 it reaches its auth check.

### 4.4 P3 — a time bomb in the existing test suite

`db:verify` passed on 12 September and failed on 15 September, with nothing in
between touching the database.

The cause was not a regression. Migration 005 seeds real festival dates into
`tap_event_themes`, and Ganesh Chaturthi runs **14–25 September 2026** with the
`molten` palette. A live event theme legitimately overrides the customer's
chosen palette — so the feature was working correctly. The test simply
hard-coded `palette === 'neon'`, which only holds on days when no event runs.

Left alone it would have failed every Ganesh Chaturthi, Halloween and Diwali,
and each failure would cost somebody an afternoon proving the app was fine.

Fixed in `supabase/tests/verify.mjs`. That assertion is about *entitlement
clamping*, so seasonal themes are switched off for it, and the seasonal layer is
now tested directly instead — against an event dated from `CURRENT_DATE`, so it
is live whenever the suite runs:

- `a live seasonal theme overrides the chosen palette` — `neon` chosen, `abyss` served
- `the chosen palette returns once the event ends` — back to `neon`

The suite went from 21 tests to 23, and seasonal theming now has real coverage
it did not have before.

---

## 5. Security findings

All of the following were **tested**, not read.

### 5.1 A caveat about the existing test suite

`npm run db:verify` runs as the PGlite **superuser**, which bypasses row-level
security entirely. Its 21 passes prove the triggers and business rules — they do
**not** prove RLS.

That is why `supabase/tests/rls-adversarial.mjs` was added. It does
`SET ROLE authenticated` with the broad table grants Supabase hands
`anon`/`authenticated` by default, so policies actually apply, and it includes
positive control tests so a denial cannot pass for the wrong reason. (The first
draft of it "passed" everything because `auth.uid()` was `NULL` — the controls
caught that.)

### 5.2 What a signed-in customer cannot do

Verified as a real `authenticated` role:

- read another customer's profile, orders, entitlements, cards, payments, `order_items`, notifications or `tap_profiles` — 0 rows each, while still seeing exactly their own order
- grant themselves a paid experience, the ₹999 Customization Pass, or a paid add-on
- reactivate a revoked entitlement
- mark their own order paid, change its status or amount, or insert any order row
- insert a payment row claiming success, or poison the `webhook_events` ledger
- attach a `razorpay_order_id` to hijack a webhook, or rewrite another customer's shipping address
- change product pricing or stock, insert or delete products, write inventory movements
- read the admin roster, the admin audit log, or admin notifications
- insert themselves into `admin_users`, or `UPDATE` a role to `owner`

`anon` reads 0 rows from orders, profiles, entitlements, `tap_profiles` and
notifications, yet still resolves a published Tap through the RPC — and a draft
Tap's content stays withheld.

### 5.3 Admin authorization

Database-backed, not a hidden frontend route. Permissions are re-derived
server-side from `admin_users` on every request — a token proves identity, never
capability. No email-based bypass exists anywhere in the tree.

Role separation verified: a `viewer` has `orders.read` but not
`entitlements.grant`, `orders.refund` or `admins.manage`; `support` cannot
manage products or admins; a deactivated admin loses every permission
immediately.

### 5.4 Payments

- The browser never marks anything paid. `verify-payment` ignores any
  `success`/`paid` field in the request body and re-derives the HMAC itself.
- HMAC-SHA256 over `{order_id}|{payment_id}`, keyed by the server secret,
  compared with `timingSafeEqual` behind a length guard.
- Every price and stock level is read from `products`; the request states intent
  only. Quantity bounded 1–10, minimum ₹1, SKU allow-lists prevent buying a tier
  at add-on prices.
- A valid signature for *another* customer's order returns 404 rather than
  fulfilling against the caller.
- Webhook signature is mandatory and was tested live: unsigned → 401; wrong
  signature → 401; **signature computed over a different body → 401**; correct
  signature → accepted; missing event id → 400.
- Idempotency is insert-first on `webhook_events` behind a unique index — atomic,
  unlike select-then-insert — and the claim is released on failure so a retry is
  not dismissed as a duplicate.

### 5.5 Secret hygiene

Scanned `dist/` for the Razorpay key secret, the webhook secret and any
service-role JWT: **zero hits**. Only the publishable key, the `rzp_test_` key
id and the project URL appear, all public by design.

No server secret is referenced in `src/`; no `VITE_` variable is read in
`netlify/`; no hardcoded JWT; no function logs a secret. `.env` is covered by
`.gitignore` (`.env`, `.env.*`, with `!.env.example`) — and the project is not a
git repository, so nothing is tracked at all.

`describeError()` deliberately withholds raw Postgres/PostgREST text from
customers, including anonymous visitors on public Taps.

---

## 6. Feature status

Classified as asked: PASS tested and working · BLOCKED cannot test · PARTIAL
some of it works.

| Area | Status | Note |
|---|---|---|
| Production build | PASS | Clean, 40 chunks, no secret leakage |
| TypeScript / ESLint | PASS | Zero errors, zero warnings |
| Code splitting | PASS | Public Tap is alone in the entry bundle, uses plain `fetch` |
| Protected routes | PASS | Signed-out `/shygontap/account` → `/shygontap/auth` |
| Session-load race | PASS | Skeleton while resolving; no hard-refresh bounce |
| Signup / login / logout / reset | BLOCKED | Needs a reachable project |
| Profile CRUD | BLOCKED | Auto-provisioning trigger verified locally |
| Storefront rendering | PASS | Full catalogue with correct ₹ pricing from static fallback |
| Live catalogue pricing | BLOCKED | Needs the database |
| UI tiers (Essential→GOAT) | PASS | Rank order, legacy remap, palette counts |
| Customization Pass scope | PASS | Lifts the edit limit, grants **no** experience |
| Automatic Tap provisioning | PASS | Draft Tap + slug on payment; edit window from first paid order |
| Public Tap read path | PASS | Clamped to entitlements; paused/draft/unknown all safe |
| QR / canonical URL | PASS | Code correct — but see §3 |
| Payment security | PASS | See §5.4 |
| End-to-end test payment | BLOCKED | **No transaction was executed, in any mode** |
| Live webhook delivery | BLOCKED | Razorpay cannot reach localhost; tested with signed fixtures |
| RLS / isolation / escalation | PASS | See §5.2 |
| Admin authorization | PASS | See §5.3 |
| Admin dashboard app | BLOCKED | Separate codebase, out of scope |
| Desktop / tablet / mobile | PASS | 1440, 768 and 375 px — no horizontal scroll |
| Touch targets | PASS | Fixed, §4.2 |
| Backend-unavailable handling | PASS | Clean error state with retry; no stack trace leaked |
| Duplicate API calls | PASS | Fixed, §4.1 |
| Console errors | PARTIAL | No app errors; all noise is the dead Supabase host |
| Analytics / notifications | PARTIAL | Implemented; event log verified in Postgres; runtime blocked |

---

## 7. Files changed

| File | Change |
|---|---|
| `netlify.toml` | Pinned `NODE_VERSION = "22"` (§4.3) |
| `package.json` | Added `engines.node >= 22.12.0` (§4.3) |
| `src/services/catalog.ts` | In-flight dedup + 30 s cache + `invalidateCatalog()` (§4.1) |
| `src/index.css` | Touch targets: pseudo-element dots, padded demo button, coarse-pointer block (§4.2); print stylesheet |
| `vite.config.ts` | **Build guard** — refuses a bundle whose `VITE_SITE_URL` is not a public https origin (§3.1) |
| `.env.example` | Documents the guard and why the variable stays commented out (§3.2) |
| `supabase/tests/verify.mjs` | Made the seasonal-palette assertion deterministic; +2 tests (§4.4) |
| `supabase/tests/rls-adversarial.mjs` | **New** — 48 adversarial RLS assertions |
| `netlify/tests/functions-security.mjs` | **New** — 14 function security assertions |
| `supabase/tests/live-auth-rls.mjs` | **New** — live auth + RLS probe, ready when credentials are |
| `.env` | URL repointed to the documented project (§2.1); `VITE_SITE_URL` commented back out (§3.2). The webhook secret and service-role key added during testing were **removed again** on 26 Sep, per the owner's policy that secret values are configured in each runtime and not held locally or handled here |
| `RAZORPAY_SETUP.md` | Rewritten — the old version said the *browser* marks orders paid, the opposite of the code. It now maps each variable to the runtime that reads it |
| `.claude/launch.json` | Added a production-preview entry on port 4173 |

The working directory held an older build than the archive. It was backed up,
then the 26 newer files — including migrations 005–010 — were synced so the
tested tree matches `shygontapv5_complete.zip` exactly. Both attached archives
are byte-identical (same MD5).

---

## 8. What was not tested

- **Any real payment.** No transaction was executed, in test mode or otherwise.
- Live webhook delivery from Razorpay — localhost is unreachable to it without a tunnel.
- The admin dashboard application — a separate codebase.
- Shipping/Shiprocket — credentials absent, so `check-delivery` correctly serves
  its documented fallback estimate instead.
- Real email flows (confirmation, password reset) — no mailbox available.
- `netlify dev` itself — `netlify-cli` is not installed and `npx` declined to
  fetch it. Note that `netlify dev` **is** required for the full app: plain
  `npm run dev` serves Vite only, and `/api/*` resolves solely through the
  `netlify.toml` redirect. The handlers were invoked directly instead, which is
  faithful because they are standard `Request`/`Response` functions.

---

## 9. Before launch

1. Restore project `shygon-tap-v5` (`auvgvikdbhbrtsrsaslv`) in the Supabase
   dashboard and copy its publishable key into `.env` (§2.3). The URL and
   service-role key are already correct. Nothing else can be tested until this
   is done.
2. Re-apply migrations 001–010. The schema is already largely present, but it
   has drifted in at least one function (§2.1); the migrations are proven
   idempotent locally, and re-applying brings the live copy back in line. Then
   run `node supabase/tests/live-auth-rls.mjs .` against it.
3. ~~Confirm `VITE_SITE_URL`~~ — **done.** The build now refuses to produce a
   bundle whose canonical origin is not a public https URL (§3.1), so this can
   no longer be got wrong silently. Just do not set the variable in Netlify.
4. Run one real Razorpay **test-mode** payment end to end: order → checkout →
   verification → entitlement → Tap provisioning. This is the single largest
   untested path.
5. Register the webhook and replay one event twice; confirm the second is
   answered "already processed" and grants nothing additional.
6. Configure the secrets in **both** runtimes — each reads only its own. In
   Netlify: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (customer checkout and webhook).
   In Supabase Edge Function Secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
   (admin refunds). Set only in Supabase, checkout returns 503. Never with a
   `VITE_` prefix. See `RAZORPAY_SETUP.md`.

---

## 10. Storefront and admin-integration pass — 26 September 2026

The live database was still unreachable at the start of this pass
(`auvgvikdbhbrtsrsaslv` — NXDOMAIN via Cloudflare and Google DNS-over-HTTPS,
checked 16:58). So nothing below claims a live login, payment or admin
round-trip. What *was* verified, and how, is stated per item.

### 10.1 Where the brief conflicts with the backend

The brief's own rule settles both: *"Do not allow users to purchase
configurations that the backend cannot support."*

- **Name, logo or custom text printed on the card — not built.** No column on
  `orders`, `order_items` or `cards` records print personalisation, and
  `PRODUCTION.md` never mentions it. A configurator for it would take payment
  for a design nobody could retrieve. Personalisation in this product lives in
  the digital profile, which already exists.
- **"STANDARD / PRO / PREMIUM" tiers — not introduced.** Migration 004 retired
  `pro` and remapped it to `business`. The backend sells a physical finish
  (Standard / Premium) × material, and experiences Essential / Business /
  Premium / GOAT. The storefront keeps those real names.

### 10.2 Defects found and fixed

**P1 — The sign-in button's label was invisible.**
- *Problem:* "Log in" rendered dark-on-dark at a 1:1 contrast ratio, on the
  screen every buyer must pass. The active Login/Sign-up tab also lost its
  highlight, so the current mode was unreadable.
- *Root cause:* `button { color: inherit }` and its neighbouring resets in
  `src/index.css` sat outside any cascade layer. Tailwind v4 emits utilities
  in `@layer utilities`, and an unlayered rule beats a layered one regardless
  of specificity — so every `text-*`, `font-*` and size utility on a button or
  link was silently overridden, app-wide.
- *Fix:* the three element resets moved into `@layer base`.
- *Verification:* measured before and after on every page reachable without
  the database. Overrides went from 7 colour, 9 weight and 6 size to **0, 0,
  0**; unreadable controls from 1 to 0. A static scan of all components found
  no element that relied on the bug to look right.
- *Status:* fixed.

**P1 — Customers could read the admin's internal note on their own order.**
- *Problem:* `orders.admin_note`, shown in the admin app as an internal note,
  is on the customer's own row, and `orders_select_own` grants the whole row.
  RLS is row-level, not column-level.
- *Verification:* reproduced as the real `authenticated` role. An admin note
  written through `admin_update_order_status` came back verbatim to the
  customer's session. The customer app never displays it; it did not need to.
- *Fix:* proposed migration `supabase/proposed/011_admin_notes_off_customer_rows.sql`
  — see §10.3.
- *Status:* **open until 011 is approved and applied.**

**P2 — Paid digital upgrades showed "Processing" forever.**
- *Root cause:* the Orders page drew the physical shipping tracker for every
  order. Fulfilment leaves `order_status = 'processing'`, and only an admin
  shipment advances it — which never happens for a Business upgrade, the Pass
  or an add-on. The type declared `fulfillment_status`, but the query never
  selected it, so nothing could tell a finished upgrade from a stuck one.
- *Fix:* digital orders show "Unlocked on your account" from the server's own
  fulfilment record, or "activating" while it retries. No tracker.
- *Status:* fixed.

**P2 — The customer couldn't see what the admin recorded.**
- *Problem:* carrier, ship and delivery dates, cancellation reason and refund
  were all recorded by the admin (migration 003) and selected by the customer
  page not at all. A tracking number with no carrier is not usable.
- *Fix:* selected and shown. If the database predates 003/006, the page falls
  back to the base columns on that one error code and remembers it for the
  session — real data shown with less detail, never invented.
- *Status:* fixed.

**P2 — Admin changes appeared only after a reload.**
- *Fix:* `useOrderUpdates` subscribes to this customer's `orders` updates
  (already in the realtime publication since 003) as a signal only, and
  refreshes when the tab becomes visible. `useAsync` gained a silent
  `refresh()`, so an update never flashes a skeleton, and a failed background
  refresh keeps what is on screen.
- *Status:* fixed. Realtime delivery itself is **blocked** from testing until
  the database is back; the visibility path was tested.

**P2 — A cancelled-but-paid order showed a green "Paid".**
- *Root cause:* `admin_cancel_order` does **not** refund — refunds are a
  separate admin action — so "cancelled and paid" means the customer's money
  has not been returned. Green said the opposite.
- *Fix:* amber, plus "No refund has been recorded for this payment yet" and a
  support link. Only what the record shows.
- *Note for the admin developer:* the cancellation notification a customer
  receives says nothing about their money.
- *Status:* fixed.

**P3 — Abandoned checkouts said "Payment pending" indefinitely.**
- *Fix:* after 30 minutes they read "Not completed — you were not charged".
  Failed payments are now red, not amber. The Account page shares the same
  helper, and now totals from `amount_in_paise` rather than the legacy `amount`.
- *Status:* fixed.

**P3 — A function-security test depended on `.env`.**
- *Problem:* three checks assumed the service-role key was absent. Once the
  correct key was installed, they reported failures that were not failures.
- *Fix:* each check now sets up its own conditions and restores the key after.
  The Node-20 case reports as BLOCKED, with the reason.
- *Status:* fixed — 13 pass, 0 fail, 1 blocked.

**Homepage message.** The hero now reads "ONE TAP. / ONE IDENTITY.", as the
brief asks. The accent colour follows the last line instead of a hard-coded
third line, which would otherwise have silently dropped it. Verified at 360 px
and 1440 px with no overflow.

### 10.3 Proposed migration 011 — needs approval

It sits in `supabase/proposed/`, not `supabase/migrations/`, because
`npm run db:push` applies every file in `migrations/`. It must not reach
production by accident.

What it does:
- moves internal notes to an admin-only `order_admin_notes` table;
- rewrites `admin_update_order_status` and `admin_get_order`, extracted from
  003 by script so that only the note handling differs (diffed line by line);
- copies the existing notes, then clears the customer-readable copies.

The admin app needs **no change**: `admin_get_order` returns the same 37 keys,
note included.

Verified (`supabase/tests/verify-011-admin-notes.mjs`, 16/16):
- a control reproduces the leak first;
- existing and new notes are both hidden from customers;
- `anon` and `authenticated` are refused on the new table;
- notes carry over;
- a blank note keeps the existing one, as in 003;
- tracking, carrier, date and card updates behave as before;
- customers still cannot call the RPC;
- the migration raised **0 notifications** (5 → 5) and **0 Tap
  provisioning** (1 → 1);
- untouched orders keep their `updated_at`;
- re-running is safe.

With 011 layered on 001–010, the existing suites still pass: 23/23 business
rules and 48/48 adversarial RLS.

*Known side effect:* orders that had a note get `updated_at` set to the time
of the migration, via the existing trigger.

**To adopt:** move the file into `supabase/migrations/`, then
`npm run db:apply && npm run db:verify`.

### 10.4 Checked and found correct

- **Double-submit protection.** At every checkout entry point — Checkout,
  Tiers and Customizations — validation is synchronous and the busy flag is
  set before the first `await`, so the button is disabled before a second tap
  can fire. By code reading; payment cannot run live.
- **Admin → customer status vocabulary.** It matches exactly: placed,
  processing, packed, shipped, out for delivery, delivered, cancelled. Proven
  end to end in Postgres through the real admin RPC.
- **The admin app is RPC-only.** Every read is a `SECURITY DEFINER` function,
  plus one realtime signal.

### 10.5 Observed, deliberately not changed

A first-time visitor starts with every option at its most expensive:
Business, Metal ₹899, Premium finish, GOAT ₹999 — ₹1,898, against ₹399 for the
cheapest Business configuration (and ₹299 for the cheapest card overall,
Event). It is shown before payment, so it is not
hidden, but it is a pricing decision rather than a defect. It is yours to
make.

### 10.6 Validation status for this brief

| Area | Status | Basis |
|---|---|---|
| Build | PASS | `tsc -b` + `vite build`; 0 lint problems |
| UI | PASS | measured utility overrides and contrast on reachable pages; Orders rendered against realistic rows |
| Responsive | PASS | 360 / 390 / 1440 px this pass (768 px in the earlier pass); no horizontal scroll; touch targets per §4.2 |
| Error handling | PASS | failed background refresh keeps data; older schema degrades; abandoned / failed / cancelled / refunded states each rendered |
| Database | PASS | business rules, adversarial RLS and proposed 011, all on real Postgres |
| Admin integration | PARTIAL | contract proven in Postgres through the real RPCs; live round-trip blocked; P1 note leak awaits 011 |
| Auth | BLOCKED | needs a reachable project |
| Payment | BLOCKED | needs a reachable project; no transaction was run in any mode |
| Order (live) | BLOCKED | needs a reachable project |
| Runtime, end to end | BLOCKED | of the brief's 26 steps, 1–4, 7, 22–24 and 26 were exercised; 5 (live UI preview) and 25 (invalid form input) were **not** tested this pass; 6 and 8–21 need the database |
