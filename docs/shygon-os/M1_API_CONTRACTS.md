# SHYGON OS — M1 API Contracts

> Planning document (M1.0). **Nothing here is implemented.**
> - **Frozen contracts:** OBSERVED from the live baseline and the repository; they may not change.
> - **Proposed contracts:** PROPOSAL; each is gated by the DEC noted.
> - Style follows doc 05: three surfaces, problem+json, additive-only versioning.

## 1. Conventions (all new contracts)

| Topic | Rule |
|---|---|
| Versioning | HTTP: `/api/v1/…`, additive-only within a version, `Sunset` header ≥ 6 months. RPC: **never change a shipped signature**; add `_v2`. |
| Errors | RFC 9457 problem+json `{type, title, status, code, detail?, request_id}`. Stable codes include `rate_limited`, `step_up_required`, `entitlement_required`, `not_available`, `invalid_state_transition`, `consent_required`. Never leak SQL or stacks. |
| Anti-enumeration | Public negatives (unknown / suspended / not yours) return an **identical** body and status, and similar timing. |
| Auth | Public: none (+ bot check where noted). Customer: `Authorization: Bearer <Supabase JWT>`. Admin: JWT + `admin_has(perm)` inside definer RPCs. |
| Idempotency | Every POST that creates money, consent, messages or state accepts `Idempotency-Key` (24 h dedupe). |
| Tracing | `X-Request-Id` accepted or generated at the edge → `set_config('app.request_id', …)` → audit rows. |
| Identity | Contracts take **resource ids**. `customer_id` (C) is **never** a client-supplied parameter (DEC-2026-029 B2). |
| Assurance | High-risk actions declare `required_assurance` (A3 = session + step-up ≤ 10 min). |
| Payments | No contract may accept an amount, price or "paid" flag from a client. Test mode only (plan §18). |

## 2. Frozen contracts (OBSERVED; may not change)

### 2.1 HTTP (Netlify + Vercel mirrors)
`POST /api/create-order` · `POST /api/verify-payment` · `POST /api/razorpay-webhook` · `POST /api/check-delivery` · `POST /api/card-otp` · `GET /api/payment-mode`

### 2.2 Anon-callable RPCs (live grants)

| Function | Notes |
|---|---|
| `get_public_profile(p_slug text) → jsonb` | **The public Tap payload: byte-compatible forever.** |
| `get_public_tap_state(p_slug text) → text` | — |
| `record_tap_event(p_slug text, p_event text, p_link_key text) → void` | Body may gain dedupe and limits only (doc 12 M1.6). |
| `canonical_experience`, `card_design_of`, `theme_options`, `tier_rank`, `tap_edit_interval_days` | pure helpers |
| `get_public_tap(p_slug text) → TABLE(…)` | Legacy. **It errors on live** ("slug is ambiguous", F14) and returns contact columns. See M1_SECURITY_MODEL §5 O-2. |
| `require_admin(p_permission text) → uuid` | Anon-callable on live. See M1_SECURITY_MODEL §5 O-1. |

### 2.3 Authenticated RPCs (live grants)
- `claim_tap_slug`, `tap_edit_state`, `my_theme_options`, `my_event_theme`;
- `get_tap_analytics(p_days)`, `get_tap_link_clicks(p_days)`;
- `customer_activate_card(p_card_id, p_activation_code)`, `customer_deactivate_card(…)`;
- `request_card_replacement(p_card_id, p_reason)`, `set_card_nickname(p_card_id, p_nickname)`;
- `get_card_tap_history(p_card_id, p_limit)`;
- `is_admin()`.

### 2.4 Service-only RPCs
- `card_apply_verified_action(p_user_id, p_card_id, p_action)` (card-OTP path);
- `fulfil_card_stock`, `decrement_product_stock`;
- `generate_tap_slug`;
- `fulfil_order` (live-only, unused by the code);
- `expire_tap_cards`;
- `log_account_event`;
- `user_has_pass`, `user_has_lifetime`, `user_max_ui_tier`, `tap_can_edit`, `tap_event_theme_for`.

### 2.5 Admin RPCs
41 callable `admin_*` functions (Admin APK contract). Signatures and return shapes are frozen and covered by a contract snapshot test (M1_TEST_STRATEGY §4).

## 3. Proposed public contracts

### 3.1 Resolver (M1.5; DEC-2026-028, DEC-2026-022 for F3 scope)
`GET /d/{code}` (HTML shell) and `GET /api/v1/public/resolve/{code}`

```json
{ "v": 1, "kind": "persona | activate | unavailable", "trust": "T0",
  "cache": { "ttl": 30 },
  "payload": { "...": "for kind=persona: exactly get_public_profile() output" },
  "event_token": "<short-lived HMAC, for /taps/{code}/event>" }
```

- **State → kind:**

  | Device state | `kind` |
  |---|---|
  | `active`, `transfer_pending` | `persona` |
  | `unassigned`, `pending`, `shipped` | `activate` |
  | everything else (incl. unknown code) | `unavailable`, an identical body |

- **Limits:** 60/min per IP, 600/min per code. 429 with `Retry-After`.
- **Cache:** `public, s-maxage=30, stale-while-revalidate=60`, purge tag on state or persona change.
- **Kill switch:** K1 `resolver_mode=maintenance` (works with the database unreachable).
- **`/t/{slug}` is unchanged.** It is not routed through the resolver unless a later flag (`VITE_USE_RESOLVER`) is approved.

### 3.2 Event capture (M1.7; F5)
`POST /api/v1/public/taps/{code}/event` `{event: "view|link_click|contact_action|share", link_key?, event_token}`. The `event_token` must be valid, fresh and match the code. 30/min per IP. Returns 204 for both success and rejection (no oracle).

## 4. Proposed customer contracts (RPC under RLS)

| Contract | Purpose | Assurance | Milestone / gate |
|---|---|---|---|
| `POST /api/v1/otp/request` `{purpose: phone_verify\|device_action\|account_deletion\|data_export}` | Generalized OTP (wraps the `card-otp` primitives; `card-otp` stays) | A2 | M1.2 / DEC-2026-022 (F4), L3 |
| `POST /api/v1/otp/verify` `{challenge_id, code}` → `{step_up_token, expires_at}` | step-up | A2 → A3 | M1.2 |
| `rpc request_phone_change(new_phone)` / `rpc verify_phone(challenge_id, code)` | verified contacts; 72 h cool-down; notify the old contact | A3 | M1.2 |
| `rpc claim_device(code, activation_secret)` | bind an issued device to the caller | A2 | M1.3 / DEC-2026-028 |
| `rpc set_device_state(device_id, to_state ∈ suspended\|active\|lost, step_up_token)` | owner lifecycle via `device_transition()` | **A3** | M1.3 |
| `rpc begin_transfer(device_id, step_up_token)` → token; `rpc accept_transfer(token, step_up_token)` | transfer | A3 | M1.3 (optional) |
| `rpc set_field_visibility(field, visibility)` | privacy v1 (public/private) | A2 | M1.4 |
| `rpc restore_persona_version(version_id)` | restore | A2 | M1.4 |
| `rpc list_my_devices()` | devices with state, nickname, edition | A2 | M1.3 |
| `rpc set_notification_preference(category, channel, enabled)` | security categories locked on | A2 | M1.6 |
| `rpc open_ticket(subject, category, body, order_id?)`, `rpc add_ticket_message(ticket_id, body)` | support (customer-visible only) | A2 | M1.8 |

**Contract rule:** existing card RPCs (`customer_activate_card`, …) keep their signatures. Their bodies are re-pointed to `device_transition()` only after DEC-2026-028 is approved and contract tests exist.

## 5. Proposed admin contracts (definer RPCs)

The shape is always `require_admin(perm)` first, `admin_audit(…)` last, and a reason string for destructive actions.

| RPC | Permission (new namespace) | Milestone |
|---|---|---|
| `admin_list_devices(filter)`, `admin_get_device(id)` | `devices.read` | M1.3 |
| `admin_device_transition(id, to_state, reason)` | `devices.manage` | M1.3 |
| `admin_issue_batch(sku, qty, kind, auth_mode)` → manifest ref | `devices.issue` | later (hardware) |
| `admin_security_events(filter)` | `security.read` | M1.1/M1.2 |
| `admin_set_flag(key, stage, …, reason)` | `config.manage` + A3 / AAL2 | M1.1 |
| `admin_assign_ticket(id, admin_id)`, `admin_add_internal_note(ticket_id, body)`, `admin_set_ticket_priority(id, p)` | `support.respond` | M1.8 |
| `admin_list_internal_notes(ticket_id)` | `support.read` | M1.8 |

Organisation contracts (`/api/v1/orgs/{org}/…`, `has_org_permission`) are **not** in M1 (DEC-2026-025).

## 6. Internal interfaces (provider-independent; code-level contracts)

### 6.1 `PaymentProvider` (documents the existing `netlify/lib/razorpay.mjs`; no behaviour change)
```ts
interface PaymentProvider {
  mode(): 'test' | 'live' | 'unconfigured';             // GET /api/payment-mode semantics
  createOrder(i: { amountInPaise: number; receipt: string; notes?: object }): Promise<{ providerOrderId: string }>;
  verifyCheckoutSignature(i: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean; // timing-safe
  confirmPayment(i: { providerPaymentId: string; providerOrderId: string; amountInPaise: number }): Promise<'captured'>; // re-check + capture
  verifyWebhook(rawBody: string, signature: string): boolean;
  refund(i: { providerPaymentId: string; amountInPaise?: number; reason: string }): Promise<{ refundId: string }>; // admin-refund only
}
```
**Invariant:** `mode()` must return `test` in every environment until G-PAY. A CI test fails on any `rzp_live_` outside fixtures (PROPOSAL).

### 6.2 `FulfilmentStep` (documents the existing `fulfilOrder`; fix is gated by DEC-2026-024)
`claim → grantEntitlements → issueDevices → decrementStock → provisionPersona → notify → complete`.
- Each step is idempotent.
- On failure, the order is marked `retry`. Only after a successful claim: claim failures happen *before* the retry marker today (DEC-2026-024 I-1).
- Steps write `domain_events` (`fulfilment.step_failed`) once M1.1 exists.

### 6.3 `NotificationProvider`
```ts
interface NotificationProvider {
  channel: 'email' | 'sms' | 'whatsapp' | 'push';
  send(m: { to: string; templateId: string; locale: string; vars: Record<string, string>; dedupeKey: string }):
    Promise<{ providerMessageId: string } | { error: { retryable: boolean; code: string } }>;
}
```
- Existing SMS (`netlify/lib/sms.mjs`: MSG91 / Twilio) becomes the first adapter.
- Email waits for OQ-8; WhatsApp for DEC-2026-031.
- **Bodies carry no private data** (doc 06 B4).

### 6.4 `AuditWriter` / `EventPublisher` (DB functions, M1.1)
- `audit_event(actor_kind, actor_id, action, entity_type, entity_id, org_id, outcome, meta)`. A definer function. `admin_audit()` keeps its signature and delegates.
- `publish_domain_event(type, aggregate, aggregate_id, payload)`. Same transaction as the state change; payload holds ids only.

### 6.5 AI access (future; doc 09, doc 14 §3.9)
- Read-only definer views over **aggregates or redacted** data, per feature scope.
- Outputs are written to a suggestions store, never to canonical tables.
- Per-feature kill switch K18.
- No contract in M1.

## 7. Contract tests (required for every new contract)
For every new public route:
- a schema test;
- a rate-limit test;
- a uniform-negative test;
- an oversized-body test;
- a fuzz set;
- a leak snapshot (a canary persona with every field populated).

For every RPC:
- a role matrix (anon / customer / other-customer / admin roles);
- assurance enforcement;
- an audit row written.

See `M1_TEST_STRATEGY.md`.
