# SHYGON OS: acceptance criteria (Version 01)

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Rule | A feature is **DONE** only when §1–§6 are satisfied with evidence. A successful build is not proof of production readiness |

## Status ladder (never mixed)

| Status | Meaning | Evidence |
|---|---|---|
| **BUILT** | The code is committed on its owning branch | Commit hash |
| **TESTED** | §1–§3 pass on the local stack and in CI | Test names + counts; the CI run link |
| **APPROVED** | The owner approved the behaviour and the exact wording; counsel where required | DEC / quoted approval |
| **PRODUCTION READY** | §4–§6 pass on a protected preview with a non-production database; the §7 checklist is complete | Hosted evidence |
| **LIVE** | Released to customers by the founder + adult signatory decision | Release record |

## 1. Functional and regression (every feature)
- [ ] Every contract operation, success and error, has a test.
- [ ] Golden public outputs are byte-identical, unless the change is approved.
- [ ] `npm run ci` is green (lint, build, bundle budget, bundle-secrets, SEO, push-guard, test:db, all stack suites, components).
- [ ] e2e journeys pass on a fresh stack.
- [ ] No previously passing test is weakened or skipped.

## 2. Authorization and security
- [ ] The RLS matrix covers every new table and function; anon/authenticated EXECUTE matches the approved list (admin-contract gate).
- [ ] Every SECURITY DEFINER function has a fixed search_path.
- [ ] Server-side checks for every owner operation (the frontend never authorizes).
- [ ] Rate limits and abuse limits tested, including the trusted client address.
- [ ] Privacy canaries: no key, token, UID, phone, email or message text in any response, error or log line.
- [ ] An independent review (OpenCode or equivalent) for security-relevant features, with all P0/P1 fixed and the P2 decisions recorded.
- [ ] The secret scan is clean apart from the approved exceptions (DEC-020, E-1).

## 3. UI, mobile, accessibility, error states
- [ ] Works at 360–430 px phone widths and on desktop. Screenshots for each state.
- [ ] Keyboard and screen-reader basics: labels, focus order, announced errors, contrast AA.
- [ ] Every contract error has a calm, specific UI state; no dead ends; a neutral "unavailable" where needed.
- [ ] The wording matches the owner-approved table.

## 4. Performance
- [ ] Public Tap LCP < 2.5 s, landing < 4 s (slow 4G + 4× CPU, the true final LCP).
- [ ] Public Tap JS < 90 KB budget.
- [ ] Measured on the real host for release.

## 5. Privacy, legal and data
- [ ] Data mapped in the privacy notice (purpose, retention, who sees it).
- [ ] Export includes it; deletion removes it (or the legal reason it's kept is documented).
- [ ] Counsel sign-off for: the emergency features, Return to Owner, Connect, Terms changes, 18+ eligibility.
- [ ] No feature for under-18 users.

## 6. Operations
- [ ] A host switch / kill switch exists and is drilled (on → off within the measured time).
- [ ] Monitoring and alerting cover the feature's errors.
- [ ] Runbook updated.
- [ ] Rollback proven (migration rollback + a redeploy of the previous build).

## 7. Release checklist (Version 01)

| # | Item | Evidence required |
|---|---|---|
| G1 | DEC-018 review of 020–037 | The review record |
| G2 | Production capture + rebaseline; production variants pre-checked | Capture hash; test runs |
| G3 | One host chosen and configured | Config record |
| G4 | Credential rotation B-1 done | Rotation record (no values) |
| G5 | Connect / Return to Owner hosted checks P1 and P2 PASS | Runner evidence JSON |
| G6 | Counsel review complete | Counsel memo |
| G7 | Remote, CI green, release branch tagged | CI links, tag |
| G8 | Monitoring, alerts, backups, restore drill | Drill record |
| G9 | Live payments smoke (one real purchase + admin refund) | Dashboard + app evidence |
| G10 | DLT templates registered; supervised emergency smoke test | Template ids by name; the smoke evidence |
| G11 | Dependency audit 0 high | `npm audit` output |
| G12 | First NTAG batch personalised and batch-verified (if Verified Tap is in the launch) | Batch QA report |
| G13 | The role roster complete with adults for the legal and incident roles | ROLE_ROSTER |
| G14 | Owner-approved wording for every visible V01 string | Approval record |
| G15 | Release decision by the founder + adult signatory | Signed release record |
