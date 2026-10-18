# NEXT_ACTIONS — sequenced plan with gates

Each gate needs the stated approval before the next step. Nothing here authorizes production work by default.

## Gate 0 — Inspect the actual checkout (no changes)

1. Run `git rev-parse --show-toplevel`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short --branch`, `git worktree list`.
2. Confirm which worktree holds `v6/rebaseline-2026-10-18` (expected `shygon-tap-v5-web-rebaseline` at `4d730c4`). Do **not** switch branches in any worktree that has uncommitted work (`shygon-tap-v5-web` main checkout, `shygon-tap-v5-web-aaroh`, `shygon-tap-v5-web-website`, `shygon-tap-v5-web-rebaseline`).
3. Read `CURRENT_STATE.md` and `PRODUCTION_DRIFT.md` before anything else.

**Exit criterion:** the agent reports HEAD, branches, dirty files, and the four open blockers, with no changes made.

## Gate 1 — Locate and validate the fresh baseline

Precondition: owner supplies `000_live_baseline_2026-10-18.sql` (produced locally by the owner with `pg_dump 18.x`; never with a pasted password). The intake script is **missing** from the repo — the owner or Friend 1 must supply it, or validation is done manually.

Checks (none run yet):
- Header: `Dumped from database version 17.6`, `Dumped by pg_dump version 18.x`, timestamp 2026-10-18.
- Schema-only (no `COPY`/data rows); `public` schema only; no owner statements.
- No secrets: scan for `rzp_`, `sk_live`, `service_role`, JWT-shaped strings, passwords, connection URIs.
- Verbose per-object markers present.
- Record size and SHA-256. Do **not** invent a checksum.
- Compare function-definition hashes with the reported figures (some hash-match production, others pending).
- Confirm compatibility with `supabase/tests/baseline.sql` loader.

**Exit criterion:** a validation report with pass/fail per check, and a file hash. Owner reviews the report.

## Gate 2 — Rebaseline (only after Gate 1 review)

1. Preserve the old baseline in Git history (it already exists at `supabase/baseline/000_live_baseline.sql` and `supabase/baseline/history/`).
2. On a new commit on `v6/rebaseline-2026-10-18` (or a new branch from it), add the fresh dump as the new baseline with provenance (capture time, pg_dump version, SHA-256, size, the owner who produced it).
3. Compare the fresh schema against `supabase/migrations` (001–026, 028). Record every difference. Do not edit migrations to match.
4. Review migration 025 against production's `enforce_tap_edit_rules` **before** rebasing 025.

**Approval required:** owner approves the new baseline commit.

## Gate 3 — Run verification suites

Run `TESTING_GUIDE.md` §5 in order. Report every failure with output. Do not weaken tests. Do not regenerate expected values automatically.

Expected suites (from the request): schema drift, admin contract, public-Tap golden output, migration 025 pre-apply checks, RLS/access-control matrices, lint, type checks, database verification, adversarial RLS, verify-011, dependency audit. Note: `schema-drift.mjs` and the migration-025 check have **no** `package.json` script in the rebaseline tree — their invocation must be confirmed by reading them.

**Exit criterion:** pass/fail list with actual outputs in the report. Historical numbers are not accepted as current.

## Gate 4 — Prepare fixes for approval (no application)

- Write up each finding (drift item, grant issue, `tap_slug_*` source, `get_public_profile` regression) with the evidence and a proposed fix.
- Do not apply fixes to production. Do not apply migrations 020 or 028 until DEC-2026-003 §3.1 conditions hold.
- Decisions still open that block fixes: DEC-2026-025 (organisations timing), DEC-2026-028 (card lifecycle vocabulary), DEC-2026-020 (Security Owner re-confirmation).

**Approval required:** owner approves each fix and the order.

## Gate 5 — Resume remaining V6 work

Only after Gates 1–4 pass and the owner has approved the next step:
- Stage 6 release readiness is recorded NOT READY, stopped at the production gate. Resume only on owner instruction.
- AAROH multi-experience brief (paused 10-10) and the Phase 0.5 gate for the owner app (memory: waits for the other session's commit). Re-check with the owner before starting.
- Keep payment activation deferred unless the owner changes the decision.

## Parallel items that must not be started by the agent

- Any `db:push` or production write.
- Any deployment, including to www.shygontech.com (which currently serves a non-repo app; see V6-107).
- Commits or pushes without approval.
- Changes to admin UI (Friend 2's area).
- Changes to backend/API ownership areas without coordinating with Friend 1.
