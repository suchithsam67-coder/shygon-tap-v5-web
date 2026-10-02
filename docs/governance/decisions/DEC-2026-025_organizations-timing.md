# DEC-2026-025: When are organisations, members and organisation roles built?

| Field | Value |
|---|---|
| Domain / Level | Product scope + Data (tenancy) / **L3** (new authorization boundary) |
| **Accountable Owner** | Product Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Data Owner, Security Owner, Principal Architect; counsel (OQ-9) |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I2 U1 Irr2 R2 = 7 → P1 · matrix P1 · **P1** · deadline 2026-10-06 (GAP-4 proposal), and before any organisation build |

**Question:** The owner brief of 2026-10-02 lists organisations, organisation members and roles as SHYGON OS domains. The approved documents defer them. Do we keep the deferral or override it?

**Conflict (OBSERVED):**
- **doc 12 §4.7:** "Organization: none in Phase 1 (schema arrives in Phase 2; do not create org tables early, except the nullable `org_id` columns specified above)."
- **doc 13 §12 G3:** no student or organisation data before G3. That requires the `ops` schema, the cross-tenant canary, K15 and a counsel-approved notification procedure.
- **doc 10 §4:** "Organizations UI / multi-tenancy: not in the first Claude Code phase."
- **OQ-9:** counsel review before minors' data.
- **The owner brief** itself says: "DO NOT create organization tables automatically … create a proposed decision."

**Options:**
- **A, keep the deferral (approved plan).** Design now (`M1_DOMAIN_MODEL.md` §5); build in Phase 2 after G3 + OQ-9. M1 adds no `org_id` columns.
  - Lowest risk. Verticals wait.
- **B, schema-forward only.** M1 adds the nullable `org_id` columns that doc 12 already lists (personas, devices), with no FK and no organisation tables. The tables come in Phase 2.
  - Small; keeps the later migration simple; must not hold data.
- **C, override: build organisations in M1.** Tables, memberships, roles, an organisation console.
  - Requires waiving G3 and OQ-9 for organisation data, or holding no real organisation data until they're met.
  - Largest scope and risk (T13 cross-tenant, rated C in doc 07).

**Impact:**
- Security: a new isolation boundary (T13, rated critical).
- Data: tenant and minors' data (DPDP).
- Product: when the verticals can start.
- Irreversible? Once organisation data exists, the tenancy model is costly to change.

**Decision:** ________ **Approved by:** ________ **Date:** ________
