# SHYGON V6 Stage 4 report: customer, admin and observability

| | |
|---|---|
| Branch | `v6/stage-4-customer-admin` (from Stage 3 `56b0629`) |
| Date | 2026-10-10 (started 2026-10-09; paused overnight at the owner's request) |
| Authorization | Owner, 2026-10-06: "complete software"; Stages 3–6 back-to-back (DEC-2026-035 A-1). Scope: approved backlog items only, no new feature areas |
| Not done | Nothing applied to any real database. No production contact, deployment, push, credential rotation or live payment. Migrations 020–026 wait for the DEC-2026-018 cool-off and checklist |

## 1. What changed

### Customer dashboard
- **Your data (V6-072).** Settings → Privacy now has a "Your data" section.
  - "Download your data" saves a JSON copy of everything row-level security lets the account read: profile, Tap, orders and their items, entitlements, cards, notifications, support tickets and messages, account events (`src/services/privacy.ts`). Payment ledger rows are admin-only by RLS; each order already carries its amount, payment status and Razorpay references. Visitors' analytics are not the owner's data.
  - "Ask us to delete your account" opens one `privacy` support ticket, or finds the open one, and takes the customer to Support. Nothing is deleted by the button.
  - Support has a new "Privacy and your data" category.
- **No dead ends while cards are closed (D-10).**
  - Cards: a customer with no card sees "SHYGON cards are coming soon" and a link to their QR code, instead of OTP set-up advice for a card they cannot have.
  - Settings: "no Tap yet" now links to the experience purchase, and the support blurb says "Tap, order or payment".
- **Copy (V6-089).** While card sales are closed, the landing page's How-it-works steps, feature tiles, FAQ, FAQ intro, delivery benefit and footer, and the sign-in page, describe the digital Tap. A stale saved card selection is no longer shown on sign-in.
  - The FAQ JSON-LD and `llms.txt` use the same sales-aware FAQ. `llms.txt` no longer offers Essential ("included with every card") or "the configurator".
  - The card-release copy is unchanged behind the same switch.
- **Error boundary (V6-018).** A render error shows "Something went wrong / Reload the page" instead of a blank page, and is reported once through `shygon:error` (`src/components/ErrorBoundary.tsx`, `src/lib/reportError.ts`). Uncaught errors and unhandled rejections go through the same hook.

### Admin
- **V6-051, a customer cannot reach admin.** `supabase/tests/admin-edge.mjs` compiles the real admin edge functions and runs them against the real admin tables on the local stack.
  - The edge role map equals `admin_role_permissions()` for all 7 roles (30 role × permission pairs).
  - `resolveAdmin` refuses: no token, malformed or forged tokens, a customer, a customer who sets `role=admin` in their own metadata or inserts themselves into `admin_users`, an inactive admin.
  - A viewer may read but not refund.
  - `admin-refund` and `admin-push` answer 403 to a customer and to a viewer.
- **Role checks, suspension, restoration, audit and the order, payment and customer views** were proven in Stages 2–3: RLS matrix 946 (incl. the 41 admin RPCs), admin contract, rls-adversarial, E2E journey (c). They are unchanged.

### Observability (V6-018, V6-075)
- **Logger.** `netlify/lib/log.mjs`: one JSON line per event.
  - Request ids are taken from `x-request-id` / `x-nf-request-id` / `x-vercel-id` when well-formed, and returned on every response.
  - Redaction of secrets, signatures, tokens and contact details at any depth; long values are cut.
- **Where it applies.** Every payment function and every lib uses it (`create-order`, `verify-payment`, `razorpay-webhook`, fulfilment, `razorpay.mjs`, `orderMessages.mjs`). No free-text log line is left in `netlify/` or `api/`.
  - Security events: refused session, forged or mismatched payment (signature, customer, order, amount), refused webhook, missing setting.
  - `orderId` is always the customer-facing `ST-…` number. The webhook used the internal UUID before; fixed.
- **Health check.** `/api/health` and `?deep=1` (Netlify and Vercel): ok, or 503 "degraded" without naming the setting.
- **Docs.** `docs/v6/observability.md` maps every audit trail and covers tracing a failure, the event catalogue and the known gaps. PRODUCTION.md §7 links to it.

### Database: migration 026 (`026_orders_outlive_account_deletion.sql`, L3), V6-090
**Defect found while writing the deletion procedure.** On the live baseline, `orders.user_id` cascades from `auth.users`, and `payments`, `order_items` and `order_status_history` cascade from orders. The Supabase dashboard's "Delete user" would therefore silently delete a customer's order and payment records, which the Privacy Policy says are kept for up to 8 years (tax and company law).

026 makes that foreign key `RESTRICT`:
- the delete fails and changes nothing;
- an account with no orders deletes as before;
- it is one atomic `ALTER TABLE`, added `NOT VALID` and then validated;
- the header carries VERIFY ON LIVE queries and a tested rollback.

`APPLY_ALL.sql` was regenerated (020–026).

### Account deletion procedure (V6-072)
- **`docs/runbooks/RUNBOOK-account-deletion.md`:** receive and verify, checks, tell the customer, delete, sign-in, confirm and record, following the published Privacy Policy (30 days; orders and payments kept).
- **`docs/runbooks/account-deletion.sql`:** one atomic block.
  - Refuses unless the placeholders are filled, the account exists and is not an administrator, its `privacy` request is on record, and no order is still being fulfilled.
  - Deletes the Tap and visits, profile, customer record, entitlements, notifications, card codes, account events and support conversations.
  - Keeps orders, items and payments; retires and unlinks cards.
  - Never run on production by tooling.

### Fixes found by the tests
- **V6-091.** Page metadata (robots, title, canonical) was applied after the page painted. Under load a paused Tap briefly carried the previous page's "index" tag; the component test caught it, 1 in ~6 runs. `usePageMeta` now applies in the same commit (layout effect; the app is client-rendered only).
- **`PublicTap.test.tsx` race (test fix, product unchanged).** Three analytics assertions read the calls the instant the profile appeared, racing the effect that records the view after paint (1 failure in ~6 runs). They now wait for the effect and then check that nothing else follows. The assertions are the same, exactly one view and the same events, and are stronger than before. The two "no analytics" checks now also let pending effects finish before asserting.

### Tests and tooling
- **New suites:**
  - `supabase/tests/admin-edge.mjs` (11);
  - `netlify/tests/observability.mjs` (10);
  - `supabase/tests/account-deletion.mjs` (9; runs the runbook SQL as written, and the live-baseline cascade as the negative control);
  - `src/seo/salesCopy.test.ts` (4);
  - `src/components/ErrorBoundary.test.tsx` (2);
  - `src/test/routes.test.ts` (3: every internal address in the source is answered by a route; every dashboard nav entry is a real page);
  - `e2e/account-data.spec.ts` (1: export holds only the customer's data; deletion request is one ticket; nothing is deleted).
- **`payment-chain` +3:** add-ons and the Customization Pass, which are live checkout paths that had no chain test (V6-092).
- **`migration-rollbacks`** now also compares constraints (definition, ON DELETE, validated). A mutation check (026's rollback edited to `SET NULL`) fails as it should.
- **`package.json`:** `test:admin-edge`, `test:observability`, `test:account-deletion`. All three are in `ci`, and account deletion is also in `test:db`; `.github/workflows/ci.yml` has a step for each.

### Files
- **New:**
  - code: `api/health.mjs`, `netlify/functions/health.mjs`, `netlify/lib/log.mjs`, `src/components/ErrorBoundary.tsx`, `src/lib/reportError.ts`, `src/services/privacy.ts`;
  - migration: `supabase/migrations/026_orders_outlive_account_deletion.sql`;
  - docs: `docs/runbooks/RUNBOOK-account-deletion.md`, `docs/runbooks/account-deletion.sql`, `docs/v6/observability.md`, this report;
  - tests: `supabase/tests/admin-edge.mjs`, `supabase/tests/account-deletion.mjs`, `netlify/tests/observability.mjs`, `src/seo/salesCopy.test.ts`, `src/components/ErrorBoundary.test.tsx`, `src/test/routes.test.ts`, `e2e/account-data.spec.ts`.
- **Edited:**
  - functions and libs: `netlify/functions/{create-order,verify-payment,razorpay-webhook}.mjs`, `netlify/lib/{fulfilment,razorpay,orderMessages}.mjs`;
  - pages: `src/pages/{Settings,Cards,Auth,ShygonTap,PublicTap}.tsx`, `src/main.tsx`;
  - data, services and SEO: `src/data/shygonTapData.ts`, `src/services/support.ts`, `src/seo/{meta,build,usePageMeta}.ts`, `src/styles/tap.css`, `vite.config.ts`;
  - tests: `netlify/tests/{functions-security,payment-chain}.mjs`, `src/pages/PublicTap.test.tsx`, `supabase/tests/migration-rollbacks.mjs`;
  - database: `supabase/APPLY_ALL.sql` (regenerated), `supabase/migrations/README.md`;
  - config and docs: `package.json`, `.github/workflows/ci.yml`, `PRODUCTION.md`, `docs/v6/backlog.md`.

## 2. Commands run and real results (2026-10-10, Node 20.18.0, `-v6` worktree)

| Command | Result |
|---|---|
| `npx eslint .` | exit 0 |
| `npx tsc -b` | exit 0 |
| `npx vite build` | built; `npm run test:bundle`: public Tap entry JS **88,895 B** of 90,000 (1.10 kB left), PASS |
| `npm run test:db` | db:apply + db:verify pass; rls-adversarial **64/64**; RLS matrix **946/946** (32 tables × 7 callers); identity **69/69**; admin-notes **12/12**; golden **9/9**; admin-contract **15/15**; rollbacks **8/8** (020–026 + chain, now incl. constraints); bundle check pass; history **2/2** |
| `npm run test:account-deletion` | **9/9** (incl. the live-baseline cascade: orders 1 → 0, payments 1 → 0 without 026) |
| `npm run test:push-guard` | **18/18** |
| `npm run test:payments:ci` | payments **15/15**; functions-security **13/13 + 1 BLOCKED** (needs Node 22, unchanged) |
| `npm run test:payment-chain` | **30/30** |
| `npm run test:public-tap` | **25/25** |
| `npm run test:admin-edge` | **11/11** (outbound network denied) |
| `npm run test:observability` | **10/10** |
| `npx vitest run` | **23/23** (4 files); 12 consecutive full runs green after the V6-091 fix |
| `npx playwright test` | **7/7** (journeys a, b, c, cards-not-for-sale, mobile ×2, account data) |
| `npm run test:secrets` (gitleaks 8.30.1) | history: **1 finding, `9c8caa7`** (the known Web3Forms key, V6-014 / D-7), unchanged. Uncommitted files and `dist/`: **no leaks** |
| `npm audit --audit-level=high` | pass. 1 low (esbuild, V6-054, unchanged) |

## 3. Open items

- **P0 (release, unchanged):** B-1 credential rotation; B-2 production apply of 020–026 after the cool-off; B-3 live payments.
- **P1:**
  - B-4, the GitHub repository (CI has never run remotely);
  - V6-090's production apply is part of B-2. Until 026 is live, **nobody may use "Delete user" on a customer with orders** (written into the runbook and PRODUCTION.md).
- **P2:**
  - V6-093 / O-17, deleted Tap addresses can be claimed again;
  - V6-078 / O-15 and V6-088 / O-16 (decisions, unchanged);
  - V6-076 (needs D-9);
  - V6-038 (email provider);
  - the error-tracking provider, log retention and alerting (owner decisions; `docs/v6/observability.md`).
- **P3:**
  - V6-094, admin edge functions log free text;
  - V6-052, dead compiled assets: `src/components/shygontap/assets/*.js|css` (~360 kB of V5 build output, imported by nothing; for Stage 5's repo and bundle scan and Stage 6 cleanup).

## 4. Decisions needed from the owner

1. **D-12, account deletion.**
   - (a) Approve the procedure: anonymise rather than delete a sign-in that has orders, plus migration 026.
   - (b) Where the deletion register lives, and who may run steps 4–5.
   - (c) O-17: reserve deleted Tap addresses or not (a reserved address may contain a name).
2. **V6-089 copy:** review the digital-first wording on the landing page and sign-in page (`src/data/shygonTapData.ts`, `ShygonTap.tsx` How-it-works details).
3. **Error tracking:** choose a provider (or none) for `shygon:error`; and log retention and alerting on the host.
4. **Still open from earlier stages:**
   - D-3, D-7, D-8, D-9, D-11;
   - O-15, O-16;
   - the `source-map-js` audit-fix confirmation;
   - the DEC-2026-018 cool-off for 020–026;
   - B-1 to B-4.
