# Changelog

This file records changes to this repository, newest first. Entries name the doc 12 milestone and the finding or decision ids involved.
Nothing below has been deployed, and no migration has been applied anywhere except local PGlite.

## [Unreleased]: branch `feat/m0-governance-ci` (not merged)

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
