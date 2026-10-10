# Rollback procedure (SHYGON V6 release candidate)

Roll back the smallest thing that fixes the problem: the application first (seconds, no data risk), a migration only when the migration is the cause.

## 1. Application (no data changes)

1. In the host (Netlify: Deploys; Vercel: Deployments), **promote the previous deployment**. It takes effect at once.
2. Check `GET /api/health?deep=1` and the smoke test of `DEPLOYMENT.md` §5.
3. The database stays as it is. Each of 020–026 was written so the V5 screens keep working (see each header), but an application rollback to V5 is not tested end to end: run the smoke test after it.

## 2. Database migrations (020–026)

Each migration's header carries a `ROLLBACK (begin) … ROLLBACK (end)` block. Every one has been **exercised on a local copy of the live schema**: `npm run test:rollbacks` applies 020…k, runs k's rollback and compares the schema with 020…k-1 (functions, policies, grants, relations, triggers and constraints). It also rolls the whole chain back to the live baseline and re-applies it identically.

Roll back **in reverse order**, newest first, only as far as needed:

| Migration | Rollback restores | Data notes |
|---|---|---|
| 026 orders outlive account deletion | `orders_user_id_fkey … ON DELETE CASCADE` | none. **After rolling back, "Delete user" destroys order records again**: do not delete users |
| 025 public Tap privacy and analytics | the previous `record_tap_event` and `enforce_tap_edit_rules`; re-grants the legacy `get_public_tap`; drops `tap_visitor_salts` and its index | **re-opens O-2** (the legacy function shows a hidden address to anyone); daily salts are discarded (visitor hashes restart) |
| 024 policies to authenticated | the previous policy targets and grants | none |
| 023 Taps only after payment | the `tap_profiles_insert_own` policy | none (re-opens O-14) |
| 022 admin notes off customer rows | the previous admin functions; notes copied back onto orders | proven by `npm run test:admin-notes` |
| 021 resolve customer id | the previous `provision_tap_on_payment`; drops `resolve_customer_id`, `customer_id_for` and the customer-id trigger | proven by `npm run test:identity` |
| 020 guard suspension columns | drops the guard function and its two triggers | none (a customer could again change suspension columns, F1) |

Procedure:
1. Copy the migration's rollback block, remove the leading `-- `, and run it in the SQL editor in one session.
2. Run that migration's VERIFY ON LIVE queries: they must show the previous state.
3. Note it in the deployment record, and keep the application on a version that does not need the rolled-back object.

## 3. When a rollback is not enough: restore

If data was damaged (not only schema), use point-in-time recovery to a time before the release (`RECOVERY.md` §5). It is irreversible for everything written after that point, so it is the owner's decision.

## 4. Feature switches (no deploy of code)

| Switch | Effect |
|---|---|
| `CARD_SALES_ENABLED` / `VITE_CARD_SALES_ENABLED` unset | Card checkout refused; the site describes the digital Tap (D-10) |
| Razorpay keys back to test mode | No live money can move (B-3) |
