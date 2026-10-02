# DEC-2026-030: What is the "OS dashboard" (brief M1.10)?

| Field | Value |
|---|---|
| Domain / Level | Product scope / L1–L2 |
| **Accountable Owner** | Product Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Principal Architect, Security Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I1 U1 Irr0 R1 = 3 → P3 · matrix P2 · **P2** · deadline 2026-10-16, and before M1.10 |

**Question:** The brief lists "M1.10 OS dashboard" without defining it. Which dashboard is meant?

**Candidates (OBSERVED in the approved documents):**
- **A, customer app shell** `/app/*` (doc 12 M1.8): Devices, Privacy and Security pages; no visual redesign; `/shygontap/*` keeps working. **In scope for Phase 1.**
- **B, the operator Command Center** (doc 13 §10.5, doc 14 §3.1). **On doc 10 §4's do-not-build list until G3/O3.** Before then, doc 14 O1 provides a weekly generated ops digest instead.
- **C, a web admin** replacing or complementing the Admin APK (OQ-13). The recommendation there is to keep the APK.
- **D, an organisation console** `/org/*`. Phase 2+, tied to DEC-2026-025.

**Advisory note:** if "OS dashboard" means A, it fits M1. B, C or D need their own gates.

**Decision:** ________ **Approved by:** ________ **Date:** ________
