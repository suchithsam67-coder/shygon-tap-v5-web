# SHYGON V6 Stage 6 report: hardening, release documents and the clean install

| | |
|---|---|
| Branch | `v6/stage-6-rc` (from Stage 5 `80f9bbd`) |
| Release candidate code | **`287268f`**. The commit that adds this report changes documents only (`docs/`, `PRODUCTION.md`) |
| Date | 2026-10-10 |
| Authorization | Owner, 2026-10-06: "complete software"; Stages 3–6 back-to-back (DEC-2026-035 A-1). Stage 6 rule: feature freeze; only fixes, documents and verification; prepare everything and stop at the production gate |
| Not done | Nothing applied to any real database. No production contact, deployment, push, credential rotation or live payment |
| **Open P0** | **No new P0.** The release P0s are unchanged and are human actions: B-1 credential rotation, B-2 production apply of 020–026, B-3 live payments |
| **Production deployment** | **NOT AUTHORIZED.** Stopped at the production gate. Readiness: `docs/v6/readiness-report.md` (**NOT READY**) |

## 1. What each Stage 6 requirement was checked with

All results are from the clean install of §4: a fresh clone of `287268f`, Node 20.18.0, no `.env`.

| Requirement | Evidence | Result |
|---|---|---|
| Lint | `npm run lint` (ESLint) | PASS, exit 0 |
| Typecheck | `tsc -b`, the first half of `npm run build` | PASS, exit 0 |
| Build | `vite build` | PASS (32.5 s) |
| Dependency audit | `npm audit`: 0 critical, 0 high, 0 moderate. 1 low: esbuild's own development server on Windows (GHSA-g7r4-m6w7-qqqr). The build never runs that server; Vite serves development itself (V6-054) | PASS |
| Bundle size | `test:bundle`: the public Tap's first-render JS is **88,906 B gzip** of the 90,000 B budget (1.09 kB left) | PASS |
| SEO (new gate, in `ci`) | `test:seo` on `dist/`, 17 sitemap pages. robots.txt names the sitemap and disallows every signed-in route. The sitemap lists only built, crawlable pages, once each. Each page has one unique title, a 50–170 character description, a canonical equal to its own address, Open Graph and Twitter tags whose image exists, and JSON-LD that parses. With card sales closed, no structured data offers a card. The 404 page is `noindex` with no canonical, the app shell has no canonical, and `llms.txt` links only to built pages. A mutation (JSON-LD removed) fails the gate | PASS |
| Accessibility (new gate) | `e2e/a11y.spec.ts`, 5 tests. **axe** (WCAG 2.0/2.1/2.2 A and AA) on 8 public and 12 signed-in pages: labels, contrast (measured after entrance animations finish), target size (2.5.8) and landmarks. **0 violations of any impact**. **Keyboard:** the sign-in form is reached in order, and every focused control shows a visible ring. **Reduced motion:** nothing animates. **Landmarks:** one `main` and an `h1` on every page checked | PASS |
| Performance (new gate) | `e2e/performance.spec.ts` on a throttled phone (slow 4G: 150 ms, 1.6 Mb/s; 4× CPU), LCP and CLS from PerformanceObserver. **Public Tap: LCP 1,288 ms (limit 2,500), CLS 0** (3 scripts, 84,615 B). Landing page: LCP 2,020 ms (limit 4,000), CLS 0.001 | PASS |
| Migration checks | `test:db`: 020–026 applied on the live baseline, then all re-applied (idempotent). verify 21; rollbacks 8 (each migration's rollback, plus the whole chain back to the baseline; schema compared, constraints included); APPLY_ALL.sql current (7 migrations, 020 onward); admin contract 15; history 2. Line endings pinned (V6-099) | PASS |
| Regression suite | All of `npm run ci` plus E2E: RLS adversarial 64, RLS matrix 946, identity 69, admin notes 12, golden 9, account deletion 9, push guard 18, payments 15 + 13 (1 BLOCKED, Node 22), payment chain 30, public Tap 25, admin edge 11, observability 10, security 11, components 23, E2E 14, all under the production CSP with 0 violations | PASS |
| Clean install | Fresh clone → `npm ci` → build → db verify → suites → E2E (§4) | PASS (final run, 9 min 21 s) |
| Secret scan | `test:secrets` (gitleaks 8.30.1, 41 commits): **1 finding, the known one**, `generic-api-key` at `src/components/ProjectConsultation.tsx:75`, commit `9c8caa7` (the Web3Forms key, public by design). Nothing new. `test:bundle-secrets`: no secret or source map in the 207 built files | Known red (D-7) |
| Release documents | `docs/release/`: PRODUCTION-CONFIG, DEPLOYMENT, ROLLBACK, RECOVERY, KNOWN-LIMITATIONS | Written |
| Readiness report | `docs/v6/readiness-report.md` (also filled in the tracker) | **NOT READY** |

Not run: the HawkScan DAST plugin. This machine has no hawk CLI and no StackHawk API key. `test:security` covers the same surface locally: tokens, headers and CORS.

## 2. Defects found and fixed, and one incident

**Defects:**
- **Accessibility.** The public Tap had no `main` landmark: `TapExperience` now renders `<main>`, and so do `PublicTap`'s loading and state pages. The sign-in password toggle was an 18 px target; it is now 36 px (WCAG 2.5.8 needs 24).
- **SEO gate (its own defect, before it was committed).** Its JSON-LD pattern missed tags whose `type` attribute was not first. Fixed, and proven by a mutation.
- **V6-101 (measurement).** The local host served text uncompressed, so the first performance run measured 3× the bytes the production hosts send (Public Tap LCP 3.0 s). It now compresses with brotli as the hosts do: 1.2–1.3 s. The product did not change.
- **V6-099, found by the first clean install.** A Windows clone (core.autocrlf) checked the migrations out with CRLF. The admin contract failed 4 approved-edit checks, and APPLY_ALL.sql would have carried CRLF bodies. Fixed with `.gitattributes` (LF for code, SQL and documents; the live dump kept byte for byte) and CRLF normalized when migrations load (`ff73bd4`).
- **V6-100, found by the first clean install.** `test:admin-edge` failed on a fresh install with no `node_modules/.cache`. The directory is now created (`287268f`).
- **V6-052.** The unreferenced compiled V5 bundle (two JS files and one CSS file, 365,014 B) is removed from `src/components/shygontap/assets`.

**Incident: not a product or test defect.** The clean install at `287268f` that ran 15:38–17:52 passed every step except one `test:public-tap`, which exited 1.
- **What happened.** The PC went into Modern Standby during that run. The Windows System log (Kernel-Power 506/507) shows it in standby 15:44:12 → 17:30:22, 17:30:22 → 17:44:21 and 17:45:23 → 17:45:57.
- **Why that fails the suite.** Standby suspends the test process, but the database clock keeps running. The suite's analytics checks rely on two consecutive calls landing within the product's 10-second dedupe window.
- **Evidence.** The original output was lost, because the old runner kept 400 characters per step. Instead:
  - the step ended about 20 s after the last standby exit;
  - 13 uninterrupted runs passed 25/25;
  - an 11-second pause injected between two calls, in a scratch copy, fails exactly those checks (`views: expected 1, got 2`; `expected 2, got 3`).
- **Product and test.** The product is right: two events more than 10 s apart are two events. The test is unchanged.
- **Fix: the runner.** It now times every step and keeps each step's full log. The machine was held awake (the app's keep-awake), and the whole clean install was repeated from a fresh clone: PASS (§4).

## 3. What changed

| Commit | Change |
|---|---|
| `62cfaa2` | **New:** `e2e/a11y.spec.ts`, `e2e/performance.spec.ts` and `scripts/ci/check-seo.mjs` (`test:seo`, in `ci` and the workflow). `TapExperience.tsx` and `PublicTap.tsx` render `main`. `Auth.tsx` has the 36 px password toggle. `supabase/local/app-host.mjs` adds brotli. Removed `src/components/shygontap/assets/*.js/.css` |
| `ff73bd4` | `.gitattributes`; `supabase/tests/lib/migrations.mjs` normalizes CRLF |
| `287268f` | `supabase/tests/admin-edge.mjs` creates its cache directory |
| docs (this commit) | `docs/release/` (5 documents); `docs/v6/stage-6-report.md`; `docs/v6/readiness-report.md`; `docs/v6/backlog.md` (V6-039 and V6-052 done; V6-098 kept for the owner; V6-099 to V6-101 added); `docs/CHANGELOG.md`; `PRODUCTION.md` (the webhook needs `payment.authorized` too, as the function's own header says) |

No migration, policy or dependency changed in Stage 6.

## 4. The clean-install test (final run)

| | |
|---|---|
| Source | `git clone -b v6/stage-6-rc` of the worktree into an empty folder: commit `287268f`, no `.env`, migrations checked out LF |
| Tooling | Node v20.18.0, npm 10.8.2, Windows 11, Edge (Playwright) |
| Time | 2026-10-10 18:05:17 → 18:14:38 IST, with the machine held awake |

| Step | Time | Result |
|---|---|---|
| `npm ci` | 51 s | 295 packages |
| `npm run lint` | 40 s | exit 0 |
| `npm run build` (tsc + vite) | 56 s | exit 0 |
| `test:bundle` / `test:bundle-secrets` / `test:seo` | 5 / 6 / 8 s | 88,906 B of 90,000 / 207 files clean / 17 pages |
| `test:push-guard` | 11 s | 18/18 |
| `test:db` | 115 s | apply ×2; verify 21; adversarial 64; matrix 946; identity 69; admin notes 12; golden 9; admin contract 15; rollbacks 8; account deletion 9; APPLY_ALL current; history 2 |
| `test:payments:ci` | 7 s | 15/15; 13/13 + 1 BLOCKED (needs Node 22; verify-payment's refusal of a caller without a valid token is proven on the stack by `test:security`) |
| `test:payment-chain` | 9 s | 30/30 |
| `test:public-tap` | 10 s | 25/25 |
| `test:admin-edge` / `test:observability` / `test:security` | 8 / 7 / 7 s | 11/11 / 10/10 / 11/11 |
| `test:components` | 13 s | 23/23 (4 files) |
| `test:secrets` | 13 s | 1 known finding (`9c8caa7`, D-7) |
| `npx playwright test` | 142 s | **14/14**: journeys (a)(b)(c), cards not for sale, account data, mobile ×2, accessibility ×5, performance ×2; 0 CSP violations |
| `npm audit --audit-level=high` | 9 s | pass (1 low, esbuild) |

## 5. Open items

- **P0 (release, human actions):**
  - B-1, rotate the credentials (D-1 waiver ends at go-live);
  - B-2, apply 020–026 to production after the DEC-2026-018 review;
  - B-3, live payments (G-PAY).
- **P1:**
  - **V6-095**, the storage policies are only on live: run the read-only queries in PRODUCTION.md §7;
  - **B-4**, there is no GitHub repository, so CI has never run remotely and the Node 22 check has never run;
  - **V6-014 / D-7**, the history secret-scan gate.
- **P2:**
  - privacy: V6-096 (`avatar_url` to any host), D-11 (pre-filled login email), V6-093 / O-17 (re-claimable Tap addresses), V6-074 (privacy documents);
  - admin: V6-078 / O-15, V6-088 / O-16, V6-042 / D-8;
  - other: V6-076 / D-9, V6-033 (Tap link previews), V6-038 (email), V6-036 (Auth project settings), V6-041 (Node 22 locally), V6-043 (one deploy target), the error-tracking provider.
- **P3:** V6-044, V6-054, V6-094, V6-098, V6-053, V6-055.

## 6. Decisions needed from the owner

1. **The production gate** (`docs/release/DEPLOYMENT.md` §1, G-1 to G-8). The first steps are B-1 rotation and the DEC-2026-018 review of 020–026.
2. **V6-095:** run the two storage queries on live, or authorize someone to.
3. **D-7:** fingerprint `9c8caa7` under DEC-2026-020 (recommended), or keep the gate red.
4. **B-4:** create the GitHub repository so CI runs on Node 22.
5. **V6-098:** keep or delete the unrouted company homepage (`Home.tsx`, `ProjectConsultation.tsx`). Decide it with the parked website work.
6. **Still open from earlier stages:**
   - D-12 (account deletion);
   - D-11, V6-096, V6-093;
   - D-3, D-8, D-9;
   - O-15, O-16;
   - the V6-089 copy review;
   - the `source-map-js` confirmation;
   - V6-053 (the stale V5 reports);
   - the error-tracking provider.
