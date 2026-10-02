# SHYGON OS: M0.3 Implementation Scope

| | |
|---|---|
| Date | 2026-10-02 |
| Status | **Scope recorded; points 1–5 confirmed; go-ahead given 2026-10-02.** Implementation proceeds unit by unit and stops on any stop condition (§7). |
| Authorized by | The approvals recorded on 2026-10-02 (repository owner, in session); see §1 |
| Branch (proposed) | `feat/m0.3-security-identity`, created from the approvals commit on `feat/m0-governance-ci`. Nothing is merged to `main`; there is no remote. |
| Control model | DEC-2026-018 Option B. Every L3 unit below gets a 24-hour cool-off and a checklist review by the owner before approval. Claude Code never merges, applies migrations or deploys. |

---

## 1. Approved decision matrix (as recorded in the governance files)

| Decision | Recorded state | Used by M0.3 | What it authorizes |
|---|---|---|---|
| DEC-2026-001 | OPEN (rotation **NOT DONE**). The doc 12 §2A gate is **WAIVED for M0.3 only** | Yes | Repository and local work for M0.3. **Not:** production apply, deployment, live payments or any credential use |
| DEC-2026-018 | **APPROVED, Option B** (one-person model) | Yes | The owner approves L3 changes after a 24-hour cool-off + checklist |
| DEC-2026-022 | **APPROVED, Position A** (F1 + F3 + F4; F2 to the backlog). Q2 and Q3 **OPEN** | Yes | F1 fix. F3 verification. F4 verification and design |
| DEC-2026-023 | **APPROVED, Option A + S1** | Yes | Suites on the live baseline; `020+` migrations; `db:push` allowlist guard |
| DEC-2026-024 | **APPROVED, Option A for I-1…I-3** (interpretation note in the record). I-4 **OPEN**; I-5 VERIFY | Yes | Database-side `customer_id` resolution |
| DEC-2026-029 | **APPROVED, Option A** (B1–B7) | Yes | The identity contract and its contract tests |
| Authorization block | Database **YES** · RLS **YES** · Payment changes **YES** (test mode; live activation **NOT AUTHORIZED**) · Auth **NO** (not given) · M1.1 **NO** (not given) · Deployment **NO** · Production data modification **NO** | — | "Database / RLS / payment changes" means repository files and local PGlite only |
| DEC-2026-002, 019, 025, 026, 027, 028, 030, 031, 032 | PROPOSED | **No** | Nothing |

---

## 2. Points confirmed by the owner (2026-10-02, explicit answer "Confirm 1–5, start U1")

1. **DEC-2026-024 = Option A.** You approved "the documented … fix direction". The record documents Option A as its advisory direction, so it was recorded as Option A. If you meant B, C or D, say so before unit U4.
2. **DEC-2026-024 and DEC-2026-029 are scheduled inside M0.3.**
   - Neither DEC-022 position included them.
   - You approved them as part of "the minimum approval set required to unblock M0.3", and your previous instruction (§5 A–B) placed them in M0.3.
   - This is recorded as a deviation from doc 12 §3 (DEC-022 Q5), not a silent renumbering.
3. **The F1 guard mechanism.** Doc 12 §3 M0.3 leaves the choice to the implementer: "pick one, document, test both paths". The proposal:
   - the guard checks the **calling database role**;
   - direct client writes run as `authenticated`/`anon` and are refused;
   - the existing admin RPCs are `SECURITY DEFINER`, so they run as the function owner and keep working.
   - This needs **no change to any frozen `admin_*` function body**. The other option (an `app.admin_action` setting inside the admin RPCs) would edit them.
4. **Client-supplied `customer_id` (DEC-029 B2).**
   - A client value equal to the row's own auth user id is **mapped** to `customers.id`. That is DEC-024 Option A as written.
   - Any other client value that is not the caller's own `customers.id` is **refused (42501)**. That is B2: "never accepted from a client".
   - Server-side writes are mapped the same way, and otherwise left alone.
5. **REVERSED by owner decision D-U4 (2026-10-02, O-12): `provision_tap_on_payment()` is changed in U4 so that the Tap provisioned on first payment is an unpublished draft.** Its `customer_id` value is still corrected by the normalisation trigger. See `M0_3_U1_BASELINE_FINDINGS.md` §3 and §5.

---

## 3. Exact M0.3 scope (units, in order)

Each unit ends with: tests written, all gates in §5 green (or a stop), a focused commit naming the decision, and a CHANGELOG entry.

### U1: Database suites on the live baseline (DEC-2026-023 Option A)
- A new shared builder loads `live-platform-shim.sql` + `000_live_baseline.sql`, then `supabase/migrations/0[2-9]*.sql` (`020+`). 001–019 are never re-run.
- `db:apply` uses it, and keeps the idempotency pass (`020+` run twice).
- `db:verify` and `rls-adversarial` use it.
  - **Fixtures** are adapted to the live table shapes: `customers` rows, `cards.card_id`, NOT NULL `customer_id`.
  - **Assertions are not changed.**
- **Stop rule:** run first and report. A check that fails because of a real live finding is listed.
  - F1-class failures are expected and turn green in U3.
  - Any failure outside M0.3 scope stops the unit, for an owner decision. Nothing is weakened.
- `supabase/migrations/README.md` (new): 001–019 are "applied on live, history only, never re-run"; new work starts at `020_`, on the baseline.
- No change to `supabase/tests/baseline.sql`, which `schema-drift.mjs` and `verify-011` still use.

### U2: `db:push` safeguard (DEC-2026-023 S1)
- `apply-remote.mjs` refuses before any network call unless `SUPABASE_PROJECT_REF` is in a committed non-production allowlist, or `--i-know-this-is-not-production` is passed.
  - The allowlist is `supabase/non-production-projects.json`, empty by default.
- Under Option A it applies **only `020+`**, never 001–019.
- The refusal message stops recommending `APPLY_ALL.sql` (the same replay hazard by hand).
- The guard is tested without network access.

### U3: F1, customer cannot un-suspend their own Tap or account (DEC-2026-022 Position A)
- **Verify first** on the baseline (expected, STATIC): an owner can clear `tap_profiles.suspended_at/_reason/_by` and `profiles.suspended_at/_reason` by direct UPDATE (`*_update_own` policies; `GRANT ALL` to `authenticated`; no guard trigger).
- **Migration `020_guard_suspension_columns.sql`** (name per doc 12 §3):
  - adds a BEFORE UPDATE trigger function and triggers on `tap_profiles` and `profiles`;
  - they raise `42501` when a direct client role changes those columns;
  - no policy, grant or existing function is changed.
- **Not guarded:**
  - The legacy `tap_profiles.suspended` boolean: no live function or repository code reads it (OBSERVED). Whether the Admin APK does is unknown (DEC-2026-016).
  - `tap_profiles.status`: live has no "suspended" status value, so doc 12's "status moving out of a suspended state" does not apply.

### U4: Identity contract + P1 payment/fulfilment defect (DEC-2026-029 A, DEC-2026-024 A)
- **Reproduce first** on the baseline:
  - I-1: the first-time-buyer claim fails with `23503`;
  - I-2: a profile save fails;
  - I-3: the safety-net persona insert fails.
- **Migration `021_resolve_customer_id.sql`:**
  - `customer_id_for(uuid)`: a definer helper that returns, or creates, the user's `customers.id`, using the same `CUST-…` code format as live `handle_new_user`. It is not executable by `anon`, `authenticated` or `PUBLIC`.
  - A BEFORE INSERT / UPDATE OF `customer_id` trigger on `profiles` and `tap_profiles` applies the §2 point 4 rule.
  - **Changed in U4 by D-U4:** `provision_tap_on_payment` creates the Tap as a draft (`status='draft'`, `published=false`) instead of publishing it. The frozen signature, trigger and other behaviour are unchanged; an admin-contract snapshot proves the signature.
  - **No change to:** `handle_new_user`, any policy or grant on existing tables, or `fulfilment.mjs`, `Settings.tsx`, `Checkout.tsx`, `create-order.mjs`.
- **Identity audit, recorded in the U4 report:**
  - `orders.customer_id` keeps holding the auth user id (FK `auth.users`). It is correct and is not renamed.
  - `cards.customer_id` has no writer and is unchanged.
  - `tap_profiles.user_id` stays nullable. A constraint needs a VERIFY ON LIVE count and a separate decision.

### U5: F3, card state vs the public Tap (verify only; DEC-2026-022 Q2 OPEN)
- Characterization tests: with all of a user's cards suspended or "expired", `/t/<slug>` output stays identical. This documents F3 as open, inside the golden suite.
- A verification report lists the minimal-fix choices the owner must make: the rule 4 amendment, multi-card semantics (doc 08 §6 OQ-2b), DEC-2026-002 expiry interplay, and the Terms text (O-8).
- **No change to `get_public_profile`, `/t/:slug` or the renderer.**

### U6: F4, OTP sent to an unverified phone (verify + design only; DEC-2026-022 Q3 OPEN; Auth changes NOT authorized)
- A verification report covers F4 and O-3: the activation code is readable by its owner and accepted without OTP by `customer_activate_card` / `customer_deactivate_card`.
- `docs/shygon-os/M0_3_F4_FACTOR_BINDING_DESIGN.md`: the factor-binding options and their own test list (owner specification §9–§10).
- **No change to `card-otp.mjs`, auth or the card RPCs.**

### U7: F2 to the backlog + M0.3 report
- `docs/governance/SECURITY_REMEDIATION_BACKLOG.md` (new): F2 (customers can read internal admin notes), plus pointers to O-1…O-11.
- `docs/shygon-os/M0_3_REPORT.md`: the release-readiness report in the required format.
- Updates to `docs/CHANGELOG.md` and `docs/DECISIONS.md`.

---

## 4. Files and migrations

**New migrations (repository and local PGlite only; never applied to production by Claude Code):**
- `supabase/migrations/020_guard_suspension_columns.sql` (U3)
- `supabase/migrations/021_resolve_customer_id.sql` (U4)

Each has a header (purpose, decision, rollback SQL, dependencies, data class). Each is idempotent, pins `search_path` in every function, and revokes `PUBLIC` on new functions. No `DROP TABLE`, `TRUNCATE`, rename or data backfill.

> `M1_DATABASE_PLAN.md` §6 proposed `020`–`022` for M1.1 objects. That plan is unapproved (DEC-2026-026), so its numbers shift when it is decided. Doc 12 §3 (approved) assigns `020` to the F1 guard.

**New files:**
- `supabase/tests/lib/live-db.mjs` (shared builder)
- `supabase/tests/identity-contract.mjs`
- `supabase/tests/golden-public-tap.mjs` + `supabase/tests/golden/public-tap.json`
- `supabase/tests/admin-contract.mjs` + `supabase/tests/golden/admin-contract.json`
- `supabase/tests/db-push-guard.mjs`
- `supabase/non-production-projects.json`
- `supabase/migrations/README.md`
- `docs/governance/SECURITY_REMEDIATION_BACKLOG.md`
- `docs/shygon-os/M0_3_F4_FACTOR_BINDING_DESIGN.md`
- `docs/shygon-os/M0_3_REPORT.md`

**Modified files:**
- `supabase/tests/apply.mjs`, `verify.mjs`, `rls-adversarial.mjs` (builder + live-shape fixtures; F1 tests added to `rls-adversarial.mjs` per doc 12)
- `supabase/tests/apply-remote.mjs` (S1)
- `package.json` (scripts only)
- `.github/workflows/ci.yml` (new steps)
- `docs/CHANGELOG.md`, `docs/DECISIONS.md`

**Not touched:**
- `supabase/migrations/001–019`, `supabase/baseline/000_live_baseline.sql`, `supabase/tests/baseline.sql`;
- all of `netlify/`, `api/` and `src/` (including `fulfilment.mjs`, `card-otp.mjs`, checkout and verify-payment);
- `get_public_profile` and every other frozen function;
- the public Tap bundle;
- `.env` and any credential;
- `package-lock.json` (no dependency change).

---

## 5. Tests and gates

**New tests (all must fail before the fix, where a defect exists, and pass after):**

| Area | Cases |
|---|---|
| F1 (in `rls-adversarial.mjs`) | **Adversarial:** an owner cannot clear or alter `suspended_at` / `_reason` / `_by` on their Tap or account. **Positive:** an owner can still edit their normal fields (display name, links, theme, publish or pause). An admin can suspend and restore through `admin_set_tap_suspension` / `admin_set_customer_suspension`. The service role is unaffected. A non-admin calling the admin RPCs is still refused. |
| Identity and fulfilment (`identity-contract.mjs`) | Successful paid claim for a first-time buyer (I-1) creates the persona with the correct `customers.id`. A claim for a buyer who already has a persona leaves it unchanged. A failed payment (`payment_status='failed'`) fires no provisioning. Fulfilment failure leaves no partial persona (the transaction rolls back). A retry (`retry → paid`) is idempotent. A duplicate claim or duplicate webhook matches 0 rows and creates no second persona. **Missing customer:** a user with no `customers` row gets one created, exactly one. **Missing Tap profile:** provisioned on claim. A profile save with `customer_id = auth user id` succeeds and stores `customers.id` (I-2). A client sending another customer's id is refused with `42501`. The safety-net insert stores `customers.id` (I-3). A sign-up still creates the customer and profile. Every run is executed twice (idempotency). |
| Golden `/t/` (`golden-public-tap.mjs`) | `get_public_profile` and `get_public_tap_state` JSON are byte-identical before and after `020` and `021`, including the F3 characterization cases |
| Admin contract (`admin-contract.mjs`) | The signature and return type of every `admin_*` function and the doc 12 §2 frozen functions are unchanged |
| `db:push` guard (`db-push-guard.mjs`) | Refused without the allowlist or flag. Refused with an unknown ref. No network call is attempted. Only `020+` is selected. |

**Gates run after every unit (local), then once on a clean clone with no `.env`:**
1. `npm run lint`
2. `npx tsc -b`
3. `npx vite build`
4. `npm run test:bundle` (public Tap JS must stay 88.55 kB)
5. `npm run db:apply` (baseline + `020+`, twice)
6. `npm run db:verify`
7. `node supabase/tests/rls-adversarial.mjs`
8. the new suites above
9. `npm run test:payments:ci` (unchanged code; outbound network blocked)
10. `npm run test:secrets` (gitleaks 8.30.1, full history)
11. `npm audit --audit-level=high`

`schema-drift.mjs` is re-run for the record.

**Known limitations of the gates:**
- One `functions-security` check needs Node 22, and the local machine runs Node 20.18. It runs in GitHub CI, which needs the repository to be created and pushed (human).
- Nothing is verified against production.

---

## 6. Explicitly blocked (not done in M0.3)

| Item | Blocked by |
|---|---|
| **F3 fix:** any change to `/t/<slug>` or `get_public_profile` | DEC-2026-022 Q2; DEC-2026-002; OQ-2b; doc 12 §0 rule 4 |
| **F4 fix:** OTP factor binding, verified contacts, the O-3 activation-code exposure | DEC-2026-022 Q3; **Auth changes not authorized** |
| O-7: owner can undo admin or expiry card suspension | DEC-2026-028, DEC-2026-002 (card lifecycle; not approved) |
| Card lifecycle, the `status` CHECK, `device_transition()`, `/d/:code`, `tap_routes` | DEC-2026-028, DEC-2026-002, OQ-2b |
| DEC-2026-024 **I-4:** card records not created for paid orders | DEC-2026-028 + DEC-2026-002 (+ finding E-3) |
| DEC-2026-024 **I-5:** pgcrypto location; the trigger-state confirmation | VERIFY ON LIVE (human, read-only) |
| F2: admin notes visible to customers | Moved to the backlog by DEC-2026-022 |
| O-1 (`require_admin` executable by anon); `APPLY_ALL.sql` / `db:bundle` replay hazard | M0.4 (not authorized) |
| `tap_profiles.user_id` NOT NULL / FK; regenerating `database.types.ts` | No decision; VERIFY ON LIVE count |
| M0.4–M0.9; **M1.1** | DEC-2026-026; "M1.1 authorized: NO" |
| **Applying `020`/`021` to production** | Human only, after the cool-off, and after rotation (DEC-2026-001) or a written extension of the waiver |
| **Live payments; deployment; production data modification** | Not authorized. G-PAY requires DEC-024 fixed **and verified on production**, rotation, K5 and G2 |
| Organisations, environments, OS dashboard, providers, taxonomy | DEC-2026-025, 027, 030, 031, 032 |

## 7. Stop conditions during implementation
Claude Code stops and reports, changing nothing further, if any of these happens:
- a baseline-mode suite fails on a finding outside M0.3;
- a fix would need a change to a frozen function body, policy or grant not listed here;
- the golden or admin-contract snapshot changes;
- the bundle grows;
- any test would have to be weakened;
- a secret appears;
- any step would need production access or a credential.
