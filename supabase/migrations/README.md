# supabase/migrations

## Origin of all database work: the live schema baseline (DEC-2026-023, Option A)

| Files | Status |
|---|---|
| `001_…` – `019_…` | **History. Applied on live before the baseline was captured. Never re-run, anywhere, and never edited** (doc 12 §0 rule 2). They are kept as the record of how live was built. The repository chain does not reproduce live: `docs/governance/SCHEMA_DRIFT_REPORT.md` shows 5 tables, 74 columns and 11 functions that exist only on live. Replaying 001–019 onto live changes 48 objects and breaks sign-up. |
| `supabase/baseline/000_live_baseline.sql` | **The schema of record.** A schema-only `pg_dump --schema=public` of the live project, provided by the owner on 2026-09-30. Re-capture it whenever live is changed outside the approved pipeline, then re-run `node supabase/tests/schema-drift.mjs`. |
| `020_…` onward | **New work.** Written against the baseline. Each file is idempotent. It is additive unless its header says otherwise (022 moves admin notes to a new table; 023 removes a policy; 024 re-targets policies and revokes grants; 025 revokes a grant, changes two function bodies and adds a closed table; 026 changes one foreign key's ON DELETE so an account delete cannot remove its orders; 028 adds insert triggers; 029 adds the closed emergency tables and server-only functions; 030 adds a trigger refusing client writes to server-managed Tap columns; 031 adds the closed Return-to-Owner relay tables and server-only functions; 032 adds Connect and the append-only consent ledger; 033 adds the demo-only Privé (sample hotels, demo requests). 027 is held aside, DEC-2026-037; 029, 030 and 031 are APPROVED, DEC-2026-038; 032 is APPROVED, DEC-2026-039; 033 is APPROVED, DEC-2026-040; none is applied anywhere). Each carries a header with purpose, governing decision, VERIFY ON LIVE queries, **tested** rollback SQL, dependencies and data class. Each is covered by the database suites. Every one is L3: Data Owner + Security Owner review, which under DEC-2026-018 means a 24-hour cool-off and a checklist review. |

## How the files are exercised

| Command | What it builds | What it runs |
|---|---|---|
| `npm run db:apply` | `live-platform-shim.sql` + the baseline + `live-auth-shim.sql`, in isolated PGlite (`supabase/tests/lib/live-db.mjs`) | `020+`, twice (idempotency) |
| `npm run db:verify`, `node supabase/tests/rls-adversarial.mjs` | the same, plus `020+` | behaviour and adversarial RLS checks |
| `npm run test:rls-matrix` | the same, plus `020+` | every table × every caller (anon, two customers, three admin roles, service) against the expected access model; extra access fails as a P0 |
| `npm run test:identity`, `test:admin-notes`, `test:golden`, `test:admin-contract` | the same, plus `020+` | the identity contract (021), F2 (022), the public Tap golden output and the frozen-function contract |
| `npm run test:suspension` | the live baseline, the baseline plus `020–026`, the baseline plus `020+`, and the local stack | F1 (020, 028): every owner attack on the suspension columns, with the live baseline as the negative control; the two admin RPCs; the guard's mechanism and trigger order; the attacks over HTTP with forged tokens |
| `npm run test:emergency` | the live baseline + `020+` (and `020–029` as the 030 negative control), and the local stack with the SMS stand-in | 029: every emergency table and function closed to client roles; limits, idempotency, attempt fencing, receipts, retention, the account cascade; 030: each owner-write bypass shown open before it and refused after; then over HTTP: cross-customer refusals, provider refusals, outages, timeouts, no provider, a database failure mid-send, forged receipts |
| `npm run test:rescue` | the live baseline + `020+`, and the local stack | 031: closed tables and functions; the anonymous finder and the owner over HTTP; cross-account refusals; limits, duplicates, expiry, block, report, close, retention; no owner detail or message text in a response or log |
| `npm run test:connect` | the live baseline + `020+`, and the local stack | 032: closed tables; the append-only ledger (even for the server role); requests, decisions, live reads under active grants, share changes, revocation, decline cool-down, block never revealed, limits, expiry; no value reaches a caller without a grant |
| `npm run test:prive` | the live baseline + `020+`, and the local stack | 033: closed tables; every hotel and request marked demo; requests, idempotency, limits, the simulator, cancel; only the demo provider exists; no network call |
| `npm run test:rollbacks` | the baseline plus `020..k` | each migration's header rollback restores the schema before it (functions, policies, grants, relations, triggers and constraints); the whole chain rolls back to the baseline and re-applies identically |
| `npm run test:account-deletion` | the same, plus `020+` | the deletion procedure in `docs/runbooks/account-deletion.sql`, as written: what it deletes and keeps, every refusal, and 026 (with the live baseline's cascade as the negative control) |
| `npm run db:bundle` / `db:bundle:check` | the baseline | writes / checks `supabase/APPLY_ALL.sql` (`020+` only) and proves it applies twice |
| `npm run test:db:history` | the old stand-in `supabase/tests/baseline.sql` + `001–019`, in isolated PGlite | the catalogue seed-data checks only (owner decision D-U1-a) |
| `node supabase/tests/schema-drift.mjs` | both of the above | live vs repository drift report |

None of these touch a real Supabase project.

## Applying to a real project

- **Production is never targeted by tooling.** A migration reaches production only through the approved pipeline (doc 12 M1.13, not built yet). Until then, a human applies it under documented break-glass, with post-apply verification and a confirmed backup or PITR.
- **No migration produced under the DEC-2026-001 M0.3 waiver is applied to production** until the credentials are rotated, or the owner extends the waiver in writing.
- **`npm run db:push` is guarded** (DEC-2026-023 S1, amendment A-1; M0.3 U2):
  - It runs only for a project listed in `supabase/non-production-projects.json`. That list is empty today, so it refuses everything.
  - There is no override flag. A missing or malformed list refuses everything.
  - It sends only `020+` and never 001–019.
  - Every check runs before any network call (`npm run test:push-guard`).
  - Adding a non-production project is a reviewed commit (Data Owner + Security Owner). **Production is never listed.**
- **`supabase/APPLY_ALL.sql` contains only `020+`** (SHYGON V6, V6-040). The 001–019 history is no longer bundled. It is still applied only at the human production gate, after each migration's VERIFY ON LIVE queries and DEC-2026-018 approval. `npm run db:bundle` regenerates it and proves it on the live baseline twice; `node supabase/tests/bundle.mjs --check` (in CI) fails if it is stale.
