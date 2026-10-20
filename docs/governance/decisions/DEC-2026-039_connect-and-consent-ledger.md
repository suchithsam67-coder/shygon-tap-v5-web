# DEC-2026-039: SHYGON Connect and the consent ledger: the policy choices in migration 032

| Field | Value |
|---|---|
| Decision ID | DEC-2026-039 |
| Title | Connect (requests, decisions, revocations) on an append-only consent ledger: what 032 decides where the architecture is silent |
| Date opened | 2026-10-19 |
| Domain | Product / Data / Security |
| Level | L3 (new tables holding who-knows-whom and shared personal data) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B) |
| Responsible (R) | Session A (AAROH backend): implementation and evidence |
| Consulted (C) | Data Owner, Security Owner (the same person); counsel through DEC-2026-017 |
| Informed (I) | Session B (frontend) |
| State | **PROPOSED: HUMAN DECISION REQUIRED.** The stage itself was approved (DEC-2026-038 Q13 = A). This record asks about the specific choices. Implemented locally (`test:connect` 16/16), listed as PROPOSED, NOT APPROVED in `test:admin-contract`. Not applied, pushed or deployed |

## Priority

| Impact | Urgency | Irreversibility | Risk | Score | Final P |
|---|---|---|---|---|---|
| 2 | 1 | 2 | 2 | 7 | **P2**: decide before any production use of 032 or a Connect control in the frontend |

## Context (OBSERVED)

- **Architecture:** doc 03 §3.4 (`connections`, `consent_grants`); doc 04 §4.1–4.2:
  - consent is data;
  - effective consent is the latest un-revoked grant;
  - revocation is immediate for future reads;
  - already-copied data cannot be un-shared.
- **Not available:**
  - per-field visibility tiers were cut (V6-058, waiting for DEC-2026-025);
  - there are no personas (one profile per account).

## Questions, with what 032 does today (the recommendation unless stated)

**Q1. Who may send a request?** 032: only a **signed-in SHYGON account**.
- A (as built): accounts only.
- B: also guests who type their own details, a relay like Rescue with its abuse controls.

Recommended: **A**. B adds anonymous personal data and a spam path.

**Q2. What can be shared?** 032: **`phone`, `email`, `company`, `job_title` from the sharer's own account profile.**
- Each side picks its own subset.
- Values are read live while the grant is active, and labelled `self_reported`; nothing verifies them.
- The other side's name is always shown as the identity of the request.

Options:
- **A:** as built.
- B: add Tap fields (WhatsApp, links).
- C: fewer fields.

**Q3. Does the requester's grant start with the request?** 032: **yes**, so the target can see who is asking and what they offer before deciding. Decline, block or expiry revokes it.
- **A:** as built.
- B: start only on acceptance.

**Q4. Is a block revealed?** 032: **no.** The requester sees "declined", and a new request looks like Connect is unavailable.
- **A:** as built.
- B: reveal it.

**Q5. Limits and windows:**
- 5 requests per hour and 20 per day per requester;
- 50 open incoming per target;
- 30 days before a declined requester may ask again;
- requests expire after 30 days;
- ended connections (with their grants) are deleted 180 days after they end.

Options:
- **A:** as built.
- B: other values.

**Q6. Opt-in.** 032: an owner **switches Connect on** (default off), and only a published, unsuspended Tap can be asked.
- **A:** as built.

**Q7. On account deletion**, 032 deletes the account's connections in both directions with their grants. Doc 04 suggested keeping consent grants as de-identified evidence.

Options:
- **A (recommended for v1):** delete. Simpler; nothing is kept that names the other party.
- B: keep de-identified grant rows.

Counsel review applies (DEC-2026-017).

## Decision

Q1 ____ Q2 ____ Q3 ____ Q4 ____ Q5 ____ Q6 ____ Q7 ____

**Approved by:** ________ **Date:** ________
