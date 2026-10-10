# Production configuration (SHYGON V6 release candidate)

Everything production needs to be set, in one place. Values are never written here: each setting says where it is set and what it must be. `.env.example` has the same list with comments. **Never paste a secret value into a file, chat, ticket or log** (`docs/runbooks/RUNBOOK-secrets.md`).

## 1. Hosting (Netlify or Vercel, one of them: V6-043)

Both hosts run the same code. `netlify.toml` (Netlify: `netlify/functions/*`) and `vercel.json` (Vercel: `api/*.mjs`) carry the same page rewrites and the same security headers; the build fails if they differ.

| Setting | Value |
|---|---|
| Build command | `npm run build` (`tsc -b && vite build`) |
| Publish directory | `dist` |
| Node | 22 (`.nvmrc`; `package.json` engines `>=22.12.0`). The local verification ran on Node 20.18, with one check blocked (Node 22 only) |
| Security headers | From `vercel.json` / `netlify.toml` (CSP, HSTS, `nosniff`, `X-Frame-Options: DENY`, referrer policy, permissions policy). Verified by `npm run test:security` |
| Compression | The host's default (brotli/gzip). The performance gate measures with brotli |

## 2. Environment variables

### Build time (inlined into the browser bundle: public by design)

| Variable | Production value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | the project URL | |
| `VITE_SUPABASE_ANON_KEY` | the anon (publishable) key | Public; RLS guards every table. `test:bundle-secrets` fails the build if any other key is inlined |
| `VITE_RAZORPAY_KEY_ID` | `rzp_test_…` until G-PAY (B-3) | Must equal the server `RAZORPAY_KEY_ID`. `test:bundle-secrets` refuses a `rzp_live_` key unless `LIVE_PAYMENTS_APPROVED=true` |
| `VITE_SITE_URL` | **unset** (defaults to `https://shygontech.com`) | Baked into every QR and shared Tap link. The build refuses localhost, LAN or plain-http values |
| `VITE_CARD_SALES_ENABLED` | **unset** (card sales closed, D-10) | `true` only at the card release, together with `CARD_SALES_ENABLED` |

### Server only (functions; never prefixed `VITE_`)

| Variable | Notes |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Every function answers 503 without them. **Rotate before launch (B-1)** |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Test keys until G-PAY. Live keys are generated fresh at G-PAY |
| `RAZORPAY_WEBHOOK_SECRET` | From the Razorpay dashboard webhook (not the API secret) |
| `OTP_SECRET` | Long random value. Set it explicitly, so card-OTP hashing does not fall back to the service-role key |
| `SMS_PROVIDER` and its keys | `msg91` (`MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_ORDER_TEMPLATE_ID`, …) or `twilio` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` / `TWILIO_MESSAGING_SERVICE_SID`). Optional: without them, order texts are recorded as `not_configured` |
| `CARD_SALES_ENABLED` | **Unset** in the RC: `create-order` refuses card orders (409) |
| `SHIPROCKET_*` | Optional (delivery estimates, card release only) |
| `ALLOW_LIVE_PAYMENTS_LOCALLY`, `OTP_DEV_MODE`, `ALLOW_LOCAL_SITE_URL` | **Never set in production** (local development only) |

Check after deploy: `GET /api/health?deep=1` answers `200 {"status":"ok"}`. A missing setting answers `503 "degraded"` and is named only in the function log (`health.config-missing`).

## 3. Supabase project

| Area | Setting |
|---|---|
| Database | Live baseline + migrations **020–026** applied (`DEPLOYMENT.md` §3), after each one's VERIFY ON LIVE queries and the DEC-2026-018 cool-off |
| Auth | Site URL `https://shygontech.com`, and the domain on the Redirect URLs allow-list (`PRODUCTION.md` §4.1 step 3). The only `redirectTo` the app sends is `https://shygontech.com/shygontap/settings` (password reset, `Auth.tsx` and `Settings.tsx`); Supabase refuses one that is not on the list. Email confirmation and password policy are project settings (V6-036: align the client's 6-character minimum with the project's) |
| Storage | Bucket `profile-images`: public; image types only; a size limit; writes only to the caller's own `<user id>/` folder. **VERIFY ON LIVE (V6-095):** queries in `PRODUCTION.md` §7 |
| Edge functions | `admin-refund`, `admin-push`. Secrets `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (Supabase injects the URL and service key) |
| Backups | Point-in-time recovery enabled, retention noted in the deployment record |

## 4. Razorpay

| Setting | Value |
|---|---|
| Mode | **Test** until the owner authorizes G-PAY (B-3). `GET /api/payment-mode` must answer `test` |
| Webhook URL | `https://shygontech.com/api/razorpay-webhook` |
| Webhook events | `payment.authorized`, `payment.captured`, `order.paid`, `payment.failed` (the list in `netlify/functions/razorpay-webhook.mjs`) |
| Webhook secret | Same value as `RAZORPAY_WEBHOOK_SECRET` |

## 5. What is not configured on purpose

- **Error tracking provider:** none. Client errors raise `shygon:error`; choosing a provider is an owner decision (`docs/v6/observability.md`).
- **Email channel:** none (V6-038). Customers are notified in the dashboard, and by SMS when it is configured.
- **Card sales:** closed (D-10).
