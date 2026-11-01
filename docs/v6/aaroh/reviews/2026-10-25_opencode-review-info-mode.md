# Independent second review: Info mode and BQ-1 (2026-10-25)

| | |
|---|---|
| Scope | Backend `cf82d55..b04a72d` on `opencode/aaroh-preview-checks` (migrations 034, 035, `/api/modes`, `get_public_tap_mode`, tests, contract v0.8/v0.9). Frontend `dce0ec9` on its own branch, read with `git show` only — never checked out. |
| Mode | **Read-only.** No source, migration or test was changed. The only file added is this report. No push, no network beyond the local test stack. |
| Tests run here | `npm run test:modes` → **17 passed, 0 failed** (exit 0). `npm run test:db` → **1,791 passed, 0 failed** (exit 0): 21 + 64 + 1,565 + 69 + 12 + 17 + 16 + 16 + 9 + 2, plus the baseline load, 15 migrations with 15 idempotent re-runs, the `APPLY_ALL.sql` bundle checks and the history seed. |
| Not run here | The frontend suite (vitest / e2e) — those files exist only in `dce0ec9`, which this session must not check out. The commit message reports vitest 134/134 and e2e 34/34; **I did not verify that**. |
| Verdict | **No release-blocking finding (no P0, no P1).** Authorization, public-reader privacy and the BQ-1 guard all hold under test. Five P2 and three nit findings follow; none of them leaks data or widens access today, and each has a small fix. |

---

## 1. Findings

| # | Severity | Where | What goes wrong (concrete input) | Fix | Status |
|---|---|---|---|---|---|
| 1 | P2 | `netlify/functions/modes.mjs:121-122,130,138` | `OPS` is a plain object literal, so `OPS[body.op]` resolves `constructor`, `toString`, `__proto__`, `hasOwnProperty`, … With a valid Bearer token, `{"op":"constructor"}` and `{"op":"toString"}` return **500 `{"error":"local host error"}`** — not the documented `{error:{code,message}}`; `{"op":"__proto__"}` and `{"op":"hasOwnProperty"}` return the documented 500 `internal`. `unknown_op` (400) is never reached. No data returned; an unauthenticated request still gets 401 (auth runs first). | Look the op up with `Object.hasOwn(OPS, body.op)` (or a `Map`), and assert the op's result is a `Response` before `log.respond`. Same pattern exists in `emergency/connect/rescue`, so fix consistently. | **OBSERVED** (probe against the local stack) |
| 2 | P2 | `supabase/tests/modes.mjs:50` (and `connect.mjs:42`, `emergency.mjs:97`, `rescue.mjs:42`, `prive.mjs:33`) | Every grant check is filtered by a **name prefix** (`modes_%`, `emergency_%`, …), and `admin-contract.mjs:275-296,332-343` only gates frozen and `admin_*` names — new functions are reported in a detail string, never asserted. So a future migration adding `CREATE FUNCTION public.get_public_info(text) … GRANT EXECUTE TO anon` passes **every** gate in `test:db`: admin-contract (not frozen, not admin), rls-matrix (it inspects tables, plus a fixed list of functions), modes.mjs (name filter misses it). | Add one gate that enumerates every function with EXECUTE for `PUBLIC`/`anon`/`authenticated` and requires each to appear in an approved list — the same shape as `APPROVED_NEW_RELATIONS` already does for tables. | **INFERRED** (read all five gates; no current hole — today's one new public reader is covered) |
| 3 | P2 | `supabase/tests/modes.mjs:291` | The privacy canary scan runs over `bodies.filter(b => b.includes('"error"'))` — **successful response bodies are never scanned**, and no owner endpoint has a key-set assertion (only `owner.state`'s `info` entry and the public reader do). Concrete: adding `jsonb_build_object('phone', v_tap.phone)` to `modes_owner_state` leaves all 17 checks green. The detail line (`35 responses`) implies they were scanned. | Scan `bodies` unfiltered, and assert the exact key set of each owner success shape (`owner.state`, `owner.info.get/save`, `owner.activate`, `owner.preview`). | **OBSERVED** (read + ran the suite green) |
| 4 | P2 | `supabase/migrations/034_modes_and_info.sql:326-328,362` vs `:186-188` | F-6 ("while Info is live it may not become incomplete") is not concurrency-safe. `modes_info_save` locks `info_pages` (`FOR UPDATE`) and then reads `tap_mode_state` **unlocked**; `modes_owner_activate` locks `tap_profiles` and reads `info_pages` **unlocked**. Two tabs — `{"op":"owner.info.save","fields":{"title":null},"expectedVersion":2}` racing `{"op":"owner.activate","mode":"info",…}` — can commit `active_mode='info'` with `title=NULL`. Result: visitors get `null` → "Tap not found" while the owner's page says "Showing on your Tap". Read-side guard means it **fails closed** (never a Business leak) and the owner can recover by switching back. | Take the same two locks in the same order in both functions (both `FOR UPDATE` on `tap_mode_state` for the tap), or re-check `modes_info_missing(v_new)` after locking in activate. | **INFERRED** (code read; not exercised — a race test would need concurrent transactions) |
| 5 | P2 | `dce0ec9:src/test/contract.test.ts:21,40` | The contract gate only matches **string literals**: `/\bop:\s*'…'/` and `/rpc(?:<…>)?\('…'/`. `const FN = 'admin_get_order'; await rpc(FN, {…})` in `publicTapClient.ts`, or `call({ op: someOp })` in `tapMode.ts`, is invisible to both assertions, so an undocumented server call ships green. The file's own comment claims "an operation added anywhere is checked without being listed here". | Fail on any `rpc(` / `fetch('/api/…` / `op:` occurrence whose argument is not a literal (or whitelist named identifiers explicitly). | **OBSERVED** (read) |
| 6 | Nit | `034:146-157` (`modes_info_missing`) vs `034:462-464` | The reader rejects a `detailedInformation` that fails `modes_text_problem(…,2000,true)`, but `modes_info_missing` (which drives `publicationStatus` and `owner.state`) does not check it, and `modes_preview` checks only `modes_info_missing`. If that column ever holds markup — only possible by writing `info_pages` directly, never through `/api/modes` — `owner.info.get` answers `publicationStatus: 'live'` and the preview shows a page the visitor does not get. | Fold the detailed-information check into `modes_info_missing` so every consumer uses one predicate. | **INFERRED** |
| 7 | Nit | `supabase/migrations/035_public_profile_respects_mode.sql:165-175` | 035 compiles even when 034 was never applied (plpgsql resolves `public.tap_mode_state` at first execution, not at `CREATE`). Applying 035 alone then makes `get_public_profile` raise `42P01` for **every** slug — the whole public Tap goes down, not just Info. The header warns and prescribes a pre-flight check, and `db:apply` runs files in name order, so nothing enforces it. | Lead the file with `DO $$ BEGIN IF to_regclass('public.tap_mode_state') IS NULL THEN RAISE EXCEPTION 'migration 034 must be applied first'; END IF; END $$;` | **INFERRED** |
| 8 | Nit | `dce0ec9:src/services/tapMode.ts:42` vs `034` (`modes_owner_activate`) | `ActivateResult.previousMode` is typed `TapMode`, but activating the mode a Tap is already on returns `previousMode: null` (`{"op":"owner.activate","mode":"business","expectedVersion":0}` on a Tap already on Business). Contract §6 does not document the null. The UI never reads the field, so nothing breaks. | Type it `TapMode \| null` and say so in §6's success column. | **INFERRED** |

---

## 2. Authorization: nothing found

- **Roles.** All ten functions created by 034 are `SECURITY DEFINER` with `SET search_path TO 'public', 'pg_temp'` (`pg_temp` last, every reference schema-qualified); the three plain SQL helpers set it too. `034:472-492` revokes EXECUTE from `PUBLIC, anon, authenticated` on all ten and grants `service_role`; only `get_public_tap_mode` is then granted to `anon, authenticated` — the same pair the frozen `get_public_profile` has carried since migration 004, and §6 publishes it as the visitors' reader. *OBSERVED:* `test:modes` → "9 server-only functions, 1 public reader".
- **Tables.** `034:108-126` enables RLS on `tap_mode_catalog`, `info_pages`, `tap_mode_state`, `tap_mode_audit` with **no policy**, revokes everything from `PUBLIC/anon/authenticated`, and revokes `UPDATE, DELETE, TRUNCATE` on the audit from `service_role` (append-only). *OBSERVED:* `test:modes` A (4 tables closed, audit insert-only) and `test:db`'s RLS matrix, 1,565/1,565, with `info_pages`, `tap_mode_catalog`, `tap_mode_state`, `tap_mode_audit` at 0 rows / 0 rows affected for all seven callers.
- **No caller-supplied identity.** `modes.mjs:125-130` takes `user` only from `currentUser()` (the access token verified by Supabase Auth); no operation accepts a `userId`, `slug` or `role` from the body or the URL, so another owner cannot address another account. *OBSERVED:* `test:modes` — no token and forged token → 401 for all six ops; "Ben" (no Tap) → 404; "Cara" only ever changes her own Tap while Asha's stays on Info.
- **Audit rows** are reachable by no client role and expose field *names* only (`034` insert lists `v_fields`); *OBSERVED:* the suite asserts the trail is `['info_save','info_save','activate','activate','info_clear']` and contains no submitted value.

## 3. Data leaks: nothing found

- `get_public_tap_mode` (`034:445-470`) requires `status='active' AND suspended_at IS NULL` before it looks at the mode, so unknown, draft, paused and suspended Taps answer `null`. For Info it returns `modes_info_public` — exactly `title, shortDescription, category, detailedInformation, updatedAt`, no owner id, email, phone or Business field — and for Business it returns the unchanged P-1 payload. *OBSERVED:* key-set assertions plus F-1/F-2/F-3/F-5 all green; `Info` off, missing or invalid → `null`, never Business (BQ-2).
- **035 does what BQ-1 asks.** The guard (`035:171-176`) fires when a `tap_mode_state` row has `active_mode <> 'business'`; `active_mode` is `NOT NULL` and FK-bound to a catalogue whose only values are `business`/`info`, so `<> 'business'` covers **every** non-Business case. The rest of the body is byte-identical to the baseline: `admin-contract` requires the approved replacement to occur exactly once and then compares the whole migrated body against baseline-plus-replacement (16/16 green), and `golden-public-tap` (17) plus `test:modes`' "legacy reader serves Business again, byte-identical" confirm the Business output is unchanged.
- **Frontend.** `toInfo` (`dce0ec9:src/lib/publicTapClient.ts:101-114`) keeps only the five keys, requires title + shortDescription, allowlists the category, and `fetchPublicTap` (`:126-145`) returns `null` for `null`, an unknown `mode`, or an incomplete Info page — the P-1 fallback fires only on a 404 (function absent), where 034/035 are absent too, so there is no path that turns an Info page back into a Business profile.

## 4. Input handling: nothing found

- Limits live in two places that agree: the column `CHECK`s (`title ≤ 120`, `short_description ≤ 280`, `detailed_information ≤ 2000`) and `modes_text_problem` (`034:131-143`), applied per field at `034:341-351`, with unknown keys, non-text values and non-allowlisted categories refused. *OBSERVED:* the suite's 7 refusals (`too_long`, `markup`, `control_characters`, `not_allowed`, `unknown`, `not_text`) with no submitted value echoed, and the reader re-checks at read time (F-3).
- **Plain text end to end.** `PublicInfoPage` renders React text nodes only (no `dangerouslySetInnerHTML` anywhere in the commit), `info.css` keeps line breaks with `white-space: pre-line` and `overflow-wrap: anywhere`, and the only links on the page are two fixed SHYGON routes. There is no URL field to submit. The commit's own test feeds `<img src=x onerror=alert(1)>` as the title and asserts no element and no link is produced.
- The editor's `maxLength`/`INFO_LIMITS` (`dce0ec9:src/services/tapMode.ts:51`) match the server's numbers exactly.

## 5. Contract: two small mismatches

- Everything §6 publishes matches: op names, the success shapes (including `replayed` and `publicationStatus`), and the error table (401/400/404/409/422 with `field`, `reason`, `missing`, `current`) line up with `ERRORS` in `modes.mjs:25-41`. `POST`-only is right, `api/modes.mjs` mirrors the other Vercel entries, and `/api/* → /.netlify/functions/:splat` already covers the new route.
- Findings **#1** (a response outside the contract for unpublished op names) and **#8** (`previousMode: null`) are the only mismatches I found.

## 6. Tests that would pass if the code were wrong

Findings **#2**, **#3** and **#5** above. Everything else I probed is a real assertion: the public reader's key sets, the BQ-1 full-body equality, the RLS matrix (denial *and* regression in both directions), the 401-before-any-op check, the privacy canaries over DOM/head/title/storage, and the "no visitor event on Info" e2e all fail if the behaviour they describe breaks.

## 7. Limits of this review

- The frontend commit was read, not executed: no vitest, no e2e, no build. Its results are as the commit reports.
- Finding #4 (the F-6 race) is a code reading; I did not construct concurrent transactions to prove the interleaving.
- One probe script was written outside the repository (`%LOCALAPPDATA%\Temp\opencode\probe-modes-op.mjs`) to exercise finding #1 against the local stack; it was removed after use. Nothing in the repository was modified except this file.

---

## 8. Resolution (added by Session A, backend, 2026-10-25)

The owner approved the hand-off in the coordination session on 2026-10-25. Each finding in Session A's lane was fixed in one hardening change on `v6/aaroh-backend`; readiness report §18 has the commits and the suite results. Each new or changed test was checked against the old code first and failed there.

| # | Resolution |
|---|---|
| 1 | Fixed. `Object.hasOwn` for the op lookup in `modes`, `connect`, `emergency` and `rescue`; the local REST emulator's two operator lookups too. New check in `test:security`: 4 functions × 5 inherited names × signed in or not → 400 `unknown_op`. Negative control: fails on the old lookup. |
| 2 | Fixed. New `admin-contract` check: every function a client role (anon, authenticated, PUBLIC) can EXECUTE, whatever its name, was so on live or is in `APPROVED_CLIENT_EXECUTE` with exactly its roles; stale entries fail too. Today: 66 as on live + 3 approved. Negative control: a new `get_public_info(text)` granted to anon fails. |
| 3 | Fixed. The canary scans every response body, and a new check pins the exact key set of every owner success answer (all six operations; a successful `owner.info.get` was added so none goes unchecked). Negative control: an extra `phone` key in `owner.state` fails. |
| 4 | Fixed in 034 in place (applied nowhere): activate, save and clear lock Tap, then mode state, then the Info record. PGlite has one connection, so the race itself is not executable here; a check pins the order in all three writers. Negative control: the old 034 fails it in all three. |
| 6 | Fixed. `modes_info_missing` also flags invalid stored detailed information; the reader uses it alone. `test:modes` F-3 now asserts the owner's status, preview and `owner.state` agree with the visitor. |
| 7 | Fixed. 035 refuses to apply without 034 (`DO` pre-check); `test:bq1-production` asserts it, with the body unchanged. |
| 5, 8 | Frontend (Session B), sent separately by the coordinator. The contract half of #8 is done: §6 documents `previousMode: null` (v0.9.2). |

---

# Production variant (dbc611a)

| | |
|---|---|
| Scope | Backend `dbc611a` ("BQ-1 production variant of 035, re-based on production evidence, V6-106") on `v6/aaroh-backend`, now under `bb5bc85`. Reviewed: `supabase/proposed/035_public_profile_respects_mode.production.sql` (295 lines), `supabase/tests/bq1-production.mjs` (361 lines, 13 checks), `docs/v6/aaroh/bq1-production-reconciliation.md`, plus the `package.json` / `ci.yml` wiring — all read with `git show` only, **never checked out**, the other session's folder never opened. |
| Mode | **Read-only.** No source, migration or test was changed. This report remains the only file added or modified; no push. |
| Tests run here | The commit was materialized read-only outside the repository (`git archive -o … bb5bc85` into `%LOCALAPPDATA%\Temp\opencode\bq1run`, junction to this workspace's `node_modules`, removed afterwards), then run with network denied: `node --import ./scripts/ci/deny-network.mjs supabase/tests/bq1-production.mjs` → **13 passed, 0 failed** (exit 0), matching the commit's claim. Then, in the same sandbox, six pre-check probes ran the same way (comment-only body change, whitespace-only body change, changed grant, drifted volatility, drifted owner, CR-only difference) — all network denied, all against isolated in-memory PGlite. The temporary directory was deleted afterwards. |
| Verdict | **No release-blocking finding (no P0, no P1).** The single-guard claim, the pre-check's refusal behaviour and the byte-exact rollback all hold; the test suite would fail without the guard. One P2 (the pre-check doesn't cover volatility) and two nits follow. Release stays **BLOCKED** and Info stays off, as the proposal itself states. |

## 1. Findings

| # | Severity | Where | What goes wrong (concrete input) | Fix | Status |
|---|---|---|---|---|---|
| P-1 | P2 | `supabase/proposed/035_public_profile_respects_mode.production.sql` (`DO $precheck$`) | The pre-check validates only body md5, owner, `prosecdef`, `proconfig` and that `tap_mode_state` exists — **not `provolatile`** (nor `prokind`/language). The file's stated invariant is "never overwrite drift it was not written for", but `CREATE OR REPLACE … STABLE` will happily rewrite a drifted attribute: probe C ran `ALTER FUNCTION … VOLATILE;` on the production-equivalent database, then applied the proposal — **no refusal, and the volatility was silently reset `v → s`**. That is a behavioural change beyond the single guard, exactly the class of change the pre-check exists to catch. The header's "one guard, nothing else" is proven for the test database, not for drifted live. | Add `p.provolatile = 's'` (and `p.prolang = 'plpgsql'`) to the pre-check's attribute test, so attribute drift raises instead of being silently corrected. | **OBSERVED** (probe; the header's `VERIFY ON LIVE` query does list `provolatile`, so the human gate covers it) |
| P-2 | Nit | same (`DO $precheck$`; `ROLLBACK` block) | A changed grant slips through: probe B ran `GRANT EXECUTE ON FUNCTION public.get_public_profile(text) TO authenticated;` first — the proposal **applied without complaint** and the extra grant survived untouched (`proacl` before == after, `CREATE OR REPLACE` keeps privileges). So the pre-check refuses "any other *body*" but not any other grant set. The commented ROLLBACK contains no `GRANT`/`REVOKE` either, so grants are "restored" only in the sense that they are never touched — if live's `proacl` had drifted from the capture, neither apply nor rollback returns it to the captured state; only the human `VERIFY ON LIVE` comparison (which does include `proacl`) would notice. Nothing is lost or widened today. | Note in the header that `proacl` is deliberately not machine-checked (and why), or compare it in the pre-check and refuse on mismatch. | **OBSERVED** (probe) |
| P-3 | Nit | same (ROLLBACK block) | The rollback is a commented statement with **no pre-check of its own**: whoever uncomments and runs it on a database that does not hold the captured body would overwrite that body unconditionally — the transaction's refusal only protects the forward direction. The header's "VERIFY AFTER ROLLBACK" is a manual step, not an enforcement. | Add the same `DO $precheck$` (or at least the md5 allowlist) to the rollback block, or say plainly that it is guarded by the human checklist only. | **INFERRED** (the block is inert as committed; the risk is the manual un-comment step) |

## 2. Is the only behavioural change the single BQ-1 guard?

- **Byte-level, from the committed file alone [OBSERVED].** I extracted the commented `ROLLBACK (begin)…(end)` statement (stripping the `-- ` prefixes) and the executable forward statement, removed exactly the six guard lines from the forward one, and compared: **93 lines each, byte-identical** (`forward − guard == rollback`). The guard block occurs exactly once; the anchor `IF NOT FOUND THEN RETURN NULL; END IF;` occurs exactly once in each.
- **Hashes, computed independently from the file [OBSERVED].** Following the project's convention (`md5` of `prosrc` with carriage returns removed; PostgreSQL stores `prosrc` as `\n` + the body between `$function$` delimiters): forward body = **`d267acb378c604576f950c3da651faa1`**, rollback body = **`4a70098823695f40395d7c32439ffc98`** — both exactly the values the header claims, and the rollback value is the one the test independently derives from replaying the 2026-10-18 evidence.
- **Against the evidence, not just the file [OBSERVED].** Test #1 rebuilds production from the owner's recorded seven migrations on the 2026-09-30 baseline and asserts body md5 `4a700988…`, the anchor occurring once, and the production drift (`pageTemplate`, `tier_buttons`) present. Test #5 then asserts the applied body is **that** body with exactly the guard inserted (string equality, CRs removed) and that owner, SECURITY DEFINER, `search_path`, volatility, signature and grants are unchanged; test #6 asserts the other **107 functions, 835 table grants and 64 policies** are byte-for-byte unchanged. Test #2 additionally asserts the file contains no `GRANT`/`REVOKE`. **Answer: yes — the only change is the guard**, with the caveat of finding P-1: "nothing else" is verified on the un-drifted test database, and attribute drift outside the pre-check's four fields would be silently normalised.

## 3. Does the pre-check really refuse any other body?

The pre-check raises unless `md5(replace(prosrc, chr(13),''))` is one of two literals (`4a700988…` = production, `d267acb3…` = already applied), owner is `postgres`, `prosecdef` is true, `proconfig` is exactly `{search_path=public, pg_temp}`, and `public.tap_mode_state` exists — all inside the same transaction, so a refusal changes nothing.

| Input | Result | Label |
|---|---|---|
| A single comment added inside the body | **REFUSED** (`md5 c266c24f8fcf8e1264ce1a50a70df780`), body unchanged afterwards | **OBSERVED** (probe) |
| One trailing space added to a declaration line | **REFUSED** (`md5 93343ed6ffb4007143ed7232cce328af`) | **OBSERVED** (probe) |
| The repository baseline body (034 applied, production body absent) | **REFUSED**, body still `acbaff4f0fb3014a0a080cbf15267cd9` | **OBSERVED** (test #4) |
| `tap_mode_state` missing (034 not applied) | **REFUSED** ("needs migration 034"), body unchanged | **OBSERVED** (test #3) |
| Owner changed | **REFUSED** ("attributes differ from the capture") | **OBSERVED** (probe) |
| CR-only difference in the body | **ACCEPTED** — `replace(…, chr(13), '')` deliberately erases it | **OBSERVED** (probe; documented as risk R-3 in the reconciliation) |
| Changed grant (`proacl`) | **ACCEPTED**, grant preserved untouched | **OBSERVED** (probe → finding P-2) |
| Drifted volatility | **ACCEPTED**, silently reset `v → s` | **OBSERVED** (probe → finding P-1) |

So: any byte change to `prosrc` — whitespace, comment, reworded SQL — changes the md5 and is refused; carriage returns are the one deliberate exception; grants and volatility are outside the check. A changed *signature* also refuses (the `to_regprocedure('public.get_public_profile(text)')` lookup misses, so `v_md5 IS NULL`), and a changed return type would make `CREATE OR REPLACE` error out rather than change anything (**INFERRED**).

## 4. Is the rollback byte-exact?

- **File level [OBSERVED]:** the uncommented ROLLBACK statement equals the forward statement minus the six guard lines, byte for byte (§2), and its body hashes to the captured production value `4a700988…`.
- **Database level [OBSERVED]:** test #12 runs the uncommented block on the applied database and asserts `pg_get_functiondef` equals the capture (CRs aside), owner/definer/`search_path`/volatility/signature/grants equal the before-snapshot, all 107/835/64 other objects equal, and all 20 rendered outputs are byte-identical to the pre-apply outputs. Test #2 separately asserts the ROLLBACK text equals the `pg_get_functiondef` of the replayed production function (`noCr(def) + ';'`).
- **Grants caveat [OBSERVED, wording]:** the block contains no `GRANT`/`REVOKE`. It "restores grants" only because `CREATE OR REPLACE` never altered them — true for the captured grant set (test #12 asserts `proacl` equality), and see P-2 for drifted live grants.

## 5. Does bq1-production.mjs catch a wrong body, a missing tap_mode_state, and the Business case?

**Yes to all three, and no — it would not pass if the guard were missing.** OBSERVED: my own run of the suite is **13/13, 0 failed, exit 0**.

- **Wrong body:** check 4 applies the proposal to a database holding the *repository baseline* body and requires the refusal message plus an unchanged body. Check 1 requires the replayed production body hash, and check 2 requires the proposal to name exactly the two right hashes plus the evidence sha256.
- **Missing `tap_mode_state`:** check 3 applies it with 034 withheld and requires the "needs migration 034" refusal with an unchanged body.
- **Business case:** check 7 compares all 20 slugs before/after (15 with payloads, page and card families included) and requires **zero** changed outputs plus `pageTemplate: 'event'` kept; check 10 switches back to Business and again requires byte-identical output; check 8 requires `null` while Info is live with `get_public_tap_state` still `active`, and check 9 requires `null` after the kill switch.
- **Guard missing → FAIL:** check 5 asserts the applied body is *production + guard by string equality* and that its md5 equals the dynamically computed forward hash; without the guard that assertion fails immediately, as do 8, 9 and 10 (Info would serve the Business payload) and 2 (the forward hash in the pre-check would not match). The suite also carries a negative control (check 13): applying the baseline-derived `migrations/035` to production changes 15 slugs and drops `pageTemplate` — proving why this file exists.
- One gap for fairness: the suite's "wrong body" fixture is only the baseline body — it does not itself exercise a whitespace/comment variant. My probes above do, and both are refused (md5 logic); that is a coverage nit of the suite, not a hole in the pre-check.

## 6. Wiring and placement

- `package.json` has `test:bq1-production` running the file under `--import ./scripts/ci/deny-network.mjs`, it is included in the `ci` script, and `ci.yml` runs it — **OBSERVED** in `bb5bc85`'s trees.
- The file lives in `supabase/proposed/`, so `db:push` and `APPLY_ALL.sql` cannot run it; `APPLY_ALL.sql` references only the baseline-derived `035_public_profile_respects_mode.sql`, with the existing STOP note about production drift — **OBSERVED**.
- The reconciliation document is candid: body is INFERRED from 2026-10-18 evidence rather than a fresh capture, no fresh capture exists, PostgreSQL 17.6 vs PGlite 18.3 unverified, callers of `get_public_profile` on production unverified, and release stays **BLOCKED** pending the owner's capture, DEC-2026-018 cool-off and the release gates. Those are stated risks, not findings.

## 7. Limits of this review

- The suite and probes ran on PGlite 18.3 in memory with network denied, replaying recorded evidence — not on production, not on PostgreSQL 17.6. The evidence body is a 2026-10-18 rebuild, not a fresh capture; every conclusion about *live* holds only until live changes, which is exactly what the pre-check is for (findings P-1/P-2 name what it does not cover).
- The commit was materialized with `git archive` into a temporary directory and deleted afterwards; `dbc611a`/`bb5bc85` were never checked out, the other session's folder was never opened, and no probe file was left anywhere in the repository. Nothing in the repository was modified except this report.

## 8. Resolution (added by Session A, backend, 2026-10-25)

The coordinator forwarded this report under the owner's hand-off approval. Fixed on `v6/aaroh-backend` in the regenerated `supabase/proposed/035_public_profile_respects_mode.production.sql`. The body did not change: forward still `d267acb3…`, captured still `4a700988…`. Each added check failed against the earlier proposal first.

| # | Resolution |
|---|---|
| P-1 | Fixed. The pre-check also requires STABLE (`provolatile = 's'`), a plain function (`prokind = 'f'`) and `plpgsql`. A VOLATILE drift now raises "attributes differ" instead of being reset. |
| P-2 | Fixed: the grants are machine-checked. The pre-check compares the EXECUTE grants, sorted, with the captured set (`anon`, `postgres`, `service_role`) and refuses on any difference. An extra grant to `authenticated` now raises "grants differ". |
| P-3 | Fixed. The ROLLBACK block carries its own guard. It runs only on the forward body, or on the captured one for a re-run, inside its own transaction. On the repository baseline body it refuses and changes nothing. |
| Coverage nit | Fixed. `test:bq1-production` now refuses five drift fixtures on the production-equivalent database, and checks that each drift is still there afterwards: a comment, a trailing space, VOLATILE, an extra grant, another owner. It also checks the byte identity *forward minus the guard = captured definition*. The suite has 16 checks. |
