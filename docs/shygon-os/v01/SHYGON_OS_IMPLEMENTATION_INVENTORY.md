# SHYGON OS: implementation inventory (Phase 0 audit)

| Field | Value |
|---|---|
| Date | 2026-11-02 |
| Author | The Coordinator (Claude Code). Read-only audit: no product file changed |
| Repository | `shygon-tap-v5-web` (private remote `github.com/suchithsam67-coder/shygon-tap-v5-web`; GitHub holds the 2026-10-26 state, everything newer is local) |
| Code inspected | Backend `v6/aaroh-backend` @ **2e1acab** (AAROH-API v0.11.1, migrations 001–037); frontend `claude/shygon-aaroh-v6-frontend-c7fab7` @ **249c8d9** (merged backend up to 39d87ca) |
| Supersedes | `coordination/2026-10-26_shygon-os-implementation-audit.md` (same method; updated for U1, Lost frontend and the review fixes) |

## How to read the status

The directive's eight statuses are used exactly as below. Five separate facts are tracked per feature, never merged:

| Fact | Meaning |
|---|---|
| **Built** | The code exists on a branch |
| **Tested** | Automated tests pass (the local stack: PGlite + gateway + the real functions). Evidence is a test name; RAN = run by the Coordinator, REPORTED = run by the owning session |
| **Approved** | The owner approved it in a DEC or in session |
| **Production ready** | Every release gate in `SHYGON_OS_ACCEPTANCE_CRITERIA.md` passed. **No V6 feature is production ready today** |
| **Live** | Running for real customers. Only V5 features are live (production DB history up to ~019, 2026-09-28; **production has drifted** from every repository, V6-106) |

**Status vocabulary:**
- **BUILT AND VERIFIED**: built and automated-tested locally. NOT live, NOT production-verified.
- **BUILT BUT NOT VERIFIED**: code exists without passing tests I can cite.
- **PARTIALLY IMPLEMENTED**.
- **PROTOTYPE**: UI or demo only.
- **DOCUMENTED ONLY**.
- **NOT STARTED**.
- **BLOCKED**: cannot proceed without an external or human dependency.
- **DEPRECATED**.

## A. Identity OS

| Feature | Status | Live? | Evidence | Notes |
|---|---|---|---|---|
| Public digital profile (`/t/:username`) | BUILT AND VERIFIED | **V5 version live** | `src/pages/PublicTap.tsx`; golden output 19 slugs byte-identical (`test:golden`, REPORTED 2e1acab) | V6 privacy changes (025) not live |
| Public/private field controls | BUILT AND VERIFIED | No | Migration 025 (V6-071); editor "Show on Tap" switches | D-11 open: the login email is pre-filled into the public Tap |
| Profile customisation (editor, palettes, 14-day edit window) | BUILT AND VERIFIED | V5 live | `TapEditor.tsx`, `Customize.tsx`; 030 guard closes the edit-window bypass (V6-109) | Terms vs Info edit conflict (CQ-1) |
| Accounts (Supabase Auth: sign-up, sign-in, reset) | BUILT AND VERIFIED | Live | `Auth.tsx`; `test:identity` 69 | Password policy is a project setting (V6-036, open) |
| SHYGON ID (customer-facing) | DOCUMENTED ONLY | — | Only the internal `CUST-…` exists | **D-9 undecided** |
| Identity verification (phone, step-up, MFA) | NOT STARTED | — | doc 10 MVP item 5 | The phone is unverified and user-editable (F4) |
| Multiple profiles per user | DOCUMENTED ONLY | — | M1 domain model §3 | doc 10: "do not build now" |
| Ownership transfer | DOCUMENTED ONLY | — | M1 domain model | — |
| Account recovery beyond password reset | NOT STARTED | — | — | — |
| Account deletion | BUILT AND VERIFIED | Partly (V5) | Runbook + `account-deletion.sql`; `test:account-deletion` 9 | Orders kept for tax (026 RESTRICT) |

## B. Experience OS (modes and capabilities)

| Feature | Status | Live? | Evidence | Switch today |
|---|---|---|---|---|
| Business mode | BUILT AND VERIFIED | V5 live | Default mode; golden | On |
| Info mode | BUILT AND VERIFIED | No | 034/035, `/api/modes`, `PublicInfoPage`; `test:modes` 28; OpenCode review → 2686606 | **OFF** (catalogue); wording unapproved |
| Lost mode | BUILT AND VERIFIED | No | 036 + frontend 249c8d9; `test:modes` 28; OpenCode reviews → 2e1acab | **OFF** (catalogue + `RESCUE_RELAY`); wording unapproved |
| Return to Owner (finder relay) | BUILT AND VERIFIED | No | 031, `/api/rescue`; `test:rescue` 18 | **OFF** (`RESCUE_RELAY`); P1 preview check required |
| Emergency contacts + owner alerts | BUILT AND VERIFIED | No | 029, `/api/emergency`; `test:emergency` 49 | **BLOCKED** for delivery: no SMS provider/DLT |
| Visitor-initiated emergency alerts | BUILT AND VERIFIED | No | Same | **OFF** by decision (DEC-038 Q2) |
| Emergency Profile (a view) | PARTIALLY IMPLEMENTED | No | DEC-038 Q11 = B (relay view only) | Hidden |
| SHYGON Connect + consent ledger | BUILT AND VERIFIED | No | 032, `/api/connect`; `test:connect` 17 | **OFF** (`CONNECT_PUBLIC`); hosted P2 required |
| Verified Tap (NTAG 424 DNA SUN, `/d/<code>`) | BUILT AND VERIFIED (backend) | No | 037, `/api/verify`, `netlify/lib/sun.mjs`; `test:verified-tap` 17, `test:sun` 27 (RAN + an independent vector check) | **OFF** (`VERIFIED_TAP`), test keys only; **frontend badge NOT STARTED**; key custody (Q2) open |
| Privé (hospitality) | PROTOTYPE | No | 033 demo provider (DEC-040); `test:prive` 12 | Demo showroom only |
| Guardian | DOCUMENTED ONLY | — | Deferred by the owner 2026-10-25 | — |
| Student | DOCUMENTED ONLY | — | Showroom "Coming soon"; DEC-017 legal gate (minors) | — |
| Events | DOCUMENTED ONLY | — | doc 10: needs the consent ledger + organisations | — |
| Places / objects | **Contradiction** | — | Showroom lists "Places and objects" as coming soon, while **Info mode already is** the object/place page (DEC-041) | See C-3 |
| Cloud storage | DOCUMENTED ONLY | — | Showroom only | — |
| Verify (issuing / attestation) | DOCUMENTED ONLY | — | doc 10: needs organisations | Different from Verified Tap |
| Access (doors, permissions) | DOCUMENTED ONLY | — | doc 10: highest risk, gated | — |
| AAROH experience page / showroom | PROTOTYPE (UI) | No | `/shygontap/experience`, `/aaroh/experience`; e2e 34 (REPORTED) | Unreleased features show "Coming soon" |

## C. Owner OS

| Feature | Status | Live? | Evidence |
|---|---|---|---|
| Dashboard pages (account, analytics, orders, settings, notifications, support, QR) | BUILT AND VERIFIED | V5 live | `src/pages/*`; component tests 138 (REPORTED, with a 20 s limit) |
| Mode management page (Business/Info/Lost) | BUILT AND VERIFIED | No | `TapMode.tsx`; TapMode tests |
| V6 owner pages (Emergency, Return to Owner, Connections) | BUILT AND VERIFIED | No | Hidden in production builds (Q-C) |
| Card activation (OTP) | BUILT AND VERIFIED | **V5 live** (015) | `card-otp.mjs` |
| Card pairing / registry / lifecycle | PARTIALLY IMPLEMENTED | — | `cards` table; Verified Tap code table (037). The full device model (M1) is NOT STARTED; DEC-028 open |
| Lost-card protection | PARTIALLY IMPLEMENTED | — | Lost mode + card suspension (V5); a "report stolen" flow is NOT STARTED |
| Theme customisation | BUILT AND VERIFIED | V5 live | `Customize.tsx`, palettes |
| Analytics | BUILT AND VERIFIED | V5 version live | 025 analytics; V6-112 forgeable XFF (frozen fn) |
| Subscriptions | **DEPRECATED for now** | — | V6-059 cut; "no subscription" promises exist (see C-6) |
| Payments, orders, invoices | BUILT AND VERIFIED | V5 live, test mode only (B-3) | `test:payment-chain` 30, `payments` 15; admin refund; V6-128 refund gap |
| Data export | DOCUMENTED ONLY | — | U3; needs the owner + counsel |
| Notifications (in-app) | BUILT AND VERIFIED | V5 live | 014 realtime |
| Notifications (email / SMS / WhatsApp / push) | BLOCKED | — | SMS: DLT; email: provider DEC-031 open |
| Support page | BUILT AND VERIFIED | V5 | `Support.tsx` |

## D. Intelligence OS

| Feature | Status | Evidence |
|---|---|---|
| Any AI feature in the product | NOT STARTED | No code (grep). doc 09: "Future, not MVP"; doc 10: "do not build AI yet" |
| AI Workforce / company OS | **Outside this repository** | The sessions "SHYGON AI company operating system" and "external storage" work in `E:\SHYGON_AI_STORAGE`. Not audited here |
| SHYGON Control (doc 14 operating layer) | DOCUMENTED ONLY | doc 14 |

## E. Infrastructure OS

| Feature | Status | Evidence |
|---|---|---|
| Authorization (RLS on every table, server-only AAROH tables) | BUILT AND VERIFIED | `test:rls-matrix` 1615 checks, admin-contract (function grants) |
| API layer (15 serverless functions, contract-versioned) | BUILT AND VERIFIED | `netlify/functions/*`, `api/*`; AAROH-API v0.11.1 |
| Rate limiting | BUILT AND VERIFIED | Per feature, in SQL; trusted client-IP header (B-9); P1 hosted check pending |
| Logging, request id, health | BUILT AND VERIFIED | `log.mjs`, `/api/health`, `test:observability` 10; admin edge logging V6-094 being built (Codex) |
| Monitoring, alerting, error tracking | NOT STARTED | Provider undecided |
| Hosting (one target) | BLOCKED | V6-043 undecided (ChatGPT brief GPT-8 in progress) |
| CI | PARTIALLY IMPLEMENTED | `.github/workflows/ci.yml` exists; the remote exists since 2026-10-26; **no CI run evidence seen** |
| Preview environments + a non-production DB | NOT STARTED | AP-1..AP-6; the runners for P1/P2 are built |
| Backups / disaster recovery | NOT STARTED (repo side) | Supabase platform backups not inspected |
| Secret management + rotation | PARTIALLY IMPLEMENTED | Scanning + E-1/DEC-020 exceptions; **B-1 rotation not done** |
| Production database | **BLOCKED** | Drift V6-106; a second app on the live domain (V6-107); 020–037 never applied |
| Kill switches | PARTIALLY IMPLEMENTED | Host switches (`RESCUE_RELAY`, `CONNECT_PUBLIC`, `VERIFIED_TAP`, `EMERGENCY_PUBLIC_ALERTS`), mode catalogue; doc 13's K-list is not built |

## F. Other products in the wider SHYGON estate (not this codebase)

| Product | Where | Status |
|---|---|---|
| Admin app (Expo, Android APK) | `../shygon-tap-v5-admin` | Exists; NOT AUDITED |
| SHYGON Member OS | `Documents\SUCHITH\shygon-member-os`, its own session | Demo live at shygon-member-os.vercel.app (fictional data); real workspace not connected. The untracked copy in this repo is superseded |
| SHYGON AI company OS / storage | `E:\SHYGON_AI_STORAGE` | Separate sessions; NOT AUDITED |

## G. Contradictions between the documents and the code (not resolved by guessing)

| # | Contradiction | Sources | Needs |
|---|---|---|---|
| C-1 | doc 10 "do not build" Rescue, Connect, Events, AI in the first phase, but Rescue (031) and Connect (032) are built | doc 10 §4 vs DEC-038/039 (later, owner-approved) | Record that DEC-038/039 supersede doc 10 §4 (F-6) |
| C-2 | doc 10's MVP (verified phone, email outbox, MFA, kill switches K1–K19) vs what was actually built (modes, safety features) | doc 10 §3 vs V6/AAROH branches | The V01 scope decides (F-1) |
| C-3 | "Places and objects" listed as a future mode, while Info mode already serves objects and places | `modes.ts` vs DEC-041 | Merge or rename (F-12) |
| C-4 | Printed QR on the card back: doc 08 yes; the 2026-10-18 card design no by default | DEC-043 Q6 | F-15 |
| C-5 | Principal Architect: DEC-041 says UNASSIGNED; ROLE_ROSTER says the repository owner | Session B decision pack | F-3 |
| C-6 | "No subscription" promises on the site vs the intended 3-month trial + ₹999/month direction | 2026-10-16 owner notes | F-9 |
| C-7 | The Terms' 14-day edit rule vs free Info editing | Terms.tsx:94 vs DEC-041 | F-13 |
| C-8 | Verified Tap DEC Q5 said "add `public_code` to `cards`"; the build used a closed code table | Session A, deviation reported | F-14 |
| C-9 | Member OS: migration `022_member_os.sql` untracked in this repo (clashes with V6's 022), while Member OS now lives in its own repo | The untracked files here | F-17 |
| C-10 | The ROLE_ROSTER one-person model vs **the founder is a minor**: Legal/Compliance, the grievance officer and any contract-signing role need an adult | DEC-018 vs the directive §9 | F-2 |
| C-11 | Production is not the repository: unrecorded tables/functions; the live domain serves a non-repository app | V6-106 / V6-107 | F-7, F-8 |
