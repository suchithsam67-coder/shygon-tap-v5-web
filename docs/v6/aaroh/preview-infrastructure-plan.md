# Isolated preview infrastructure for P1 and P2 (plan; nothing created)

| Field | Value |
|---|---|
| Date | 2026-10-23 |
| Purpose | What is needed to run P1 (the B-9 address-header check, `B-9_client-address-plan.md` §6) and P2 (Connect on a non-production database) on real hosts, without touching production |
| State | **PLAN ONLY.** No account, project, preview, credential or provider setting was created or changed. Every step that creates something needs the approvals in §6. |

Labels: **OBSERVED** (seen in the repository), **INFERRED**, **UNKNOWN**.

## 1. Which hosts [OBSERVED]

- `docs/release/PRODUCTION-CONFIG.md` §1: "Hosting (Netlify or Vercel, one of them: V6-043)". Backlog V6-043, "One deploy target", is **open**.
- Both are configured:
  - `netlify.toml` builds `dist`, serves the functions from `netlify/functions` and pins `NODE_VERSION = "22"`;
  - `vercel.json` builds `dist` and serves `api/*.mjs` (thin entry points to the same handlers).
- **So "every intended host" is both, until V6-043 is decided.** If you pick one, P1 runs only there.

## 2. What exists today [OBSERVED]

| Item | State |
|---|---|
| Git remote | None on `v6/aaroh-backend` (G7 / B-4). A Git-linked preview needs one, or a CLI deploy from this machine |
| Netlify / Vercel / Supabase CLIs | Not installed. Installing globally is not allowed; a project-local `npx` would still be a deploy and needs approval |
| Non-production Supabase project | **None.** `supabase/non-production-projects.json` (the only targets `npm run db:push` may use, DEC-2026-023 S1 / A-1) lists no project |
| Provider dashboards and settings | Not visible from here; not inspected |
| Costs | **UNKNOWN** from the repository. Check current plan pricing at approval: an extra Supabase project, and preview access protection on the chosen host |

## 3. Configuration matrix for a preview

Values are set by you in the host's preview-scoped settings and **never** pasted into chat or committed. Names come from the code (`env('…')` in `netlify/`, `import.meta.env.…` in `src/`) and from `.env.example`.

| Setting | Preview value (policy) | Why |
|---|---|---|
| `SUPABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | The **non-production** project only (§4) | Isolation from production data |
| `OTP_SECRET` | A new random value, preview only | Never shared with production |
| `TRUSTED_CLIENT_IP_HEADER` | Netlify: `x-nf-client-connection-ip`. Vercel: `x-vercel-forwarded-for` | What P1 tests |
| `CONNECT_PUBLIC` | Unset at the start; P2 sets it to `on`, then removes it | What P2 tests; also measures how fast a change applies (R2) |
| `RESCUE_RELAY` | `on` **on the P1 preview only** (the P1 method measures the finder limit) | Never on production |
| `EMERGENCY_PUBLIC_ALERTS` | Unset | Not needed; never on |
| `SMS_PROVIDER`, `TWILIO_*`, `MSG91_*`, `SMS_STATUS_CALLBACK_URL`, `MSG91_DLR_SECRET` | Unset | Alerts record `not_sent`; no real text is sent |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `VITE_RAZORPAY_KEY_ID` | Unset, or **test-mode** keys only | Not needed for P1/P2; payments then answer 503 |
| `CRON_SECRET` | Unset | No sweep needed for P1/P2 |
| `OTP_DEV_MODE`, `ALLOW_LIVE_PAYMENTS_LOCALLY`, `CARD_SALES_ENABLED`, `VITE_CARD_SALES_ENABLED`, `HOTEL_PROVIDER`, `SHIPROCKET_*` | Unset | `card-otp` allows dev mode only outside the `production` context (`CONTEXT` / `VERCEL_ENV`); keep it off anyway |
| `SITE_URL`, `VITE_SITE_URL` | The preview's own URL | Links and redirects stay on the preview |
| Supabase Auth site URL / redirect list | The preview URL, set **in the non-production project only** | Sign-in never redirects to production |

## 4. Isolation checks before any test

1. The preview's Supabase project ref is listed in `supabase/non-production-projects.json`, and is **not** the production ref. Compare the refs, never the keys.
2. Preview settings are scoped to the preview or deploy-preview context, so no production value is inherited.
3. Migrations applied to the non-production project: the baseline, 020–026 and 028–033, **without 027** (DEC-2026-037 / V6-123).
4. Only test accounts (`*@example.test`). No customer data is copied.
5. Access to the preview is restricted (password or SSO protection), and its URL is shared only with the testers.
6. No production webhook or callback points at the preview.
7. After the tests, the preview deployment is deleted, and the non-production project is paused or kept as the standing test project, by your choice.

## 5. How P1 and P2 would run once approved

- **P1, per host:** `B-9_client-address-plan.md` §6 exactly.
  - Four `public.start` requests to `/api/rescue`, each with a different forged value (from RFC 5737 documentation ranges) in **both** address headers.
  - Expected: 201, 201, 201, then `rate_limited`.
  - If all four answer 201: P1 fails, and both visitor switches stay off.
  - Record the host, the preview ID, the request results (no real addresses), pass/fail.
- **P2:** the sequence in readiness report §11.2, through the preview URL:
  - off → on (set `CONNECT_PUBLIC=on`, redeploy, time how long the change takes) → off;
  - owner settings, request, acceptance, sharing scope, refused widening and acceptance while off, decline, block, remove;
  - then confirm in the **non-production** database that every grant on the removed connection is revoked and no row was added by a refused call.
  - Keep sanitised logs. P2 closes only on this hosted evidence.

## 6. Approvals needed (none given yet)

| # | Approval | Creates or changes | Cost |
|---|---|---|---|
| AP-1 | Decide V6-043 (one host), or approve P1 on both | Scope | — |
| AP-2 | Create a dedicated non-production Supabase project, and add its ref to `supabase/non-production-projects.json` | A new project (external) | UNKNOWN; confirm the plan |
| AP-3 | Apply the baseline + 020–026 + 028–033 (no 027) to that project; say whether DEC-2026-018's cool-off and checklist apply to a non-production project | Schema in a non-production database | — |
| AP-4 | Create a preview on the chosen host(s): Git-linked (needs a remote, G7) or a one-off CLI deploy from this machine, with access protection | An externally reachable preview | UNKNOWN; confirm the plan |
| AP-5 | You set the §3 settings in the provider dashboards yourself. Session A never sees the values | Provider settings | — |
| AP-6 | Authorise Session A to run the P1/P2 requests against the preview URL and to read the non-production database for the checks | Test traffic, test rows | — |
