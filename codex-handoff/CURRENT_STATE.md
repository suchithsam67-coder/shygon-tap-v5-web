# CURRENT_STATE — SHYGON TAP / AAROH V6 handoff snapshot

Snapshot taken: **2026-10-18** (local machine time not recorded). Read-only inspection. No application code, SQL, database, production, or Git state was changed.

Labels used throughout: `VERIFIED IN CURRENT CHECKOUT` · `VERIFIED BY CURRENT TEST` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

## 1. Where this handoff was prepared

| Item | Value | Label |
|---|---|---|
| Working directory (this session) | `C:\Users\Suchith s\Documents\shygon tech\shygon-tap-v5-web\.claude\worktrees\shygon-aaroh-handoff-09c0b3` | VERIFIED IN CURRENT CHECKOUT |
| Repository root (`git rev-parse --show-toplevel`) | same as above (a linked Git worktree; `.git` is a file) | VERIFIED IN CURRENT CHECKOUT |
| Current branch | `claude/shygon-v6-aaroh-handoff-ff45a6` | VERIFIED IN CURRENT CHECKOUT |
| HEAD | `8becea30cd584ba636dce662df59a95247f5443c` — `chore(baseline): import SHYGON Tap V5 working tree as found on 2026-09-30` (also tagged `v5-baseline`, and at `main`) | VERIFIED IN CURRENT CHECKOUT |
| Working-tree status | Clean (`git status --short` empty) before this handoff was written | VERIFIED IN CURRENT CHECKOUT |
| `node_modules` in this worktree | Not present; nothing was installed | VERIFIED IN CURRENT CHECKOUT |

**Important:** this session's worktree is a **V5 baseline** checkout (`8becea3`). It does **not** contain the V6 work, the fresh-baseline evidence, or the `4d730c4` suspension fixes. Those live in sibling worktrees (section 3). The handoff package is stored here only because this is the writable worktree in the session.

## 2. Handoff output location

- Directory created: `codex-handoff/` inside this worktree (did not previously exist; checked before creation).
- Nothing was committed. The directory is untracked.

## 3. Worktrees and branches (from `git worktree list`)

| Path (sibling of main checkout unless noted) | HEAD | Branch | Working tree | Label |
|---|---|---|---|---|
| `shygon-tap-v5-web` (main checkout) | `94cbafe` | `opencode/m0.3-handover` | **9 changed entries** (6 modified incl. `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `src/index.css`, `src/pages/ShygonTap.tsx`, `vite.config.ts`; untracked `docs/shygon-os/UI_3D_INTERACTIVE_SCOPE.md`, `scripts/ci/check-no-static-3d.mjs`; 8 of 9 shown in the probe, the 9th not listed) | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web/.claude/worktrees/shygon-aaroh-handoff-09c0b3` (this session) | `8becea3` | `claude/shygon-v6-aaroh-handoff-ff45a6` | clean before this package; now has untracked `codex-handoff/` | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-rebaseline` | `4d730c4` | `v6/rebaseline-2026-10-18` | 7 entries: modified `.gitattributes`, `docs/DECISIONS.md`, `docs/governance/decisions/DEC-2026-003_suspension-guard-and-policy.md`, `docs/release/DEPLOYMENT.md`, `docs/v6/backlog.md`; untracked `docs/governance/evidence/`, `supabase/baseline/history/` | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-suspension` | `4d730c4` | `v6/suspension-guard` | clean | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-v6` | `6d00f2f` | `v6/stage-6-rc` | clean | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-m03` | `5659d15` | `feat/m0.3-security-identity` | clean | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-stabilise` | `29c209c` | `v6/aaroh-stabilise` | clean | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-aaroh` | `f268acd` | `v6/aaroh-store` | **113 entries uncommitted** (e.g. `design-assets/PRINT.md`, `design-assets/editions/*.svg`) | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-commerce` | `93ae352` | `feat/commerce-c5-seo` | clean | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-website` | `8becea3` | `feat/website-experience-upgrade` | 4 entries (`.claude/launch.json` modified; `src/components/home/`, `src/styles/home.css` untracked; `src/pages/ShygonTap.tsx` modified) | VERIFIED IN CURRENT CHECKOUT |
| `shygon-tap-v5-web-upgrade-fix` | `71e79ec` | `fix/upgraded-zip` | not inspected | UNVERIFIED |
| `.claude/worktrees/instagram-profile-connect-fb5176` | `8becea3` | `claude/trusting-bassi-0cc848` | not inspected | UNVERIFIED |
| `.claude/worktrees/shygon-aaroh-design-system-3d2a03` | `8becea3` | `claude/shygon-aaroh-design-system-3d2a03` | not inspected | UNVERIFIED |
| `.claude/worktrees/shygon-aaroh-v6-architecture-c9eb54` | `8becea3` | `claude/shygon-aaroh-v6-architecture-3ff677` | not inspected | UNVERIFIED |

Verified references from the request:
- `8becea3` = V5 baseline — VERIFIED (HEAD of this session, tagged `v5-baseline`).
- `4d730c4` = intended rebaseline base — VERIFIED (HEAD of `v6/rebaseline-2026-10-18` and `v6/suspension-guard`). Commit subject: `fix(security): guard suspension fields on insert and update`.
- `56b0629` (V6 Stage 3) — UNVERIFIED in this pass (not looked up).
- `f268acd` on `v6/aaroh-store` — VERIFIED (HEAD of `shygon-tap-v5-web-aaroh`; subject `perf(aaroh): hero card images sized to their slot; hidden face at low priority`). It is **not** local-only in the sense of being a stray commit: it is the branch HEAD, but the worktree has 113 uncommitted entries.
- Branch `v6/rebaseline-2026-10-18` — VERIFIED EXISTS, checked out at `4d730c4`.

## 4. Baseline file status

| Item | Finding | Label |
|---|---|---|
| `supabase/baseline/000_live_baseline.sql` (rebaseline worktree) | Present. 274,597 bytes. SHA-256 `c12b46eba81e1102f568339f10e6892c3d000282c8cefda7caf8fd9a99a50655` | VERIFIED IN CURRENT CHECKOUT |
| `supabase/baseline/history/000_live_baseline_2026-09-30.sql` | Present, byte-identical (same SHA-256) | VERIFIED IN CURRENT CHECKOUT |
| Header | `Dumped from database version 17.6`, `Dumped by pg_dump version 18.6`, `Started on 2026-09-30 20:24:52` | VERIFIED IN CURRENT CHECKOUT |
| Same-size copies in other worktrees (`v6`, `m03`, `stabilise`, `aaroh`, `commerce`, `suspension`, main `shygon-tap-v5-web`, website) | Each has `000_live_baseline.sql` at 274,597 bytes; not hashed individually | VERIFIED IN CURRENT CHECKOUT (size only) |
| `000_live_baseline_2026-10-18.sql` (fresh dump) | **Not present anywhere** in the checked-out worktrees (searched all sibling directories, excluding `node_modules`) | VERIFIED IN CURRENT CHECKOUT |
| Intake script | **Not found** anywhere: no tracked or untracked file named `*intake*` in any worktree; `git grep` for `intake` found nothing in the five worktrees searched | VERIFIED IN CURRENT CHECKOUT |

The owner-supplied fresh dump is therefore a **pending input**. See [PRODUCTION_DRIFT.md](PRODUCTION_DRIFT.md) §5 and [NEXT_ACTIONS.md](NEXT_ACTIONS.md) gate G2.

## 5. Latest migration evidence available locally

- Local migration files on `v6/rebaseline-2026-10-18` (`4d730c4`): `001`–`026`, `028`, plus `README.md`. Migration `027` is **not** on this branch; it exists on `v6/aaroh-store` / `v6/aaroh-stabilise` as `027_aaroh_catalog.sql`. VERIFIED IN CURRENT CHECKOUT.
- Recorded production-migration evidence file: `docs/governance/evidence/2026-10-18_production-schema-migrations.csv` (rebaseline worktree, untracked). Contains the **seven** migrations named in the request. VERIFIED IN CURRENT CHECKOUT.

## 6. Tests — observed 2026-10-18 (addendum)

Run in `shygon-tap-v5-web-rebaseline` at `4d730c4` on `v6/rebaseline-2026-10-18`, Node **v20.18.0** (below the `>=22.12.0` engine), `node_modules` already present (not reinstalled). Full detail: [TESTING_GUIDE.md](TESTING_GUIDE.md) §8.

Summary: lint, build, DB apply/verify, the full `test:db` chain, and 12 feature suites pass. `test:secrets` fails (gitleaks not installed). `test:payments:ci` has one blocked check (Node 20). `test:e2e` was not run. The DB apply loaded the **2026-09-30** baseline, not the fresh 2026-10-18 dump, which does not exist.

Earlier wording in this file — "no tests were run in this pass" — refers to the original read-only audit and is superseded by this section.

## 7. Unresolved questions

1. Who supplies `000_live_baseline_2026-10-18.sql`, and when? (Owner.)
2. Where is the intake script the request describes? (Not found in any checked-out worktree.)
3. Does the `v6/rebaseline-2026-10-18` branch have a `docs/governance/evidence/` commit or should the evidence CSV be committed? (Untracked today.)
4. Is `9c8caa7` (DEC-2026-020 context) on the expected branch? Recorded in DECISIONS.md as found on `fix/upgraded-zip` parallel worktree; not re-verified here.
5. Whether the 113 uncommitted entries in `shygon-tap-v5-web-aaroh` are intended work (not inspected by content).
