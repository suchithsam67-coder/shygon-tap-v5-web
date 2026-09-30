# Changelog

This file records changes to this repository, newest first. Entries name the doc 12 milestone and the finding or decision ids involved.
Nothing below has been deployed, and no migration has been applied anywhere except local PGlite.

## [Unreleased]: branch `feat/m0-governance-ci` (not merged)

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
