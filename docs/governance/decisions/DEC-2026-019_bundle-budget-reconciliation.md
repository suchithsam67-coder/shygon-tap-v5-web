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
Which budget should the public Tap entry-JavaScript gate enforce? Doc 12 contains two different rules, and today's bundle is 1.45 kB under the stricter one in CI (0.43 kB in a local build that includes the source-tags plugin).

## Context & evidence
**OBSERVED**
- **What was measured:** the JS that `dist/index.html` loads before the public Tap renders (module entry + modulepreload), gzip-sized the way Vite reports it (zlib default level, 1 kB = 1000 B).
- **There are two builds of the same commit, and they differ (CONFIRMED cause):**

  | Build | `index-*.js` | `react-*.js` | **Entry JS total** | Headroom under 90 kB |
  |---|---|---|---|---|
  | **Clean checkout (what CI builds)**, no `.env`, Node 20.18 | 14,539 B | 74,009 B | **88,548 B = 88.55 kB** | **1.45 kB** |
  | The owner's working folder, Node 20.18 | 15,563 B | 74,009 B | **89,572 B = 89.57 kB** | 0.43 kB |

- **The cause of the 1,024 B difference:** the working folder has a gitignored, local-only Vite plugin, `.vite-source-tags.js`. `vite.config.ts` loads it when present, and it adds `data-source-loc="file:line:col"` attributes to every JSX element. Its own header says it is active in production builds too. A clean checkout does not have it.
- **The CI gate measures the clean build** (88.55 kB). The figure of 89.57 kB given to the owner on 2026-09-30 came from the working folder, which includes the plugin.
- **CSS:** `assets/index-*.css` is about 59.5 kB gz. It is reported but not gated, because M0.1 caps JavaScript only.
- **Doc 01 §1** records the entry bundle as "~84 kB gzip". It does not say how that was measured.
- **Doc 12 §3 M0.1:** "bundle-size check (public Tap chunk ≤ 90 kB gz)".
- **Doc 12 §2** (contract freeze) says: "Bundle ≤ current +5 kB gz (CI gate)". That is about 94.57 kB against today's measurement.
- **The gap today:** 90,000 − 88,548 = **1,452 B (1.45 kB) of headroom** in CI under the M0.1 cap. It is 428 B in the plugin-bearing local build.

**HYPOTHESIZED (not investigated)**
- The gap between ≈84 kB and 88.55 kB is either a difference in method (unit or gzip level) or code growth since the audit.

## Options
### Option A: keep the 90 kB hard cap (implemented now)
- Benefits: this is the literal M0.1 rule, and it forces a decision before the public renderer grows.
- Risks: M1.2 (resolver client) may exceed the 1.45 kB of CI headroom and fail CI until this DEC is decided. Local builds with the plugin hit the cap roughly 1 kB sooner.
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
- Next action: the Accountable Owner decides before M1.2 starts. Separately (not part of this DEC), decide whether the local-only `.vite-source-tags.js` plugin should ever run in production builds.
- Decision date: ________

**Owner direction, 2026-09-30 (this is not the DEC decision):** the clean CI measurement is the authoritative current baseline: **88.55 kB gz, a 90 kB maximum, 1.45 kB remaining.** Do not change the 90 kB limit, and do not add SHYGON OS functionality to the public Tap bundle. The reconciliation question in this DEC stays open.

**Current implementation (not the decision):** `scripts/check-bundle-size.mjs` enforces `JS_BUDGET_BYTES = 90_000`, which is Option A as instructed. Changing the constant requires this DEC to be APPROVED.

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
