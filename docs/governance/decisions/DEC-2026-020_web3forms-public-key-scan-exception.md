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

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
