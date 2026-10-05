# SHYGON V6, Stage 1: Audit (read-only)

| | |
|---|---|
| Date | 2026-10-05 |
| Branch / base | `v6/stage-1-audit`, created from `feat/m0.3-security-identity` at `5659d15` (the newest branch that carries the M0.3 U3/U4 security work) |
| Worktree | `../shygon-tap-v5-web-v6`: fresh, no other session uses it, no `.env` present |
| Mode | Read-only. No source, migration, config or test file was changed. Databases used: in-memory PGlite only. No production system, live Supabase, remote or credential was touched |
| Status | **Waiting for owner approval of the backlog (§8) and the scope cuts (§9). Nothing is fixed.** |

Labels: **CONFIRMED** = reproduced or measured in this session; **OBSERVED** = read in code or records; **VERIFY ON LIVE** = only a read-only check against production can settle it (human).

---

## 1. Current state

### Repository
- No git remote. Nothing has ever been pushed, so GitHub CI has never run.
- Five other worktrees exist. Two of them contain uncommitted work by other sessions:

| Worktree | Branch @ commit | State | Relevance to V6 |
|---|---|---|---|
| `shygon-tap-v5-web` (original) | `opencode/m0.3-handover` @ `94cbafe` | **8 uncommitted files** (3D hero: three.js deps, `src/components/hero3d/`) | Not the baseline (DEC-2026-034 Q2). Do not touch |
| `-m03` | `feat/m0.3-security-identity` @ `5659d15` | clean | **V6 base.** 020 (F1 guard), 021 (identity/fulfilment, D-U4), contract suites |
| `-commerce` | `feat/commerce-c5-seo` @ `93ae352` | clean | DEC-2026-034 C5: `npm run test:seo` gate (711 checks) and live-price JSON-LD. Forked from `94cbafe`; **does not contain 020/021** |
| `-upgrade-fix` | `fix/upgraded-zip` @ `71e79ec` | clean | Promo, email outbox, reviews, tax. **Migrations 022–028**, which collide with doc 12 M0.4's planned `022_policy_role_cleanup.sql`. Not ready for live (DEC-2026-033 PROPOSED) |
| `-website` | `feat/website-experience-upgrade` @ `8becea3` | **4 uncommitted files** (homepage redesign) | Not the baseline (DEC-2026-034 Q2) |

- Tags: `v5-baseline` (= `main` = `8becea3`) and `pre-opencode-handover`.

### Product (OBSERVED)
- React 19 + Vite 7 SPA:
  - the public Tap (`/t/:slug`) is the only route in the entry bundle;
  - storefront, checkout and the account area sit behind one lazy import (`src/App.tsx:59`).
- **Data and auth:** Supabase (RLS plus SECURITY DEFINER RPCs).
- **Payments:** Razorpay, through Netlify functions mirrored as Vercel `api/*`.
- **Admin:** two Supabase edge functions (`admin-refund`, `admin-push`) and the admin RPC layer. **The admin UI is an external Expo APK and is not in this repository** (DEC-2026-016).
- **Live configuration:** Razorpay is in test mode. Live payments are **not authorized**. Production deployment is **not authorized**.

### Governance (OBSERVED, binding)
- Doc 12 §2A blocks all work beyond M0.0/M0.1 until the DEC-2026-001 credential rotation is done. The owner waived this for **M0.3 only** (`docs/governance/decisions/DEC-2026-001_credential-exposure-rotation.md:16,92`). Rotation is **NOT DONE**.
- DEC-2026-018: every L3 change (RLS, payments, auth, frozen functions) needs a 24-hour cool-off and checklist review before approval.
- 020 and 021 are committed but **applied nowhere**.

---

## 2. Verified gate results (re-run on `5659d15`, clean `npm ci`, Node 20.18.0)

| Gate | Last reported | **Verified now** | Note |
|---|---|---|---|
| db:apply (020, 021, applied twice) | PASS | **PASS** | |
| db:verify | 21/21 | **21/21** | |
| RLS adversarial | 64/64 | **64/64** | |
| identity-contract | 67/67 | **69/69** | **Differs.** Two collision checks were added on 2026-10-05 with the deterministic fallback (commit `6feeb25`) |
| golden public Tap | 4/4 | **4/4** (30 slugs) | |
| admin contract | 8/8 | **8/8** (61 frozen functions) | |
| history seed | 2/2 | **2/2** | |
| push guard | 18/18 | **18/18** | |
| payments (`test:payments:ci`, network denied) | PASS | **15/15 + 13/13, 1 BLOCKED** | The blocked check is "verify-payment refuses an unauthenticated caller", which needs Node ≥ 22 (V6-041). It has never run anywhere, because CI has never run (V6-013) |
| lint | PASS | **PASS** | |
| typecheck (`tsc -b`) | PASS | **PASS** | |
| build | PASS | **PASS** | |
| bundle (public Tap JS) | 88.55 kB | **88.55 kB** (88,551 B / 90 kB budget) | Reads 1 B more than on 10-03 because `__BUILD_DATE__` changes chunk hashes; pinning the date gives 88,550 B. CSS (59.56 kB) is not gated |
| `npm audit --audit-level=high` | PASS | **PASS** | 1 low: esbuild dev-server advisory GHSA-g7r4-m6w7-qqqr (V6-054) |
| secret scan (full history, gitleaks 8.30.1) | (known red) | **FAIL: 1 finding** | Only `9c8caa7` `ProjectConsultation.tsx:75`, the owner-classified approved public key (DEC-2026-020). It will fail CI on the first push (V6-014) |
| verify-011 (stand-alone) | 16/16 | **16/16** | |
| schema drift (record) | — | **Baseline reconstructs cleanly.** 021: 9 objects changed, 1 differs from live by design (`provision_tap_on_payment`), 8 new | |

Clean install: `npm ci` in a fresh worktree succeeded, with the lockfile unchanged.

---

## 3. Area walk

| Area | Verdict | Evidence |
|---|---|---|
| **Auth lifecycle** | **Partial** | <ul><li>Sign-up, login, password reset, recovery (`PASSWORD_RECOVERY` → Settings), sign-out (clears local selections) and auto-refresh exist: `src/pages/Auth.tsx:62-111`, `src/lib/auth.tsx:23-63`, `src/pages/Settings.tsx:66,126`.</li><li>Protected routes are a UX guard; the data is protected by RLS: `src/components/app/ProtectedRoute.tsx:14-16`.</li><li>The password minimum (6) is client-side only: `Auth.tsx:229`. Server policy and email confirmation are project settings (VERIFY ON LIVE).</li><li>Account deletion is by request only (V6-037).</li><li>Admin authentication: no web admin (V6-042).</li></ul> |
| **Authorization of sensitive ops** | **Partial** | <ul><li>Payment status is server-only (trigger `enforce_server_only_payment_status`).</li><li>Entitlements have no client write policy: `src/services/entitlements.ts:14-18`.</li><li>Admin RPCs go through `require_admin(permission)`. The edge functions use `resolveAdmin(…,'orders.refund')` (`supabase/functions/admin-refund/index.ts:36`).</li><li>The edge role map equals live `admin_role_permissions()` for all 5 roles (CONFIRMED by diff).</li><li>Gaps: suspension guard 020 not on live (B-2), O-7, O-14, F2.</li></ul> |
| **RLS** | **Partial** | <ul><li>64/64 adversarial checks pass on the live baseline + 020/021.</li><li>Open:<ul><li>F2: customers read `orders.admin_note` (V6-010);</li><li>O-14 (V6-012);</li><li>F6: anon reads error instead of returning 0 rows (V6-030).</li></ul></li></ul> |
| **Public Tap states** | **Exists** | <ul><li>Active, paused, unavailable, error, offline and loading: `src/pages/PublicTap.tsx:52-103,178-183`.</li><li>Draft, archived, suspended, unknown and invalid all render an identical "unavailable", which is deliberate and stops slug enumeration. Golden suite: 30 slugs, byte-identical across 020/021.</li><li>"Deactivated" maps to paused (owner) or archived.</li><li>NFC/QR sources are recorded (`PublicTap.tsx:129-138`).</li><li>Social previews are only partial (V6-033).</li></ul> |
| **Privacy tiers** (public / trusted / organization / private) | **Missing** | Only per-channel visibility. A field is shown when it is enabled and its add-on is owned (`get_public_profile`, baseline:2698-2783), plus the Tap pause toggle (`Settings.tsx:173`). A tier model is a new feature (V6-058) |
| **Payments → fulfilment → entitlement** | **Broken on live / fixed locally** | <ul><li>Server: HMAC with timing-safe compare (`razorpay-webhook.mjs:32-43`, `verify-payment.mjs:44-50`), idempotency ledger (`razorpay-webhook.mjs:63-66`), amount/currency check and capture (`:106-123`), server-side prices (`create-order.mjs:416-437`), live-key guard (`netlify/lib/razorpay.mjs:40-55`).</li><li>On live:<ul><li>I-1/I-2/I-3 fail until 021 is applied (B-2);</li><li>**card records are never created (I-4, V6-003)**.</li></ul></li><li>No JS test drives `fulfilOrder` against a database (V6-017).</li></ul> |
| **Entitlements** | **Exists** | <ul><li>One backend-authoritative lookup: `src/services/entitlements.ts:54+`.</li><li>The database enforces it: `enforce_tap_edit_rules`, and `get_public_profile` clamps the experience.</li><li>The 24 remaining `=== 'goat'`-style comparisons are presentation and catalogue selection, not access control.</li><li>There is no subscription layer; purchases are one-time (V6-059).</li></ul> |
| **Customer dashboard** | **Exists** | <ul><li>13 protected pages (`src/AccountApp.tsx:109-121`).</li><li>The D-U4 draft Tap is handled: the "Preview and publish" checklist (`src/pages/Account.tsx:143`) and "Publish Tap" (`src/pages/TapEditor.tsx:871`).</li><li>No "coming soon", TODO or `href="#"` found.</li><li>The per-page loading/empty/error walk is Stage 4 work.</li></ul> |
| **Admin** | **Partial** | <ul><li>DB layer: 45 `admin_*` RPCs (frozen, contract-tested).</li><li>Two edge functions with server-side permission checks and audit (`supabase/functions/_shared/admin.ts`).</li><li>No admin UI in this repository (V6-042).</li></ul> |
| **Notifications** | **Partial** | <ul><li>In-app (`notifications` table and triggers), realtime (`src/components/app/LiveNotifications.tsx`), order SMS through Twilio/MSG91 (`netlify/lib/sms.mjs`, tested).</li><li>Email is not configured (`orders.email_status` default `'not_configured'`, baseline:3752) (V6-038).</li></ul> |
| **Analytics** | **Partial** | <ul><li>`tap_events`, `get_tap_analytics` and `get_tap_link_clicks`, plus `src/pages/Analytics.tsx`.</li><li>`record_tap_event` is callable by anon with no rate limit or dedupe, and hashes visitors as unsalted `md5(ua\|ip\|date)` (baseline:3091-3136) (V6-032).</li></ul> |
| **Observability / logging** | **Missing (minimum)** | <ul><li>34 `console.*` calls across the functions; no request id, structured log, `/api/health` or error tracking.</li><li>No React error boundary: `src/main.tsx:29-35`.</li><li>On an amount mismatch the webhook does raise an admin notification (`razorpay-webhook.mjs:117-125`).</li><li>Doc 12 M0.6 defines the minimum (V6-018).</li></ul> |
| **SEO** | **Exists** | <ul><li>The build emits `sitemap.xml`, `robots.txt`, `llms.txt`, `404.html`, prerendered pages with JSON-LD, and OG images (`src/seo/build.ts`, `vite.config.ts:34-49`; `dist/` CONFIRMED).</li><li>The SEO CI gate (`test:seo`) exists only on the unmerged commerce branch (V6-015).</li></ul> |
| **Accessibility** | **Partial** | <ul><li>80 `aria-label`s, no `<img>` without alt, `prefers-reduced-motion` respected (5 files).</li><li>No skip link and no automated a11y checks (V6-039).</li></ul> |
| **Performance** | **Partial** | <ul><li>The public Tap entry is budget-gated at 88.55 / 90 kB.</li><li>Storefront, account and CSS are not budgeted.</li><li>The 3D hero (three.js) on the other checkout would be a regression risk if merged.</li></ul> |
| **Security headers / CORS** | **Exists** | <ul><li>CSP, HSTS and `X-Frame-Options: DENY` are identical in `netlify.toml:18-28` and `vercel.json` (a build check keeps them equal).</li><li>The admin edge functions allow CORS `*`, but auth is a bearer token, not cookies (V6-044).</li></ul> |

---

## 4. Blockers (human gates: Claude Code cannot clear these)

| ID | Blocker | Impact | Decision / action needed |
|---|---|---|---|
| **B-1** | **Credential rotation (DEC-2026-001) NOT DONE.** The doc 12 §2A gate was waived for M0.3 only | No production release while exposed keys may be valid. **V6 Stages 2–6 are outside the waiver** | Rotate (human), **or** extend the §2A waiver in writing to V6 Stages 2–6 (repository and local work only) |
| **B-2** | **020 + 021 are applied nowhere** | Production still has I-1 (a first-time buyer's payment is captured but the order is never marked paid), I-2 (profile saves fail), I-3, and F1 (a customer can clear an admin suspension) | Human application after the DEC-2026-018 cool-off, the checklist and the VERIFY ON LIVE queries in each migration header |
| **B-3** | **Live payments: G-PAY** requires DEC-024 verified on production, rotation, K5 and G2 | The RC can be ready, but cannot take real money | Human decision at the production gate |
| **B-4** | **No remote; CI never ran** | No independent verification of any gate. The Node-22 payment check has never run | Create the GitHub repository and push (human; V6 rules forbid Claude Code from pushing) |
| **B-5** | **E2E environment.** No Docker, Supabase CLI or browser runner on this machine, and GoTrue cannot run in PGlite | Stage 5 journeys (a) sign-up → public Tap and (b) checkout → entitlement cannot run end to end | Choose: local Supabase (install Docker + CLI), an allowlisted **non-production** Supabase project (DEC-2026-027 open; needs explicit authorization), or DB-level journeys plus a browser test of the static flows |

---

## 5. Critical bugs

| ID | Bug | Status |
|---|---|---|
| I-1/I-2/I-3 | `customer_id` written as the auth user id; fails the live FK (23503) | **Fixed in 021, locally only** (B-2) |
| **I-4 (V6-003)** | `fulfilment.mjs:249-257` upserts `cards` with `onConflict: 'order_id,sku'`. Live's unique key is `(order_id, sku, card_slot)` and `cards.card_id` is NOT NULL (baseline:3206), so the call fails with 42P10, then 23502. It is **logged, not thrown**, so a paid card order completes with **no card record and no activation code** | **Open.** CONFIRMED in isolation (DEC-2026-024). Live frequency is VERIFY ON LIVE. The fix needs the card-model decision (DEC-2026-028 / DEC-2026-002) |
| I-5 (V6-019) | `cards_issue_activation_code()` calls `gen_random_bytes` unqualified (baseline:2301) | If pgcrypto lives in `extensions` on live, every card insert fails. VERIFY ON LIVE |

---

## 6. Security risks

| ID | Risk | Severity | Evidence |
|---|---|---|---|
| F1 | A customer can clear an admin suspension | P1 → fixed by 020 (**not on live**) | `020_guard_suspension_columns.sql` |
| **F2 (V6-010)** | A customer can read the internal `orders.admin_note` on their own order | P1 | baseline:3742 (column), :1958 (admin writes it), `orders_select_owner_or_admin` (row-level, every column). The fix is ready in `supabase/proposed/011_admin_notes_off_customer_rows.sql` (verify-011 16/16) |
| **O-7 (V6-011)** | An owner can re-activate a card that an admin or expiry suspended | P1 | `customer_activate_card`, baseline:2362; `docs/shygon-os/HUMAN_DECISION_PACK.md` §2 |
| **O-14 (V6-012)** | A signed-in customer can insert their own active, published Tap without paying | P1 (business rule; no data exposure) | `tap_profiles_insert_own`, baseline:5939; `docs/DECISIONS.md` O-14 |
| F4 + O-3 (V6-035) | The card OTP goes to an unverified phone; the owner can read the activation code, and it is accepted without OTP | P2 | baseline:2362,2386; DEC-2026-022 Q3. **Auth changes not authorized** |
| F6 + O-1 (V6-030) | `*_select_owner_or_admin` policies apply to anon and call `is_admin()`; `require_admin` is executable by anon | P2 | baseline:5805,5955,6879 |
| V6-031 | The order id suffix uses `Math.random` | P2 | `create-order.mjs:110`; DEC-2026-014 |
| V6-032 | Analytics flooding and a reversible visitor hash | P2 | baseline:3091-3136 |
| V6-014 | The secret-scan gate is permanently red on an approved public key | P1 (process) | `9c8caa7`; DEC-2026-020 |

---

## 7. Missing features and technical debt (summary)

- **Missing, but needed for the RC:**
  - minimum observability (V6-018);
  - E2E harness (B-5);
  - JS fulfilment tests (V6-017);
  - email channel (V6-038, provider decision);
  - per-Tap link previews (V6-033);
  - automated a11y checks (V6-039).
- **Missing, and new feature areas (recommend cut):** privacy tiers (V6-058), subscriptions (V6-059).
- **Technical debt:**
  - 360 kB of unreferenced compiled assets in `src/components/shygontap/assets/` (V6-052);
  - stale V5 reports at the repository root (V6-053);
  - two hosting configs (V6-043);
  - the duplicated admin role map (V6-051);
  - the obsolete `supabase/tests/baseline.sql` shim (V6-057);
  - `database.types.ts` not regenerated from live (V6-056);
  - the `APPLY_ALL.sql` replay hazard (V6-040);
  - Node 20 locally vs the required 22 (V6-041).

---

## 8. Backlog (for approval)

Priority: P0 release blocker · P1 must complete · P2 should complete · P3 defer. Effort: S ≤ ½ day · M ≤ 1½ days · L > 1½ days. **Owner** = a human action or decision, not Claude Code work.

| ID | Area | Finding | Evidence (file:line) | Priority | Effort | Stage |
|---|---|---|---|---|---|---|
| B-1 | Release | Credential rotation not done; V6 is outside the §2A waiver | `DEC-2026-001_credential-exposure-rotation.md:16,92` | **P0** | S (human) | Owner, before Stage 2 |
| B-2 | Release | 020/021 not applied; I-1/I-2/I-3/F1 remain on live | `supabase/migrations/020_*.sql`, `021_*.sql` headers | **P0** | M (human) | Owner, at the production gate |
| B-3 | Release | Live payments need G-PAY | `M0_3_IMPLEMENTATION_SCOPE.md:214` | P0 for go-live, not for the RC | — | Owner |
| V6-003 | Fulfilment | I-4: paid card orders get no `cards` row or activation code | `netlify/lib/fulfilment.mjs:249-257`; baseline:3206 | **P0** | M | Stage 3 (needs the card-model decision) |
| B-4 / V6-013 | Release | No remote; CI never ran; the Node-22 check never ran | `git remote -v` (empty); `.github/workflows/ci.yml` | P1 | S (human) | Owner |
| B-5 / V6-016 | Testing | No E2E environment (no Docker, Supabase CLI or Playwright) | `package.json` devDependencies; `docker`: not found | P1 | M | Decide before Stage 3; build in Stage 5 |
| V6-010 | Security | F2: customers read `orders.admin_note` | baseline:3742,1958; `supabase/proposed/011_*.sql` | P1 | S | Stage 2 |
| V6-011 | Security | O-7: owner undoes admin/expiry card suspension | baseline:2362 | P1 | M | Stage 3 (card-model decision) |
| V6-012 | Authorization | O-14: self-provisioned active Tap without payment | baseline:5939 | P1 | S (policy change: ask) | Stage 2 |
| V6-014 | Release | Secret-scan gate red on approved key `9c8caa7` | `scripts/ci/secret-scan.mjs`; DEC-2026-020 | P1 | S (decision) | Owner → Stage 5 |
| V6-015 | Scope | Parallel branches: commerce C5 (`93ae352`), upgrade-fix (`71e79ec`, migrations 022–028 vs M0.4's 022), uncommitted website and 3D work | `git worktree list` | P1 | — (decision) | Owner, before Stage 2 |
| V6-017 | Testing | `fulfilOrder` (claim, retry, entitlements, safety net, SMS) not tested against a database | `netlify/tests/*.mjs`; `supabase/tests/identity-contract.mjs` | P1 | M | Stage 3 |
| V6-018 | Observability | No structured logs, request id, health endpoint, error tracking or error boundary | `netlify/functions/*` (34 `console.*`); `src/main.tsx:29-35` | P1 | M | Stage 4 |
| V6-019 | Fulfilment | I-5 pgcrypto location | baseline:2295-2301 | P1 | S (human query) | Owner → Stage 3 |
| V6-020 | Governance | V6 day-per-stage cadence vs the DEC-018 L3 cool-off; V6 stages vs doc 12 M0.4–M0.6 numbering | DEC-2026-018; doc 12 §3 | P1 | — (decision) | Owner, before Stage 2 |
| V6-030 | RLS | F6 anon policy shape; O-1 `require_admin` executable by anon | baseline:5805,5955,6879; doc 12 M0.4 | P2 | S | Stage 2 |
| V6-031 | Security | `Math.random` order-id suffix | `netlify/functions/create-order.mjs:110` | P2 | S | Stage 2 |
| V6-032 | Analytics | No rate limit or dedupe; unsalted MD5 visitor hash | baseline:3091-3136 | P2 | M | Stage 3 |
| V6-033 | Tap | `/t/` link previews are generic (meta is client-side) | `src/pages/PublicTap.tsx:66-78` | P2 | M | Stage 3 |
| V6-034 | Tap | F3: Tap stays public with every card suspended or expired | `supabase/tests/golden/public-tap.json` (`f3-*`) | P2 | M (decision) | Stage 3 |
| V6-035 | Auth | F4 + O-3: OTP to an unverified phone; code readable and usable without OTP | baseline:2362,2386; `netlify/functions/card-otp.mjs` | P2 | M (Auth: ask) | Stage 2 |
| V6-036 | Auth | Password minimum 6 client-side only; email confirmation unverified | `src/pages/Auth.tsx:229` | P2 | S (setting: ask) | Stage 2 |
| V6-037 | Privacy | Account deletion by request only; no flow or runbook | `src/pages/legal/PrivacyPolicy.tsx:131` | P2 | M (legal: ask) | Stage 4 |
| V6-038 | Notifications | Email channel not configured | baseline:3752; DEC-2026-031 | P2 | M (provider) | Stage 4 |
| V6-039 | Accessibility | No automated a11y checks; no skip link | `src/` (grep) | P2 | M | Stage 6 |
| V6-040 | Migrations | `APPLY_ALL.sql` / `db:bundle` replay hazard (text warnings only) | `supabase/tests/bundle.mjs` | P2 | S | Stage 2 |
| V6-041 | Dev env | Node 20.18 locally vs engines ≥ 22.12 / `.nvmrc` 22 | `package.json:6-8` | P2 | S (human) | Owner |
| V6-042 | Admin | No admin UI in the repository (Expo APK external); Stage 4 admin checks are limited to the DB and edge layer | `supabase/functions/*`; `src/AccountApp.tsx` | P2 | — (decision) | Stage 4 |
| V6-043 | Hosting | Two deploy targets (Netlify and Vercel) | `netlify.toml`; `vercel.json` | P2 | S (decision) | Stage 6 |
| V6-044 | Admin | Edge functions allow CORS `*` (bearer auth) | `supabase/functions/_shared/admin.ts:38-41` | P3 | S | Stage 5 |
| V6-050 | Identity | O-13 at sign-up (`handle_new_user` collision; negligible odds; an Auth change) | baseline:2878 | P3 | S | Defer |
| V6-051 | Admin | Role map duplicated in edge functions (equal to live today; CONFIRMED) | `supabase/functions/_shared/admin.ts:110-140` | P3 | S | Stage 4 |
| V6-052 | Debt | 360 kB of unreferenced compiled assets in `src/` | `src/components/shygontap/assets/` | P3 | S | Stage 6 |
| V6-053 | Debt | Stale V5 reports at the repository root | `V5_*.md`, `TEST_REPORT.*`, `shygon_middle.txt` | P3 | S | Stage 6 |
| V6-054 | Dependencies | esbuild dev-server advisory (low) | `npm audit` | P3 | S | Stage 6 |
| V6-055 | Performance | CSS and non-Tap chunks not budgeted | `scripts/check-bundle-size.mjs` | P3 | S | Stage 6 |
| V6-056 | Data | `database.types.ts` not regenerated; `tap_profiles.user_id` nullable (VERIFY count) | `src/lib/database.types.ts` | P3 | M | Defer |
| V6-057 | Debt | Obsolete `supabase/tests/baseline.sql` shim | `supabase/tests/baseline.sql` | P3 | S | Defer |
| V6-058 | Feature | Privacy tiers do not exist | `get_public_profile`; `src/pages/Settings.tsx` | P3 | L | **Cut** |
| V6-059 | Feature | Subscription layer does not exist (one-time purchases) | `src/services/entitlements.ts` | P3 | L | **Cut** |
| V6-060 | Entitlements | Stage 3 "replace scattered `plan ===` checks" is already done | `src/services/entitlements.ts`; DB enforcement | — | — | **Close, no work** |

---

## 9. Recommended scope cuts (so P0/P1 fit in the week)

1. **Cut (new feature areas, not hardening):**
   - privacy tiers (V6-058; it depends on the organisations decision, DEC-2026-025);
   - subscriptions (V6-059);
   - anything from the commerce C0–C4 phases or `fix/upgraded-zip` (promo, reviews, tax, email outbox).
   - The RC is V5 + M0.3 hardened, not V5 + commerce.
2. **Defer to after the RC:**
   - V6-050, V6-056 and V6-057;
   - the visual work on the other worktrees (3D hero, homepage redesign). DEC-2026-034 Q2 already says they are not the baseline.
3. **Keep P2 only where it is cheap or protects the release:**
   - Keep V6-030, V6-031, V6-040, V6-033, V6-039, and the V6-037 deletion runbook (process, not code).
   - Defer V6-032 (analytics hardening) unless Stage 3 has slack.
4. **Merge only the commerce C5 SEO gate** (`93ae352`, no database work) into the V6 branch, if you want its 711 SEO checks in the RC gate set. That's a decision, not a default.
5. **Do not compress Stage 5.** E2E depends on B-5 being decided by the end of Stage 2.

## 10. Decisions needed from the owner (before Stage 2)

| # | Decision | Options | Recommended |
|---|---|---|---|
| D-1 | **§2A gate for V6** (B-1) | Rotate now · extend the M0.3 waiver in writing to V6 Stages 2–6 (repository/local only) · pause V6 | **Extend the waiver for repository/local work and schedule the rotation this week** (it is still required before any production step) |
| D-2 | **What the RC contains** (V6-015) | V6 base only · + commerce C5 SEO gate · + upgrade-fix | **V6 base + the C5 SEO gate only** |
| D-3 | **Governance mapping** (V6-020) | Treat the V6 stages as doc 12 M0.4–M0.6 (keep the numbering; record the deviation) · free-standing V6 | **Map onto M0.4–M0.6 and record the deviation.** Batch L3 changes so each 24-hour cool-off overlaps the next stage |
| D-4 | **E2E environment** (B-5) | Local Supabase via Docker (machine install) · allowlisted non-production project · DB-level journeys plus a static browser test | **Local Supabase via Docker** if you can install it. Otherwise a non-production project, which needs your explicit authorization (DEC-2026-027) |
| D-5 | **I-4 card model** (V6-003, V6-011) | V5 single-card model · live slot model (`fulfil_order()`) | Your call (DEC-2026-028 / DEC-2026-002); it blocks the only engineering P0 |
| D-6 | **O-14 policy change** (V6-012) | Restrict client Tap INSERT (server-only provisioning) · leave as is | **Restrict.** The policy change is L3 |
| D-7 | **Secret-scan gate** (V6-014) | Add the `9c8caa7` fingerprint to `.gitleaksignore` under DEC-2026-020 · scan only the release branch · keep it red | **Fingerprint under DEC-2026-020**, recorded |
| D-8 | **Admin scope** (V6-042) | DB/edge layer only · bring the admin UI into scope | **DB/edge layer only** for the RC |

**STOP.** Nothing in this report has been fixed. Stage 2 starts only after the backlog and the cuts are approved.
