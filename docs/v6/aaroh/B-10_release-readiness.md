# B-10 release-readiness verification (Connect host switch, DEC-2026-039 amendment A-1)

| Field | Value |
|---|---|
| Date | 2026-10-23 |
| Verified commit | `34a482d` on `v6/aaroh-backend` (parent `298667a`, B-9 Part B) |
| Requested by | Repository owner: "B-10 Release-Readiness Verification" |
| Scope | Verification only. Nothing pushed or deployed. No production system, database, migration, RLS policy or live setting was read or changed. No switch was enabled anywhere except inside local test processes. |
| Recommendation | **READY FOR REVIEW.** B-10's code and evidence verify. Its **release is BLOCKED** by the prerequisites in §7. |

Labels:
- **OBSERVED**: seen in this repository or in command output during this verification;
- **INFERRED**: concluded from observed facts;
- **UNKNOWN**: not knowable from this machine.

## 1. Repository state [OBSERVED]

- Branch `v6/aaroh-backend`, HEAD `34a482d2da460bece65401aa99f24c9815527501`, working tree clean before this report.
- Parent: `298667a` (B-9 Part B).
- **No remote is configured** for this branch (`git remote -v` prints nothing; there is no upstream), so it has never been pushed.
- `34a482d` changes 11 files: +120 / −22.
- **Code:**
  - `netlify/functions/connect.mjs` (+16 / −3);
  - `supabase/local/app-host.mjs` and `supabase/local/stack.mjs` (the switch lists);
  - `supabase/tests/connect.mjs` (+47) and `supabase/tests/emergency.mjs` (+2 / −1).
- **Docs:** `DECISIONS.md`, DEC-2026-039, `api-contract.md`, `provider-requirements.md`, the B-10 proposal, the backlog.
- **Not touched:** migrations, RLS, `api/` (the Vercel entry point `api/connect.mjs` passes the request through to the same handler).

## 2. The switch: default off, refusals before any database access [OBSERVED]

**Code** (`netlify/functions/connect.mjs`):
- `publicAllowed = () => env('CONNECT_PUBLIC') === 'on'`, read on every request. `env()` trims the value and treats an empty one as unset.
- `public.status` returns `{ available: false }` when the switch is off, **before** `connect_public_target` is called.
- `requests.create`, `requests.accept` and `connections.share` are in `LOCKED_WHILE_NOT_PUBLIC`. The check runs after the operation name is recognised and **before** `currentUser()` (the auth server) and before any `rpc()` (the database).

**Execution probe.** A scratch script, not committed, called the real handler in-process with `fetch` replaced by a counter that records every outbound URL and refuses it. `SUPABASE_URL` pointed at a closed local port.

| Operation (switch unset) | Status | Outbound calls |
|---|---|---|
| `public.status` | 200 `{"available":false}` | **none** |
| `requests.create` (anonymous) | 404 `unavailable` | **none** |
| `requests.create` (bearer) | 404 `unavailable` | **none** |
| `requests.accept` | 404 `unavailable` | **none** |
| `connections.share` | 404 `unavailable` | **none** |
| `requests.decline`, `requests.block`, `connections.remove`, `connections.list`, `consents.list`, `settings.get` | proceed to sign-in (`/auth/v1/user`) | 1 each |

The 500s on that last row come only from the probe refusing the network. Over real HTTP these operations return 200 (`test:connect`, §4). So they are **designed to stay available** and are not gated.

| `CONNECT_PUBLIC` value | Effect |
|---|---|
| `on`, ` on ` | enabled (the database is consulted) |
| `ON`, `On`, `true`, `1`, `yes`, empty, unset | **off** (no outbound call) |

This is fail-closed, the same rule as `RESCUE_RELAY` and `EMERGENCY_PUBLIC_ALERTS`.

**No bypass** [OBSERVED]: every Connect table and every `connect_*` function is closed to `anon` and `authenticated` and executable only by `service_role` (032). `test:connect` check A1 and `test:rls-matrix` (1459 checks) re-ran green, so `/api/connect` is the only path.

## 3. `publicAllowed` reflects the effective configuration [OBSERVED]

- `settings.get` and `settings.set` report `publicAllowed: publicAllowed()`, the same function that gates the operations. Within one request the report and the gate cannot disagree.
- `test:connect` asserts both states:
  - switch on: `settings.set` → `publicAllowed: true` and `public.status` → `true`;
  - switch off: `settings.get` → `enabled: true, publicAllowed: false` and `public.status` → `false`.
- [INFERRED] It reflects the environment of the function instance that answers. A host applies a changed variable when it next deploys or restarts instances, so during a rollout two instances could briefly disagree.

## 4. Test-only hooks cannot enable production access [OBSERVED]

- `/__sim/switches`, `STACK_SIM_CLIENT_ADDRESS` and `x-shygon-sim-client` exist only in `supabase/local/app-host.mjs` and `supabase/local/stack.mjs`.
  - `/__sim/*` control routes answer only when the stack passes its `control` object, and only to loopback callers (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`); otherwise 403.
  - The stack listens on `127.0.0.1` only.
- **Nothing deployable imports the local stack:**
  - `netlify.toml` deploys `functions = "netlify/functions"` and publishes `dist`;
  - `vercel.json` builds `dist` and serves `api/`;
  - the only importers of `supabase/local` are test files (`netlify/tests/*.mjs`, `e2e/stack.ts`, `playwright.config.ts`).
- A fresh `npm run build`: `dist` contains none of `__sim`, `x-shygon-sim-client`, `CONNECT_PUBLIC` or `STACK_SIM_CLIENT_ADDRESS`.
- Setting `STACK_SIM_CLIENT_ADDRESS` on a real host would do nothing: no deployed code reads it.

## 5. Tests: exact commands and results

Run on 2026-10-23, Node v20.18.0, in this worktree, with outbound network denied for every suite that uses `scripts/ci/deny-network.mjs`.

| Command | Result |
|---|---|
| `npm run test:connect` | **17 passed, 0 failed** (includes "host switch off (CONNECT_PUBLIC unset): nothing starts or widens; decline, block, remove and the lists still work") |
| `npm run test:emergency` | **49 passed, 0 failed** (includes the visitor-alert host switch and the `/__sim/switches` list of three) |
| `npm run test:rescue` | 18 passed, 0 failed |
| `npm run test:local-host` | 9 passed, 0 failed |
| `npm run test:prive` | 12 passed, 0 failed |
| `npm run test:public-tap` | 25 passed, 0 failed |
| `npm run test:suspension` | 46 passed, 0 failed |
| `npm run test:payment-chain` | 30 passed, 0 failed |
| `npm run test:admin-edge` | 11 passed, 0 failed |
| `npm run test:observability` | 10 passed, 0 failed |
| `npm run test:security` | 11 passed, 0 failed |
| `npm run test:payments:ci` | payments 15 passed; functions-security **13 passed, 1 BLOCKED** ("verify-payment refuses an unauthenticated caller": needs Node 22; pre-existing) |
| `npm run test:db` | Chain completed: every step runs only if the previous one passed. rls-matrix 1459 (51 tables × 7 callers), identity 69, admin-notes 12, golden 15, admin-contract 15, rollbacks 14, account-deletion 9, history 2 |
| `npm run test:components` | 4 files, 23 tests passed |
| `npm run lint` | exit 0 |
| `npm run build`; `npm run test:bundle`; `npm run test:bundle-secrets` | exit 0; PASS (entry within budget); PASS (207 files, no secret, no source map) |
| `npm run test:secrets` (pinned gitleaks) | **FAIL: 1 known historical finding** (`9c8caa7`, `src/components/ProjectConsultation.tsx:75`, value redacted; DEC-2026-020 / V6-014). Nothing new in B-9 or B-10 |
| `npx playwright test` (this branch's e2e, local stack) | **14 passed** (3.1 min). Desktop: a11y ×5, account data, journeys (a)–(c), store, performance ×2, public Tap on phone; plus the phone project ×1 |

**Negative control** (during the build, 2026-10-23): with the previous `connect.mjs`, `test:connect` → **15 passed, 2 failed** (the switch and `publicAllowed` checks).

**Skipped or not run:**
- Session B's browser journey for the switch (`e2e/aaroh-server-paths.spec.ts`, commit `ee5b532`): **run by Session B, 33 passed, 0 failed** (see §10). Not re-run by Session A.
- The functions-security check that needs Node 22.

## 6. Documents [OBSERVED]

**Consistent with the code:**
- AAROH-API **v0.7.1**: header, §1 rule 11 hooks, §10b host switch, operations table, §12, §13;
- DEC-2026-039 amendment A-1;
- `DECISIONS.md`;
- B-9 plan §5–§6 (`TRUSTED_CLIENT_IP_HEADER`, sim header);
- `provider-requirements.md` (`CONNECT_PUBLIC` "leave unset"; `TRUSTED_CLIENT_IP_HEADER` per host);
- backlog V6-124, V6-125, V6-126.

**Inconsistencies found** (documentation only; not fixed in this verification):

| # | Where | Issue | Suggested fix |
|---|---|---|---|
| D1 | `capability-matrix.md` row 4 and §4; `backend-audit.md` (Connect lines) | Say `test:connect` 16 and do not mention the host switch | Note "off by `CONNECT_PUBLIC` until owner verification"; 17 checks |
| D2 | `api-contract.md` §10b, the **Status** line | "A Connect control may ship with the first production release that contains 032" does not add "and `CONNECT_PUBLIC=on` by owner decision" (the bullet above it does) | Add it to the Status line |
| D3 | `B-10_connect-switch-proposal.md` §3 | Still says "AAROH-API v0.8 or a point release" (it became v0.7.1) | Point to v0.7.1 |
| D4 | DEC-2026-039 A-1 | The approval date is recorded as "before the 2026-10-23 resume" | The owner confirms the date, if the record needs it |
| D5 | `.env.example` | Lists none of the AAROH settings (`EMERGENCY_PUBLIC_ALERTS`, `RESCUE_RELAY`, `CONNECT_PUBLIC`, `TRUSTED_CLIENT_IP_HEADER`, `CRON_SECRET`, `MSG91_*` emergency templates, `MSG91_DLR_SECRET`, `HOTEL_PROVIDER`). `provider-requirements.md` is the only list | Add them, unset and commented |

## 7. Deployment configuration, preview checks, risks, approvals

### 7.1 Deployment configuration

[OBSERVED, repository only; live host dashboards were not read]
- `netlify.toml` `[build.environment]` sets only `NODE_VERSION = "22"`.
- `vercel.json` has no `env` (and no `crons`).
- No tracked config, workflow or example file names `CONNECT_PUBLIC`, `TRUSTED_CLIENT_IP_HEADER`, `EMERGENCY_PUBLIC_ALERTS` or `RESCUE_RELAY`.

**`CONNECT_PUBLIC` is unset by default everywhere the repository controls.**

**`TRUSTED_CLIENT_IP_HEADER` is configured nowhere in the repository.** On any deploy, visitor emergency alerts and Return-to-Owner starts would answer `unavailable` until it is set. Both switches are off anyway. It is not used by Connect.

[UNKNOWN] Live host environment variables (Netlify / Vercel dashboards): not inspected, by constraint. The deploy target itself is undecided (V6-043).

### 7.2 Required preview checks (the owner's actions; non-production database only)

| # | Check | Why |
|---|---|---|
| P1 | On a preview of each host: the address-header check in `B-9_client-address-plan.md` §6 | Before `EMERGENCY_PUBLIC_ALERTS` or `RESCUE_RELAY` is turned on. Not needed for Connect. **BLOCKED (§11)** |
| P2 | **PARTIAL (§11):** the local non-production equivalent passes 18/18; the hosted part is BLOCKED. On a preview with 032 applied to a **non-production** database and `CONNECT_PUBLIC` unset: `public.status` false; create, accept and share 404; decline, block, remove and the lists work; `publicAllowed` false. Then set `on`, redeploy, and confirm the behaviour returns | Confirms the default on the real host, and how quickly a change takes effect (§3, R2) |
| P3 | Session B's e2e at `ee5b532` (the switch journey) | **Done (reported by Session B, 2026-10-23): 33 passed, 0 failed** (§10) |
| P4 | `npm run test:payments:ci` under Node 22 | Clears the one BLOCKED functions-security check; Netlify builds with Node 22. **Done 2026-10-23 (§11.3): Node v22.23.4, 15/15 and 14/14, 0 blocked** |

### 7.3 Remaining security and consent-flow risks

| # | Risk | Assessment |
|---|---|---|
| R1 | Only the exact value `on` enables Connect; `ON` or `true` leave it off | Fail-safe; documented as `on` in `provider-requirements.md`. Operator awareness only |
| R2 | Turning Connect **off** in an emergency is not instant: a host applies changed variables on its next deploy or instance restart | [INFERRED] Measure in P2. There is no runtime kill switch without a deploy |
| R3 | **Switching off does not revoke existing grants.** Accepted connections stay readable through `connections.list` while their grants are active; only new or wider sharing stops | As designed and approved ("create, accept and share blocked; decline, block, remove and lists always work"). If "off" should also freeze reads, that is a new decision |
| R4 | Requests pending at switch-off stay pending until decided, withdrawn or expired (30 days, via the sweep) | Targets can decline or block; requesters can withdraw. As designed |
| R5 | An anonymous `requests.create` answers 404 (not 401) while off | Documented in v0.7.1; reveals nothing |
| R6 | An owner can still switch their own Connect on while the host switch is off | They see `enabled: true, publicAllowed: false`; Session B's `ee5b532` shows a notice (result pending, P3) |
| R7 | Local verification ran on Node 20; the hosts run Node 22 | P4 |
| R8 | Git history holds one known secret finding | V6-014; a release gate (rotation B-1 / PB-4) |

### 7.4 Outstanding governance approvals and human decisions

| # | Item | Owner |
|---|---|---|
| G1 | DEC-2026-018 cool-off and checklist review of migrations 020–033 (032 is Connect) before any real database | Repository owner |
| G2 | A fresh production schema capture and the rebaseline (V6-106) | Repository owner (Data Owner) |
| G3 | The deploy target (V6-043) | Repository owner |
| G4 | B-1 credential rotation; V6-014 secret finding | Repository owner |
| G5 | Verification of the connection and consent workflows, then the decision to set `CONNECT_PUBLIC=on`, plus approval of the customer wording | Repository owner |
| G6 | Counsel review (DEC-2026-017; may revisit DEC-2026-039 Q7) | Repository owner → counsel |
| G7 | Creating the remote and pushing; CI has never run remotely (B-4). Merge approvals for Session B's branch | Repository owner |
| G8 | Optional: an emergency `publicAlertsAllowed` setting for symmetry (proposed in B-10 §1, not approved) | Repository owner |
| G9 | Fixing documentation items D1–D5 | **Done** (§9, `32a4ac9`) |
| G10 | Migration 027 on the release branch (V6-123): move it to `supabase/proposed/` (Phase 0.5), so no release bundle contains it | Repository owner (who and when) |
| G11 | The dependency-audit gate: bring in the lockfile fix `d6a0b46` (or an equivalent update) on the release branch, then re-run the audit and the component tests | Repository owner |
| G12 | Node 22 for P4 | **Done**: the owner permitted the download on 2026-10-23 (§11.3) |
| G13 | A non-production Supabase project for P2: create it, add it to `supabase/non-production-projects.json` (currently empty), and authorise applying 020–033 to it | Repository owner |
| G14 | Preview deployments on the intended host(s) for P1 and P2, with their credentials; follows G3 | Repository owner |

## 8. Recommendation

**READY FOR REVIEW.**

**Verified:**
- the switch defaults to off;
- the refused operations are rejected before any database or auth call;
- withdrawal and management stay available;
- `publicAllowed` is computed by the same function as the gate;
- the test hooks are unreachable in deployed code;
- every suite passes, except the two pre-existing items (the gitleaks history finding, and the check that needs Node 22).

**Not READY FOR AUTHORIZED RELEASE**, because:
- 032 is applied to no real database and is waiting on G1 and G2;
- the deploy target is undecided (G3);
- preview checks P1–P4 are pending;
- the release-track items G4 and G7 are open.

B-10 itself is a fail-closed lock. Shipping it exposes nothing, but it has nothing to protect until 032 is deployed.

**Correction (2026-10-23, §11):** "every suite passes" above did not cover `npm audit --audit-level=high`, which was not run on 2026-10-23 before §11. It **fails** on this branch (§11.4). The recommendation is unchanged.

## 9. Follow-up 2026-10-23: documentation items D1–D5 fixed (owner request; docs only)

| # | Fix |
|---|---|
| D1 | `capability-matrix.md` row 4 and §4: the host switch and `test:connect` 17. `backend-audit.md`: §8 lists the new settings; a dated §15 records B-9 and B-10, leaving the 2026-10-20 sections as written |
| D2 | `api-contract.md` §10b Status line names the switch. Published as **AAROH-API v0.7.2 (editorial)**: no operation, request or response changed |
| D3 | `B-10_connect-switch-proposal.md` §3: "published as AAROH-API v0.7.1" |
| D4 | DEC-2026-039 A-1, `DECISIONS.md` and the B-10 status: approved **2026-10-20 15:46 UTC (21:16 IST)**, per the session transcript; built 2026-10-23 |
| D5 | `.env.example`: a new AAROH section lists every setting, all commented out and unset, with pointers to `provider-requirements.md` and the B-9 preview check. No value added |

The recommendation in §8 is unchanged: **READY FOR REVIEW**.

## 10. Follow-up 2026-10-23: Session B's browser e2e at `ee5b532` (P3)

**Reported by Session B** (the frontend session). Not re-run by Session A:
- **Result:** **33 passed, 0 failed, 0 skipped, 0 flaky**, 19.2 min, desktop and phone projects, Edge, Node 20.18.
- **Starting state:** the worktree was clean at `ee5b532` (which contains `34a482d` through merge `bd3a85e`). The stack was built fresh on separate ports.
- **Commands** (from Session B's worktree root):
  1. `STACK_APP_PORT=4273 STACK_GATEWAY_PORT=54421 STACK_SIM_CLIENT_ADDRESS=1 npm run stack -- --build`
  2. `STACK_APP_PORT=4273 npx playwright test --reporter=list`
- **The switch journey:** `e2e/aaroh-server-paths.spec.ts:226`, "connect: a signed-in visitor asks from the Tap, the owner accepts, details are self-reported, removal revokes the grants", passed in 2.0 min.
  - **Off:** the owner's "not switched on" notice; the requester's `public.status` is `{available:false}`; no "Ask to connect" link; the request page shows "Not accepting requests" with no Send button.
  - **On** (through `/__sim/switches`): request, accept, self-reported values and removal all work, with the database grants revoked.
  - **Off again:** the switch is reset.
- **Also passed:** the other server-path journeys (`:78`, `:111`, `:150`, `:188`).

**Session A checked** [OBSERVED, `git show`]:
- the test exists at `ee5b532:e2e/aaroh-server-paths.spec.ts:226` with that title;
- the file sets `CONNECT_PUBLIC` through `/__sim/switches` (4 references).

**Effect on the report:**
- P3 is closed.
- The recommendation stays **READY FOR REVIEW**. Release is still blocked by G1–G4 and G7, and by preview checks P1, P2 and P4.

## 11. Gate-completion attempt (2026-10-23, owner request "Complete Remaining B-10 Release Gates")

**State checked** [OBSERVED]:
- branch `v6/aaroh-backend`, HEAD `398d40d`, working tree clean, no git remote;
- P3's evidence is in §10.

Nothing was pushed or deployed. No switch was enabled outside local test processes. No production system or database was used.

### 11.1 P1: address header on host previews: **BLOCKED**

[OBSERVED] The procedure (B-9 §6) needs a preview deployment on each host. This request excludes deploying, and on this machine:
- no Netlify, Vercel or Supabase CLI is installed;
- the branch has no remote;
- the deploy target is undecided (V6-043);
- no non-production database is registered (§11.2).

**Needs:** G3, G13, G14. Then the owner, or Session A with explicit deploy authorisation, runs B-9 §6 on each host.

### 11.2 P2: Connect on a non-production database: **PARTIAL (not closed)**

**Local equivalent: done.** Session A, Node v20.18.0, outbound network denied. A walkthrough through the real `/api/connect` on the local stack, which is PGlite: a throwaway, non-production database.

Command: `node --import ./scripts/ci/deny-network.mjs <scratch>/p2-local-walkthrough.mjs <repo>`. The script is in Session A's scratch area, not committed; its checks extend `test:connect`.

Result: **18 passed, 0 failed**.

| Phase | Check | Result |
|---|---|---|
| off | The owner turns Connect on; settings report it | `enabled=true publicAllowed=false` |
| off | `public.status` | `available=false` |
| off | A request | 404 `unavailable` |
| on | Owner settings | `enabled=true publicAllowed=true` |
| on | `public.status` | `available=true` |
| on | A request shares exactly the chosen field | 201, `iShare=["company"]` |
| on | The owner accepts, sharing back exactly the chosen field | `accepted` |
| on | The requester reads the granted field live, self-reported | `email`, `self_reported` |
| on | Consent ledger: one active grant from the owner | scope `["email"]` |
| off | Widening the sharing | 404 `unavailable` |
| off | Accepting a pending request | 404 `unavailable` |
| off | No grant added by the refused calls | ledger rows unchanged (3) |
| off | The existing grant stays readable until withdrawn (as approved, R3) | `email` |
| off | Decline | `declined` |
| off | Withdrawal (remove) | `removed`, `grantsRevoked=2` |
| off | After withdrawal | `removed`, nothing readable |
| off | Every grant on that connection, both directions | 0 active |
| off | Owner settings report the host switch off | `publicAllowed=false` |

**Hosted part: BLOCKED** [OBSERVED]:
- `supabase/non-production-projects.json` lists **no** project, so there is no non-production Supabase database to apply 032 to;
- applying 020–033 to one needs the owner's authorisation (DEC-2026-018);
- a preview deployment is needed (G14);
- the effect of switching on a real host (R2) cannot be measured locally.

**Needs:** G13, G14. **P2 is not closed.**

### 11.3 P4: functions-security under Node 22: **BLOCKED**

[OBSERVED]
- The only Node on this machine is `C:\Users\Suchith s\AppData\Local\Programs\node\node.exe`, **v20.18.0**. There is no nvm, Volta, fnm or nvs, and no other `node.exe` under Program Files or AppData\Local\Programs.
- The blocked check is "verify-payment refuses an unauthenticated caller" (`netlify/tests/functions-security.mjs:152–156`). It needs native `WebSocket` for supabase-js, which is Node ≥ 22; `netlify.toml` pins Node 22.
- The official build available is `node-v22.23.4-win-x64.zip`, 36 MB, from `https://nodejs.org/dist/latest-v22.x/` (listing dated 21-Oct-2026), with `SHASUMS256.txt` for verification.

Downloading needs the owner's permission (G12).

**Once available:** run `<node22>/node.exe --version`, then `npm run test:payments:ci` with that Node first on `PATH`, and record both outputs.

**Completed 2026-10-23 (P4 CLOSED)**, after the owner's permission: "Yes: download node-v22.23.4-win-x64.zip (36 MB) from nodejs.org into your scratchpad, verify it against SHASUMS256.txt, and run P4 with it. No system install, no PATH change outside that command."

**Download** [OBSERVED]:
- `https://nodejs.org/dist/latest-v22.x/node-v22.23.4-win-x64.zip` (35,604,229 bytes) and `SHASUMS256.txt`, saved to a new folder in Session A's scratch area;
- **SHA-256 `cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20`, equal to the `SHASUMS256.txt` entry**;
- the GPG signature of `SHASUMS256.txt` was not checked: the release keys were not downloaded. Integrity rests on HTTPS from nodejs.org plus the checksum;
- extracted there. Nothing was installed, and the system Node (v20.18.0) and the user `PATH` are unchanged.

**Runtime:** `node --version` → **v22.23.4**, resolved first on `PATH` for the test command only. `typeof WebSocket` → `function`.

**Command.** The exact body of `npm run test:payments:ci`, run directly, because the archive's `npm` shell wrapper printed nothing under Git Bash:

`node --import ./scripts/ci/deny-network.mjs netlify/tests/payments-and-sms.mjs && node --import ./scripts/ci/deny-network.mjs netlify/tests/functions-security.mjs`

**Results:**
- payments-and-sms: **15 passed, 0 failed** (exit 0);
- functions-security: **14 passed, 0 failed, 0 blocked** (exit 0), including **"verify-payment refuses an unauthenticated caller — 401 — no session, no fulfilment"**, the check that was BLOCKED on Node 20.

### 11.4 Known failures, reconciled (none waived)

**V6-123: `test:admin-contract` and migration 027**
- **Evidence** [OBSERVED]:
  - **This branch** has no 027 in `supabase/migrations/` or `supabase/proposed/`, and `test:admin-contract` passes **15/15** here (`npm run test:db`, §5).
  - **Session B's `ee5b532`** has `supabase/migrations/027_aaroh_catalog.sql`, added by `99110f7` (the store lineage). Session B reports 14/15 there, reproduced on the unmodified store base `f0b771c`.
  - B-10 (`34a482d`) does not touch 027.
- **Recorded disposition** [OBSERVED]:
  - DEC-2026-037 (owner, 2026-10-16): 027 is held aside, not applied or deployed until reviewed, and no contract approval may be recorded for it.
  - Phase 0.5 moves it to `supabase/proposed/`.
  - V6-123 says "Not waived".
- **Still open:** G10. The release branch must not carry 027 in `migrations/`.

**V6-014: the gitleaks history finding `9c8caa7`**
- **Evidence** [OBSERVED]: `npm run test:secrets` (pinned gitleaks) → 1 finding, `src/components/ProjectConsultation.tsx:75`, value redacted (§5).
- **Recorded disposition** [OBSERVED]:
  - DEC-2026-020 was APPROVED by the owner on 2026-09-30 as a Web3Forms public-key exception.
  - On 2026-10-02 the owner classified `9c8caa7` as an approved public-key reuse.
  - `.gitleaksignore` is unchanged on purpose, so "the full-history scan stays red and visible".
  - The release decision on the gate is DEC-2026-035 **D-7**, still **OPEN**.
- **Still open:** D-7 (G4).

**Dependency audit (`npm audit --audit-level=high`, part of `npm run ci`)**
- **Evidence** [OBSERVED]: run on 2026-10-23 on this branch with npm 10.8.2 → **exit 1**. Totals: 1 high, 2 moderate, 1 low, 0 critical.

  | Package | Severity | Direct? | Advisory |
  |---|---|---|---|
  | vite | high | direct | launch-editor advisories, incl. GHSA-698v-4r3x-3vcv |
  | vitest | moderate | direct | via `@vitest/mocker` |
  | @vitest/mocker | moderate | indirect | GHSA-qxg6-89mg-rqv8 and a Windows path traversal |
  | esbuild | low | indirect | GHSA-g7r4-m6w7-qqqr, dev server on Windows |

  All have fixes available.
- [INFERRED] All four are build, dev-server or test tooling, not code in the production bundle.
- **Fix available, not merged:** `d6a0b46` on `claude/eloquent-yonath-5ffadc` (parent `9fd7a89`; another session).
  - It is lockfile-only: vite 7.3.7, vitest 4.1.12, esbuild 0.28.2.
  - **Neither `v6/aaroh-backend` nor Session B's branch contains it.**
  - That session's notes record an npm 10.8.2/10.9.9 install crash, the lockfile-safe workaround, and a pre-existing component-test timeout flake under load.
- **Recorded disposition:** none; no waiver exists.
- **Still open:** G11.

### 11.5 Outstanding release-track decisions (complete list)

| # | Decision |
|---|---|
| G1 | DEC-2026-018 review of 020–033 |
| G2 | Production capture and rebaseline (V6-106), including the page-template drift |
| G3 | Deploy target (V6-043) |
| G4 | B-1 rotation and D-7 (the secret-scan gate) |
| G5 | Verifying the Connect workflows, setting `CONNECT_PUBLIC=on`, and the customer wording |
| G6 | Counsel review (DEC-2026-017) |
| G7 | Remote, push, the first remote CI run, and merge approvals (including which branch is the release candidate) |
| G8 | Optional emergency `publicAlertsAllowed` |
| G10 | 027 off the release branch |
| G11 | Dependency-audit fix |
| G12 | Node 22 |
| G13 | A non-production Supabase project |
| G14 | Preview deployments |

**Broader V6 release items** recorded elsewhere, beyond B-10:
- live payments (B-3);
- the SMS provider, DLT templates and sender ID (DEC-2026-038 Q3), with the supervised smoke test;
- the sweep schedule and `CRON_SECRET`;
- showroom wording (Q10);
- DEC-2026-035 D-3, D-8, D-9, D-11, D-12;
- the corporate site's future (V6-107);
- the mode model (DEC-2026-041, PROPOSED).

### 11.6 Verdict

**Unchanged.**
- The B-10 change is **READY FOR REVIEW**.
- Release is **BLOCKED**:
  - P1 is blocked and P2 is only partial (§11.1–11.2). P4 is now closed (§11.3);
  - the dependency-audit gate fails (G11);
  - the decisions in §11.5 are open.
- No gate was marked closed without evidence. **P3 and P4 are closed**; P1 is blocked; P2 is partial.

## 12. Gate-closure directive (2026-10-23): baseline, G11, previews, decision register

**Baseline** [OBSERVED]:
- `v6/aaroh-backend` at `0d1f223`; working tree clean; no git remote.
- No `CLAUDE.md` or `AGENTS.md` in the repository. Governance is `docs/DECISIONS.md` and the DEC records. Under DEC-2026-018 Option B the repository owner holds every governance role, and L3 changes need a 24-hour cool-off plus a checklist.
- `node_modules` is a real directory in this worktree, not shared with other sessions.
- **Contract:** AAROH-API v0.7.2 (editorial). `git diff 34a482d 0d1f223` touches no code (`netlify/`, `api/`, `supabase/`, `src/`, `scripts/`, manifests), so **no implementation change is required**.
- **Attribution:** P3 is Session B's run (§10). P4 is Session A's run (§11.3).

**Nothing was pushed, deployed, installed or enabled.** No production system, database or credential was used.

### 12.1 G11 (dependency audit): **frontend branch fixed (reported); this branch open, DEC-2026-042 PROPOSED**

- **Before:** `npm audit --audit-level=high` on this branch → exit 1 (1 high, 2 moderate, 1 low), recorded in §11.4.
  - `package-lock.json` is unchanged since then (clean tree), so that evidence still applies.
  - **Not re-run in this pass.**
- **Fix:** `d6a0b46` (lockfile only): vite 7.3.5→7.3.7, vitest and `@vitest/*` 4.1.11→4.1.12, esbuild and 26 platform packages 0.27.7→0.28.2.
  - All inside the declared ranges. vite 7.3.7 itself declares `esbuild ^0.27.0 || ^0.28.0`.
  - **This branch's lockfile is identical to `d6a0b46`'s parent** [OBSERVED], so it applies unchanged.
- **Frontend branch:** merged as `1e7e07d`, lockfile identical to `d6a0b46` [OBSERVED].
  - [REPORTED] Owner approval and after-fix evidence, from the commit messages: audit 0; vitest 98/98; e2e 33/33; every gate except V6-123 and V6-014.
- **This branch:** not changed. Following the DEC-2026-021 precedent, Session A wrote **DEC-2026-042** (option A: cherry-pick `d6a0b46`, then run the full regression here) and stopped for approval.

### 12.2 Previews, P1 and P2: **BLOCKED on approvals AP-1–AP-6**

`docs/v6/aaroh/preview-infrastructure-plan.md` holds:
- the hosts (Netlify and Vercel until V6-043 is decided);
- what exists (no remote, no CLIs, no non-production project);
- the configuration matrix, with `CONNECT_PUBLIC` and `TRUSTED_CLIENT_IP_HEADER` per host;
- the isolation checks and the execution outline;
- approval requests AP-1–AP-6.

Creating a project or an externally reachable preview needs those approvals, so **P1 has no host result and P2 has no hosted result.** Both stay open. P2's local equivalent (18/18, §11.2) does not close it.

### 12.3 Decision register

The approver is always the repository owner, in the role shown (DEC-2026-018 Option B).

| # | Decision required | Options (evidence) | Main risk | Role | Blocks |
|---|---|---|---|---|---|
| G1 | DEC-2026-018 cool-off and checklist for migrations 020–033 | Run it now, or after the rebaseline (G2) | Unreviewed L3 schema reaching a real database | Data Owner / Security Owner | Any real database, including AP-3 unless you exempt non-production |
| G2 | Fresh production capture and rebaseline (V6-106), including the page-family drift | Provide the dump; then adopt or revert the drift | Migrations written against a stale schema | Data Owner | Production schema work; DEC-2026-041 BQ-1 |
| G3 | Deploy target (V6-043) | Netlify or Vercel (both configured) | P1 must run on both until chosen | Release Owner | P1 scope; AP-4 |
| G4 | B-1 rotation; DEC-2026-035 **D-7** (secret-scan gate) | Keep the gate red under DEC-2026-020's approved exception, or add the single fingerprint to `.gitleaksignore` (a gate change, which needs approval); history rewrite is not allowed | A red gate masking a new finding, or an ignore list growing | Security Owner | Release |
| G5 | Whether and when to set `CONNECT_PUBLIC=on`; the customer wording | After the hosted P2 and the workflow review | Exposing Connect before the hosted proof | Product Owner | Enabling Connect |
| G6 | Counsel review (DEC-2026-017) | Engage counsel | Third-party contact data (emergency, Connect) | Data Owner | Launch of those features |
| G7 | Remote, push, first CI run; merge plan; **which branch is the release candidate** | The frontend branch (contains the backend up to `34a482d` plus the audit fix) or a merge of both tips | CI has never run remotely | Release Owner | Git-linked previews (AP-4); remote CI |
| G8 | Optional emergency `publicAlertsAllowed` | Approve or drop | None; cosmetic symmetry | Product Owner | Nothing |
| G10 | 027 off the release branch (V6-123) | Move it to `supabase/proposed/` (Phase 0.5) on the frontend branch | 027 entering a release bundle | Data Owner / Engineering Owner | The release bundle |
| G11 | DEC-2026-042 | **Done:** option A approved and implemented in `3fdfd11` (§13) | — | Engineering Owner | — |
| G13 | Non-production Supabase project (AP-2, AP-3) | Create and allowlist it | Accidental production use; prevented by the allowlist and ref check | Data Owner | P2 hosted |
| G14 | Previews and protection (AP-4–AP-6) | Per host, with access protection | An exposed preview; prevented by protection and test data only | Release Owner / Security Owner | P1; P2 hosted |
| Done | G9 (D1–D5), G12 (Node 22) | — | — | — | — |

### 12.4 Known findings, re-verified 2026-10-23 [OBSERVED]

- **V6-123 / 027:**
  - absent on this branch (`migrations/` and `proposed/`: 0);
  - **present at the frontend tip `1e7e07d`** (`supabase/migrations/027_aaroh_catalog.sql`);
  - disposition: DEC-2026-037 hold-aside, **not waived**; G10 open.
- **V6-014:**
  - pinned gitleaks: 80 commits scanned, **1 finding**, `9c8caa7` `src/components/ProjectConsultation.tsx:75` (redacted);
  - disposition: DEC-2026-020's approved exception, with the gate red by design;
  - **D-7 open (G4)**; not waived.

### 12.5 Final checks

| Check | Result |
|---|---|
| P3 / P4 attributed to the session that ran them | Yes (§10, §11.3) |
| G11 has an evidence-backed disposition | Yes: fixed on the frontend branch (reported); DEC-2026-042 proposed for this branch |
| P1 has a result per intended host | **No: blocked** (G3, G14) |
| P2 has a hosted non-production result | **No: blocked** (G13, G14) |
| 027 and secret findings have dispositions | Yes (§12.4) |
| Contract and implementation consistent | Yes: no code change since `34a482d`; v0.7.2 is editorial |
| Production configuration or data changed | No |
| Secrets or test artifacts committed | No: this pass commits only documents (`.e2e`, `playwright-report`, `test-results`, `dist` are ignored; scratch files stay outside the repository) |

### 12.6 Verdict

**B-10: READY FOR REVIEW. Release: BLOCKED.**
- P1 is blocked and P2 hosted is blocked, on approvals AP-1–AP-6;
- G11 is open on this branch, pending DEC-2026-042;
- G1–G7, G10, G13 and G14 are open.

No release approval is claimed.

## 13. G11 closed on this branch (2026-10-24, DEC-2026-042 option A)

- **Owner approval:** "Approve DEC-2026-042 option A: cherry-pick d6a0b46 onto v6/aaroh-backend, run npm ci and the full regression here, record before/after results. Local commit only, no push."
- **Change:** `3fdfd11`, a cherry-pick of `d6a0b46`, lockfile only. The lockfile is now identical to the frontend branch's `1e7e07d`.
- **Before:** `npm audit --audit-level=high` exit 1 (1 low, 2 moderate, 1 high).
- **After:** exit 0, "found 0 vulnerabilities".
- **Regression, Node v20.18.0:**
  - lint, build (`tsc -b && vite build`), bundle, bundle-secrets, SEO and push-guard pass;
  - vitest 23/23; the `test:db` chain green; payments 15;
  - the stack suites 30 / 25 / 46 / 49 / 18 / 17 / 12 / 9 / 11 / 10 / 11, all 0 failed;
  - **e2e 14/14** on a stack rebuilt with vite 7.3.7.
- **Node v22.23.4:** build, vitest 23/23, bundle, payments 15, functions-security 14/0/0.
- **Pre-existing, unchanged:** V6-014 (gitleaks, 1 known finding) and the Node 20 BLOCKED check (passes on Node 22). The `EBADENGINE` warning on Node 20.18 also predates the fix.
- Full tables are in DEC-2026-042 "Implementation and verification".

**Verdict, updated:** B-10 READY FOR REVIEW. **Release: BLOCKED**:
- P1 and hosted P2 are blocked on approvals AP-1–AP-6;
- G1–G7, G10, G13 and G14 are open.

G11 is no longer a blocker on any AAROH branch: here, and on the frontend branch, per Session B's `1e7e07d`.

## 14. 2026-10-24: Info mode built; a new audit advisory (G15)

**Info mode (DEC-2026-041).** The owner approved the implementation scope ("Info mode (Recommended)"), and it is built locally:
- migration 034;
- `/api/modes`;
- the public reader `get_public_tap_mode`;
- contract **AAROH-API v0.8**;
- `test:modes` **17/17**.

Info is **off in the catalogue**, because `get_public_profile` is unchanged (BQ-1).

**Full suite** on Node 20.18, every step 0 failed:
- lint, build, bundle, bundle-secrets, SEO, push-guard;
- vitest 23;
- `test:db` (rls-matrix 1565 / 55 tables, golden 16, rollbacks 15, admin-contract 15, account-deletion 9);
- payments 15; functions-security 13 + 1 BLOCKED on Node 20 (known), "14 functions clean";
- modes 17, connect 17, emergency 49, rescue 18, prive 12, public-tap 25, suspension 46, payment-chain 30, local-host 9, admin-edge 11, observability 10, security 11.

Browser e2e was not re-run: no frontend or app-host change since the 14/14 run this morning (`vite.config.ts` gained only the dev-server allowlist entry).

**G15, new:** `npm audit --audit-level=high` turned red again, with the lockfile **unchanged** since `3fdfd11`.
- **The advisory:** zod < 4.6.6, high, GHSA-mrhx-c7xc-m3w5 (memory exhaustion validating oversized constrained collections). It was published after this morning's green run.
- **Exposure:** zod 4.4.3 is a **transitive dev dependency**, and nothing in `src/`, `netlify/` or `api/` imports it.
- **Not changed** (DEC-2026-021/042 precedent): it needs the owner's approval for a lockfile-only bump. Release stays BLOCKED.

## 15. 2026-10-24: G15 closed (zod), DEC-2026-042 amendment A-1

- **Change:** a lockfile-only update of zod 4.4.3 → **4.6.7** (transitive dev dependency of the lint tooling), with the owner's approval. The diff is the zod entry only.
- **Audit gate:** exit 0, "found 0 vulnerabilities".
- **Full suite:** green on Node 20.18, including **e2e 14/14**. The only items left are the known ones: V6-014, and the Node-20 BLOCKED check.
- **The audit gate is green on this branch again.** The frontend branch still has zod 4.4.3 until it takes this commit.
- **Verdict unchanged:** B-10 READY FOR REVIEW. Release BLOCKED:
  - P1 and P2 hosted, on approvals AP-1–AP-6;
  - BQ-1;
  - G1–G7, G10, G13 and G14.

## 16. 2026-10-24: BQ-1 built (migration 035, contract v0.9)

- **Change:** `get_public_profile` returns null while a Tap is on Info. It is one guard, generated from the exact current body, pinned by the admin-contract gate.
- **Evidence:**
  - golden 17/17: every other Tap is byte-identical;
  - rollbacks 16/16;
  - `test:modes` 17/17, including older clients falling back to "Tap not found".
  - full regression on Node 20.18 [OBSERVED]: every step exit 0 (lint, build, bundle, bundle-secrets, seo, push-guard, test:db with rls-matrix 1565, payments:ci, all 13 stack suites, components 23/23); `npm audit --audit-level=high` 0 vulnerabilities;
  - Node 22.23.4: payments 15/0 and functions-security 14/0/0 (the Node-20-only BLOCKED check passes);
  - browser e2e was not re-run for this change: Info is off by default and golden shows every other Tap is byte-identical.
- **BQ-1 is closed locally.** Info is still OFF in the catalogue: switching it on per environment is the owner's decision.
- **Production:** 035 must be re-based on the fresh capture (V6-106 / G2) before any production use.
- **Verdict unchanged:** B-10 READY FOR REVIEW. Release BLOCKED:
  - P1 and P2 hosted (AP-1–AP-6);
  - G1–G7, G10, G13 and G14.

## 17. 2026-10-25: BQ-1 production variant prepared (V6-106)

- **No fresh production capture.** Session A has no production access and used none. The latest genuine evidence is the owner's of 2026-10-18 (migration record + `VERIFY-LIVE-DRIFT.sql` hash match).
- **Finding** [INFERRED from OBSERVED evidence]: production's `get_public_profile` differs from the repository baseline (`pageTemplate`, `tier_buttons`, two comments). Applied there, `migrations/035` would remove those.
- **Prepared:** `supabase/proposed/035_public_profile_respects_mode.production.sql`. It is production's body plus the single guard, with a pre-check that refuses any other body and an exact rollback. It is not in `migrations/` or `APPLY_ALL.sql`.
- **Evidence:**
  - `npm run test:bq1-production` 13/13 (the full table is in `docs/v6/aaroh/bq1-production-reconciliation.md` §4);
  - gates re-run [OBSERVED]: on Node 20.18 every step exit 0: lint; test:push-guard; test:db (RLS matrix 1565, golden 17, admin-contract, rollbacks 16, the bundle applied as one batch and twice); test:modes 17/17; test:bq1-production 13/13. gitleaks 8.30.1 on each new file: 0 findings.
- **Verdict unchanged:** B-10 READY FOR REVIEW. Release BLOCKED:
  - P1 and P2 hosted (AP-1–AP-6);
  - G1–G7, G10, G13 and G14;
  - the V6-106 fresh capture.

## 18. 2026-10-25: OpenCode hand-off (P1/P2 runners, second review) and the hardening change

**Approval:** the owner, in the coordination session on 2026-10-25: "hand OpenCode's check scripts (48d75fb) and the review findings to the backend and frontend sessions … fix the findings as one hardening change each, and take the scripts after their own full test run". The coordinator relayed it with the owner's words quoted; it was not given in Session A.

**Taken** (cherry-picked with `-x` from `opencode/aaroh-preview-checks`, base `b04a72d`):
- `b719f9b` (= `48d75fb`): `scripts/release/preview-p1-address.mjs`, `preview-p2-connect.mjs`, `preview-checks.test.mjs` and `docs/v6/aaroh/preview-check-runbook.md`. Read in full first: they refuse production hosts and plain http before any request, use only documentation-range addresses, and print no tokens.
- `e18c7cc` (= `572127d`): the review, `docs/v6/aaroh/reviews/2026-10-25_opencode-review-info-mode.md`, with Session A's resolution appended (§8 there).

**Hardening (one change, backend lane), findings #1–#4, #6, #7.** Every new or changed check was run against the old code first and failed there [OBSERVED].

| # | Change | Proof |
|---|---|---|
| 1 | `Object.hasOwn` op lookup in `modes`, `connect`, `emergency` and `rescue`, and in the local REST emulator's two lookups | `test:security` 12 (new: 4 functions × 5 inherited names × 2 callers → 400 `unknown_op`) |
| 2 | `admin-contract`: every function a client role can EXECUTE is as on live, or in `APPROVED_CLIENT_EXECUTE` with exactly its roles | admin-contract 17; 66 as on live + 3 approved; a new anon function fails |
| 3 | `test:modes`: the canary scans every response; the exact key sets of all six owner success answers are pinned | `test:modes` 19 |
| 4 | 034 revised in place (applied nowhere): one lock order (Tap → mode state → Info) in activate, save and clear | a static pin in `test:modes`. **The race itself is not executable on PGlite (one connection): NOT run.** |
| 6 | `modes_info_missing` also flags invalid stored detailed information; the reader uses only it | `test:modes` F-3: owner status, preview and `owner.state` agree with the visitor |
| 7 | 035 refuses to apply without 034 | `test:bq1-production` 14 |

- **Contract AAROH-API v0.9.2:**
  - `unknown_op` for inherited names;
  - `missing` may name `detailedInformation`;
  - `previousMode: null` documented (#8's contract half);
  - `test:connect` has 17 checks (the §10b drift is fixed).
- **`APPLY_ALL.sql`** regenerated: it applies as one batch, and twice.

**The P2 runner, decline and block for real** (the coordinator's question 2; Session A's call):
- With `P2_DECLINE_TOKEN` and `P2_BLOCK_TOKEN`, phase on declines one real request and blocks another. For each, it checks:
  - the requester sees `declined` with nothing shared;
  - its grant is revoked;
  - a new request is refused: 429 `recently_declined` after a decline, 404 `unavailable` after a block.
- A hosted phase on without them is INCONCLUSIVE before any write.
- Wired as `npm run test:preview-checks` (in `ci` and `ci.yml`): 13 checks.
- OpenCode's other choices are accepted: exit codes 0–3, the P1 pre-flight, the INCONCLUSIVE policy, `P2_HOST_LABEL`, and refusing every shygontech.com subdomain.

**Full suite after both changes** [OBSERVED; Node 20.18.0; outbound network denied for the stack suites]. Every step exited 0.

| Group | Results |
|---|---|
| Static checks | lint; build; bundle; bundle-secrets; seo; push-guard |
| `test:db` | verify 21; adversarial 64; RLS matrix 1565; identity 69; admin-notes 12; golden 17; admin-contract 17; rollbacks 16; account-deletion 9; history 2; bundle check |
| Payments | `payments:ci` 15, and 13 + 1 BLOCKED (Node-20-only; on Node 22.23.4: 15, and 14/0/0) |
| Stack suites | payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 19; bq1-production 14; local-host 9; admin-edge 11; observability 10; security 12 |
| Preview checks | 13, on spare ports 4383/54531 (OpenCode's stack uses 4373/54521) |
| Other | components 23/23; `npm audit --audit-level=high` 0 vulnerabilities |

**Not run:**
- browser e2e;
- the hosted P1/P2 themselves (they need AP-1–AP-6).

**Verdict unchanged:** B-10 READY FOR REVIEW. Release BLOCKED:
- P1 and P2 hosted (AP-1–AP-6);
- G1–G7, G10, G13 and G14;
- the V6-106 fresh capture.

## 19. 2026-10-25: OpenCode's review of the production variant (OC-2b) and its fixes

**Approval:** forwarded by the coordinator under the owner's hand-off approval (§18).

**Taken:**
- `89378f6` (= `10a3855`, report file only). My conflict resolution duplicated earlier sections of the review file.
- `b9f3a4a` repairs it: the file is now exactly the first review plus the OC-2b section, checked byte for byte. It was fixed forward; no commit was rewritten.

**OpenCode's verdict:** no P0, no P1. Its probes agree with Session A's:
- the forward statement is the rollback plus the six guard lines;
- both hashes match;
- comment and whitespace changes are refused.

**Fixed** (`supabase/proposed/035_…production.sql`, regenerated; the body is unchanged):
- **P-1:** the pre-check covers volatility, kind and language.
- **P-2:** the pre-check pins the EXECUTE grants.
- **P-3:** the ROLLBACK is guarded.

**Evidence** [OBSERVED]:
- `test:bq1-production` **16/16**. It adds five drift fixtures, each refused with the drift left intact, and the rollback guard.
- Run against the earlier proposal, the new checks fail: the VOLATILE drift was applied, and the unguarded rollback ran.
- lint clean.
- No migration, function or other test changed in this step, so the §18 full-suite results stand for everything else.

**Verdict unchanged:** release BLOCKED (§18). The production variant still waits for the owner's fresh capture (V6-106).

## 20. 2026-10-26: Lost mode (U2) built (migration 036, contract v0.10)

**Approval:**
- The owner, in the coordination session on 2026-10-25 (relayed with the owner's words): "Approved: U2 = Lost mode (option L1) now, for adults' own cards, reusing Return to Owner, off until release. Keep Return to Owner on the Business page too. Defer Guardian until visitor alerts are reconsidered."
- In this session on 2026-10-26: "start".
- Record: DEC-2026-041 amendment A-1, with Session A's design choices L-1 to L-6 for the owner to confirm.

**Built (local):**
- **`036_lost_mode.sql`**, generated from 034's own text:
  - a `lost` catalogue row, OFF;
  - Lost in owner state, activation, preview and the public reader;
  - its ROLLBACK restores 034's functions verbatim.
- **`/api/modes`:** applies `RESCUE_RELAY`.
- **Contract AAROH-API v0.10.**
- **Unchanged:** `get_public_profile` (035's guard already covers Lost), and Return to Owner (031).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]. Every step exited 0.

| Group | Results |
|---|---|
| Static checks | lint; build; bundle; bundle-secrets; seo; push-guard |
| `test:db` | RLS matrix 1565; golden 18 (a new stage for 036, byte-identical); admin-contract 17 (no new client-executable function); rollbacks 17 (036 restores the schema exactly); bundle check |
| Payments | `payments:ci` 15, and 13 + 1 known Node-20-only BLOCKED (Node 22: 15, and 14/0/0) |
| Stack suites | modes **25** (six new for Lost); bq1-production 16; preview-checks 13; security 12; rescue 18; connect 17; emergency 49; and the others as in §18 |
| Other | components 23/23; audit 0 vulnerabilities |

**What the six Lost checks prove:**
- Lost is off by default, and gated by `RESCUE_RELAY`.
- The Return to Owner opt-in is required, and switching never turns it on.
- The reader answers exactly `{ mode: 'lost' }`, while P-1 is null and P-2 is `active`.
- A finder can message the owner, and no Business, Info or owner value appears in any answer.
- The kill switch, the opt-in turned off and suspension each give null, never Business.
- Switching back restores Business byte-identical, and the opt-in is untouched.

**Not run:**
- browser e2e (Session B has no Lost page yet);
- any hosted check.

**Numbering:** U1 (DEC-2026-043, on hold) is renumbered to migration 037 and contract v0.11.

**Verdict unchanged:** release BLOCKED (§18). Lost stays OFF in the catalogue and behind `RESCUE_RELAY` until release.

## 21. 2026-11-01: Verified Tap (U1) built locally (migration 037, contract v0.11)

**Approval:** the owner, in session on 2026-10-31: "Approve local build", answering Session A's recommendations (DEC-2026-043 §11).
- **Answered:** Q1 option A; Q4 option 2; Q5 a code in 037; Q8 D-a; Q9 counter limit off; Q6 left to card design.
- **Still open:** Q2, Q3 and Q7.
- **Scope:** test keys only; `VERIFIED_TAP` off; nothing hosted.

**Built:**
- `c466dde`: OpenCode's crypto core, cherry-picked after review;
- `037_verified_tap.sql`: two closed tables and four service-only functions;
- `/api/verify`;
- `test:verified-tap` and `test:sun`, both in `ci` and `ci.yml`;
- contract AAROH-API v0.11, §10d.
- **Q5 deviation:** the code lives in a closed table, not on `cards`, because four frozen admin functions return whole card rows. The owner should confirm it (DEC-2026-043 §11).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]. Every step exited 0.

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix **1615** (57 tables, the two new ones closed to all 7 callers); identity 69; admin-notes 12; golden **19** (037 byte-identical); admin-contract 17 (no new client-executable function); rollbacks **18** (037 restores exactly); account-deletion 9; history 2; bundle as one batch and twice |
| Verified Tap | `test:verified-tap` **17**; `test:sun` **27** |
| Other suites | as in §20, all exit 0: modes 25; bq1-production 16; preview-checks 13; security 12; payments 15, and 13 + 1 Node-20-only BLOCKED (Node 22: 15, and 14/0/0); components 23/23; lint; build |

**Corrected before commit:**
- My first draft of the Verified Tap test was written to `supabase/tests/verify.mjs`, the existing `db:verify` script, which it overwrote.
- The full run showed `db:verify` at 17 instead of 21. The original was restored from git, the test moved to `supabase/tests/verified-tap.mjs`, and the script renamed `test:verified-tap`.
- No commit ever contained the overwrite.

**Not executed:**
- §7 test 14, a database failure part-way through a transaction: PGlite has a single connection.
- §7 test 15, a restore rolling the counter back: the external acceptance log waits for Q2.
- Real phones and real chips.
- Browser e2e: there is no `/d/` page yet (Session B).

**New findings:**
- **Secret-scan exception E-1 is PROPOSED** (DEC-2026-043 §11). gitleaks flags seven published test vectors in `netlify/tests/sun.mjs`. They need the owner's approval before their fingerprints are added; until then `test:secrets` reports them, alongside V6-014.
- **`npm audit`: one new moderate advisory**, `minimatch` GHSA-g3hv-75wg-m249, a denial-of-service risk. It reaches only dev tooling (eslint / typescript-eslint), counted 12 times through the dependency chain. The high gate passes. The fix offered is a forced, breaking `typescript-eslint` upgrade, so it is the owner's decision (compare DEC-2026-042).

**Verdict unchanged:** release BLOCKED (§18). Verified Tap stays off (`VERIFIED_TAP` unset), with no real keys.

## 22. 2026-11-02: OpenCode's second review of Lost mode (OC-5) and its hardening (contract v0.11.1)

**Hand-off:** the coordinator forwarded OpenCode's review of `39d87ca` with the owner's standing pattern for review findings ("assess, fix as one hardening change, owner at your gate"). Session B built Lost against v0.10 (committed 11-01), so it is told about the wording change.

**Taken:** `d20b3da` (= `c62217d`), the review report `docs/v6/aaroh/reviews/2026-10-30_opencode-review-lost-mode.md`, with Session A's resolution appended (§8 there).
- Its verdict: no P0 or P1, and no leak in any switch combination.
- Its findings: one P2, two P3s and two nits.

**Hardening (one change, backend lane), findings #1–#5.** The new and changed checks were run against the old 036 first [OBSERVED]: `test:modes` 25 passed, 3 failed (the Info F-1 preview, the catalogue × relay cell "catalogue off, relay on", and the lock order).

| # | Change | Proof |
|---|---|---|
| 1 (P2) | 036 `modes_preview` follows the reader. Lost needs the catalogue row on. Info also needs the catalogue on and an active, unsuspended Tap. | The catalogue × relay check; Info fallbacks F-1 and F-5 assert the preview |
| 2 (P3) | Contract §6 names the four database-side reasons for a `null` Lost answer. `RESCUE_RELAY` off is visible only through `public.status`. | The reader's relay-off answer is pinned: `{ mode: 'lost' }` with `public.status` `false` |
| 3 (P3) | Contract §6 `owner.activate`: a Lost activation repeated while the relay is off answers 409 `mode_unavailable`, with nothing changed | A replay check: 409 with the relay off; the first answer with `replayed: true` once it is back on |
| 4 (nit) | One check walks catalogue × relay over the preview, the reader, `owner.state` and `public.status`, with the leak canary in each cell. The "catalogue off, relay on" cell reaches the database's own catalogue gate. | `test:modes` **28** (25 before) |
| 5 (nit) | 036 activation reads the opt-in `FOR SHARE`, after the Tap and mode-state locks | A static pin read from `pg_proc`. **The race itself is not executable on PGlite (one connection): NOT run.** |

- **Contract AAROH-API v0.11.1:** no new operation, field or error code.
- **`036_lost_mode.sql`:** regenerated from `gen-036.cjs`. Its ROLLBACK is unchanged (034's functions, verbatim).
- **`APPLY_ALL.sql`:** regenerated. It applies as one batch, and twice.
- **Records:** a DEC-2026-041 A-1 note. L-1 to L-6 are unchanged and still await the owner's confirmation.

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]. Every step exited 0.

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix 1615 (57 tables, 7 callers); identity 69; admin-notes 12; golden 19; admin-contract 17; rollbacks 18 (036 restores exactly); account-deletion 9; history 2; bundle as one batch and twice |
| Affected suites | modes **28**; rescue 18; verified-tap 17; bq1-production 16; sun 27; lint |

**Not run:**
- the other stack suites, components, build and browser e2e. This change touches only 036, `test:modes` and documents; `netlify/functions/modes.mjs` is unchanged.
- any hosted check.

**For Session B (v0.11.1):**
- Always call `public.status` before showing the Lost form.
- `owner.preview` may answer `null` for a mode SHYGON has switched off.
- A 409 on a retried Lost activation means the relay went off.

**Verdict unchanged:** release BLOCKED (§18). Lost stays OFF in the catalogue and behind `RESCUE_RELAY`.

## 23. 2026-11-03: the owner data export (V01 T-10) built locally (migration 038, contract v0.12)

**Scope:** the founder approved the Version 01 scope on 2026-11-02 ("Approve F-1", relayed by the coordinator with the founder's words; `docs/shygon-os/v01/`). Data export is a V01 row.

**Approval:** the owner, in this session on 2026-11-03: "Approve T-10 build". That answered "Approve building T-10 locally on DEC-2026-044's recommended answers?", so Q1–Q6 are as recommended. Local only. Counsel reviews the privacy-notice wording before release.

**Built:**
- `038_owner_data_export.sql`: `account_export_build` (STABLE, one snapshot, explicit field lists) and `account_export_request` (5 per 24 hours under a per-account lock; the vCard fields; one `account_events` row). Both service-only; no new table.
- `/api/account` `owner.export` (+ the Vercel adapter) and `netlify/lib/vcard.mjs` (vCard 3.0, escaped and folded).
- Contract AAROH-API v0.12, §4a. O-4, the browser export, is superseded.
- `test:account-export` 12, in `ci` and `ci.yml`. `test:security` covers `/api/account` in the inherited-name check.

**What the owner gets, and what is left out:** see DEC-2026-044 §4.2 and §8.
- In: the owner's own data from every AAROH table.
- Out: other people's data (finders' words, the Connect counterpart, contacts' full numbers, visitors, staff) and security values (activation codes, the chip's serial number, hashes, digests, keys).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites].

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix 1615 (no new table); identity 69; admin-notes 12; golden **20** (a new stage for 038, byte-identical); admin-contract 17 (two new service-only functions; the client-executable set is unchanged: 66 as on live + 3 approved); rollbacks **19** (038 restores exactly); account-deletion 9; history 2; bundle as one batch and twice |
| New | `test:account-export` **12** |
| Other suites, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 15, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 17; local-host 9; admin-edge 11; observability 10; security 12 (now 5 functions); components 23/23; preview-checks 13 (ports 4383/54531); `npm audit --audit-level=high` exit 0 (12 moderate: the known minimatch advisory) |
| `test:secrets` | gitleaks 8.30.1 (the pinned version; the earlier copy had been cleared, so Session B's copy was used): only the known V6-014 finding (`9c8caa7`), before and after this commit |

**Negative control** [OBSERVED]: a copy of 038 that leaked the activation code and the finders' words, and added an unclassified table, failed 3 of the 12 checks: the canaries, the round trip and the classification. The clean 038 was restored and compared byte for byte.

**Corrected before commit:** the row cap appended a section name with `text[] || 'name'`, which PostgreSQL read as an array literal. The cap test caught it, and `array_append` fixed it.

**Finding for Session B:** the browser export (V6-072, `src/services/privacy.ts`) cannot read the closed AAROH tables, and its `select('*')` returns `cards.activation_code` and `card_uid`. The page should move to §4a.

**Not run:**
- two exports racing the limit: PGlite has one connection, so the advisory lock is read from the function instead;
- browser e2e: Session B has not built the page yet;
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18). The export needs no switch or provider; it is local only, like everything else on this branch.

## 24. 2026-11-05: account phone verification (V01 T-11, finding F4) built locally (migration 039, contract v0.13)

**Approval:** the owner, in this session on 2026-11-05: "Approve T-11 build". That answered "Approve building T-11 locally on DEC-2026-045's recommended answers?", so Q1–Q6 are as recommended. This also answers DEC-2026-022 Q3. Local only. The DLT template and the SMS provider are the adult authorised signatory's (F-2, F-10).

**Built:**
- `039_account_phone_verification.sql`, generated from 038's text:
  - two closed tables;
  - five service-only functions under a per-account lock;
  - the export's `phoneVerification` section.
- `/api/account`: `phone.status`, `phone.verify.start` and `phone.verify.confirm`.
- `card-otp`: a code only to a verified phone past its wait.
- `orderMessages`: the account-phone fallback only when verified.
- `account-deletion.sql`: deletes both tables.
- Contract AAROH-API v0.13 (§4b, §7 C-2, §4a); provider requirements gain the fourth DLT template.

**The rule:** the account phone is verified only while `profiles.phone`, in E.164, equals the number verified by a code. A number that replaces a verified one waits 24 hours before it can confirm card actions, and the owner is told in the app.

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites; texts only to the SMS stand-in].

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix **1669** (59 tables, the two new ones closed to all 7 callers); identity 69; admin-notes 12; golden **21** (a new stage for 039, byte-identical); admin-contract 17 (two approved new relations; the client-executable set is unchanged); rollbacks **20** (039 restores exactly, 038's export builder included); account-deletion 9; history 2; bundle as one batch and twice |
| New and changed | `test:phone-verify` **12**; `test:account-export` 12 (the parity map now holds 49 linked tables); `test:payments:ci` **16** (the order-text fallback: sent when verified, not when unverified), and 13 + 1 known Node-20-only BLOCKED |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 17; local-host 9; admin-edge 11; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 (7 moderate, 12 on 11-03; not examined here) |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`), before and after this commit |

**Negative control** [OBSERVED]: the suite was run against the committed `card-otp` and `orderMessages` (`374babc`), and 3 checks failed:
- unverified: `card-otp` answered 200 and texted;
- **a stolen session that swapped the number received a card code at once** (finding F4 reproduced);
- the order text went to an unverified number.

The new files were restored and compared byte for byte.

**Residual risk:** an account that has never verified a phone has no earlier number to protect. A stolen session can verify its own number and confirm card actions without the wait (DEC-2026-045 §8; Q4 accepted it). Step-up authentication, after V01, closes it.

**Consequence to plan for:** until the DLT template and a provider exist, `phone.verify.start` answers 503, and therefore **`card-otp` refuses every account**. No AAROH card is sold (DEC-037); V5 cards on a future V6 deployment would be affected.

**Not run:**
- two requests racing the limits (PGlite has one connection; the lock is read from the functions);
- a real SMS;
- browser e2e (Session B has no screen yet);
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).

## 25. 2026-11-10: administrator MFA, step 2 (V01 T-12) built locally (migration 040, contract v0.14)

**Assessment first, as the coordinator asked** (DEC-2026-046, `a1863b8`). Requiring a second factor at once would lock every administrator out:
- the Expo admin app has no MFA screens;
- it re-runs `admin_me()` on every token refresh;
- it signs the operator out on 42501.

The two admin edge functions check access on their own.

**Approval:** the owner, in this session on 2026-11-10: "Approve T-12 option A", answering "Approve building step 2 of T-12 (the opt-in database rule) locally?". Q1–Q5 are as recommended.

**Built:**
- **Migration 040:**
  - `is_admin` and `admin_has` also need `admin_mfa_satisfied()`;
  - `require_admin` and `admin_me` refuse with `admin:mfa_required` (P0001, never 42501);
  - `admin_mfa_status()` for the app; `admin_mfa_set_required()` service-only; the switch row OFF.
- **The local stack:** `auth.jwt()` and `auth.mfa_factors` in the platform shim. The auth stand-in gains GoTrue's MFA endpoints with RFC 6238 codes and `aal2` sessions.
- **Contract AAROH-API v0.14 (§12a)**, and the admin-contract approvals for the four frozen edits.

**The rule:** an administrator who has a verified factor must use an `aal2` session for every admin function, the admin read policies and `admin_me`. An administrator without a factor is unaffected until the switch is turned on (step 3).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites].

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix **1704** (60 tables, the switch closed to all 7 callers); identity 69; admin-notes 12 (administrators without a factor, unchanged); golden **22** (a new stage for 040, byte-identical); admin-contract **21** (the four frozen body edits approved exactly; `admin_mfa_status()` the only new client-executable function); rollbacks **21** (040 restores exactly); account-deletion 9; history 2; bundle as one batch and twice |
| New | `test:admin-mfa` **9** (through supabase-js's MFA API) |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 16, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 17; account-export 12; phone-verify 12; local-host 9; admin-edge 11; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 (7 moderate) |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`), before and after this commit |

**Negative control** [OBSERVED]: 040 without its four frozen-function edits failed 2 of the 9 checks. An enrolled administrator's password-only session was accepted, and the switch had no effect. The real 040 was restored and compared byte for byte.

**Open, with their own approvals:**
- the admin app's MFA screens (DEC-2026-046 Q2: no session owns `../shygon-tap-v5-admin`, and it is not under version control);
- `admin-refund` and `admin-push`, which still accept a password-only administrator session (Codex, after V6-094);
- step 3, switching ON (Q4);
- the break-glass runbook (Q5, the adult incident lead).

**Verdict unchanged:** release BLOCKED (§18).

## 26. 2026-11-10: card pairing and report stolen (V01 T-08, T-09) built locally (migration 041, contract v0.15)

**Approval:** the owner, in this session on 2026-11-10: "Approve T-08/T-09 build". That answered "Approve building T-08/T-09 locally on DEC-2026-047's recommended answers?", so Q1–Q7 are as recommended, including F-14: the Verified Tap code stays in `tap_device_auth`.

**Built:**
- **Migration 041,** generated from 037's and 039's text:
  - the append-only `card_events`, `card_transition()` and a guard trigger for AAROH cards;
  - `verify_device_lookup` answers `pairing` for a `pending` or `shipped` card;
  - the owner card functions, and each card's history in the export.
- **The possession proof** (`netlify/lib/possession.mjs`) on a genuine pairing tap.
- **`/api/cards`:** list, tap to activate, report stolen.
- **Contract AAROH-API v0.15** (§7 C-6 to C-8, §10d).

**The rules:**
- An AAROH card becomes active only with a genuine tap of that card plus its owner's own session, and it never expires.
- Every other writer is refused and logged.
- A suspended card is not pairable (O-7 stays closed).
- Report stolen is terminal, and the card then opens nothing.
- V5 cards keep every live path. `/t/` still opens for them (F3), and the contract says so.

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites; a simulated chip with random test keys].

| Group | Results |
|---|---|
| `test:db` | verify 21; adversarial 64; RLS matrix **1729** (61 tables, `card_events` closed to all 7 callers); identity 69; admin-notes 12; golden **23** (a new stage for 041, byte-identical); admin-contract 21 (`card_events` an approved new, closed relation; no new client-executable function); rollbacks **22** (041 restores exactly, 037's lookup and 039's export builder included); account-deletion 9; history 2; the bundle current and applied as one batch and twice |
| New and changed | `test:card-lifecycle` **9**; `test:account-export` 12 (`card_events` exported with its card); `test:security` 12 (6 functions); `test:verified-tap` 17 (active cards unchanged) |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 16, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension **46**; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; account-export 12; phone-verify 12; admin-mfa 9; local-host 9; admin-edge 11; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 (7 moderate) |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`), before and after this commit |

**Negative control** [OBSERVED]: 041 without its guard trigger failed 3 of the 9 checks. A direct write activated a shipped AAROH card and revived a retired one. The real 041 was restored and compared byte for byte.

**Corrected before commit:** the guard first recognised `card_transition` by a transaction-local session setting. `test:suspension` refused it (no reachable function may change a session setting). It now recognises the transition's own `card_events` row, written first in the same transaction, which no client can write. The negative control was re-run on the final design.

**Not run or not built:**
- two activations racing (PGlite has one connection; the rows are locked `FOR UPDATE`);
- support's undo (a new personalisation);
- Session B's pages;
- real chips and keys (DEC-2026-043 Q2, Q3, Q7);
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).

## 27. 2026-11-11: the chip is MIFARE DESFire EV3 (DEC-2026-043 amendment A-1; contract v0.15.1)

**The decision:**
- **The owner, 2026-11-10:** "use desfare only, update it everywhere". The store session recorded it in `ea13379` and relayed it.
- **In this session:** the owner answered "Start DESFire change".

**The crypto review** (DEC-2026-043 §12.1, §12.2):
- **What NXP's public documents show** [OBSERVED]:
  - only DESFire EV3 has Secure Dynamic Messaging; NXP's documents say EV1 and EV2 have none;
  - NXP calls EV3's SUN "compatible with NTAG DNA";
  - the byte layouts are only in the restricted EV3 data sheet.
- **So no logic changed.** The built core (`sun.mjs`, 037, `/api/verify`, 041's possession proof) stands, and is **INFERRED** to match EV3 until gates G-1 (the data sheet) and G-2 (a real EV3 known answer) pass.
- **New personalisation duties on DESFire** (§12.4): change the PICC master key, forbid unauthenticated format and application changes, and write-lock the NDEF file.

**Changed:**
- labels and comments in code, tests and the 037 and 041 headers (`APPLY_ALL.sql` rebuilt);
- the contract (v0.15.1, wording only);
- DEC-2026-043 §12, `DECISIONS.md` (DEC-2026-015 answered), backlog V6-133;
- the capability matrix, the differentiation plan, the U1 notes;
- SHYGON OS docs 00, 01, 02, 04, 07, 08 and 11.

**Evidence** [OBSERVED, Node 20.18.0]:

| Check | Result |
|---|---|
| `db:bundle` | rebuilt (3 lines: the 037 and 041 header comments); no 001–019 history; applies as one batch and twice |
| `db:bundle:check` | exit 0 |
| `lint` | exit 0 |
| `test:sun` | 27 passed, 0 failed (AN12196 vectors; the suite now names them as NTAG 424 DNA's) |
| `test:verified-tap` | 17 passed, 0 failed |
| `test:card-lifecycle` | 9 passed, 0 failed |
| `test:security` | 12 passed, 0 failed |
| `test:db` | verify 21; adversarial 64; RLS matrix 1729 (61 tables, 7 callers); identity 69; admin-notes 12; golden 23; admin-contract 21; rollbacks 22; account-deletion 9; history 2; all 0 failed |
| `test:secrets` | run after the commit; result recorded in the commit report |

**Not done:**
- G-1 to G-3;
- the owner's D-1 to D-4;
- Session B's and the coordinator's copies, which are relayed to them.

**Verdict unchanged:** release BLOCKED (§18).

## 28. 2026-11-12: the DESFire questions D-1 to D-4 approved (DEC-2026-043 §12.7)

**Approval:** the owner, in session on 2026-11-12, answered "Approve D-1 to D-4" to "Approve D-1 to D-4 (EV3, 2 kB, Random ID off, adopt the gates)?".

**Approved:**
- D-1: the chip is MIFARE DESFire EV3;
- D-2: 2 kB;
- D-3: Random ID off;
- D-4: G-1 to G-3 and the §12.4 personalisation duties are conditions before any real key or chip.

**Changed:** records only, with no code, schema or contract change:
- DEC-2026-043 §12.7;
- `DECISIONS.md`, backlog V6-133;
- the capability matrix and doc 08.

**Not done:**
- G-1 (the EV3 data sheet), G-2 (a real EV3 known answer), G-3 (real phones);
- Q2, Q3 and Q7.

**Verdict unchanged:** release BLOCKED (§18).

## 29. 2026-11-12: the OpenCode Verified Tap review (OC-6) fixed (migration 043, contract v0.15.2)

**Approval:** the owner, in session on 2026-11-12: "Approve both".

**The review:** OpenCode's `036906b`, handed over by the coordinator. It found no P0 and no P1, plus four P2s and two nits. All are fixed except §7 test 15, which waits for Q2.

**The fixes (DEC-2026-043 §13):**
- the log no longer names the failed check;
- migration 043 decides both rate limits under locks;
- §7 test 14 is built;
- the 404 equivalence is stated precisely in the contract;
- published test keys are refused as masters;
- the E-1 note is clarified.

**DESFire:** the review relies on nothing specific to NTAG 424 DNA.

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]:

| Check | Result |
|---|---|
| `test:verified-tap` | **20 passed**, 0 failed (3 new: the locked rate limits, §7 test 14, published keys refused; the canary check now also asserts that no log line names the failed check) |
| `test:sun` | 27 passed |
| `test:card-lifecycle` | 9 passed (pairing taps go through the new `verify_tap_result`) |
| `test:suspension` | 46 passed (no reachable function changes a session setting; the advisory lock is not one) |
| `test:security` | 12 passed |
| `test:db` | verify 21; adversarial 64; RLS matrix 1729 (61 tables, 7 callers); identity 69; admin-notes 12; golden **24** (a stage for 043, byte-identical); admin-contract 21; rollbacks **23** (043 restores 037's `verify_tap_result` exactly); account-deletion 9; history 2 |
| `db:bundle`, `db:bundle:check`, `lint` | exit 0 |

**Negative controls** [OBSERVED]:
- **The mutations,** applied together:
  - the log names the check again;
  - `verify_tap_result` goes back to 037's, with its event insert swallowing errors;
  - published keys are accepted.
- **The result:** exactly the four matching checks failed, each for its own reason:
  - the RFC key gave `genuine`;
  - the device limit answered 200;
  - the forced failure answered 200;
  - a log line named the check.
- The good files were restored and compared byte for byte.

**Not run or not built:**
- §7 test 15 (the external acceptance log, Q2);
- real concurrency on PostgreSQL 17 (PGlite has one connection; the race was made deterministic instead);
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).

## 30. 2026-11-12: the admin edge functions take V6-094's logs and the second-factor rule (contract v0.16)

**Approval:** the owner, in session on 2026-11-12: "Approve both".

**What changed:**
- **Codex's V6-094** (`17c4a56`; structured, privacy-safe admin edge logs) is merged unchanged. The coordinator checked it and handed it over.
- **The second-factor rule at the edge.** Session A added DEC-2026-046's rule to `resolveAdmin`:
  - it asks the database in the caller's own session (`admin_mfa_status`);
  - when the factor is required and missing, both functions answer `403` with `code: 'admin:mfa_required'`;
  - if the check cannot run, the ordinary 403 refusal (fail closed).
- Records: contract v0.16 and DEC-2026-046 §9.

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]:

| Group | Results |
|---|---|
| `test:admin-edge` | **16 passed** (13 from Codex; 3 new: opt-in at aal1/aal2 on both functions with the database agreeing, the mandatory switch, fail-closed) |
| Negative control | `resolveAdmin` without the check: exactly the 3 new checks failed (an aal1 session, and the switch-on case, were accepted as administrator; the fail-closed case allowed). The good file was restored and compared byte for byte |
| `test:db` | verify 21; adversarial 64; RLS matrix 1729 (61 tables, 7 callers); identity 69; admin-notes 12; golden 24; admin-contract 21; rollbacks 23; account-deletion 9; history 2 |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 16, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 20; account-export 12; phone-verify 12; admin-mfa 9; card-lifecycle 9; local-host 9; admin-edge 16; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 (7 moderate) |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`) |

**Not built:**
- the admin app's screens (the Admin APK session);
- the switch turned on for everyone (Q4);
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).

## 31. 2026-11-14: the server-side 18+ record (V01 T-13) built locally (migration 044, contract v0.17)

**Approval:** the owner, in session on 2026-11-14: "Approve the build" (DEC-2026-048, Q1–Q5 as recommended, option A). The founder's decision F-26 ("Option A: 18+ now") came through the coordinator.

**Built:**
- the closed, append-only `account_age_confirmations`, written once at sign-up by a second trigger on `auth.users`. The time of record is the server's; only the JSON value true confirms; a sign-up never fails because of it;
- `age.status` and `age.confirm` on `/api/account`, for the accounts without a confirmation;
- `ageConfirmation` in the owner export;
- contract v0.17 (§4c).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]:

| Group | Results |
|---|---|
| `test:age-gate` | **11 passed**, 0 failed (closure; sign-up recording with the server's time; only the JSON value true confirms; bad data never fails a sign-up; later edits change nothing; the triggers are independent; `age.status`; `age.confirm` once, explicit only; two confirmations write one row; the export; deletion) |
| Negative control | 044 without its sign-up trigger: **all 11 checks failed** (no record at sign-up, the export showed nothing, the trigger list lacked it). The good file was restored and compared byte for byte |
| `test:db` | verify 21; adversarial 64; RLS matrix **1754** (62 tables, 7 callers; `account_age_confirmations` closed to all 7); identity 69 (`handle_new_user` unchanged); admin-notes 12; golden **25** (a stage for 044, byte-identical); admin-contract 21 (an approved new, closed relation); rollbacks **24** (044 restores 041's export builder exactly); account-deletion 9; history 2 |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 16, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 20; account-export 12 (the new table exported and covered by the deletion procedure); phone-verify 12; admin-mfa 9; card-lifecycle 9; age-gate 11; local-host 9; admin-edge 16; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 (7 moderate) |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`) |

**Not run or not built:**
- the hosted auth service's own sign-up (the trigger ran on the local stand-in's `auth.users`);
- two real connections racing (PGlite has one; `age.confirm` takes an advisory lock per account);
- Session B's pages;
- counsel's view;
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).

## 32. 2026-11-15: card activation from the proof alone (migration 045, contract v0.18)

**Approval:** the owner, in session on 2026-11-15: "Approve the build". This was Session B's question Q-C4, recorded in DEC-2026-047 §8.

**Built:**
- `card_owner_activate` finds the card from the possession proof's code when no card id is sent. Every other check is unchanged, and a refusal uses no proof.
- `/api/cards`: `cardId` is optional.
- Contract v0.18 (§7 C-7).

**Evidence** [OBSERVED, Node 20.18.0; network denied for the stack suites]:

| Group | Results |
|---|---|
| `test:card-lifecycle` | **10 passed**, 0 failed (one new check: the proof alone activates the right card; another account, an unregistered code, a malformed id and a missing proof activate nothing and use no proof) |
| Negative control | 045 without its proof-only branch: only the new check failed ("activated from the proof alone": 404 `card_not_found`). The good file was restored and compared byte for byte |
| `test:db` | verify 21; adversarial 64; RLS matrix 1754 (62 tables, 7 callers); identity 69; admin-notes 12; golden **26** (a stage for 045); admin-contract 21; rollbacks **25** (045 restores 041's `card_owner_activate` exactly); account-deletion 9; history 2 |
| Full regression, each exit 0 | lint; build; bundle; bundle-secrets; seo; push-guard 18; payments:ci 16, and 13 + 1 known Node-20-only BLOCKED; payment-chain 30; public-tap 25; suspension 46; emergency 49; rescue 18; connect 17; prive 12; modes 28; bq1-production 16; sun 27; verified-tap 20; account-export 12; phone-verify 12; admin-mfa 9; card-lifecycle 10; age-gate 11; local-host 9; admin-edge 16; observability 10; security 12; components 23/23; preview-checks 13; `npm audit --audit-level=high` exit 0 |
| After a comment fix in 045 (its DEC section reference) | `db:bundle:check` exit 0; `test:card-lifecycle` 10; rollbacks 25; lint exit 0 |
| `test:secrets` | gitleaks 8.30.1: only the known V6-014 finding (`9c8caa7`) |

**Not run or not built:**
- Session B's switch to the new call;
- real chips;
- any hosted check.

**Verdict unchanged:** release BLOCKED (§18).
