# Deployment procedure (SHYGON V6 release candidate)

> **Production deployment is NOT AUTHORIZED.** This procedure is prepared for the owner. Every step that touches production is a human action, taken only after the owner's explicit go-ahead for that step. No tooling targets production (`npm run db:push` refuses every project not on the non-production list, which is empty).

## 1. Before anything touches production (gates)

| # | Gate | Evidence / owner |
|---|---|---|
| G-1 | Owner authorization of this release, in writing, naming the commit | Owner |
| G-2 | **Credentials rotated** (B-1, DEC-2026-001; D-1 waiver ends here) | `docs/runbooks/RUNBOOK-secrets.md` |
| G-3 | Migrations **020–026** reviewed under DEC-2026-018 (24-hour cool-off, checklist) | Data Owner + Security Owner |
| G-4 | The VERIFY ON LIVE queries of each migration run read-only, results recorded | Each migration header |
| G-5 | Storage policies verified (V6-095) | `PRODUCTION.md` §7 |
| G-6 | A fresh backup, or the point-in-time recovery window, confirmed | Supabase dashboard |
| G-7 | CI green on the release commit (needs the GitHub repository, B-4) or the local `npm run ci` on a clean install | `docs/v6/stage-6-report.md` |
| G-8 | Live payments stay OFF (B-3 is a separate, later decision) | `/api/payment-mode` = `test` |

## 2. Configuration

Set or confirm every variable in `docs/release/PRODUCTION-CONFIG.md` §2 on the host, after rotation (G-2). Do not set any "local only" variable.

## 3. Database

1. Run each migration's **VERIFY ON LIVE** queries (read-only) and record the results.
2. Apply `supabase/APPLY_ALL.sql` (020–026 only, idempotent, tested twice on the live baseline by `npm run db:bundle:check`) in the Supabase SQL editor, in one session. **Never apply 001–019** (history).
3. Run the post-apply checks: the verification queries in each header now show the new state, and `PRODUCTION.md` §7 (schema, the Pass boundary, palette gating).
4. If anything differs, stop and roll back that migration (`ROLLBACK.md` §2).

## 4. Application

1. Deploy the release commit to the host: build `npm run build`, publish `dist`.
2. Keep the previous deployment available for instant rollback (both hosts keep deploy history).

## 5. Smoke test (production, test mode)

| Check | Expected |
|---|---|
| `GET /api/health?deep=1` | `200 {"status":"ok"}` |
| `GET /api/payment-mode` | `test` |
| `/shygontap` | The landing page. Cards say "coming soon". No console CSP errors |
| A published Tap `/t/<slug>` | Renders; a paused Tap reads "Temporarily unavailable"; unknown reads "Tap not found" |
| Sign up → choose Business → Razorpay **test** payment | Order paid and fulfilled once; draft Tap created; entitlement granted |
| Razorpay dashboard: resend the webhook | `webhook.duplicate` or `webhook.processed` with `newlyFulfilled: false`; nothing granted twice |
| Admin app: suspend then restore a test Tap | Public page unavailable, then available; `admin_audit_log` has both actions |
| Response headers on `/shygontap` | CSP, HSTS, `nosniff`, `DENY` present |

## 6. After release

- Watch the function logs for the security events in `docs/v6/observability.md` (`webhook.rejected`, `payment.*-mismatch`, `config.missing`) for the first day.
- Record the deployment (commit, time, who, the backup point) in the tracker.
