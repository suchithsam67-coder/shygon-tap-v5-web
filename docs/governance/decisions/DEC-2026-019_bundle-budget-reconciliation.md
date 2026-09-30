# DEC-2026-019: Bundle budget reconciliation (public Tap entry JavaScript)

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). One decision → exactly ONE Accountable Owner (G§5).

| Field | Value |
|---|---|
| Decision ID | DEC-2026-019 |
| Title | Bundle budget reconciliation: 90 kB cap vs "current + 5 kB" |
| Date opened | 2026-09-30 |
| Domain | Architecture (public renderer contract, doc 12 §2) |
| Level | L1 (CI threshold; reversible). Raising it affects every tap on a printed card, so a human decides. |
| Original owner | Principal Architect |
| Escalated to | — |
| **Accountable Owner (A)** | Principal Architect: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Did accountability change on escalation? (G§2.3) | No |
| Responsible (R) | Engineering Owner (UNASSIGNED) |
| Consulted (C) | Product Owner, Release Owner (UNASSIGNED) |
| Informed (I) | QA Owner (UNASSIGNED) |
| State | **PROPOSED — HUMAN ACTION REQUIRED**. The gate is implemented at the M0.1 cap, per the owner's instruction of 2026-09-30. The cap is not raised silently. |

## Priority (G§13–15)
| Impact 0–3 | Urgency 0–3 | Irreversibility 0–3 | Risk 0–3 | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 0 | 1 | 3 | P3 | P2 (Medium × Medium, as F2/F5 in doc 13 §1.2) | **P2** |

Reason if the final priority is lower than max(score, matrix): n/a. The final priority is the higher of the two.
Decision deadline: **2026-10-14** (P2 ≤ 10 business days, using doc 13 §4 / GAP-4, which is itself still a proposal). It is needed **before M1.2**, which adds a resolver client to the public renderer.

## Question
Which budget should the public Tap entry-JavaScript gate enforce? Doc 12 contains two different rules, and today's bundle is 0.43 kB under the stricter one.

## Context & evidence
**OBSERVED**
- **The measurement** was taken from a `vite build` of `v5-baseline` on 2026-09-30 (local Node 20.18). It counts the JS that `dist/index.html` loads before the public Tap renders (module entry + modulepreload), gzip-sized the way Vite reports it (zlib default level, 1 kB = 1000 B):

  | File | Gzip size |
  |---|---|
  | `assets/index-*.js` | 15,563 B |
  | `assets/react-*.js` | 74,009 B |
  | **Total** | **89,572 B = 89.57 kB** |

- **CSS:** `assets/index-*.css` is 59,543 B gz. It is reported but not gated, because M0.1 caps JavaScript only.
- **Doc 01 §1** records the entry bundle as "~84 kB gzip". It does not say how that was measured.
- **Doc 12 §3 M0.1:** "bundle-size check (public Tap chunk ≤ 90 kB gz)".
- **Doc 12 §2** (contract freeze) says: "Bundle ≤ current +5 kB gz (CI gate)". That is about 94.57 kB against today's measurement.
- **The gap today:** 90,000 − 89,572 = **428 B (0.43 kB) of headroom** under the M0.1 cap.

**HYPOTHESIZED (not investigated)**
- The gap between ≈84 kB and 89.57 kB is either a difference in method (unit or gzip level) or code growth since the audit.

## Options
### Option A: keep the 90 kB hard cap (implemented now)
- Benefits: this is the literal M0.1 rule, and it forces a decision before the public renderer grows.
- Risks: M1.2 (resolver client) will very probably exceed 428 B and fail CI until this DEC is decided.
- Cost: none now. Time: none. Reversibility: a one-line constant.

### Option B: cap = baseline + 5 kB (≈ 94.57 kB), per doc 12 §2
- Benefits: room for M1.2 without optimisation work.
- Risks: a heavier first load for every tap, and it drifts further from the ≈84 kB figure.
- Cost: none. Reversibility: a one-line constant.

### Option C: keep 90 kB and win headroom by optimising the entry bundle
- Benefits: keeps the stricter budget.
- Risks: touches the frozen public renderer and bundle config, which is out of scope for M0.0/M0.1 (owner instruction: no unrelated optimisation to create artificial headroom).
- Cost: engineering time in its own milestone. Reversibility: yes.

## Impact assessment
- Security impact: none.
- Data impact: none.
- Product impact: time to first render of every tap, which is card-visible.
- Architecture impact: sets the budget M1.2 must design within.
- Operational impact: CI goes red when the budget is exceeded.
- Irreversible? No.

## Decision
- Decision: ________ (HUMAN ACTION REQUIRED)
- Expected outcome: ________
- Required approvals: Principal Architect (UNASSIGNED); Product Owner consulted
- Blockers: role roster (OQ-16)
- Next action: the Accountable Owner decides before M1.2 starts
- Decision date: ________

**Current implementation (not the decision):** `scripts/check-bundle-size.mjs` enforces `JS_BUDGET_BYTES = 90_000`, which is Option A as instructed. Changing the constant requires this DEC to be APPROVED.

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
