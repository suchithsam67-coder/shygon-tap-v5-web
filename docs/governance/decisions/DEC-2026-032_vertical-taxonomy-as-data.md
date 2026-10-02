# DEC-2026-032: Vertical taxonomy as data (persona context and category, organisation kinds)

| Field | Value |
|---|---|
| Domain / Level | Architecture / L2 |
| **Accountable Owner** | Principal Architect: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Product Owner, Data Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I1 U1 Irr1 R1 = 4 → P2 · matrix P2 · **P2** · deadline 2026-10-16, and before M1.4 |

**Question:** How are the brief's verticals represented without redesigning the core for each one?

The brief's verticals are students, schools, colleges, companies, restaurants, hotels, clinics, retail, professionals, creators, events and institutions.

**Evidence:**
- doc 03 §1 ✕: no `students` / `employees` / `hotels` tables. Everything is `persona.context`, `memberships.kind` or `organizations.kind`.
- doc 03 uses CHECK enums for `context` (`professional, student, business, event, member, guest, other`) and `organizations.kind` (`school, company, event_org, hotel, venue, other`).
- The brief adds: creator, restaurant, clinic, retail, service provider, college, institution, enterprise, community.

**Options:**
- **A, coarse CHECK enums + a free `category` text.**
  - `context` per doc 03 (+ `creator`); businesses use `context='business'` with `category` taken from a **seeded vocabulary held as data**.
  - Organisation kinds get the same treatment in Phase 2.
  - New verticals need no migration. **Advisory recommendation.**
- **B, a reference table** (`vertical_categories(code, kind, label, active)`) with an FK.
  - Stronger integrity; adding a vertical is an INSERT.
- **C, CHECK enums only** (doc 03 literal). Every new vertical needs a migration.

**Impact:**
- Architecture: extensibility.
- Analytics: grouping by vertical.
- Irreversible? No.

**Decision:** ________ **Approved by:** ________ **Date:** ________
