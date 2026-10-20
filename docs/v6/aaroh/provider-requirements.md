# Emergency notification provider: requirements (AAROH backend, 2026-10-19)

**State: live delivery BLOCKED.** The integration is complete and tested against a local stand-in (`supabase/local/sms-sim.mjs`). No provider is configured on any SHYGON host, and nothing has ever been sent to a real phone. This file lists exactly what a human must provide. No credential value is written here, ever.

## 1. What exists (OBSERVED in the repository)

| Channel | Code | State |
|---|---|---|
| SMS via **MSG91** (India, DLT) | `netlify/lib/sms.mjs` (shared with the card OTP and order confirmation) | Integrated; not configured |
| SMS via **Twilio** | the same file | Integrated; not configured |
| Delivery receipts | `netlify/functions/sms-status.mjs`: Twilio (signature-verified) and, since 2026-10-19 (V6-114), MSG91 (`?provider=msg91`, secret header) | Integrated; not configured |
| Email, WhatsApp, push to customers | none | NOT IMPLEMENTED (DEC-2026-031 is still PROPOSED) |

The emergency module reuses this SMS layer. **No new provider was introduced.** Choosing between MSG91 and Twilio, or another provider, is the owner's decision (DEC-2026-038 Q3, extending DEC-2026-031).

## 2. Settings: server-side only

Set them in the host's environment (Netlify and/or Vercel). **Never prefix them `VITE_`**: Vite inlines `VITE_*` into the browser bundle, and `npm run test:bundle-secrets` fails the build if a secret reaches `dist/`.

| Variable | Needed for | Notes |
|---|---|---|
| `SMS_PROVIDER` | everything | `msg91` or `twilio`. Unset means every send is refused as `not_configured` (verification 503; alerts recorded `not_sent`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | the function's database access | Already required by the other functions. Rotation B-1 first |
| `OTP_SECRET` | HMAC of verification codes and visitor digests | Recommended; falls back to the service key, like card-otp. Rotating it invalidates open codes only |
| **MSG91:** `MSG91_AUTH_KEY` | MSG91 | From the MSG91 panel |
| `MSG91_EMERGENCY_VERIFY_TEMPLATE_ID` | contact verification | DLT template with variables `##name##` (owner name) and `##otp##` (code). Names configurable: `MSG91_EMERGENCY_NAME_VAR`, `MSG91_OTP_VAR` |
| `MSG91_EMERGENCY_OWNER_TEMPLATE_ID` | owner-initiated alert | Variables `##name##`, `##time##` (`MSG91_EMERGENCY_TIME_VAR`) |
| `MSG91_EMERGENCY_PUBLIC_TEMPLATE_ID` | visitor-initiated alert | Variables `##name##`, `##time##` |
| **Twilio:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID` | Twilio | An India sender also needs Twilio's India DLT registration |
| `MSG91_DLR_SECRET` | MSG91 delivery reports | A random value of 32 or more characters. In MSG91: SMS > Webhook (New) > event "On Report Received", URL `https://<production host>/api/sms-status?provider=msg91`, content type JSON, custom header `x-shygon-dlr-secret: <the same value>`. MSG91 does not sign webhooks, so this header is the only proof a report came from your MSG91 account. Without it, alerts stay `sent` (unconfirmed) |
| `SMS_STATUS_CALLBACK_URL` | Twilio delivery receipts | Exactly `https://<production host>/api/sms-status`. The signature is checked against this exact string, so it must match the public URL character for character. Without it, alerts stay `sent` (unconfirmed) |
| `EMERGENCY_PUBLIC_ALERTS` | visitor-initiated emergency alerts | **Leave unset** (off) until DEC-2026-038 Q2. `on` enables them |
| `RESCUE_RELAY` | the Return-to-Owner relay's finder side (`/api/rescue`) | **Leave unset** (off) until DEC-2026-038 Q12. `on` enables it. The relay needs no SMS provider: owner notices are in-app |
| `CRON_SECRET` | `/api/emergency-dispatch` (it also runs the relay's retention) | A random value of 32 or more characters. The host's scheduler sends it as `Authorization: Bearer …`. Without it the sweep refuses to run, and retries happen only when the owner presses retry |

## 3. DLT (India): the template wording to register

MSG91 sends only pre-approved templates. The texts used with Twilio are below; register the MSG91 templates with the same wording, the variables shown, and the sender ID. The SMS **category** is a compliance choice for the owner, not engineering.

1. **Verification:** "SHYGON: ##name## wants to add you as an emergency contact. If you agree, give them this code: ##otp##. It expires in 10 minutes. If you do not know them, ignore this message."
2. **Owner alert:** "SHYGON emergency alert: ##name## has asked for help and wants you to contact them now (sent ##time## IST). SHYGON does not contact emergency services. If they are in danger, call 112."
3. **Visitor alert:** "SHYGON emergency alert: someone using ##name##'s SHYGON profile reported an emergency at ##time## IST. SHYGON cannot confirm it. Try to reach ##name## directly. If they may be in danger, call 112."

`##name##` is the owner's own name, reduced by the database to letters, spaces and `.'-` (30 characters at most). It can carry no link.

## 4. Scheduling (retries and retention)

`POST /api/emergency-dispatch` with `Authorization: Bearer $CRON_SECRET`, **every minute**.
- **Netlify:** a scheduled function, or an external scheduler calling the URL.
- **Vercel:** a cron in `vercel.json`. Per-minute schedules need a paid plan, and Vercel sends `CRON_SECRET` automatically.

This depends on the single deploy target (V6-043, open). Until it is scheduled:
- retries happen only when the owner opens the alert and presses retry (`alerts.retry`);
- retention (`emergency_purge`) does not run.

## 5. Delivery semantics, per provider (what "sent" and "delivered" mean)

| Provider | "accepted" (status `sent`) | "delivered" | Failure receipts |
|---|---|---|---|
| Twilio | HTTP 201 from the Messages API (`sid`, `queued`) | Only from a signed status callback `delivered` (or `read`) | `undelivered`, `failed` (+ `ErrorCode`) |
| MSG91 | `{"type":"success"}` with a request id | Only from a "Report Received" webhook with status `1`, carrying the secret header | `2` failed, `9` NDNC, `16`/`25` rejected, `17` blocked number, `20` country blocked (stored as fixed codes, never MSG91's free text). `0` sent changes nothing. That the report's `requestId` equals the send's request id is INFERRED from MSG91's docs; the smoke test confirms it |

A provider accepting a message does not prove it was received or read. The API and the contract say so.

## 6. Human actions required (none can be done by Session A)

1. **Owner:** decide DEC-2026-038 Q3 (provider) and Q2 (visitor alerts in production).
2. **Owner or operator:** create the provider account. For MSG91: register the three DLT templates and the sender ID. For Twilio: India sender registration.
3. **Operator:** set the §2 variables on the production host (after the B-1 rotation), plus `CRON_SECRET` and the schedule (§4).
4. **Operator:** the supervised smoke test (`scripts/release/emergency-smoke.mjs`; DEC-2026-038 Q2 asks for supervised owner alerts before visitor alerts are reconsidered). It runs with your own session token and your own second phone. It sends one verification text and, after you type SEND, one alert, then follows the status until a receipt arrives. It prints evidence with no number, code or token, and removes the contact. Record the evidence plus your eyewitness check of the received text.
5. **Until then the feature stays BLOCKED for live delivery.** The UI must show `providerConfigured: false` honestly.
