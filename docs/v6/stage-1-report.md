# SHYGON V6, Stage 1 report

| | |
|---|---|
| Date | 2026-10-05 |
| Branch | `v6/stage-1-audit` (from `feat/m0.3-security-identity` @ `5659d15`) in worktree `../shygon-tap-v5-web-v6` |
| Full audit | [`stage-1-audit.md`](stage-1-audit.md) |
| Status | **STOPPED. Waiting for the owner's approval of the backlog and scope cuts.** |

## What changed
- Added `docs/v6/stage-1-audit.md` and this report. Nothing else.
- No source, migration, config or test file changed.
- Created the branch `v6/stage-1-audit` and its worktree (git metadata only).

## Commands run (real results)

| Command | Result |
|---|---|
| `git status / branch / rev-parse / log`, `git worktree list`, branch lineage | 6 worktrees; uncommitted work in two (3D hero, homepage redesign), not touched; no remote |
| `npm ci` (fresh worktree) | exit 0; lockfile unchanged |
| `npm run db:apply` | ALL MIGRATIONS APPLIED (020, 021, applied twice) |
| `npm run db:verify` | 21 passed, 0 failed |
| `node supabase/tests/rls-adversarial.mjs` | 64 passed, 0 failed |
| `npm run test:identity` | **69** passed, 0 failed (reported 67: two collision checks added 2026-10-05) |
| `npm run test:golden` | 4 passed, 0 failed (30 slugs) |
| `npm run test:admin-contract` | 8 passed, 0 failed (61 frozen functions) |
| `npm run test:db:history` | 2 passed, 0 failed |
| `npm run test:push-guard` | 18 passed, 0 failed |
| `npm run test:payments:ci` | 15/15 and 13/13; **1 BLOCKED** (needs Node 22) |
| `npm run lint` / `npx tsc -b` / `npx vite build` | exit 0 / exit 0 / exit 0 |
| `npm run test:bundle` | 88.55 kB (88,551 B) of 90 kB; PASS |
| `npm audit --audit-level=high` | exit 0 (1 low: esbuild dev-server advisory) |
| `npm run test:secrets` (gitleaks 8.30.1, 31 commits) | **FAIL: 1 finding**, the known approved key in `9c8caa7` |
| `node supabase/tests/verify-011-admin-notes.mjs` | 16 passed, 0 failed |
| `node supabase/tests/schema-drift.mjs` | the baseline reconstructs cleanly |
| Read-only probe: edge-function role map vs live `admin_role_permissions()` | identical for all 5 roles |

## Open items
- **P0:**
  - B-1 credential rotation;
  - B-2 020/021 not applied to production;
  - B-3 G-PAY (go-live only);
  - **V6-003, paid card orders create no card record (I-4).**
- **P1:**
  - CI never run (B-4 / V6-013) and the E2E environment (B-5 / V6-016);
  - security: F2 admin notes (V6-010), O-7 card suspension (V6-011), O-14 free Tap (V6-012);
  - the secret-scan gate (V6-014) and branch scope (V6-015);
  - testing and operations: fulfilment tests (V6-017), observability (V6-018), I-5 (V6-019), governance mapping (V6-020).
- **P2:** 14 items (see the audit's §8).

## Decisions needed
D-1 to D-8 in the audit's §10. **D-1 (the §2A gate)** and **D-2 (RC contents)** are needed before Stage 2 can start.
