# DEC-2026-020: Secret-scan exception for one Web3Forms public access key

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). **The key value does not appear in this record and must never be added.**

| Field | Value |
|---|---|
| Decision ID | DEC-2026-020 |
| Title | Allow exactly one gitleaks finding: the Web3Forms public access key in dead code |
| Date opened | 2026-09-30 |
| Domain | Security (a secret-scanning control) |
| Level | L3 (it changes a security gate) |
| Original owner | Security Owner |
| Escalated to | — |
| **Accountable Owner (A)** | Security Owner: **UNASSIGNED — HUMAN ACTION REQUIRED**. The repository owner decided in the Security Owner's place; the named Security Owner must re-confirm it. |
| Did accountability change on escalation? (G§2.3) | No |
| Responsible (R) | Claude Code (implementation only) |
| Consulted (C) | — |
| Informed (I) | Release Owner (UNASSIGNED) |
| State | **APPROVED by the repository owner, 2026-09-30, in session.** Pending re-confirmation by the named Security Owner (HUMAN ACTION REQUIRED). |

## Priority (G§13–15)
| Impact 0–3 | Urgency 0–3 | Irreversibility 0–3 | Risk 0–3 | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 0 | 0 | 0 | 1 | 1 | P3 | P3 | **P3** |

## Question
gitleaks 8.30.1 flagged a real (not fake) key in the V5 baseline. How should that one finding be handled without disabling secret scanning?

## Context & evidence
**OBSERVED**
- **The finding:** rule `generic-api-key` at `src/components/ProjectConsultation.tsx:75`, in baseline commit `8becea30cd584ba636dce662df59a95247f5443c`.
- **What it is:** a hard-coded Web3Forms `access_key` of 36 characters. The value was never displayed; the scan ran with `--redact=100`.
- **Vendor position:** the Web3Forms FAQ says "Access key is public". It adds that a holder can only send emails to the form owner (https://docs.web3forms.com/getting-started/faq).
- **The component is dead code.** It is imported only by `src/pages/Home.tsx`, and nothing imports that page.
- **It is not shipped:** the value is absent from a `vite build` of `v5-baseline`. Earlier deployments were not checked.
- **No other findings:** gitleaks found nothing else in the baseline. The fake fixtures in `netlify/tests/` do not match the default rules, so no allowlist is needed for them.

**Owner rule (2026-09-30):** an allowlist may contain only intentionally fake/test credentials, and a real secret is never allowlisted. This key is real but public by design, so it needed an explicit decision.

## Options
- **A: narrow single-fingerprint exception (chosen).** One `.gitleaksignore` line matching this exact commit, file, rule and line. No `.gitleaks.toml`, no regex or path allowlist. Any other key anywhere, including a changed key on that line in a later commit, still fails CI.
- B: treat it as a secret. Regenerate the Web3Forms key, then give the revoked value the same fingerprint entry.
- C: no exception. The secret-scan gate stays red, and M0.1 is BLOCKED.

## Impact assessment
- Security impact: negligible. The key can only submit forms to the owner's inbox (spam risk). Secret scanning stays fail-closed for everything else.
- Data impact: none.
- Product impact: none; the component is not rendered.
- Architecture impact: none.
- Operational impact: none.
- Irreversible? No. Delete the `.gitleaksignore` line to revoke the exception.

## Decision
- **Decision:** Option A, a single fingerprint in `.gitleaksignore`:
  `8becea30cd584ba636dce662df59a95247f5443c:src/components/ProjectConsultation.tsx:generic-api-key:75`
- Expected outcome: the full-history gitleaks gate passes with this one exception and fails on any other finding.
- Required approvals: repository owner, 2026-09-30, approved. Security Owner: UNASSIGNED, re-confirmation pending.
- Blockers: none.
- Next actions (HUMAN ACTION REQUIRED, none of them blocking M0.1):
  1. The named Security Owner re-confirms this decision.
  2. Optionally enable Web3Forms domain restriction, or remove the dead `ProjectConsultation`/`Home` code in a later, scoped change (not in M0.0/M0.1).
  3. If the form is ever abused, regenerate the key in Web3Forms.
- Decision date: 2026-09-30

## Provenance check: a second occurrence (2026-10-02; the value is not shown)

**Trigger:** the full-history gitleaks gate (`npm run test:secrets`, `--log-opts=--all`) failed with one finding:
- rule `generic-api-key`;
- `src/components/ProjectConsultation.tsx:75`;
- commit `9c8caa7932819e3fc3cea0023630d396000f8f79`.

This exception's fingerprint names only commit `8becea3…`, so the occurrence in the new commit is reported.

**Verification** (hashes and lengths only; the value was never printed):

| Commit | File blob | Line 75 | Token length | sha256 of token (first 16 hex) |
|---|---|---|---|---|
| `8becea3` (approved by this record) | `89563fa` | `access_key` line | 36 | `1db0669d4873b662` |
| `9c8caa7` (flagged) | `89563fa` | `access_key` line | 36 | `1db0669d4873b662` |
| `89f1bc2` | `89563fa` | same | 36 | `1db0669d4873b662` |
| `27aa5e2` | `89563fa` | same | 36 | `1db0669d4873b662` |

**Result:** the flagged value is **exactly the public Web3Forms key this record approved**. The whole file is the same git blob in all four commits. It is not a new secret, and not a P0. gitleaks reports only `9c8caa7`, the root commit that introduced the line on those branches.

**Where the flagged commit comes from (OBSERVED; git metadata only):**
- `9c8caa7` is a root commit, "chore(import): SHYGON Tap V5 snapshot shygon-tap-v5-web-2026-09-28-final.zip, as found", on branch `import/v5-2026-09-28-final`.
- `89f1bc2` ("upgrade zip … 2026-09-29-upgraded.zip, as found") on `import/upgraded-zip-2026-09-29` descends from it.
- `fix/upgraded-zip` merges `89f1bc2` onto `c31f9df` (merge commit `27aa5e2`). It is checked out in a second worktree, `../shygon-tap-v5-web-upgrade-fix`.
- Branch reflogs show these refs were created locally on 2026-10-02 between 15:49:46 and 15:57:09 IST, outside the Claude Code session that maintains this record. The commits' own dates are set to the ZIP dates.
- No `.env`, key or credential-type file is tracked in any commit of those branches.
- None of them is merged into `feat/m0.3-security-identity`, which scans clean on its own (17 commits).
- **Whether this worktree and its branches are expected is awaiting the repository owner's confirmation.**

**Not changed:** `.gitleaksignore` (owner instruction: do not modify the ignore configuration yet). Until the owner decides, the full-history gate stays red on these branches. Options for the Security Owner (the repository owner under DEC-2026-018):
- (a) extend this exception with a second fingerprint for `9c8caa7…:src/components/ProjectConsultation.tsx:generic-api-key:75` (the same value);
- (b) keep these branches out of the repository whose history the gate scans;
- (c) another option the owner defines.

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
