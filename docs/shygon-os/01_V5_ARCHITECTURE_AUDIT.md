# 01 — Existing SHYGON Tap V5 Architecture Audit

**Scope audited:** `shygon-tap-v5-web-2026-09-29-payments.zip` (347 files): React/Vite customer web app, 19 Supabase migrations + 1 proposed, Netlify functions (mirrored for Vercel), 2 Supabase Edge Functions, test scripts, and V5 docs.
**Not in the zip (so not audited):** the Admin APK codebase (only its server half, migrations 003/013, is here); the live Supabase database; Supabase Storage policies; Supabase Auth dashboard settings; the physical NFC encoding process.

**Method:** everything below was read from the source. Where a claim could be checked by running code, it was: the 19 migrations were applied to a local Postgres (PGlite, via the repo's own harness), the repo's adversarial RLS suite was run (**48/48 pass**), and four additional probes were run (see §4). Claims that depend on the live database are marked **VERIFY ON LIVE**.

---

## 1. What V5 actually is

V5 is a **commerce store plus a single-profile digital card**, not yet a platform. In one sentence: *a signed-in customer buys a physical NFC/QR card and digital "experience" upgrades through Razorpay; the server provisions exactly one public Tap page per customer at `/t/<slug>`; the customer edits it under an entitlement- and rate-limited editor; admins operate it through a separate mobile app that talks to SECURITY DEFINER RPCs.*

| Dimension | V5 today |
|---|---|
| Frontend | React 19, Vite 7, React Router 7, Tailwind 4, framer-motion; TypeScript. No state library: two React contexts (`AuthProvider`, `AccountProvider`) + a `services/` layer + `useAsync`. |
| Route split | `/t/:slug` (public Tap) is the **only** thing in the entry bundle (~84 kB gzip) and reads via plain `fetch` to PostgREST RPC (no Supabase SDK). Everything else is lazy behind `AccountApp`. |
| Backend | **Supabase Postgres is the backend.** Business rules live in triggers and SECURITY DEFINER functions. Server code only where it must leave Postgres. |
| Server functions | 5 Netlify functions (`create-order`, `verify-payment`, `razorpay-webhook`, `check-delivery`, `card-otp`), mirrored as thin `api/*.mjs` for Vercel; 2 Supabase Edge Functions (Deno): `admin-refund`, `admin-push`. |
| Auth | Supabase Auth, **email only** (phone auth is off). Session in `localStorage`. |
| Data model | `profiles` (account) → `tap_profiles` (**one per user**, unique index on `user_id`) → `cards` (physical tokens) ← `orders`/`order_items`/`payments` → `entitlements` (string keys) → plus `notifications`, `support_*`, `tap_events`, `card_editions`, `tap_event_themes`, `admin_*`. |
| Payments | Razorpay Standard Checkout. Server prices from `products`; HMAC-verified checkout + webhook; idempotent event ledger; atomic pending→paid claim; retryable fulfilment; refunds via Edge Function. |
| Authorization | Customers: RLS owner-only (`auth.uid() = user_id`). Admins: `admin_users` → role → `admin_has(permission)` inside ~45 SECURITY DEFINER admin RPCs, each writing `admin_audit_log`. |
| Tenancy | **None.** No organization concept anywhere. |
| Deployment | Netlify primary (`netlify.toml`), Vercel mirror (`vercel.json`; the build fails if routes drift). CSP, HSTS, frame-deny headers set. Supabase project in ap-south-1. Canonical origin `shygontech.com`. |
| Tests | Node scripts, no test framework and **no CI config in the zip**: `db:verify` (21 checks), `rls-adversarial` (48), `test:payments` (2 files). `TEST_REPORT.md` records browser checks done manually. |

### Product rules already encoded (must survive)
Four experiences (`essential | business | premium | goat`); ₹999 one-time **Customization Pass** (unlimited edits + all palettes, grants no tier); **one content edit per 14 days** enforced by trigger; Tap status `draft|active|paused|archived`; seasonal **event themes** overriding presentation; **limited-edition numbering** of cards (chapters of 100); OTP-confirmed card activate/deactivate; printed QR/NFC URL is `/t/<slug>` and **must never change** (physical cards can't be recalled).

---

## 2. Subsystem classification

Legend: **KEEP** unchanged · **EXTEND** additive change, existing contracts preserved · **REFACTOR** change internals/structure, behaviour preserved · **REPLACE** · **UNKNOWN** cannot classify without more evidence.

| # | Subsystem | Verdict | Reason |
|---|---|---|---|
| 1 | Payment pipeline (`create-order`, `verify-payment`, `razorpay-webhook`, `fulfilment.mjs`, `razorpay.mjs`) | **KEEP** (extend handlers only) | Best-built part of V5: server-side pricing, timing-safe HMAC, amount+currency+order re-check with Razorpay, atomic idempotency ledger with claim release on failure, retryable fulfilment state machine, live keys refused on localhost, adversarial tests. Rebuilding would only re-introduce bugs already fixed. |
| 2 | `orders`, `order_items`, `payments`, `webhook_events`, `products` | **KEEP / EXTEND** | Extend `products.product_type` and `order_items` for org plans/packages; add `subject` (user\|org) to orders. |
| 3 | `entitlements` (string `type`/`key`, user-scoped) | **EXTEND** | Sound and server-only-writable. Needs: org subject, `expires_at`, `source`, plan-derived grants. Vocabulary quirks (`lifetime` = Pass) documented in PRODUCTION §1.5 → keep stored names, add aliases. |
| 4 | `profiles` (account record) | **EXTEND** | Correct separation of account vs publishable content is the right instinct. Add verified-contact handling; protect `suspended_*` (see F1). |
| 5 | `tap_profiles` (publishable content; 1 per user) | **EXTEND → becomes "persona"** | Hard-coded contact columns + `enabled_customizations` array is a crude field-visibility model. The 1:1 unique index blocks multi-context identity. Keep the table (admin RPCs, edit-rule trigger, customizer all depend on it); relax uniqueness, add `context`, `org_id`, per-field visibility. Do **not** rename. |
| 6 | Public read path `get_public_profile()` / `get_public_tap_state()` / `record_tap_event()` | **REFACTOR** (keep as v1) | Excellent pattern (whitelisted JSONB, tier clamping, no `user_id` leak) but it resolves *slug → profile only* and ignores card state (F3). Freeze as `v1`; add `resolve_tap()` routing layer beside it. |
| 7 | `cards` (physical tokens) | **EXTEND → becomes `tap_devices`** | `card_uid` exists but is never used for routing; state machine incomplete (no lost/unassigned/transfer). Extend in place — a parallel `tap_devices` table would duplicate it (breaks rule 3). |
| 8 | `card_otp_challenges` + `card-otp` function | **EXTEND** | Good implementation (HMAC'd codes, attempt/send limits, single-use). Weakness is *what it trusts*: the phone number is user-editable and unverified (F4). |
| 9 | Admin platform (003/013: `admin_users`, `admin_has`, `require_admin`, audit, admin notifications, ~45 RPCs) | **KEEP** (namespace-extend) | Right security model (check inside the transaction; no service key in the APK; append-only audit). Do **not** reuse for org admins — separate tenant roles. Fix migration lineage (003 vs 013 fork, F6). |
| 10 | `supabase/functions/admin-refund`, `admin-push` | **KEEP** | Refund needs the service role by design. Note two runtimes hold Razorpay secrets (Netlify + Supabase); document, consolidate later. |
| 11 | `notifications` (+ realtime), `admin_notifications`, `admin_push_tokens` | **EXTEND** | In-app + realtime works. Missing: delivery tracking, preferences, email channel, outbox. |
| 12 | `tap_events` + `get_tap_analytics` | **EXTEND** | Privacy-aware intent (daily-rotating hash, no IP stored) but the hash is unsalted `md5(UA\|IP\|day)` (F5), events are unauthenticated-writable without rate limit, and there is no retention/rollup. |
| 13 | `support_tickets/messages` | **KEEP** (add `org_id`, categories) | Fine for MVP. |
| 14 | Event themes (`tap_event_themes`) | **KEEP** | Independent presentation layer. |
| 15 | Limited editions (`card_editions`) | **KEEP** | Independent; ensure device rows created for non-card SKUs don't consume serials. |
| 16 | Frontend architecture | **EXTEND** | Public/ account split is right. Add `/app` (customer OS shell), `/org/*` (tenant console) as further lazy bundles; introduce a typed data layer & shared components. Do **not** redesign visuals. |
| 17 | Public Tap renderer (`TapExperience`, palettes, intros) | **KEEP** | Contains hard-won fixes (blank-forever bug, replayed intro). Render new contexts by composing, not rewriting. |
| 18 | Migration tooling (`db:apply/verify/bundle/push`, PGlite) | **REFACTOR** | Superb idea, but the repo **cannot rebuild the live DB** (§3-D1). Needs a captured baseline before any OS migration. |
| 19 | Hosting: Netlify + Vercel mirror | **KEEP** | Mirroring guard is good. Add rate-limit/edge protection in front of public resolve (Cloudflare or platform WAF) — see doc 07. |
| 20 | Auth (email, `localStorage` session) | **EXTEND** | Add verified phone, step-up (recent-OTP/AAL2), TOTP MFA for admins & org admins. "Keep me signed in" decision noted in PRODUCTION §8 is still open. |
| 21 | Supabase Storage (avatar upload to `<user.id>/avatar-*`, public URL) | **UNKNOWN** | Bucket + policies not in the repo. Need: bucket public?, size/type limits, per-user path enforcement, EXIF stripping. |
| 22 | Admin APK | **UNKNOWN** | Not provided; only its contract (RPC names) is visible. |
| 23 | NFC chip & encoding | **UNKNOWN** | Nothing in the repo writes to a chip; `cards.card_uid` is populated by hand/admin. Chip family (NTAG213/215/216 vs NTAG 424 DNA) is undocumented — decides cloning resistance. |
| 24 | Shiprocket / `check-delivery` | **KEEP** | Out of OS scope. |
| 25 | Email delivery | **UNKNOWN / MISSING** | No transactional email sender in the repo (only Supabase Auth mails and SMS via MSG91/Twilio). |
| 26 | Data export / deletion (DSR) | **MISSING** | `ON DELETE CASCADE` from `auth.users` exists but there is no customer-facing export/erase flow, retention policy, or soft-delete. |

---

## 3. Structural conflicts between V5 and the SHYGON OS vision

**C1. One user ↔ one Tap ↔ one public address.**  `idx_tap_profiles_user` UNIQUE(user_id), and the public URL is the *vanity slug* derived from the person's name (`generate_tap_slug`). SHYGON OS needs one identity → many contexts (student/professional/business/event/guest) and devices that are not people (a classroom, a bag tag, a hotel desk). *Resolution:* introduce a routing layer (device/route → target) and relax persona uniqueness; keep `/t/<slug>` forever as the persona vanity URL.

**C2. The card is not an addressable object in the request path.** Nothing resolves by `card_uid` or a per-card code. Deactivating/replacing a card cannot change what *that* card's chip does, because every chip for a user points to the same `/t/<slug>`. *Resolution:* per-device public code + server-side routing; lifecycle states drive resolution.

**C3. Field visibility is binary and hard-coded.** A field is either "enabled" (public) or hidden. The vision needs PUBLIC / TRUSTED / ORGANIZATION / EMERGENCY / PRIVATE with consent, expiry and revocation. *Resolution:* per-field visibility + a `consent_grants` table; sensitive data stored outside `tap_profiles`.

**C4. No tenants.** No org table, no org-scoped RLS, no roles below "platform admin". *Resolution:* shared-schema multi-tenancy with `org_id` + RLS helpers (doc 03/04).

**C5. Entitlements are per-user and mostly perpetual.** Org plans, seats, expiries, subscriptions need a subject model. *Resolution:* extend `entitlements`, add `plans` + `subscriptions`.

**C6. Public-path protection is thin.** Public Tap reads hit the Supabase anon RPC directly (no cache, no edge rate limit, no bot control). Fine for a business card; not for Rescue/Access. *Resolution:* introduce an edge resolver (Netlify/Vercel function or CDN worker) in front of `resolve_tap()`.

**C7. Notifications are in-app/SMS-OTP only.** Rescue and Connect need reliable out-of-band delivery (email/SMS/push) with preferences and dedupe.

**C8. Product ambiguity — the 14-day card activation.** `customer_activate_card` (live-only) sets `activation_expires_at = now()+14 days` and `expire_tap_cards()` suspends expired cards, i.e. *a card stops working 14 days after activation unless renewed* (documented in LIVE_SUPABASE_STATE.md as "worth reviewing"). This looks like a conflation with the 14-day **edit** interval. Must be decided by the owner before card lifecycle work (see doc 11 OQ-1).

---

## 4. Findings (verified vs. unverified)

Severity: **H** = fix before any new feature; **M** = fix in Phase 0/1; **L** = backlog.

### Verified by execution against the repo's migrations (local Postgres, as role `authenticated`)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **F1** | **H** | **A customer can un-suspend themselves.** `tap_profiles_update_own` and `profiles_update_own` have no column restriction and no trigger protects `suspended_at`, `suspended_reason`, `suspended_by`. A moderated Tap/account can be re-enabled with a one-line PostgREST `PATCH`. | Probe: `UPDATE tap_profiles SET suspended_at=NULL … WHERE user_id=<self>` → 1 row; same on `profiles`. The 48-check RLS suite has no suspension test. | BEFORE UPDATE trigger (or column privileges) rejecting changes to `suspended_*`, `status` while suspended, by anyone without `auth.uid()` = admin path. Add tests. **VERIFY ON LIVE** (live policies were partly created outside migrations). |
| **F2** | **H** | **Customers can read internal admin notes** on their own orders (`orders.admin_note`; RLS is row-level). Already diagnosed in `supabase/proposed/011` but **not applied**, and migration number 011 is a gap. | Probe: `SELECT admin_note FROM orders` as the owner returned `INTERNAL NOTE`. | Apply (adapt) proposed 011. VERIFY ON LIVE. |
| **F3** | **H** | **Card deactivation/suspension does not stop the public Tap.** `get_public_profile()` (what the page uses) checks `tap_profiles.status`/`suspended_at` only. Card state is checked only in the legacy `get_public_tap()`, which no frontend code calls. Yet the UI/notification promises "Tapping it no longer opens your Tap." | Probe: card `status='suspended'` → `get_public_profile` still returns the profile; `get_public_tap_state` = `active`. | Resolve card state in `resolve_tap()`; define semantics first (OQ-1, OQ-2: is a *profile* still reachable by slug/QR if one card is lost?). VERIFY ON LIVE (013 says live's `get_public_profile` may differ). |

### Verified by reading the code (not executed)

| ID | Sev | Finding | Fix |
|---|---|---|---|
| **F4** | **H** | **Step-up OTP proves nothing about identity.** `card-otp` texts a code to `profiles.phone`, which the customer can edit freely and is never verified. A stolen session can change the phone number, then "confirm" a card deactivation/activation with an OTP sent to the attacker. | Verified-contact model: a phone becomes trusted only after OTP on the *new* number, with notice to the old one and a cool-down before it can authorize high-risk actions. |
| **F5** | M | **Analytics can be forged and the visitor hash is weak.** `record_tap_event` is callable by anyone with the public anon key for any published slug, unlimited; `visitor_hash = md5(UA‖IP‖day)` has no secret, so IPv4 space is enumerable. Raw `tap_events` grow unbounded. | Move hash to HMAC with server secret; server-side dedupe/rate-limit at the edge resolver; retention + rollups (doc 06). |
| **F6** | M | **Migration lineage is forked and the repo cannot rebuild live.** (a) `003_admin_platform.sql` and `013_admin_platform_live.sql` are two versions of the same thing; a fresh install runs both. (b) Live-only objects are referenced but never created in the repo: `cards.activated_at`, `last_activation_at`, `activation_expires_at`, `activation_count`, `deactivated_at`, `expire_tap_cards()`, `customer_activate_card/deactivate_card`, `admin_set_product_inventory`, `admin_update_order_shipping`, the pre-001 tables (`orders`, `profiles`, `tap_profiles`, `admin_users`) and their original policies. `015`'s function body compiles (plpgsql) but cannot run on a fresh DB. (c) `APPLY_ALL.sql` is stale (four files). (d) Per LIVE_SUPABASE_STATE.md, seven live `*_select_owner_or_admin` policies (cards, notifications, orders, profiles, support_messages, support_tickets, tap_events) are `TO public` and call `is_admin()`, so signed-out reads error (harmless but noisy; not in the repo's migrations). | `supabase db pull` a true baseline; squash to a single reproducible chain; CI applies it from empty. |
| **F7** | M | **Slug is a name-derived, enumerable public identifier** (`generate_tap_slug` from `full_name`); resolve returns `null` vs data, so valid slugs can be enumerated. Acceptable for a business card; **unacceptable** as the identifier for Rescue/Access. | Devices get unguessable codes; slugs stay vanity only; add per-IP resolve throttling. |
| **F8** | M | **No CI, no automated gate.** The good test scripts run only when someone remembers. | GitHub Actions: lint, tsc, build, db:apply (from baseline), db:verify, rls-adversarial, test:payments. |
| **F9** | M | **Storage is unaudited** (avatars → public URL). | Confirm bucket policies; restrict MIME/size; strip EXIF; per-user path check. |
| **F10** | L | Order id uses `Math.random()` (`ST-<time36>-<4 digits>`): guessable, though ownership is enforced by RLS. | `crypto.randomInt`. |
| **F11** | L | Sessions persist in `localStorage` (XSS = takeover); CSP mitigates. Open product decision from PRODUCTION §8. | "Keep me signed in" choice; keep strict CSP; add Trusted Types later. |
| **F12** | L | Two runtimes hold Razorpay secrets (Netlify env + Supabase Edge secrets). | Document rotation runbook; consolidate when convenient. |
| **F13** | L | Prior docs record a **deleted Supabase project ref** (`bzozitfwdreczzmhsjhn`) in PRODUCTION.md §8 and a live one (`auvgvikdbhbrtsrsaslv`) in LIVE_SUPABASE_STATE.md. Also PRODUCTION.md says a Razorpay key secret once sat in plaintext and shipped inside ZIPs. | Rotate Razorpay secret (confirm done); scrub docs; never zip `.env`. |

### Added on review of the governance spec (evidence from V5's own docs)

| ID | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| **SEC-1** | **H (P1; P0 on trigger)** | **Possible credential exposure.** A Razorpay key secret was once written in plaintext in PRODUCTION.md, and `.env` was "distributed inside the project ZIPs". A live-project Supabase **service-role key** was installed in the local `.env` (12–17 Sep) and a `.env.bak-*` was kept. **The ZIP audited here contains no secrets** (scanned). | PRODUCTION.md §8.3; TEST_REPORT.md §2.1 | Rotate now (DEC-2026-001, doc 13 §1.1 and PB-4) |
| **F14** | M | **Live drift confirmed:** live `get_public_tap` fails with `column reference "slug" is ambiguous` (not used by the frontend). | TEST_REPORT.md §2.1 | Captured by the M0.2 baseline; fix or retire with a DEC |
| (context) | — | **The live DB held 0 orders/cards/taps and 2 profiles on 17 Sep** (read-only check in TEST_REPORT). Migrations 013–018 were applied 27–28 Sep. | TEST_REPORT.md; LIVE_SUPABASE_STATE.md | This is why findings F1–F4 are P1/P2, not P0 (doc 13 §1.2). Re-score if real customers exist now. |

### Things the audit specifically did **not** find wrong (worth stating)
Payment verification; webhook replay protection; customer cross-tenant reads (all 7 cross-customer read checks pass); customer self-promotion to admin; tier/palette/add-on tampering (server-enforced by trigger); customer marking an order paid; public-Tap data minimisation (no `user_id`, no order/account fields).

---

## 5. Existing security assumptions (explicit)

1. *Anon key + RLS is the boundary* for customer data. ✔ appropriate for Supabase.
2. *A published slug is public by intent.* ✔ for business cards; ✘ for other contexts.
3. *NFC tap ≈ page open, nothing more.* ✔ (V5 never treats a tap as authentication) — this matches the master doc and must remain true.
4. *The admin app is trusted only through its own session.* ✔ (no service key in APK).
5. *Live DB == repo.* ✘ (F6).
6. *The customer's phone number is theirs.* ✘ (F4).

## 6. What "unknown" costs (ask/verify before Claude Code starts)

See doc 11 §Open questions. The three that change the design most: chip family (cloning resistance), card-activation semantics (OQ-1), and live-DB drift (F6).
