# 06 — Payment & Entitlement · Notification · Analytics Architecture

*Covers requested docs 10, 11, 12 (Payment & Entitlement, Notification, Analytics).*

---
# Part A — Payment & Entitlement Architecture

## A1. Principle: extend the V5 pipeline; add nothing parallel

The V5 chain is kept exactly:

```
client intent (never a price)
  → create-order: prices from `products`/`plans`, writes order+items, creates Razorpay order
  → Razorpay Checkout
  → verify-payment (HMAC + gateway re-check) ┐ both call
  → razorpay-webhook (signature, ledger, amount check) ┘ fulfilOrder()
  → fulfilOrder(): claim pending→paid; grant entitlements; issue cards/devices; stock; provision
```

What changes is **what fulfilment can grant** (a plan-driven grant list instead of a hard-coded one) and **who the subject is** (user or org).

## A2. Commercial layers → data

| Commercial layer | Product type (`products.product_type`) | Billing shape | Grants |
|---|---|---|---|
| Physical card purchase | `card` (existing) | one-time | `cards` row(s) (device), stock decrement, provisions default persona (existing) |
| Digital experience (Business/Premium/GOAT) | `digital_plan` (existing) | one-time (perpetual today) | `entitlements(digital_plan, key)` — unchanged |
| Customization Pass ₹999 | `lifetime_plan` (existing) | one-time | `entitlements(lifetime, …)` — unchanged |
| Student plan | `plan` (new) | annual or per-school seat | persona(student) + limits |
| Professional plan | `plan` | annual | extra personas, analytics retention |
| Business plan | `plan` | annual | business persona features, enquiries/booking |
| Organization subscription | `plan` (kind=organization) | annual prepaid (recommended) → subscription | seats, devices quota, console modules |
| Event package | `package` | one-time per event | temporary org entitlements bound to event window |
| Premium customization / advanced analytics | `addon` | one-time or included in plan | entitlements |
| Enterprise / API | `plan` | contract (manual invoice) | API access, SLA flags |

## A3. Plans, entitlements, subscription state

* `plans.features` declares *grants* and *limits* (e.g. `{"personas":3,"analytics_retention_days":365,"seats":50,"devices":500,"modules":["events","locations"]}`).
* **Effective entitlements = union of** (a) explicit `entitlements` rows (perpetual purchases — grandfathered V5 stays exactly as-is), (b) active subscription plan features, (c) admin grants (with reason & expiry), (d) plan defaults (Essential). Computed by `effective_entitlements(subject)`; **all feature gates call this one function** (in triggers/RPCs/edge), never re-implement.
* Subscription state machine: `active → past_due (grace 7 d) → expired` ; `active → cancel_at_period_end → canceled`; upgrades prorated (see A5). **Entitlements from a subscription carry `expires_at = period_end + grace` and are extended on renewal;** losing them degrades gracefully (read-only, never data deletion within 90 days).
* Payment state (existing) stays independent: `payment_status` on orders; subscription status is derived from paid invoices/orders, not from the browser.

## A4. Recurring billing — decision (needs owner input, OQ-7)

| Option | Pros | Cons | Recommendation |
|---|---|---|---|
| **Annual prepaid orders** via the existing order flow (renewal = a new order created by a "renew" action or reminder) | Zero new payment code; GST invoices already order-shaped; India UPI-autopay friction avoided; works for B2B PO/bank transfer | Manual renewal; churn risk | **Phase 4 default** for orgs and annual individual plans |
| **Razorpay Subscriptions** (autopay via e-mandate/UPI AutoPay) | True recurring | New webhook events, mandate failures, RBI e-mandate rules, more states | Add only when monthly plans are required |
| Manual invoice/bank transfer | Enterprise-friendly | Reconciliation work | Phase 5 for enterprise (admin marks paid via audited RPC) |

## A5. Webhooks, refunds, cancel, up/downgrade

* **Webhooks:** keep `webhook_events` ledger, signature check, event-id claim, amount+currency match. Add handlers: `subscription.activated/charged/halted/cancelled` (only if A4 option 2 used), `refund.processed`. Unknown events acknowledged, never 5xx'd. Add alert when `fulfillment_status='retry'` older than 15 min, and reconciliation job comparing Razorpay payments (daily) vs `payments`.
* **Refunds:** unchanged `admin-refund` Edge Function (service role, audited). Extension: refund of a plan order revokes its subscription entitlements (`revoke_entitlements` flag already exists) and, for devices already shipped, requires an explicit admin choice (retire vs keep). Partial refund → entitlement proration policy documented per product.
* **Cancellation:** user/org cancels → `cancel_at_period_end`; access continues to `period_end`; no clawback of one-time purchases.
* **Upgrade/downgrade:** immediate upgrade with prorated charge as a *new order for the difference* (computed server-side from plan prices and remaining days); downgrade takes effect at period end; downgrade that would violate limits (e.g. personas > new limit) is blocked with a list of what to archive first.
* **Feature gating rules:** (1) enforce in DB/edge, UI is advisory; (2) a gate failure returns `entitlement_required` with the missing key so UI can show the right upsell; (3) never delete customer content when a plan lapses.
* **Tax/invoicing:** GST-compliant invoice per order (GSTIN capture for orgs, HSN/SAC, place-of-supply) — **verify with an accountant before Phase 4** (OQ-9). Existing `EBill` component is the base.

## A6. Security requirements (all inherited, plus)
Server-only price source; no client-supplied amounts; live keys refused on localhost; secrets never in `VITE_*`; rotate the Razorpay key secret (prior plaintext exposure noted in V5 docs); org billing changes need `billing.manage` + MFA; `admin_grant` entitlements require a reason and appear in audit.

---
# Part B — Notification Architecture

## B1. Design: transactional outbox → worker → channels

```
state change (in same DB transaction)
   └─▶ INSERT domain_events(type, aggregate, payload)   ← the ONLY way to trigger a notification
            │  (Edge worker every ~1 min + on-insert nudge; SELECT … FOR UPDATE SKIP LOCKED)
            ▼
   Notification rules: event → recipients → category → template → channels (per preferences)
            ▼
   notifications row (in-app, realtime — existing)  +  notification_deliveries per channel
            ▼           ▼            ▼            ▼
         in_app       email         sms          push (later)
```

Why outbox: existing triggers (`notify_order_change`) already write notifications synchronously; keep them for in-app but route *external* channels through the outbox so a provider outage never blocks or rolls back a business transaction, and delivery is retryable/idempotent (`dedupe_key`).

## B2. Channels & providers

| Channel | Provider (existing/proposed) | Use | Rules |
|---|---|---|---|
| In-app | Supabase Realtime on `notifications` (exists) | everything | Default on |
| Email | **New:** one transactional provider (Amazon SES ap-south-1 or Resend — OQ-8); domain auth SPF/DKIM/DMARC on `shygontech.com` | rescue message, connection request, receipts, security events, verification results | Templated, i18n-ready, plain-text alt, unsubscribe for non-security categories |
| SMS | MSG91 (DLT templates)/Twilio (exists) | OTP, order confirmation, **critical** rescue alerts, security | DLT template registered per message type; cost-controlled: SMS only for OTP/security/critical unless user opts in |
| Push | Expo push (admin tokens exist) → FCM/APNs for the future customer app | opt-in engagement | Phase 5+ |

## B3. Event catalogue (initial)

| Event | Recipients | Default channels | Category (lockable?) |
|---|---|---|---|
| `tap.viewed` (aggregated digest only) | owner | in-app digest | activity (off by default) |
| `connection.requested / accepted` | target / requester | in-app, email | social |
| `rescue.thread_opened / message` | owner | in-app + email (+SMS if `lost` and opted-in) | **rescue (critical)** |
| `credential.issued / verified / revoked` | subject | in-app, email | verification |
| `org.membership_invited / ended` | user | in-app, email | org |
| `payment.captured / failed / refunded` | customer | in-app, email, SMS (existing confirm) | commerce |
| `subscription.renewal_due / past_due / canceled` | subject | email, in-app | commerce |
| `device.activated / suspended / lost / transfer_*` | owner (+ old contact on phone change) | in-app, email, SMS | **security (locked on)** |
| `security.new_login / phone_changed / password_reset / consent_granted` | user | email (+SMS for phone change) | **security (locked on)** |
| `org.api_key_created`, `admin.*` | org owners / admins | in-app, email | **security (locked on)** |
| `moderation.item_flagged` | admin queue | admin_notifications + push | ops |

## B4. Reliability, privacy & abuse rules
* Delivery states: `queued → sending → sent → delivered|failed|bounced`; retries with exponential backoff (max 6), then dead-letter + admin alert; idempotent by `dedupe_key`.
* **Notification bodies never contain more than necessary:** rescue emails carry "You have a new message about *<item label>*" + deep link; the message text is shown only after sign-in. No private contact data in email/SMS.
* **Rate limits & digests:** per user per category (e.g. max 1 rescue email per 10 min per item; rest batch into digest) — this is also an anti-harassment control.
* Preferences: per category × channel, quiet hours (except lockable categories), language.
* Quotas & cost telemetry per channel; SMS budget circuit-breaker.
* Templates versioned in repo (`/notifications/templates/{locale}/…`), tested by snapshot.

---
# Part C — Analytics Architecture (privacy-conscious)

## C1. Principles
1. **Aggregate by default; individual-level tracking of visitors is out of scope.** Owners see counts, not who.
2. **Collect only what a decision needs.** No IP, no raw UA, no precise location, no cross-site identifiers, no third-party analytics scripts on the public Tap (also keeps the bundle tiny and the CSP strict).
3. **Coarse only:** country (from edge geo header), device class, referrer host, source (`nfc|qr|link`).
4. **Visitor uniqueness** = HMAC(server secret_v, IP‖UA‖UTC-day); secret rotated monthly; never stored raw; cannot be joined across days.
5. **Org analytics are k-anonymous:** any cell with < 5 distinct visitors is suppressed/merged.
6. **Consent:** Tap analytics rely on legitimate-interest aggregate counting with a disclosed notice (existing privacy notice); anything beyond (e.g., marketing attribution) requires opt-in — counsel to confirm (OQ-9).

## C2. Event taxonomy

| Event | Emitted by | Fields (besides `ts`, `subject`, `device_id?`, `trust_level`, `source`, `country`, `device_class`) |
|---|---|---|
| `tap.resolved` | resolver | route_kind, outcome (`ok|unavailable`) |
| `persona.viewed` | renderer via signed token | experience, event_theme? |
| `persona.link_clicked` | renderer | link_key |
| `persona.contact_action` | renderer | action (`call|whatsapp|email|save_vcard`) |
| `connect.requested / accepted` | API | source, event_id? |
| `rescue.thread_opened / owner_replied / closed` | API | latency bucket |
| `verify.page_viewed` | verify page | credential type |
| `location.viewed`, `event.checkin` | resolver | locale, accessibility_mode used |
| `commerce.checkout_started/completed` | functions | plan/sku (no PII) |
| `device.lifecycle` | DB triggers | from→to state |

Each event has a JSON-schema in `/analytics/schemas` and a **PII lint** in CI (fails if a schema adds a free-text/identifier field).

## C3. Aggregations & metrics

| Metric (master doc §23) | Source |
|---|---|
| Tap-to-page success rate | `tap.resolved` outcome ok ÷ edge hits; synthetic probe |
| Median time Tap→useful action | client timing bucket in `persona.*` events (bucketed) |
| Profile activation rate | personas published ÷ devices activated |
| Weekly/monthly active Tap users | distinct owner users with ≥ 1 tap (owner-side) |
| Repeat Tap usage | uniques vs views |
| Connection exchange / profile→contact conversion | `connect.*`, `contact_action` ÷ views |
| Rescue response/return rate | thread lifecycle |
| Card replacement/deactivation rate | `device.lifecycle` |
| Subscription conversion/retention | commerce tables |
| Support & security incidents | tickets/audit |

Rollups: `tap_daily_stats` (per persona/device/org/day) and `platform_daily_stats`. Retention: raw events 90 days, daily rollups 25 months, platform aggregates indefinitely.

## C4. Views
* **Customer analytics:** own personas/devices only (existing `get_tap_analytics` + funnel).
* **Org analytics:** aggregate roster engagement, credential verification counts, event check-ins — with k ≥ 5.
* **Admin analytics:** platform health, funnel, abuse, revenue; never per-person browsing.
* **Anti-fraud:** events from the same `visitor_hash` > N/min are counted once and flagged; forged-event protection via signed resolve token (F5).
