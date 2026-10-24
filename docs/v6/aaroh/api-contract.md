# SHYGON AAROH backend API contract — AAROH-API v0.8

| | |
|---|---|
| Contract version | **AAROH-API v0.8** (2026-10-24): modes and Info, §6. v0.1 `c8b869d`, v0.2 `b12967a`, v0.3 `6be94e3`, v0.4 `d1ff25d`, v0.5 `f1d2af1`, v0.6 `126d2a9`, v0.7 `96571ed`, v0.7.1 `34a482d`, v0.7.2 `32a4ac9`; changes in §13. v0.8 is reserved for the mode model (DEC-2026-041), which is not approved. DEC-2026-038, -039 and -040 are **APPROVED**. |
| Owner | Session A (backend). Changes only through a version bump and a CHANGELOG entry (§13), with the frontend impact stated. |
| Branch / base | `v6/aaroh-backend`, from `4d730c4` (V6 RC `6d00f2f` + migration 028). Read this file with `git show v6/aaroh-backend:docs/v6/aaroh/api-contract.md`. |
| Database | live schema baseline (captured 2026-09-30) + migrations 020–026, 028, **029, 030, 031** (APPROVED 2026-10-19, DEC-2026-038), **032** (APPROVED 2026-10-20, DEC-2026-039), **033** (APPROVED 2026-10-20, DEC-2026-040); none applied anywhere. 027 is held aside (DEC-2026-037). |
| Capability matrix | `docs/v6/aaroh/capability-matrix.md`: all 12 AAROH capabilities, their process definitions and honest availability states. |
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
9. **In-app notification links:**
   - a visitor emergency alert links to `/shygontap/emergency`;
   - a Return-to-Owner message links to `/shygontap/return-to-owner` (v0.2).

   Build those routes, or tell Session A the routes you use and they change in the next version.
10. **A contract change you need:** message Session A. It ships as the next version with a CHANGELOG entry. Do not work around a missing field.
11. **Browser E2E hooks** (v0.4, your B-4). These run on `npm run stack` only: loopback callers, never in a deployed build.
    - `POST /__sim/sms/provider` `{ provider: 'twilio' | 'msg91' | null, receipts? }`
    - `POST /__sim/sms/queue` `{ scenarios: [...] }`, for the next provider answers: `accept`, `reject`, `error`, `busy`, `timeout`, `network`
    - `GET /__sim/sms/last-code?to=<E.164>`: the latest verification code texted to that number
    - `GET /__sim/sms/messages`: provider, to, sid and scenario, never bodies
    - `POST /__sim/sms/deliver` `{ sid, status }`: a signed receipt (a Twilio status, or an MSG91 code)
    - `POST /__sim/switches` `{ EMERGENCY_PUBLIC_ALERTS?, RESCUE_RELAY?, CONNECT_PUBLIC? }` (booleans): only those three switches (`CONNECT_PUBLIC` since v0.7.1)
    - **Visitor address (v0.7.1, B-9).** The local host gives every `/api/*` call the connection's address and drops any address header the caller sends. For distinct visitors, start the stack with `STACK_SIM_CLIENT_ADDRESS=1` and send `x-shygon-sim-client: <192.0.2.x | 198.51.100.x | 203.0.113.x | none>` (`none` = a host that reports no address). Loopback only; other values get 400 from the host.

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

## 6. Modes (Business, Info): `POST /api/modes` and `get_public_tap_mode` (v0.8)

**Status:** LIVE-LOCAL. Implementation scope approved 2026-10-24 (DEC-2026-041; migration 034). **Info is OFF in the catalogue (`tap_mode_catalog`) on every database by default.** The legacy `get_public_profile` is unchanged (BQ-1), so it would still return the Business payload for a Tap on Info. Info may be switched on in a real database only after BQ-1's change to that reader.

**The model:**
- One active mode per Tap (per account in v1): `business` (the default; no state row means Business) or `info`.
- **Info** is a public page about a physical object, product, place or service point. One record per account. Plain text only: no image, no language, no links, no Business data.
- Emergency, Return-to-Owner and Connect remain per-account capabilities (§10, §10a, §10b). **They do not appear on an Info page** (DEC-2026-041 PQ-3).

**P-6 `rpc('get_public_tap_mode', { p_slug })`** (anon; SECURITY DEFINER; read-only) returns one of:
- `{ mode: 'business', profile: <the P-1 payload, unchanged> }`;
- `{ mode: 'info', info: { title, shortDescription, category, detailedInformation, updatedAt } }`, those five keys only;
- `null`: no live Tap (unknown, draft, paused, suspended), **or** the neutral "unavailable" fallback (Info switched off, missing or invalid).

**It never falls back to the Business profile.** On `null`, ask P-2 why, as today.

**Owner operations** (all need `Authorization: Bearer <access token>`):

| op | Request | Success |
|---|---|---|
| `owner.state` | `{ op }` | 200 `{ activeMode, version, changedAt, modes: [{ mode, available, reason: 'active' \| 'ready' \| 'needs_setup' \| 'not_available', missing? }] }` |
| `owner.activate` | `{ op, mode: 'business' \| 'info', expectedVersion, idempotencyKey }` | 200 `{ activeMode, previousMode, version, changedAt, replayed }`. The same key again → the first answer with `replayed: true` |
| `owner.info.get` | `{ op }` | 200 `{ info: { title, shortDescription, category, detailedInformation, updatedAt, version } \| null, publicationStatus: 'draft' \| 'ready' \| 'live' \| 'unavailable' }` |
| `owner.info.save` | `{ op, fields: { title?, shortDescription?, category?, detailedInformation? }, expectedVersion }`. A present key sets the field (null or empty clears it); an absent key leaves it. `expectedVersion` is 0 before the first save | 200, the same shape as `owner.info.get` |
| `owner.info.clear` | `{ op }` | 200 `{ cleared }` |
| `owner.preview` | `{ op, mode }` | 200 `{ mode, view }`: exactly what a visitor would get (`null` when it would be unavailable) |

**Errors** use the shape `{ error: { code, message, field?, reason?, missing?, current? } }`. Messages are fixed text and never repeat a submitted value.

| HTTP | Codes |
|---|---|
| 401 | `unauthenticated` |
| 400 | `invalid_request`, `unknown_op`, `invalid_mode`, `invalid_expected_version`, `invalid_idempotency_key` |
| 404 | `no_tap` |
| 409 | `tap_suspended`, `mode_unavailable`, `needs_setup` (+`missing`), `stale_version` (+`current`), `mode_active` |
| 422 | `invalid_field` (+`field`, +`reason`: `too_long`, `markup`, `control_characters`, `not_allowed`, `unknown` or `not_text`) |

**Rules (`test:modes`):**
- **Fields:** title 1–120 characters and short description 1–280, both required to activate. Category one of `place`, `product`, `equipment`, `exhibit`, `service_point`, `instructions`. Detailed information up to 2,000 characters, with line breaks.
- **Plain text:** no markup and no control characters.
- **Edits:** no 14-day window and no fixed quota, and an Info save never touches `tap_profiles`.
- **While Info is live:** clearing it, or blanking a required field, is `mode_active`.
- **Switching:** to Business is always allowed; switching is refused while the Tap or the account is suspended.
- **Audit:** field names only, never values.
- **Role:** comes only from the verified token. Nothing in the body or the URL can claim one.

**Frontend impact:**
- The public page may call P-6 first and fall back to P-1 if P-6 does not exist yet. `src/test/contract.test.ts` must then allow `get_public_tap_mode`.
- Render Info as plain text, and show no capability buttons on it.
- On `null`, use the existing "unavailable" copy.
- Owner page: show the server's `available` / `reason` / `missing`; show "Live" only after a 200; send `expectedVersion` and a fresh `idempotencyKey` per click.

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

New categories:
- **`security`** (v0.1), e.g. "Your emergency contacts were alerted", `link: '/shygontap/emergency'`, `metadata.emergencyEventId`;
- **`rescue`** (v0.2): "Someone sent you a message through SHYGON", `link: '/shygontap/return-to-owner'`, `metadata.rescueThreadId`. **Never contains the message text.**
- **`connect`** (v0.4): "New connection request" and "Connection accepted", `link: '/shygontap/connections'`, `metadata.connectionId`. The request notice names the requester and **never contains the note**.

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
- **Visitor address (v0.7.1, B-9 Part B).** The visitor limits use only the address header named by the host setting `TRUSTED_CLIENT_IP_HEADER`. Unset, and `public.alert` answers `unavailable`. No request or response changed.
- **Status: LIVE-LOCAL; OFF by decision (DEC-2026-038 Q2 = B)** until supervised owner alerts have run in production. Build the visitor control so that it appears only when `available === true`.

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
| Real SMS to real phones (verification and alerts) | **BLOCKED**: the provider is MSG91 (DEC-2026-038 Q3). It needs the MSG91 account, `SMS_PROVIDER=msg91`, the key and three DLT-approved templates (human), then the supervised smoke test (`scripts/release/emergency-smoke.mjs`); `docs/v6/aaroh/provider-requirements.md` |
| Delivery receipts | **LIVE-LOCAL** for both providers: Twilio signed callbacks, and MSG91 "Report Received" webhooks with a secret header (v0.3, V6-114). Live: BLOCKED with the provider (`MSG91_DLR_SECRET` and the webhook configured in MSG91) |
| Scheduled retries and retention (`/api/emergency-dispatch` every minute with `CRON_SECRET`) | **BLOCKED**: host schedule and secret, and the deploy target (V6-043) |
| Visitor-initiated alerts in production | **OFF by decision** (DEC-2026-038 Q2 = B): `EMERGENCY_PUBLIC_ALERTS` stays unset until supervised owner alerts have run in production; then the owner decides again |
| Migration 029 on any real database | **APPROVED design** (Q1). Application waits for the DEC-2026-018 cool-off and checklist, then the release track |
| Location sharing, a callback number from the visitor, medical information, emergency-services integration, email, WhatsApp | **NOT IMPLEMENTED** (deliberately) |

---

## 10a. Return-to-Owner relay — `POST /api/rescue` (v0.2)

A finder sends a protected message to a Tap's owner and they talk through SHYGON.
- **The finder never receives any owner detail.** No account id, no name beyond what the public Tap already shows, no number, no email.
- **The owner sees only what the finder writes.**
- **Links are removed from every message,** on both sides. An email address or a number the writer types is kept: it is the writer's choice.

**Availability.**
- **Host switch.** Finder operations run only where the host sets `RESCUE_RELAY=on`. It is unset everywhere: `public.status` returns `available:false`, and the other finder operations return `404 unavailable`.
- **Visitor address (v0.7.1, B-9 Part B).** Finder limits and blocks use only the address header named by `TRUSTED_CLIENT_IP_HEADER`. Unset, and `public.start` answers `unavailable`. No request or response changed.
- **Owner opt-in.** The owner must also turn it on (default off).
- **Tap state.** The Tap must be published, and neither the Tap nor the account may be suspended.
- Approved (DEC-2026-038 Q12). The switch goes on with the first production release containing 031.

### Finder operations (no sign-in)

| op | Request | Success | Errors |
|---|---|---|---|
| `public.status` | `{ op, slug }` | 200 `{ available: boolean, hint: string \| null }` (`hint` = the owner's cleaned public note, ≤ 140) | none |
| `public.start` | `{ op, slug, idempotencyKey, message: string(1–500 after cleaning) }` | **201** `{ finderToken, replayed: false, thread: FinderThread }`; same key again → **200** with the **same** `finderToken`, `replayed: true` | 400 `invalid_message` `invalid_idempotency_key`; 404 `unavailable` (indistinguishable causes, including a blocked finder); 429 `rate_limited` (+`retryAfter`) |
| `finder.view` | `{ op, finderToken }` | 200 `{ thread: FinderThread }` | 400 `invalid_token`; 404 `thread_not_found` (also blocked or reported); 410 `thread_expired`; 429 `rate_limited` |
| `finder.post` | `{ op, finderToken, clientKey, message }` | 200 `{ replayed, thread: FinderThread }` | 400 `invalid_token` `invalid_message` `invalid_idempotency_key`; 404; 409 `thread_closed`, `awaiting_owner` (3 finder messages in a row with no reply); 410; 429 |

`FinderThread = { status: 'open' | 'owner_replied' | 'closed', canWrite: boolean, expiresAt, messages: [{ from: 'finder' | 'owner' | 'system', body, at }] }`

**The finder token** is a 43-character secret and the only key to the conversation. It stops working 14 days after the thread's last activity.
- Keep it **only** in `sessionStorage` or the URL **fragment** (`#…`). Never put it in a path, a query string, analytics or logs.
- Offer the finder a "save this link" option that uses the fragment.

### Owner operations (signed in)

| op | Request | Success | Errors |
|---|---|---|---|
| `settings.get` | `{ op }` | 200 `{ settings: { enabled, publicHint, changedAt, publicTapPublished, openThreads, unread, relayAllowed } }` | 401 |
| `settings.set` | `{ op, enabled: boolean, publicHint?: string \| null }` | 200 `{ settings }` (hint cleaned: links removed, ≤ 140) | 400 `invalid_setting` `invalid_request`; 401 |
| `threads.list` | `{ op, limit?: 1–100 }` | 200 `{ threads: [{ id, status, createdAt, lastActivityAt, closedAt, reportedAt, unread, messages, preview }] }` (`preview` = first 80 characters of the latest finder message) | 401 |
| `threads.get` | `{ op, threadId }` | 200 `{ thread: { id, status, createdAt, lastActivityAt, closedAt, reportedAt, finderCanWrite, messages: [{ id, from, body, at }] } }`; marks the thread read | 400 `invalid_thread`; 404 `thread_not_found`; 401 |
| `threads.reply` | `{ op, threadId, clientKey, message }` | 200 `{ thread, replayed }` | 400; 404; 409 `thread_closed`; 401 |
| `threads.close` | `{ op, threadId }` | 200 `{ thread }`: the finder can read but not write | 404; 409 `thread_closed`; 401 |
| `threads.block` | `{ op, threadId }` | 200 `{ thread }`: status `blocked`; the finder loses access; that finder cannot open a new thread to this owner for 90 days | 404; 409 `already_blocked`; 401 |
| `threads.report` | `{ op, threadId, reason?: string(≤300) }` | 200 `{ thread }`: status `spam`, blocked as above; SHYGON is notified | as block |

**Thread states:**
- `open` → `owner_replied` (owner reply) → `open` (finder follow-up) → … ;
- `closed` (by the owner, or after 30 days idle);
- `blocked`; `spam`.

**Limits:**
- 3 new threads per hour and 10 per day per finder (an HMAC of the host-reported client address);
- 5 new threads per owner per day;
- 10 finder follow-ups per thread per hour, and at most 3 in a row without a reply;
- 60 `finder.view` calls per thread per hour.

**Idempotency:** `public.start` per `(owner, idempotencyKey)`, returning the same token; messages per `(thread, clientKey)`.

**Notifications:** an in-app `rescue` notice on a new thread, without the message text.
- **No text message or push to the owner:** the account phone is unverified (F4) and no provider is configured. This is BLOCKED.

**Not built:**
- **Lost or found item lifecycle and device-bound items: BLOCKED.** They need the card registry and the card lifecycle decision (DEC-2026-028); card sales are deferred by DEC-2026-035.
- **Bot check:** no Turnstile key exists.

**Entities (migration 031):** `rescue_settings`, `rescue_threads` (finder token stored as SHA-256 only), `rescue_messages`, `rescue_blocks`, `rescue_audit`. All are closed to every API client.

**Retention:** threads and their messages are deleted 90 days after closing; blocks expire after 90 days.

**Tests:** `npm run test:rescue`, 18 checks. They cover closure, the cleaner, the host switch, opt-in, start, duplicate start, owner inbox and read state, cross-account refusals on every owner operation, direct REST, auto-quiesce and duplicates, replies, finder and owner limits, poll cap, expiry, block, report and admin review, close, paused/suspended/disabled Taps, retention, and no leak.

**Status:** LIVE-LOCAL, **APPROVED** (DEC-2026-038 Q12), off (switch) until the first production release with 031.

**Admin** (§12a): `admin_list_rescue_reports(p_limit, p_offset)` returns reported threads with their messages (moderation needs the text). It requires `support.read`, and every read is in `admin_audit_log`.

---

## 10b. SHYGON Connect and the consent ledger — `POST /api/connect` (v0.4)

Two **signed-in** SHYGON accounts connect. Each side chooses what it shares from its own account profile: `phone`, `email`, `company` and `job_title`.
- **Live values.** The other side reads the values live, but only while that grant is active.
- **Self-reported.** Every shared value is marked `provenance: 'self_reported'`; nothing verifies it.
- **Revocation.** Revoking stops future reads at once. Something already copied off the screen cannot be un-shared, and the UI must say so (doc 04).
- **Opt-in.** The owner of the Tap being asked must switch Connect on (default off).
- **Host switch (v0.7.1, B-10; DEC-2026-039 amendment A-1).** Connect is public only where the host sets `CONNECT_PUBLIC=on`. It is unset everywhere by default. While it is off:
  - `public.status` answers `{ available: false }`, whatever the owner chose;
  - `requests.create`, `requests.accept` and `connections.share` answer **404 `unavailable`**, before sign-in is checked (so an anonymous `requests.create` gets 404 rather than 401);
  - `requests.decline`, `requests.block`, `connections.remove`, `connections.list`, `consents.list` and the settings always work, so consent can always be withdrawn;
  - `settings.get` / `settings.set` report `publicAllowed: false`.
- **Status:** LIVE-LOCAL, **APPROVED** (DEC-2026-038 Q13; DEC-2026-039 Q1–Q7 as built, 2026-10-20; amendment A-1 approved 2026-10-20).
  - A Connect control may ship with the first production release that contains 032.
  - Connect becomes visible to visitors only when the owner, after verifying the connection and consent workflows, has the host set `CONNECT_PUBLIC=on` (A-1). Until then it stays off.
  - Its customer wording is the owner's to approve, as for Q10.

| op | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `public.status` | none | `{ op, slug }` | 200 `{ available }` | none |
| `settings.get` | Bearer | `{ op }` | 200 `{ settings: { enabled, publicTapPublished, pendingIncoming, connections, shareableFields, publicAllowed } }` (`publicAllowed` since v0.7.1) | 401 |
| `settings.set` | Bearer | `{ op, enabled: boolean }` | 200 `{ settings }` (with `publicAllowed`) | 400 `invalid_setting`; 401 |
| `requests.create` | Bearer | `{ op, slug, idempotencyKey, share: Field[], note?: string(≤200) }` | **201** `{ connection, replayed: false }`; the same key again → 200 with the same connection, `replayed: true` | 400 `invalid_share` `invalid_note` `invalid_idempotency_key` `self`; 404 `unavailable` (Connect off, the host switch off, Tap not published or suspended, a suspended requester, or **blocked**: indistinguishable); 409 `already_connected` `target_busy`; 429 `recently_declined` `rate_limited` (+`retryAfter`); 401 |
| `requests.accept` | Bearer (target) | `{ op, connectionId, share: Field[] }` | 200 `{ connection }` | 400; 404 `connection_not_found` (also for the requester or a third account); 404 `unavailable` (host switch off); 409 `already_decided`; 401 |
| `requests.decline` · `requests.block` | Bearer (target) | `{ op, connectionId }` | 200 `{ connection }` | as accept |
| `connections.list` | Bearer | `{ op, status?: 'requested' \| 'accepted' \| 'declined' \| 'blocked' \| 'expired' \| 'removed' }` | 200 `{ connections: Connection[] }` | 400; 401 |
| `connections.share` | Bearer (either side, while open; the requester may change it before the decision) | `{ op, connectionId, share: Field[] }` | 200 `{ connection }` | 400 `invalid_share`; 404; 404 `unavailable` (host switch off); 409 `not_open`; 401 |
| `connections.remove` | Bearer (either side; also withdraws a request) | `{ op, connectionId }` | 200 `{ removed: true, grantsRevoked, connection }` | 404; 409 `not_open`; 401 |
| `consents.list` | Bearer | `{ op }` | 200 `{ consents: [{ id, connectionId, direction: 'given' \| 'received', other, scope, purpose, version, grantedAt, revokedAt, revokeReason }] }`, revoked grants included | 401 |

`Field = 'phone' | 'email' | 'company' | 'job_title'`

```
Connection = { id, direction: 'outgoing' | 'incoming',
               status: 'requested' | 'accepted' | 'declined' | 'blocked' | 'expired' | 'removed',
               note, createdAt, decidedAt, endedAt,
               other: { name, tapSlug | null },
               iShare: Field[],
               theyShare: { [Field]: { value, provenance: 'self_reported' } } }
```

- **Status for the requester:** a requester never sees `blocked`; a block shows as `declined`.
- **What `theyShare` holds:** it is filled only while the connection is open (`requested` or `accepted`) and the other side's grant is active.

**Lifecycle:**
- `requested` → `accepted` | `declined` | `blocked` | `expired` (30 days unanswered);
- `accepted` → `removed` (either side).
- Decline, block, expiry and removal revoke the grants.

**Limits:**
- 5 requests per hour and 20 per day per requester;
- 50 open incoming per target;
- after a decline, 30 days before the same requester may ask again;
- one open connection per pair, in either direction.

**Notifications** (category `connect`, link `/shygontap/connections`):
- a new request goes to the target, with the requester's name and **without the note**;
- an acceptance goes to the requester.

**Ledger:** `consent_grants` is append-only, even for the server role. A grant can only be revoked, once; changing a share revokes the grant and writes the next version.

**Entities (migration 032):** `connect_settings`, `connections`, `consent_grants`, `connect_audit`. All are closed to every API client.

**Retention:** ended connections and their grants are deleted 180 days after they end; account deletion removes everything.

**Tests:** `npm run test:connect`, 16 checks. They cover closure, the ledger's append-only rule, opt-in, sign-in, the exact share, the note cleaner, duplicates, two-party-only access, accept with live reads, share versions, removal, decline cool-down, block never revealed, suspended/paused/off, limits, expiry through the sweep, direct REST, and no value reaching any caller without a grant.

---

## 10c. SHYGON Privé, demo only — `POST /api/prive` (v0.6)

Sample hotels owned by SHYGON, and guest service requests that are really stored and moved on inside SHYGON.
- **Never a real hotel.** No request reaches a real hotel, and nothing books, opens a door or contacts staff.
- **Labelled.** Every response, errors included, carries `demo: true` and `notice: "Demo: SHYGON Privé sample hotel. No real hotel received this request; nothing is booked and no door opens."` Show the notice whenever a Privé result is on screen.
- **Status:** LIVE-LOCAL, **APPROVED** (DEC-2026-038 Q6 → A; DEC-2026-040 Q1–Q5 as built, 2026-10-20). Demo only. It ships with the first production release that contains 033, with customer wording approved by the owner.

| op | Auth | Request | Success | Errors |
|---|---|---|---|---|
| `hotels.list` | none | `{ op }` | 200 `{ hotels: [{ slug, name, city, description, services: [{ id, label }], demo: true, label }] }` | 503 `not_supported` (a non-demo provider configured) |
| `requests.create` | Bearer | `{ op, hotelSlug, service, idempotencyKey }` | **201** `{ request, replayed: false }`; the same key again → 200, same request | 400 `invalid_service` `invalid_idempotency_key`; 404 `hotel_not_found`; 429 `rate_limited`; 401 |
| `requests.list` | Bearer | `{ op }` | 200 `{ requests: Request[] }` (newest first) | 401 |
| `requests.get` | Bearer | `{ op, requestId }` | 200 `{ request }` | 400; 404 `request_not_found`; 401 |
| `requests.cancel` | Bearer | `{ op, requestId }` | 200 `{ request }` | 404; 409 `already_closed`; 401 |

```
Request = { id, demo: true, status: 'received' | 'acknowledged' | 'in_progress' | 'completed' | 'cancelled',
            hotel: { slug, name, label }, service: { id, label },
            createdAt, updatedAt, completedAt, cancelledAt,
            steps: [{ status, by: 'guest' | 'demo_hotel_simulator', at }] }
```

**Sample hotels:**
- `demo-residence`, SHYGON Demo Residence: the same services as your walkthrough (`fresh_towels`, `housekeeping`, `late_checkout`, `restaurant_table`);
- `demo-seaside`, SHYGON Demo Seaside;
- `demo-hills`, SHYGON Demo Hills.

**The "hotel desk"** is a simulator inside SHYGON:
- received → acknowledged (about 20 s) → in progress (about 1 min) → completed (about 3 min);
- one step per sweep or read, each step shown as `by: 'demo_hotel_simulator'`;
- write "SHYGON's demo desk", never "the hotel".

**Limits:** 10 per hour and 50 per day per account. **Retention:** 30 days.

**Boundary:** `netlify/lib/hospitality.mjs` (`HotelProvider`, implementation `demo` only). Any other `HOTEL_PROVIDER` makes this endpoint answer 503.

**Entities (migration 033):** `prive_demo_hotels`, `prive_demo_requests`, `prive_demo_request_events`. All are closed to every API client.

**Tests:** `npm run test:prive`, 12 checks. They cover closure, demo by construction (database checks), the catalogue, sign-in and validation, idempotency, isolation, the simulated desk, cancel, limits, the fail-closed boundary, retention through the sweep, direct REST, and every response labelled with no booking, receiving or door claim.

---

## 11. Operations that do not exist (NOT IMPLEMENTED unless stated)

| Feature | Status | Why |
|---|---|---|
| Return-to-owner relay | **Moved to §10a in v0.2** (LIVE-LOCAL, off) | Lost or found item lifecycle is still BLOCKED (card registry) |
| Emergency Profile / Emergency Tap information view | **Decided (Q11 = B): no new backend** | The view presents `public.status` (§10.3) plus the name the public profile already shows, and its only action is the visitor alert (`public.alert`). Hidden while Q2 keeps visitor alerts off. Never show a contact detail |
| Connect requests | **Moved to §10b in v0.4** (LIVE-LOCAL, APPROVED) | Guest requesters (no SHYGON account): **not built, by decision** (DEC-2026-039 Q1 = A) |
| Credential verification (`/v/<code>`) | NOT IMPLEMENTED | No schema. DEC-037: an AAROH card is not an access or authentication credential |
| SHYGON Privé real-hotel integrations (PMS, booking, room access) | **Not built, by decision** (DEC-2026-038 Q6 → A: demo only) | The demo is §10c. A real integration needs its own decision, contract and review |
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
| Emergency information / alerts | LIVE-LOCAL logic, **APPROVED** (Q1); real delivery **BLOCKED** (§10.7) | Showroom wording changes per Q10 = A: Session B drafts it and the owner approves the text. Until then the customer-facing status stays "Coming soon" |
| Return to owner | LIVE-LOCAL, **APPROVED** (Q12), off (`RESCUE_RELAY`) until the first production release with 031 | §10a. Customer copy per Q10: Session B drafts, owner approves |
| Connect | LIVE-LOCAL, **APPROVED** (DEC-2026-039); **off by host switch** (`CONNECT_PUBLIC` unset) everywhere until the owner verifies the connection and consent workflows (amendment A-1) | §10b. Customer-facing: "Coming soon" until it is deployed, with wording the owner approves |
| Verify | NOT IMPLEMENTED | §11 |
| Privé | LIVE-LOCAL, **demo only**, **APPROVED** (DEC-2026-038 Q6 → A; DEC-2026-040) | §10c. Always labelled demo; customer wording is the owner's to approve |
| Student, Event, Places, Cloud | NOT IMPLEMENTED | §11 |

## 12a. Administration (admin app; not the customer frontend)

| Operation | Status |
|---|---|
| `rpc('admin_list_emergency_events', { p_status?: text \| 'reported', p_limit?: 1–200, p_offset? })` → events with `userId`, statuses, `reportReason`, and per recipient `last4, status, attempts, provider, providerMessageId, providerStatus, lastError, attemptLog[]`. **No contact names, no full numbers.** Needs `support.read`; every call writes `admin_audit_log` `emergency.events.read` | LIVE-LOCAL; PROPOSED (DEC-2026-038; listed as PROPOSED in `test:admin-contract`) |
| `rpc('admin_list_rescue_reports', { p_limit?: 1–200, p_offset? })`: reported Return-to-Owner threads with `ownerUserId`, `reportReason` and messages. Needs `support.read`; audited `rescue.reports.read` | LIVE-LOCAL; APPROVED (DEC-2026-038 Q12) |
| Every other `admin_*` RPC | Unchanged; frozen admin contract (doc 12 §2) |

---

## 13. CHANGELOG

| Version | Date | Change | Frontend impact |
|---|---|---|---|
| v0.1 | 2026-10-19 | First publication. Existing operations documented as found on `4d730c4`. New: `/api/emergency` (§10), `security` notifications (§9), `admin_list_emergency_events` (§12a). Tap column guard (030) added to T-2. | New feature surface; no existing call changes. A browser draft must not include the eight server-managed columns (it does not today). |
| v0.8 | 2026-10-24 | **New: modes and Info** (DEC-2026-041 implementation scope; migration 034): §6 `POST /api/modes` (`owner.state`, `owner.activate`, `owner.info.get`, `owner.info.save`, `owner.info.clear`, `owner.preview`) and the public reader P-6 `get_public_tap_mode`. **Info is OFF in the catalogue by default**, because `get_public_profile` (P-1) is unchanged (BQ-1). No earlier operation changed. | May build the owner Modes / Info pages and the Info view against §6. Read P-6 first, falling back to P-1 if it is missing, and update `contract.test.ts`. Never show Business when P-6 returns null. No capability buttons on Info. Info cannot go live on a real database until SHYGON switches it on after BQ-1. |
| v0.7.2 | 2026-10-23 | Editorial: §10b's **Status** line now says what its host-switch bullet already said. Connect is visible to visitors only once the owner has `CONNECT_PUBLIC=on` set (A-1). No operation, request or response changed. | None. |
| v0.7.1 | 2026-10-23 | **B-10** (owner-approved, DEC-2026-039 amendment A-1): §10b host switch `CONNECT_PUBLIC`. While off, `public.status` is false and `requests.create` / `requests.accept` / `connections.share` answer 404 `unavailable` (create also for an anonymous caller). Decline, block, remove and the lists always work. `settings` gain `publicAllowed`. **B-9:** visitor emergency alerts and finder starts use only the header named by `TRUSTED_CLIENT_IP_HEADER` (no shape change). The local host sets the visitor address itself and offers the opt-in `x-shygon-sim-client` hook. `/__sim/switches` accepts `CONNECT_PUBLIC`. | Show the Connect card only when `public.status` is true (already the case). On the signed-in request page, check `public.status` before offering the form. Show "not yet available" when `publicAllowed` is false. A 404 on accept or share is a refusal, never success. E2E: a browser-sent `x-nf-client-connection-ip` no longer has any effect on the stack; use the sim header with `STACK_SIM_CLIENT_ADDRESS=1` for distinct visitors, and switch `CONNECT_PUBLIC` on through `/__sim/switches` for Connect journeys. |
| v0.7 | 2026-10-20 | DEC-2026-040 approved: every Privé demo choice as built; 033 listed as approved. No operation, request or response changed. | None beyond v0.6: the public walkthrough stays client-only (Q1 = A); signed-in demo requests use §10c; show the notice. |
| v0.6 | 2026-10-20 | Privé demo-only (owner's word, DEC-2026-038 Q6 → A): §10c `/api/prive` (migration 033, PROPOSED in DEC-2026-040); the sweep also runs the demo desk and its retention. No earlier operation changed. | Your demo may switch on and use §10c for signed-in accounts. Keep the public showroom walkthrough client-only (DEC-2026-040 Q1). Show the `notice` with every Privé result; never write "the hotel" for the simulator. |
| v0.5 | 2026-10-20 | DEC-2026-039 approved: every Connect choice as built; 032 listed as approved. No operation, request or response changed. | The Connect control may ship with the first release containing 032; its wording needs the owner's approval. No guest connect (Q1 = A). |
| v0.4 | 2026-10-19 | New: §10b `/api/connect` (Connect and the consent ledger, migration 032, PROPOSED in DEC-2026-039); `connect` notifications; the sweep now expires Connect requests; browser E2E hooks on the local stack (§1 rule 11). No earlier operation changed. | A Connect UI may be built against §10b, but must not ship until DEC-2026-039 is decided. Never show `blocked` to a requester (the API already maps it). Show shared values as self-reported. Revocation copy: "already-copied details cannot be un-shared". |
| v0.3 | 2026-10-19 | DEC-2026-038 approved: statuses updated (029/030/031 APPROVED, not applied); Q2 visitor alerts off; Q6 Privé out; Q11 Emergency Profile = presentation of `public.status`, no new endpoint. MSG91 delivery reports (`/api/sms-status?provider=msg91`): `deliveryReceipts` can now be `supported` with MSG91. Operator smoke script. No request or response shape changed. | Showroom copy for Emergency and Return to owner: draft it for the owner's approval (Q10). Privé: not shown. Emergency Profile: build it on `public.status`; hidden while it says `false`. |
| v0.2 | 2026-10-19 | New: §10a `/api/rescue` (Return-to-Owner relay, migration 031); `rescue` notifications (§9); `admin_list_rescue_reports` (§12a); the capability matrix. §11 now lists Emergency Profile as NOT IMPLEMENTED (Q11). No v0.1 operation changed. | New routes: `/shygontap/return-to-owner` (owner inbox) and a finder flow on `/t/:slug`. The finder token goes in `sessionStorage` or the URL fragment only. Show the relay control only when `public.status` says `available`. |
