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
| State | **APPROVED 2026-10-20, in session:** "Approve DEC-2026-040 Q1–Q5 as recommended in the record". Every recommendation is the behaviour 033 already has, so no code changed; the gates now list 033 as approved. Approval of the design is not approval to apply: DEC-2026-018 cool-off and checklist review first, then the release track. Not applied, pushed or deployed |

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

**Approved by:** the repository owner (DEC-2026-018 Option B), in session. **Date:** 2026-10-20. **Words:** "Approve DEC-2026-040 Q1–Q5 as recommended in the record."

### Recorded decision

| Q | Outcome | What it means now |
|---|---|---|
| Q1 | **A**: only signed-in SHYGON accounts create demo requests | The public showroom walkthrough stays client-only and sends nothing |
| Q2 | **A**: three fictional SHYGON-owned sample hotels, names starting "SHYGON Demo", every row demo | As built |
| Q3 | **A**: a simulated desk inside SHYGON: received → acknowledged (20 s) → in progress (1 min) → completed (3 min); the guest may cancel until completed | As built |
| Q4 | **A**: 10 per hour and 50 per day per account; 30-day retention; deleted with the account | As built |
| Q5 | **A**: `HotelProvider` with a single `demo` implementation; any other `HOTEL_PROVIDER` fails closed; no network calls | A real integration needs its own decision, contract, credentials and security review |
