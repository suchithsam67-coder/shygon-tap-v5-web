# Changelog

This file records changes to this repository, newest first. Entries name the doc 12 milestone and the finding or decision ids involved.
Nothing below has been deployed, and no migration has been applied anywhere except local PGlite.

## [Unreleased]: branch `feat/m0-governance-ci` (not merged)

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
