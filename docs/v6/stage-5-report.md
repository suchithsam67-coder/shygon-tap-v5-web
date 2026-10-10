# SHYGON V6 Stage 5 report: security verification and end-to-end journeys

| | |
|---|---|
| Branch | `v6/stage-5-security-e2e` (from Stage 4 `a6d533f`) |
| Date | 2026-10-10 |
| Authorization | Owner, 2026-10-06: "complete software"; Stages 3–6 back-to-back (DEC-2026-035 A-1). Stage 5 rule: fix real defects, add no features; a failing test means fix the cause |
| Not done | Nothing applied to any real database. No production contact, deployment, push, credential rotation or live payment |
| **Open P0** | **No new P0.** The release P0s are unchanged: B-1 rotation, B-2 production apply of 020–026, B-3 live payments. **V6-095 (storage isolation) cannot be verified locally and must be checked on live before go-live.** |

## 1. What each Stage 5 requirement was checked with

| Requirement | Evidence (this branch, 2026-10-10) | Result |
|---|---|---|
| Full RLS adversarial run | `rls-adversarial` 64; RLS matrix 946 (32 tables × 7 callers: anon, two customers, three admin roles, service; plus every callable admin RPC); identity contract 69; admin notes 12 | PASS |
| Authentication | `test:security` (new). For each of `create-order`, `verify-payment` and `card-otp`, 7 hostile tokens are refused 401: garbage, the customer's claims signed with another secret, correctly signed but expired, `alg: none`, a forged service-role token, the public anon key, the signature cut off. The customer's real token is accepted (the control). A token for a deleted account is refused | PASS |
| Authorization and admin | `test:admin-edge` 11 (the edge role map equals the database's for 7 roles; refused: forged tokens, a customer, `role=admin` in their own metadata, self-insert into `admin_users`, an inactive admin; viewer cannot refund); admin contract 15; RLS matrix (customers refused by every admin RPC); E2E journey (c) | PASS |
| Payment security | `payment-chain` 30 (server-side pricing, forged / short / foreign payments, webhook signatures, replay and duplicate delivery, idempotent fulfilment, add-ons and the Pass); `test:payments` 15; `functions-security` 13 (+1 BLOCKED: needs Node 22, unchanged); security events logged (`test:observability` 10) | PASS |
| Tenant isolation | RLS matrix (customer A → B on every table); `public-tap` 25; `account-deletion` ("no other account is touched"). **Storage (profile photos) is outside the public schema and only on live:** VERIFY ON LIVE queries in PRODUCTION.md §7 (V6-095) | PASS locally; storage **unverified** |
| Privacy of the public Tap | `public-tap` 25 (six states, field visibility, salted analytics); golden 9; component tests (14 Tap states); E2E on a phone (a hidden contact is absent). Open: D-11 (pre-filled login email), V6-096 (`avatar_url` to any host) | PASS, 2 open decisions |
| E2E (a) sign-up → profile → Tap → public Tap; (b) checkout → payment → verification → fulfilment → entitlement; (c) admin suspend → unavailable → restore → available | `npx playwright test`: **7/7**, now run **under the production CSP** with zero violations allowed on any page (new; the watcher proven by a probe that must see a violation) | PASS |
| Dependency audit | `npm audit`: 0 critical, 0 high, 0 moderate. 1 low: esbuild (build tool, its own dev server, not used; V6-054) | PASS |
| Secrets scan: no keys in repo or bundle | gitleaks 8.30.1 on history: 1 finding, `9c8caa7` (the Web3Forms key, public by design; V6-014 / D-7, unchanged). Uncommitted files and `dist/`: none. **`test:bundle-secrets` (new)** on `dist/` and the E2E build: no JWT but the anon key, no server-only setting name, no private key, no live Razorpay key, no source map. Mutation check: a planted service-role token and source map fail it | PASS (D-7 open) |
| Security headers | `test:security`: CSP (no inline or eval script, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri` / `form-action 'self'`, only Supabase and Razorpay connections), HSTS 1 year, `nosniff`, `DENY`, strict referrer, camera / microphone / location off; Netlify equals Vercel; served on the landing page, a public Tap, the store and the 404 page | PASS |
| CORS | `test:security`: a cross-origin preflight to every Netlify function, and a cross-origin request, get no `Access-Control-Allow-Origin`. Edge functions' `*` reviewed (V6-044: bearer tokens, no cookies) | PASS |

## 2. Defects found and fixed

- **V6-097, local stack (test infrastructure).** The app host parsed `netlify.toml` wrongly (`[headers.values]` is indented under `[[headers]]`) and served **no security headers**. So since Stage 3 the E2E journeys never ran under the CSP. Production was not affected: Netlify and Vercel serve the headers themselves.
  - Fixed: the headers are now on every response (files, redirects, 404), and the host refuses to start if the block has no values.
  - Every journey now records CSP violations and fails on any: 7/7 with none.
- No product defect was found in Stage 5. Stage 4's V6-090 (account delete cascading into orders) and V6-091 (metadata race) were already fixed.

## 3. What changed

- `netlify/tests/security.mjs` (new, 11): tokens, headers, CORS.
- `scripts/ci/check-bundle-secrets.mjs` (new): the bundle gate.
- `supabase/local/app-host.mjs`: header parsing; headers on every response.
- `e2e/stack.ts`: `stayLocal` records CSP violations, plus `cspViolations()`. `e2e/{journeys,account-data,public-tap-mobile}.spec.ts` fail on any violation.
- `package.json`: `test:security` and `test:bundle-secrets`, both in `ci`. `.github/workflows/ci.yml` has a step for each.
- `PRODUCTION.md` §7: the storage VERIFY ON LIVE check.
- `docs/v6/backlog.md`: V6-044 reviewed; V6-095 to V6-098.

## 4. Commands run and real results (2026-10-10, Node 20.18.0)

| Command | Result |
|---|---|
| `npx eslint .` / `npx tsc -b` | exit 0 / exit 0 |
| `npx vite build`, `npm run test:bundle` | built; public Tap entry JS 88,895 B of 90,000, PASS |
| `npm run test:bundle-secrets` | PASS, 207 files (also on `.e2e/dist`: 2 anon key references, public by design) |
| `npm run test:db` | verify 21; rls-adversarial 64; RLS matrix 946 (32 × 7); identity 69; admin-notes 12; golden 9; admin-contract 15; rollbacks 8; account-deletion 9; bundle check PASS; history 2 |
| `npm run test:push-guard` | 18/18 |
| `npm run test:payments:ci` | 15/15; 13/13 + 1 BLOCKED (Node 22) |
| `npm run test:payment-chain` | 30/30 |
| `npm run test:public-tap` | 25/25 |
| `npm run test:admin-edge` | 11/11 |
| `npm run test:observability` | 10/10 |
| `npm run test:security` | 11/11 |
| `npx vitest run` | 23/23 |
| `npx playwright test` | 7/7 under the production CSP, 0 violations |
| `npm run test:secrets` (gitleaks 8.30.1) | 1 finding in history: `9c8caa7` (known, D-7) |
| `npm audit --audit-level=high` | pass (1 low, esbuild) |

## 5. Open items

- **P0 (release, unchanged):** B-1, B-2, B-3.
- **P1:**
  - **V6-095**, verify the storage policies on live, before go-live (queries in PRODUCTION.md §7);
  - B-4, the GitHub repository (CI has never run remotely);
  - V6-014 / D-7, the history secret-scan gate.
- **P2:**
  - V6-096 (`avatar_url` to any host);
  - D-11 (pre-filled login email);
  - V6-093 / O-17 (re-claimable Tap addresses);
  - O-15, O-16;
  - the error-tracking provider.
- **P3:**
  - V6-044 (edge CORS `*`, reviewed);
  - V6-054 (esbuild, low);
  - V6-094 (edge function logs);
  - V6-052 and V6-098, dead code and assets (Stage 6 cleanup).

## 6. Decisions needed from the owner

1. **V6-095:** run the two read-only storage queries on live (or authorize someone to) and report the result. A mismatch becomes a storage-policy change for your approval.
2. **V6-096:** should the profile photo be restricted to photos uploaded to SHYGON? Recommended: yes.
3. **Still open:**
   - D-12 (account deletion);
   - D-11;
   - D-7;
   - D-3, D-8, D-9;
   - O-15, O-16;
   - the V6-089 copy review;
   - the `source-map-js` confirmation;
   - the DEC-2026-018 cool-off for 020–026;
   - B-1 to B-4.
