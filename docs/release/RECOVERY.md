# Recovery procedure (SHYGON V6 release candidate)

What to do when something goes wrong in production. First find out what happened: `docs/v6/observability.md` says where every event is recorded and how to follow one order or one request through the logs.

## 1. A payment was taken but nothing was granted

1. Find the order by its number (`ST-…`) in the function logs. `fulfilment.retryable` or `webhook.release-failed` means fulfilment stopped part-way and the order is `retry`.
2. Razorpay redelivers the webhook while it gets an error, and the redelivery completes the order (fulfilment is idempotent; `npm run test:payment-chain` proves it). Check the Razorpay dashboard's webhook log; resend the event if needed.
3. `payment.amount-mismatch` or `webhook.amount-mismatch` is a deliberate hold: compare the amount in Razorpay with the order, then refund (admin app) or fulfil by hand.

## 2. Payments failing for everyone

- `GET /api/health?deep=1`: `degraded` with `config: missing` means a setting is missing after a deploy (the log names it, `health.config-missing`); `database: unreachable` means Supabase is down.
- `razorpay.auth-failed` means wrong or rotated Razorpay keys: set the right pair on the host, server and browser key id together.
- `webhook.rejected` with `bad-signature` on every event means `RAZORPAY_WEBHOOK_SECRET` differs from the dashboard: set the same value in both.

## 3. A public Tap is missing or wrong

- "Tap not found" for a real Tap: check its `status` (draft, archived) and any administrator suspension (`admin_audit_log`, `tap.suspended`). Restore from the admin app.
- Wrong content after an edit: Taps have no version history. The owner edits it back.

## 4. Credential exposure

Follow `docs/runbooks/RUNBOOK-secrets.md`: stop, redact, report the location, do not commit, rotate. Rotating the Supabase keys signs everyone out.

## 5. Data loss or corruption

1. Stop writes if needed: pause the host deploy, or set the site to maintenance.
2. Use Supabase point-in-time recovery to a time before the damage. It is **irreversible** for later writes, so it is the owner's decision. Record the chosen point.
3. Reconcile payments taken after that point from Razorpay's dashboard (orders, payments) and re-fulfil them. The webhook ledger (`webhook_events`) shows which events were already handled.

## 6. A customer asks for their account to be deleted

Follow `docs/runbooks/RUNBOOK-account-deletion.md`. Never use "Delete user" on an account with orders on a database without migration 026.

## 7. A bad release

Roll back the application first (`ROLLBACK.md` §1). Roll back a migration only if it is the cause (`ROLLBACK.md` §2).
