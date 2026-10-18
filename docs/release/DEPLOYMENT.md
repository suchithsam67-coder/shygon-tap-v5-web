# Deployment procedure (SHYGON V6 release candidate)

> **Production deployment is NOT AUTHORIZED.** This procedure is prepared for the owner. Every step that touches production is a human action, taken only after the owner's explicit go-ahead for that step. No tooling targets production (`npm run db:push` refuses every project not on the non-production list, which is empty).

## 1. Before anything touches production (gates)

| # | Gate | Evidence / owner |
|---|---|---|
| G-1 | Owner authorization of this release, in writing, naming the commit | Owner |
| G-2 | **Credentials rotated** (B-1, DEC-2026-001; D-1 waiver ends here) | `docs/runbooks/RUNBOOK-secrets.md` |
| G-3 | Migrations **020–026 and 028** reviewed under DEC-2026-018 (24-hour cool-off, checklist) | Data Owner + Security Owner |
| G-4 | The VERIFY ON LIVE queries of each migration run read-only, results recorded | Each migration header |
| G-5 | Storage policies verified (V6-095) | `PRODUCTION.md` §7 |
| G-6 | A fresh backup, or the point-in-time recovery window, confirmed | Supabase dashboard |
| G-7 | CI green on the release commit (needs the GitHub repository, B-4) or the local `npm run ci` on a clean install | `docs/v6/stage-6-report.md` |
| G-8 | Live payments stay OFF (B-3 is a separate, later decision) | `/api/payment-mode` = `test` |

## 2. Configuration

Set or confirm every variable in `docs/release/PRODUCTION-CONFIG.md` §2 on the host, after rotation (G-2). Do not set any "local only" variable.

## 3. Database

> **Blocked as of 2026-10-18.** Production has changed since the 2026-10-02 baseline (backlog V6-106), and 025's VERIFY ON LIVE fails (A19: `enforce_tap_edit_rules` differs). Do not apply the bundle until the baseline is re-captured and the migrations it affects are re-based. Only the early fix in §3a may go ahead first, under its own conditions.

1. Run each migration's **VERIFY ON LIVE** queries (read-only) and record the results.
2. Apply `supabase/APPLY_ALL.sql` (020–026 and 028 only; 027, the AAROH catalogue, is held aside and is not in it; idempotent, tested twice on the live baseline by `npm run db:bundle:check`) in the Supabase SQL editor, in one session. **Never apply 001–019** (history).
3. Run the post-apply checks: the verification queries in each header now show the new state, and `PRODUCTION.md` §7 (schema, the Pass boundary, palette gating).
4. If anything differs, stop and roll back that migration (`ROLLBACK.md` §2).

## 3a. Early security fix: 020 and 028 only (DEC-2026-003, approved 2026-10-18, conditional)

The owner approved applying 020 and 028 ahead of the full bundle, **only when every condition in DEC-2026-003 §3.1 holds**:
1. the live packs reviewed;
2. an independent review;
3. rotation complete (G-2);
4. these checks;
5. the operator's window and recovery plan, with G-6 confirmed.

This section is the procedure. It is not an authorization to run it. Both migrations are additive and independent of 021–026. On production as captured on 2026-10-18 they touch only objects that match the baseline.

1. **Before:** run the VERIFY ON LIVE queries in the headers of 020 and 028, read-only. Expected:
   - no `*_guard_suspension*` trigger yet;
   - the triggers on `profiles` and `tap_profiles` are exactly the "before" chains of query A below;
   - both admin suspension RPCs are SECURITY DEFINER, owned by a non-client role;
   - `anon` and `authenticated` are members of nothing;
   - `authenticator` is a member of `anon`, `authenticated` and `service_role` only.

   If anything differs, stop.
2. **Apply** in the SQL editor, one file per run, in this order:
   - `supabase/migrations/020_guard_suspension_columns.sql`;
   - `supabase/migrations/028_guard_suspension_on_insert.sql`.

   Do not paste `APPLY_ALL.sql`: its 025 no longer matches production (A19).
3. **After:** run these two read-only queries, one at a time.
   - Query A (trigger order):
     ```sql
     SET TRANSACTION READ ONLY;
     SELECT c.relname AS table_name,
            string_agg(t.tgname, ' > ' ORDER BY t.tgname COLLATE "C") FILTER (WHERE (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16) AS before_update,
            string_agg(t.tgname, ' > ' ORDER BY t.tgname COLLATE "C") FILTER (WHERE (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4) AS before_insert,
            bool_and(t.tgenabled = 'O') AS all_enabled
     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname IN ('profiles', 'tap_profiles') AND NOT t.tgisinternal
     GROUP BY c.relname ORDER BY 1;
     ```
     Expected after the apply. The guard must be the last trigger in each chain:

     | Table | Before UPDATE | Before INSERT |
     |---|---|---|
     | `profiles` | `trg_profiles_updated_at > trg_profiles_zz_guard_suspension` | `trg_profiles_zz_guard_suspension_insert` |
     | `tap_profiles` | `trg_tap_profiles_00_status > trg_tap_profiles_edit_rules > trg_tap_profiles_zz_guard_suspension` | `trg_tap_profiles_00_status > trg_tap_profiles_zz_guard_suspension_insert` |

     `all_enabled` must be true for both.

     Before the apply, production shows:
     - `profiles`: `trg_profiles_updated_at` on UPDATE, nothing on INSERT;
     - `tap_profiles`: `trg_tap_profiles_00_status > trg_tap_profiles_edit_rules` on UPDATE, `trg_tap_profiles_00_status` on INSERT.
   - Query B (the guard functions):
     ```sql
     SET TRANSACTION READ ONLY;
     SELECT p.proname, p.prosecdef, array_to_string(p.proconfig, ',') AS config,
            has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec
     FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('guard_suspension_columns', 'guard_suspension_columns_on_insert') ORDER BY 1;
     ```
     Expected: two rows. Each has `prosecdef` false, config `search_path=pg_catalog, pg_temp`, and `anon_exec` and `authenticated_exec` both false.
4. **Smoke test.** Use a dedicated test account only, never a real customer's.
   - The account-level checks need no new data.
   - Production had no Tap on 2026-10-18, so the Tap-level check needs a test Tap. Creating one is a production data change the owner must approve first.

   | Check | Expected |
   |---|---|
   | Admin app: suspend the test account, with a reason | `admin_audit_log` gains `customer.suspended` |
   | Signed in as the test account, send `PATCH /rest/v1/profiles?id=eq.<its id>` with `{"suspended_at": null}` | `403`, code `42501`; the suspension stays |
   | The same account saves Settings (name, phone) | Saved |
   | Admin app: reactivate the test account | `customer.reactivated` is audited |
   | With a test Tap: suspend it, send `PATCH /rest/v1/tap_profiles?user_id=eq.<its id>` with `{"suspended_at": null}`, then restore it | The PATCH gets `403` / `42501`. The public page is unavailable while suspended and available again after the restore. The owner is notified both times |
5. **If anything is wrong**, roll back in reverse order:
   1. run 028's `ROLLBACK (begin) … ROLLBACK (end)` block;
   2. run 020's `ROLLBACK` lines;
   3. run query A again. It must show the "before" chains.

   This round trip is tested by `npm run test:rollbacks` on the live baseline.

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
| While it is suspended, the test Tap's own test account sends `PATCH /rest/v1/tap_profiles?user_id=eq.<its id>` with `{"suspended_at": null}` (never a real customer's account) | `403`, code `42501`; the public page stays unavailable (020, 028) |
| Response headers on `/shygontap` | CSP, HSTS, `nosniff`, `DENY` present |

## 6. After release

- Watch the function logs for the security events in `docs/v6/observability.md` (`webhook.rejected`, `payment.*-mismatch`, `config.missing`) for the first day.
- Record the deployment (commit, time, who, the backup point) in the tracker.
