# DEC-2026-029: Identity key contract (`auth.users.id` vs `customers.id`)

| Field | Value |
|---|---|
| Domain / Level | Security (authorization model) + Architecture / **L3** |
| **Accountable Owner** | Security Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Principal Architect, Data Owner |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I3 U2 Irr1 R2 = 8 → P1 · matrix P0 · **P1** (no active harm; DEC-2026-024 tracks the defect) · before M1.2 |
| Related | DEC-2026-024 (fix of the current breakages) |

**Question:** What is the binding contract for identity keys that every new SHYGON OS module must follow?

**Evidence (OBSERVED, live):**

| Key | Meaning | Used by |
|---|---|---|
| `auth.users.id` = **U** | authentication identity | RLS (`user_id`, and `profiles.id`) everywhere |
| `customers.id` = **C** | commercial account; random, created by live `handle_new_user` | `customer_id` on `profiles`, `tap_profiles` and `cards` (FK → `customers.id`; NOT NULL on `profiles` and `tap_profiles`) |
| `orders.customer_id` | holds **U** (FK → `auth.users`), not C | orders |

V5 code writes U into C columns; the drift report §11 shows the resulting failures.

**Proposed contract** (`M1_DOMAIN_MODEL.md` §2.1, rules B1–B7):
- **B1:** authorization is always by U.
- **B2:** C is resolved server-side from U and **never accepted from a client**.
- **B3:** new person-owned tables carry `user_id` (U), and `customer_id` only if commercially needed.
- **B4:** `orders.customer_id` (= U) is legacy; never join it to `customers`.
- **B5:** a device is not an identity.
- **B6:** a tap is not authentication.
- **B7:** the three suspension levels are distinct.
- **Enforcement:** contract tests + review checklist + (with DEC-024 Option A) a normalisation trigger.

**Options:**
- **A:** adopt B1–B7 as binding. **Advisory recommendation.**
- **B:** make U the only key (deprecate C for new work). The legacy C columns remain and must still be filled correctly.
- **C:** make C the authorization key. Every RLS policy would change. Not recommended.

**Impact:**
- Security: correct ownership checks.
- Data: no key confusion in new tables.
- Every module depends on this.
- Irreversible? Changing the key after data exists is costly.

**Decision:** ________ **Approved by:** ________ **Date:** ________
