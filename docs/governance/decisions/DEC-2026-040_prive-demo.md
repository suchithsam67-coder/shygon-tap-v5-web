# DEC-2026-040: SHYGON Privé demo: the choices in migration 033

| Field | Value |
|---|---|
| Decision ID | DEC-2026-040 |
| Title | Demo-only Privé: sample catalogue, who may create demo requests, the simulated hotel desk, retention, the hotel boundary |
| Date opened | 2026-10-20 |
| Domain | Product / Data |
| Level | L3 (new tables and seed rows) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B) |
| Responsible (R) | Session A (AAROH backend) |
| Informed (I) | Session B (frontend) |
| State | **PROPOSED: HUMAN DECISION REQUIRED.** The owner decided "Privé demo-only" on 2026-10-20 (DEC-2026-038 Q6 → A). This record asks about the specific choices. Implemented locally (`test:prive` 12/12), listed as PROPOSED, NOT APPROVED in `test:admin-contract`. Not applied, pushed or deployed |

## Priority

| Impact | Urgency | Irreversibility | Risk | Score | Final P |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 1 | 4 | **P3**: before 033 goes to any real database |

## Questions, with what 033 does today (recommended unless stated)

**Q1. Who may create a demo request?** 033: **signed-in SHYGON accounts only.** The public showroom stays Session B's client-only walkthrough, which sends nothing.
- **A:** as built.
- B: anonymous visitors too, with a session token like Rescue's.

**Q2. The sample catalogue.** 033 has three fictional, SHYGON-owned hotels; every name must start "SHYGON Demo" and every row is demo (database checks):
- SHYGON Demo Residence: the walkthrough's hotel and its four services;
- SHYGON Demo Seaside;
- SHYGON Demo Hills.

Options:
- **A:** as built.
- B: other names or services.

**Q3. The simulated hotel desk.** The steps run received → acknowledged (20 s) → in progress (1 min) → completed (3 min). A simulator inside SHYGON moves them, one step per sweep or read, and each step is recorded as by `demo_hotel_simulator`. The guest may cancel until a request completes.
- **A:** as built.
- B: other timings, or a manual "advance" control.

**Q4. Limits and retention.** 10 demo requests per hour and 50 per day per account; requests are deleted 30 days after creation; account deletion removes them.
- **A:** as built.

**Q5. The integration boundary.** `netlify/lib/hospitality.mjs` defines the `HotelProvider` interface with one implementation, `demo`. Setting `HOTEL_PROVIDER` to anything else makes `/api/prive` answer 503 `not_supported`. There are no network calls. A real integration needs its own decision, contract, credentials and security review.
- **A:** as built.

## Decision

Q1 ____ Q2 ____ Q3 ____ Q4 ____ Q5 ____

**Approved by:** ________ **Date:** ________
