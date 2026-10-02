# SHYGON OS — M1 Test Strategy

> Planning document (M1.0). No test is added by this document.
> - Existing gates are OBSERVED (CI workflow `.github/workflows/ci.yml`, `npm run ci`).
> - New suites are PROPOSAL and land with the milestone they protect.

## 1. Principles

1. **Test the schema production actually has.**
   - Today `db:verify`, `rls-adversarial` and `verify-011` run on the *repository* chain, which the drift report shows is not production.
   - Under DEC-2026-023 they move to the **live baseline** origin.
   - Expect real findings (e.g. F1 on live). Report them; never weaken a test to pass.
2. **Fail before, pass after.** Every fix or feature test must fail on the unfixed schema or code first. That is the evidence that the test tests something.
3. **Negative controls.** Each security suite carries at least one deliberately broken fixture proving it can fail (as M0.1 did for RLS and gitleaks).
4. **Isolation.** Database tests run in in-memory PGlite only. Network tests run with outbound network denied (`deny-network.mjs`). **No test touches production, uses a production credential, or uses `rzp_live_`.**
5. **Evidence.** CI run links in PRs. "Tests pass" is never stated without them.

## 2. Current suites (OBSERVED, 2026-10-02)

| Suite | Count | Runs on | Gate |
|---|---|---|---|
| eslint, `tsc -b`, `vite build` | — | repository | CI |
| bundle (`check-bundle-size.mjs`) | public Tap JS ≤ 90 kB gz (88.55 kB) | build output | CI |
| `db:apply` (with idempotency pass) | 18 migrations | repo chain (`tests/baseline.sql` stand-in) | CI |
| `db:verify` | 23 checks | repo chain | CI |
| `rls-adversarial` | 48 checks | repo chain | CI |
| `verify-011` | 16 checks | repo chain + proposed 011 | manual (wired at M0.3) |
| `test:payments:ci` | 15 + 14 (1 needs Node 22) | fakes; network denied | CI |
| gitleaks (full history, redacted) | — | git | CI |
| `npm audit --audit-level=high` | — | lockfile | CI |
| `schema-drift.mjs` | catalog diff live ↔ repo, lineage, replay | baseline + repo | manual (M0.2 tool) |

## 3. Test pyramid for M1

| Layer | Tooling | What it proves | Minimum |
|---|---|---|---|
| DB rules | PGlite (`db:verify`) on the baseline | triggers, state machines, constraints | one check per rule or transition |
| Authorization | `rls-adversarial` on the baseline | role × table × op matrix; column guards | ≥ 100 checks by M1 end (doc 12 §4.9), one per F-item and guard |
| Contract | `admin-contract.mjs`, `golden-legacy.mjs`, `public-leak.mjs` | frozen surfaces unchanged; no leaks | run in CI |
| Functions | node tests (`netlify/tests/*`) with fakes, network denied | resolver, OTP, notify worker, adapters | per endpoint |
| Drift | `schema-drift.mjs` | each migration changes only what it declares | per migration PR |
| E2E | Playwright (dev dependency only) | customer journeys | smoke set (§6) |
| Accessibility | axe-core | new pages | 0 serious/critical |
| Load | k6 | resolver p95 ≤ 300 ms at 200 rps | before G2 |
| Devices | manual `docs/QA-NFC.md` | NFC/QR on real phones | ≥ 2 iOS + 2 Android |

## 4. New suites by concern

| Suite (proposed) | Cases (must fail before / pass after where a fix is involved) | Milestone |
|---|---|---|
| **Baseline harness** | `db:apply`/`verify`/`rls-adversarial` run on `000_live_baseline.sql` + platform shim. Negative control: a planted broken policy fails. | M1.1 (DEC-023) |
| **Golden legacy `/t/`** | ≥ 20 real-shaped slugs (active, paused, draft, suspended, unknown, expired): `get_public_profile` output byte-identical before and after every migration | M1.1 → every PR |
| **Admin contract snapshot** | every callable `admin_*` (41 live): argument types and result shape unchanged; every existing admin role keeps exactly its permissions | M1.1 |
| **Public-leak canary** | canary persona with a unique string in every private field: none appears in any public RPC, resolver payload, vCard, OG image, log or notification body | M1.4/M1.5 |
| **Identity contract** (DEC-029) | sending `customer_id = U` from a client is rejected or normalised; new tables join on U; `orders.customer_id` is never joined to customers; DEC-024 I-1…I-4 reproductions (the isolated probes from M0.2) fail before the fix and pass after | M1.2 |
| **Step-up / F4** | unverified phone cannot satisfy A3; verified factor can; a phone change does not silently replace the trusted factor (cool-down); expired, incorrect and replayed OTPs rejected; normal login unaffected; **O-3:** `activation_code` not readable by SELECT and card RPCs require A3; **no OTP value in logs or output** | M1.2–M1.3 |
| **Column guards / F1** | customer cannot change `suspended_*`, `suspended`, or `status` while suspended; admin RPC path still works; legitimate profile edits still work | M0.3 |
| **F2** | customer cannot read admin notes; `admin_get_order` shape unchanged (adopts `verify-011`) | M0.3 |
| **Lifecycle matrix** (DEC-028) | every legal and illegal edge of the device state machine; terminal states are terminal; replacement inherits routes; audit + domain event + notification per transition; CHECK rejects unknown `status` | M1.3 |
| **Resolver / F3, F7** | state → kind matrix (active, lost, suspended, replaced, retired, unassigned, unknown); identical negatives (body + timing tolerance); rate limit; cache purge ≤ 30 s; K1 maintenance works with the DB unreachable; `/t/` unchanged | M1.5 |
| **Persona privacy** | private field never public; back-fill equality; version history bounded to 10; the 14-day rule still passes | M1.4 |
| **Audit & events** | every privileged RPC writes exactly one audit row with request id; audit is append-only (UPDATE/DELETE denied); `domain_events` written in the same transaction (rolled back with it); no secret patterns in audit or metadata (lint) | M1.1 |
| **Notifications** | `dedupe_key` idempotency; retry → dead-letter; preferences respected except locked security categories; template snapshot; **no PII beyond a first name and link in any body** (lint); provider adapter contract with fakes | M1.6 |
| **Analytics / F5** | 1,000 forged calls give bounded counts; hash not reproducible with `md5(UA‖IP‖day)`; rollup equals raw on a fixture; retention purge skips legal holds | M1.7 |
| **Support separation** | customer cannot read `support_internal_notes` (direct, join, RPC); admin can; assignment and status changes audited | M1.8 |
| **Payments boundary** | `test:payments:ci` unchanged; **CI fails on `rzp_live_` outside fixtures**; `PaymentProvider.mode()` is `test` in every non-production environment; reconciliation script is read-only (no write statements) | M1.9 |
| **Bundle boundary** | public entry JS ≤ 90 kB; no import from `src/apps/**` or OS modules into the public Tap graph (import lint) | M1.10 |
| **Definer lint** | every `SECURITY DEFINER` function has a pinned `search_path` and `REVOKE … FROM PUBLIC` (flags O-1 today) | M1.1 |

## 5. Test data policy
- **Synthetic only:** fixed UUIDs, `example.invalid` emails, canary strings. **No production data, ever.**
- The live baseline is **schema-only** (verified). Test databases are built from it plus the platform shim.
- **Payment tests:** fakes for Razorpay/SMS/email; `rzp_test_…` placeholders generated per run; secrets deleted from the environment.
- **OTP tests:** codes are generated in-process and never printed. Assertions compare hashes or outcomes only.

## 6. E2E smoke journeys (Playwright, staging or local)
1. Sign up → profile created (customer row via live `handle_new_user`).
2. Sign in → view devices → suspend a device with step-up → `/d/<code>` shows unavailable within 30 s.
3. Change field visibility → the public page reflects it within 30 s.
4. `/t/<slug>` for golden personas renders unchanged.
5. Checkout in **test mode** → order paid → entitlement granted. **Only after DEC-024 is fixed.**
6. Open a support ticket → admin replies (customer-visible) → internal note not visible to the customer.

## 7. CI gate additions (proposed order, appended to `ci.yml`)
`… existing gates …` → **baseline harness** (`db:apply` / `verify` / `rls-adversarial` on the baseline) → golden legacy → admin contract → public-leak → definer lint → `rzp_live_` check → (later) Playwright smoke and axe on preview.
Each gate is fail-closed. None may use `continue-on-error`.

## 8. Phase-gate evidence (M1.13)
- CI run links for every gate.
- Adversarial count ≥ 100 on the baseline.
- Drift tool output per migration.
- Restore drill log.
- Kill-switch drill timings (doc 13 §7.1).
- Load test report.
- Real-phone NFC/QR checklist.
- G-PAY checklist (if payment activation is requested).
