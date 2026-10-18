# TESTING_GUIDE

Labels: `VERIFIED IN CURRENT CHECKOUT` · `VERIFIED BY CURRENT TEST` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

**No test or script was executed in this pass.** Every "VERIFIED BY CURRENT TEST" label is therefore absent. Commands below are copied from `package.json` and file listings; they must be run by the next agent with approval.

## 1. Prerequisites

- Node **>= 22.12.0** (`package.json` `engines`). VERIFIED IN CURRENT CHECKOUT.
- `npm ci` (or `npm install`) — **not run**. Installing dependencies is part of setup but was excluded from this audit by the safety rules. `node_modules` is absent in the V5 worktree.
- Database tests use the no-Docker PGlite-backed harness (`@electric-sql/pglite` in devDependencies). VERIFIED IN CURRENT CHECKOUT (rebaseline `package.json`). The harness is described in local memory as "`npm run db:apply` / `db:verify` run the migrations on real Postgres without Docker" — this is the **owner's memory note**, UNVERIFIED in the repo itself.
- No live Supabase credentials are needed for local tests. **Do not** point any test at production. Live-auth tests (`supabase/tests/live-auth-rls.mjs`) need credentials — do not run without owner approval.
- Environment variable **names** only are in `.env.example` (VERIFIED IN CURRENT CHECKOUT): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_RAZORPAY_KEY_ID`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_SECRET`, `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `TWILIO_MESSAGING_SERVICE_SID`, `OTP_DEV_MODE`, `ALLOW_LIVE_PAYMENTS_LOCALLY`. Values were not read.

## 2. Script inventory (rebaseline `package.json`, VERIFIED IN CURRENT CHECKOUT)

| Script | Command | Purpose | Last result | Label |
|---|---|---|---|---|
| `lint` | `eslint .` | Lint | Historical "lint clean" (request) | HISTORICAL RESULT |
| `build` | `tsc -b && vite build` | Type-check + bundle | None recorded | UNVERIFIED |
| `db:apply` | `node supabase/tests/apply.mjs` | Apply migrations locally | Historical 23/23 (request) | HISTORICAL RESULT |
| `db:verify` | `node supabase/tests/verify.mjs` | Verify schema | Historical 23/23 (request) | HISTORICAL RESULT |
| `db:bundle` / `db:bundle:check` | `bundle.mjs` / `bundle.mjs --check` | Bundle migrations | None recorded | UNVERIFIED |
| `db:push` | `node supabase/tests/apply-remote.mjs` | **Remote** apply | **Do not run** (production-impacting) | VERIFIED IN CURRENT CHECKOUT (script) |
| `test:db` | `db:apply && db:verify && rls-adversarial && rls-matrix && identity && admin-notes && golden && admin-contract && rollbacks && account-deletion && db:bundle:check && test:db:history` | Full DB chain | None recorded | VERIFIED IN CURRENT CHECKOUT (script) |
| `test:db:history` | `node supabase/tests/history-seed.mjs` | History seed | None recorded | UNVERIFIED |
| `test:rls-matrix` | `node supabase/tests/rls-matrix.mjs` | RLS / access-control matrix | None recorded | UNVERIFIED |
| `test:identity` | `identity-contract.mjs` | Identity contract | None recorded | UNVERIFIED |
| `test:admin-notes` | `admin-notes.mjs` | Admin notes | None recorded | UNVERIFIED |
| `test:golden` | `golden-public-tap.mjs` | Public-Tap golden output | None recorded | UNVERIFIED |
| `test:admin-contract` | `admin-contract.mjs` | Admin contract | None recorded | UNVERIFIED |
| `test:rollbacks` | `migration-rollbacks.mjs` | Rollbacks | None recorded | UNVERIFIED |
| `test:account-deletion` | `account-deletion.mjs` | Account deletion | None recorded | UNVERIFIED |
| `test:push-guard` | `db-push-guard.mjs` | Push guard | None recorded | UNVERIFIED |
| `test:suspension` | `supabase/tests/suspension-guard.mjs` with `deny-network` preload | Suspension guard (DEC-2026-003) | Memory: 46/46 (owner note); **not re-run** | HISTORICAL RESULT |
| `test:public-tap` | `supabase/tests/public-tap.mjs` | Public Tap | None recorded | UNVERIFIED |
| `test:admin-edge` | `supabase/tests/admin-edge.mjs` | Admin edge functions | None recorded | UNVERIFIED |
| `test:payments` / `:ci` | `netlify/tests/payments-and-sms.mjs`, `functions-security.mjs` | Payments + security | None recorded | UNVERIFIED |
| `test:payment-chain` | `netlify/tests/payment-chain.mjs` | Payment chain | None recorded | UNVERIFIED |
| `test:observability` | `netlify/tests/observability.mjs` | Observability | None recorded | UNVERIFIED |
| `test:security` | `netlify/tests/security.mjs` | Security | None recorded | UNVERIFIED |
| `test:components` | `vitest run` | Component tests | None recorded | UNVERIFIED |
| `test:e2e` | `playwright test` | End-to-end | None recorded | UNVERIFIED |
| `test:bundle` | `scripts/check-bundle-size.mjs` | Bundle size | None recorded | UNVERIFIED |
| `test:bundle-secrets` | `scripts/ci/check-bundle-secrets.mjs dist` | Secrets in built bundle | None recorded | UNVERIFIED |
| `test:seo` | `scripts/ci/check-seo.mjs dist` | SEO | None recorded | UNVERIFIED |
| `test:secrets` | `scripts/ci/secret-scan.mjs` | Secret scan | None recorded | UNVERIFIED |
| `ci` | lint + build + the above chain + `npm audit --audit-level=high` | Full CI | None recorded | VERIFIED IN CURRENT CHECKOUT (script) |
| `stack` | `node supabase/local/serve.mjs` | Local no-Docker stack | None recorded | UNVERIFIED |

## 3. Test files present (rebaseline `supabase/tests/`, VERIFIED IN CURRENT CHECKOUT)

`013_live_dry_run.sql`, `account-deletion.mjs`, `admin-contract.mjs`, `admin-edge.mjs`, `admin-notes.mjs`, `apply-remote.mjs`, `apply.mjs`, `baseline.sql`, `bundle.mjs`, `db-push-guard.mjs`, `golden/` (directory), `golden-public-tap.mjs`, `history-seed.mjs`, `identity-contract.mjs`, `lib/` (directory), `live-auth-rls.mjs`, `live-auth-shim.sql`, `live-platform-shim.sql`, `migration-rollbacks.mjs`, `public-tap.mjs`, `rls-adversarial.mjs`, `rls-matrix.mjs`, `schema-drift.mjs`, `suspension-guard.mjs`, `verify-011-admin-notes.mjs`, `verify.mjs`.

Notes:
- **Schema drift** suite: `schema-drift.mjs` exists but has **no** `package.json` script in the rebaseline file. Invocation is UNVERIFIED. Run directly only after reading it.
- **Migration 025 pre-apply checks**: no file with that name was found. UNVERIFIED whether such a check exists.
- **verify-011**: `verify-011-admin-notes.mjs` exists; no `package.json` script was seen for it. Invocation UNVERIFIED.
- **Adversarial RLS**: `rls-adversarial.mjs` (part of `test:db`). Historical 48/48 (request) — HISTORICAL RESULT.
- **`supabase/tests/baseline.sql`**: this is the **test loader** the request mentions. Its interaction with a fresh `000_live_baseline_*.sql` is UNVERIFIED.
- Schema-related "baseline" test loader (`baseline.sql`) must be checked before loading the fresh dump.

## 4. Historical results (request-supplied; NOT current)

| Result | Value | Label |
|---|---|---|
| Database apply/verify | 23/23 | HISTORICAL RESULT |
| RLS adversarial | 48/48 | HISTORICAL RESULT |
| verify-011 | 16/16 | HISTORICAL RESULT |
| Lint | clean | HISTORICAL RESULT |
| npm audit | zero high-severity findings | HISTORICAL RESULT |
| Suspension guard | 46/46 (memory note, `test:suspension`) | HISTORICAL RESULT |

**Do not present any of these as current.** They must be rerun.

## 5. Which tests must be rerun

Every suite in §2 must be re-run on the **rebaseline branch after the fresh baseline is reviewed**, and on any fix branch. Specifically:

1. `npm run lint`
2. `npm run build` (type-check via `tsc -b`)
3. `npm run db:apply` then `npm run db:verify`
4. `npm run test:db` (full chain)
5. `npm run test:suspension`
6. `npm run test:public-tap`
7. `npm run test:admin-edge`
8. `npm run test:payments:ci`, `npm run test:payment-chain`
9. `npm run test:components`
10. `npm audit --audit-level=high`
11. Schema drift and migration-025 pre-apply checks — invocation to be determined by reading the scripts.

Failures must be reported with output. **Do not weaken tests or regenerate expected values automatically** (owner rule in the request).

## 6. Safe-command rules

- Never run `db:push` (remote apply) without explicit owner approval.
- Never pass a production connection string to any test.
- Never run `supabase/tests/live-auth-rls.mjs` or any script that calls live Supabase without approval.
- `test:*` scripts that use `deny-network` (`--import ./scripts/ci/deny-network.mjs`) are the safe default: they block outbound network. VERIFIED IN CURRENT CHECKOUT (script text).
- Read each script before running it. This guide does not authorize execution.

## 8. Observed results — 2026-10-18 (VERIFIED BY CURRENT TEST)

Environment: `shygon-tap-v5-web-rebaseline`, branch `v6/rebaseline-2026-10-18`, HEAD `4d730c4`, working tree has 7 uncommitted entries (unchanged by this run). **Node v20.18.0** — below the engine floor `>=22.12.0`; `npm ci` was not re-run (`node_modules` existed). The DB apply loaded `supabase/baseline/000_live_baseline.sql` (the 2026-09-30 dump). The fresh 2026-10-18 dump does not exist, so none of these results reflect it.

| Command | Exit | Result |
|---|---|---|
| `npm run lint` | 0 | clean |
| `npm run build` | 0 | built in 8.19 s |
| `npm audit --audit-level=high` | 0 | 1 low (esbuild, GHSA-g7r4-m6w7-qqqr, dev-server file read on Windows); no high |
| `npm run db:apply` | 0 | all migrations 020–026, 028 applied; re-run idempotent |
| `npm run db:verify` | 0 | **21 passed, 0 failed** (historical note said 23/23 — not reproduced; count differs) |
| `npm run test:db` | 0 | sub-suite counts, in order: 21, 64, 946 (32 tables, 7 callers), 69, 12, 10, 15, 9, 9, 2 — all 0 failed. Which file produced each count was not mapped line-by-line. |
| `npm run test:suspension` | 0 | 46 passed, 0 failed |
| `npm run test:public-tap` | 0 | 25 passed, 0 failed |
| `npm run test:admin-edge` | 0 | 11 passed, 0 failed |
| `npm run test:payments:ci` | 0 | 13 passed, 0 failed, **1 blocked** (`verify-payment refuses an unauthenticated caller`: needs Node ≥ 22; this machine is Node 20) |
| `npm run test:payment-chain` | 0 | 30 passed, 0 failed (includes a logged `webhook.error` line from a negative test; the test passed) |
| `npm run test:security` | 0 | 11 passed, 0 failed |
| `npm run test:observability` | 0 | 10 passed, 0 failed |
| `npm run test:components` | 0 | 23 tests in 4 files passed |
| `npm run test:seo` | 0 | PASS |
| `npm run test:bundle-secrets` | 0 | 207 files in dist, no secret, no source map |
| `npm run test:bundle` | 0 | PASS (public Tap entry JS within budget) |
| `npm run test:push-guard` | 0 | 18 passed |
| `npm run test:admin-notes` | 0 | 12 passed |
| `npm run test:golden` | 0 | 10 passed |
| `npm run test:admin-contract` | 0 | 15 passed |
| `npm run test:rls-matrix` | 0 | 946 passed |
| `npm run test:identity` | 0 | 69 passed |
| `npm run test:rollbacks` | 0 | 9 passed |
| `npm run test:account-deletion` | 0 | 9 passed |
| `npm run test:secrets` | **1** | **FAIL**: gitleaks not runnable (needs gitleaks 8.30.1 or `GITLEAKS_BIN`). Fail-closed by design. Not installed in this pass. |
| `npm run test:e2e` | — | **Not run** (Playwright config not inspected) |

Not run by design: `db:push` (remote), `supabase/tests/live-auth-rls.mjs` (live), any production command.

Not run and not wired to a script: `supabase/tests/schema-drift.mjs` (exists; no `package.json` entry), `supabase/tests/verify-011-admin-notes.mjs` (exists; no entry), and a migration-025 pre-apply check (no file found by that name). Their status is unknown until each is read and run.

## 7. Known gaps

- Tests were executed on 2026-10-18 (§8). Not run: `test:e2e`, `db:push`, live-auth tests.
- `test:secrets` needs gitleaks 8.30.1 (not installed here).
- `test:e2e` requires a Playwright config (not checked).
- The V5 worktree (`8becea3`) has **no** `package.json` test scripts for the V6 suites; those live only on V6 branches.
