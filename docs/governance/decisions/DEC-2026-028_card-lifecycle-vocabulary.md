# DEC-2026-028: Canonical card lifecycle states and the live dual status columns

| Field | Value |
|---|---|
| Domain / Level | Product (card semantics) with Security and Architecture / **L3**. Physical-card-visible behaviour is treated as irreversible (doc 13 §3.3). |
| **Accountable Owner** | Product Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Security Owner, Principal Architect, Data Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I2 U1 Irr3 R2 = 8 → P1 · matrix P1 · **P1** · before M1.3 |
| Related | DEC-2026-002 (14-day expiry), OQ-2/2b, DEC-2026-022 (F3), DEC-2026-024 (I-4) |

**Question:** What is the card state vocabulary, which column is canonical, and what do the brief's terms mean?

**Evidence (OBSERVED, live baseline):**
- **`cards.status`:** `varchar(32)`, default `pending`, nullable, **no CHECK**. Every V5 and live function writes it: fulfilment `pending`; activate `active`; deactivate and expiry `suspended`; checks for `replaced`.
- **`cards.card_status`:** legacy, CHECK in `inventory, assigned, active, suspended, replacement, retired`, default `inventory`.
- **doc 08 §4:** `unassigned, pending, shipped, active, suspended, lost, transfer_pending, replaced, retired`.
- **The owner brief:** UNASSIGNED, ISSUED, ACTIVATED, ACTIVE, SUSPENDED, LOST, REPLACED, RETIRED.
- **Expiry:** `expire_tap_cards()` sets `suspended` on expiry, so EXPIRED is not distinct.

**Proposal (`M1_DOMAIN_MODEL.md` §4; Claude Code advisory):**
- `status` is canonical, and uses doc 08's set.
- ISSUED = `pending` / `shipped`.
- **ACTIVATED is the transition into `active`** (recorded in `activated_at`), not a stored state.
- Add a CHECK on `status`: NOT VALID, then VALIDATE after a human read-only count.
- `card_status` is kept: either (a) frozen and never written by new code, or (b) mapped one-way by trigger.
- EXPIRED: decided by DEC-2026-002, either as a distinct `expired` state or by keeping `suspended`.
- `device_transition()` becomes the only writer.

**Options to decide:**
1. The vocabulary: doc 08 as above, or brief terms stored literally (`issued`, `activated`).
2. `card_status`: frozen, or mapped.
3. EXPIRED: distinct state, or reuse `suspended`, or remove expiry (DEC-002).
4. `transfer_pending`: include in M1, or later.

**Impact:**
- Resolver semantics for printed cards.
- The Admin APK reads `status` and `card_status` (contract tests).
- Integrity (O-4).
- Irreversible for shipped cards' behaviour.

**Decision:** ________ **Approved by:** ________ **Date:** ________
