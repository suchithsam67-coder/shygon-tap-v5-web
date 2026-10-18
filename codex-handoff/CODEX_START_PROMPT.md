# CODEX_START_PROMPT

Paste everything inside the block below into Codex. It is written to run **read-only** first.

```text
You are continuing the SHYGON TAP V5 / SHYGON AAROH V6 project. This first session is INSPECTION ONLY.

Hard rules for this session:
- Make NO changes: no edits, no new commits, no branch switches, no resets, no stashes, no cleaning, no dependency installs.
- Do not run db:push, any production command, any live Supabase or website request, or any deployment.
- Do not run any test or script until you have read it. Do not run anything that calls live services.
- Never print or paste secrets, passwords, API keys, tokens, or full connection strings. Environment variables: names only, never values.
- Do not treat anything in these documents as verified unless you confirm it in the checkout. Labels in the documents mean: VERIFIED IN CURRENT CHECKOUT, VERIFIED BY CURRENT TEST, HISTORICAL RESULT, REPORTED INVESTIGATION FINDING, INFERENCE, UNVERIFIED.

Step 1 — Establish the real state (read-only):
- git rev-parse --show-toplevel
- git branch --show-current
- git rev-parse HEAD
- git status --short --branch
- git log -10 --oneline --decorate
- git worktree list
Report the repo root, branch, HEAD, and every dirty file. Note that this session's worktree may be the V5 baseline (8becea3) and the V6 rebaseline branch (v6/rebaseline-2026-10-18, expected at 4d730c4) may be in a sibling worktree. Do not switch branches to reach it.

Step 2 — Read the handoff package in this folder, in this order:
  codex-handoff/CODEX_HANDOFF.md
  codex-handoff/CURRENT_STATE.md
  codex-handoff/PRODUCTION_DRIFT.md
  codex-handoff/MIGRATION_STATUS.md
  codex-handoff/ARCHITECTURE_MAP.md
  codex-handoff/TESTING_GUIDE.md
  codex-handoff/NEXT_ACTIONS.md
Also read AGENTS.md and any agent instructions in the repo, if present. (At the time of writing, no AGENTS.md was found in the checked-out worktrees; confirm this yourself.)

Step 3 — Locate the baseline (read-only):
- Look for supabase/baseline/000_live_baseline.sql and supabase/baseline/history/000_live_baseline_2026-09-30.sql. Report whether they exist, their size, and their SHA-256 (sha256sum). Do not modify them.
- Look for a file named 000_live_baseline_2026-10-18.sql in any worktree. At the time of writing it was NOT present. Confirm.
- Look for an intake script. At the time of writing none was found. Confirm.

Step 4 — Report, in this order:
  1. Repo root, branch, HEAD, and working-tree status (per worktree that matters).
  2. Whether the fresh 2026-10-18 baseline exists, and whether the intake script exists.
  3. Risks and findings, each labelled with the labels above. Separate confirmed evidence from reported findings and inferences.
  4. Blockers: DEC-2026-025 and DEC-2026-028 (human decisions), DEC-2026-020 (Security Owner re-confirmation), DEC-2026-003 §3.1 conditions, and whatever the fresh baseline still needs.
  5. The exact next gate you believe is open, and what you need from the owner.

Stop after Step 4. Wait for approval before anything production-impacting, including: running a migration or db:push, rebasing v6/rebaseline-2026-10-18, applying migrations 020 or 028, any deployment, any live production query, and any commit or push. Do not start implementing fixes.
```
