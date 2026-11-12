# DEC-2026-045: Account phone verification (V01 task T-11; finding F4)

| Field | Value |
|---|---|
| Decision ID | DEC-2026-045 |
| Title | How an owner proves the account phone is theirs, and which SMS features may then use it |
| Date opened | 2026-11-05 |
| Domain | Security (a factor that authorises card actions; finding F4, DEC-2026-005); Privacy (texting a number); Operations (a new SMS template) |
| Level | **L3**: new closed tables, privileged functions, and a stricter rule in `card-otp`, which authorises card activation and deactivation. DEC-2026-018: a 24-hour cool-off and the checklist before any real database |
| **Accountable Owner (A)** | The repository owner (the founder), for the product choices. **The SMS template's DLT registration and the provider account are the adult authorised signatory's (F-2, F-10), not the founder's** |
| Responsible (R) | Session A (backend): the migration, the operations, the change to `card-otp`, the contract and the tests. Session B (frontend): the verify-your-phone screen and the card page's new refusal |
| Consulted | The coordination session (V01 task registry T-11); Session B |
| State | **APPROVED FOR THE LOCAL BUILD, 2026-11-05.** The owner, in Session A's session: "Approve T-11 build", answering "Approve building T-11 locally on DEC-2026-045's recommended answers?". Q1–Q6 are therefore as recommended (§5), which also answers DEC-2026-022 Q3: this is the start of the verified-contact model (M1.3), limited to the account phone; existing accounts verify once, with no grandfathering. Local only: nothing is applied, pushed or deployed. The DLT template and the provider stay with the adult signatory (F-2, F-10). History: PROPOSED 2026-11-05 (`374babc`) |

Labels: **OBSERVED** (in this repository or a decision record), **INFERRED** (reasoned, not tested), **PROPOSED**.

## 1. Question

`profiles.phone` is typed by the customer and never checked. Two features text it today. The Version 01 scope says the account phone must be verified, by a one-time code, "before any SMS feature uses it". How is it verified, where is that recorded, what happens when the number changes, and which features must then refuse an unverified number?

## 2. What is already decided or observed [OBSERVED]

- **Scope.** F-1 (2026-11-02, "Approve F-1") puts "Verified phone + step-up" in V01 as **"phone verify only"**: "OTP to the account phone before any SMS feature uses it", from finding F4. Step-up authentication is not in V01.
- **Finding F4** (`docs/shygon-os/01_V5_ARCHITECTURE_AUDIT.md`, severity H): "`card-otp` texts a code to `profiles.phone`, which the customer can edit freely and is never verified. A stolen session can change the phone number, then 'confirm' a card deactivation/activation with an OTP sent to the attacker." The audit's suggested fix: "a phone becomes trusted only after OTP on the *new* number, with notice to the old one and a cool-down before it can authorize high-risk actions."
- **DEC-2026-022 Q3 is still open:** "Is F4 an interim control or the start of M1.3? What is the trusted factor for existing users with no verified phone?" Until it is answered, `card-otp`, auth and the card RPCs must not change. This record asks the owner to answer it (Q1, Q4).
- **The account phone is texted today in two places:**
  - `netlify/functions/card-otp.mjs`: the card activation and deactivation code goes to `profiles.phone`;
  - `netlify/lib/orderMessages.mjs`: an order confirmation goes to `orders.shipping_phone`, or to `profiles.phone` when the order has none.
- **Not texted today:** Emergency alerts go to contacts, each already verified by a code (029). Return to Owner tells the owner in the app only, because the phone is unverified (DEC-2026-038; capability matrix §2).
- **A proven pattern exists** (029, contact verification). The server generates a 6-digit code and stores only its HMAC (`OTP_SECRET`). The rules are a 45-second gap between sends, 5 sends per account per hour, 3 per number per 24 hours, one open code, 10-minute expiry, 5 attempts and single use. The code is retired if the text is not sent. `card-otp` follows the same rules.
- **SMS is not configured anywhere** (DEC-2026-038 Q3: MSG91 + DLT; F-10). Locally, the SMS simulator stands in. `OTP_DEV_MODE` returns the code only off production.

## 3. Options

| Option | What | Assessment |
|---|---|---|
| **A (recommended)** | A **closed table records the verified number** (`account_phone_verifications`: the account, the number in E.164, the time). The account phone counts as verified only while the current `profiles.phone`, in E.164, equals that number. Editing the phone therefore unverifies it, with no trigger, because nothing in `profiles` changes meaning | Closed to clients, like every AAROH table. `profiles` stays client-writable (O-2), with no column to guard. Admin outputs are untouched; `admin_get_customer` whitelists its profile fields [OBSERVED] |
| B | A `phone_verified_at` column on `profiles` | Clients can write `profiles` (O-2). The column would need a write guard like 030, plus a trigger to clear it on every phone edit. More moving parts in a table the browser writes |
| C | Use Supabase Auth's phone sign-in (GoTrue phone OTP) | It changes authentication itself (sign-in methods, `auth.users.phone`), which is outside V01 "phone verify only". It needs Supabase's own SMS provider setup |

## 4. The proposed design (option A) [PROPOSED]

### 4.1 Model (migration 039)

- **`account_phone_verifications`**: `user_id` (PK, references `auth.users`), `phone_e164`, `verified_at`, `replaced_at` (when this record replaced an earlier verified number). Closed: RLS on, no policies, service only.
- **`account_phone_challenges`**: `id`, `user_id`, `phone_digest` (SHA-256 of the E.164 number, for the per-number limit), `phone_last4`, `code_hash` (HMAC), `attempts`, `expires_at`, `consumed_at`, `created_at`. Closed. Retention: deleted 24 hours after creation, as 029's purge does with contact codes. That is exactly as long as the per-number limit needs.
- **Functions** (service_role only), following 029: `account_phone_state`, `account_phone_start`, `account_phone_abort`, `account_phone_confirm`. Refusals are values, not exceptions, so a wrong guess still counts.
- **E.164** is computed in one place, by `toE164` in `netlify/lib/sms.mjs`, which `card-otp` and the emergency functions already use. The database receives the E.164 number and compares it exactly.

### 4.2 Operations (on `/api/account`, contract §4b)

| op | Request | Success | Refusals |
|---|---|---|---|
| `phone.status` | `{ op }` | `{ phone: masked or null, verified, verifiedAt, usableFrom }`. `usableFrom` is when a newly changed number may confirm card actions (§4.3) | — |
| `phone.verify.start` | `{ op }`. It always verifies the phone now on the account, never a number in the body | `{ phoneMasked, expiresAt, resendAfter }` (+ `devCode` only with `OTP_DEV_MODE` off production) | `no_phone`, `invalid_phone`, `already_verified`, `verify_cooldown` (+`retryAfter`), `rate_limited`, `number_rate_limited`, 503 `sms_unavailable` (no code is pretended to be sent) |
| `phone.verify.confirm` | `{ op, code }` | `{ verified: true, verifiedAt, usableFrom }` | `no_challenge`, `wrong_code` (+`attemptsLeft`), `code_expired`, `too_many_attempts`, `phone_changed` (the account phone was edited after the code was sent) |

The account comes only from the verified token. No answer or log holds the full number or the code.

### 4.3 When the number changes (Q3)

- Editing a verified phone makes it unverified at once (option A).
- When a **different** number is later verified to replace an earlier verified one, it may **confirm card actions only after 24 hours** (`usableFrom`). It can receive non-sensitive texts at once. A stolen session that swaps the number cannot use it to move a card the same day.
- The owner gets an **in-app notification and an `account_events` row** ("your verified phone changed"). A text to the old number is **not** sent in V01: it would need its own DLT template, and the old number may no longer be the owner's. This is the audit's "notice to the old one", recorded as a V02 item.

### 4.4 Which features use it (Q2)

- **`card-otp` (F4):** a code is sent only to a **verified** account phone that is past its 24-hour wait. Otherwise the request is refused, nothing is sent, and the card page sends the owner to "verify your phone":
  - 409 `phone_not_verified`, or 409 `phone_cooling_down` with `retryAfter`;
  - `card-otp` keeps its legacy `{ error: '<text>' }` shape and adds `code`.
- **Order confirmation SMS:** still sent to the order's `shipping_phone`, a number the buyer gave for that order. The fallback to `profiles.phone` is used **only when that phone is verified**.
- **Return to Owner and Emergency:** they do not text the owner today. Any future owner text needs a verified phone; the contract says so.
- **The vCard and the public Tap** are unaffected: `tap_profiles.phone` is a separate public field the owner chooses to show.

### 4.5 The SMS text (Q5)

A new DLT template, `MSG91_PHONE_VERIFY_TEMPLATE_ID`, with one variable:

> "SHYGON: ##otp## is your code to verify this phone number for your SHYGON account. It expires in 10 minutes. Do not share it with anyone."

The owner approves the wording. **Registering it on DLT is the adult authorised signatory's task (F-2, F-10).** Until it is registered and a provider is configured, `phone.verify.start` answers 503 `sms_unavailable`. That also means **`card-otp` stops working for every account until verification can be sent** (Q4).

### 4.6 Tests (`test:phone-verify`, in `ci`)

1. **Closure:** both tables closed to all 7 callers (RLS matrix); functions service-only (admin-contract).
2. **The happy path** on the local stack with the SMS simulator: start, the text is sent once (the simulator records it), confirm, `verified: true`.
3. **Every refusal** in §4.2, the limits (cooldown, 5 per hour, 3 per number per day, 5 attempts, expiry, single use), and abort when the send fails.
4. **Editing the phone unverifies it.** A code sent before an edit cannot verify the new number (`phone_changed`).
5. **The 24-hour wait** after replacing a verified number: `usableFrom`, the notification and the `account_events` row.
6. **`card-otp`:** refused while unverified or waiting; sent once verified; a stolen-session simulation (change the phone, verify it) cannot confirm a card action within 24 hours. This is a negative control against today's `card-otp`.
7. **Order SMS:** no fallback to an unverified account phone.
8. **Canaries:** no full number, code or hash in any answer or log.
9. **Export parity (T-10):** `account_phone_verifications` exported (number masked to the last 4 digits and dates); challenges excluded (security). `docs/runbooks/account-deletion.sql` deletes both, and `test:account-deletion` covers it.

## 5. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | How is it built? (This also answers DEC-2026-022 Q3: "interim, or the start of M1.3?") | **A**, as the start of the verified-contact model (M1.3), limited to the account phone. Step-up authentication stays later, as F-1 says |
| Q2 | Which features require a verified phone in V01? | **`card-otp`** (F4), and the **order SMS fallback**; every future owner text by rule |
| Q3 | What happens when a verified number is replaced? | **A 24-hour wait before it can confirm card actions**, plus an in-app notice and an account history entry. No text to the old number in V01 |
| Q4 | Existing accounts with an unverified phone (DEC-2026-022 Q3, "the trusted factor for users with no verified phone") | **No grandfathering.** Each account verifies once, with a code sent to its current phone, before its next card action. The first verification has no 24-hour wait, because no earlier verified number exists to protect. Consequence: card activation and deactivation pause everywhere until the SMS template is registered (F-10). No AAROH card is sold yet (DEC-037), so V01 is not affected; V5 cards on a future V6 deployment would be |
| Q5 | The SMS wording in §4.5 | As drafted; the adult signatory registers it on DLT |
| Q6 | Limits | As 029 and `card-otp`: 45 s between sends, 5 per hour per account, 3 per number per 24 hours, 10-minute codes, 5 attempts |

## 6. Not affected

Sign-in and sign-up (Supabase Auth) are unchanged. `profiles.phone` stays editable by the owner, exactly as today. No public output changes (golden). Emergency contacts keep their own verification (029). No host switch is added: verification simply answers `sms_unavailable` until a provider exists.

## 7. What the owner approves

To build locally: "Approve T-11 local build" (Q1–Q6 as recommended), or the answers that differ. Session A then writes:
- migration 039 and the `/api/account` phone operations;
- the `card-otp` and order-SMS rules;
- contract v0.13 (§4b, §7 C-2);
- `test:phone-verify`, plus updates to the deletion procedure, the export-parity map and the RLS matrix.

It then runs the full gates, commits locally and tells Session B. Nothing is applied, pushed or deployed. The DLT template and the provider stay with the adult signatory.

## 8. As built (2026-11-05, local)

Built on `v6/aaroh-backend` to §4 with Q1–Q6 as recommended; readiness report §24 has the evidence. Nothing is applied, pushed or deployed, and no real number was texted: every text went to the local stack's SMS stand-in.

- **Migration 039:**
  - two closed tables;
  - `account_phone_state`, `_start`, `_abort`, `_confirm` and `_purge`, service-only, under a per-account advisory lock;
  - `account_export_build` (038) gains `phoneVerification`. 039's ROLLBACK restores 038's text verbatim; the migration is generated from 038's own text with anchored edits.
- **`/api/account`** has `phone.status`, `phone.verify.start` and `phone.verify.confirm`. `card-otp` sends only to a verified phone past its wait. `orderMessages` falls back to the account phone only when it is verified. The local stack sets `MSG91_PHONE_VERIFY_TEMPLATE_ID` for its MSG91 stand-in.
- **Deletion and export:**
  - `docs/runbooks/account-deletion.sql` deletes both tables;
  - the T-10 parity gate classifies them: verifications exported (last 4 digits), codes excluded.
- **Contract AAROH-API v0.13:** §4b, §7 C-2, §4a `phoneVerification`.
- **Differences from the §4 sketch:**
  - the per-account hourly limit is `verify_rate_limited`, so its message differs from the export's `rate_limited`;
  - `phone.status` adds `phoneValid`;
  - there is no `devCode`: locally, the SMS stand-in receives the text, as for the emergency contacts;
  - an unsent text answers 502 `sms_failed`.
- **`test:phone-verify` 12,** in `ci` and `ci.yml`. The order-text unit test now covers both fallbacks (verified: sent; unverified: `unverified_phone`, nothing sent).
  - **Negative control** [OBSERVED]: against the committed `card-otp` and `orderMessages` (`374babc`), 3 checks failed. Unverified: `card-otp` answered 200 and texted. Stolen session: it texted the swapped-in number at once. Order text: it went to an unverified number.
- **Residual risk, recorded:** an account that has **never** verified a phone has no earlier number to protect. A stolen session can set and verify its own number and then confirm card actions without the 24-hour wait. Q4 accepted this (no grandfathering, first verification without a wait). Step-up authentication, later than V01 per F-1, closes it.
- **For the admin app:** an order's `confirmation_sms_status` may now read `unverified_phone`.
