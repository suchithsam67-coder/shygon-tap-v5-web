# SHYGON V6 Stage 3 report: payments and the Tap lifecycle

| | |
|---|---|
| Branch | `v6/stage-3-payments-tap` (from `v6/review-2026-10-05` @ `f2f1a3a`, which is Stage 2 `40b26ee` + the review document) |
| Date | 2026-10-06 |
| Authorization | Owner, 2026-10-06: "complete software"; run Stages 3–6 back-to-back; D-4 = no-Docker local stack; D-10 = digital-first; test-only dev dependencies (DEC-2026-035 A-1) |
| Not done | Nothing applied to any real database. No production contact, deployment, push, credential rotation or live payment. Migrations 020–025 wait for the DEC-2026-018 cool-off and checklist |

## 1. What changed

### Local stack (decision D-4), `supabase/local/`
End-to-end testing with no Docker:
- **Database:** PGlite running the live schema baseline, migrations 020 onward and a catalogue fixture (`seed.sql`).
- **Gateway** (`gateway.mjs`):
  - REST (`rest.mjs`): the PostgREST subset the app uses, as real SQL under each caller's role, with PostgREST's request settings.
  - Auth (`auth.mjs`): sign-up through the real `handle_new_user` trigger; HS256 sessions, refresh and logout; recovery links held in an outbox.
  - Realtime (`realtime.mjs`): accepts subscriptions and delivers nothing.
  - Unsupported syntax fails with a 400 instead of being approximated.
- **App host** (`app-host.mjs`): the built site plus the real `netlify/functions`, routed by `netlify.toml`. It applies the production CSP with only two local substitutions.
- **Razorpay stand-in** (`razorpay-sim.mjs`): the API the functions call, Checkout in the browser, and signed webhooks, all using Razorpay's documented signature scheme.

**Fidelity:**
- The database, RLS, grants, triggers and SECURITY DEFINER functions are real.
- The HTTP layers and Razorpay are stand-ins.
- Keys derive from a per-machine seed. No `.env` is read.
- While the stack runs, any fetch to a host other than loopback throws.

### Migration 025 (`025_public_tap_privacy_and_analytics.sql`, L3)
Generated from the live bodies with exact replacements, which `admin-contract.mjs` proves.

1. **V6-071 / O-2:** `get_public_tap(text)` is revoked from `anon` and `authenticated`. CONFIRMED on the live baseline: it returned an address the owner had not switched on.
2. **V6-073:** visitor hash = `sha256(daily salt | user agent | IP)`. Salts sit in the closed table `tap_visitor_salts` and are deleted after two days.
3. **V6-032:** an identical event within 10 seconds counts once, and each visitor is capped at 60 events per Tap per hour. A new index serves both checks.
4. **V6-071:** `enforce_tap_edit_rules` no longer forces phone and email back on, so the owner can hide them.

The header carries VERIFY ON LIVE queries and a tested rollback.

### Payments (`netlify/`)
- **V6-086, a bug found by the new suite:** `create-order.mjs` used `normaliseExperienceKey` without importing it. Every customer who already owned an experience got a 500 when buying another. It has been there since the V5 import, so production most likely has it. Now imported from `fulfilment.mjs`.
- **V6-070:** `create-order` refuses card orders (409) unless `CARD_SALES_ENABLED=true`.
- **V6-031:** the order-number suffix comes from `crypto.randomInt`.

### Customer-facing (D-10, digital-first)
- **`src/lib/commerce.ts`:** one switch (`VITE_CARD_SALES_ENABLED`) and one wording.
- **Card sales closed:** the store, product page, landing builder, cart, checkout and dashboard show `CardsComingSoon` and offer the digital Tap.
- **V6-087:** a customer without a Tap can now buy their first experience on the Tiers page, which creates the draft Tap and opens the editor. The no-Tap dashboard, editor, customizer and analytics now invite the purchase (`NoTapState`) instead of showing an error.
- **SEO:** product, store and home metadata and `llms.txt` take the switch. With card sales closed, product structured data claims no offer.
- **Tap editor (V6-071):**
  - "Show on Tap" switches for phone and email.
  - A visibility-only change can be saved even while the 14-day edit window is closed (it is not a content edit).

### Tests
| Suite | What it proves | Result |
|---|---|---|
| `netlify/tests/payment-chain.mjs` (`test:payment-chain`) | Checkout → Razorpay → verify / webhook → order → fulfilment → entitlement → Tap → notification:<br>• success, verify-first and webhook-first<br>• both paths at once<br>• first-time, returning and no-customers-row accounts<br>• cancel, failure, then retry<br>• late failure, manual capture<br>• a mid-fulfilment fault that is retried<br>• duplicate, replayed, forged and unsigned webhooks<br>• amount mismatch, another customer's payment<br>• entitlement consistency | **27/27** |
| `supabase/tests/public-tap.mjs` (`test:public-tap`) | Baseline negative controls<br>Lifecycle: draft → publish → pause → admin suspend (owner told, audited; owner cannot lift it) → restore → archive<br>The six states and hostile addresses<br>Field allowlist<br>Hide or show phone and email<br>Analytics: salted hash, dedupe, cap, salts closed and expiring | **25/25** |
| `src/pages/PublicTap.test.tsx` (`test:components`, V6-083) | The public page in every state:<br>• active, paused<br>• draft, suspended, archived, missing, invalid<br>• failed state lookup, network error with a working retry, offline<br>Also: NFC/QR counting, the legacy `/tap/` path, hidden contacts absent | **14/14** |
| `e2e/*.spec.ts` (`test:e2e`, Playwright on Edge) | (a) sign-up → no Tap → buy Business → draft → publish → a visitor sees it<br>(b) cancel, failure, then a paid upgrade (webhook first); backend state checked<br>(c) admin suspends → public page goes dark → owner cannot lift it → restore → audit trail<br>Plus: cards not for sale; the phone layout (no sideways scroll, hidden contact absent) | **6/6** |

Existing suites updated, never weakened:
- **`admin-contract.mjs`:** approvals for 025's two body edits, one revoke and one new closed table. It also covers approved changes to non-frozen functions, and it now applies replacements literally.
- **`rls-matrix.mjs`:** the new table is modelled (closed).
- **`rls-adversarial.mjs`:** "anon cannot resolve an unpublished Tap" now requires an outright refusal. That is stricter than before.

### Tooling
- **Dev dependencies (owner-approved):** Vitest 4, Testing Library, jsdom 26, Playwright, axe-core.
  - Vitest 3 brought a critical `tinypool` advisory, so version 4 is used.
  - jsdom 30 needs Node ≥ 22.22, so version 26 is used.
- **Audit fix:** a newly published high advisory in `source-map-js` (GHSA-68fv-2mgg-jv7q, reached through Tailwind and PostCSS) was fixed with `npm audit fix`, from 1.2.1 to 1.2.2. **No other existing package changed** (lockfile compared entry by entry). Owner to confirm (DEC-2026-035 A-1).
- **CI:** three new gate steps, plus an `e2e` job on the runner's preinstalled Chrome.
- **Scripts:** `stack`, `test:payment-chain`, `test:public-tap`, `test:components`, `test:e2e`; `ci` runs the first three.

## 2. Commands run and real results (2026-10-06, Node 20.18.0)
| Gate | Result |
|---|---|
| `npm run lint` · `npx tsc -b` · `npx vite build` | PASS · PASS · PASS |
| `npm run test:bundle` | **88,548 B = 88.55 kB**, unchanged by Stage 3 (budget 90 kB) |
| `npm run test:db` | Exit 0: verify 21/21, adversarial 64/64, **RLS matrix 946/946** (32 tables × 7 callers), identity 69/69, admin-notes 12/12, golden 8/8, **admin contract 15/15**, **rollbacks 7/7**, APPLY_ALL current (020–025), history 2/2 |
| `npm run test:push-guard` | 18/18 |
| `npm run test:payments:ci` | 15/15 + 13/13, **1 BLOCKED** (needs Node 22; unchanged) |
| `npm run test:payment-chain` · `test:public-tap` · `test:components` | 27/27 · 25/25 · 14/14 (outbound network denied; nothing refused) |
| `npm run test:e2e` | **6/6** (Edge, local stack) |
| `npm audit --audit-level=high` | PASS (1 low: esbuild dev server, V6-054) |
| `npm run test:secrets` (gitleaks 8.30.1, full history) | **1 finding, the known `9c8caa7`** (approved public key, D-7 open). The new and changed files scan clean (two test passwords in `e2e/` were made runtime-generated) |

**Negative controls observed in this stage:**
- Before the fixes, `payment-chain` failed V6-070 (the card order was accepted) and V6-086 (two 500s).
- `public-tap` shows the live baseline leaking the address and forcing the phone back on.

## 3. Open items
- **P0 (release, owner):**
  - B-1: credential rotation.
  - B-2: apply 020–025 after the cool-off and checklist.
  - B-3: live payments (G-PAY).
- **P1:**
  - B-4 (owner): create the GitHub repository and push. CI has never run.
  - V6-018 observability, V6-075 audit events, V6-072 data export and deletion: Stage 4.
  - V6-014 secret-scan gate: D-7.
- **P2:**
  - V6-088 / O-16: account reactivation lifts Tap moderation.
  - V6-089: card-first copy left on the sign-in page and in the landing FAQ.
  - V6-033: link previews, deferred.
  - V6-078 / O-15.
  - The rest as listed in `docs/v6/backlog.md`.

## 4. Decisions needed from the owner
1. **D-11:** should a new Tap start without the login email in its public contact? Recommended: yes, privacy by default. Today it is pre-filled and switched on.
2. **Confirm the `source-map-js` audit fix** (lockfile only).
3. Still open from earlier stages:
   - D-3 (governance mapping);
   - D-7 (secret-scan gate);
   - D-8 (admin scope; interim: DB/edge only);
   - D-9 (customer-facing SHYGON ID);
   - O-15;
   - the DEC-2026-018 approval of 020–025.
