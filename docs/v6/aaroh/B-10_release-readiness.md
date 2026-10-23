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
| P1 | On a preview of each host: the address-header check in `B-9_client-address-plan.md` §6 | Before `EMERGENCY_PUBLIC_ALERTS` or `RESCUE_RELAY` is turned on. Not needed for Connect |
| P2 | On a preview with 032 applied to a **non-production** database and `CONNECT_PUBLIC` unset: `public.status` false; create, accept and share 404; decline, block, remove and the lists work; `publicAllowed` false. Then set `on`, redeploy, and confirm the behaviour returns | Confirms the default on the real host, and how quickly a change takes effect (§3, R2) |
| P3 | Session B's e2e at `ee5b532` (the switch journey) | **Done (reported by Session B, 2026-10-23): 33 passed, 0 failed** (§10) |
| P4 | `npm run test:payments:ci` under Node 22 | Clears the one BLOCKED functions-security check; Netlify builds with Node 22 |

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
| G9 | Fixing documentation items D1–D5 | Repository owner (or Session A, on request) |

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
