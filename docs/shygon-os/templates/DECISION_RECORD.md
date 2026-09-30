# DEC-YYYY-NNN — <title>

> G§11 decision record + G§71 priority fields + expected/observed result (doc 14 §3.2).
> One decision → exactly ONE Accountable Owner (G§5).

| Field | Value |
|---|---|
| Decision ID | DEC-YYYY-NNN |
| Title | |
| Date opened | |
| Domain | Product / Architecture / Security / Data / Engineering / QA / Release |
| Level | L0 / L1 / L2 / L3 (doc 13 §3) |
| Original owner | |
| Escalated to | (blank if not escalated) |
| **Accountable Owner (A)** | (exactly one person/role) |
| Did accountability change on escalation? (G§2.3) | Yes / No |
| Responsible (R) | |
| Consulted (C) | |
| Informed (I) | |
| State | PROPOSED / TRIAGED / ASSIGNED / UNDER_REVIEW / DECIDED / APPROVED / IMPLEMENTING / VERIFYING / CLOSED (BLOCKED / ESCALATED / REJECTED / ROLLED_BACK) |

## Priority (G§13–15)
| Impact 0–3 | Urgency 0–3 | Irreversibility 0–3 | Risk 0–3 | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

Reason if the final priority is lower than max(score, matrix): ______________________
Decision deadline: ____________ (P1 ≤ 2 business days · P2 ≤ 10 · P3 next planning)

## Question

## Context & evidence
(Separate OBSERVED / HYPOTHESIZED / CONFIRMED — G§67)

## Options
### Option A — <name>
- Benefits:
- Risks:
- Cost:
- Time:
- Reversibility:

### Option B — <name>
- Benefits:
- Risks:
- Cost:
- Time:
- Reversibility:

## Impact assessment
- Security impact:
- Data impact:
- Product impact:
- Architecture impact:
- Operational impact:
- Irreversible? If yes, complete G§78: why required · what can go wrong · how tested · how reversed · who approved

## Decision
- Decision:
- Expected outcome (what we expect to observe, and when to check):
- Required approvals: (role — name — date — approved/rejected)
- Blockers:
- Next action (owner, date):
- Decision date:

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
