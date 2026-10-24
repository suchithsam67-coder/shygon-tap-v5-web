# SHYGON AAROH V6: frontend decision pack, Q-B to Q-F and DEC-2026-041 (2026-10-23)

| | |
|---|---|
| Prepared by | Session B (frontend), for the repository owner's review |
| Status | **Q-B to Q-F ANSWERED by the owner on 2026-10-23** (below). DEC-2026-041 is unchanged: PROPOSED. Nothing is pushed or deployed |
| Owner's answer, 2026-10-23 | "Approve Q-B (Coming soon), Q-C (hide unreleased owner pages in production, with a build flag), Q-D (keep the notes), Q-E (closed) and Q-F (Privé text as drafted). Implement locally with tests and report before committing. No push." |
| Branch | `claude/shygon-aaroh-v6-frontend-c7fab7` at `1e7e07d`: clean, no remote, never pushed |
| Labels | **OBSERVED-B**: checked or run by Session B in this pass. **REPORTED-A**: recorded by Session A, not re-run here. **INFERRED**. **PROPOSED**: a recommendation, needing approval |

Governance basis [OBSERVED-B]:
- DEC-2026-018 Option B and `docs/governance/ROLE_ROSTER.md`: the repository owner holds every governance role, including Product Owner, Principal Architect, Data Owner, Security Owner and Release Owner. L3 changes need a 24-hour cool-off plus the checklist review.
- DEC-2026-038 Q10: customer wording is drafted by Session B and approved by the owner.

## 1. Verified state

### 1.1 Git [OBSERVED-B]

| Item | Value |
|---|---|
| Branch / HEAD | `claude/shygon-aaroh-v6-frontend-c7fab7` @ `1e7e07dbba35…` |
| Working tree | Clean before this file was written; this file is the only change |
| Remote / upstream | None |
| Recent commits | `1e7e07d` merge of `d6a0b46` (audit fix) → `ee5b532` (Connect B-10 frontend) → `bd3a85e` (merge of the backend up to `34a482d`, v0.7.1) → `9fd7a89` (e2e sim header) → `3adf1f5` (merge of the backend up to `26eecd9`) → `c0e27a0` (the 2026-10-20 gate decisions) |
| `1e7e07d` against its first parent `ee5b532` | `package-lock.json` only: 36 entries changed, none added or removed, no dev/optional/peer flag changed. `package.json` is unchanged |
| Versions | vite 7.3.5 → **7.3.7** (`^7.3.1`); vitest and 7 `@vitest/*` packages 4.1.11 → **4.1.12** (`^4.1.11`); esbuild and 26 `@esbuild/*` platform packages 0.27.7 → **0.28.2** (transitive; vite 7.3.7 allows `^0.27.0 \|\| ^0.28.0`). Installed in this worktree: `vite@7.3.7`, `vitest@4.1.12` (`npm ls`) |

### 1.2 Checks re-run in this pass [OBSERVED-B, 2026-10-23, Node v20.18.0, npm 10.8.2]

| Check | Result |
|---|---|
| `npm audit --audit-level=high` | **exit 0, "found 0 vulnerabilities"** |
| `npm run lint` | pass |
| `npm run build` | pass |
| `npm run test:bundle` | pass, 85,314 B / 90,000 B |
| `npm run test:components` | **98/98** |
| `npm run test:secrets` (pinned gitleaks) | **fail, known (V6-014):** 80 commits, 1 finding, `9c8caa7` `src/components/ProjectConsultation.tsx:75`, value redacted |
| `npm run test:admin-contract` | **fail, known (V6-123):** 14/15; `card_design_of(text)` md5 `766bd5f9…` → `6e7cba1e…` |

The full gate run and the browser tests ran earlier the same day. They used the same tree, as an uncommitted merge, then committed unchanged as `1e7e07d` [OBSERVED-B]:
- every gate except V6-123 and V6-014;
- e2e **33/33**: fresh build, ports 4273/54421, `STACK_SIM_CLIENT_ADDRESS=1`.

Not re-run in this pass: the database suites and e2e. No code changed after that run: `1e7e07d` against the verified tree is identical.

No secret, local log or unrelated artifact is in `1e7e07d`: the only file it changes against `ee5b532` is the lockfile.

### 1.3 Source documents

| Document | Location | Revision |
|---|---|---|
| Q-A to Q-F | `docs/v6/aaroh/frontend-phase-gate-report.md` §5 (lines 146–155) | `c0e27a0` |
| Q-B / Q-D / Q-F context | `docs/v6/aaroh/showroom-copy-Q10-draft.md` §2–§3 | `c0e27a0` |
| DEC-2026-041 | `docs/governance/decisions/DEC-2026-041_mode-model.md`, revision 3: decision table lines 41–68, checks §0.13, compatibility plan §0.12, blockers §16 | `77c9c42`; identical on both branches |
| Readiness report and decision register | `docs/v6/aaroh/B-10_release-readiness.md` **on `v6/aaroh-backend` only**: §11.5 at `0d1f223`; the newer register is §12.3 at `24923fa` | `24923fa` |
| DEC-2026-042 (G11, PROPOSED) | `docs/governance/decisions/DEC-2026-042_npm-audit-vite-vitest-esbuild.md`, on `v6/aaroh-backend` only | `24923fa` |
| B-9 / B-10 approvals | `docs/v6/aaroh/B-9_client-address-plan.md` lines 7–8; `DEC-2026-039` amendment A-1 (State line 14; §A-1 lines 97–101) | backend tip |
| Existing pack | `docs/shygon-os/HUMAN_DECISION_PACK.md` (2026-10-02, SHYGON OS M0). It does not cover these questions | `369ea17` |

## 2. Q-B to Q-F

Exact wording from the source: `frontend-phase-gate-report.md` §5. Q-A ("Commit the gate-decision changes…") was answered **yes** on 2026-10-20 and committed as `c0e27a0`.

### Q-B

| Field | Content |
|---|---|
| Question | "Should the store's other roadmap items read "Coming soon" instead of "Planned"?" |
| Current status | **OPEN** (asked 2026-10-20; no recorded answer) |
| Recommendation | **Yes**, "Coming soon" (PROPOSED) |
| Rationale | The owner's approved status words (gate decisions §3, 2026-10-20) are Available, Setup required, Coming soon and Unavailable. "Planned" is not among them [OBSERVED-B: `STATUS_LABEL.future = 'Planned'` (`src/data/aarohProduct.ts:35`) is shown for every store entry marked `future` without an override. Examples: Student Passport, Event mode, "Information for places and objects", Cloud storage, and the use case "Managing a team’s cards"]. The showroom already calls the same items "Coming soon", so one item has two words today |
| Risks | Wording only; no security, privacy, migration or release effect. "Coming soon" may read as nearer than "Planned"; it gives no date. Places overlaps Info (DEC-2026-041, PROPOSED), and CQ-1b forbids advertising Info as free and unlimited; this wording makes no such claim |
| Dependencies | None. One-line change plus `availability.test.tsx` |
| Approval | Product Owner (customer wording, DEC-2026-038 Q10) |
| Exact response | "Q-B: Approved. Every store entry now labelled 'Planned' reads 'Coming soon', the same word the showroom uses. No dates or prices are shown." |

### Q-C

| Field | Content |
|---|---|
| Question | "Hide the unreleased owner pages in production builds (redirect to the AAROH experience page), keeping them on test builds?" |
| Current status | **OPEN** |
| Recommendation | **Yes** (PROPOSED), once there is a build flag the local stack and the previews can set |
| Rationale | The public side is now locked on the server: `EMERGENCY_PUBLIC_ALERTS`, `RESCUE_RELAY`, and since B-10 `CONNECT_PUBLIC`. The Return and Connect owner pages say when SHYGON has not switched them on. **But** `/shygontap/emergency` still lets a signed-in owner store third-party phone numbers, and, once an SMS provider is set, send them verification texts, for a feature customers are told is "Coming soon" [OBSERVED-B: routes in `src/AccountApp.tsx:120–125`, unlinked while `RELEASED` is false] |
| Risks | **Privacy:** collecting third parties' numbers before launch, with counsel review (G6) open. **Testing:** hiding the pages needs a flag in the stack's build (`supabase/local/serve.mjs` builds with an empty env folder; that is Session A's file) and in preview builds, or e2e and the hosted P2 lose them. No schema or production change |
| Dependencies | A build flag, from Session A's local-stack build and the preview plan (`preview-infrastructure-plan.md`); `RELEASED` in `src/components/showroom/modes.ts` |
| Approval | Product Owner, plus the Data Owner (third-party contact data) |
| Exact response | "Q-C: Approved. In production builds, /shygontap/emergency, /shygontap/return-to-owner, /shygontap/connections and /shygontap/connect/* redirect to /shygontap/experience until each feature is released. Test and preview builds keep them through an explicit build flag. Build locally with tests; no deploy." |

### Q-D

| Field | Content |
|---|---|
| Question | "The notes under the three features on a real Tap ("Found this card? Message the owner through SHYGON…"): keep, or use the approved description alone?" |
| Current status | **OPEN**. The notes are in the build (`src/components/showroom/TapShowroom.tsx:389–396`). They show only when the server's `public.status` is true, which is nowhere today |
| Recommendation | **Keep the notes as drafted** (PROPOSED). **This revises Session B's 2026-10-20 recommendation** ("use the approved description alone") |
| Rationale | The notes state limits, not benefits:<br>• Emergency: "You will not see who they are. SHYGON never contacts emergency services."<br>• Return to Owner: "Found this card? Message the owner through SHYGON. You will not see their details."<br>• Connect: "Share your details with {name}, with consent. You need a SHYGON account."<br>The emergency note, next to the alert button, carries the owner's no-dispatch rule (gate decisions §1) |
| Risks | Wording only. Removing them drops a safety statement from the emergency card. Keeping them adds two sentences the owner has not yet approved |
| Dependencies | None |
| Approval | Product Owner (customer wording, DEC-2026-038 Q10) |
| Exact response | "Q-D: Keep the three notes exactly as drafted in TapShowroom.tsx:389–396." Alternative: "Q-D: Use the approved description alone; remove the three notes." |

### Q-E

| Field | Content |
|---|---|
| Question | "Approve B-10 and B-9 for Session A?" |
| Current status | **ANSWERED by later recorded approvals** [OBSERVED-B]:<br>• B-9 Part A: the owner to Session B, relayed (`B-9_client-address-plan.md` line 8);<br>• B-9 Part B: the owner's words in line 7;<br>• B-10: DEC-2026-039 **amendment A-1**, "APPROVED in session on 2026-10-20 at 15:46 UTC" (lines 99–101).<br>Built as `f1a2548`, `298667a` and `34a482d`; frontend side in `ee5b532` |
| Recommendation | **Close Q-E as answered.** No new decision |
| Rationale | The approvals are recorded in the decision record and the plan |
| Risks | None. A stale line remains: `B-9_client-address-plan.md` line 8 still says "Part B and B-10 remain unapproved for implementation" (§5, C-2) |
| Dependencies | None |
| Approval | The repository owner acknowledges the closure |
| Exact response | "Q-E: Closed. Answered by the recorded approvals: B-9 Part A (2026-10-20, relayed), B-9 Part B (2026-10-20), and B-10 as DEC-2026-039 amendment A-1 (2026-10-20)." |

### Q-F

| Field | Content |
|---|---|
| Question | "Privé demo wording (sample hotel, "SHYGON's demo desk", the demo notice)" |
| Current status | **OPEN.** DEC-2026-040 is APPROVED (the demo's design choices, as built), but contract §12 says Privé's "customer wording is the owner's to approve". `PRIVE_DEMO = false` |
| Recommendation | **NEEDS HUMAN DECISION** (customer text). The text in the build, for approval or editing [OBSERVED-B, `src/components/showroom/PriveDemoView.tsx`, `modes.ts:183`]:<br>• "**Demo.** A sample hotel. Not connected to any real hotel, booking, room or door."<br>• labels "Sample hotel" and "Sample stay";<br>• "In a hotel that uses Privé, a guest’s card could open requests like these. Choose one to see what the demo does.";<br>• services "Fresh towels", "Housekeeping", "Late check-out", "A table at the restaurant";<br>• the result "Not sent: this is a demo", "“{service}” stayed on this page. No hotel received it. A real hotel would first connect its own systems to SHYGON, and that is not part of this release.";<br>• the card note "A demonstration with a sample hotel. It is not connected to any real hotel, booking or room." |
| Risks | Brand and expectations: it must never suggest that a real hotel received anything, and the text already says so. No data, security or migration effect: the public walkthrough is client-only (DEC-2026-040 Q1) |
| Dependencies | The signed-in demo page (§10c) is not built. A comment in `PriveDemoView.tsx` is stale (§5, C-6) |
| Approval | Product Owner |
| Exact response | "Q-F: Approved as drafted (the text listed in the decision pack). Switch PRIVE_DEMO on, in the demo showroom only." Or supply edited text |
| Not listed above, but in the same view (flagged 2026-10-23; **approved as drafted by the owner on 2026-10-24**: "The six Privé strings flagged in the decision pack are approved as drafted too.") | The card's name "SHYGON Privé" and tagline "A hotel stay, opened by a card." (`modes.ts`); the sample values "SHYGON Demo Residence" and "Room 000 · Guest"; the buttons "Try the demo" and "Back to the sample services" (`PriveDemoView.tsx`) |

## 3. DEC-2026-041 (Info): what remains open

The record's own decision table (revision 3, lines 41–68) already lists each item's status and next-step owner. **Info is not approved.**

Approved items are exclusions and rules only: PQ-1b, PQ-2, PQ-3, SQ-2b, SQ-3, SQ-4, CQ-1b, CQ-2, AQ-1, AQ-2 (Tap level), BQ-2 and BQ-3.

Still open:

| ID | Exact direction / question (source) | Status | Recommendation | Needs |
|---|---|---|---|---|
| A0 | Relayed details (120/280 limits, category list): "Treat … as unconfirmed until I explicitly confirm them" | PROPOSED | Confirm or amend (DEC §6) | **Product Owner**: explicit confirmation |
| PQ-1 | One Info page per account in V1, "subject to the Principal Architect confirming how the current account-level Tap resolver supports it" | CONDITIONALLY ACCEPTED | Confirm, once the drift (F-4: production can create *additional* Tap pages) is understood | **Principal Architect** |
| SQ-1 | A separate, structured Info record: "Approve the direction … not migration approval" | CONDITIONALLY ACCEPTED | Decide "mode table" or "page family" after G2 (§0.11) | **Principal Architect** |
| SQ-2 | Production `page_template` and card-family features | BLOCKED | Provide the capture (V6-106) | **Repository owner** (Data Owner) |
| CQ-1 | Does the 14-day Terms rule cover Business only? | BLOCKED | Engage a legal reviewer (DEC-2026-017) | **Repository owner** → legal reviewer |
| CQ-3 | Compatible with future Locations; no merge, no organisation promise | CONDITIONALLY ACCEPTED (design) | Document the reuse path (§0.9 draft) | **Principal Architect** |
| AQ-2 (card) | Card-level validation | BLOCKED | Needs a card registry (`/d/<code>`, P-4) | **Repository owner** |
| BQ-1 | Changing `get_public_profile`; the compatibility plan §0.12 | BLOCKED | Approve §0.12 after the capture. The frontend fact in §0.12 step 5 is OBSERVED-B (unknown payload keys are not rendered) | **Repository owner** |
| RQ-1 | No invented quota; a pre-release abuse assessment | CONDITIONALLY ACCEPTED | Session A's assessment, then the owner accepts it | Session A → owner |
| M-1 / M-2 / M-3 | Mode model; "Info free, no SKU"; the new records and APIs | PROPOSED | Per DEC §15: evidence steps first | Repository owner / Product Owner / Principal Architect |
| M-4 | Implementation (034, `/api/modes`, contract v0.8) | BLOCKED | Not until checks 1–7 pass and a scope approval exists | **Repository owner** |
| Check 6 | Negative tests for leaks (page, metadata, storage: Session B's part) | Defined, not written | Write them with M-4, not before: they test behaviour that does not exist yet | Session B, after M-4 |

The DEC's own §15 recommends:
1. The owner supplies the production capture and states the migrations' origin.
2. The owner **assigns the Principal Architect, or acts in the role** (see C-5).
3. The owner engages the legal reviewer.
4. The owner approves or amends the compatibility plan.

Session B concurs; no further frontend action is due before M-4.

## 4. Release gates (frontend view)

| Gate | Status | Evidence (provenance) |
|---|---|---|
| P1: address header on host previews | **BLOCKED** | No preview, CLI or remote; G3, G13, G14, AP-1–AP-6 (REPORTED-A, readiness §11.1, §12.2) |
| P2: Connect on a hosted non-production database | **PARTIAL, not closed** | Local equivalent 18/18 (REPORTED-A, §11.2); hosted BLOCKED (G13, G14) |
| P3: browser e2e with the switch journey | **CLOSED** | 33/33 at `ee5b532` (OBSERVED-B, 2026-10-23; recorded by Session A in §10). Also 33/33 on the `1e7e07d` tree before commit (OBSERVED-B) |
| P4: functions-security under Node 22 | **CLOSED** | Node v22.23.4: payments 15/15, security 14/14, 0 blocked (REPORTED-A, §11.3). Checksum verified; GPG not checked |
| G11: dependency audit | **CLOSED on this branch** (audit exit 0 at `1e7e07d`, OBSERVED-B). **OPEN on `v6/aaroh-backend`**, pending DEC-2026-042 (PROPOSED, option A) | Which branch is the release candidate is G7 |
| V6-123: migration 027 | **OPEN, not waived**. 027 is in this branch's `supabase/migrations/`; `test:admin-contract` 14/15 (OBSERVED-B) | DEC-2026-037 hold-aside; G10 (move to `supabase/proposed/`) needs the owner |
| V6-014: secret-scan history finding | **OPEN, not waived**. 1 finding (OBSERVED-B) | DEC-2026-020 exception; DEC-2026-035 D-7 open (G4) |

**Release: BLOCKED** on P1, hosted P2, G1–G7, G10, G13, G14, and DEC-2026-042 for the backend branch.

## 5. Contradictions and stale records

| # | Where | What | Effect |
|---|---|---|---|
| C-1 | `frontend-phase-gate-report.md` header and §4 (`c0e27a0`) | Still says the gate-decision changes are uncommitted, that v0.5–v0.7 are not merged, and that B-9 and B-10 are open | Stale. To be updated by Session B with the next approved commit |
| C-2 | `B-9_client-address-plan.md` line 8 (backend tip) | "Part B and B-10 remain unapproved for implementation" contradicts line 7 and DEC-2026-039 A-1 | Session A's document. To report to Session A (not running when this was written) |
| C-3 | `B-10_release-readiness.md` §7.3 R6 | "(result pending, P3)", while §10 closes P3 | Session A's document. To report to Session A |
| C-4 | DEC-2026-041 State line | "AAROH-API stays at v0.7"; the contract is v0.7.2 (B-10 and editorial; no mode change) | Substance holds; wording stale |
| C-5 | DEC-2026-041 lines 12 and 46, and `docs/DECISIONS.md` rows | "Principal Architect UNASSIGNED", while `ROLE_ROSTER.md` and DEC-2026-018 Option B name the repository owner in that role | The owner can unblock PQ-1, SQ-1, CQ-3 and M-3 by acting in the role, as DEC §15 already allows |
| C-6 | `src/components/showroom/PriveDemoView.tsx` header comment | Calls Q6/FE-D5 a conflict "for the owner to confirm"; it was decided (Q6 → A, DEC-2026-040 APPROVED) | Comment only; fix with Q-F |
| C-7 | The readiness report and DEC-2026-042 | Exist only on `v6/aaroh-backend`, which this branch merged up to `34a482d` | They reach this branch at the next approved backend merge |

Nothing requested is missing.

## 6. Recommended next engineering action

1. **The owner answers Q-B to Q-F** (§2). Then, as one local change with tests: Q-B (one word), Q-D (keep or remove the notes), Q-F (text, `PRIVE_DEMO`, comment C-6) and the C-1 report update.
   - Q-C waits for the build flag from Session A's stack build.
   - Commit only on the owner's word.
2. **G11 on the backend branch:** the owner decides DEC-2026-042. Session A applies it.
3. **Release-track approvals** (G1–G7, G10, G13, G14, AP-1–AP-6) stay with the owner. P1 and the hosted P2 cannot proceed without them.

## 7. Verdict

**READY FOR REVIEW**: this decision pack.

**Release: BLOCKED** (§4). No approval is claimed or recorded here.
