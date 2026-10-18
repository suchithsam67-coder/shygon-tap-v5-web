# ARCHITECTURE_MAP

Labels: `VERIFIED IN CURRENT CHECKOUT` · `VERIFIED BY CURRENT TEST` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

Paths are relative to the repo root. Unless stated, paths refer to the **V5 baseline** tree (`8becea3`, this worktree) and the **rebaseline** tree (`4d730c4`, `shygon-tap-v5-web-rebaseline`). Where they differ, both are noted.

## 1. Stack

| Layer | Evidence | Label |
|---|---|---|
| Vite + React 19 + TypeScript SPA | `package.json` (scripts `dev`, `build`), deps `react ^19.2.0`, `react-router-dom ^7.18.2`, `vite ^7.3.1`, `typescript ~5.9.3` | VERIFIED IN CURRENT CHECKOUT |
| Entry point | `src/main.tsx`; app shell `src/App.tsx` | VERIFIED IN CURRENT CHECKOUT (files present) |
| Styling | Tailwind v4 (`@tailwindcss/vite`), plain CSS in `src/styles/*.css` and `src/index.css` | VERIFIED IN CURRENT CHECKOUT |
| Motion | `framer-motion ^12.35.0` | VERIFIED IN CURRENT CHECKOUT |
| Backend | Supabase (Postgres, Auth, Storage, Edge Functions in `supabase/functions/`) plus Netlify Functions (`netlify/functions/*.mjs`) and a parallel `api/*.mjs` set | VERIFIED IN CURRENT CHECKOUT |
| Node engine | `>=22.12.0` | VERIFIED IN CURRENT CHECKOUT |

## 2. Routing and public profile rendering

- `src/App.tsx` line 39: `<Route path="/t/:username" element={<PublicTap />} />`
- `src/App.tsx` line 40: `<Route path="/tap/:username" element={<PublicTap />} />`
- `src/App.tsx` line 42: catch-all `path="*"` (NotFound).
- `PublicTap` is `src/pages/PublicTap.tsx`. It reads through `src/lib/publicTapClient.ts`. VERIFIED IN CURRENT CHECKOUT (files); the read path itself was not traced line by line — UNVERIFIED.
- Other customer pages in `src/pages/`: `Home`, `Auth`, `Account`, `Cards`, `Checkout`, `Customize`, `Customizations`, `Orders`, `Support`, `Notifications`, `Settings`, `Tiers`, `TapEditor`, `TapQr`, `ShygonTap`, `Analytics`, legal pages (`src/pages/legal/`), store pages (`src/pages/shygontap/Store.tsx`, `ProductDetail.tsx`).
- The `/shygontap/` slug path appears in deployed JavaScript on www.shygontech.com (not in this repo). See [PRODUCTION_DRIFT.md](PRODUCTION_DRIFT.md) §4.

## 3. Authentication and session handling

| Concern | Location | Label |
|---|---|---|
| Client | `src/lib/supabase.ts` line 1 (`createClient` import), line 31 (`createClient(supabaseUrl, supabaseAnonKey, { ... })`). URL and anon key from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (names only; values not read). | VERIFIED IN CURRENT CHECKOUT |
| Session context | `src/lib/auth.tsx` line 27 (`getSession`), line 38 (`onAuthStateChange`), line 68 (`getSession`) | VERIFIED IN CURRENT CHECKOUT |
| Email + password sign-in / sign-up / reset | `src/pages/Auth.tsx` line 71 (`resetPasswordForEmail`), line 84 (`signUp`), line 103 (`signInWithPassword`) | VERIFIED IN CURRENT CHECKOUT |
| Password change / reset from settings | `src/pages/Settings.tsx` line 133 (`updateUser({ password })`), line 151 (`resetPasswordForEmail`) | VERIFIED IN CURRENT CHECKOUT |
| Protected routes | `src/components/app/ProtectedRoute.tsx` | VERIFIED IN CURRENT CHECKOUT (file); guard logic UNVERIFIED |
| OTP for card activation | `supabase/migrations/015_card_otp_activation.sql`; Netlify `netlify/functions/card-otp.mjs`; `netlify/lib/sms.mjs` | VERIFIED IN CURRENT CHECKOUT (files) |
| Email/phone OTP sign-in flow (historical requirement) | Historical requirement only; no separate auth provider code found beyond the above | INFERENCE |

Persistent sessions are handled by the Supabase client's defaults in `src/lib/supabase.ts`. The exact options passed at line 31+ were not read in full — UNVERIFIED.

## 4. Admin authorization

- Server-side check: `supabase/functions/_shared/admin.ts`. The function validates the bearer token with `service.auth.getUser(token)` (line 81), then queries `admin_users` with `.eq('user_id', data.user.id)` (lines 84–88), requires `is_active === true` (line 95). VERIFIED IN CURRENT CHECKOUT.
- This matches the owner's rule: **admin authorization uses `admin_users.user_id` matched to the authenticated user ID, not an email lookup.** VERIFIED IN CURRENT CHECKOUT (code).
- Edge functions that use it: `supabase/functions/admin-push/index.ts`, `supabase/functions/admin-refund/index.ts`. VERIFIED IN CURRENT CHECKOUT (files).
- The admin **application** (UI) is out of scope for this storefront repo and belongs to another developer (Friend 2). See [CODEX_HANDOFF.md](CODEX_HANDOFF.md) §7.
- Production `admin_users` table shape vs. this code: UNVERIFIED (see PRODUCTION_DRIFT §7).

## 5. Database layer

- Tables in repo migrations include `profiles`, `orders`, `products`, `tap_profiles`, `admin_users`, `cards`, `entitlements`, plus V6 additions in later migrations. Full list: UNVERIFIED as a complete inventory; derive from `supabase/migrations/*.sql` (see [MIGRATION_STATUS.md](MIGRATION_STATUS.md)).
- Generated types: `src/lib/database.types.ts` (VERIFIED IN CURRENT CHECKOUT, file exists).
- Policy and grant changes live in migrations 007, 008, 024 (rebaseline) — file-level only; not reviewed line by line in this pass (UNVERIFIED).
- The V6 suspension guard is implemented in migrations 020 and 028 (not applied to production). VERIFIED IN CURRENT CHECKOUT (file headers).
- The `shygontap_profiles` table is **production-only** from the evidence; no repo migration creates it under that name. REPORTED INVESTIGATION FINDING; verify against the fresh baseline.

## 6. Store, orders, and payments

| Concern | Location | Label |
|---|---|---|
| Storefront pages | `src/pages/shygontap/Store.tsx`, `ProductDetail.tsx`; `src/pages/Checkout.tsx` | VERIFIED IN CURRENT CHECKOUT (files) |
| Catalog and orders services | `src/services/catalog.ts`, `src/services/orders.ts`, `src/services/payments.ts` | VERIFIED IN CURRENT CHECKOUT (files) |
| Order creation | `netlify/functions/create-order.mjs` (default export handler, line 25) | VERIFIED IN CURRENT CHECKOUT |
| Payment mode | `netlify/functions/payment-mode.mjs` — returns `live`, `test`, or `unconfigured` based on the key prefix; never returns a key. Lines 4–19. | VERIFIED IN CURRENT CHECKOUT |
| Razorpay verify + webhook | `netlify/functions/verify-payment.mjs`, `netlify/functions/razorpay-webhook.mjs`, `netlify/lib/razorpay.mjs` | VERIFIED IN CURRENT CHECKOUT (files) |
| Fulfilment and SMS | `netlify/lib/fulfilment.mjs`, `netlify/lib/orderMessages.mjs`, `netlify/lib/sms.mjs`, `netlify/functions/check-delivery.mjs` | VERIFIED IN CURRENT CHECKOUT (files) |
| Payment activation | **Deferred** per owner decision; the live-payment env flag `ALLOW_LIVE_PAYMENTS_LOCALLY` is listed in `.env.example` | VERIFIED IN CURRENT CHECKOUT (env name); deferral = HISTORICAL / DECISIONS |
| Account deletion and orders | Migration 026 `026_orders_outlive_account_deletion.sql` (rebaseline) | VERIFIED IN CURRENT CHECKOUT (file) |

## 7. NFC and QR flows

- `src/pages/TapQr.tsx` and `src/components/app/QrCode.tsx`. QR generation uses `qrcode-generator` (package dependency). VERIFIED IN CURRENT CHECKOUT (files, dependency).
- NFC tap landing: the public routes `/t/:username` and `/tap/:username` above. The `/d/<code>` + NTAG 424 DNA route for AAROH is a **planned** design item (AAROH owner decisions 2026-10-16, memory), not implemented in this checkout — UNVERIFIED.
- QR fix status: a branch `wip/tap-qr-fix` exists per the local memory notes; not inspected in this pass — UNVERIFIED.

## 8. Edge and serverless

- Supabase Edge Functions: `supabase/functions/admin-push`, `admin-refund`, shared `_shared/admin.ts`. VERIFIED IN CURRENT CHECKOUT.
- Netlify Functions: `netlify/functions/*.mjs` (6 files). VERIFIED IN CURRENT CHECKOUT.
- Duplicate API handlers: `api/*.mjs` (6 files; Vercel-style layout). VERIFIED IN CURRENT CHECKOUT. Which host is live is UNVERIFIED; `vercel.json` and `netlify.toml` both exist.

## 9. Local no-Docker stack

- The rebaseline `package.json` defines `stack` (`node supabase/local/serve.mjs`), `test:payment-chain`, `test:public-tap`, and `test:e2e` (VERIFIED IN CURRENT CHECKOUT, rebaseline `package.json`). The `supabase/local/` directory exists in that tree (VERIFIED IN CURRENT CHECKOUT, `ls -d`). It is not in the V5 baseline tree (VERIFIED IN CURRENT CHECKOUT). Its contents were not read.

## 10. Team boundaries (for code ownership)

See [CODEX_HANDOFF.md](CODEX_HANDOFF.md) §7. Do not edit admin UI from this repo.
