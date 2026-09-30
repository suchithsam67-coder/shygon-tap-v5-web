# SHYGON OS — Architecture, Governance & Operating-Layer Planning Pack

**Prepared:** 2026-09-29 (rev. 2: adds governance/P0 and operating layer).
**Inputs:** `shygon-tap-v5-web` (V5 payments build), the SHYGON Tap Master Product Documentation, the SHYGON OS planning brief, the **Decision Governance, Priority & P0 Incident Response Specification**, both **P0 quick-reference runbooks**, and the **19-capability operating-layer proposal**.
**Nothing in this pack modifies production code.** Claude Code implements it starting from `12_CLAUDE_CODE_IMPLEMENTATION_SPEC.md`.

## Summary

1. **What V5 is.** V5 is a strong **commerce + single-profile card** product. Its payment pipeline, admin security model, tier and entitlement rules, and public-page performance are **kept**.
2. **The structural change.** To become a platform it needs **tap → device → route → target**, plus per-field privacy, verified-contact step-up, delivery infrastructure, and later tenancy.
3. **Defects found in the audit.** The audit reproduced three defects: customers can lift their own suspension; admin notes are readable by customers; a deactivated card doesn't stop the public Tap. The repo also **cannot rebuild the live database**.
4. **Credential exposure (SEC-1).** Applying your governance spec surfaced **one item needing action now**: possible exposure of a Supabase service-role key and Razorpay secrets through earlier project ZIPs. It's classified **P1**, escalating to **P0 on stated triggers**; rotate now (doc 13 §1.1, DEC-2026-001).
5. **Governance becomes enforceable engineering.** It covers one Accountable Owner per decision, priority scoring, P0 timers, handoffs and no silent overrides. Concretely: decision records, CODEOWNERS/approval gates, 19 pre-built **kill switches** with a who-may-pull matrix, SLOs, canaries, playbooks and (from Phase 2) an `ops` module.
6. **The operating layer is scoped.** The 19 capabilities become **SHYGON Control**, a separate internal bounded context shared by all SHYGON products. The first build takes only the cheap, high-leverage parts: CI gates, risk engine, blast radius, AI reviewer, feature flags, DR, data catalog. The Command Center and "intelligence" features come later.
7. **First Claude Code phase.** It is **Phase 0 + Phase 1**, with governance stages G0–G2 and operating-layer stages O0–O1. **No production launch without the G2 gate; no student/org data before G3.**

## Map of the requested documents

| Requested | File |
|---|---|
| 1 Existing V5 Architecture Audit | `01_V5_ARCHITECTURE_AUDIT.md` (+ SEC-1, F14) |
| 2 Target Architecture · 3 System Diagram | `02_TARGET_ARCHITECTURE.md` |
| 4 Database / ERD | `03_DATA_MODEL_ERD.md` |
| 5 Multi-Tenant Architecture | `02` §5 + `03` §3.3, §6 + `04` §5 |
| 6 Auth & Authz · 7 Permission / Privacy | `04_AUTH_AUTHZ_PRIVACY.md` |
| 8 API Architecture | `05_API_ARCHITECTURE.md` |
| 9 Customer / Organization / Admin | `02` §4 |
| 10 Payment & Entitlement · 11 Notification · 12 Analytics | `06_PAYMENTS_NOTIFICATIONS_ANALYTICS.md` |
| 13 Security Threat Model | `07_SECURITY_THREAT_MODEL.md` (+ T22 AI agents, T23 Control) |
| 14 Hardware / Tap Lifecycle | `08_TAP_LIFECYCLE_HARDWARE.md` |
| 15 AI Opportunity Map | `09_AI_OPPORTUNITY_MAP.md` |
| 16 Roadmap · 17 MVP · Do-not-build | `10_ROADMAP_MVP_SCOPE.md` (+ governance/ops tracks per phase) |
| 18 Debt / Migration · 19 Risks & Open Questions | `11_DEBT_MIGRATION_RISKS_QUESTIONS.md` (+ OQ-16…22, R-16…21) |
| 20 **Claude Code Implementation Specification** | `12_CLAUDE_CODE_IMPLEMENTATION_SPEC.md` (+ decision gates §2A, M0.0, M0.7–M0.9, M1.10–M1.13) |
| **Governance, Priority & P0 Incident Response** (applied) | `13_GOVERNANCE_P0_INCIDENT_RESPONSE.md` |
| **Operating layer — 19 capabilities + "bigger opportunity"** | `14_OPERATING_LAYER_ARCHITECTURE.md` |
| Ready-to-copy templates | `templates/` (role roster, decision/incident/handoff/status/release/review records, seeded DEC-2026-001/002, SHYGON printable P0 runbook, PR template, CODEOWNERS) |
| Diagrams | `diagrams/` (system, ERD, lifecycle, Control) |

## Decisions only you can make first

| # | Decision | Accountable | Priority |
|---|---|---|---|
| **DEC-2026-001** | Rotate the possibly exposed service-role and Razorpay secrets now | Security Owner (you, until named) | **P1 → P0 on trigger** |
| **OQ-16** | Name the role holders (Product, Architect, Security, Data, Engineering, QA, Release, two Incident Leads) | Founder | P1 (launch gate) |
| **DEC-2026-002 / OQ-1** | Should a card stop working 14 days after activation? | Product Owner | P1 |
| OQ-2 | NFC chip family; NTAG 424 DNA for new batches? | Security Owner | P1 (before any hardware order) |
| OQ-3 | Provide the live schema dump + Admin APK contract | Data Owner | P1 |
| OQ-17 | Paging service + status page + out-of-band channel | Release Owner | before Phase 1 launch |
| OQ-18 | Counsel: CERT-In/DPDP incident rules, log retention | Data Owner | before Phase 1 launch |
| OQ-21 / OQ-22 | Name the internal layer; productize it or not | Founder | P2 |

All 22 are in doc 11 Part D. The priority triage of every finding is in doc 13 §1.2.

## Conventions
* **VERIFY ON LIVE:** true for the repo's schema; the live database may differ.
* **A0–A4:** assurance levels. **T0/T1:** tap trust levels.
* **L0–L3:** governance change levels (= risk engine Low…Critical).
* **K1–K19:** containment switches. **PB-1…PB-11:** P0 playbooks.
* **G0–G5 / O0–O5:** governance and operating-layer stages.
* Existing stored names (`tap_profiles`, `cards`, `lifetime`, `pro`…) are **not renamed**. Everything is additive through Phase 2.
