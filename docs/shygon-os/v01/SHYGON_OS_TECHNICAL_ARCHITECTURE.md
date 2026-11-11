# SHYGON OS: technical architecture (Version 01 and the path beyond)

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Status | PROPOSED. It describes the architecture **as built** (evidence: the inventory) plus the minimum additions for V01. **No re-architecture is proposed:** doc 02 and doc 10 rule 4 stand (Postgres + serverless functions; no microservices, new database or new auth provider) |

## 1. System overview

```
NFC card (NTAG 424 DNA: /d/<code>?e&c; older cards /t/<slug>)
   │ tap → phone browser
   v
CDN + static SPA (React/Vite, dist/)  ── one host (F-4)
   │  fetch / POST
   v
Serverless functions (Node 22, ESM, web Request→Response)   netlify/functions/* (+ api/* adapters)
   modes · rescue · connect · emergency · verify · prive · payments (create-order, verify-payment,
   razorpay-webhook) · card-otp · sms-status · emergency-dispatch (cron) · health · check-delivery
   │  service role only, via RPC (SECURITY DEFINER, fixed search_path)
   v
Supabase Postgres (+ Auth, Storage, Realtime)        migrations 001–037 (020+ local only)
   every AAROH table RLS-on and closed to client roles; public reads only via named RPCs
   │
   ├── Supabase Edge Functions: admin-refund, admin-push (admin app)
   └── External: Razorpay (payments) · MSG91/Twilio (SMS) · [email: undecided]
```

## 2. The five systems mapped onto the code

| System | Where it lives | Design rules |
|---|---|---|
| Identity OS | Supabase Auth; `customers`, `profiles`, `tap_profiles`; P-1..P-3 readers; 025 privacy | Identity key contract DEC-029 (`auth.users.id` vs `customers.id`); the public readers return only allow-listed fields |
| Experience OS | `tap_mode_catalog` + `tap_mode_state` (034); one active mode per Tap; mode readers P-6; capability modules 029/031/032/033/037 | A mode never shows another mode's data (BQ-1 guard, golden + canaries); every capability has a host switch AND a catalogue switch; neutral `null` / `unavailable` answers prevent enumeration |
| Owner OS | `/shygontap/*` SPA pages; owner operations through function `op`s with a bearer token | The frontend never authorizes; the server re-checks every operation; release flags only hide pages |
| Intelligence OS | **None in V01** | §6 below |
| Infrastructure OS | Host config, `scripts/ci`, `supabase/local` stack, tests, governance docs | §4–§5 |

## 3. Cross-cutting patterns (keep using them)

- **Contract first:** `docs/v6/aaroh/api-contract.md`, versioned; the frontend `contract.test.ts` refuses calls that are not documented.
- **Switches:** host env switches (`RESCUE_RELAY`, `CONNECT_PUBLIC`, `VERIFIED_TAP`, `EMERGENCY_PUBLIC_ALERTS`; unset = off) + the DB catalogue + frontend release flags. All three must agree before a feature is visible.
- **Trusted client address:** only the header named by `TRUSTED_CLIENT_IP_HEADER`; unset → refuse (B-9).
- **Idempotency keys** on every state-changing public op; an append-only ledger for webhooks and consents.
- **Privacy canaries** in tests: no secret, key, UID or personal field in any response or log line.
- **Migrations:**
  - additive, with a rollback script;
  - golden + admin-contract gates;
  - production applies only after DEC-018 review, the cool-off and the rebaseline (V6-106).

## 4. Version 01 additions (minimum, no re-architecture)

| Addition | Design | Owner |
|---|---|---|
| Card pairing (minimal) | Reuse the 037 code table (`code → card → epoch`); activation binds `card → owner` with the DEC-028 lifecycle states (`personalised → activated → retired`) | A |
| Report stolen / disable card | Owner op → card `retired` → Verified Tap answers `needs_service`; audited | A + B |
| Data export | `POST /api/account {op:'export'}` → JSON (+ vCard for the owner's own profile). Excludes third parties' data; rate-limited; audited | A + B |
| Phone verification | Reuse the OTP pattern (card-otp / emergency verify); the account phone gets `verified_at`; SMS features require it | A + B |
| Admin MFA | Supabase Auth MFA (TOTP) enforced in the admin RPC checks (`aal2`) | A |
| 18+ gate | Sign-up confirmation stored with a timestamp; Terms clause | B |
| Monitoring | Host logs + an error tracker (provider decision) + an uptime check on `/api/health?deep=1` | A |
| Backups / DR | Supabase PITR (plan dependent) + a documented restore drill; Verified Tap acceptance log outside the restore boundary (DEC-043 T-1 extras) | A |
| Cron | The host's scheduler calls `/api/emergency-dispatch` every minute with `CRON_SECRET` | A |

## 5. Environments

| Environment | Database | Keys | Purpose |
|---|---|---|---|
| Local | PGlite stack (`npm run stack`) | Test keys only | Development and tests |
| CI | Same, in GitHub Actions | None | Gates on every PR |
| Preview | **A separate non-production Supabase project** (F-8) | Preview-scoped, never production | P1/P2, owner verification |
| Production | The production Supabase project (after the rebaseline) | Production secrets in the host store only | Customers |

## 6. Intelligence OS: architecture for later (no V01 features)

- **Placement:** an AI gateway as a server function (`/api/assist`), never called from the browser with provider keys.
- **Permissions:** every AI capability is a named scope (e.g. `profile.draft`, `support.answer`) the owner opts into; agents act only through the existing RPCs and contract operations, never with database credentials; humans approve any write.
- **Audit:** every prompt, tool call and output id is logged as structured events (no personal free text in logs); per-feature kill switch.
- **Data:** no training on customer data; DPDP purpose limits; no emergency, finder or Connect content is sent to AI.
- **Governance:** doc 09 + an impact assessment per feature + an owner DEC. "AI Workforce" (internal company agents) is a separate system outside the customer product, and must not get production database access.

## 7. Scalability notes

- Postgres functions + serverless scale to the V01 audience. The hot path, the public Tap read, is one RPC plus a CDN-served SPA.
- Known limits:
  - PGlite tests can't exercise concurrency, so lock ordering is pinned by static checks; validate on the preview with Postgres.
  - Per-minute cron cost depends on the host plan.
  - The 4.5 MB / 1 MB request limits are irrelevant at current payloads.
