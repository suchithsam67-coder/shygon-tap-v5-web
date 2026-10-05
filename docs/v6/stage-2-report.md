# SHYGON V6, Stage 2 report: identity, database, auth, RLS

| | |
|---|---|
| Date | 2026-10-05 |
| Branch | `v6/stage-2-identity-rls`, from `v6/stage-1-audit` @ `47ba691`, in worktree `../shygon-tap-v5-web-v6` (no other session uses it; no `.env`) |
| Authorized by | Stage 1 approval and DEC-2026-035 (owner, in session, 2026-10-05) |
| Status | **STOPPED. Waiting for the owner's approval.** Nothing is applied to any real database. No deployment, push or credential rotation |

## 1. What changed

### Governance (owner decisions recorded)
- `docs/governance/decisions/DEC-2026-001_credential-exposure-rotation.md`: **the §2A waiver is extended to V6** development / release-candidate work (D-1). Rotation is still required and is a **release requirement**. No rotation without explicit authorization; no secret printed or committed; no control weakened; the waiver is temporary.
- `docs/governance/decisions/DEC-2026-035_v6-release-scope.md` (new):
  - D-1;
  - D-2 (V6 = software platform; physical card release out);
  - **N-1** (V6 migrations take 022+; amends DEC-2026-034 Q3);
  - **D-6** (Taps only after payment);
  - **card items deferred, and no physical card sales in the RC**;
  - **privacy hardening** (no tier model).
  - Open: D-3, D-4, D-7, D-8, and new D-9.
- `docs/runbooks/RUNBOOK-secrets.md` (new): the exact rotation procedure for every credential the code reads (names only), in order, with value-free verification and recording steps. **Nothing was rotated.**
- `docs/v6/backlog.md` (new, living), `docs/DECISIONS.md` (rows for F2, O-1, O-14 and DEC-2026-035; new **O-15**; V6 approvals and deviations V6-D1 to V6-D3), `docs/CHANGELOG.md`.

### Migrations
All are L3, idempotent, carry VERIFY ON LIVE queries and **tested** rollback SQL, and wait for the DEC-2026-018 24-hour cool-off and checklist.

| File | Backlog | What it does |
|---|---|---|
| `022_admin_notes_off_customer_rows.sql` | V6-010 (F2) | Moves the internal order note from `orders.admin_note` (readable by the customer: RLS is row-level) to the admin-only `order_admin_notes` (RLS on, no client grant). `admin_get_order` / `admin_update_order_status` are **generated from the live bodies** with exact replacements; the admin app sees the same JSON. Existing notes are copied, then cleared. **Data class: moves data** (reversible: the rollback copies the notes back) |
| `023_taps_only_after_payment.sql` | V6-012 (O-14, D-6) | Drops `tap_profiles_insert_own`, so no client can create a Tap row. Payment provisioning, the server and admins still can; the browser never inserted Taps |
| `024_owner_or_admin_policies_to_authenticated.sql` | V6-030 (F6, O-1) | The 8 `*_select_owner_or_admin` policies apply to `authenticated` only, so anon gets 0 rows, not an error. `require_admin` is revoked from anon. `admin_has` is revoked from anon **and PUBLIC**: it was executable by PUBLIC on live, which O-1 had missed. My first draft revoked anon only and was ineffective; the admin-contract output exposed it and it is fixed |

### Tests and tooling
- `supabase/tests/rls-matrix.mjs` (new, `test:rls-matrix`, V6-077):
  - **31 tables × 7 callers** (anon, customers A and B, viewer / support / admin roles, service): SELECT row sets, UPDATE and DELETE row counts, INSERT of a copy of the caller's own row and of someone else's row. Every write is rolled back. Results are compared with an explicit expected-access model; access beyond it fails as a P0.
  - Plus strict anonymous checks.
  - Plus **every callable `admin_*` function (41) called as anon and as a customer**: each must refuse through the permission check (42501).
- `supabase/tests/admin-notes.mjs` (new, `test:admin-notes`): F2 end to end.
  - Negative control (the baseline leaks); the customer and anon cannot read notes; notes moved intact.
  - **No notification, event, status history or Tap side effect.**
  - The admin JSON shape is unchanged; the write semantics are kept; the rollback restores the notes.
- `supabase/tests/migration-rollbacks.mjs` (new, `test:rollbacks`, V6-079): for every migration from 020 on, the header rollback restores the schema before it exactly (functions, bodies, grants, policies, relations, triggers). The full chain rolls back to the live baseline and re-applies identically. **This satisfies the readiness criterion "rollback exercised on a local database".**
- `supabase/tests/admin-contract.mjs`: exact approvals for grant revokes, policy removals and re-targets, and new closed relations, alongside body replacements. Anything unlisted still fails.
- `supabase/tests/bundle.mjs` + `supabase/APPLY_ALL.sql` (V6-040): the committed bundle held 6,047 lines of the **001–019 history** (the replay hazard). It now holds **only 020–024**, proven twice on the live baseline. `db:bundle:check` fails CI when it is stale. Warnings updated in `README.md`, `PRODUCTION.md` §5 and `supabase/migrations/README.md`.
- `supabase/tests/live-auth-shim.sql`: API roles get USAGE on schema `auth`, as on Supabase (VERIFY ON LIVE). The matrix found that the stand-in refused every customer "mark notification read".
- `supabase/tests/schema-drift.mjs`: the repository chain replays only the 001–019 history. 024 had produced a false FAIL there, the same class as the `verify-011` fix.
- `package.json` (scripts only) and `.github/workflows/ci.yml` (+4 steps).

No `src/`, `netlify/`, `api/` or edge-function file changed. `package-lock.json` is unchanged.

## 2. Commands run (final run on the committed tree)

| Command | Result |
|---|---|
| `npm run test:db` (the whole chain below) | exit 0 |
| ↳ `db:apply` (020–024, twice) | ALL MIGRATIONS APPLIED |
| ↳ `db:verify` | 21 passed, 0 failed |
| ↳ `rls-adversarial` | 64 passed, 0 failed |
| ↳ `test:rls-matrix` | **921 passed, 0 failed** (31 tables, 7 callers, 41 admin RPCs) |
| ↳ `test:identity` | 69 passed, 0 failed |
| ↳ `test:admin-notes` | 12 passed, 0 failed |
| ↳ `test:golden` | 7 passed, 0 failed (30 slugs byte-identical after **each** of 020–024) |
| ↳ `test:admin-contract` | 12 passed, 0 failed |
| ↳ `test:rollbacks` | 6 passed, 0 failed |
| ↳ `db:bundle:check` | PASS (020 onward only) |
| ↳ `test:db:history` | 2 passed, 0 failed |
| `test:push-guard` | 18 passed, 0 failed |
| `test:payments:ci` | 15/15 and 13/13; 1 BLOCKED (needs Node 22; unchanged) |
| `lint` / `tsc -b` / `vite build` | exit 0 / exit 0 / exit 0 |
| `test:bundle` | 88.55 kB (88,551 B) of 90 kB; unchanged |
| `npm audit --audit-level=high` | exit 0 (1 low: esbuild dev-server) |
| `test:secrets` (full history) | the known `9c8caa7` finding only (DEC-2026-020); all changed files scan clean |
| `verify-011`, `schema-drift` | 16/16; 18/18 history applied, baseline reconstructs |

### Negative controls (scratch copies; every one fails as it should)

| Control | Result |
|---|---|
| Matrix without 023 | 2 × **UNEXPECTED ACCESS (P0)**: a customer inserts their own Tap |
| Matrix without 024 | 10 failures: 8 anon reads error instead of 0 rows; `require_admin` / `admin_has` executable by anon |
| Matrix with a mutant `admin_*` function lacking the permission check | 2 × **UNEXPECTED ACCESS (P0)** (anon, customer) |
| Rollback suite with one rollback statement removed (024) | 2 failures naming `admin_has(text)` |
| Admin contract while the F2 bodies and grant changes were unapproved | 4 failures (bodies, grant, policies, relations) |

## 3. Stage 2 scope: covered and not covered

| Stage 2 item | Status |
|---|---|
| Identity, profiles, Tap ownership | Covered: 021 identity contract (69), plus D-6 (023) and the matrix |
| SHYGON ID consistency | Internal consistency is covered (021, collision fallback). **The customer-facing SHYGON ID needs D-9** before anything is shown |
| Auth lifecycle (sign-up → customer + profile; session/refresh/logout/reset/recovery) | Sign-up → customer + profile is tested at the database level. **The browser auth flows cannot run without an auth server**: no Docker, Supabase CLI or browser runner here (D-4). Code-reviewed in the Stage 1 audit; E2E in Stage 5 |
| Authorization audit (profile/Tap updates, suspension, admin actions, orders, payments, customer records, notifications, analytics) | Covered by the matrix (every table), F1 tests (suspension), the admin-RPC refusal sweep (41 functions) and the admin contract |
| RLS adversarial matrix (A→A, A→B, anon, customer→admin, viewer→admin, admin→customer, service) | Covered: 921 checks. **0 unexpected access** |
| New migrations with rollback notes | 022–024, rollbacks tested |

Moved out of Stage 2:
- V6-031 (order-id randomness) goes to Stage 3 with the other payment code.
- V6-035 (card OTP) and V6-019 are deferred with the card release.
- V6-036 (password policy) is a Supabase project setting: production configuration in Stage 6, owner's call.

## 4. Open items

- **P0 (release gates, human):** B-1 credential rotation; B-2 apply 020–024 to production after the cool-off, checklist and VERIFY ON LIVE; B-3 G-PAY. **No engineering P0 is open in V6** (I-4 is deferred with the cards, and the RC does not sell cards: V6-070, Stage 3).
- **P1:** B-4 remote + CI; B-5 / D-4 E2E environment; V6-014 secret-scan gate (D-7); V6-070 no card sales; V6-017 fulfilment tests; V6-071 / V6-073 privacy on the public Tap and analytics; V6-018 observability; V6-075 auditability; V6-072 export and deletion.
- **P2:** V6-078 / **O-15** (admin read scope); V6-031; V6-032; V6-033; V6-036; V6-038; V6-039; V6-042; V6-043; V6-074; V6-076 (needs D-9).

## 5. Decisions needed from the owner

| # | Decision | Needed by | Recommended |
|---|---|---|---|
| **D-4** | E2E environment: local Supabase (install Docker + CLI on this machine), an allowlisted non-production project (DEC-2026-027), or DB-level journeys plus static browser tests | **Before Stage 3** (Stage 5 depends on it) | Local Supabase via Docker |
| D-9 | What the customer-facing **SHYGON ID** is: the existing internal `CUST-…` code, or a new format | Stage 4 | Your call (product) |
| O-15 | Restrict admin reads to the permission catalogue (`admin_has(...)` instead of `is_admin()` in the 8 owner-or-admin policies) | Stage 4 | Restrict (L3) |
| D-3 | Governance mapping (interim rule recorded in DEC-2026-035: implement locally; cool-off applies before approval/apply) | Any time | Confirm the interim rule |
| D-7 | Secret-scan gate on `9c8caa7` | Stage 5 | Fingerprint under DEC-2026-020 |
| D-8 | Admin scope (interim: DB/edge layer + auditability, no new UI) | Stage 4 | Confirm |
| Approve 022–024 | DEC-2026-018 cool-off + checklist before any application | After 24 h | — |

**STOP.** Stage 3 (payments and Tap lifecycle) starts only after approval, and preferably after D-4.
