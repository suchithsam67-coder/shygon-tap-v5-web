# SHYGON Tap V5 (Web) — Production Readiness

Customer website only. The Admin APK is a separate codebase; its server half
lives here as `supabase/migrations/003_admin_platform.sql` and is untouched.

**Read §8 Blockers before deploying.** The code builds clean and everything that
can be exercised without credentials has been exercised in a browser. What is
missing is a migration only a human with SQL access can apply, and two secrets.

---

## 1. The product model

### 1.1 Four digital experiences

```
ESSENTIAL   free with every card   no opening animation   4 palettes
BUSINESS    paid                   professional opening   5 palettes
PREMIUM     paid                   cinematic opening      8 palettes
GOAT        paid                   signature opening      12 palettes + adaptive UI
```

One vocabulary — `essential | business | premium | goat` — used by the
experience id, the plan SKU (`plan-<id>`) and the entitlement key.

**Why this needed a migration.** The storefront sold
`essential/business/pro/3d` while the database stored `free/pro/premium/3d`, so
the string `pro` meant BUSINESS on one side and the third tier on the other. Any
behaviour keyed off it got the wrong tier — and the requirement is precisely
"this tier plays an opening animation, that one doesn't". Migration 004 converts
the stored values. `tier_rank()` still accepts the old spellings so a row
written by an older code path cannot silently rank as 0 and hand somebody an
experience they never paid for.

The fifth "Custom" tier is retired: delisted (not deleted — historical orders
reference the SKU), and anyone who owned it converted to a real GOAT entitlement.

### 1.2 The ₹999 Customization Pass

Per the product notes: **"without ₹999 can edit only once in 14 days; with it,
edit whenever they want and unlock more colour palette."**

So the Pass buys exactly two things:

* unlimited profile edits
* every colour palette, on whichever experience the customer is on

It deliberately does **not** include Business, Premium or GOAT. Those are
separate purchases. A single ₹999 payment must not hand over the whole
catalogue, and `fulfilOrder()` no longer grants tier entitlements for it.

It is a one-time purchase granting a permanent entitlement, not a recurring
charge. The entitlement type is still `lifetime` so every existing grant, policy
and admin RPC keeps working; only what it buys changed.

### 1.3 The editing rule is a rolling limit

**One content edit per 14 days**, not a window that expires. A customer without
the Pass can always edit their Tap — just not more than once a fortnight — so a
profile never becomes permanently frozen.

Enforced by `enforce_tap_edit_rules()`, a trigger on `tap_profiles`:

* Only CONTENT counts: name, headline, designation, company, bio, photo,
  location, contact fields, links, and changing an address already claimed.
* Publishing, pausing, switching to an experience already paid for, and toggling
  an add-on already owned are never rationed — rationing them would mean selling
  an upgrade the customer cannot apply.
* `last_content_edit_at` is stamped by the database, so the clock cannot be
  reset from the browser.
* The same trigger also refuses any experience, palette, layout, button style,
  font or animation the customer has not unlocked.

`tap_edit_state()` returns the same decision to the UI so the editor can explain
itself and count down. Disabling inputs is a courtesy; the trigger is the
boundary.

### 1.4 Tap status: draft / active / paused / archived

`published` was a single boolean, so "never finished" and "deliberately taken
down" were indistinguishable and a visitor got a 404 for both. Status and the
boolean are now kept in lock-step by a trigger, which is what lets migration
003's `get_public_tap()` keep working untouched. A paused Tap resolves through
`get_public_tap_state()` to "temporarily unavailable" rather than "not found";
draft, archived and suspended all report plain `unavailable`, because moderation
state is not public.

### 1.5 Internal names vs customer-facing names

Some stored identifiers deliberately do **not** match what the customer reads.
They are kept as-is so existing orders, RLS policies and migration 003's admin
RPCs keep working; renaming them would be a data migration touching the admin
surface for no functional gain.

| Stored / on the wire | Where | Customer reads |
|---|---|---|
| `entitlements.type = 'lifetime'` | database | "Customization Pass" |
| `orderType: 'lifetimeCustomization'` | API + `orders.order_type` | "Customization Pass" |
| `products.sku = 'pass-customization'` | database | "Customization Pass" |
| `products.product_type = 'lifetime_plan'` | database | (not shown) |
| `tap_profiles.selected_ui_tier` | database | "digital experience" |
| `products.ui_tier` | database | "digital experience" |
| `planId` | API request body | the experience id |

Two rules that follow from this, and matter:

* **`lifetime` does not mean "unlimited experiences".** It is the ₹999
  Customization Pass: unlimited editing and every palette, nothing more. The
  grant list in `fulfilOrder()` is deliberately just the one entitlement.
* **`user_has_lifetime()` is an alias.** It delegates to `user_has_pass()`;
  `user_has_pass()` is the one to call in new code.

What is NOT divergent, and must stay that way: the experience id, the plan SKU
suffix (`plan-<id>`) and the `digital_plan` entitlement key are all the same
four strings — `essential | business | premium | goat`. Keeping those three in
agreement is what removed the bug where stored `pro` meant Business while the
storefront's `pro` meant the third tier.

### 1.6 One card, upgraded forever

The physical card is bought once. Its NFC chip and QR both point at
`/t/<slug>`, and nothing a customer changes — experience, palette, layout,
profile — ever changes that address. A printed QR cannot go stale.

---

## 2. What was built

| Area | Files |
|---|---|
| Migration | `supabase/migrations/004_experiences_status_and_edit_window.sql` |
| Public Tap | `src/components/tap/{TapExperience,ExperienceIntro,TapDepthField,palettes}.ts(x)`, `src/styles/tap.css`, `src/pages/PublicTap.tsx` |
| Account | `src/pages/{Account,TapEditor,Tiers,Customize,TapQr,Settings,Customizations,Checkout}.tsx` |
| Model | `src/lib/{database.types,version}.ts`, `src/services/{tap,entitlements,catalog}.ts`, `src/lib/{auth,account}.tsx` |
| Server | `netlify/lib/fulfilment.mjs`, `netlify/functions/{create-order,check-delivery}.mjs` |

New customer surfaces this pass: the **customizer** (`/shygontap/customize` —
palette, layout, buttons, type, animation, each gated by tier and Pass, with a
live preview of the real public component), the **QR page**
(`/shygontap/qr` — download as PNG at up to 1024px, copy, share), **About
Version** in Settings, a working **change-password** form (the reset email
previously landed on a page with no password field), profile fields for
designation / company / YouTube / custom links, and the **edit → preview →
publish → share** flow with the "Your Tap is live" moment.

Merged in from the newer build supplied mid-pass: checkout PIN/delivery
verification, the storefront Pass offer, `check-delivery.mjs`, copy and
responsive fixes. Two CSS syntax errors in that build were fixed — a stray `.`
and a missing `.` were silently dropping the entire lifetime comparison block
and the cart icon rule.

---

## 3. Verified

| Check | Result |
|---|---|
| `npx tsc -b --force` | **0 errors** |
| `npm run build` | **passes**, 0 CSS warnings |
| Essential opens with **no** animation | **verified in-browser** — no intro element is mounted at all (`introMounted: false`), page is `is-revealed` immediately |
| Business plays its opening | **verified** — `tap-intro-business` mounted, then revealed |
| Premium plays its opening | **verified** — `tap-intro-premium` mounted, then revealed |
| GOAT plays its opening **and adapts** | **verified** — `tap-intro-goat` mounted, and the root carried `tap-phase-evening`, i.e. the time-of-day layer is live |
| Card visible after every opening | **verified** — `opacity: 1` in all four |
| Palettes drive the whole surface | **verified** — switching midnight → neon → ivory → molten changed `--tap-ink`, `--tap-accent`, the page background and the Call button |
| Storefront shows the right four | **verified** — Essential / Business / Premium / GOAT, and zero occurrences of "3D Experience", "Custom", "Simple UI" or "Lifetime" anywhere in the rendered page |
| Public Tap when the backend is unreachable | **verified** — "We couldn't load this Tap" with a retry, **not** a false "not found" |
| Protected route while signed out | **verified** — redirects to sign-in |
| Storefront with the catalog unreachable | **verified** — falls back to the bundled prices |
| `npx eslint .` | **0 errors, 0 warnings** (was 37) |
| Bundle for the public Tap | **257 kB → gzip ~84 kB** (was 938 kB / 261 kB gzip) |
| `npm audit` | 1 low, dev-server-only (see below) |

### Two real bugs found by testing and fixed

1. **The Tap could stay blank forever.** The revealed state was reached by a CSS
   *transition* out of `opacity: 0`. Browsers freeze transitions in a
   non-visible tab, so a Tap opened in a background tab stayed blank, and
   anything that stalled the transition would blank a profile permanently. The
   visible state is now the element's natural style; only `is-opening` hides it,
   and the entrance is an animation with `forwards` fill. The worst a stalled
   animation can now do is skip the entrance.
2. **The opening replayed over an already-revealed card.** `introDone` was a
   boolean initialised on first render, so switching experience — or pressing
   Replay in the preview — played the intro again without re-hiding the card.
   Reveal state is now a token derived from the current experience, animation
   setting and replay counter.

### The migrations now run against a real Postgres

`npm run db:apply` and `npm run db:verify` execute the migrations against
Postgres 18 compiled to WASM (PGlite), with a shim for the two things Supabase
provides that a bare Postgres does not — the `auth` schema and the
`anon`/`authenticated`/`service_role` roles — plus the four tables the live
project already had before migration 001. No Docker required.

```
npm run db:apply    # all four migrations, then all four a second time
npm run db:verify   # 21 behaviour checks
```

Current result: **all four apply, all four are idempotent, 21/21 checks pass.**

What `db:verify` actually proves, by attempting it:

| | |
|---|---|
| Catalog | the four active experience SKUs are essential/business/premium/goat + the Pass; `plan-pro`, `plan-3d`, `plan-custom`, `plan-lifetime` are delisted but not deleted |
| The rename | `tier_rank('pro') = 1` (Business) and `tier_rank('3d') = 3` (GOAT) — the exact confusion that made the animation land on the wrong tier |
| Payments | a signed-in customer **cannot** set `payment_status = 'paid'` on their own order |
| Provisioning | paying provisions a Tap in `draft`, unpublished, on Essential, and raises the order + payment notifications and the `account_events` rows |
| Entitlements | selecting an unowned experience, a locked palette, or an unpurchased add-on are each refused with a distinct message |
| Palettes | Essential = 4, Essential + Pass = 12, GOAT = 12 |
| The 14-day rule | first edit accepted and `last_content_edit_at` stamped **by the database**; a second edit inside the window refused; **publishing is not rationed**; the Pass lifts it immediately |
| The Pass boundary | after buying it, `user_has_pass` is true but `user_max_ui_tier` is still `essential` — it does **not** leak an experience |
| Public read path | an active Tap resolves clamped (an unpurchased WhatsApp is withheld); paused reports `paused`; draft and unknown both report `unavailable` and nothing more |

### A real bug this found in migration 003

003 could not be applied at all. Line 203 created a policy whose `USING`
expression calls `public.admin_has(...)`, but that function is not defined
until line 302 — and Postgres resolves a policy expression at `CREATE POLICY`
time. Every attempt aborted with:

```
function public.admin_has(unknown) does not exist
```

Fixed by moving that one policy into a new section 2b, immediately after the
function exists. Nothing else in 003 changed. **Tell whoever maintains the admin
codebase** — if they have their own copy of 003, it has the same bug.

### Performance: what a visitor downloads

The public Tap is the one page a stranger opens on their own phone, seconds
after touching a card, and the whole product promise is that it appears
instantly. It used to download 938 kB — the storefront, the checkout, the whole
account area and the Supabase SDK — before it could paint.

Three changes, in order of what they bought:

1. **The public Tap is the only thing in the entry bundle.** Everything else,
   including the session providers, lives behind one dynamic import
   (`src/AccountApp.tsx`).
2. **It does not use the Supabase SDK.** `src/lib/publicTapClient.ts` calls the
   same two SECURITY DEFINER functions with plain `fetch`. No security
   difference — same anon key, same server-side clamps — but it keeps ~57 kB
   gzipped of auth, realtime and storage code out of that path.
3. **React and Supabase are their own chunks**, so a returning visitor
   re-downloads only app code after a deploy.

`ScrollProgress` was also rewritten without framer-motion. It mounted on every
route, so it was the single reason the animation runtime shipped to NFC
visitors — for a bar the Tap page never shows.

| | before | after |
|---|---|---|
| Public Tap first load | 938 kB / 261 kB gzip | **257 kB / ~84 kB gzip** |
| Largest chunk | 938 kB | 217 kB (Supabase, account only) |
| Chunk-size warning | yes | none |

### Code quality

ESLint went from 37 errors to zero. The substantive ones:

* **`Math.random()` during render** in `FeaturedProducts` moved all 18
  decorative particles on every re-render. Now a pure function of the index.
* **19 × `set-state-in-effect`.** Every account page had its own copy of a
  loading/error/fetch triple that set state synchronously inside an effect,
  costing an extra render pass before first paint. They now share
  `src/hooks/useAsync.ts`, and the "seed a form from data that arrives later"
  cases adjust during render, which is React's documented way and stops the
  editor painting an empty form before filling it.
* **The account provider wrote state six times per load**, so the dashboard
  flickered through partial states. It now returns one snapshot and applies it
  in a single update.
* **`any` in the cart drawer** was hiding a real crash: `item.total` is optional
  for a Pass purchase, and `currency()` would have been handed `undefined`.
* **The Deno Edge Functions were being linted by the browser app's config**,
  which reported correct Deno code as failures. They are `deno lint`'s job and
  are now excluded.
* Providers and their hooks were split into separate modules so React Fast
  Refresh can hot-update them instead of reloading the whole app on every edit.

### Still not verified, and why

* **No real payment has been run.** Razorpay is reachable from here, but there
  is no webhook secret and no service-role key, so the browser → create-order →
  Razorpay → verify → webhook → grant chain is unproven end to end. `db:verify`
  proves what happens *once an order is marked paid*, which is the part the
  migrations own.
* **Nothing has been applied to your live project** — see §8.1.

---

## 4. Environment variables

See `.env.example`. Two optional additions:

```
VITE_SITE_URL
```

Overrides the canonical origin, which defaults to `https://shygontech.com`.
Set it only on a staging deploy, or locally when you want Tap links to open
against your own dev server. See §4.1.

The Shiprocket trio is the other:

```
SHIPROCKET_EMAIL
SHIPROCKET_PASSWORD
SHIPROCKET_PICKUP_POSTCODE
```

With all three set, `/api/check-delivery` returns that courier's real
serviceability and ETA. Without them it returns a stated business-day range that
the UI labels as an estimate. Exactly one of the two is ever present in the
response, so the interface cannot show a guess as if it were a live quote.

### 4.0 Hosting on Netlify or Vercel

The app deploys to either host from the same code:

- **Netlify** reads `netlify.toml` and runs `netlify/functions/*`.
- **Vercel** reads `vercel.json` (the same page routes) and runs `api/*.mjs`,
  thin entries that call the same handlers.

Either way, set these in the host's environment variables. The build and the
server functions both need them; without them checkout answers "Payments are
not configured":

```
VITE_SUPABASE_URL          VITE_SUPABASE_ANON_KEY     VITE_RAZORPAY_KEY_ID
SUPABASE_URL               SUPABASE_SERVICE_ROLE_KEY
RAZORPAY_KEY_ID            RAZORPAY_KEY_SECRET        RAZORPAY_WEBHOOK_SECRET
```

Then point the Razorpay webhook at `https://<host>/api/razorpay-webhook`. The
build refuses to finish if `vercel.json` is missing a route that `netlify.toml`
has, so the two cannot drift.

Brand assets (logo files, icons, card art) are generated by
`npm run brand`; see `scripts/brand/generate.mjs`.

### 4.1 The domain: shygontech.com

`src/lib/site.ts` is the only place the product's own address is written down.
`index.html` repeats it in the `canonical` and Open Graph tags, which are
static and cannot read a module — keep the two in step if it ever changes.

**Why the site's own origin is not derived from the browser.** `tapUrl()` used
to build the public Tap address from `window.location.origin`. That address is
printed on a physical card and encoded into a QR a customer may send to a
printer, so generating it from a deploy preview or from localhost baked in a
host that expires — and a card in someone's wallet cannot be recalled. It now
always resolves to the canonical origin.

The opposite rule holds for authentication: Supabase `redirectTo` in
`Auth.tsx` and `Settings.tsx` must keep using `window.location.origin`, or
signing in on localhost would bounce the developer to production.

**What still has to be done outside this repo.** None of it can be done from
here.

1. **Netlify** — add `shygontech.com` as the site's primary domain, point DNS
   at Netlify, and let the certificate issue. The www → apex fold is already in
   `netlify.toml` and stays inert until www resolves.
2. **Then** un-comment the `shygon-tech.netlify.app` → apex redirect in
   `netlify.toml`. It is deliberately off until the custom domain answers,
   because enabling it early redirects the only working host to one that does
   not — that is a live outage, not a config warning.
3. **Supabase → Authentication → URL Configuration** — set Site URL to
   `https://shygontech.com` and add it to Redirect URLs, alongside
   `http://localhost:5173` for development. Supabase validates `redirectTo`
   against that allow-list; until the domain is on it, every magic link and
   password reset sent from the live site fails.
4. **Razorpay** — point the webhook at
   `https://shygontech.com/api/razorpay-webhook` and add the domain to the
   account's authorised list.

Until step 1 lands, the deployed site still serves from the Netlify host and
works normally; the only visible effect of this change is that Tap links and QR
codes name shygontech.com, which is the intended final address.

Customer-facing contact throughout the site is now `contact@shygontech.com`,
taken from one constant. It replaced `hello@shygon.com` — a different domain,
which would have bounced.

---

## 5. Migrations

### Applying them — three ways, easiest first

**1. Automatic.** Needs a personal access token from
<https://supabase.com/dashboard/account/tokens>:

```bash
SUPABASE_ACCESS_TOKEN=sbp_… SUPABASE_PROJECT_REF=<20-char-ref> npm run db:push
```

Applies all four through the Management API, stops at the first failure, and
prints the resulting catalog. The token is read from the environment and never
written to disk — it is a full-account credential, so do not put it in `.env`.

**2. One paste.** `supabase/APPLY_ALL.sql` is all four concatenated in order.
Dashboard → SQL Editor → New query → paste → Run. One transaction, so either all
of it lands or none does. Regenerate with `npm run db:bundle` after changing any
migration.

**3. By hand.** The four files below, in order, in the SQL editor.

### Testing them without a project

```bash
npm run db:apply    # executes all four on Postgres 18 (WASM), then again for idempotency
npm run db:verify   # 21 behaviour checks
npm run db:bundle   # regenerates APPLY_ALL.sql and proves it applies as one batch
```

No Docker and no live project needed. Run these after touching any migration.

### The files

Run in order, in the Supabase SQL editor:

1. `001_production_payments_and_catalog.sql`
2. `002_shygon_v5_platform.sql`
3. `003_admin_platform.sql` — only if you use the Admin APK
4. `004_experiences_status_and_edit_window.sql`

**Ordering matters, and not only the first time.** 002 re-seeds
`products.ui_tier` with the old vocabulary and restores the old `tier_rank()`;
003 recreates the admin policies that 002 drops. If you ever re-run an earlier
file, re-run the later ones after it. All four are idempotent, so that is always
safe.

004 deliberately does **not** redefine `get_public_tap()` or
`record_tap_event()`, so 003 remains their sole owner and the two files cannot
fight. The richer read path is a separate function, `get_public_profile()`,
which returns JSONB so adding a profile field later needs no signature change.

The website degrades rather than breaking if 004 has not been applied: the Tap
query falls back to the pre-004 column list, status is derived from `published`,
publish/pause falls back to the boolean, the customizer says so plainly instead
of offering options it cannot save, and with no edit-state RPC the editor leaves
editing open — because with no trigger there is no rule to enforce.

---

## 6. Payment architecture

Unchanged, and still the only path to an entitlement:

```
browser states an intent (never a price)
  → create-order prices it from `products`, writes order + order_items,
    creates the Razorpay order
  → Razorpay Checkout
  → verify-payment (timing-safe HMAC, ownership check)  ── both call ──┐
  → razorpay-webhook (mandatory signature, atomic idempotency claim) ──┘
  → fulfilOrder(): claims the pending→paid transition, grants from order_items,
    issues cards, decrements stock, provisions the Tap
```

The browser cannot mark anything paid: a trigger refuses any transition into a
paid state from a context that has an `auth.uid()`, and `entitlements` has a
SELECT policy and no INSERT or UPDATE policy at all.

`create-order` additionally refuses to sell an experience that is not one of
`business | premium | goat`, and refuses to sell the Pass to somebody who
already holds it.

---

## 7. Post-migration checklist

Nothing below can be done from this environment.

**Schema**
```sql
SELECT sku, ui_tier, price_in_paise, active FROM public.products
WHERE product_type IN ('digital_plan','lifetime_plan') ORDER BY sort_order;
-- expect active: plan-essential/business/premium/goat + pass-customization
-- expect inactive: plan-pro, plan-3d, plan-custom, plan-lifetime

SELECT status, published, count(*) FROM public.tap_profiles GROUP BY 1,2;
-- expect status and published always to agree (active <=> true)

SELECT public.theme_options('palette','essential',false);  -- 4
SELECT public.theme_options('palette','essential',true);   -- all 12
SELECT public.theme_options('palette','goat',false);       -- all 12
```

**Payments** — buy a card with a Razorpay test card, then confirm: `orders`
paid, a `payments` row, `entitlements` rows, a `cards` row, `products.stock`
decremented by one, a Tap provisioned, notifications raised. Re-deliver the
webhook from the Razorpay dashboard and confirm nothing is granted twice.

**The 14-day rule** — save a profile change, then immediately try a second one.
Expect a refusal *from the database* (error `42501`), not just a disabled input.
Buy the Pass and confirm the same save then succeeds.

**The Pass boundary** — after buying the Pass, confirm the customer still does
**not** own Business/Premium/GOAT: `SELECT * FROM entitlements WHERE user_id =
'…'` should show `lifetime` and no new `digital_plan` rows.

**Palette gating** — on Essential without the Pass, confirm only 4 palettes are
selectable, and that forcing a locked one through the API is refused.

**The domain** — after DNS resolves, confirm `https://shygontech.com` serves
the site, `https://www.shygontech.com` 301s to the apex, a magic link sent from
the live site returns to it rather than erroring, and a QR generated in the
editor scans to `shygontech.com/t/<slug>`.

**Animations, on a real phone** — Essential opens with no animation at all;
Business, Premium and GOAT each play their own; GOAT's tint differs morning vs
evening.

---

## 8. Blockers

Every item needs credentials or SQL access this environment does not have.

1. **The Supabase project does not exist.** `bzozitfwdreczzmhsjhn.supabase.co`
   returns **NXDOMAIN** — the hostname does not resolve at all. This is not a
   sandbox restriction: from the same shell, `google.com`, `registry.npmjs.org`
   and `api.supabase.com` all resolve normally, and only this one host fails.
   That ref is the only one anywhere on disk (customer `.env`, admin `.env`, and
   the older 3.0 project all point at it), so there is no alternative to try.

   The project has been deleted, or the ref is wrong. Create or restore it, put
   the new URL and keys in `.env`, then apply 001 → 002 → 003 → 004 in order in
   the SQL editor. `npm run db:apply` already proves they will run.
2. **Two secrets unset.** `SUPABASE_SERVICE_ROLE_KEY` (every Netlify function
   returns 503 without it) and `RAZORPAY_WEBHOOK_SECRET` (set after creating the
   webhook for `payment.captured`, `order.paid`, `payment.failed`).
3. **Rotate the Razorpay key secret.** An earlier version of this file contained
   it in plaintext, and it is currently present in `.env`, which is gitignored
   but was distributed inside the project ZIPs.
4. **Phone auth is off** on this Supabase project (`/auth/v1/settings` reports
   `phone: false`). Login is email-only until an SMS provider is configured —
   the sign-up form collects a phone number into `profiles`, but it is not a
   login credential yet.
5. **Order fulfilment is admin-side.** Moving an order to packed/shipped/
   delivered, adding a tracking number and activating a card all happen in the
   Admin APK or the Supabase table editor. The customer site only reads them.

### Known, not blocking

* Node 20.18 vs Vite 7's 20.19+ ask (builds today regardless).
* `npm audit` reports one **low** advisory: esbuild's dev-server file read on
  Windows (GHSA-g7r4-m6w7-qqqr). It is pinned transitively by Vite, `npm audit
  fix` cannot resolve it without a breaking upgrade, and it affects
  `vite dev` only — never the production build. It matters only if you expose
  the dev server to your network.
* `src/pages/Home.tsx` is the SHYGON Technologies corporate homepage and is
  unrouted, so it and the corporate components ship nothing. This brief says the
  customer site is separate from the corporate site, so it was left in place
  rather than deleted.
* Sessions persist in `localStorage` (Supabase's default), so a returning
  customer stays signed in. The build supplied mid-pass had switched this to
  `sessionStorage` for shared-device safety; that one change was deliberately
  **not** merged, because session persistence is an explicit requirement. If
  shared devices are a concern, the right fix is a "keep me signed in" choice at
  sign-in rather than a silent downgrade — flagging it as a decision to confirm.
* The customer mobile app is not built. The architecture supports it: every
  customer operation is either a Supabase RPC/table behind RLS or a Netlify
  function behind a bearer token, so the app can share this exact backend and
  auth without a server rewrite.
