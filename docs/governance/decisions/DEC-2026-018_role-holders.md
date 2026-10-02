# DEC-2026-018: Canonical role holders (OQ-16): the one-person control model

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`).
> Until 2026-10-02 this decision existed only as a row in `docs/DECISIONS.md`. The options are the two set out in doc 13 §2.2 and OQ-16 (doc 11), as summarised in `docs/shygon-os/HUMAN_DECISION_PACK.md` §4.

| Field | Value |
|---|---|
| Decision ID | DEC-2026-018 |
| Title | Who holds each canonical governance role, and how L3 changes get review |
| Date opened | 2026-09-30 (index row); record file created 2026-10-02 |
| Domain | Governance (Product Owner / Founder) |
| Level | L2. It sets who may approve L3 changes. |
| **Accountable Owner (A)** | Founder / repository owner |
| Responsible (R) | Repository owner (fills in the roster); Claude Code (records it) |
| Consulted (C) | — |
| Informed (I) | All future reviewers |
| State | **APPROVED: Option B, the one-person control model.** Approved by the repository owner on 2026-10-02, in session. |

## Priority
I3 U2 Irr0 R2 = 7 → P1 · matrix P0 · **Final P1** (doc 13 §1.2; a hard gate before production launch).

## Question
Name the holders of Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner, and the primary and secondary Incident Lead. Say whether an external L3 reviewer exists.

## Options (doc 13 §2.2)
- **Option A:** separately named holders. The Security Owner is independent of the author for L3 changes. The two Incident Leads are different people.
- **Option B:** one human, named explicitly, with compensating controls:
  - L3 changes get review from an external retained reviewer, or at minimum a 24-hour cool-off plus the checklist review;
  - a Claude non-author review is advisory and never an approval;
  - the secondary Incident Lead is a trusted, trained person with pre-authorized containment rights only (K1, K5, K11).

## Decision
- **Decision: Option B.** One human holds the governance roles. Doc 13 §2.2: "name the reality explicitly rather than pretend there is independence."
- **Role holder:** the repository owner holds Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner and primary Incident Lead. **No personal name, phone number or GitHub handle was provided, and none is invented.** `ROLE_ROSTER.md` records the model, and the `@role-*` handles in `.github/CODEOWNERS` stay placeholders.
- **L3 review control, in force from 2026-10-02:**
  1. **External retained reviewer:** none is named, so the minimum control below applies until the owner names one in `ROLE_ROSTER.md`.
  2. **Minimum control:** every L3 change gets a **24-hour cool-off** between the final diff and the owner's approval, plus a **checklist review** against `.github/pull_request_template.md`. That includes the line "RLS/definer/auth/payment changes have adversarial tests (L3)" and the reversibility section.
     - L3 means: migrations; any SQL with `POLICY`, `SECURITY DEFINER`, `GRANT`, `REVOKE` or `auth.`; payment, fulfilment and OTP files (doc 13 §3.2).
     - The approval is recorded on the change.
  3. **Claude non-author review** (a separate session) is advisory only and **never counts as an approval**.
  4. **Claude Code never merges, applies migrations or deploys.** The owner does, after the cool-off.
- **Not resolved by this decision (still UNASSIGNED):**
  - **secondary Incident Lead:** must be a different person (doc 13 §2.2 item 3; G2);
  - **Legal / Compliance:** DEC-2026-017;
  - escalation contacts and phone numbers;
  - the CODEOWNERS GitHub mapping.
  The G2 production-launch gate therefore stays closed (doc 13 §2.3).
- **Approved by:** repository owner, in session.
- **Date:** 2026-10-02.

## Impact assessment
- Security impact: there is no independent L3 review. The cool-off and checklist are the compensating control. Risk MR-9 (one-person team) remains open.
- Data impact: none.
- Product impact: none.
- Architecture impact: none.
- Operational impact: each L3 change waits 24 hours between final diff and approval.
- Irreversible? No. The owner can name additional holders at any time.

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
