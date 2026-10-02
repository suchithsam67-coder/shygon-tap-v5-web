# SHYGON OS: Phase Gate Decision Summary (M0 before M1, or in parallel)

| | |
|---|---|
| Date | 2026-10-02 |
| Repository | `feat/m0-governance-ci` @ `008992d` (local only; no remote) |
| Feeds | DEC-2026-026: its question "must M0.3–M0.7 finish before M1.1 (rule 5), or which items are waived with a dated risk acceptance?" |
| Status | **Analysis only. Neither path is chosen. Nothing is implemented.** |

---

## 1. The rule and the question

- **doc 12 §0 rule 5:** "Security before feature. Milestone M0 must be green before M1 starts."
- **doc 12 Phase 0 acceptance (§3, after M0.9):** M0 is green when all four of these hold:
  1. all gates green;
  2. no open P1-or-higher security finding, **or** each one has an APPROVED DEC accepting the risk with a date;
  3. the owner has signed off the drift report;
  4. G1 is done (the PB-4 tabletop has been run and a restore drill recorded).
- **doc 12 §2A, first row:** "Any work at all" is gated on DEC-2026-001 rotation being **completed**. Without it, Claude Code may do only M0.0/M0.1 (repo-only).
  - M0.2 analysis and M1.0 planning went ahead by explicit owner instruction, and were documentation and analysis only.
  - **The §2A row still applies to implementation** unless the owner waives it. Rotation is NOT DONE (DEC-2026-001).
- **DEC-2026-026** asks the owner to choose between the two paths below. The M1 plan §35 suggests a middle form: M1.0a = M0.3–M0.7 first, with M0.8–M0.9 allowed in parallel. Even that is a partial waiver of rule 5, and needs the same explicit decision.

## 2. Where M0 stands today (OBSERVED)

| Milestone | State | What it still needs | Human-only parts |
|---|---|---|---|
| M0.0 Governance bootstrap | Done (`955b132`) | — | Role holders (DEC-018); incident channel and paging (OQ-17); printed runbook; rotation (DEC-001) |
| M0.1 CI | Done locally; every gate green on a clean clone | First GitHub CI run; "CI green on main" | Create the GitHub repository; push; merge |
| M0.2 Baseline | Analysis done (`441c152`) | The "Then" step: suites on the baseline, `db:apply` = baseline + 020+, migrations README. **Waits for DEC-023.** End-to-end test of `card_apply_verified_action` | Owner sign-off of `docs/governance/SCHEMA_DRIFT_REPORT.md`; VERIFY ON LIVE items |
| M0.3 F1, F2 (or F1, F3, F4) | **Blocked** | DEC-022 (scope); DEC-023 (where the migration lives); DEC-018 (L3 reviewer) | Security Owner L3 review |
| M0.4 Policy lineage (F6) | Not started | DEC-023; L3 | Security Owner review |
| M0.5 Secrets and hygiene | Not started | F10 order-id fix (the one allowed edit to frozen `create-order.mjs`); secrets runbook; `SECURITY.md`; storage checklist (OQ-15) | **Rotation (DEC-001)**; storage audit on live |
| M0.6 Observability minimum | Not started | Logger, error hook, `/api/health` (a new runtime endpoint) | Optional error-tracking DSN |
| M0.7 Review controls | Not started | `REPO_SETTINGS.md`, `RELEASE_HANDOFF.md` | Apply branch protection and the `production` environment on GitHub (needs the repository) |
| M0.8 Catalog and risk engine | Not started | CI tooling only | — |
| M0.9 AI reviewer | Not started | Sends diffs to an external API | A CI secret for the API key; approval of the data flow |
| **Phase 0 acceptance** | Not met | See below | Restore drill; PB-4 tabletop |

**Open P1-or-higher items that Phase 0 acceptance requires closed or risk-accepted (OBSERVED in `docs/DECISIONS.md`):**
- DEC-2026-001 (P0 triage, rotation);
- DEC-2026-003 / F1;
- DEC-2026-004 / F3;
- DEC-2026-005 / F4;
- DEC-2026-008 / F9 (P1 provisional);
- **DEC-2026-024 (P1, the payment/fulfilment defect).**

---

## 3. Path 1: M0 completion before M1

**Definition:** no M1 implementation starts until Phase 0 acceptance is met (rule 5 applied as written), or until the subset the owner names in DEC-026 is met.

**What has to happen first:**
1. **Decisions:**
   - DEC-022 (M0.3 scope);
   - DEC-023 (migration origin + `db:push` guard);
   - DEC-018 (an L3 approver, or the doc 13 §2.2 one-person compensating controls).
2. **Human actions:**
   - DEC-001 rotation;
   - create the GitHub repository and push;
   - apply the M0.7 settings;
   - storage audit;
   - restore drill and tabletop.
3. **Open P1s:**
   - **F3 and F4.** Under DEC-022 Position B they are scheduled in Phase 1 (doc 12 M1.2/M1.3). So M0 can only turn green if **APPROVED, dated risk-acceptance DECs** exist for them. That is the doc 12 acceptance route.
   - **DEC-024.** Its fix (I-1…I-3) depends on DEC-029, and I-4 on DEC-028. Both are M1 topics. So M0 either fixes I-1…I-3 inside M0 (an L3 payment-adjacent change), or records an APPROVED risk acceptance. "Live payments OFF" is the existing interim control.
4. **G1 restore drill:** needs an isolated restore target and confirmed PITR or backup. That depends on DEC-027 (environments) and a VERIFY item (PITR is unverified, M1 plan §29).

**Consequences:**
- **Security:** F1 and F2 (and F4, if chosen) are closed or risk-accepted before any feature work. This matches "security before feature".
- **Delivery:** M1.1 waits on items that are not engineering work:
  - rotation;
  - GitHub setup;
  - roles;
  - drills;
  - environment choice.
  The critical path is human actions, not code.
- **Quality:** M1 foundations are built on a reviewed baseline harness, policy lineage (M0.4) and an admin-contract snapshot (an M0.3 test). They can then be measured against a stable reference.
- **Rework risk:** low.

## 4. Path 2: M1 foundational work in parallel with the remaining M0

**Definition:** DEC-026 records a **dated waiver of rule 5** for named M0 items, so that selected M1 work proceeds while those items are still open.

**What does not change under this path:**
- DEC-023 (G-DB) still gates **every** migration. M1.1's foundations (`platform_config`, `feature_flags`, unified audit, the `domain_events` outbox) are migrations.
- DEC-018 (G-L3) still gates every RLS, definer function or grant. The audit and flag foundations add definer functions and grants, so they are L3.
- DEC-001 (§2A) still gates implementation unless that row is also waived.
- G-PAY, G-ORG and G2 are unchanged. Live payments stay OFF.

**What does change:**
- M1 work that needs only DEC-023 + DEC-018 + the waiver can begin before M0.3–M0.9 finish.
- M0 and M1 run as concurrent L3 streams.

**Consequences:**
- **Security:**
  - The F1, F2 and F4 windows stay open while new surfaces are added.
  - New definer functions are written before the M0.4 policy clean-up and before `lint-definer` exists.
  - Requires a dated risk acceptance (doc 12 Phase 0 acceptance clause 2).
- **Process:**
  - More concurrent L3 reviews on what the risk register calls a one-person team (MR-9).
  - Each still needs a named approver, or the doc 13 §2.2 compensating controls.
- **Ordering hazards** (derived from the plans):
  - The unified-audit generalization sits next to frozen `admin_*` functions, so the admin-contract snapshot (an M0.3 test) should exist before it.
  - New tables follow the policy patterns that M0.4 is meant to clean up.
- **Delivery:** visible M1 progress sooner. The non-engineering M0 items (rotation, GitHub, drills) no longer sit on the M1 critical path.

## 5. Side by side

| Aspect | Path 1: M0 first | Path 2: parallel |
|---|---|---|
| doc 12 rule 5 | Followed | Waived for named items (DEC-026, dated) |
| Decisions needed before any M1 code | DEC-026, DEC-022, DEC-023, DEC-018, risk acceptances for F3/F4/DEC-024 (or fixes), DEC-001 done | DEC-026 (with waiver), DEC-023, DEC-018; DEC-001 §2A done or waived |
| First M1 migration | After M0.3/M0.4 migrations | Possibly before M0.3/M0.4 (same 020+ numbering space, so ordering must be planned) |
| Security windows (F1/F2/F4) | Closed or risk-accepted first | Open during M1 foundation work |
| L3 review load | Sequential | Concurrent |
| Blocked by human-only actions | Yes: rotation, GitHub, drills, roles | Partly: roles and DEC-023 still needed |
| Production behaviour | Unchanged until a human applies migrations | Unchanged until a human applies migrations |
| Live payments | OFF | OFF |
| Rework risk | Lower | Higher (foundations precede the policy clean-up and contract snapshots) |

---

## 6. M1 work that is genuinely safe in parallel

**Criteria. Every one must hold:**
1. repository-only;
2. no migration file;
3. no RLS, auth, payment or definer-function change;
4. no edit to a doc 12 §2 frozen file;
5. no change to the public Tap bundle;
6. no deployment;
7. no production or Razorpay access;
8. no secret;
9. no new external data flow;
10. undone by `git revert`;
11. level L0–L1.

Even safe items still need **your authorization of the phase**. The current instruction is "no implementation".

### 6.1 Safe now: needs only phase authorization

| # | Work | Why it is safe | Condition |
|---|---|---|---|
| S-1 | Interface definitions (`PaymentProvider`, `FulfilmentStep`, `NotificationProvider`, `AuditWriter`) as types and documentation not imported by runtime code | No runtime path changes | Frozen `netlify/lib/*` untouched; the bundle gate unchanged |
| S-2 | Razorpay **test-mode** fixtures for tests | Test-only | Fake identifiers only; gitleaks passes; no `rzp_live_` |
| S-3 | `rzp_live_` CI guard (fails if the prefix appears outside fixtures) | CI tooling; protective | CODEOWNERS for `scripts/ci/` |
| S-4 | Author `scripts/reconcile-razorpay.mjs` (doc 12 §4.6: read-only, run by a human) | Authoring touches nothing | **Running it is a human action against production.** Claude Code never runs it |
| S-5 | Import-boundary lint for the public Tap entry | CI tooling; protects the 90 kB cap | Must not change the measured bundle |
| S-6 | Static `lint-definer` for SQL files | Reads files only | Whether it **gates** CI needs a decision: it would flag O-1 on the baseline, and gates are never weakened |
| S-7 | Documentation: glossary, contracts, ADRs, runbooks | Text only | — |

### 6.2 Safe once DEC-2026-023 is approved (tooling and tests; no runtime change)

| # | Work | Condition |
|---|---|---|
| C-1 | Database suites on the baseline + the `db:push` guard (S1 or S2) | This is M0.2's "Then" step. It may surface real findings (for example F1 on live), which are recorded, never weakened |
| C-2 | Golden `/t/<slug>` test from the baseline (doc 12 rule 4) | Test-only |
| C-3 | Admin-contract snapshot test (`admin_*` return shapes; doc 12 M0.3) | Test-only |
| C-4 | Reproduction tests for I-1…I-4 on the baseline | They **fail** until DEC-024 is fixed. Needs an explicit decision on whether they gate CI, because a red gate would block all merges |
| C-5 | Regenerate `src/lib/database.types.ts` from the baseline | Touches app source. Safe only if the built output is byte-identical; otherwise it is a code change (L1) |

### 6.3 Not parallel-safe under either path (each needs its own decision and L3 approval)

| Work | Gate |
|---|---|
| Any migration: flags, audit, outbox, support, notifications | DEC-023, DEC-018, database-change authorization |
| Identity enforcement (helper, normalisation trigger, contract enforcement) | DEC-029, DEC-024 |
| Card lifecycle, routing, `/d/:code`, `tap_routes` | DEC-028, DEC-002, DEC-022, OQ-2b |
| Persona fields | DEC-032 + migration |
| Notification provider adapters | DEC-031 (new data processors) |
| OS dashboard | DEC-030 |
| Organisations | DEC-025, G3, OQ-9 |
| DEC-024 fix | DEC-024 (+ 023/029/028), payments L3 |
| New runtime endpoints (`/api/health`, `resolve`, `otp`) | Runtime change; deployment-visible |
| M0.9 AI reviewer | External data flow; a human-provisioned CI secret |

---

## 7. Unchanged whichever path is chosen
- No production access by Claude Code.
- No migration is applied anywhere except local PGlite.
- `db:push` is never run against production.
- **Live payments stay OFF.** Razorpay test mode only; no `rzp_live_`.
- `/t/:slug`, checkout, payment verification, auth and the admin RPC model stay frozen.
- No table or column is renamed or dropped.
- No new Supabase project is created (DEC-027 governs any exception).
