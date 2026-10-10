# SHYGON V6 PRODUCTION READINESS REPORT

This is the template from `shygon-v6-tracker.md`, filled at Stage 6. The tracker carries the same report. The evidence is the clean install of `docs/v6/stage-6-report.md` §4: a fresh clone of the release candidate code, every suite run, 2026-10-10 18:05–18:14 IST.

VERSION: V6 release candidate (`APP_VERSION` 1.0.1, unchanged)  COMMIT: **`287268f`** (code; the commit adding this report changes documents only)  BRANCH: `v6/stage-6-rc`  DATE: 2026-10-10

| Area | PASS / FAIL | Evidence |
|---|---|---|
| Functional | PASS | E2E 14/14 under the production CSP, 0 violations. (a) Sign up → buy → publish → a visitor sees the Tap. (b) Checkout → payment verified → fulfilled once → entitlement; a failure or a cancel grants nothing. (c) Suspend → the public page goes dark → restore. Also: cards not for sale, account data, phone layout ×2. Components 23/23 |
| Authentication | PASS | `test:security` 11. For `create-order`, `verify-payment` and `card-otp`, 7 hostile tokens are refused 401: garbage, a foreign secret, expired, `alg: none`, a forged service role, the anon key, a cut signature. A deleted account's token is refused. The Supabase Auth project settings (password policy, email confirmation) are set on the project at deployment (V6-036, P2) |
| Authorization | PASS | `test:admin-edge` 11: the edge role map equals the database's for 7 roles, and a customer cannot become an administrator by token or by editing their own metadata. Admin contract 15. RLS matrix: every admin RPC refuses customers. E2E (c). Open P2: O-15 (V6-078), O-16 (V6-088) |
| Database | PASS (local) | The live baseline plus 020–026, applied twice (idempotent). verify 21; identity 69; admin notes 12; golden 9; account deletion 9; history 2. **Not applied to production** (B-2) |
| RLS | **FAIL** (incomplete) | Public schema PASS: adversarial 64; matrix 946 (32 tables × 7 callers, no unexpected access). **The storage policies (`profile-images`) cannot be verified locally**: V6-095 (P1), with the VERIFY ON LIVE queries in PRODUCTION.md §7 |
| Payments | PASS (test mode) | `payment-chain` 30: server-side price; forged, short and foreign payments; signatures, replay, duplicates and concurrency; add-ons and the Customization Pass. Payments 15; functions-security 13 + 1 BLOCKED (needs Node 22; the same refusal is proven by `test:security`). **Live payments OFF** (B-3) |
| Fulfilment | PASS | `payment-chain`: idempotent whether the browser or the webhook confirms first, or both at once; failure then retry; a fault then redelivery; the safety net. Card fulfilment is deferred to the card release (V6-003); no cards are sold (D-10) |
| Tap | PASS | `public-tap` 25: lifecycle, the six states, 9 hostile addresses, the field allowlist, phone and email visibility. Golden 9; component states; E2E on a phone (a hidden contact is absent). Open P2: D-11, V6-096, V6-093 |
| Customer SaaS | PASS | E2E (a), (b) and account data. Accessibility checked on 12 signed-in pages. Settings → Your data: export, and a deletion request. Deletion itself is a manual, tested runbook (D-12 open) |
| Admin | PASS (database and edge layer) | `test:admin-edge` 11, admin contract 15, admin notes 12, E2E (c); every suspension and restore is in `admin_audit_log`. No admin UI in this repository (D-8 open) |
| Notifications | PASS (in-app) | `public-tap`: the owner is notified of a suspension, with the reason, and of a restore. Order messages are recorded: without an SMS provider they are marked `not_configured`. No email channel (V6-038, P2) |
| Analytics | PASS | `public-tap` §D, 7 checks: a 64-hex hash salted daily (salts deleted after two days and closed to every API role), a 10-second dedupe, 60 events per visitor per Tap per hour, nothing recorded for a hidden Tap |
| SEO | PASS | `test:seo`, 17 pages: unique titles, descriptions, self canonicals, Open Graph and Twitter tags with real images, JSON-LD that parses and offers no card. robots.txt and the sitemap agree; 404 is `noindex`; `llms.txt` links only to built pages |
| Accessibility | PASS | 5/5. axe WCAG 2.2 AA on 20 pages: **0 violations of any impact**. Keyboard order with a visible focus ring; reduced motion; one `main` and an `h1` on each page checked |
| Performance | PASS | Slow 4G + 4× CPU: **public Tap LCP 1,288 ms, CLS 0** (limits 2,500 ms and 0.1); landing page 2,020 ms, CLS 0.001 (limits 4,000 ms and 0.25). First-render JS 88,906 B gzip of 90,000 |
| Security | **FAIL** | **Open:** credentials not rotated (B-1, P0); the history secret-scan gate red on `9c8caa7`, the Web3Forms key, public by design (V6-014 / D-7, P1). **Passing:** `test:security` 11 (tokens; CSP, HSTS, `nosniff`, `DENY` on every page; no CORS for foreign origins); bundle secrets, 207 files clean; `npm audit` 0 high or moderate (1 low, esbuild dev server, not used); E2E with 0 CSP violations |
| Tests | PASS | Clean install: every suite green (counts in the Stage 6 report §4). 1 check BLOCKED (Node 22), its behaviour covered elsewhere |
| Build | PASS (Node 20.18) | lint, `tsc -b`, `vite build`, the bundle budget. The Node 22 build has never run, and CI has never run remotely (B-4) |
| Migrations | PASS (local) | 020–026: idempotent re-apply, APPLY_ALL.sql current (020 onward only), line endings pinned (V6-099). **Not applied to production**: B-2, after the DEC-2026-018 review and cool-off |
| Observability | PASS | `test:observability` 10: redaction at any depth, request ids, security events, a forged webhook logged without its signature. Also `/api/health`, the error boundary and `docs/v6/observability.md`. No error-tracking provider or alerting yet (owner decision) |
| Rollback | PASS (local) | `test:rollbacks` 8: every 020–026 rollback exercised on a local copy of the live schema, and the whole chain rolled back to the baseline and re-applied identically. Application rollback means promoting the previous deployment (`docs/release/ROLLBACK.md` §1); not exercised, since nothing is deployed |

OPEN P0:
- B-1, rotate the credentials (DEC-2026-001; the D-1 waiver ends at go-live);
- B-2, apply 020–026 to production after the DEC-2026-018 review;
- B-3, live payments (G-PAY, the go-live gate).

OPEN P1:
- V6-095, verify the storage policies on live;
- B-4, create the GitHub repository so CI runs remotely on Node 22;
- V6-014 / D-7, the history secret-scan gate.

OPEN P2:
- privacy: V6-096 (`avatar_url` accepts any host), D-11 (a new Tap pre-fills the login email), V6-093 / O-17 (a deleted Tap's address can be claimed again), V6-074 (privacy documents);
- admin: V6-078 / O-15, V6-088 / O-16, V6-042 / D-8;
- other: V6-076 / D-9, V6-033 (per-Tap link previews), V6-038 (email channel), V6-036 (Auth project settings), V6-041 (Node 22 locally), V6-043 (one deploy target), the error-tracking provider.

KNOWN LIMITATIONS: see `docs/release/KNOWN-LIMITATIONS.md`. In short:
- no physical cards are sold (D-10);
- no email channel;
- account deletion is manual (D-12);
- deleted Tap addresses can be re-claimed;
- production has never run V6;
- no error tracking or alerting;
- the storage policies are verified only on live;
- local runs on Node 20.18 rather than 22, and must not be suspended mid-run.

RECOMMENDED FOLLOW-UP, in order:
1. B-1, rotate the credentials (`docs/runbooks/RUNBOOK-secrets.md`).
2. B-4, create the repository, push, and let CI run on Node 22.
3. D-7, fingerprint `9c8caa7` under DEC-2026-020.
4. V6-095, run the read-only storage queries on live.
5. The DEC-2026-018 review and cool-off for 020–026, then `docs/release/DEPLOYMENT.md`. The smoke test runs in test mode.
6. Decide D-11, V6-096, V6-093 and D-12.
7. B-3 (G-PAY), last and separately.

PRODUCTION DEPLOYMENT: **NOT AUTHORIZED** (human decision only)
FINAL STATUS: **NOT READY**

The rule is READY only with no open P0 or P1, every row PASS with evidence, a passing clean install, and rollback exercised on a local database. The last two hold. Three P0s and three P1s are open, and the RLS and Security rows are FAIL. Every remaining item is a human action or an owner decision. None needs more code in this release candidate.
