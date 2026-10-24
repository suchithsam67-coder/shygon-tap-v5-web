# SHYGON AAROH V6: frontend phase-gate report (Session B)

**Gate:** the owner's "Frontend gate decisions" of 2026-10-20, §6 ("Before merging the newer backend or enabling any mode"). **Stopped here for the owner's review.** These decisions approve implementation planning; they are not production-release approval.

| | |
|---|---|
| Worktree | `.claude/worktrees/shygon-aaroh-v6-frontend-c7fab7` |
| Branch | `claude/shygon-aaroh-v6-frontend-c7fab7`, local only, never pushed |
| Committed (owner's word, 2026-10-20) | `8358495`: the merge of `v6/aaroh-backend` @ `d1ff25d` (AAROH-API v0.4). `0ae7e47`: the frontend. `c0e27a0`: the gate-decision changes of §2 (Q-A) |
| Since (owner's word each time, 2026-10-23) | `3adf1f5` + `9fd7a89`: the backend up to `26eecd9` (v0.7, B-9 Part A). `bd3a85e` + `ee5b532`: up to `34a482d` (v0.7.1, B-9 Part B, the B-10 Connect switch) and its frontend side. `1e7e07d`: the npm audit fix |
| Update 2026-10-23 | The owner answered Q-B to Q-F (§5). Evidence and options: `frontend-decision-pack-2026-10-23.md`. §1–§4 below are the 2026-10-20 record, except where marked |
| Evidence labels | OBSERVED (seen in code or a run), CONFIRMED (a test run recorded here), PROPOSED (needs approval) |

Nothing is pushed, applied to a real database, deployed or switched on.

## 1. Verdict

| Area | Result |
|---|---|
| Approved wording and availability (§1, §3) | **Applied.** Emergency Profile, Return to Owner and SHYGON Connect use the approved text and read **Coming soon** everywhere a customer can look |
| Opening (§2) | **Applied:** short (1.8 s), skippable with a visible hint, none under reduced motion or when the owner turned openings off, never holds a not-found/paused page, and drops at once if its stylesheet fails |
| Showroom first, owner access, Privé (§3–§5) | **Applied.** Owner access is the normal sign-in; the server decides ownership. Privé stays off |
| §6.1 tests against the committed frontend and merged backend | **PASS** except the two known, tracked failures (§3.1) |
| §6.2 contracts and DB/RLS per feature | **PASS** for every feature that is customer-visible; the three Coming-soon features are verified locally too (§3.2) |
| §6.3 customer-visible availability vs backend state | **Matches today.** One gap on any host where 032 is applied: Connect has no host switch (B-10, §3.3) |
| §6.4 failure paths | **Covered** for every feature; gaps listed (§3.4) |
| §6.5 027 and the secret-scan finding | **Tracked separately**, not waived: V6-123 and V6-014 (§3.5) |
| §6.6 production and live configuration | **Still gated.** Nothing deployed or switched on (§3.6) |
| Production readiness | **NOT READY.** Inherits every V6 release blocker; see §4 |

## 2. What the gate decisions changed (uncommitted, 25 files)

| Decision | What changed | Where | Checked by |
|---|---|---|---|
| §1 wording | Names and descriptions exactly as approved; "Coming soon" | `modes.ts`, `aarohProduct.ts` (`statusLabel`), `EmergencySettings`, `ReturnToOwner`, `Connections`, `OwnerExperience` | `availability.test.tsx` (exact text) |
| §1 "Coming soon until verified" | `RELEASED` switch per feature (all false): no account-menu entry, no link on the AAROH experience page, a "Coming soon" pill | `modes.ts`, `AppShell`, `OwnerExperience` | `availability.test.tsx`; e2e owner journey |
| §1 no false claims | No "Live" word anywhere; the store's Emergency and Return entries have no action | `modes.ts`, `aarohProduct.ts` | `availability.test.tsx` |
| §2 opening | "Tap to skip" hint; a fail-safe that ends the opening at once if its CSS did not load | `TapOpening.tsx`, `opening.css` | `TapOpening.test.tsx` (3) |
| §3 vocabulary | Available · Setup required · Coming soon · Unavailable (· Demo) | `modes.ts` | `availability.test.tsx` |
| §5 Privé | `PRIVE_DEMO = false` asserted | `modes.ts` | `availability.test.tsx` |
| §6.2 contracts | Every operation the frontend sends is in the published contract; the public Tap uses only P-1/P-2/P-3 | `src/test/contract.test.ts` | itself (5 tests) |
| §6.4 failure paths | Added: expired code (emergency), 401 (Return, Connect), expired connection, finder network retry | the page tests | themselves |
| §6.5 tracking | Backlog row V6-123 (027) | `docs/v6/backlog.md` | — |
| Docs | Approved wording record; this report | `showroom-copy-Q10-draft.md`, this file | — |

## 3. §6 verification, item by item

Run on 2026-10-20 on the committed frontend + merged v0.4 backend + the uncommitted gate-decision changes. Node 20.18, Edge, local no-Docker stack (`npm run stack -- --build`, rebuilt for this run). Every number below was observed in this run.

### 3.1 Tests re-run (§6.1)

**Component tests (Vitest):** **94/94** passed (13 files), also inside `test:components`. Up from 76: wording and availability 5, contract 5, opening 3, new failure paths 5.

**Repository gates** (`npm run ci`'s steps, one by one so a failure hides nothing):

| Gate | Result |
|---|---|
| lint, build | PASS |
| test:bundle (public Tap entry JS) | PASS, **85,293 B / 90,000 B** (base 88,908 B) |
| test:bundle-secrets, test:seo (18 pages), test:push-guard | PASS |
| db:apply, db:verify 21, rls-matrix **1380** (48 tables, 7 callers), identity 69, admin-notes 12, golden 15, rollbacks 14, account-deletion 9, db:bundle:check, db:history, rls-adversarial 64 | PASS |
| **test:admin-contract** | **FAIL 14/15, pre-existing, tracked as V6-123.** `card_design_of(text)` body md5 `766bd5f9…` → `6e7cba1e…` (migration 027). Identical on the unmodified base `f0b771c` |
| payments:ci, payment-chain 34, aaroh 15, public-tap 25, suspension 46, emergency **48**, rescue **18**, connect **16**, admin-edge 11, observability 10, security 11 | PASS |
| test:components | PASS 94 |
| **test:secrets** | **FAIL, known, tracked as V6-014 (D-7):** 64 commits scanned, the only finding is `9c8caa7` / `ProjectConsultation.tsx:75`. The two new local commits add none. A redacted scan of the 25 uncommitted files: no leaks |
| npm audit (high) | PASS |

**End-to-end (Playwright, local stack):** **33/33** passed on the first run (6.9 min), desktop and phone (Pixel 7):
- every existing journey: sign-up and purchase, upgrade, suspension, account data, a11y, mobile;
- `aaroh-experience`: 6 journeys × 2 projects, including the owner seeing the three features as "Coming soon", with no link and no menu entry;
- `aaroh-server-paths`: 5 journeys on Session A's v0.4 hooks (emergency receipt → Delivered, refusal and retry, visitor relay, Return to Owner, Connect with the consent grants revoked).

**Performance** (slow 4G, 4× CPU, local host, measured in this run): the public Tap's largest paint took **1,524 ms** with CLS 0 (budget 2,500 ms / 0.1). The landing page took 1,556 ms.

**Not run:** HawkScan DAST (no runtime or API key on this machine).

### 3.2 API contracts and DB/RLS per feature (§6.2)

| Feature | Customer state | Contract operations used | Contract check | DB / RLS check | Browser check |
|---|---|---|---|---|---|
| Public Tap: Profile, Business, Contact, Links, Owner access | Available | P-1 `get_public_profile`, P-2 `get_public_tap_state`, P-3 `record_tap_event` | `contract.test.ts`: only these three | rls-matrix, rls-adversarial 64, public-tap 25, suspension 46 | aaroh-experience (desktop + phone), public-tap-mobile, journeys |
| Owner OS: AAROH experience, cards | Available (signed in) | T-1–T-3, C-1 (existing) | existing tests | rls-matrix, identity 69 | aaroh-experience owner journey |
| Emergency Profile (owner contacts, owner alerts) | Coming soon | `/api/emergency` contacts.*, alerts.*, settings.* | `contract.test.ts` | emergency 48; rls-matrix on the 7 `emergency_*` tables | server-paths ×2, owner contacts journey |
| Emergency visitor relay | Coming soon; `EMERGENCY_PUBLIC_ALERTS` off | `public.status`, `public.alert` | `contract.test.ts` | emergency 48 | server-paths visitor relay (switch on in the test only) |
| Return to Owner | Coming soon; `RESCUE_RELAY` off | `/api/rescue` public.*, finder.*, owner ops | `contract.test.ts` | rescue 18; rls-matrix on the 5 `rescue_*` tables | server-paths Return; relay-off journey |
| SHYGON Connect | Coming soon; **no host switch (B-10)** | `/api/connect` §10b | `contract.test.ts` | connect 16; rls-matrix on `connect_*`, `connections`, `consent_grants` | server-paths Connect |
| Privé demo | Off | none (v0.6+ not merged) | — | — | — |

### 3.3 Customer-visible availability vs backend state (§6.3)

| Feature | What a customer sees | Backend state | Match |
|---|---|---|---|
| Profile, Business, Contact, Links, Owner access | On a Tap, only what the owner published | P-1 returns published fields only | Yes |
| Emergency Profile | Store, AAROH experience page: "Coming soon". Not in the account menu. Public card only if `public.status` says available | 028–030 applied nowhere real; host switch off; no SMS provider | Yes |
| Return to Owner | The same | 031 applied nowhere real; host switch off | Yes |
| SHYGON Connect | AAROH experience page: "Coming soon". Not in the menu. Public card only if `public.status` says available | 032 applied nowhere real. **But `public.status` has no host switch:** it says available whenever an owner enabled Connect on a published Tap | **Yes today; gap wherever 032 is applied.** B-10 proposed to Session A (`CONNECT_PUBLIC`, off by default); Session A agrees and has put it to the owner |
| Privé | Nothing | 033 not merged here | Yes |
| Student Passport, Events, Places, Cloud | Store: "Planned". Demo showroom: "Coming soon" | Not built | Yes (word question Q-B) |
| Verify, Access | Demo showroom: "Unavailable" | Unsupported (DEC-037) | Yes |
| Card edition | Not shown | No card registry (P-4) | Yes (blocked, §4) |

One more boundary, by design: the three owner pages are not linked anywhere, but a signed-in owner can still open them by typing their address. That keeps them testable on test systems. On a host where 028–032 are applied, an owner could store emergency contacts or turn Connect on there. See Q-C.

### 3.4 Failure paths (§6.4)

U = component test, E = browser test on the local stack. "n/a": the path cannot occur for that feature.

| Feature | Success | Unauthorised | Invalid input | Expired / suspended | Duplicate | Network failure | Provider failure |
|---|---|---|---|---|---|---|---|
| Public Tap | U, E | n/a (public) | U (invalid address) | U (paused, draft, suspended, archived); E journeys (c) | U (one view recorded) | U (error + retry, offline) | n/a |
| Emergency: owner contacts and alerts | U, E (receipt → Delivered) | U (no session; 401) | U (refused field) | U (expired code 410) | U (one key per intent; in-progress alert shown; rate limit) | U (retry reuses the key) | U, E (no provider; refusal final; retry once set up) |
| Emergency: visitor relay | U, E | n/a; switch off → hidden (U) | U (cannot send without intent) | U via the Tap states | U (one press, one request) | U (retry reuses the key) | U (`not_sent`) |
| Return to Owner: finder | U, E | n/a; switch off → hidden (U, E) | U (wait for reply, 409) | U (expired thread 410) | U (retry cannot open a second thread) | U | n/a |
| Return to Owner: owner inbox | U, E | U (401) | U (closed thread 409) | U (closed) | U (same client key on retry) | **gap:** a network drop on a reply is not tested separately | n/a |
| Connect | U, E | U (401) | U (unpublished Tap; declined recently) | U (expired request) | U (retry reuses the key) | U | n/a |

The other conditions in the brief: reduced motion (U, E), mobile and NFC/QR (U `?src=nfc`, E Pixel 7), and keyboard/screen reader (U, E: axe 0 serious or critical, landmarks, focus return). They pass as in the previous gate; the a11y and landmark lists also cover the changed pages.

### 3.5 Tracked, not waived (§6.5)

| ID | Finding | State |
|---|---|---|
| V6-123 | `test:admin-contract` 14/15 on 027 | Open, P1, Phase 0.5. 027 stays held aside (DEC-037); no contract approval to be recorded for it |
| V6-014 | `test:secrets` on `9c8caa7` | Open, P1 (D-7). No new finding in this work |

### 3.6 Still gated (§6.6)

- No production apply, deploy, live configuration, live payment or secret rotation was done or prepared.
- The host switches `EMERGENCY_PUBLIC_ALERTS` and `RESCUE_RELAY` are off; they were turned on only inside the local test stack, by its loopback-only hooks.

## 4. Remaining blockers

| # | Blocker | Blocks | Owner of the next step |
|---|---|---|---|
| 1 | **B-10:** `CONNECT_PUBLIC` host switch | Enabling Connect anywhere 032 is applied | **Done 2026-10-23**: DEC-2026-039 amendment A-1, `34a482d`; frontend `ee5b532` |
| 2 | B-9: the local host's client-address header (the e2e sets it itself) | Tooling only | **Done locally 2026-10-23** (Parts A and B, `f1a2548`, `298667a`; e2e on `x-shygon-sim-client`, `9fd7a89`). Host previews (P1) still the owner's |
| 3 | V6-123 (027) and V6-014 (D-7) | Release gates | Phase 0.5 / owner |
| 4 | SMS provider (MSG91 + DLT templates) | Any real verification or alert | Owner (DEC-038 Q3) |
| 5 | Host switches stay off until supervised owner alerts | Visitor relay, Return relay | Owner (Q2 = B, Q12) |
| 6 | Card registry (P-4) | Showing the card edition (§3) and card-level lifecycle | Card release |
| 7 | Privé wording | `PRIVE_DEMO`, merging v0.6/v0.7 | **Approved 2026-10-23 (Q-F)**; v0.7 merged; the demo is on in the demo showroom only |
| 8 | DEC-2026-041 (Info, mode model) PROPOSED | Any mode switching. Also: the showroom calls its sections "modes", the server's `mode` is one exclusive experience per Tap, and `places` is close to Info. The words need reconciling once approved | Owner |
| 9 | V6 release blockers: secret rotation, migrations unapplied, the live site is a second app | Production | Owner |
| 10 | Node 20.18 is below the `>=22.12` engine | The known payments check | Environment |

## 5. Questions for the owner

| ID | Question | Recommended | Answer |
|---|---|---|---|
| Q-A | Commit the gate-decision changes (25 files) locally as one commit? Nothing pushed | Yes | **Yes** (2026-10-20): `c0e27a0` |
| Q-B | Should the store's other roadmap items read "Coming soon" instead of "Planned"? | Yes, one vocabulary | **Approved** (2026-10-23): "Coming soon" |
| Q-C | Hide the unreleased owner pages in production builds (redirect to the AAROH experience page), keeping them on test builds? | Yes, together with B-10 | **Approved** (2026-10-23): "with a build flag", `VITE_AAROH_PREVIEW_PAGES=on` |
| Q-D | The notes under the three features on a real Tap ("Found this card? Message the owner through SHYGON…"): keep, or use the approved description alone? | Use the approved description alone; revised on 2026-10-23 to "keep" (decision pack) | **Keep the notes** (2026-10-23) |
| Q-E | Approve B-10 and B-9 for Session A? | Yes | **Closed** (2026-10-23): answered by the recorded approvals (B-9 Parts A and B; DEC-2026-039 A-1) |
| Q-F | Privé demo wording (sample hotel, "SHYGON's demo desk", the demo notice) | Owner's text | **Approved as drafted** (2026-10-23): the strings in the decision pack. `PRIVE_DEMO` on |

The owner's words (2026-10-23): "Approve Q-B (Coming soon), Q-C (hide unreleased owner pages in production, with a build flag), Q-D (keep the notes), Q-E (closed) and Q-F (Privé text as drafted). Implement locally with tests and report before committing. No push."

## 6. Previous gate (2026-10-19 brief, Phase K)

Still valid and not repeated here:
- the architecture and routes (OBSERVED);
- the user journeys;
- the emergency workflow separation (owner SOS, visitor relay; no Emergency information view; "call 112" is only a `tel:` link);
- the contract rules honoured.

They are recorded in `frontend-audit.md` and `frontend-integration-map.md`.
