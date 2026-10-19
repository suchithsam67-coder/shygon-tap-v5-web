# SHYGON AAROH backend API contract — AAROH-API v0.1

| | |
|---|---|
| Contract version | **AAROH-API v0.1** (2026-10-19). First published version. |
| Owner | Session A (backend). Changes only through a version bump and a CHANGELOG entry (§13), with the frontend impact stated. |
| Branch / base | `v6/aaroh-backend`, from `4d730c4` (V6 RC `6d00f2f` + migration 028). Read this file with `git show v6/aaroh-backend:docs/v6/aaroh/api-contract.md`. |
| Database | live schema baseline (captured 2026-09-30) + migrations 020–026, 028, **029, 030** (both PROPOSED, DEC-2026-038). 027 is held aside (DEC-2026-037). |
| Production | **Nothing in this contract runs on production.** Production is the V5 schema with drift (V6-106). 020–030 are not applied there, and no V6 code is deployed. |

## Status labels (used for every operation)

| Label | Meaning |
|---|---|
| **LIVE-LOCAL** | Implemented, and its security controls and workflow are verified by an automated suite on the local stack (real Postgres schema and RLS, real server functions). **Not on production.** |
| **DEMO** | Deliberately simulated and labelled as such. *(No operation is DEMO in v0.1.)* |
| **BLOCKED** | Implemented or designed, but it cannot work for real until the named approval or external configuration exists. |
| **NOT IMPLEMENTED** | No backend exists. The frontend must not build a working control for it; at most a "not available" state. |

No operation is labelled LIVE: nothing is deployed.

---

## 1. Handoff rules for Session B (frontend)

1. **Only what is in this file exists.** Treat anything else as NOT IMPLEMENTED. Never call a table, RPC or `/api/*` route this file does not list, and never infer one.
2. **Never write** `supabase/**`, `netlify/**`, `api/**`, `supabase/APPLY_ALL.sql` or the `ci` script. In `netlify.toml` and `vercel.json`:
   - **page-routing rewrites for client routes are yours**;
   - the `/api/*` redirect, function settings, security headers and any cron or schedule entries are Session A's.

   If you merge `v6/aaroh-backend`, regenerate `APPLY_ALL.sql` with `npm run db:bundle`; never hand-resolve it.
3. **Emergency UI is honest UI.** Show `status` exactly as returned (§10.4):
   - **`sent`** means "accepted by the SMS provider", never "delivered" or "received";
   - **`delivered`** appears only from a provider receipt;
   - **`not_sent`** means no provider is configured: show "Nothing was sent";
   - **`sending`** with `lastError` means a retry is pending.
   Always show the `safety` line the API returns. Never promise that police, an ambulance or any emergency service is contacted.
4. **Never put contact details in the URL, analytics, logs, `localStorage` or error reports.** The API returns only masked numbers (`+91 ••••• 00001`), and that is all the UI ever has.
5. **Idempotency keys:**
   - generate one `crypto.randomUUID()` per *user intent* (one press of "Alert my contacts", one confirmed visitor alert);
   - reuse it for retries of that same intent: a network retry, a double tap, a reload while the request is pending;
   - never reuse it for a new intent.
6. **Rate-limit responses (429)** carry `error.retryAfter` (seconds) and a `Retry-After` header. Show the wait; do not auto-retry in a loop.
7. **Destructive or safety settings need `acknowledge: true`.** Send it only after the user has seen the consequence copy (§10.2 `settings.set`).
8. **Status values for every feature** in the showroom must come from §12, not from page rendering.
9. **The in-app notification for a visitor alert links to `/shygontap/emergency`.** Build that route, or tell Session A the route you use and it changes in v0.2.
10. **A contract change you need:** message Session A. It ships as v0.2 with a CHANGELOG entry. Do not work around a missing field.

---

## 2. Conventions

**Transports.**
- **(a) Supabase RPC:** `supabase.rpc(name, args)`, PostgREST `POST /rest/v1/rpc/<name>`.
- **(b) PostgREST table access under RLS:** `supabase.from(table)…`.
- **(c) Server functions:** `POST /api/<name>` (Netlify `netlify/functions/<name>.mjs`; Vercel `api/<name>.mjs`; the same handler on both).

**Authentication.** Signed-in operations use the Supabase session: supabase-js sends it automatically, and `/api/*` needs `Authorization: Bearer <access_token>`. The server verifies the token with Supabase Auth on every call. A missing, expired, forged or anon-key token gets 401.

**Error shapes.**
- (a) and (b) return PostgREST errors `{ code, message, details, hint }`. The SQLSTATE is in `code`: `42501` = not allowed, `22023` = invalid value, `23505` = duplicate.
- `/api/card-otp` returns `{ error: "<message>" }` (V5 shape, unchanged).
- **`/api/emergency` returns `{ error: { code, message, retryAfter?, attemptsLeft?, eventId? } }`** with the HTTP status. Show `message`, which is written for customers, and branch on `code`.

**Times** are ISO-8601 UTC strings. **Ids** are UUIDs.

---

## 3. Public Tap resolution (anonymous)

| ID | Operation | Status |
|---|---|---|
| P-1 | `rpc('get_public_profile', { p_slug })` | LIVE-LOCAL |
| P-2 | `rpc('get_public_tap_state', { p_slug })` | LIVE-LOCAL |
| P-3 | `rpc('record_tap_event', { p_slug, p_event, p_link_key })` | LIVE-LOCAL |
| P-4 | `/d/<card_code>` card-code resolution | **BLOCKED** |
| P-5 | `/api/emergency` `public.status`, `public.alert` | §10.3 |

**P-1 `get_public_profile(p_slug text) → jsonb | null`** (anon; SECURITY DEFINER; frozen contract, doc 12 §2)
- URL format today: `/t/<slug>` and `/tap/<slug>`; the slug is 3–40 chars, `[a-z0-9-]`, case-insensitive.
- **Returns** `null` unless the Tap is `status = 'active'` and not suspended. Otherwise it returns:
  `{ slug, experience, displayName, headline, designation, company, bio, avatarUrl, location, phone, whatsapp, email, website, instagram, linkedin, youtube, customLinks, theme{palette,layout,buttons,font,animation}, baseTheme{…}, activeEvent }`.
  A contact field is non-null only if the owner switched it on (`enabled_customizations`) and owns the add-on (phone and email need none). `experience` is clamped to what the owner paid for.
- **Never contains** user id, customer id, card id, order data, account email, emergency data or any S3 data (verified: `test:public-tap` field allowlist; `test:emergency` "no emergency data").
- **Caveat:** production's `get_public_profile` body has drifted (V6-106, F-3), so payload parity with production is not guaranteed.

**P-2 `get_public_tap_state(p_slug) → 'active' | 'paused' | 'unavailable'`**: why a Tap did not resolve. An unknown slug and a suspended Tap both return `unavailable` (no enumeration of moderation state).

**P-3 `record_tap_event(p_slug, p_event in ('view','nfc','qr','link_click'), p_link_key?) → void`**
- Silently ignored for a hidden Tap.
- Salted daily visitor hash, a 10-second dedupe and 60 events per visitor per Tap per hour (025).
- Known limitation: the visitor hash uses the first `X-Forwarded-For` entry, which a client can vary, so analytics counts can be inflated (backlog V6-112). It exposes nothing.

**P-4 `/d/<card_code>`: BLOCKED.** The owner decided on `/d/<code>` with NTAG 424 DNA (2026-10-16). It needs:
- the card registry schema (`card_code`, `serial_number`, `chip_uid`, status; `design-assets/PRINT.md`), which is not designed or approved;
- server-side SUN/CMAC verification with SDM keys held outside the database;
- card sales, deferred by DEC-2026-035.

Reserved shape for v0.x, not implemented: `GET /d/<card_code>` → server resolves → 302 to `/t/<slug>`, or a neutral "card not active" page. A `card_code` alone authorises nothing (no claim, transfer or page change).

---

## 4. Owner account profile (signed in)

| ID | Operation | Rule | Status |
|---|---|---|---|
| O-1 | `from('profiles').select('id, customer_id, email, full_name, phone, bio, website, whatsapp, instagram, linkedin, profile_image_url, location, company, job_title, notify_order_updates, notify_tap_activity, created_at, updated_at').eq('id', uid).maybeSingle()` | RLS: own row only (`id = auth.uid()`); admins with `customers.read` | LIVE-LOCAL (`test:rls-matrix`, `test:identity`) |
| O-2 | `from('profiles').upsert({ id: uid, customer_id: uid, email, full_name, phone, company, job_title }, { onConflict: 'id' })` | Own row only. `customer_id` must be the caller's own: the user id is mapped to `customers.id` by 021; any other value is refused 42501. Suspension columns refused 42501 (020/028) | LIVE-LOCAL |
| O-3 | `from('profiles').update({ notify_order_updates \| notify_tap_activity: boolean }).eq('id', uid)` | Own row only | LIVE-LOCAL |
| O-4 | Data export: client-side JSON of what RLS lets the account read (`src/services/privacy.ts`) | — | LIVE-LOCAL (Stage 4) |
| O-5 | Deletion request: `support_tickets` insert, category `privacy`, subject `Account deletion request` | Own ticket; status must be `open`. Deletion itself is the manual runbook (D-12) | LIVE-LOCAL |

`profiles.phone` is self-entered and **unverified** (DEC-2026-005 / F4). Never present it as verified.

---

## 5. Tap settings (signed in, the Tap owner)

| ID | Operation | Rule | Status |
|---|---|---|---|
| T-1 | `from('tap_profiles').select(<TAP_COLUMNS>).eq('user_id', uid)` | Own row only | LIVE-LOCAL |
| T-2 | `from('tap_profiles').update(TapDraft).eq('user_id', uid)` | See below | LIVE-LOCAL |
| T-3 | `from('tap_profiles').update({ status: 'active' \| 'paused' }).eq('user_id', uid)` | Publishing needs a claimed address (22023). `published` follows `status` | LIVE-LOCAL |
| T-4 | `rpc('claim_tap_slug', { p_slug }) → text` | 3–40 chars `[a-z0-9-]`; reserved words refused (22023); taken → 23505; no Tap → P0002 | LIVE-LOCAL |
| T-5 | `rpc('tap_edit_state')` → `{ last_edit_at, next_edit_at, days_remaining, interval_days, has_pass, can_edit, reason }` | Own | LIVE-LOCAL |
| T-6 | `rpc('my_theme_options')`, `rpc('my_event_theme')` | Own | LIVE-LOCAL |
| T-7 | Avatar upload to storage bucket `profile-images` | **BLOCKED**: the bucket does not exist on production (V6-108); its policies are verifiable only on live (V6-095) | BLOCKED |

**T-2 `TapDraft`** (the only columns a browser may send):
- content: `display_name, headline, designation, company, bio, avatar_url, location, phone, whatsapp, email, website, instagram, linkedin, youtube, custom_links`;
- visibility: `enabled_customizations`;
- experience and theme: `selected_ui_tier, theme_palette, theme_layout, theme_buttons, theme_font, theme_animation`.

T-2 rules, enforced server-side:
- **Owner only.** Another customer's update affects 0 rows.
- **Paid features.** An experience the owner has not bought → 42501; a palette, layout, button style, font or animation above it → 42501; an add-on in `enabled_customizations` they do not own → 42501.
- **Edit window.** Content edits are limited to one per 14 days unless the owner has the Customization Pass (42501, "You can change your Tap once every 14 days…"). Visibility changes alone never count as an edit.
- **New in 030 (AB-1…AB-3).** Any browser write to `slug, username, last_content_edit_at, edit_window_started_at, provisioned_at, published_at, card_id, ui_plan_id` → **42501** (`That field is managed by SHYGON.`, or `Choose your Tap address with claim_tap_slug.`). The app never sends these. *Frontend impact: none, unless someone adds them to a draft.*

**Visibility ("what visitors see")** is `enabled_customizations` plus `status`. There is **no per-mode visibility model**; see §6.

---

## 6. Modes (Business, Info, Return-to-Owner, …)

| ID | Operation | Status |
|---|---|---|
| M-1 | "Published modes per Tap" (choose which modes a Tap shows) | **NOT IMPLEMENTED** |
| M-2 | "Mode visibility toggle" | **NOT IMPLEMENTED**. Use T-2 (`enabled_customizations`) and T-3 (publish/pause), which exist |

The schema has no mode entity. What exists:
- one public profile per account (the Business/"digital profile" use, P-1);
- an experience tier (`selected_ui_tier`);
- a timed event theme (`tap_event_themes`, admin-managed).

The owner ordered modes as "Business and Info first, then Return-to-Owner" (2026-10-16). Neither "Info" nor a mode table is defined anywhere in the repository. Designing one is an owner decision: DEC-2026-038 Q7.

---

## 7. Cards (signed in)

| ID | Operation | Status |
|---|---|---|
| C-1 | `from('cards').select(…).eq('user_id', uid)`: own cards (RLS) | LIVE-LOCAL (V5 cards) |
| C-2 | `POST /api/card-otp` `{ step:'request', cardId, action:'activate'\|'deactivate' }` → `{ challengeId, expiresAt, phone(masked), resendAfter }`; `{ step:'verify', challengeId, code }` → `{ card, action }`. Errors `{ error: string }` 400/404/409/410/422/429/503 | LIVE-LOCAL; real SMS **BLOCKED** (provider, §10.7) |
| C-3 | `rpc('set_card_nickname', { p_card_id, p_nickname })` | LIVE-LOCAL |
| C-4 | `rpc('request_card_replacement', { p_card_id, p_reason })` | LIVE-LOCAL (sets `suspended`; nothing writes `replaced`) |
| C-5 | `rpc('get_card_tap_history', { p_card_id, p_limit })` | LIVE-LOCAL |

**For AAROH, every card operation is BLOCKED.** No cards are sold (DEC-2026-035 D-10, DEC-037), and the AAROH registry (§3 P-4) does not exist.

Known card defects, deferred to the card release by owner decision (do not build UI that depends on them being fixed):
- **O-7 / V6-011:** an owner can re-activate a card an admin suspended;
- **O-3 / V6-035:** the OTP can be bypassed using the readable `activation_code`;
- **F3 / V6-034:** deactivating a card does not hide the public Tap.

---

## 8. Analytics (signed in)

| ID | Operation | Status |
|---|---|---|
| A-1 | `rpc('get_tap_analytics', { p_days })` → rows `{ day, views, nfc_taps, qr_scans, link_clicks, unique_visitors }` for the caller's own Tap | LIVE-LOCAL (`test:public-tap` §D) |
| A-2 | `rpc('get_tap_link_clicks', { p_days })` → rows `{ link_key, clicks }` | LIVE-LOCAL |

Totals only; no visitor identity. The counts can be inflated by a client varying `X-Forwarded-For` (V6-112).

## 9. In-app notifications (signed in)

| ID | Operation | Status |
|---|---|---|
| N-1 | `from('notifications').select(…).eq('user_id', uid)`; unread count `…is('read_at', null)` | LIVE-LOCAL |
| N-2 | `from('notifications').update({ read_at }).eq('id', id).is('read_at', null)`: mark read (only `read_at` is writable, trigger) | LIVE-LOCAL |

New category in v0.1: **`security`**, e.g. "Your emergency contacts were alerted", `link: '/shygontap/emergency'`, `metadata.emergencyEventId`.

---

## 10. Emergency contacts and alerts — `POST /api/emergency`

One endpoint; the operation goes in `op`. Owner operations need `Authorization: Bearer <access_token>`. The browser has **no** table or RPC access to any emergency data (closed by RLS and grants; verified).

### 10.1 Contacts (owner)

| op | Request | Success | Errors |
|---|---|---|---|
| `contacts.list` | `{ op }` | 200 `{ contacts: Contact[], settings: Settings }` | 401 |
| `contacts.save` | `{ op, contactId?: uuid, name: string(1–80), relationship?: string(≤40) \| null, phone: string }` | 201 (new) / 200 (edit) `{ contact: Contact, publicAlertsDisabled: boolean }` | 400 `invalid_name` `invalid_relationship` `invalid_phone` `invalid_contact`; 404 `contact_not_found`; 409 `duplicate_contact` `too_many_contacts`; 401 |
| `contacts.remove` | `{ op, contactId }` | 200 `{ removed: true, publicAlertsDisabled: boolean }` | 400 `invalid_contact`; 404; 401 |
| `contacts.verify.request` | `{ op, contactId }` | 200 `{ contactId, phone (masked), expiresAt, resendAfter: 45 }` | 404; 409 `already_verified`; 429 `verify_cooldown` `verify_rate_limited` `number_rate_limited` (+`retryAfter`); 503 `provider_not_configured`; 502 `provider_failed`; 401 |
| `contacts.verify.confirm` | `{ op, contactId, code: '6 digits' }` | 200 `{ contact: Contact }` (verified) | 400 `invalid_code`, `wrong_code` (+`attemptsLeft`); 410 `no_challenge` `code_expired`; 429 `too_many_attempts`; 404; 401 |

`Contact = { id, name, relationship, phone: '+91 ••••• 00001', channel: 'sms', verified: boolean, verifiedAt, createdAt, updatedAt }`

Rules:
- **Contacts and numbers.** At most 5 contacts; one per number per owner. `phone` accepts an Indian mobile (10 digits, or +91…) or any `+E.164`.
- **Verification.** Changing a number clears its verification. Only verified contacts are ever alerted. Verification means the contact received a 6-digit code by SMS ("<owner> wants to add you as an emergency contact… if you do not know them, ignore this message") and the owner entered it.
- **Code limits.** The code lasts 10 minutes, with 5 wrong tries allowed; 45 s between sends to one contact; 5 sends per owner per hour; **3 per phone number per 24 h across all owners** (nobody can use SHYGON to text a stranger repeatedly).
- **Last verified contact.** Removing it, or changing its number, switches visitor alerts off (`publicAlertsDisabled: true`).

### 10.2 Settings (owner)

| op | Request | Success | Errors |
|---|---|---|---|
| `settings.set` | `{ op, publicAlertsEnabled: boolean, acknowledge: true }` | 200 `{ settings: Settings }` | 400 `invalid_setting` `acknowledge_required`; 422 `no_verified_contacts` (enabling); 401 |

`Settings = { publicAlertsEnabled, publicAlertsChangedAt, contacts, verifiedContacts, maxContacts: 5, publicTapPublished, providerConfigured }`

- `acknowledge: true` is required **both ways**.
- On: show "Anyone who opens your SHYGON profile could alert your verified contacts; SHYGON cannot confirm emergencies; limited to 3 per day."
- Off: show "Visitors will no longer be able to alert your contacts."
- Visitor alerts default to **off**.

### 10.3 Visitor operations (no sign-in)

| op | Request | Success | Errors |
|---|---|---|---|
| `public.status` | `{ op, slug }` | 200 `{ available: boolean }` | none (an invalid slug returns `available:false`). Call it once per page view, after the profile has rendered, never blocking it. It is not rate-limited; it reveals only whether visitor alerts are available |
| `public.alert` | `{ op, slug, idempotencyKey, confirm: true }` | **202** `{ outcome: 'sent' \| 'sending' \| 'failed' \| 'not_sent', safety }` | 400 `confirm_required` `invalid_idempotency_key`; 404 `unavailable`; 429 `alert_rate_limited` (+`retryAfter`); 503 `service_busy` |

- `available` is true only if the Tap is published, neither the Tap nor the account is suspended, visitor alerts are on, and at least one contact is verified. Every other case is indistinguishable.
- **Relay only.** The visitor never sees who was alerted or how many, and no contact detail is returned.
- Contacts receive: "SHYGON emergency alert: someone using <owner>'s SHYGON profile reported an emergency at <time> IST. SHYGON cannot confirm it. Try to reach <owner> directly. If they may be in danger, call 112."
- The owner gets an in-app `security` notification every time.
- Limits:
  - 3 visitor alerts per owner per 24 h;
  - 15 min between alerts from one Tap;
  - 1 per visitor per Tap and 3 per visitor per 24 h (visitor = HMAC of the host-reported client IP and the day);
  - 50 per hour platform-wide.
- **Host switch.** Visitor alerts run only where the host sets `EMERGENCY_PUBLIC_ALERTS=on`. It is unset (off) everywhere by default, so `public.status` answers `false` and `public.alert` answers `unavailable`, whatever the owner chose.
- **Status: LIVE-LOCAL, but turning the host switch on in production needs the owner's decision (DEC-2026-038 Q2).** Build the visitor control so that it appears only when `available === true`.

### 10.4 Alerts (owner)

| op | Request | Success | Errors |
|---|---|---|---|
| `alerts.create` | `{ op, idempotencyKey: string(16–64, [A-Za-z0-9_-]) }` | **201** `{ event: Event, replayed: false, safety }`; a repeat of the key → **200** `{ event, replayed: true, safety }` and nothing is re-sent | 400 `invalid_idempotency_key`; 409 `alert_in_progress` (+`eventId`); 422 `no_verified_contacts`; 429 `alert_rate_limited` (+`retryAfter`); 401 |
| `alerts.get` | `{ op, eventId }` | 200 `{ event: Event }` | 400 `invalid_event`; 404 `event_not_found`; 401 |
| `alerts.list` | `{ op, limit?: 1–100 }` | 200 `{ events: EventSummary[] }` (newest first) | 401 |
| `alerts.retry` | `{ op, eventId }` | 200 `{ event, requeued: n, dispatched: n }` | 404; 401 |
| `alerts.cancel` | `{ op, eventId }` | 200 `{ event: Event & { stopped: n } }` | 404; 409 `already_cancelled` `already_complete`; 401 |
| `alerts.report` | `{ op, eventId, reason?: string(≤300) }` | 200 `{ reported: true, publicAlertsDisabled: boolean }` | 404; 409 `already_reported`; 400; 401 |

`alerts.create` sends the texts during the request (≤ 6 s provider timeout each, in parallel) and returns the resulting state. The message reads: "SHYGON emergency alert: <owner> has asked for help and wants you to contact them now (sent <time> IST). SHYGON does not contact emergency services. If they are in danger, call 112."

```
Event = {
  id, initiator: 'owner' | 'public', status: EventStatus,
  createdAt, updatedAt, completedAt, cancelledAt, reportedAt,
  deliveryReceipts: 'supported' | 'not_supported',   // with the current provider settings
  providerConfigured: boolean,
  recipients: [{ id, name, phone: '••••• 0001', channel: 'sms', status: RecipientStatus,
                 attempts: 0–3, provider, acceptedAt, deliveredAt, failedAt,
                 nextAttemptAt (retry_wait only), lastError }]
}
EventSummary = { id, initiator, status, createdAt, completedAt, cancelledAt, reportedAt,
                 counts: { total, delivered, accepted, pending, failed, notSent, cancelled } }
```

**EventStatus**, derived from the recipients, server-side:

| status | Meaning | Show as |
|---|---|---|
| `queued` | created, nothing attempted yet | "Sending…" |
| `sending` | at least one attempt made and something still pending (in flight or waiting to retry) | "Sending…" (+ retry time from `nextAttemptAt`) |
| `sent` | every message **accepted by the SMS provider**; receipt not (yet) confirmed | "Sent to N contacts. Delivery not confirmed." |
| `delivered` | every message confirmed by a provider delivery receipt | "Delivered to N contacts" |
| `partial` | some messages reached the provider, some failed | per-recipient |
| `failed` | no message reached the provider | "Could not be sent" |
| `not_sent` | nothing could be sent: **no SMS provider configured** | "Text messages are not set up. Nothing was sent." |
| `cancelled` | stopped by the owner before any message was accepted | "Stopped" |

**RecipientStatus:** `queued`, `sending`, `retry_wait`, `accepted` (provider took it), `delivered` (receipt), `undelivered` (receipt says not delivered), `failed` (refused, or 3 attempts used), `not_sent`, `cancelled`.

**Idempotency, retries and limits:**
- **Key.** `(owner, initiator, idempotencyKey)` is unique, and a per-owner transaction lock serialises alert creation.
  - Tested: two simultaneous repeats of a key return the same alert and send nothing.
  - Not exercised locally: two simultaneous *first* requests, because the local gateway runs one request at a time. The unique constraint is what guarantees that case on Postgres.
- **Attempts.** At most 3 per recipient, with backoff of 30 s, then 2 min:
  - provider 5xx, 429, network errors and timeouts are retried;
  - a provider refusal (4xx, e.g. an invalid number) is not;
  - `not_configured` is never retried automatically; `alerts.retry` requeues it once a provider exists.
- **Leases.** Each attempt holds a 90 s lease with an attempt number, so two dispatchers never send the same attempt. If a server dies mid-send, the attempt closes as `lease_expired`, counts toward the 3, and is retried. That can duplicate a text at most twice; it is bounded and documented.
- **Owner limits.** One alert in progress per 2 minutes (409 with its `eventId`), 5 per hour, 10 per 24 h.
- **Cancel** stops recipients not yet sent. A text the provider already accepted cannot be recalled, and the UI must say so. No "false alarm" follow-up text is sent (NOT IMPLEMENTED).
- **Report** marks the alert unwanted, switches visitor alerts off if it was a visitor alert, and notifies SHYGON (admin notification `security`).

### 10.5 Entities

These are all migration 029, closed to every API client:
- `emergency_settings`
- `emergency_contacts`
- `emergency_contact_challenges`
- `emergency_events`
- `emergency_event_recipients`
- `emergency_delivery_attempts` (append-only)
- `emergency_audit` (append-only)

### 10.6 Test coverage

`npm run test:emergency`: 43 checks, deny-network.
- **Part A (database):** closure; limits; idempotency; attempt fencing; lease expiry; receipts forward-only; retention; account-deletion cascade; 030 with a negative control.
- **Part B (HTTP on the local stack, SMS stand-in):**
  - 401 for missing, garbage or anon tokens;
  - cross-customer refusals on every operation, and direct REST/RPC refusals;
  - masked numbers only;
  - verification with and without a provider;
  - accepted ≠ delivered, signed receipts, forged and unsigned receipts refused;
  - provider refusal, outage (500/429/timeout/network) and 3-attempt bound;
  - no provider (`not_sent`), then retry;
  - **a database failure mid-send is never reported as sent**;
  - cancel; owner and visitor rate limits; report;
  - the admin investigation RPC;
  - MSG91 templates;
  - no secret, number or contact name in any response or log line.

`npm run test:rls-matrix` covers the seven tables × 7 callers.

### 10.7 Status

| Part | Status |
|---|---|
| Contacts, settings, verification logic, alert state machine, idempotency, limits, retries, receipts, retention, audit | **LIVE-LOCAL** |
| Real SMS to real phones (verification and alerts) | **BLOCKED**: `SMS_PROVIDER` plus credentials and, for MSG91, three DLT-approved templates; `docs/v6/aaroh/provider-requirements.md` |
| Delivery receipts | **BLOCKED** with the provider (Twilio: `SMS_STATUS_CALLBACK_URL`). **MSG91 receipts: NOT IMPLEMENTED** (status stays `sent`) |
| Scheduled retries and retention (`/api/emergency-dispatch` every minute with `CRON_SECRET`) | **BLOCKED**: host schedule and secret, and the deploy target (V6-043) |
| Visitor-initiated alerts in production | **BLOCKED**: DEC-2026-038 Q2 |
| Migration 029 on any real database | **BLOCKED**: DEC-2026-038 Q1 and the DEC-2026-018 review |
| Location sharing, a callback number from the visitor, medical information, emergency-services integration, email, WhatsApp | **NOT IMPLEMENTED** (deliberately) |

---

## 11. Operations that do not exist (NOT IMPLEMENTED unless stated)

| Feature | Status | Why |
|---|---|---|
| Return-to-owner relay (finder → owner messages) | NOT IMPLEMENTED | Owner's order: after Business/Info. Its privacy rules are not decided (showroom: "would be decided and published before any launch"). The §10 dispatch layer is reusable. |
| Connect requests | NOT IMPLEMENTED | Phase 2 (doc 10); needs `connections` and `consent_grants`; DEC-2026-025 |
| Credential verification (`/v/<code>`) | NOT IMPLEMENTED | No schema. DEC-037: an AAROH card is not an access or authentication credential |
| SHYGON Privé (demo hotels, guest requests) | **BLOCKED** (decision conflict) | 2026-10-16: the owner removed Privé from the launch. 2026-10-19 brief: Privé as demo-only. DEC-2026-038 Q6. No real hotel, PMS, booking or access-control integration in any case |
| Student Passport, Event mode, Places/objects, Cloud storage | NOT IMPLEMENTED | "Planned" in the showroom; no schema, no approval |
| Card activation/lost cards for AAROH | BLOCKED | §7 |

---

## 12. Feature status for the showroom

The frontend must show these, not infer them. **These are engineering labels, not customer copy.**
- Customer-facing status words stay the showroom's owner-approved vocabulary (`AAROH_SHOWCASE` `status`).
- A LIVE-LOCAL feature is not "Live" for a customer until it runs on production.
- Changing a showroom status is a product decision (DEC-2026-038 Q10).

| Showroom feature | Backend status | Notes |
|---|---|---|
| Digital profile | LIVE-LOCAL | §3, §5 |
| Call and email (show/hide) | LIVE-LOCAL | `enabled_customizations` (025) |
| More ways to reach you (add-ons) | LIVE-LOCAL | Purchase = payment chain (test mode only; live payments B-3) |
| Your look (themes) | LIVE-LOCAL | Server clamps to what was paid |
| Link, QR code and sharing | LIVE-LOCAL | `/t/<slug>`; the QR is client-generated |
| Analytics | LIVE-LOCAL | §8 |
| What visitors see (publish/pause, per field) | LIVE-LOCAL | §5 |
| Card activation and lost cards | BLOCKED | §7 |
| Emergency information / alerts | LIVE-LOCAL logic; **BLOCKED** for real delivery | §10.7. Showroom copy must change from "nothing like it is stored today" only when the owner approves DEC-2026-038 |
| Return to owner | NOT IMPLEMENTED | §11 |
| Connect | NOT IMPLEMENTED | §11 |
| Verify | NOT IMPLEMENTED | §11 |
| Privé | BLOCKED (decision) | §11 |
| Student, Event, Places, Cloud | NOT IMPLEMENTED | §11 |

## 12a. Administration (admin app; not the customer frontend)

| Operation | Status |
|---|---|
| `rpc('admin_list_emergency_events', { p_status?: text \| 'reported', p_limit?: 1–200, p_offset? })` → events with `userId`, statuses, `reportReason`, and per recipient `last4, status, attempts, provider, providerMessageId, providerStatus, lastError, attemptLog[]`. **No contact names, no full numbers.** Needs `support.read`; every call writes `admin_audit_log` `emergency.events.read` | LIVE-LOCAL; PROPOSED (DEC-2026-038; listed as PROPOSED in `test:admin-contract`) |
| Every other `admin_*` RPC | Unchanged; frozen admin contract (doc 12 §2) |

---

## 13. CHANGELOG

| Version | Date | Change | Frontend impact |
|---|---|---|---|
| v0.1 | 2026-10-19 | First publication. Existing operations documented as found on `4d730c4`. New: `/api/emergency` (§10), `security` notifications (§9), `admin_list_emergency_events` (§12a). Tap column guard (030) added to T-2. | New feature surface; no existing call changes. A browser draft must not include the eight server-managed columns (it does not today). |
