# DEC-2026-026: M1 milestone sequence, and the "M0 green before M1" rule

| Field | Value |
|---|---|
| Domain / Level | Product scope / roadmap; Architecture consulted / L2 |
| **Accountable Owner** | Product Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Principal Architect, Security Owner, Engineering Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I2 U2 Irr0 R2 = 6 → P2 · matrix P1 · **P1** · deadline 2026-10-06, and before M1.1 starts |

**Question:** Which milestone plan governs SHYGON OS Phase 1, and must M0 be completed first?

**Conflicts (OBSERVED):**
1. **Numbering collision.** The owner brief's M1.1–M1.13 (identity, cards, profiles, audit, analytics, notifications, support, routing, payment abstraction, OS dashboard, security hardening, integration, gate) reuse the IDs of doc 12's M1.1–M1.13 with **different content**. For example, doc 12's M1.1 is the device layer and M1.2 the resolver.
2. **Order.** The brief places audit/events at M1.4 and security hardening at M1.11. The repository evidence shows every module needs audit, events and flags first, and doc 12 rule 5 puts security before features.
3. **Doc 12 §0 rule 5:** "Milestone M0 must be green before M1 starts." M0.3–M0.9 are not done. M0.3 is blocked by DEC-2026-022.

**Options:**
- **A, adopt the sequence in `M1_ARCHITECTURE_PLAN.md` §35, with M0 completed first.**
  - M1.0a covers M0.3–M0.7 (M0.8 and M0.9 may follow in parallel).
  - Then foundations (audit / events / flags) → identity → cards → persona → routing → …
  - The doc 12 mapping is kept in the table; deviations are recorded here (doc 12 §5 item 5). **Recommended by Claude Code (advisory).**
- **B, adopt the owner brief's order as written.** Accepts that modules are built before the audit and event foundations they need, and that security hardening comes late.
- **C, keep doc 12 Phase 1 as written** (M1.1 device … M1.13 pipeline, M1.9 last) and add support and abstractions as extra milestones.
- **For every option:** decide whether M0.3–M0.7 must finish before M1.1 (rule 5), or which items are waived with a dated risk acceptance.

**Impact:**
- Security: an open F1/F2/F4 window if M0 is skipped.
- Architecture: dependency order.
- Product: delivery order.
- Irreversible? No.

**Decision:** ________ **Approved by:** ________ **Date:** ________
