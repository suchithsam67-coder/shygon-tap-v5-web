# SHYGON: Decision index

This is the index of every decision record (DEC). Doc 13 §4 and §11 define the process, and new records use `docs/governance/DECISION_RECORD.md`.

- Detailed records live in `docs/governance/decisions/`.
- A row without a linked file is still only a queue entry. Its record is created from the template when the decision is taken up.
- Seeded on 2026-09-30 from the doc 13 §1.2 decision queue, in table order: SEC-1 → DEC-2026-001, OQ-1 → DEC-2026-002, then DEC-2026-003 onward.

**Read this first**
- **No role holder is named.** Every Accountable Owner below is a role that is **UNASSIGNED — HUMAN ACTION REQUIRED** (OQ-16 / DEC-2026-018). Roles are not people, and no names have been invented.
- **States** follow the G§84 state machine (doc 13 §10.3). `PROPOSED` means nobody has decided yet; a recommendation in the pack is not an approval.
- **Deadlines** apply the doc 13 §4 proposal: P1 ≤ 2 business days, P2 ≤ 10, P3 at the next planning session. That proposal (GAP-4) is itself not yet approved.
  - Counted from 2026-09-30, Monday to Friday. Public holidays are **not** accounted for; for example, 2026-10-02 is a national holiday in India.
- **Security rule for this file:** no secret value may ever be written here.

## Decision queue

| ID | Title | Source | Priority | Accountable Owner (role) | State | Deadline | Human action |
|---|---|---|---|---|---|---|---|
| [DEC-2026-001](governance/decisions/DEC-2026-001_credential-exposure-rotation.md) | Potential credential exposure: rotate the Supabase service-role key and Razorpay secrets; establish the ZIP exposure history | SEC-1 | **P0 triage** (provisional; pack: P1) | Security Owner (UNASSIGNED) | **OPEN — HUMAN ACTION REQUIRED** | Immediate | HUMAN ACTION REQUIRED: the six actions in the record. Rotation is NOT DONE. Production data: UNKNOWN. |
| [DEC-2026-002](governance/decisions/DEC-2026-002_card-activation-expiry.md) | Should a card stop working 14 days after activation? | OQ-1 | P1 (→ P0 if paying customers' cards auto-suspend) | Product Owner (UNASSIGNED) | PROPOSED (blocks M1.1 lifecycle) | 2026-10-02 | HUMAN ACTION REQUIRED: decide. Live behaviour is kept until then. |
| DEC-2026-003 | Customer can un-suspend their own Tap/account | F1 | P1 (→ P0 if exploited on live) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: L3 review of the M0.3 fix |
| DEC-2026-004 | Card deactivation doesn't stop the public Tap | F3 | P1 | Principal Architect (UNASSIGNED); C: Product, Security | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: define the semantics (with OQ-1, OQ-2) |
| DEC-2026-005 | OTP sent to an unverified, user-editable phone | F4 | P1 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: approve the verified-contact model (M1.3) |
| DEC-2026-006 | Repo ≠ live DB (migration drift); **blocks all DB work** | F6 | P1 | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: provide the live schema dump (see DEC-2026-016) |
| DEC-2026-007 | No CI | F8 | P1 | Engineering Owner (UNASSIGNED) | IMPLEMENTING: M0.1 on `feat/m0-governance-ci` (not merged) | 2026-10-02 | HUMAN ACTION REQUIRED: review the M0.0/M0.1 phase gate; create the GitHub repository and push (human only) |
| DEC-2026-008 | Storage policies unaudited | F9 | P1 (provisional) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: storage audit (M0.5, OQ-15) |
| DEC-2026-009 | Customers can read internal admin notes | F2 | P2 (→ P1 once real orders carry notes) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: L3 review of the M0.3 fix |
| DEC-2026-010 | Forgeable analytics; weak visitor hash | F5 | P2 | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: decide at M1.6 |
| DEC-2026-011 | Slug enumeration | F7 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: accept as by-design for public personas, or not |
| DEC-2026-012 | Session stored in `localStorage` | F11 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: the "keep me signed in" decision (PRODUCTION.md §8) |
| DEC-2026-013 | Secrets held in two runtimes | F12 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: accept with a runbook (M0.5), or consolidate |
| DEC-2026-014 | Order id uses `Math.random` | F10 | P3 | Engineering Owner (UNASSIGNED) | PROPOSED | Next planning session | HUMAN ACTION REQUIRED: approve the M0.5 fix |
| DEC-2026-015 | NFC chip family (NTAG 424 DNA for new batches?) | OQ-2 | P1 (before any hardware order) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02, and before any hardware order | HUMAN ACTION REQUIRED: decide the chip family |
| DEC-2026-016 | Live schema dump + Admin APK contract | OQ-3 | P1 | Data Owner (UNASSIGNED) | PROPOSED (blocks M0.2) | 2026-10-02 | HUMAN ACTION REQUIRED: provide the dump and the contract |
| DEC-2026-017 | Legal/compliance review (DPDP, minors, CERT-In, GST) | OQ-9 | P1 (hard gate before Phase 2 Student) | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: engage counsel |
| DEC-2026-018 | Name the canonical role holders | OQ-16 | P1 (hard gate before production launch) | Product Owner / Founder (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: name every role in `docs/governance/ROLE_ROSTER.md` and give the GitHub mapping for `.github/CODEOWNERS` |
| [DEC-2026-019](governance/decisions/DEC-2026-019_bundle-budget-reconciliation.md) | Bundle budget reconciliation: 90 kB cap vs current + 5 kB | M0.1 | P2 | Principal Architect (UNASSIGNED) | PROPOSED — HUMAN ACTION REQUIRED (gate enforced at 90 kB) | 2026-10-14 (before M1.2) | HUMAN ACTION REQUIRED: choose the budget |
| [DEC-2026-020](governance/decisions/DEC-2026-020_web3forms-public-key-scan-exception.md) | Secret-scan exception for one Web3Forms public access key | M0.1 baseline scan | P3 | Security Owner (UNASSIGNED) | APPROVED by the repository owner 2026-09-30; re-confirmation pending | — | HUMAN ACTION REQUIRED: the named Security Owner re-confirms |

## Queued: not yet numbered (from `docs/shygon-os/00_README_INDEX.md` and doc 11 Part D)

| Source | Decision | Accountable Owner (role) | Gate | Human action |
|---|---|---|---|---|
| OQ-17 | Paging service, external status page and out-of-band incident channel | Release Owner (UNASSIGNED) | Before the Phase 1 launch; blocks M1.11 paging | HUMAN ACTION REQUIRED |
| OQ-18 | Counsel: CERT-In/DPDP incident rules and log retention | Data Owner (UNASSIGNED) | Before the Phase 1 launch | HUMAN ACTION REQUIRED |
| OQ-21 / OQ-22 | Name the internal operating layer; productize it or not | Founder (UNASSIGNED) | P2 | HUMAN ACTION REQUIRED |
| GAP-1 … GAP-12 | Gaps in the governance spec (doc 13 §13), each with a proposed resolution | Product Owner / Founder (UNASSIGNED) | — | HUMAN ACTION REQUIRED |
| Other OQs | The remaining open questions in doc 11 Part D | per doc 11 | per doc 11 | HUMAN ACTION REQUIRED |

## Open human-only steps for governance stage G0 (doc 12 M0.0; Claude Code does not perform these)
1. Name the role holders (DEC-2026-018).
2. Create the out-of-band incident channel (OQ-17).
3. Pick the paging service (OQ-17).
4. Print `docs/runbooks/P0_RUNBOOK_SHYGON_PRINT.md` and fill in the names and numbers. The print-ready PDF of the same content is `docs/shygon-os/templates/SHYGON_P0_RUNBOOK_PRINT.pdf`.
5. Rotate the credentials and complete the other DEC-2026-001 actions.
