# SHYGON AAROH Version 01: complete scope

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Status | **APPROVED 2026-11-02 (founder decision F-1: "Approve F-1").** This is the authoritative scope; any change needs a new founder decision |
| Evidence | `SHYGON_OS_IMPLEMENTATION_INVENTORY.md` (statuses and evidence); `SHYGON_OS_FOUNDER_DECISION_REGISTER.md` (F-numbers) |
| Rule | The **complete vision** (all five systems) and **Version 01** (the first production release) are different things. V01 is complete when every row marked **V01** below meets `SHYGON_OS_ACCEPTANCE_CRITERIA.md`. |

**Release phases** (see `SHYGON_OS_MASTER_ROADMAP.md`):
- P0: audit;
- P1: core identity and AAROH;
- P2: Owner OS;
- P3: modes;
- P4: security and portability;
- P5: AI;
- P6: commercial;
- P7: production readiness;
- P8: future.

**Agents:**
- **A**: Claude backend session;
- **B**: Claude frontend session;
- **OC**: OpenCode;
- **CX**: Codex;
- **GPT**: ChatGPT (text only);
- **Coord**: the Coordinator;
- **Owner / Adult / Counsel**: humans.

## 1. Version 01 in one paragraph

A premium NFC card that opens the owner's page in any browser, with no app. The owner chooses one active mode: **Business** (their profile), **Info** (a page about an object or place) or **Lost** (a finder can message them privately). Optional safety features are switched on one by one as their gates pass: **Return to Owner**, **SHYGON Connect** (consent-based contact exchange) and **Emergency owner alerts** (SMS to verified contacts). New cards prove each tap is genuine with **Verified Tap**. The owner manages everything in the web dashboard, can **export their data**, and pays once (no subscriptions). Adults only. No AI features. A single host, CI, previews, monitoring, backups and the governance gates are in place before launch.

## 2. Feature scope

### 2.1 Identity OS

| Feature | Purpose / user | V01? | Phase | Current status | Key requirements (functional / technical) | Security / privacy / legal | Acceptance (summary) | Owner |
|---|---|---|---|---|---|---|---|---|
| Public profile `/t/` and `/d/` | Visitors see the owner's chosen page | **V01** | P1 | BUILT AND VERIFIED (V5 live) | Legacy `/t/` links never break; 1.5 s tap→paint on 4G | Field-level privacy; no enumeration (P-2) | Golden 100%; perf budget; a11y | A + B |
| Field privacy controls | The owner hides phone/email | **V01** | P1 | BUILT AND VERIFIED | Server-enforced (025) | Fix D-11 (email pre-fill) | RLS matrix + golden | A + B |
| Profile editor + customisation | The owner edits the card page | **V01** | P2 | BUILT AND VERIFIED | 14-day window (030 guard) | Terms wording (F-13) | e2e journey | B |
| Accounts & auth | Sign-up, sign-in, reset | **V01** | P1 | BUILT AND VERIFIED | Password policy aligned (V6-036) | Session storage (F11) reviewed | identity 69 + auth e2e | A + B |
| Adult-only eligibility | Legal | **V01** | P1 | NOT STARTED | An 18+ confirmation at sign-up; Terms | DPDP minors (F-26) | Copy approved by counsel | B + Counsel |
| Verified phone + step-up | Account security | **V01 (phone verify only)** | P4 | NOT STARTED | OTP to the account phone before any SMS feature uses it | F4 finding | Tests + abuse limits | A + B |
| Admin MFA | Admin security | **V01** | P4 | NOT STARTED | Supabase MFA for admin accounts | — | Admin login requires 2FA | A |
| Account deletion | Rights | **V01** | P4 | BUILT AND VERIFIED | Removes all AAROH data; keeps tax orders | DPDP | account-deletion 9 + export parity | A |
| SHYGON ID (customer-facing) | Identity | Later | P8 | DOCUMENTED ONLY | — | — | — | F-21 |
| Multiple profiles, ownership transfer, recovery beyond reset | Identity | Later | P8 | DOCUMENTED ONLY | M1 domain model | — | — | — |

### 2.2 Experience OS

| Mode / capability | V01? | Phase | Status | Release condition (all needed) | Owner |
|---|---|---|---|---|---|
| Business | **V01** | P1 | BUILT AND VERIFIED | Golden + perf | A/B |
| Info (incl. "places and objects", F-12) | **V01** | P3 | BUILT AND VERIFIED, OFF | Wording approved (F-19); Terms (F-13); catalogue switched on per environment | A/B |
| Lost | **V01** | P3 | BUILT AND VERIFIED, OFF | Return to Owner live; wording (F-19); OC-7 review fixed | A/B |
| Return to Owner | **V01** | P3 | BUILT AND VERIFIED, OFF | Hosted P1 PASS on the chosen host; `TRUSTED_CLIENT_IP_HEADER` set; counsel (F-23) | A |
| SHYGON Connect | **V01** | P3 | BUILT AND VERIFIED, OFF | Hosted P2 PASS; counsel; wording | A/B |
| Emergency owner alerts | **V01** | P3 | BUILT AND VERIFIED, BLOCKED | DLT + MSG91 (F-10); phone verification; supervised smoke test; counsel | A/B + Adult |
| Emergency visitor alerts | Later | P8 | BUILT, OFF by decision | DEC-038 Q2 re-decided after owner alerts run | — |
| Verified Tap | **V01** | P1 (backend) / P3 (badge) | Backend BUILT AND VERIFIED, OFF; badge NOT STARTED | Key custody (F-16 Q2); production keys; the first DESFire EV3 batch personalised and batch-verified; the badge built; OC-6 review fixed | A/B + Adult |
| Edition provenance ("No. 037 of 100") | **V01** (as part of the Verified Tap verdict) | P3 | BUILT (verdict edition field) | Card records complete for the batch | A/B |
| Privé | Later (demo only) | P8 | PROTOTYPE | Real partners decision | — |
| Guardian | Later | P8 | DOCUMENTED ONLY | Visitor alerts decision | — |
| Student, Events, Cloud, Verify, Access | Later | P8 | DOCUMENTED ONLY | Each needs its own DEC; Student needs a minors legal review | — |

**Per-mode specification:** every V01 mode already has its contract section (`docs/v6/aaroh/api-contract.md` §6, §10, §10a, §10b, the Verified Tap section) and its capability-matrix entry (purpose, actors, permissions, limits, audit, tests). Gaps: the Lost and Verified Tap capability-matrix entries are to be added by A.

### 2.3 Owner OS

| Feature | V01? | Phase | Status | Gap to close | Owner |
|---|---|---|---|---|---|
| Dashboard, analytics, orders, settings, notifications, support | **V01** | P2 | BUILT AND VERIFIED (V5) | Review mobile + a11y (acceptance §3) | B |
| Mode management | **V01** | P2 | BUILT AND VERIFIED | Merge v0.11.1; Lost wording | B |
| Card activation + status | **V01** | P2 | BUILT AND VERIFIED (V5 OTP) | Status for DESFire EV3 cards (`/d/` code ↔ owner) | A/B |
| Card pairing / registry | **V01 (minimal)** | P2 | PARTIALLY IMPLEMENTED | Bind a personalised card (code + epoch) to an owner at activation; DEC-028 lifecycle states | A/B |
| Lost-card protection ("report stolen / disable card") | **V01** | P2 | PARTIALLY IMPLEMENTED | An owner action that retires a card (Verified Tap → `needs_service`) | A/B |
| Safety settings (Emergency, Return to Owner, Connections pages) | **V01** | P2 | BUILT AND VERIFIED, hidden | Unhide per feature as it is released | B |
| Data export (JSON + vCard) | **V01** | P4 | DOCUMENTED ONLY | Build the export endpoint + page (F-20; GPT-9 brief) | A/B |
| Payments, invoices (one-time) | **V01** | P6 | BUILT AND VERIFIED (test mode) | Live activation (F-11); V6-128 refund sync; legal details on the site | A + Adult |
| Subscriptions | Later | P8 | DEPRECATED for V01 | F-9 | — |
| Ownership transfer | Later | P8 | DOCUMENTED ONLY | — | — |

### 2.4 Intelligence OS

| Item | V01? | Phase | Notes |
|---|---|---|---|
| AI architecture + governance (permissioned, audited, opt-in) | **Docs only in V01** | P5 | `SHYGON_OS_TECHNICAL_ARCHITECTURE.md` §6; doc 09 governance |
| Any AI feature (profile assistant, content, recommendations, support, analytics, workforce) | Later | P5/P8 | Each feature needs a use-case triage, a DPIA-style assessment and the owner's DEC. None ships in V01 (F-25) |

### 2.5 Infrastructure OS (all **V01**, phase P7 unless stated)

| Capability | Status | V01 requirement |
|---|---|---|
| Authorization / RLS / API contract | BUILT AND VERIFIED | Keep the gates green; a re-run on the fresh production capture |
| Hosting (one target) | BLOCKED (F-4) | Chosen; protected previews; production env vars scoped |
| CI | PARTIAL | `npm run ci` green on GitHub Actions for every PR; required check |
| Non-production DB + previews | NOT STARTED (F-8) | P1/P2 closed with evidence |
| Production DB rebaseline + apply 020–037 | BLOCKED (F-7, F-18) | DEC-018 review; cool-off; rollback scripts proven |
| Monitoring, alerting, error tracking | NOT STARTED | Uptime + error tracking + alerts to an adult on-call |
| Backups and disaster recovery | NOT STARTED | Supabase PITR or daily backups; a restore drill; the replay-state reconciliation (Verified Tap) |
| Kill switches | PARTIAL | Host switches documented + drilled; catalogue switches |
| Secrets: rotation B-1, custody | PARTIAL | Rotation done; production keys only in the host secret store |
| Scheduling (emergency sweep, every minute) | NOT STARTED | Cron on the chosen host with `CRON_SECRET` |
| Rate limiting, logging, request ids | BUILT AND VERIFIED | Plus V6-094 (admin edge logging, Codex) |
| Performance | PARTIAL | The landing hero under 4 s (OC-4 diagnosis; B to fix) |

## 3. Explicitly NOT in Version 01

Student, Events, Cloud, Verify (issuing), Access, Guardian, Privé (beyond the demo), visitor-initiated alerts, subscriptions, multiple profiles, ownership transfer, the customer-facing SHYGON ID, organisations / multi-tenancy, public APIs and webhooks, a native app and push, i18n, every AI feature, blockchain/DID, emergency medical data, and any feature for under-18 users.

## 4. Definition of done for Version 01

V01 is **complete** only when:
1. every V01 row is BUILT, TESTED, reviewed (an independent review for the security-relevant ones), APPROVED and PRODUCTION READY per the acceptance criteria;
2. the founder decisions F-1..F-27 marked as blocking are answered, with adult/counsel confirmation where required;
3. the release checklist in the acceptance criteria is fully evidenced.

**LIVE** is a separate, later step: the founder's (and the adult signatory's) release decision.
