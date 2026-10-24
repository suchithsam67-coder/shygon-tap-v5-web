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
| State | **APPROVED (option A) and IMPLEMENTED, 2026-10-24**, in `3fdfd11` (a cherry-pick of `d6a0b46`; local, not pushed). The audit gate is green on this branch, and the regression is green apart from the pre-existing items. See "Implementation and verification". |

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

## Implementation and verification (2026-10-24)

**Approved** by the owner in session: "Approve DEC-2026-042 option A: cherry-pick d6a0b46 onto v6/aaroh-backend, run npm ci and the full regression here, record before/after results. Local commit only, no push."

**Implemented** [OBSERVED]:
- `git cherry-pick -x d6a0b46` → **`3fdfd11`** on `v6/aaroh-backend` (local, not pushed).
- `package-lock.json` is now identical to `d6a0b46` and to the frontend branch's `1e7e07d`; `package.json` is unchanged.
- `npm ci --no-audit --no-fund` (npm 10.8.2) → exit 0, "added 295 packages in 2m", in this worktree's own `node_modules`. Installed: vite 7.3.7, vitest 4.1.12, esbuild 0.28.2.
- Warning: `EBADENGINE` (vite, `@vitejs/plugin-react` and `eslint-visitor-keys` want Node `^20.19.0 || >=22.12.0`; this machine has v20.18.0). It is **pre-existing**: vite 7.3.5 and plugin-react 5.2.0 declared the same. Production pins Node 22.

| Gate | Before (`24923fa`) | After (`3fdfd11`) |
|---|---|---|
| `npm audit --audit-level=high` | exit 1, "4 vulnerabilities (1 low, 2 moderate, 1 high)" | **exit 0, "found 0 vulnerabilities"** |
| Lockfile SHA-256 (prefix) | `e12ca70a0a276fec` | `3753ec15a145047b` |

**Regression on Node v20.18.0** [OBSERVED]:

| Command | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run build` (`tsc -b && vite build`) | exit 0, built in 33.3 s |
| `npm run test:bundle` | PASS (public Tap entry within budget) |
| `npm run test:bundle-secrets` | PASS (207 files, no secret, no source map) |
| `npm run test:seo` | PASS (17 sitemap pages) |
| `npm run test:push-guard` | 18 passed, 0 failed |
| `npm run test:components` (vitest 4.1.12) | 4 files, **23 passed** |
| `npm run test:db` | exit 0: verify 21, adversarial 64, rls-matrix 1459, identity 69, admin-notes 12, golden 15, admin-contract 15, rollbacks 14, account-deletion 9, history 2 |
| `npm run test:payments:ci` | 15 passed; functions-security 13 passed, **1 BLOCKED** (needs Node 22; pre-existing) |
| `test:payment-chain` / `public-tap` / `suspension` / `emergency` / `rescue` | 30 / 25 / 46 / 49 / 18 passed, 0 failed |
| `test:connect` / `prive` / `local-host` / `admin-edge` / `observability` / `security` | 17 / 12 / 9 / 11 / 10 / 11 passed, 0 failed |
| `npm run test:secrets` (pinned gitleaks) | **FAIL, known:** 82 commits, 1 finding `9c8caa7` (V6-014). No new finding |
| `npx playwright test` | **14 passed** (1.8 min). The local stack rebuilt during the run (`.e2e/build-stamp.json` 2026-10-24 12:57:16, after the `npm ci`), so it ran on the vite 7.3.7 build |

**Vite-dependent steps on Node v22.23.4** [OBSERVED]: the checksum-verified portable Node from P4, first on `PATH` for the command only.

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc -b && node node_modules/vite/bin/vite.js build` | exit 0, built in 9.7 s |
| `node node_modules/vitest/vitest.mjs run` | 4 files, **23 passed** |
| `node scripts/check-bundle-size.mjs` | PASS |
| The `test:payments:ci` body | payments-and-sms 15 passed; functions-security **14 passed, 0 failed, 0 blocked** |

**Result:**
- **G11 is closed on `v6/aaroh-backend`.** The audit gate is green, and every regression step passes except the documented pre-existing items (V6-014, and the Node 20 BLOCKED check, which passes on Node 22).
- No dependency other than the 36 lockfile entries of `d6a0b46` changed.
- Logs are kept in Session A's scratch area (`g11-logs/`, `node22-download/`), not committed.

## Amendment A-1 (2026-10-24): zod (G15)

**Approved by the owner in session:** "Yes: apply a lockfile-only update of zod to a patched version (>=4.6.6), re-run the audit and the full suite, and commit locally. No push."

**Why** [OBSERVED]:
- `npm audit --audit-level=high` turned red again, with the lockfile unchanged since `3fdfd11`: **zod < 4.6.6, high, GHSA-mrhx-c7xc-m3w5** (memory exhaustion validating oversized constrained collections), published after the morning's green run.
- zod 4.4.3 is a **transitive dev dependency**, used by `eslint-plugin-react-hooks` and `zod-validation-error`, which both allow `^3.25.0 || ^4.0.0`.
- Nothing in `src/`, `netlify/` or `api/` imports it.

**Change** [OBSERVED]:
- `npm update zod --package-lock-only` (npm 10.8.2, Node 20.18.0) set zod to **4.6.7**.
- npm also added six unrelated optional `@tailwindcss/oxide-wasm32-wasi/node_modules/*` entries (the known npm behaviour on this tree), which were removed.
- **The final diff is the zod entry only: version, resolved, integrity (3 lines).** `package.json` is unchanged.

**Verified** [OBSERVED]:
- `npm ci` exit 0, with zod 4.6.7 installed.
- `npm audit --audit-level=high` → **exit 0, "found 0 vulnerabilities"**.
- Lint, build, bundle, bundle-secrets, SEO and push-guard pass; vitest 23/23.
- `test:db` green (rls-matrix 1565, golden 16, rollbacks 15, admin-contract 15, account-deletion 9).
- Payments 15; functions-security 13 + 1 BLOCKED on Node 20 (known).
- Stack suites, all 0 failed: modes 17, connect 17, emergency 49, rescue 18, prive 12, public-tap 25, suspension 46, payment-chain 30, local-host 9, admin-edge 11, observability 10, security 11.
- **e2e 14/14.**
- gitleaks: 85 commits, only the known `9c8caa7` (V6-014).
