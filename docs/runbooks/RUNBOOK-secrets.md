# RUNBOOK: credential rotation (DEC-2026-001 / SEC-1, doc 12 M0.5 switch K10)

> **Status:** prepared 2026-10-05 for SHYGON V6 (DEC-2026-035, D-1). **Nothing has been rotated.** Rotation is a **V6 release requirement**. It is done by a human, at a time the owner authorizes.
> **Never** paste, print, log or commit a secret value. That includes this file, chat, commit messages, CI logs and screenshots. Every check below reports a status or a key *mode*, never a value.

## 1. What to rotate (inventory from the code, 2026-10-05)

| # | Credential (env name) | Secret? | Where it is used | Where it is set |
|---|---|---|---|---|
| S1 | `SUPABASE_SERVICE_ROLE_KEY` | **Yes, critical** (bypasses RLS) | `netlify/functions/*`, `api/*` (via `netlify/lib/supabase.mjs`); the admin edge functions; **also the card-OTP HMAC fallback** when `OTP_SECRET` is unset (`netlify/functions/card-otp.mjs:54`) | Hosting env (Vercel; Netlify if used); Supabase injects it into edge functions |
| S2 | `VITE_SUPABASE_ANON_KEY` | No (public by design) | Browser bundle | Hosting env (build time) |
| S3 | `RAZORPAY_KEY_SECRET` (+ `RAZORPAY_KEY_ID`) | **Yes** | `create-order`, `verify-payment`, `razorpay-webhook` capture; edge `admin-refund` | Hosting env; Supabase edge-function secrets |
| S4 | `VITE_RAZORPAY_KEY_ID` | No (public) | Browser checkout. **Must equal** the server `RAZORPAY_KEY_ID` | Hosting env (build time) |
| S5 | `RAZORPAY_WEBHOOK_SECRET` | **Yes** | `razorpay-webhook` HMAC | Hosting env and the Razorpay dashboard webhook |
| S6 | `OTP_SECRET` | **Yes** | Card-OTP code hashing | Hosting env. **Set it explicitly** so OTP hashing no longer depends on S1 |
| S7 | `TWILIO_AUTH_TOKEN` (+ `TWILIO_ACCOUNT_SID`) / `MSG91_AUTH_KEY` | **Yes** | Order and OTP SMS (`netlify/lib/sms.mjs`) | Hosting env |
| S8 | Database password (`postgres`) | **Yes** | Not used by the app; human SQL access only | Supabase dashboard |
| S9 | Web3Forms access key | No (public by design; DEC-2026-020) | Contact form | Source |

**Scope of DEC-2026-001:** S1 and S3/S5 for certain. Also rotate S6–S8 if any project archive (`*.zip`) containing a `.env` ever left the machine; that history is still unestablished. Generate **live** Razorpay keys fresh at G-PAY time; never reuse test-period material.

## 2. Before you start
1. Owner authorization recorded in session ("rotate now").
2. Choose a quiet window. Rotating S1 under Supabase's legacy JWT keys also changes S2 and **signs every user out**.
3. Have access to: the Supabase dashboard, the Razorpay dashboard, the hosting dashboard(s), and the SMS provider.
4. Keep live payments OFF throughout (`/api/payment-mode` must stay `test`).

## 3. Order of operations
Rotate one credential at a time. Verify after each one (§4) before moving to the next.

1. **S6 `OTP_SECRET`:** generate a fresh random value, set it in hosting env, redeploy. (Existing card OTPs expire; that is acceptable.)
2. **S1 + S2, Supabase keys.**
   - If the project uses the newer API keys: create a new secret key, set it as `SUPABASE_SERVICE_ROLE_KEY` everywhere, redeploy, verify, then **revoke the old secret key**.
   - If it uses the legacy JWT keys: rotate the JWT secret. This issues a new anon and service_role key and invalidates all sessions. Update S1 and S2 everywhere and redeploy (S2 is baked into the bundle).
   - Edge functions pick up S1 automatically. Re-deploy them if the dashboard says so.
3. **S3 + S4, Razorpay API keys (test mode now; live only at G-PAY).** Generate a new key pair, set `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` (server) and `VITE_RAZORPAY_KEY_ID` (build), update the edge-function secrets, redeploy, verify, then delete the old key pair in Razorpay.
4. **S5, webhook secret.** In the Razorpay dashboard set a new secret on the webhook, set `RAZORPAY_WEBHOOK_SECRET`, redeploy, then use the dashboard's test webhook.
5. **S7, SMS provider tokens.** Regenerate at the provider, update env, redeploy.
6. **S8, database password.** Reset in Supabase. Update any human tooling that stored it. The app does not use it.
7. **Archives:** move every project `*.zip` containing a `.env` off shared or synced locations. The owner decides about deleting them, because it is irreversible.

## 4. Verification after each step (no value is ever printed)

| Check | How | Expected |
|---|---|---|
| Key mode | `GET /api/payment-mode` | `test` (never `live` before G-PAY) |
| Sign-in | Sign in with a test account | Works; the dashboard loads |
| Old key revoked | A request with the **old** key from a script that prints only the HTTP status | 401 |
| Test-mode purchase | Buy a digital experience in Razorpay test mode | Order `paid`, fulfilment `fulfilled`, entitlement granted; first purchase creates a **draft** Tap; notification "Your SHYGON Tap draft is ready" |
| Webhook | Razorpay dashboard → send test event | Function returns 2xx; a wrong-signature request is rejected 401 (covered by `netlify/tests/functions-security.mjs`) |
| SMS | Order confirmation on the test purchase | One SMS recorded (`orders.confirmation_sms_status`) |
| OTP | Request a card OTP in test (card release only) | Code delivered; verifies |
| Repository | `npm run test:secrets` (full history) | No new finding (the known `9c8caa7` public-key finding is governed by DEC-2026-020) |
| Bundle | `dist/` contains no service key | Search the build output for the service-key **prefix pattern only**; expect no match |

## 5. Record it
In `docs/governance/decisions/DEC-2026-001_credential-exposure-rotation.md`, "Rotation completed", record: date, who, **which credential names** were rotated, and the verification results above. **No values.** Then close the V6 release requirement (B-1 in `docs/v6/backlog.md`).

## 6. If something breaks
- **Payments fail after S3:** the browser and server key ids differ (S4 ≠ S3). Fix the env and redeploy. Never fall back to old keys.
- **Every request is 401 after S1/S2:** the bundle still has the old anon key. Redeploy the frontend.
- **Webhook 401s after S5:** the dashboard secret and env differ. Razorpay retries, and fulfilment is idempotent (`webhook_events` ledger), so nothing is lost once they match.
