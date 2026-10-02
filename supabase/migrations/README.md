# supabase/migrations

## Origin of all database work: the live schema baseline (DEC-2026-023, Option A)

| Files | Status |
|---|---|
| `001_…` – `019_…` | **History. Applied on live before the baseline was captured. Never re-run, anywhere, and never edited** (doc 12 §0 rule 2). They are kept as the record of how live was built. The repository chain does not reproduce live: `docs/governance/SCHEMA_DRIFT_REPORT.md` shows 5 tables, 74 columns and 11 functions that exist only on live. Replaying 001–019 onto live changes 48 objects and breaks sign-up. |
| `supabase/baseline/000_live_baseline.sql` | **The schema of record.** A schema-only `pg_dump --schema=public` of the live project, provided by the owner on 2026-09-30. Re-capture it whenever live is changed outside the approved pipeline, then re-run `node supabase/tests/schema-drift.mjs`. |
| `020_…` onward | **New work.** Written against the baseline. Each file is idempotent and additive. Each carries a header with purpose, governing decision, rollback SQL, dependencies and data class. Each is covered by the database suites. Every one is L3: Data Owner + Security Owner review, which under DEC-2026-018 means a 24-hour cool-off and a checklist review. |

## How the files are exercised

| Command | What it builds | What it runs |
|---|---|---|
| `npm run db:apply` | `live-platform-shim.sql` + the baseline + `live-auth-shim.sql`, in isolated PGlite (`supabase/tests/lib/live-db.mjs`) | `020+`, twice (idempotency) |
| `npm run db:verify`, `node supabase/tests/rls-adversarial.mjs` | the same, plus `020+` | behaviour and adversarial RLS checks |
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
- **Do not paste `supabase/APPLY_ALL.sql` into any Supabase SQL editor.** It bundles 001–019 and would replay history onto the project. `npm run db:bundle` and the file are unchanged; whether to regenerate them from baseline + `020+` or delete them is an M0.4 item.
