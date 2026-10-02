# DEC-2026-023: Migration strategy after M0.2, and a safeguard for `npm run db:push`

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). Evidence: `docs/governance/SCHEMA_DRIFT_REPORT.md`.

| Field | Value |
|---|---|
| Decision ID | DEC-2026-023 |
| Title | Which schema is the origin for all future database work, and how is production protected from re-applying history? |
| Date opened | 2026-10-02 |
| Domain | Data (destructive or backfill migrations, baseline capture: doc 13 §3.1) |
| Level | **L3** |
| **Accountable Owner (A)** | Data Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted (C) | Security Owner, Principal Architect, Release Owner (all UNASSIGNED) |
| Informed (I) | Engineering Owner, QA Owner (UNASSIGNED) |
| State | **OPEN — HUMAN DECISION REQUIRED** |

## Priority (G§13–15)
| Impact | Urgency | Irreversibility | Risk | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 3 | 2 | 2 | 3 | 10 | P1 | P0 | **P1** |

Reason the final priority is below the matrix result: nothing is broken in production because of this today. It blocks all new database work and makes `db:push` dangerous.
Deadline: before any new migration (`020_…`) is written.

## Question
1. Should new database work start from the authoritative live baseline, or from the repository's migration chain (which cannot reproduce live)?
2. How is `npm run db:push`, which re-applies every historical migration to a real project, prevented from reaching production?

## Evidence (OBSERVED / CONFIRMED; see the drift report)
- **The baseline rebuilds a clean database (CONFIRMED):** 492 of 493 entries apply, and the one exception is the benign `public` schema entry.
- **The repository chain does not produce live:**

  | Object | Repo | Live |
  |---|---|---|
  | Tables | 25 | 30 |
  | Columns | 284 | 358 |
  | Functions | 83 | 93 |

  There are also 32 column conflicts and 16 functions that differ in logic or settings.
- **Replaying 001–019 onto live (CONFIRMED in simulation):** no errors, but **48 live objects change**, and sign-up then fails with `23503 profiles_customer_id_fkey`.
- **The test suites (`db:verify`, `rls-adversarial`, `verify-011`) currently run on the repository chain**, so they prove properties of a schema that is not production.

## Options
### Option A: the baseline is the origin (doc 12 M0.2 "Then"; recommended by doc 12)
- **How it works:**
  - Local and CI databases are built from `000_live_baseline.sql` plus the platform shim. New migrations start at `020_`.
  - 001–019 stay in the repository as history, marked "applied on live, never re-run" in `supabase/migrations/README.md`.
  - The suites are switched to run on the baseline.
- **Benefits:** tests and new migrations target what production actually is. It is the simplest correct origin.
- **Risks:**
  - The suites will report real findings against production, so some will fail at first. That is expected and reported, never weakened.
  - The baseline must be re-captured whenever someone changes live outside the pipeline.
- **Cost / time:** about one milestone of tooling (L1/L2 harness changes). No production change.
- **Reversibility:** high (repository only).

### Option B: keep the repository chain and add a reconciliation migration
- **How it works:** a `020_reconcile_live.sql` makes the repository chain produce live exactly. It is proven when `schema-drift.mjs` reports zero differences.
- **Benefits:** keeps one linear history.
- **Risks:** the migration encodes the live-only legacy layer by hand. It must never run on live, where it would be a no-op at best and destructive at worst, so it needs its own guard. It is also larger and easier to get wrong.
- **Reversibility:** high (repository only).

### Option C: status quo
- Not viable: every new migration would be tested against a schema that is not production.

### Safeguard for `db:push` (needed under every option)
- **S1:** `apply-remote.mjs` refuses to run unless `SUPABASE_PROJECT_REF` is on an explicit non-production allowlist, or `--i-know-this-is-not-production` is passed. Small L1 tooling change.
- **S2:** remove `db:push` until the M1.13 approved pipeline exists.
- **S3:** documentation only. (Weak: the tool stays one command away from production.)

## Impact assessment
- Security impact: positive. Tests reflect production RLS and grants.
- Data impact: none until a migration is applied. No production change in any option.
- Product impact: none directly.
- Architecture impact: it fixes the origin of all SHYGON OS schema work.
- Operational impact: removes a one-command way to break sign-up in production.
- Irreversible? No.

## Decision
- Decision: ________ (HUMAN DECISION REQUIRED). Option A / B, plus safeguard S1 / S2 / S3.
- Expected outcome: new migrations are tested against the live schema, and `db:push` cannot reach production.
- Required approvals: Data Owner (UNASSIGNED); Security Owner consulted
- Blockers: role roster (OQ-16)
- Next action: owner decision. Until then, **no new migrations are written** and `db:push` must not be run against production.
- Decision date: ________

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory: a migration chain that has never been rebuilt from empty is not a schema of record.
