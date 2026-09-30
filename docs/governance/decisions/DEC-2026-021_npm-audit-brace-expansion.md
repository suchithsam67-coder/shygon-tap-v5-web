# DEC-2026-021: The `npm audit` high-severity gate fails on dev-tooling `brace-expansion`

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). Draft written under doc 12 §0 rule 8: a new requirement (the M0.1 audit gate) conflicts with the existing code, so Claude Code stopped instead of changing dependencies.

| Field | Value |
|---|---|
| Decision ID | DEC-2026-021 |
| Title | Remediate or accept the HIGH `brace-expansion` advisories that fail the M0.1 `npm audit` gate |
| Date opened | 2026-09-30 |
| Domain | Engineering (dependencies); Security consulted |
| Level | L1. The proposed fix is lockfile-only, touches dev tooling, and is reversible. |
| Original owner | Engineering Owner |
| Escalated to | — |
| **Accountable Owner (A)** | Engineering Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Did accountability change on escalation? (G§2.3) | No |
| Responsible (R) | Claude Code (would implement once approved) |
| Consulted (C) | Security Owner (UNASSIGNED) |
| Informed (I) | Release Owner (UNASSIGNED) |
| State | **IMPLEMENTED — VERIFYING.** Option A was approved by the repository owner on 2026-09-30 and implemented in `c458a6f`. The gate is green on a clean local clone; the first GitHub CI run is pending the human push. The Engineering Owner (UNASSIGNED) should re-confirm once named. |

## Priority (G§13–15)
| Impact 0–3 | Urgency 0–3 | Irreversibility 0–3 | Risk 0–3 | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 1 | 2 | 0 | 1 | 4 | P2 | P2 | **P2** |

Decision deadline: 2026-10-14 (GAP-4 proposal). In practice it is needed before the M0.0/M0.1 phase gate can pass.

## Question
The CI gate `npm audit --audit-level=high` fails on the unchanged V5 lockfile. Should the lockfile be updated to the patched versions, or should something else happen?

## Context & evidence
**OBSERVED**
- **The failure:** `npm audit --audit-level=high` exits 1 with "2 vulnerabilities (1 low, 1 high)". It fails both on the clean clone and on the working folder, which have identical `package-lock.json` files.
- **High:** `brace-expansion`, a transitive dev dependency, has these advisories:

  | Advisory | Severity | Vulnerable range | Published |
  |---|---|---|---|
  | GHSA-qhr7-859c-m2p7 | high | < 1.1.20 and 4.0.0 – < 5.0.11 | 2026-09-29 23:45 UTC |
  | GHSA-6j4f-fj2g-mc7p | high | < 1.1.19 and 4.0.0 – < 5.0.10 | 2026-09-29 23:44 UTC |
  | GHSA-q2hr-2g5m-vwhr | moderate | < 1.1.21 and 4.0.0 – < 5.0.12 | 2026-09-29 23:45 UTC |

  All are denial-of-service issues in brace parsing.
- **Low (below the gate threshold):** `esbuild` GHSA-g7r4-m6w7-qqqr, which affects only the Windows dev server.
- **Dependency paths:** both go through lint tooling only.
  - `eslint@9.39.4 → minimatch@3.1.5 → brace-expansion@1.1.18`
  - `typescript-eslint@8.61.1 → @typescript-eslint/typescript-estree@8.61.1 → minimatch@10.2.5 → brace-expansion@5.0.9`
- **Production is not affected:** `npm audit --omit=dev --audit-level=high` exits 0. Nothing shipped to browsers or run by the server functions is affected.
- **Why a baseline check earlier the same day passed:** the audit database picked these advisories up between the two runs. The code did not change. An audit gate depends on an external, changing database, so it can turn red with no code change. That is the intended fail-closed behaviour.
- **Trial fix, run in a scratch clone only and not committed:** `npm audit fix` (no `--force`).
  - It changes only `package-lock.json` (6 lines): `brace-expansion` 1.1.18 → 1.1.21 and 5.0.9 → 5.0.12, both within existing semver ranges.
  - `package.json` is unchanged.
  - Afterwards `npm audit --audit-level=high` exits 0, and `eslint .` and `tsc -b` still pass.

## Options
### Option A: apply the lockfile-only fix (recommended)
- Benefits: removes the vulnerability rather than hiding it, and keeps the gate as the spec defines it.
- Risks: minimal. These are patch versions of a lint-only transitive dependency.
- Cost: minutes. It would be one commit on `feat/m0-governance-ci`, `build(deps): patch brace-expansion (DEC-2026-021)`, followed by the full CI run.
- Reversibility: revert the commit.

### Option B: gate on production dependencies only (`--omit=dev`)
- Benefits: CI goes green without touching dependencies.
- Risks: **it weakens a security gate.** Dev-tooling vulnerabilities (the CI supply chain) would go unseen, and it deviates from the spec's `npm audit --audit-level=high`.
- Not recommended.

### Option C: keep the gate red until M0.5 (secrets and hygiene)
- Benefits: no change now.
- Risks: M0.1 cannot be accepted, and every run stays red, which trains people to ignore red.

## Impact assessment
- Security impact: positive with A; negative with B.
- Data impact: none.
- Product impact: none, because only dev tooling is involved.
- Architecture impact: none.
- Operational impact: CI stays red until this is decided.
- Irreversible? No.

## Decision
- **Decision:** Option A, the lockfile-only patch, exactly as tested in the scratch clone.
- Expected outcome: `npm audit --audit-level=high` exits 0 in CI.
- Required approvals: the repository owner approved on 2026-09-30. Engineering Owner: UNASSIGNED, re-confirmation pending (HUMAN ACTION REQUIRED).
- Blockers: none. The first GitHub CI run needs the human push.
- Next action: the named Engineering Owner re-confirms.
- Decision date: 2026-09-30

**Implementation:** commit `c458a6f`, `build(deps): patch dev-only brace-expansion (DEC-2026-021)`.
- `package-lock.json` only: 6 lines, `brace-expansion` 1.1.18 → 1.1.21 (parent requires `^1.1.7`) and 5.0.9 → 5.0.12 (parent requires `^5.0.5`).
- `package.json` is unchanged.
- No allowlist or suppression. The gate command is unchanged.
- The remaining low `esbuild` advisory (GHSA-g7r4-m6w7-qqqr) is below the gate threshold. It was deliberately left alone (no unrelated upgrades).

## Result (filled at review date)
- **Observed result (2026-09-30, fresh clean clone of `c458a6f`, no `.env`, Node 20.18):**
  - `npm ci`, lint, `tsc -b`, build: pass.
  - Bundle: 88.55 kB of 90 kB.
  - `db:apply`: pass. `db:verify`: 23/23. `rls-adversarial`: 48/48. `verify-011`: 16/16.
  - `test:payments:ci`: 15/15 and 13/13, with 1 check blocked on Node < 22.
  - gitleaks: 5 commits, 0 findings.
  - **`npm audit --audit-level=high`: exit 0** (1 low).
  - `npm run ci`: exit 0.
- Reviewed on / by: 2026-09-30, Claude Code (evidence). Human review pending.
- Lesson for institutional memory: an audit gate can turn red with no code change, so treat it as a monitor as well as a gate.
