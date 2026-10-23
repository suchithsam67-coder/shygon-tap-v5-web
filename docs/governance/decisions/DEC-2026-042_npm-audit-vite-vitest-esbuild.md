# DEC-2026-042: The `npm audit` high gate fails on vite / vitest / esbuild (G11)

| Field | Value |
|---|---|
| Decision ID | DEC-2026-042 |
| Title | Bring the approved lockfile fix `d6a0b46` to `v6/aaroh-backend`, or accept the red audit gate on that branch until it is merged |
| Date opened | 2026-10-23 |
| Domain | Engineering (dependencies); Security consulted |
| Level | L1, as with DEC-2026-021: lockfile only, dev tooling, reversible |
| **Accountable Owner (A)** | Engineering Owner, held by the repository owner (DEC-2026-018 Option B) |
| Responsible (R) | Session A (would apply it once approved) |
| State | **PROPOSED.** Session A changed no dependency (DEC-2026-021 precedent: stop and record, do not change dependencies unapproved). |

Labels: **OBSERVED** (seen in the repository or in command output), **REPORTED** (recorded by another session, not re-run by Session A), **INFERRED**, **PROPOSED**.

## Question

`npm audit --audit-level=high` is part of `npm run ci`, and it fails on `v6/aaroh-backend`. The same fix has already been approved and merged on the frontend branch. Should it be applied here too?

## Evidence

**This branch** [OBSERVED, 2026-10-23, npm 10.8.2]:
- `npm audit --audit-level=high` → exit 1: **1 high, 2 moderate, 1 low** (readiness report §11.4).

| Package | Installed | Severity | Advisories (as listed in `d6a0b46`'s message) |
|---|---|---|---|
| vite | 7.3.5 | high | GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm (launch-editor), GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22 |
| vitest, @vitest/mocker | 4.1.11 | moderate | GHSA-qxg6-89mg-rqv8, GHSA-xp26-3454-mjgp |
| esbuild | 0.27.7 | low | GHSA-g7r4-m6w7-qqqr (dev server on Windows) |

- **Where they sit in the manifest** [OBSERVED in `package.json`]:
  - `vite ^7.3.1` and `vitest ^4.1.11` are **devDependencies**;
  - esbuild is transitive, through vite.
- [INFERRED] The site deploys as a static build, and the server functions do not import these packages, so the production runtime is unaffected.

**The fix** [OBSERVED]: `d6a0b46` on `claude/eloquent-yonath-5ffadc` (parent `9fd7a89`, made by another session) changes `package-lock.json` only, 36 entries, with `package.json` unchanged:

| Package | From | To | Note |
|---|---|---|---|
| vite | 7.3.5 | 7.3.7 | patch, inside `^7.3.1` |
| vitest and `@vitest/{expect,mocker,pretty-format,runner,snapshot,spy,utils}` | 4.1.11 | 4.1.12 | patch, inside `^4.1.11` |
| esbuild and 26 `@esbuild/*` platform packages | 0.27.7 | 0.28.2 | **vite 7.3.7 declares `esbuild ^0.27.0 \|\| ^0.28.0`** (lockfile entry), so this is inside vite's own supported range |

- **This branch's `package-lock.json` is byte-identical to `d6a0b46`'s parent** (`git diff --quiet HEAD 9fd7a89 -- package-lock.json`). Only `package.json` scripts differ. So the fix applies here unchanged.
- **The frontend branch** (`claude/shygon-aaroh-v6-frontend-c7fab7`) merged it as `1e7e07d`. Its lockfile is identical to `d6a0b46`'s [OBSERVED].

**Approval and verification recorded by the other sessions** [REPORTED, from the commit messages]:
- `d6a0b46`: "The owner approved this commit on 2026-10-23." On Node 20.18: audit 4 → 0; lint and build pass; vitest 94/94; e2e 33/33.
  - `npm audit fix` crashes on npm 10.8.2 and 10.9.9 (an arborist bug), so the lockfile was made with `npm update … --legacy-peer-deps` and then `npm install --package-lock-only`.
- `1e7e07d`: "The owner approved this merge on 2026-10-23." After `npm ci`: audit 0; every gate passes except V6-123 and V6-014; vitest 98/98; e2e 33/33.
- **Session A has not re-run these after-fix checks.** No dependency was installed in this worktree.

## Options

| Option | What | Risk |
|---|---|---|
| **A (recommended)** | Cherry-pick `d6a0b46` onto `v6/aaroh-backend`: the identical base lockfile, already approved and verified on the frontend branch. Then on this branch: `npm ci`, `npm audit --audit-level=high`, lint, build (with type check), `test:components`, `test:bundle`, `test:bundle-secrets`, the backend suites and e2e, all recorded | Low: patch and minor tooling bumps inside the declared ranges. Known: vitest has a 5 s timeout flake under load (pre-existing, per the other session's notes) |
| B | Leave this branch red. It is a feeder branch, and the release candidate would be the merged frontend branch, which already carries the fix | `npm run ci` stays red here, and any CI run of this branch fails until merged. It depends on G7 (which branch is the release candidate) |
| C | Waive or suppress the advisories | Not recommended: a fix exists, and suppression would hide future findings (DEC-2026-021 kept the gate strict) |

## Recommendation

**A.** It closes G11 on every AAROH branch with the change you already approved for the frontend branch, and keeps the audit gate meaningful. Session A applies it only after your approval of this record, and reports the before/after audit and the full regression results.
