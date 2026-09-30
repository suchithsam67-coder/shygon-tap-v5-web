# 05 — API Architecture

*Conceptual resources and contracts only — no implementation code.*

## 1. Approach decisions

| Question | Decision | Why |
|---|---|---|
| REST vs GraphQL vs RPC | **Three surfaces, each in its natural idiom.** (a) Signed-in customer/org UI keeps **Supabase PostgREST + RPC** behind RLS (existing pattern, no server hop). (b) Public, anonymous and third-party surfaces are **REST/JSON over HTTPS**, versioned, served by edge/Netlify functions. (c) Admin remains **definer RPCs** + Edge Functions. | Reuse; no GraphQL layer to secure. Public/3rd-party need stable contracts independent of table shape. |
| Edge functions | Yes for: resolver, public actions, notifications worker, webhooks. Not for CRUD. | Rate limits, secrets, trust computation must not run in the browser. |
| Webhooks | **In:** Razorpay (existing), later SMS delivery receipts, email provider events. **Out:** org webhooks (Phase 5) signed HMAC-SHA256 with timestamp, retries with backoff, per-endpoint secret, delivery log. | |
| Versioning | URL major version `/api/v1/…`; **additive-only within a version**; deprecation ≥ 6 months with `Sunset` header. Existing `/api/create-order` etc. stay as-is (aliased under `/api/v1/commerce/*` later). RPC functions: never change a function signature used by a shipped client; add `_v2`. | Physical cards are forever, apps are not. |
| Idempotency | All POSTs that create money/consent/messages accept `Idempotency-Key` (24 h dedupe table). Razorpay path already idempotent by event id + atomic claim. | |
| Rate limiting | Layered: CDN/WAF (per IP) → function-level token bucket keyed by `(route, ip_hash | user | device | org | api key)` in Postgres/Upstash-style store → business limits in DB (e.g., rescue msgs per item/day). Responses `429` + `Retry-After`. | Rate limits are a security control, so they're specified per route below. |
| Errors | RFC 9457 problem+json: `type, title, status, detail, code, request_id`. Never leak SQL/stack. Public routes return **uniform** responses for "not found / suspended / not yours" (anti-enumeration). | |
| AuthN on APIs | Public: none + bot check where noted. Authenticated: `Authorization: Bearer <Supabase JWT>`. Org API: `Authorization: Bearer shy_live_…` (hashed at rest). Admin: JWT + `admin_has`. | |
| Tracing | `X-Request-Id` accepted/generated at edge, propagated to RPC via `set_config('app.request_id')`, stored on audit rows. | |

## 2. PUBLIC APIs (anonymous; hardest surface)

| Method & path | Purpose | Notes / limits |
|---|---|---|
| `GET /d/{code}` and `GET /t/{slug}` (HTML) | Resolver entry from NFC/QR. `/t/{slug}` legacy persona vanity. | 60 req/min/ip; 600/min/code; cached ≤ 30 s (T0). Uniform 404-like page for unknown/suspended. |
| `GET /api/v1/public/resolve/{code}` | JSON payload for renderer: `{kind, trust, payload}` where `kind ∈ persona|rescue|location|event|unavailable`. | Same limits. Response contains **only** whitelisted public fields. |
| `POST /api/v1/public/taps/{code}/event` | Record `view|link_click` (replaces open `record_tap_event`). | Server-validated against a fresh resolve token (short-lived, HMAC) to stop forged counts; 30/min/ip. |
| `POST /api/v1/public/connect/{persona}/requests` | Visitor asks to connect / leaves contact **with explicit consent checkbox text stored**. | Bot check (Turnstile), 5/hour/ip, 3/day/persona/ip-hash, body ≤ 2 KB, no links by default. |
| `POST /api/v1/public/rescue/{code}/threads` | Finder starts a rescue thread. Returns opaque `finder_token`. | Bot check, 3/hour/ip, 5/day/item, message ≤ 500 chars; identical responses whether item is `protected` or `lost` (no state leak). |
| `POST /api/v1/public/rescue/threads/{token}/messages` | Finder follow-up. | 10/hour/thread; token expires 14 d after last activity. |
| `GET /api/v1/public/rescue/threads/{token}` | Finder polls owner replies. | 60/hour. |
| `GET /v/{code}` + `GET /api/v1/public/credentials/{verify_code}` | Public credential verification page (issuer, provenance badge, status, revoked/expired). Shows *no* subject PII beyond what issuer opted in. | 60/min/ip. |
| `POST /api/v1/public/emergency/{code}/release` | Emergency channel (Phase 3+, opt-in only). | Requires purpose + confirm; 3/day/device; notifies owner instantly; audited. |
| `GET /api/v1/public/config` | Non-secret client config (turnstile key, supported locales). | Cache. |

## 3. AUTHENTICATED APIs (customer) — Supabase RLS/RPC unless noted

Resource groups (all scoped by `auth.uid()`; CRUD via PostgREST unless "RPC"):

| Resource | Operations |
|---|---|
| `me` | get/update profile; `RPC request_phone_change` → `RPC verify_phone` (A3); `RPC request_account_deletion`, `RPC export_my_data` |
| `personas` (tap_profiles) | list/create (plan-gated)/update (edit-rules trigger)/publish/pause; `RPC set_field_visibility`; `RPC set_default_persona` |
| `devices` (cards) | list; `RPC claim_device(code, activation_secret)`; `RPC assign_device_to_persona`; `RPC set_device_state(suspend/resume/lost)` (**A3**); `RPC begin_transfer` / `RPC accept_transfer`; `RPC request_replacement` |
| `routes` | list/update (own devices) |
| `connections` | list; `RPC respond_to_request`; `RPC remove/block`; `RPC follow_up` |
| `consents` | list; `RPC revoke_consent` |
| `credentials` | CRUD self-asserted; `RPC request_verification(org)`; list attested |
| `rescue_items` | CRUD; `RPC mark_lost / mark_found`; `threads` list; `RPC reply`, `RPC close`, `RPC block_finder` |
| `orders`, `subscriptions`, `entitlements` | read; **purchase only via** `/api/v1/commerce/*` (existing create-order/verify); `RPC cancel_subscription` |
| `notifications`, `notification_preferences` | list/mark read; preferences upsert (security categories locked on) |
| `analytics` | `RPC get_tap_analytics` (existing), `RPC get_persona_funnel` |
| `support` | tickets/messages (existing) |
| `otp` (Netlify) | `POST /api/v1/otp/request`, `/verify` for `purpose ∈ {phone_verify, device_action, deletion, export}` — generalization of existing `card-otp` |

## 4. ORGANIZATION APIs (JWT + `has_org_permission`; later API keys)

Path prefix `/api/v1/orgs/{org}/…` (for API keys) — the UI uses RPC/RLS equivalents.

| Resource | Notes |
|---|---|
| `members` | list, invite (email/phone), bulk invite CSV (async job), suspend, end; **no PII beyond org-held attributes and consented fields** |
| `devices` | bulk import batches (`batch_id`), assign to member, revoke, replace; export status |
| `personas` (org-issued templates) | create template persona; issue to members (member accepts) |
| `credentials` | templates; `issue`, `revoke`, `bulk_issue`; verification stats |
| `events`, `participations` | manage events, register attendees, badges, event mode windows |
| `locations`, `location_content` | CRUD, versions, publish, locale variants, audio/simplified variants |
| `analytics` | aggregate-only endpoints with **k ≥ 5** suppression; no per-person rows |
| `billing` | plans, invoices (GST), seats |
| `audit` | org-scoped audit read |
| `api_keys`, `webhooks` | manage (`org_owner`/`org_admin` + MFA) |

Async endpoints (`bulk_*`) return `202 + job_id`; jobs are rows in `jobs` (status, progress, error report) processed by a worker; **partial-failure reports downloadable**.

## 5. ADMIN APIs (existing pattern, extended)

Definer RPCs `admin_*` (≈45 exist). New groups: `admin_orgs_*` (review, verify, suspend), `admin_devices_*` (issue batch, retire, reassign with reason), `admin_rescue_*` (queue, remove message, block device abusers), `admin_verify_*` (credential review), `admin_consent_audit`, `admin_security_events`, `admin_config_*` (feature flags, rate-limit tunables). Refunds remain `admin-refund` Edge Function. **Each admin RPC: `require_admin(perm)` first, `admin_audit()` last, reason string required for destructive actions.**

## 6. INTERNAL SERVICES (not externally reachable)

| Service | Trigger | Responsibility |
|---|---|---|
| Notifications worker | schedule (1 min) + on outbox insert (pg_net/Edge) | drain `domain_events`/`notifications` → deliveries, retries, backoff, dedupe |
| Expiry sweeper | cron (5 min) | expire consents, temp permissions, invitations, rescue tokens, activations (per OQ-1) |
| Retention job | daily | purge raw events/messages; roll up stats |
| Fulfilment retry | existing state machine | re-run `fulfilOrder` for `retry` |
| SDM verifier (optional) | called by resolver | CMAC verify with KMS-derived key; counter check |
| Webhook dispatcher (Phase 5) | outbox | signed org webhooks |
| Anomaly detector (Phase 3+) | stream of audit/events | rules first (velocity, geo-impossible, enumeration), ML later (doc 09) |

## 7. Conceptual response shapes (contracts to freeze early)

* **Resolve payload envelope:** `{ v:1, kind, trust:"T0|T1", locale, cache:{ttl}, payload:{…kind-specific…}, actions:[{type:"connect|rescue|verify|contact", …}] }`. `payload` for `persona` = today's `get_public_profile` JSON (byte-compatible) so the existing renderer works unmodified.
* **Problem+JSON:** `{type, title, status, code, detail?, request_id}`; codes are stable strings (`rate_limited`, `step_up_required`, `consent_required`, `not_available`).
* **Pagination:** cursor-based `?limit=&cursor=`; max 100.
* **Times:** ISO-8601 UTC; org-local rendering in UI.
* **IDs:** UUID internal; public codes opaque; never sequential.

## 8. Contract-test requirements
Each public route has: schema test, rate-limit test, uniform-response (no enumeration) test, oversized-body test, malformed-input fuzz set, and a "no private field leaks" snapshot test against a seeded persona with every field populated.
