# Independent second review: Verified Tap (U1, NTAG 424 DNA SUN) — 2026-11-02

| | |
|---|---|
| Scope | Backend `d20b3da` on `opencode/review-verified-tap`: `c466dde` (crypto core `netlify/lib/sun.mjs`), `abe6871` (migration `037_verified_tap.sql`, `netlify/functions/verify.mjs`, `api/verify.mjs`, `supabase/tests/verified-tap.mjs`, contract v0.11 §10d), `c6e2b6d` (E-1 `.gitleaksignore`). Read with file reads and `git show` only. |
| Mode | **Read-only.** No source, migration or test was changed. The only file added is this report. No push, no deploy, no `db:push`, no install; network denied for every suite that uses `scripts/ci/deny-network.mjs`. No secrets read (only `.env.example`; all keys in this feature are published TEST keys). |
| Tests run here | `npm run test:verified-tap` → **17 passed, 0 failed** (exit 0). `node --import ./scripts/ci/deny-network.mjs netlify/tests/sun.mjs` → **27 passed, 0 failed** (exit 0). `npm run test:db` → **all green**: db:apply 17 migrations + 17 idempotent re-runs; db:verify 21; rls-adversarial 64; rls-matrix 1,615 (57 tables, 7 callers); identity 69; admin-notes 12; golden 19; admin-contract 17; rollbacks 18 (037 included); account-deletion 9; db:bundle:check 4; history-seed 2 — every component exit 0 (the monolithic `npm run test:db` is sequential and hits the 300 s CI ceiling only on duration, not on any failure; each part passes). `npm run test:security` → **11 passed, 1 failed**; the single failure is environmental (`no dist/index.html: run \`npx vite build\` first`), not a security finding. |
| Not run here | The frontend `/d/<code>` page (Session B, not yet built), real phones, real chips, KMS/HSM — DEC-043 marks these human/hosted steps. |
| Verdict | **No release-blocking finding (no P0, no P1).** Fail-closed, atomic counter acceptance, D-a key derivation, RLS closure, the host switch and the GET/no-consumption rule all hold under test. Four P2 and two nit findings follow; none leaks a key, UID or counter, and none lets a wrong tap reach `genuine`. Each fix is small. |

---

## 1. Findings

| # | Severity | Where | What goes wrong (concrete input) | Fix | Status |
|---|---|---|---|---|---|
| 1 | P2 | `netlify/functions/verify.mjs:124` | `log.info('verify.checked', { verdict, refusal: tap.ok ? null : tap.reason })` logs `bad_picc` or `bad_mac`. A log reader (log-ingestion compromise, shared hosting, support escalation) learns **which check failed**. Concrete input: a tapped URL with a flipped bit in `c` writes `refusal: "bad_mac"`; a wrong meta-read key writes `refusal: "bad_picc"`. The answer stays generic (contract-compliant), but the log does not. | Log only a generic refusal indicator (e.g. `refusal: true`, or omit the reason entirely), keeping the per-step distinction out of log lines. The canary in `test:verified-tap` only scans for secrets, so it would not catch a code change that logs more distinguishing detail. | **OBSERVED** (code read; canary passes because it scans for secrets, not for distinguishing reasons) |
| 2 | P2 | `supabase/migrations/037_verified_tap.sql:140-157` (`verify_device_lookup`) vs `:170-192` (`verify_tap_result`) | The visitor (30/h) and device (20 refused/h) rate-limit counts read `tap_verify_events` **without a lock**, and `verify_tap_result` inserts the event afterwards. Two concurrent requests from the same visitor digest / device can both pass the `< 30` / `< 20` check before either inserts, so the 31st / 21st request slips through. Concrete input: 31 concurrent POSTs from one visitor within an hour all pass the lookup's rate check because none has inserted its event yet. | Re-check the rate limit inside `verify_tap_result` under the `FOR UPDATE` lock (or insert the event first under the lock and roll back when over), so the decision and the insert are atomic. The concurrency test covers the counter, not the rate limits. | **INFERRED** (code reading; not demonstrated against PGlite's single connection) |
| 3 | P2 | `supabase/tests/verified-tap.mjs:6-8` (§7 header) | §7 test 14 (database failure mid-transaction never gives `genuine`, never half-advances) is **not executable on PGlite**, and §7 test 15 (restore rolls the counter back until reconciled with the external acceptance log) is **not built** — the external acceptance log waits for DEC-043 Q2. A code change that half-advances the counter on error, or that ignores a restore, would still pass `test:verified-tap` green because these cases are never run. | Add PGlite-executable coverage for test 14 (force an error inside the RPC transaction and assert `last_counter` is unchanged and the verdict is never `genuine`), and add the restore-vs-external-acceptance-log reconciliation once Q2 lands. Negative control: each new check must fail against today's code path. | **INFERRED** (the gaps are stated in the test header and DEC-043 §7; not a current code bug, but a test-coverage hole that lets wrong code pass) |
| 4 | Nit | `netlify/functions/verify.mjs:131` vs `:98-101` | When `VERIFIED_TAP` is off, `handle` returns 404 `unavailable` **before any DB lookup**; an unknown code does a DB lookup (`tap_device_auth`, NOT FOUND) before returning the same 404. Timing could distinguish "switch off" from "unknown code," contradicting the contract's "these cases are indistinguishable" (§10d error table). | When the switch is off, do not short-circuit ahead of the code path in a measurably different way (e.g. always perform the same trivial lookup, or accept the distinction and narrow the contract claim). | **INFERRED** (timing reasoning; not demonstrated) |
| 5 | Nit | `netlify/functions/verify.mjs:73-77` (`mastersFor`) | `mastersFor` accepts any 32-hex env values with no guard against known test vectors. Nothing stops test keys from being deployed to production, where verification would then use published vectors anyone can reproduce (forgery by anyone who knows the vectors). Production keys can never *fall back* to test keys (there is no fallback path), but nothing prevents test keys from being *configured* as production keys. | Add a build/deploy-time (or start-up) guard that refuses to run verification when the epoch keys match the published NXP/IETF test vectors, and document that production must use non-test custody (DEC-043 P-5, Q2). | **INFERRED** (ops/custody concern; no code path silently falls back today) |
| 6 | Nit | `.gitleaksignore:18,25` (`c466dde`/`6c7f8db` × `sun.mjs:306`) | E-1's fingerprint for line 306 is `'EF963FF7828658A599F3041510671E8'` — a 31-hex-char **short-ciphertext negative test input**, not a cryptographic key. It is still a published test fixture (AN12196 ciphertext truncated), so E-1's intent holds, but the `generic-api-key` fingerprint description is slightly off. | No change needed (the value is a published test vector/fixture, not a secret); optionally clarify the comment. All other 13 fingerprints point at genuine published keys/ciphertexts/session keys. | **OBSERVED** (read the line; it is test input, not a secret) |

---

## 2. False "genuine" — none found

| Area | Assessment |
|---|---|
| Counter accept (strictly greater) | `verify_tap_result` (037:180-191) updates `last_counter` **only** in the `genuine` branch and only when `p_counter > last_counter` (or first tap). Refused/failed requests (`not_confirmed`, `already_checked`, `needs_service`) never advance it. `acceptCounter` in `sun.mjs:287-292` is the pure strictly-greater predicate (refuses `0xFFFFFF`, non-integers, out-of-range). **OBSERVED:** the concurrency check (one `genuine` per counter; late `n` after `n+1` is calm) passes. |
| Atomic per card under concurrency | `verify_tap_result` locks the device row with `FOR UPDATE` before deciding, so concurrent `n`/`n+1` are serialised. **OBSERVED:** 17/17 green, including the concurrency case. |
| Database error mid-transaction | `verify.mjs:149-153`: any failure in `tapVerify` (including an RPC/DB error) is caught and returns `temporarily_unavailable` (503) — never `genuine`. Postgres runs each `verify_tap_result` call in a single transaction, so an error rolls back the whole function (no half-advance). **INFERRED:** not executed on PGlite (see F3); the code path is fail-closed by inspection. |
| code → card → UID binding | `verify_device_lookup` resolves `code` → `device` → `cardId`/`keyEpoch`; `verify_tap_result` locks that same `public_code` row and compares the decrypted UID's HMAC (`p_uid_hmac`) with the stored `uid_hmac`. A valid `e/c` from card A presented with card B's code is decrypted with card B's device-id-diversified keys → `bad_picc` → `not_confirmed`. **OBSERVED:** "another chip's keys, or the right keys with another UID, are not_confirmed" passes. |
| Key derivation by device id (D-a) | `deviceInput` (verify.mjs:80) diversifies both master keys from the 16 bytes of `cards.id` (dashes stripped). Both meta-read and file-read keys are per-chip. **OBSERVED:** matches DEC-043 Q8 (D-a) and the epoch-2 test passes. |
| Epoch lookup | `mastersFor` (verify.mjs:73-77) reads `VERIFY_META_MASTER_<epoch>` / `VERIFY_FILE_MASTER_<epoch>`; missing or non-32-hex → `null` → verdict `unavailable` (never `genuine`). **OBSERVED:** "no keys for the epoch is unavailable; with keys it verifies; a missing key (outage) is unavailable" passes. |

**Conclusion:** every input path that should not be `genuine` is refused. No false-"genuine" path found. **No P0, no P1.**

---

## 3. Leaks — none found

| Area | Assessment |
|---|---|
| Answer / error reveals key, UID, counter, or which check failed | Answers carry only `{ slug, verdict, edition? }` (verify.mjs:125); `edition` only with `genuine` and a complete record. Errors are `{ error: { code, message } }` with no detail (verify.mjs:59-64). No `e`, `c`, key, UID or counter is ever echoed. **OBSERVED:** the canary checks 88 answers + 73 log lines against 8 secrets (masters, pepper, UID, UID HMAC, `e`) — zero hits. |
| Which check failed revealed | Not in the answer; **in the log** — see F1 (`refusal: bad_picc`/`bad_mac`). P2, log-side only; no remote oracle because callers cannot read server logs. |
| 404 `unavailable` indistinguishable | The 404 set (switch off, unknown code, card not active, Tap not live, no trusted visitor address) returns one identical body (verify.mjs:652 contract; verify.mjs:98-101,131 code). Minor timing distinction noted in F4 (nit). |
| `e`/`c` query parameters logged | Never logged. `verify.checked` logs only `{ verdict, refusal }`; `verify.keys-unavailable` logs `{ keyEpoch, pepperSet }` (no key); `verify.no-client-address` logs `{ trustedHeaderConfigured }` (no address). **OBSERVED:** canary confirms no `e`/`c` in answers or logs. |
| Visitor/device rate-limit inputs | Visitor digest is an HMAC of the trusted-client-address + day (verify.mjs:67-69; client-address.mjs reads only `TRUSTED_CLIENT_IP_HEADER`). Not reversible, not the raw address. Not logged. |

---

## 4. Authorization and grants — nothing found

| Area | Assessment |
|---|---|
| RLS | 037:88-98 enables RLS on `tap_device_auth` and `tap_verify_events` with **no policy** (service_role only), revokes all from `PUBLIC/anon/authenticated`, grants DML to `service_role`; `tap_verify_events` additionally revokes `UPDATE, TRUNCATE` from `service_role` (append-only). **OBSERVED:** rls-matrix shows `tap_device_auth` / `tap_verify_events` at 0 rows / 0 affected for all seven callers; `test:verified-tap` "closed" check asserts no client role can SELECT the tables or EXECUTE the functions. |
| SECURITY DEFINER + fixed search_path | All four functions (`verify_register_device`, `verify_device_lookup`, `verify_tap_result`, `verify_purge`) are `SECURITY DEFINER` with `SET search_path TO 'public', 'pg_temp'` (037:106-107, 128-130, 171-173, 206-207). Every reference is schema-qualified. |
| EXECUTE grants match the admin-contract approved list | 037:217-228 revokes EXECUTE from `PUBLIC/anon/authenticated` and grants EXECUTE to `service_role` only. No client role can execute any of the four functions. **OBSERVED:** admin-contract (test:db) reports the new functions as service-role-only and "new relations are closed, RLS on"; `test:verified-tap` closure check passes. |
| No client role reads/writes card keys, counters or epochs | No key material is stored anywhere (keys are derived per-request from env masters + device id). Counters/epochs/uid_hmac live only in the closed `tap_device_auth` table. |

---

## 5. Host switch and method — holds

| Area | Assessment |
|---|---|
| `VERIFIED_TAP` unset → everything 404, nothing read/consumed | `verifiedTapAllowed()` (verify.mjs:51) requires `=== 'on'`; unset/off → `fail('unavailable')` (404) before any lookup (verify.mjs:131). **OBSERVED:** switch-off check asserts 404 + `counter` null + no events. |
| GET consumes nothing (P-3) | `handle` rejects non-POST with 405 `method_not_allowed` **before** the switch check and before reading the body (verify.mjs:129). GET /api/verify → 405, no lookup, no consumption. **OBSERVED:** GET → 405 and nothing consumed. |
| Rate limits use only the trusted client-address header | 30/visitor/h (037:140-143) and 20 refused/device/h (037:154-157) both use `p_visitor` from `visitorOf` (verify.mjs:67-69), which reads only the header named by `TRUSTED_CLIENT_IP_HEADER` (client-address.mjs:23-27). `X-Forwarded-For`/`X-Real-IP` are never read. **OBSERVED:** "no trusted visitor address: unavailable, nothing consumed" passes; two distinct visitors are not blocked by each other's limits. |

---

## 6. Keys — test keys only, no production fallback, E-1 confirmed

- **Where test keys live:** `netlify/tests/sun.mjs` holds the published NXP/IETF test vectors (RFC 4493 §4 key, AN10922 §2.2.1 key, AN12196 §3.3/§3.4.2.2 ciphertexts and session keys). `supabase/tests/verified-tap.mjs` generates **random per-run** master keys and pepper held only in that process's env (`VERIFY_META_MASTER_1`, `VERIFY_FILE_MASTER_1`, `VERIFY_UID_PEPPER`), never committed.
- **Production keys never fall back to test keys:** `mastersFor` returns `null` (→ `unavailable`, never `genuine`) when the epoch keys are missing or not 32-hex; there is no fallback path. (F5 notes nothing *prevents* test keys from being *configured* as production keys — a deploy guard is the suggested fix.)
- **E-1 covers ONLY published test vectors:** `.gitleaksignore` lists exactly 14 fingerprints = 7 lines × 2 commits (`c466dde` and `6c7f8db`), all in `netlify/tests/sun.mjs` at lines 54, 72, 130, 137, 182, 306, 351. Each points at a published test vector/fixture (RFC 4493 key, AN10922 key, AN12196 ciphertexts, AN12196 session key, canary test key, short-ciphertext negative input). No real secret is listed. The separate DEC-2026-020 Web3Forms exception is unrelated to E-1. **OBSERVED:** every fingerprint checked against the line; all are published test values.

---

## 7. Tests that would still pass if the code were wrong

- **§7 test 14 (DB failure mid-transaction)** and **§7 test 15 (restore/counter-rollback)** are not run on PGlite and not built, respectively (verified-tap.mjs:6-8; DEC-043 §7). Wrong code on these paths would still pass `test:verified-tap` green. This is F3; it is the main coverage gap, not a current code bug.
- The verified-tap canary scans answers/logs for **secrets only**, not for distinguishing refusal detail — so a code change that logs `bad_mac` vs `bad_picc` with more granularity (but no secrets) would still pass (F1 context).
- Everything else in §7 is a real assertion: fresh→already_checked, counter gaps, bit flips, wrong keys/UID, key epochs, needs_service at 0xFFFFFF and retired, edition-only-after-genuine, unknown/inactive/suspended/Lost lifecycle, concurrency (one genuine per counter), no-client-address, rate limits, canary secrecy, table/function closure, code-never-reused. Each was observed to fail against a deliberately broken variant during suite development (per the harness pattern), and all 17 pass against current code.

---

## 8. Limits of this review

- Reviewed against PGlite 18.x in memory with outbound network denied — not production, not PostgreSQL 17.x, not a hosted environment. Nothing was pushed, applied or deployed; `VERIFIED_TAP` stays off.
- `test:db` runs as a long sequential chain; each component passes individually (shown above). The monolithic command hits the 300 s CI ceiling on duration only.
- Frontend `/d/<code>` page (Session B) and real-phone/real-chip/KMS steps are out of scope (DEC-043 marks them human/hosted).
- F2 (rate-limit race) and F4 (timing indistinguishability) are code/timing readings, not demonstrated against PGlite's single connection.
- The session worked in one folder only; no other folder was touched; no code was changed.

---

## 9. Test counts (for the record)

| Command | Result |
|---|---|
| `npm run test:verified-tap` | **17 passed, 0 failed** (exit 0) |
| `node --import ./scripts/ci/deny-network.mjs netlify/tests/sun.mjs` | **27 passed, 0 failed** (exit 0) |
| `npm run test:db` (each component) | **all green, exit 0** — apply 17+17, verify 21, rls-adversarial 64, rls-matrix 1,615, identity 69, admin-notes 12, golden 19, admin-contract 17, rollbacks 18, account-deletion 9, bundle:check 4, history 2 |
| `npm run test:security` | **11 passed, 1 failed** — the failure is environmental (`no dist/index.html`), not a security finding |

**Bottom line: no P0, no P1. Verified Tap is fail-closed, atomic, and well-covered for the local build; the four P2 / two nit findings are small and each has a described fix.**
