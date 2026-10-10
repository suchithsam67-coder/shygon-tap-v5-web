# Observability and audit trail (SHYGON V6: V6-018, V6-075)

How to find out what happened, from a customer's "it failed" to the exact log lines and database rows. Written for Stage 4 (2026-10-10). Everything here is in the code or the schema; nothing is assumed about a provider not chosen yet.

## Where each kind of event is recorded

| Question | Where | Written by | Notes |
|---|---|---|---|
| Which administrator did what, and when? | `admin_audit_log` (`admin_id`, `action`, `entity_type`, `entity_id`, `metadata`) | `public.admin_audit()`, called by the admin RPCs. Also the `admin-refund` edge function (`_shared/admin.ts`). | Actions: `tap.suspended` / `tap.restored`, `customer.suspended` / `customer.reactivated`, `order.status_changed`, `order.cancelled`, `order.refunded`, `entitlement.granted` / `entitlement.revoked`, `card.updated`, `product.updated`, `inventory.adjusted`, `support.replied`, `support.status_changed`, `admin.created` / `admin.role_changed` / `admin.activated` / `admin.deactivated`, `admin_domain.added` / `admin_domain.removed`. An administrator with audit rows cannot be deleted (`admin_audit_log_admin_id_fkey` is `RESTRICT`). |
| What happened to an order? | `orders` (`payment_status`, `fulfillment_status`, `fulfilled_at`, `confirmation_sms_status`), `order_status_history` (each status change), `payments` (each payment, with Razorpay ids and payload), `order_items` (what was charged for) | The payment functions; the fulfilment code; triggers | Kept for up to 8 years (Privacy Policy; migration 026 stops an account delete from removing them) |
| Did Razorpay's webhook arrive, and was it handled once? | `webhook_events` (`event_id`, `event_type`, `received_at`) | `razorpay-webhook` (the dedupe ledger) | One row per Razorpay event id; a redelivery is recognised and logged as `webhook.duplicate` |
| What happened to an account? | `account_events` | Triggers on orders, entitlements and Taps | The customer can read their own (`account_events_select_own`) and it is part of their data export |
| What did the admin team get alerted about? | `admin_notifications` | Triggers: new support ticket, card activation and deactivation | Pushed to the admin app by `admin-push` |
| Sign-ins, password changes, token refreshes | The Supabase Auth audit log (dashboard → Authentication → Logs) | Supabase Auth | Not in the public schema |
| What did a server function do? | The host's function logs (Netlify → Functions → logs; Vercel → Logs) | `netlify/lib/log.mjs`, one JSON line per event | See below. Retention is the hosting plan's. Check it before launch, and add a log drain if it is shorter than you need (owner decision). |
| What broke in a visitor's browser? | The browser console, plus a `shygon:error` event on `window` | `src/lib/reportError.ts` (render errors via `ErrorBoundary`, uncaught exceptions, unhandled rejections) | **No error-tracking provider is wired in.** Choosing one sends data to a third party, so it is an owner decision. When chosen, it subscribes to `shygon:error` and nothing else changes. |
| Is the service up? | `GET /api/health` (settings present) and `GET /api/health?deep=1` (the database answers too) | `netlify/functions/health.mjs`, `api/health.mjs` | `200 {"status":"ok"}` or `503 {"status":"degraded","checks":{…}}`. A missing setting is named only in the log (`health.config-missing`), never in the response. |

## Server function logs

Every line is one JSON object:

```json
{"ts":"2026-10-10T08:07:30.257Z","level":"info","fn":"verify-payment","requestId":"3771d276-…","event":"payment.verified","orderId":"ST-MV242XJW-4213","razorpayOrderId":"order_…","razorpayPaymentId":"pay_…","newlyFulfilled":true}
```

- **`requestId`:** the caller's `x-request-id` when it is well-formed (8–128 of `A-Z a-z 0-9 . _ : -`), else the id Netlify (`x-nf-request-id`) or Vercel (`x-vercel-id`) stamped on the request, else a new UUID. Every response carries it back as `x-request-id`, so a failed request in the browser's network panel leads straight to its log lines.
- **`orderId`** is always the order number the customer and support see (`ST-…`), in every event of every function, so one search finds the whole story of an order.
- **Never logged:** request bodies, signatures, tokens, keys, passwords, cookies, email addresses, phone numbers, addresses or PIN codes. Values under such keys become `[redacted]` at any depth; long strings are cut at 300 characters; errors keep only their name and message. Log the ids you need to find a record, never its contents.
- **Proven by:** `npm run test:observability`, which runs a whole purchase, a tampered payment, a forged webhook and a forged signature, and checks that every line written is structured JSON with the right ids and nothing redacted leaks.

### Event catalogue

| Area | Events |
|---|---|
| Orders (`create-order`) | `order.created`, `order.refused`, `order.insert-failed`, `order.items-insert-failed`, `order.error`, `product.lookup-failed`, `product.unpriced` |
| Razorpay calls | `razorpay.auth-failed`, `razorpay.order-failed`, `razorpay.unreachable`, `razorpay.payment-lookup-failed`, `razorpay.capture-failed` |
| Payment verification (`verify-payment`) | `payment.verified`, `payment.not-confirmed`, `payment.unknown-order`, `payment.verify-error`, `order.lookup-failed` |
| Webhook (`razorpay-webhook`) | `webhook.processed`, `webhook.duplicate`, `webhook.capture`, `webhook.payment-failed`, `webhook.ignored`, `webhook.unknown-order`, `webhook.ledger-failed`, `webhook.release-failed`, `webhook.error` |
| Fulfilment | `order.fulfilled`, `fulfilment.tap-provisioned`, `fulfilment.retryable`, `fulfilment.release-failed`, `fulfilment.card-issue-failed`, `fulfilment.edit-window-failed`, `fulfilment.slug-failed`, `fulfilment.slug-assignment-failed`, `fulfilment.tap-provisioning-failed`, `fulfilment.unknown-product-type` |
| Order texts | `order-sms.not-sent`, `order-sms.unavailable`, `order-sms.error` |
| **Security events** | `auth.refused` (no valid session), `payment.signature-invalid`, `payment.customer-mismatch` (another customer's payment), `payment.order-mismatch`, `payment.amount-mismatch`, `webhook.rejected` (`unsigned` / `bad-signature`), `webhook.amount-mismatch` (held for review), `config.missing`, `health.config-missing` |

## Tracing a failure

1. **Start from what the customer has:** the order number (`ST-…`, on their Orders page, and in the order text once SMS is configured), or the time and their account email (look the account id up in the admin app).
2. **Search the function logs** for the order number. Each line's `requestId` then gives every line of that request, across `verify-payment` and the fulfilment it triggered.
3. **Read the database** for the same order: `orders` (states), `payments`, `webhook_events` (did the webhook arrive), `order_status_history`, and `admin_audit_log` if an administrator touched it.
4. **"Paid but nothing happened":** look for `fulfilment.retryable` or `webhook.release-failed`. The order is left `retry`, and the webhook answered with an error, so Razorpay redelivers it. The redelivery completes the order, and fulfilment is idempotent (proven by `npm run test:payment-chain`). `payment.amount-mismatch` and `webhook.amount-mismatch` are deliberate holds: refund or fulfil by hand after checking Razorpay.
5. **A visitor's page broke:** ask for the time and page. Until an error-tracking provider is chosen, only their browser console has the `[shygon] client error` line.

## Known gaps (open)

- **Error tracking:** no provider (above). Owner decision.
- **Log retention and alerting:** whatever the hosting plan keeps; no alert rules yet. The security events above are the ones to alert on first (`webhook.rejected`, `payment.signature-invalid`, `payment.customer-mismatch`, `*.amount-mismatch`, `config.missing`, a degraded `/api/health`).
- **The admin edge functions** (`supabase/functions/admin-refund`, `admin-push`) still log plain text to the Supabase function logs, and do not log a refused caller as a security event. The refusals themselves are proven by `npm run test:admin-edge`. Converting their logs is a follow-up; they are part of the admin app's contract.
