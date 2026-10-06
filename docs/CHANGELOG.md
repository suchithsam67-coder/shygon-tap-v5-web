# Changelog

This file records changes to this repository, newest first. Entries name the doc 12 milestone and the finding or decision ids involved.
Nothing below has been deployed, and no migration has been applied anywhere except local PGlite.

## [Unreleased]: branch `feat/m0-governance-ci` (not merged)

### SHYGON V6 Stage 3: payments and the Tap lifecycle (2026-10-06), branch `v6/stage-3-payments-tap`
**Governance:** DEC-2026-035 amendment A-1 (owner, 2026-10-06):
- run Stages 3–6 back-to-back;
- D-4 = the no-Docker local stack;
- D-10 = digital-first;
- test-only dev dependencies.

New open decision **D-11** (login email pre-filled into the public Tap). New observation **O-16**. O-2 implemented locally. Report: `docs/v6/stage-3-report.md`.

**Added**
- `supabase/local/`: the local stack (D-4).
  - PGlite with the live schema and 020 onward, behind a Supabase-compatible gateway (REST, Auth, Realtime handshake).
  - The real server functions behind the `netlify.toml` routing and CSP.
  - A Razorpay stand-in.
  - `npm run stack` serves it.
- `025_public_tap_privacy_and_analytics.sql` (L3; generated from the live bodies with exact replacements; tested rollback):
  - V6-071 / O-2: `get_public_tap` revoked from the API roles; it leaked a hidden address to anon on live;
  - V6-073: salted daily visitor hash;
  - V6-032: dedupe and hourly cap;
  - V6-071: owners can hide phone and email.
- Suites:
  - `test:payment-chain` (27): the real payment handlers on the stack;
  - `test:public-tap` (25): lifecycle, six states, privacy, analytics, with live-baseline negative controls;
  - `test:components` (14, Vitest);
  - `test:e2e` (6, Playwright on the installed browser): the three V6 journeys.
- `src/lib/commerce.ts`, `CardsComingSoon`, `NoTapState`: the digital-first storefront (D-10).

**Fixed**
- **V6-086:** `create-order` crashed (500) for every customer who already owned an experience, because of an unimported helper. Present since the V5 import.
- **V6-087:** a new customer could not buy anything, because Tiers required an existing Tap and cards are not sold.

**Changed**
- **V6-070:** card orders are refused server-side (`CARD_SALES_ENABLED`); card pages say "coming soon"; no card offers in the structured data.
- **V6-031:** the order-number suffix comes from `crypto.randomInt`.
- **Tap editor:** "Show on Tap" switches for phone and email, saveable while the edit window is closed.
- **Tests:**
  - `admin-contract`: 025's exact approvals, applied literally;
  - `rls-matrix`: models the new table;
  - `rls-adversarial`: the get_public_tap check is stricter.
- **CI:** three new gate steps and an `e2e` job.
- **Lockfile:** the new test dependencies, plus `source-map-js` 1.2.1 → 1.2.2 (a new high advisory; owner to confirm).

**Not done:** nothing applied to any real database; no production contact, deployment, push, rotation or live payment.

### SHYGON V6 Stage 2: identity, database, RLS (2026-10-05), branch `v6/stage-2-identity-rls`
**Governance** (DEC-2026-035, approved 2026-10-05)
- DEC-2026-001: the §2A waiver is extended to V6 development / release-candidate work. Rotation stays a release requirement. `docs/runbooks/RUNBOOK-secrets.md` holds the exact procedure (nothing rotated).
- DEC-2026-035 records D-1, D-2 (V6 = software platform; physical cards out), N-1 (V6 migrations 022+), D-6 (Taps only after payment), the card deferral (no physical card sales in the RC) and privacy hardening. Open: D-3, D-4, D-7, D-8, and new D-9 (customer-facing SHYGON ID).
- `docs/v6/backlog.md`: the living backlog. `docs/DECISIONS.md`: F2, O-1 and O-14 marked implemented locally; new observation **O-15**: any active admin reads every support ticket, message and notification through `is_admin()`.

**Added** (all L3; local PGlite only; each idempotent, with VERIFY ON LIVE queries and tested rollback SQL)
- `022_admin_notes_off_customer_rows.sql` (F2, V6-010): the internal order note moves to the admin-only `order_admin_notes` (RLS on, no client grant). `admin_get_order` still returns `order.admin_note`, and `admin_update_order_status` writes the note to the new table. Both are generated from the live bodies with exact replacements. Existing notes are copied, then cleared from `orders`.
- `023_taps_only_after_payment.sql` (O-14, D-6): drops `tap_profiles_insert_own`. No client can create a Tap row; provisioning, the server and admins still can.
- `024_owner_or_admin_policies_to_authenticated.sql` (F6 + O-1, V6-030): the eight `*_select_owner_or_admin` policies apply to `authenticated` only, so anon reads 0 rows with no error. `require_admin` is revoked from anon, and `admin_has` from anon **and PUBLIC**.
- `supabase/tests/rls-matrix.mjs` (`test:rls-matrix`, V6-077): every table × every caller against an explicit expected-access model; extra access fails as a P0. Includes strict anon checks.
- `supabase/tests/admin-notes.mjs` (`test:admin-notes`): F2 behaviour, the admin contract shape, no side effects, the rollback with notes restored.
- `supabase/tests/migration-rollbacks.mjs` (`test:rollbacks`, V6-079): each migration's header rollback restores the schema before it; the full chain rolls back to the baseline and re-applies identically.

**Changed**
- `supabase/tests/admin-contract.mjs`: approvals for exact grant revokes, policy removals and re-targets, and new closed relations, alongside body replacements. Anything unlisted still fails.
- `supabase/tests/bundle.mjs` / `supabase/APPLY_ALL.sql` (V6-040): the bundle holds **only 020 onward** (it held the 001–019 history), proven twice on the live baseline. `db:bundle:check` fails CI when it is stale. Warnings updated in `README.md`, `PRODUCTION.md` §5 and `supabase/migrations/README.md`.
- `supabase/tests/live-auth-shim.sql`: grants the API roles USAGE on schema `auth`, as Supabase does (VERIFY ON LIVE). Without it the stand-in refused every customer "mark notification read". The RLS matrix found the gap.
- `package.json` (scripts only) and `.github/workflows/ci.yml` (four steps): the new suites run in `test:db` and CI.

**Not done:** nothing applied to any real database; no production contact, deployment, push or rotation. 022–024 wait for the DEC-2026-018 cool-off and checklist.

### verify-011 replays the history chain only (2026-10-05), branch `feat/m0.3-security-identity`
**Fixed** (DEC-2026-023 Option A; owner decision 2026-10-05, a separate commit from U4)
- `supabase/tests/verify-011-admin-notes.mjs` replays only migrations 001–019 on the repository shim, not every file in `supabase/migrations/`.
  - Migrations from 020 on are written for the live schema baseline. 021 references `public.customers`, which the shim does not have, so the stand-alone script had failed since 021 was added.
  - It is back to 16/16. It is not a CI gate, and its assertions are unchanged.

### M0.3 U4 complete locally: customer_id resolution and the draft first-payment Tap (2026-10-05), branch `feat/m0.3-security-identity`
**Added** (DEC-2026-024 Option A + D-U4, DEC-2026-029 Option A; L3; owner decisions of 2026-10-05, superseding 2026-10-03)
- `supabase/migrations/021_resolve_customer_id.sql`:
  - `customer_id_for(uuid)`, a SECURITY DEFINER helper executable by `service_role` only. It returns the account's `customers.id`, or creates the row.
    - It uses the live `CUST-` + 10 hex digits code.
    - On a collision it lengthens the code deterministically, one hex digit at a time up to all 32, then appends `-2` … `-1000`, then refuses with 23505. It never overwrites an existing customer (O-13).
  - `resolve_customer_id()` with two WHEN-gated triggers per table on `profiles` and `tap_profiles` (BEFORE INSERT / UPDATE OF `customer_id`):
    - the account's own user id is mapped to its `customers.id`;
    - a client sending any other value, except its own `customers.id`, gets **42501**;
    - server values are left to the FK.
  - `provision_tap_on_payment()` (D-U4): the first-payment Tap is created as a **draft** (`status 'draft'`, `published false`), with the notification "Your SHYGON Tap draft is ready" / "Your Tap page has been created. Review and publish it from your SHYGON dashboard."
    - The body differs from live by exactly those literals. Signature, grants and trigger are unchanged.
  - Rollback SQL is in the header and tested. VERIFY ON LIVE queries are included. The migration is idempotent.
- `supabase/tests/identity-contract.mjs` (`npm run test:identity`): **69 checks.**
  - Run twice (migrations applied once, then twice): I-1 claim, D-U4 draft and notification, anonymous visibility, returning buyer, failed payment, duplicate claim, missing customer, rollback on failure, retry plus safety net (I-3), Settings / Checkout saves (I-2), client refusals (B2), server rules, helper privileges, the deterministic collision sequence (11 digits, 12 digits, full id `-3`, and the 23505 cap after 1022 candidates), and O-13 at sign-up (characterised, open).
  - The 021 rollback proof runs once.
- `supabase/tests/golden-public-tap.mjs` + `golden/public-tap.json` (`npm run test:golden`):
  - 30 slugs, including the F3 card-state characterisations;
  - output byte-identical on the baseline, +020 and +020+021.
- `supabase/tests/admin-contract.mjs` + `golden/admin-contract.json` (`npm run test:admin-contract`):
  - 61 frozen functions: signatures, grants, `search_path` and bodies (only the approved D-U4 body change allowed);
  - every other function, every policy, every table grant and every existing trigger unchanged.
- `package.json` (scripts only: the three suites, added to `test:db`) and `.github/workflows/ci.yml` (three steps).

**Evidence**
- `db:verify` is **21/21** (6/21 before).
- rls-adversarial 64/64; history 2/2.
- **Negative controls (scratch):**
  - without 021, identity-contract fails 51/69 and admin-contract fails the D-U4 check;
  - a fallback that skips code lengths fails the 4 collision checks in both passes;
  - with the client branch disabled, the 12 client refusals fail;
  - mutant migrations (a grant, a `search_path`, a policy, a resolver body) are caught by admin-contract and golden.

**Not done:** not applied to any real database; no production contact, deployment or push. Committed locally after its gates passed (owner authorization of 2026-10-05; the full-history secret scan's only failure is the known 9c8caa7 exception). It waits for the DEC-2026-018 24-hour cool-off and checklist approval. `handle_new_user` (O-13 at sign-up) and O-14 (a customer can create their own active Tap directly) are recorded, not fixed.

### M0.3 U3 complete locally: F1 suspension guard (2026-10-03), branch `feat/m0.3-security-identity`
**Added** (DEC-2026-022 Position A; L3)
- `supabase/migrations/020_guard_suspension_columns.sql`. A BEFORE UPDATE trigger (`guard_suspension_columns()`) on `tap_profiles` and `profiles` refuses, with **42501**, any change made by a client role (`anon` / `authenticated`) to:
  - `tap_profiles.suspended_at` / `suspended_reason` / `suspended_by`;
  - `profiles.suspended_at` / `suspended_reason`.
- How the guard works:
  - It judges the caller's role, not `is_admin()`. The SECURITY DEFINER admin RPCs `admin_set_tap_suspension` and `admin_set_customer_suspension` run as their owner, so they keep working **unchanged**.
  - It compares old and new values, so an unchanged re-send is allowed.
  - The triggers are named `zz_` so they run last.
  - No policy, grant or existing function changed.
  - The migration includes rollback SQL and read-only VERIFY ON LIVE queries. It is idempotent.
- `supabase/tests/rls-adversarial.mjs`: **16 F1 checks.**
  - Refused, row unchanged: customer clears or changes each protected column, Tap and account.
  - Admin suspend and restore still work: fields set and cleared, audit rows written, public state follows.
  - The owner can still edit ordinary fields.
  - Controls: another customer gets 0 rows; a non-admin calling either RPC gets 42501.
  - The D-U1-b anonymous checks are unchanged.

**Evidence**
- The stage-1 probe (pre-implementation) confirmed F1 on the live baseline.
- rls-adversarial: **64/64** with 020.
- **Negative control:** without 020, the 9 refusal checks fail (scratch run).
- `db:apply` applies 020 twice.
- Bundle unchanged at 88.55 kB.

**Known, unchanged:** `db:verify` is 6/21, entirely the I-1 cascade (fixed in U4).

**Not done:** not applied to any real database; no production contact, deployment or push. It waits for the DEC-2026-018 24-hour cool-off and checklist approval. U4–U7 not started.

### Secret-scan finding classified (2026-10-02), governance only
**Context:** the full-history secret scan (`npm run test:secrets`) reports one finding:
- `generic-api-key` at `src/components/ProjectConsultation.tsx:75`, in commit `9c8caa7`;
- the commit is on branches of a parallel worktree, `../shygon-tap-v5-web-upgrade-fix` (`import/v5-2026-09-28-final`, `import/upgraded-zip-2026-09-29`, `fix/upgraded-zip`).

**Verified, without showing the value:** it is the public Web3Forms key DEC-2026-020 already approved (identical git blob `89563fa` and token hash).

**Recorded:**
- The repository owner confirmed the worktree is **expected** and belongs to this project.
- The finding is classified as an **approved public-key reuse in a separate, expected worktree** (DEC-2026-020 provenance section; `docs/DECISIONS.md`).

**Not changed:**
- `.gitleaksignore` and the scan wrapper. The full-history gate **still fails and stays visible**.
- The worktree's branches; they are not modified or merged.

`feat/m0.3-security-identity` scans clean on its own; that is evidence only, not a substitute for the gate.

### M0.3 U2 complete: `db:push` safeguard (2026-10-02), branch `feat/m0.3-security-identity`
**Decided** by the repository owner, in session:
- **DEC-2026-023 amendment A-1:** S1 is allowlist only, with no override flag.
- **`APPLY_ALL.sql`:** text-only clean-up.

**Changed** (DEC-2026-023 Option A + S1/A-1)
- `supabase/tests/apply-remote.mjs` (`npm run db:push`). **Before any network call** it refuses:
  - any argument, including the removed `--i-know-this-is-not-production`;
  - an unset or malformed `SUPABASE_PROJECT_REF`;
  - a ref not on the allowlist;
  - every ref, if the allowlist is missing or invalid.

  It prints its plan before contacting Supabase, sends only migrations `020+` (never 001–019), and never prints the token.
- New `supabase/non-production-projects.json`: the allowlist, empty, so `db:push` refuses everything today.
- New `supabase/tests/lib/push-guard.mjs`: pure checks that fail closed.
- New `supabase/tests/lib/migrations.mjs`: 020+ selection with no dependencies. `lib/live-db.mjs` re-exports it.
- New `supabase/tests/db-push-guard.mjs` (`npm run test:push-guard`, in `ci` and CI): 18 checks. These include end-to-end runs of the real script under the network guard, asserting **no network attempt on every refusal path**. A sandbox shows that only `020+` is planned and only `api.supabase.com` is contacted.
- **Mutation control** (scratch): with the allowlist check removed, the script reaches the network, which the refusal checks would catch.
- `.github/CODEOWNERS`: the allowlist and guard files need Data + Security review.
- **`APPLY_ALL.sql` (text only):** every paste instruction became a warning, in the `db:push` message, `README.md`, `PRODUCTION.md` §5, the header text `db:bundle` writes, and `supabase/migrations/README.md`. **The file and what `db:bundle` bundles are unchanged** (M0.4).

**Not changed:** migrations (no 020/021), schema, RLS, auth, payments, fulfilment, production. Nothing was pushed or deployed.

### M0.3 U1 complete: database suites on the live baseline (2026-10-02), branch `feat/m0.3-security-identity`
**Decided** by the repository owner, in session:
- **D-U4:** the first-payment Tap is created as a draft. `provision_tap_on_payment` changes in U4; this reverses scope point 5.
- **D-U1-a:** the catalogue checks are kept as history tests.
- **D-U1-b:** for 4 anonymous-read checks, "error OR 0 rows" counts as denial, and any returned row fails. RLS is unchanged.

**Changed** (DEC-2026-023 Option A)
- `apply.mjs`, `verify.mjs` and `rls-adversarial.mjs` now build from the live baseline via `lib/live-db.mjs` and apply `020+`. 001–019 are never re-run.
- `rls-adversarial` fixtures are adapted to the live table shapes (`cards.card_id`, NOT NULL `customer_id`); its assertions are unchanged apart from D-U1-b.
- New `history-seed.mjs` + `test:db:history` (in `test:db` and CI).
- New `supabase/migrations/README.md`.

**Results**
- `db:apply` passes; `rls-adversarial` 48/48 (with a negative control); history 2/2.
- **`db:verify` is 6/21 until U4.** All 15 failures cascade from the I-1 production defect.
- `test:db` and `ci` are therefore red on this branch until U4. Nothing is weakened.

### M0.3 U1 started, then stopped at its stop rule (2026-10-02), branch `feat/m0.3-security-identity`
**Added** (tooling only; not yet wired into any script or CI)
- `supabase/tests/lib/live-db.mjs`: builds an isolated PGlite database from the live baseline (DEC-2026-023 Option A). It loads `live-platform-shim.sql`, then `000_live_baseline.sql`, then `live-auth-shim.sql`, then migrations `020+`. 001–019 are never re-run.
- `supabase/tests/live-auth-shim.sql`: a stand-in for the sign-up trigger `on_auth_user_created`, which migration 002 created on live and which the `public`-only dump omits. VERIFY ON LIVE.
- `docs/shygon-os/M0_3_U1_BASELINE_FINDINGS.md`: the existing suites run on the live baseline with assertions unchanged.
  - `rls-adversarial`: 44/48. The 4 failures are anonymous reads that error instead of returning 0 rows; no data leaks. This is the M0.4 item.
  - `verify`: 6/23. With a scratch I-1 prototype: 20/23 (seed-data checks ×2; live auto-publishes the Tap ×1).
- **New observation O-12:** once I-1 is fixed, live auto-publishes a first-time buyer's Tap, showing their name and account email. Decisions D-U1-a, D-U1-b and D-U4 are requested.

**Recorded:** the owner confirmed scope points 1–5 (DEC-2026-024 = Option A).

**Not changed:** the suites, CI, migrations, RLS, auth, payments and production. CI still runs on the history chain and passes.

### Owner approvals recorded; M0.3 scope defined (2026-10-02), governance only
**Recorded** (repository owner, in session):
- DEC-2026-018 **APPROVED, Option B:** the one-person control model. The new record file is `DEC-2026-018_role-holders.md`; `ROLE_ROSTER.md` is updated with no invented names or handles.
- DEC-2026-022 **APPROVED, Position A:** F1 + F3 + F4; F2 to the backlog. Q2 and Q3 remain OPEN.
- DEC-2026-023 **APPROVED, Option A + S1.**
- DEC-2026-024 **APPROVED, Option A for I-1…I-3:** an interpretation of "the documented fix direction", for the owner to confirm. I-4 OPEN.
- DEC-2026-029 **APPROVED, Option A** (B1–B7).
- DEC-2026-001: the doc 12 §2A gate is **waived for M0.3 only**. Rotation is still NOT DONE; the record stays OPEN.
- Authorization:
  - database, RLS and payment changes **YES** (repository and local only; test mode);
  - auth, M1.1, live payments, deployment and production data modification **NO**.

**Added**
- `docs/shygon-os/M0_3_IMPLEMENTATION_SCOPE.md`:
  - units U1–U7;
  - the files and the two planned migrations (`020_guard_suspension_columns`, `021_resolve_customer_id`);
  - tests and gates;
  - blocked items and stop conditions.
- `docs/DECISIONS.md`: owner-approval record and deviations D-1 (M0.3 = F1 + F3 + F4) and D-2 (DEC-024/029 scheduled in M0.3).

**Not changed:** no code, schema, migration, RLS, auth, payment, deployment or production change. **Implementation has not started.**

### Human Decision Pack (2026-10-02), review only
**Added**
- `docs/shygon-os/HUMAN_DECISION_PACK.md`: the 13 open decisions (DEC-2026-002, 018, 022–032), each with:
  - what must be decided and why it matters;
  - the options named in its record (definition, consequences, affected V5 and SHYGON OS components, migration and security implications);
  - evidence, dependencies and what it blocks;
  - a blank human-approval block;
  - and, at the end, the approval checklist and the implementation-authorization form.
- `docs/shygon-os/IDENTITY_DECISION_SUMMARY.md`: 15 identity relationships (U, C, persona, card, order, payment, fulfilment), each with current key, intended key, current usage, risk and the future contract per DEC-029 option.
- `docs/shygon-os/CARD_LIFECYCLE_DECISION_SUMMARY.md`: doc 08 vs live database vs V5 app vs M1 proposal. Covers:
  - activation paths, status writers, and expiry, replacement, suspension and delivery behaviour;
  - owner step-up;
  - `/t/:slug` and `/d/:code` implications.
- `docs/shygon-os/PHASE_GATE_DECISION_SUMMARY.md`: M0 completion first vs M1 foundations in parallel, and which M1 work is genuinely parallel-safe.

**Corrected**
- `M1_DECISION_GATE_REPORT.md` C2 / C4 and the related rows:
  - `admin_update_card` validates five status values; it does not accept any string (E-1);
  - there are four writers of `status='active'`, not three (E-2).
  Each corrected line is marked.

**Recorded, not fixed**
- E-3: live `fulfil_order()` omits the NOT NULL `cards.card_id` (static reading).
- New observations O-7…O-11 for triage:
  - O-7: an owner can undo any card suspension;
  - O-8: the Terms text vs F3;
  - O-9: the expiry sweeper's schedule is unknown;
  - O-10: card↔persona link columns are never written;
  - O-11: unused email columns on live `orders`.
  None meets a P0 criterion.

**Not changed:** no code, schema, migration, RLS, auth, payment, deployment or production change. No decision approved or selected.

### M1 decision gate report (2026-10-02), review only
**Added**
- `docs/shygon-os/M1_DECISION_GATE_REPORT.md`, which contains:
  - a register of 13 decisions (DEC-2026-002, 018, 022–032) with dependencies, approve/defer effects and what each blocks;
  - an identity key map (every live table, FK, policy, function and code path for U / C / P / D);
  - a card-lifecycle conflict matrix (C1–C11; no model chosen);
  - the payment/fulfilment defect analysis (not fixed);
  - migration preconditions;
  - M1.1 readiness classification.

**Not changed:** no schema, RLS, auth, payment, deployment or production change. No decision resolved.

### M1.0: Architecture & Implementation Readiness Package (2026-10-02), planning only
**Added** (documentation only)
- `docs/shygon-os/M1_ARCHITECTURE_PLAN.md` (36 sections).
- Companions: `M1_DOMAIN_MODEL.md`, `M1_API_CONTRACTS.md`, `M1_SECURITY_MODEL.md`, `M1_DATABASE_PLAN.md`, `M1_TEST_STRATEGY.md`.
- Decision proposals DEC-2026-025 … 032:
  - organisations timing;
  - M1 sequence and the M0 gate;
  - environments vs "no new Supabase project";
  - card lifecycle vocabulary;
  - identity key contract;
  - OS dashboard scope;
  - notification providers / WhatsApp;
  - vertical taxonomy.
- Security observations O-1…O-6 for the Security Owner.

**Not changed:** no schema, migration, RLS, auth, payment, deployment or production change. Live payments OFF. The approved pack files in `docs/shygon-os/` are unchanged; only new `M1_*` files were added.

### M0.2: Live schema baseline and drift reconciliation (2026-09-30 → 2026-10-02)
**Added**
- `supabase/baseline/000_live_baseline.sql`: the authoritative schema-only dump of the live project, provided by the owner. Not modified.
  - Checked independently: no data, gitleaks 0 findings.
  - Its `\restrict` line is pg_dump's nonce, not a credential.
- `supabase/tests/schema-drift.mjs`: read-only drift tool. It rebuilds LIVE (baseline) and REPO (migrations) in isolated in-memory PGlite and diffs their catalogs, ignoring comments and layout.
  - It also reports per-migration lineage.
  - `--replay` simulates what `db:push` would do to live.
- `supabase/tests/live-platform-shim.sql`: test-only stand-ins for the Supabase roles and `auth` objects the baseline references.
- `docs/governance/SCHEMA_DRIFT_REPORT.md`: the full M0.2 report.
- DEC-2026-023 (migration origin + `db:push` safeguard) and DEC-2026-024 (live-schema runtime incompatibilities, including the P1 latent paid-claim defect). Both are OPEN.

**Not changed:** no migration, application code, RLS, auth or payment change. Production was not touched by Claude Code. The P0 triage counts were run by the owner: mismatch 0, retry 0, 6 customers exposed. The candidate was downgraded to P1 (DEC-2026-024).

### M0.1 completion: audit gate resolved; M0.2 check (2026-09-30)
**Changed**
- `package-lock.json`: dev-only `brace-expansion` 1.1.18 → 1.1.21 and 5.0.9 → 5.0.12. This is DEC-2026-021 option A, approved by the owner, commit `c458a6f`.
  - Lockfile only. `package.json`, the audit gate and the runtime are unchanged. No allowlist or suppression.
  - The low `esbuild` advisory is deliberately left alone.

**Verified:** on a fresh clean clone with no `.env`, every M0.1 gate passes, including `npm audit --audit-level=high` (0 high) and `npm run ci` (exit 0). The bundle is 88.55 kB of the 90 kB cap.

**Governance**
- DEC-2026-021 → IMPLEMENTED — VERIFYING.
- DEC-2026-019 records the owner's direction: 88.55 kB is the current baseline and the cap is unchanged.
- **DEC-2026-022 (new): the M0.3 scope conflict, OPEN — HUMAN DECISION REQUIRED.** Neither position has been implemented.

**M0.2:** `supabase/baseline/000_live_baseline.sql` is still missing, so M0.2 stays BLOCKED. Nothing was inferred or created in its place.

### M0.1: CI & reproducibility scaffold (F8 / DEC-2026-007)
**Added**
- `.github/workflows/ci.yml`: runs these gates in order on every push and PR: `npm ci` → eslint → `tsc -b` → `vite build` → bundle check → `db:apply` (built-in idempotency pass) → `db:verify` → `rls-adversarial` → `test:payments` (outbound network denied) → gitleaks (full history, redacted) → `npm audit --audit-level=high`.
  - Read-only token and no secrets.
  - Actions pinned by commit; gitleaks 8.30.1 pinned by SHA-256.
  - Node from `.nvmrc`.
- `.nvmrc`: `22`.
- `scripts/check-bundle-size.mjs`: fails when the public Tap entry JS exceeds 90 kB gz (DEC-2026-019). CSS is reported only.
- `scripts/ci/deny-network.mjs`: fetch guard so tests cannot contact live services (IMP-003).
- `scripts/ci/secret-scan.mjs`: a fail-closed gitleaks wrapper that never prints matched text.
- `.gitleaksignore`: one fingerprint (DEC-2026-020).
- New `package.json` scripts: `ci`, `test:db`, `test:bundle`, `test:payments:ci`, `test:secrets`. Existing scripts are unchanged.

**Changed**
- `.github/CODEOWNERS`: owners (placeholders) for the new control files.
- `docs/DECISIONS.md`: implementation notes IMP-001…007.

**Verification records (added after the clean-clone CI run)**
- DEC-2026-021 (new, PROPOSED): the `npm audit` high gate fails on dev-tooling `brace-expansion` advisories that were published 2026-09-29. A lockfile-only fix was verified in a scratch clone but **not applied**; it is waiting for the owner's decision.
- DEC-2026-019 corrected: CI measures **88.55 kB** (clean build). The 89.57 kB figure came from a working folder that includes the local-only `.vite-source-tags.js` plugin.

### M0.0: Governance bootstrap (G0)
**Added**
- `docs/shygon-os/`: the approved SHYGON OS planning pack. All 34 files, verified byte-identical to `shygon-os-architecture-docs.zip`.
- `docs/governance/`: the eight governance templates, copied unchanged from the pack. The exception is `ROLE_ROSTER.md`, where every role is marked UNASSIGNED — HUMAN ACTION REQUIRED.
- `docs/governance/decisions/`:
  - DEC-2026-001: updated to OPEN — HUMAN ACTION REQUIRED and P0 triage, with metadata-only evidence.
  - DEC-2026-002: unchanged.
  - DEC-2026-019: bundle budget reconciliation (new).
  - DEC-2026-020: Web3Forms secret-scan exception (new).
- `docs/runbooks/P0_RUNBOOK_SHYGON_PRINT.md`: unchanged. Its content matches the pack's print PDF, and both carry the same pack timestamp.
- `docs/DECISIONS.md`: the decision index, seeded from the doc 13 §1.2 queue (DEC-2026-001…018), plus DEC-2026-019/020, the unnumbered queue and the open G0 human steps.
- `.github/pull_request_template.md`: unchanged from the pack.
- `.github/CODEOWNERS`: from the pack example, with **placeholder** `@role-*` handles clearly marked as not real accounts.

**Changed**
- `.gitignore`: now ignores `*.zip` and `.claude/settings.local.json`.

### v5-baseline: 2026-09-30 (commit `8becea3` on `main`)
- A byte-exact import of the V5 working tree as found.
- Excluded from git: `.env`, `.env.*` (except `.env.example`), `*.zip`, `.claude/settings.local.json`.
