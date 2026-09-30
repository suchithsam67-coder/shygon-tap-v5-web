# SHYGON: Decision index

This is the index of every decision record (DEC). Doc 13 §4 and §11 define the process, and new records use `docs/governance/DECISION_RECORD.md`.

- Detailed records live in `docs/governance/decisions/`.
- A row without a linked file is still only a queue entry. Its record is created from the template when the decision is taken up.
- Seeded on 2026-09-30 from the doc 13 §1.2 decision queue, in table order: SEC-1 → DEC-2026-001, OQ-1 → DEC-2026-002, then DEC-2026-003 onward.

**Read this first**
- **No role holder is named.** Every Accountable Owner below is a role that is **UNASSIGNED — HUMAN ACTION REQUIRED** (OQ-16 / DEC-2026-018). Roles are not people, and no names have been invented.
- **States** follow the G§84 state machine (doc 13 §10.3). `PROPOSED` means nobody has decided yet; a recommendation in the pack is not an approval.
- **Deadlines** apply the doc 13 §4 proposal: P1 ≤ 2 business days, P2 ≤ 10, P3 at the next planning session. That proposal (GAP-4) is itself not yet approved.
  - Counted from 2026-09-30, Monday to Friday. Public holidays are **not** accounted for; for example, 2026-10-02 is a national holiday in India.
- **Security rule for this file:** no secret value may ever be written here.

## Decision queue

| ID | Title | Source | Priority | Accountable Owner (role) | State | Deadline | Human action |
|---|---|---|---|---|---|---|---|
| [DEC-2026-001](governance/decisions/DEC-2026-001_credential-exposure-rotation.md) | Potential credential exposure: rotate the Supabase service-role key and Razorpay secrets; establish the ZIP exposure history | SEC-1 | **P0 triage** (provisional; pack: P1) | Security Owner (UNASSIGNED) | **OPEN — HUMAN ACTION REQUIRED** | Immediate | HUMAN ACTION REQUIRED: the six actions in the record. Rotation is NOT DONE. Production data: UNKNOWN. |
| [DEC-2026-002](governance/decisions/DEC-2026-002_card-activation-expiry.md) | Should a card stop working 14 days after activation? | OQ-1 | P1 (→ P0 if paying customers' cards auto-suspend) | Product Owner (UNASSIGNED) | PROPOSED (blocks M1.1 lifecycle) | 2026-10-02 | HUMAN ACTION REQUIRED: decide. Live behaviour is kept until then. |
| DEC-2026-003 | Customer can un-suspend their own Tap/account | F1 | P1 (→ P0 if exploited on live) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: L3 review of the M0.3 fix |
| DEC-2026-004 | Card deactivation doesn't stop the public Tap | F3 | P1 | Principal Architect (UNASSIGNED); C: Product, Security | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: define the semantics (with OQ-1, OQ-2) |
| DEC-2026-005 | OTP sent to an unverified, user-editable phone | F4 | P1 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: approve the verified-contact model (M1.3) |
| DEC-2026-006 | Repo ≠ live DB (migration drift); **blocks all DB work** | F6 | P1 | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: provide the live schema dump (see DEC-2026-016) |
| DEC-2026-007 | No CI | F8 | P1 | Engineering Owner (UNASSIGNED) | IMPLEMENTING: M0.1 on `feat/m0-governance-ci` (not merged). All gates are green on a clean local clone (2026-09-30); the first GitHub CI run is pending the push | 2026-10-02 | HUMAN ACTION REQUIRED: review the M0.0/M0.1 phase gate; create the GitHub repository and push (human only); confirm CI is green on Node 22 |
| DEC-2026-008 | Storage policies unaudited | F9 | P1 (provisional) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: storage audit (M0.5, OQ-15) |
| DEC-2026-009 | Customers can read internal admin notes | F2 | P2 (→ P1 once real orders carry notes) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: L3 review of the M0.3 fix |
| DEC-2026-010 | Forgeable analytics; weak visitor hash | F5 | P2 | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: decide at M1.6 |
| DEC-2026-011 | Slug enumeration | F7 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: accept as by-design for public personas, or not |
| DEC-2026-012 | Session stored in `localStorage` | F11 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: the "keep me signed in" decision (PRODUCTION.md §8) |
| DEC-2026-013 | Secrets held in two runtimes | F12 | P2 | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-14 | HUMAN ACTION REQUIRED: accept with a runbook (M0.5), or consolidate |
| DEC-2026-014 | Order id uses `Math.random` | F10 | P3 | Engineering Owner (UNASSIGNED) | PROPOSED | Next planning session | HUMAN ACTION REQUIRED: approve the M0.5 fix |
| DEC-2026-015 | NFC chip family (NTAG 424 DNA for new batches?) | OQ-2 | P1 (before any hardware order) | Security Owner (UNASSIGNED) | PROPOSED | 2026-10-02, and before any hardware order | HUMAN ACTION REQUIRED: decide the chip family |
| DEC-2026-016 | Live schema dump + Admin APK contract | OQ-3 | P1 | Data Owner (UNASSIGNED) | PROPOSED (blocks M0.2) | 2026-10-02 | HUMAN ACTION REQUIRED: provide the dump and the contract |
| DEC-2026-017 | Legal/compliance review (DPDP, minors, CERT-In, GST) | OQ-9 | P1 (hard gate before Phase 2 Student) | Data Owner (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: engage counsel |
| DEC-2026-018 | Name the canonical role holders | OQ-16 | P1 (hard gate before production launch) | Product Owner / Founder (UNASSIGNED) | PROPOSED | 2026-10-02 | HUMAN ACTION REQUIRED: name every role in `docs/governance/ROLE_ROSTER.md` and give the GitHub mapping for `.github/CODEOWNERS` |
| [DEC-2026-019](governance/decisions/DEC-2026-019_bundle-budget-reconciliation.md) | Bundle budget reconciliation: 90 kB cap vs current + 5 kB | M0.1 | P2 | Principal Architect (UNASSIGNED) | PROPOSED — HUMAN ACTION REQUIRED (gate enforced at 90 kB; owner: 88.55 kB clean CI measurement is the current baseline, 1.45 kB remaining) | 2026-10-14 (before M1.2) | HUMAN ACTION REQUIRED: choose the budget |
| [DEC-2026-020](governance/decisions/DEC-2026-020_web3forms-public-key-scan-exception.md) | Secret-scan exception for one Web3Forms public access key | M0.1 baseline scan | P3 | Security Owner (UNASSIGNED) | APPROVED by the repository owner 2026-09-30; re-confirmation pending | — | HUMAN ACTION REQUIRED: the named Security Owner re-confirms |
| [DEC-2026-021](governance/decisions/DEC-2026-021_npm-audit-brace-expansion.md) | The `npm audit` high gate fails on dev-tooling `brace-expansion` (advisories published 2026-09-29) | M0.1 CI run | P2 | Engineering Owner (UNASSIGNED); C: Security | IMPLEMENTED — VERIFYING: option A approved by the repository owner 2026-09-30 and applied in `c458a6f` (lockfile-only); audit high = 0 on a clean clone | — | HUMAN ACTION REQUIRED: the named Engineering Owner re-confirms; GitHub CI confirmation after the push |
| [DEC-2026-022](governance/decisions/DEC-2026-022_m0-3-scope-conflict.md) | M0.3 scope conflict. A: F1+F3+F4 (owner M0.2→M0.3 spec). B: F1+F2, with F3 → M1.2 card routing and F4 → M1.3 verified contacts (doc 12, audit) | Spec conflict 2026-09-30 | P1 | **UNASSIGNED** (Founder names the A) | **OPEN — HUMAN DECISION REQUIRED**. F1/F3/F4 are verify-only until decided. | 2026-10-02, and before M0.3 | HUMAN ACTION REQUIRED: choose the scope and answer the five questions in the record |

## Queued: not yet numbered (from `docs/shygon-os/00_README_INDEX.md` and doc 11 Part D)

| Source | Decision | Accountable Owner (role) | Gate | Human action |
|---|---|---|---|---|
| OQ-17 | Paging service, external status page and out-of-band incident channel | Release Owner (UNASSIGNED) | Before the Phase 1 launch; blocks M1.11 paging | HUMAN ACTION REQUIRED |
| OQ-18 | Counsel: CERT-In/DPDP incident rules and log retention | Data Owner (UNASSIGNED) | Before the Phase 1 launch | HUMAN ACTION REQUIRED |
| OQ-21 / OQ-22 | Name the internal operating layer; productize it or not | Founder (UNASSIGNED) | P2 | HUMAN ACTION REQUIRED |
| GAP-1 … GAP-12 | Gaps in the governance spec (doc 13 §13), each with a proposed resolution | Product Owner / Founder (UNASSIGNED) | — | HUMAN ACTION REQUIRED |
| Other OQs | The remaining open questions in doc 11 Part D | per doc 11 | per doc 11 | HUMAN ACTION REQUIRED |

## Implementation notes for M0.0 / M0.1 (L0, PROPOSED; doc 12 §0 rule 8)
These record *how* the milestones were implemented where the spec left a choice. None changes product behaviour, migration semantics, RLS, payments or auth.

| ID | Note |
|---|---|
| IMP-001 | **Byte-exact baseline.** The repository uses `core.autocrlf=false` (repo-local), so committed bytes equal the working tree as found (most files are LF; 59 of 417 contain CR). CI therefore sees exactly the bytes that were tested. Commits use a repo-local agent identity, "Claude Code (agent)", in the spirit of doc 14 §3.9 (separate agent identity). The global git config is untouched. |
| IMP-002 | **`db:apply` runs once in CI.** `supabase/tests/apply.mjs` already applies every migration a second time ("idempotency: running every migration a second time"), so one invocation is the spec's "db:apply (twice)". Migration semantics are unchanged. |
| IMP-003 | **`test:payments` runs with outbound network denied** (`npm run test:payments:ci`, preloading `scripts/ci/deny-network.mjs`). What an inspection on 2026-09-30 found: `payments-and-sms.mjs` replaces `fetch` with a scripted fake, so it never reaches Razorpay or an SMS provider. `functions-security.mjs` drives the real handlers and reads non-secret settings from `.env`, so a local `.env` would give it the live `SUPABASE_URL`. None of its paths calls Supabase before failing closed (missing key → 503; no bearer token → 401 before `auth.getUser`). However, **`check-delivery` makes real calls to public PIN-code directories** (`api.postalpincode.in`, `api.pincodeapi.in`), and Shiprocket only when its credentials are set. The guard makes those calls fail like a dead network. The handler then falls back offline, and the test still asserts behaviour. The server code uses no `http`/`https`/`net`/`tls`/`dns` imports, so guarding `fetch` is sufficient. No credentials are set in CI. The original `test:payments` script is unchanged. |
| IMP-004 | **Secret scanning.** gitleaks is pinned to 8.30.1 and verified against the official release checksums. It uses its default rules over the full history (`--log-opts=--all`) with `--redact=100`, and the output lists only rule, file, line and commit. There is no `.gitleaks.toml` allowlist, because the fake fixtures in `netlify/tests` do not match the default rules. The only exception is one `.gitleaksignore` fingerprint (DEC-2026-020). A missing or wrong-version binary fails the gate. |
| IMP-005 | **Bundle gate measurement.** It counts the JS that `dist/index.html` loads (module script + modulepreload) plus its static-import closure, gzip-sized as Vite reports it (zlib default level, 1 kB = 1000 B). The cap is 90,000 B and may be raised only by an APPROVED DEC-2026-019. CSS is reported but not gated. | **Measured 2026-09-30:** 88,548 B in a clean checkout (what CI builds). The owner's working folder gives 89,572 B, because a gitignored, local-only plugin, `.vite-source-tags.js`, adds `data-source-loc` attributes to every JSX element, including in production builds (see DEC-2026-019).
| IMP-006 | **Node.** CI uses Node 22 (`.nvmrc`, which matches `NODE_VERSION = "22"` in `netlify.toml`). The local environment on 2026-09-30 was Node 20.18.0 and was not changed. Vite warns there (it wants ≥ 20.19), and one check in `functions-security.mjs` (verify-payment refuses an unauthenticated caller) reports BLOCKED on Node < 22. That check runs in CI. |
| IMP-007 | **CODEOWNERS** uses `@role-*` placeholders until the Founder supplies GitHub handles (DEC-2026-018). M0.1 adds owners for `.gitleaksignore`, `scripts/ci/`, the bundle script and `.nvmrc`. |

## Open human-only steps for governance stage G0 (doc 12 M0.0; Claude Code does not perform these)
1. Name the role holders (DEC-2026-018).
2. Create the out-of-band incident channel (OQ-17).
3. Pick the paging service (OQ-17).
4. Print `docs/runbooks/P0_RUNBOOK_SHYGON_PRINT.md` and fill in the names and numbers. The print-ready PDF of the same content is `docs/shygon-os/templates/SHYGON_P0_RUNBOOK_PRINT.pdf`.
5. Rotate the credentials and complete the other DEC-2026-001 actions.
