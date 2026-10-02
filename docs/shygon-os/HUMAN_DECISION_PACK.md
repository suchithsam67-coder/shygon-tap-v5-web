# SHYGON OS: Human Decision Pack

| | |
|---|---|
| Date | 2026-10-02 |
| Repository | `feat/m0-governance-ci` @ `008992d` (local only; no remote) |
| Purpose | Turn the 13 open decisions into concrete, approvable choices |
| Sources | The decision records in `docs/governance/decisions/`; `docs/DECISIONS.md`; the approved pack (docs 00–14); `M1_*.md`; `docs/governance/SCHEMA_DRIFT_REPORT.md`; the live baseline `supabase/baseline/000_live_baseline.sql`; repository code |
| Companions | `IDENTITY_DECISION_SUMMARY.md` · `CARD_LIFECYCLE_DECISION_SUMMARY.md` · `PHASE_GATE_DECISION_SUMMARY.md` |
| Status | **As written on 2026-10-02 (`b627070`): nothing approved and no winner selected.** **Update 2026-10-02:** the repository owner then approved DEC-2026-018, 022, 023, 024 (I-1…I-3) and 029, and waived the DEC-2026-001 §2A gate for M0.3 only (see §16–§17). The other decisions remain unapproved. The options are those written in the records, plus, where a record has no file (DEC-2026-018), those written in the approved documents. |
| Evidence labels | **OBSERVED** · **CONFIRMED** (reproduced in isolated PGlite) · **STATIC** (read from source, not executed) · **VERIFY ON LIVE** |

**How to read each decision.**
- **Option A** and **Option B** are the first two options in the record.
- **Other** appears only when the record itself names more options.
- **Sub-decisions** are listed when the record says they are needed under every option.
- "Advisory recommendation" marks text that is quoted from a record. It is not an approval.

---

## 1. Index

| Decision | Question (short) | Accountable role (all UNASSIGNED) | Priority | State | Needed before |
|---|---|---|---|---|---|
| DEC-2026-002 | Does a card stop working 14 days after activation? | Product Owner | P1 (→ P0 if paying customers' cards auto-suspend) | PROPOSED | Card lifecycle work |
| DEC-2026-018 | Who holds each governance role? | Founder / Product Owner | P1 (launch gate) | **APPROVED (B), 2026-10-02** | Any L3 approval; G2 |
| DEC-2026-022 | What does M0.3 contain? | UNASSIGNED (Founder names the A) | P1 | **APPROVED (Position A), 2026-10-02**; Q2/Q3 OPEN | M0.3 |
| DEC-2026-023 | Migration origin + `db:push` safeguard | Data Owner | P1 | **APPROVED (A + S1), 2026-10-02** | **Any new migration** |
| DEC-2026-024 | Fix for V5 paths that fail on the live schema (P1 paid-claim defect) | Security Owner | P1 (→ P0 on trigger) | **APPROVED (A, I-1…I-3), 2026-10-02**; I-4 OPEN | **Live payments** |
| DEC-2026-025 | When are organisations built? | Product Owner | P1 | PROPOSED | Any organisation table |
| DEC-2026-026 | M1 sequence + the "M0 green before M1" rule | Product Owner | P1 | PROPOSED | **Start of M1.1** |
| DEC-2026-027 | Staging / Control environments vs "no new Supabase project" | Principal Architect | P1 | PROPOSED | M1.11–M1.13; G2; the G1 restore drill |
| DEC-2026-028 | Canonical card states and status column | Product Owner | P1 | PROPOSED | Card lifecycle; routing |
| DEC-2026-029 | Identity key contract (U vs C) | Security Owner | P1 | **APPROVED (A), 2026-10-02** | Identity work; any module that writes `customer_id` |
| DEC-2026-030 | What is the "OS dashboard"? | Product Owner | P2 | PROPOSED | OS dashboard milestone |
| DEC-2026-031 | Email provider, WhatsApp, push timing | Principal Architect | P2 | PROPOSED | Email / WhatsApp adapters |
| DEC-2026-032 | Vertical taxonomy as data | Principal Architect | P2 | PROPOSED | Persona abstraction |

**Cross-cutting facts that apply to every decision below:**
- **No role holder is named** (DEC-2026-018). Until it is decided, the repository owner has approved decisions directly (DEC-2026-020, DEC-2026-021), and each of those records still awaits re-confirmation by a named role holder.
- **doc 12 §2A, first row, gates "any work at all" on DEC-2026-001 rotation being completed.** Without it, only M0.0/M0.1 (repo-only) are allowed. Rotation is **NOT DONE**. Approving any decision below does not lift this row; only an explicit owner waiver or the completed rotation does.
- **Live payments are OFF.** No decision below enables them (G-PAY is separate).

---

## 2. Corrections and new observations since the decision gate report (`008992d`)

Found while preparing this pack, by re-reading the live baseline. **Nothing was changed in any system.** The gate report has been corrected in place where it was wrong, and each corrected line says so.

| ID | Type | Finding | Evidence | Affects |
|---|---|---|---|---|
| E-1 | **Correction** | `admin_update_card` does **not** accept any string. It rejects any `p_status` outside `pending, shipped, active, suspended, replaced`. The `cards.status` column itself still has no CHECK (O-4 holds at column level). | baseline lines 1864–1866 (OBSERVED) | DEC-028; gate report C2 |
| E-2 | **Correction** | There are **four** writers of `status='active'`, not three: OTP, printed code, delivery auto-activation, **and admin manual `admin_update_card(p_status='active')`**. The admin path sets no expiry and no `activated_at`. | lines 1855–1891 (OBSERVED) | DEC-002, DEC-028; gate report C4 |
| E-3 | New (STATIC) | Live `fulfil_order()` inserts card rows **without `card_id`**, which is `NOT NULL` with no default and no trigger that sets it. For card items it would fail with `23502`. DEC-024 offers "adopt live `fulfil_order()`" as one I-4 direction, so that direction also needs `card_id` handling. **Not executed.** | lines 2577–2579, 3206, triggers 4851/4859 | DEC-024 (I-4) |
| O-7 | New observation, for Security Owner triage | **An owner can reverse any card suspension.** `customer_activate_card` (code only) and `card_apply_verified_action` (OTP) activate from any state except `replaced`. That includes cards an admin suspended (cancelled order, manual), expired cards and cards under a replacement request. This is the same class as F1 (a customer undoing an admin action), at device level. | lines 2163–2175, 2372–2374 (OBSERVED) | DEC-022, DEC-028, DEC-002 |
| O-8 | New observation (product / legal) | The published Terms (`src/pages/legal/Terms.tsx:98–99`) say a deactivated card's Tap "stops opening until it is reactivated or replaced". The resolver the web app uses (`get_public_profile`) never reads card state (F3). | OBSERVED | DEC-022 (F3), DEC-028 |
| O-9 | New observation | `expire_tap_cards()` has one in-database caller: the legacy `get_public_tap`. TEST_REPORT.md records that function erroring on live and unused. Whether a cron job runs the sweeper is UNKNOWN, because the dump excludes `cron`. **So whether the 14-day expiry ever takes effect on live is unknown.** | line 2803; TEST_REPORT.md | DEC-002 |
| O-10 | New observation (STATIC) | No current code path writes `cards.customer_id`, `cards.tap_profile_id` or `tap_profiles.card_id`. `get_card_tap_history` joins on `cards.tap_profile_id`, so it returns nothing for cards without it. VERIFY ON LIVE how many rows have it. | lines 2686; repository search | DEC-028, DEC-029 |
| O-11 | New observation | Live `orders` has `email_status` (default `not_configured`), `email_sent_at` and `email_provider_id`. No repository code references them. | lines 3752–3754; repository search | DEC-031 |

**P0 check (doc 12 §0 rule 13; doc 13 §5).** None of E-1…O-11 meets a P0 entry criterion:
- O-7 changes only the owner's own card state, which today has no public effect (F3).
- No secret is involved.
- No data is exposed.
- There is no cross-tenant access.

O-7 is reported here for the Security Owner to classify. F1, the analogous finding, is P1 "→ P0 if exploited on live".

---

## 3. DEC-2026-002: Should a card stop working 14 days after activation? (OQ-1)

**Decision.** Should card activation expire after 14 days, as live `customer_activate_card` and `card_apply_verified_action` do today? If yes, how is expiry represented and renewed?

**Why it matters.**
- It is physical-card-visible behaviour, which doc 13 §3.3 treats as irreversible.
- doc 12 §2A gates the lifecycle milestone on it.
- It fixes what EXPIRED means in DEC-028 (Q3), what the future `/d/` resolver shows, and part of the F3 semantics in DEC-022.

**Option A: activation never expires** (the card works until suspended or replaced).
| Aspect | Detail |
|---|---|
| Definition | Activation has no time limit. The record notes this matches the "buy once" promise (V5_COMPLETE.md). |
| Consequences | The sweeper `expire_tap_cards()` has nothing to do. "Renew activation" in `Cards.tsx` loses its purpose. Existing `activation_expires_at` values need a Data Owner decision: ignore or clear. |
| Affected V5 components | `customer_activate_card`, `card_apply_verified_action` (both set +14 days); `expire_tap_cards()`; `Cards.tsx` ("Active until", "Renew activation"); `card-otp.mjs` copy; the legacy `get_public_tap` expiry check |
| Affected SHYGON OS components | The proposed `device_transition()` has no expiry edge; the `/d/` resolver has no expired branch; no renewal notifications |
| Migration implications | Changes live function bodies, so it is a `020+` migration on the DEC-023 origin, L3 (definer functions). `card_apply_verified_action` is on the doc 12 §2 freeze list (signature frozen; body changes need an approved milestone). Clearing stored expiries would be a data change (Data Owner, L3). |
| Security implications | No new exposure. Removes the silent dead-card path. F3, O-3 and O-7 are unchanged. |

**Option B: keep a 14-day activation window with renewal.**
| Aspect | Detail |
|---|---|
| Definition | Keep the live +14-day rule and build renewal UX, notifications and support. |
| Consequences | The record warns of a "risk of silently dead cards" once card state gates resolution (`/d/`, or OQ-2b on `/t/`). Needs DEC-028 Q3 (distinct `expired` or reuse `suspended`). The population is mixed: delivery and admin activations (P-3, P-4) set **no** expiry, and **no record covers them** (see `CARD_LIFECYCLE_DECISION_SUMMARY.md` §2, §11). The sweeper's schedule must be established (O-9). |
| Affected V5 components | The same two functions keep their behaviour; `admin_update_order_status` (no-expiry activation); `Cards.tsx` renewal; `Terms.tsx` copy (O-8) |
| Affected SHYGON OS components | An expiry edge in `device_transition()`; a scheduled sweeper; renewal notification templates (security category); the expired branch in the `/d/` resolver; support playbooks |
| Migration implications | Possibly a new `expired` state (DEC-028); scheduling is a platform object (cron, VERIFY ON LIVE); L3 |
| Security implications | Renewal reuses the activation paths, which carry F4 (unverified phone) and O-3 (readable code). Renewal notifications must carry no private data (DEC-031 rules). |

**Other: Option C, expiry as a paid-plan feature** (named in the record).
| Aspect | Detail |
|---|---|
| Definition | Personal cards do not expire. Expiry belongs to device kinds or plans (for example, event badges expire when the event ends). |
| Consequences | Personal cards behave as in Option A. Expiry needs device kinds, which do not exist yet (doc 08 `device_kind`; proposed card milestone). |
| Affected V5 components | As in Option A for today's cards |
| Affected SHYGON OS components | Device-kind and plan rules; event products (later phase) |
| Migration implications | Device-kind columns arrive with the lifecycle milestone, later |
| Security implications | As in Option A for personal cards |

**Current evidence.**
- OBSERVED: +14 days in two paths; no expiry in two paths (E-2); expired cards become `suspended`.
- The sweeper's only in-database caller is unused and errors on live (O-9).
- `/t/<slug>` is unaffected by card state (F3).
- The Terms copy promises card gating (O-8).
- `docs/DECISIONS.md`: "CONFIRMED on live 2026-09-30".
- HYPOTHESIZED in the record: the rule was conflated with the 14-day *edit* interval.
- The record's interim rule: keep live behaviour; doc 12 §0 rule 11.

**Dependencies.** None must be decided first. Consulted: Data, Security and Principal Architect. Decide together with DEC-028 Q3. A named Product Owner comes from DEC-018.

**Blocks.**
- DEC-028 Q3;
- card lifecycle implementation;
- the expired branch of the `/d/` resolver;
- DEC-022 question 2 (F3 semantics);
- indirectly, the I-4 card model in DEC-024.

**Human approval**
- Decision:
- Approved by:
- Date:

---

## 4. DEC-2026-018: Who holds each canonical governance role? (OQ-16)

*No record file exists. This is an index row in `docs/DECISIONS.md`. The options below are the two set out in the approved doc 13 §2.2 and OQ-16 (doc 11). There is no "Other".*

**Decision.** Name the holder of Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner, and the primary and secondary Incident Lead. Give the GitHub mapping for `.github/CODEOWNERS`. Say whether an external L3 reviewer exists.

**Why it matters.**
- Every other record names an UNASSIGNED Accountable Owner.
- doc 13 §3.2 makes migrations, RLS, definer functions, auth and payment files L3, which needs a named specialist approval.
- doc 12 §2A and doc 13 §2.3 make the complete roster a **production launch gate**.

**Option A: separately named holders, per the doc 13 §2.2 table.**
| Aspect | Detail |
|---|---|
| Definition | Each role has a named person. The Security Owner is independent of the author for L3 (a security-trained engineer or an external retained reviewer). The two Incident Leads are different people. The Data Owner has production SQL and PITR knowledge. |
| Consequences | L3 changes get independent human review. CODEOWNERS becomes enforceable (M0.7). The roster condition of G2 can be met. |
| Affected V5 components | None at runtime. `.github/CODEOWNERS`, `docs/governance/ROLE_ROSTER.md` |
| Affected SHYGON OS components | Every L3 milestone; the kill-switch authorization matrix (doc 13 §7.2); later `ops.role_assignments` |
| Migration implications | None directly. It enables L3 sign-off for every migration. |
| Security implications | Separation of duties for RLS, auth and payments |

**Option B: one human, named explicitly, with compensating controls (doc 13 §2.2).**
| Aspect | Detail |
|---|---|
| Definition | One person holds several roles, and the record says so. L3 changes get an external retained reviewer, or at minimum a 24-hour cool-off plus the checklist review. A Claude non-author review is **advisory, never an approval**. The secondary Incident Lead is a trusted, trained person with pre-authorized containment rights only (K1, K5, K11). |
| Consequences | Honest about the lack of independence. Slower L3 throughput (cool-off). Risk MR-9 is only partly mitigated. |
| Affected V5 components | None at runtime. CODEOWNERS maps several roles to the same handle. |
| Affected SHYGON OS components | As in Option A |
| Migration implications | None directly |
| Security implications | Weaker independence, offset by the cool-off and an external reviewer |

**Current evidence.**
- `ROLE_ROSTER.md`: every role UNASSIGNED.
- CODEOWNERS uses `@role-*` placeholders.
- DEC-020 and DEC-021 were approved by the repository owner, with re-confirmation pending.
- doc 13 §2.2: "If SHYGON has only one human, name the reality explicitly rather than pretend there is independence."

**Dependencies.** None.

**Blocks.**
- A valid approver for every L3 change (G-L3): any migration, RLS, auth or payment change;
- a named Accountable Owner on all 12 other decisions (unless the Founder approves each directly);
- CODEOWNERS enforcement (M0.7);
- the kill-switch matrix;
- the G2 launch gate.

**Human approval**
- Decision: **APPROVED: Option B, the one-person control model** (doc 13 §2.2). The repository owner holds the roles. No external reviewer is named, so L3 changes get a 24-hour cool-off plus a checklist review. The secondary Incident Lead is still UNASSIGNED. Record: `docs/governance/decisions/DEC-2026-018_role-holders.md`
- Approved by: repository owner, in session
- Date: 2026-10-02

---

## 5. DEC-2026-022: What does milestone M0.3 contain?

**Decision.** Which findings does M0.3 remediate (F1 un-suspend, F2 admin notes, F3 card state vs public Tap, F4 OTP to an unverified phone), and in what form? The record also requires answers to five questions:
1. which findings are in;
2. if F3 is in: is doc 12 §0 rule 4 amended, and what does `/t/<slug>` return when one of several cards is lost, suspended, deactivated or expired;
3. if F4 is in: is it interim or the start of the verified-contact model, and what is the trusted factor for users with no verified phone;
4. where F2 goes;
5. whether doc 12 §3 is amended.

**Why it matters.**
- It sets how long the P1 findings F1, F3 and F4 (and the P2 F2) stay open.
- Under Position A it may change what printed cards show (irreversible, doc 13 §3.3).
- M0 cannot finish without it, and under rule 5 neither can M1 start.

**Option A: Position A, M0.3 = F1 + F3 + F4 (F2 to the backlog).** From the owner's M0.2→M0.3 specification.
| Aspect | Detail |
|---|---|
| Definition | Remediate F1. Verify F3, then implement only an approved minimal fix (no full `/d/`, `tap_routes`). Verify F4, then design a secure factor-binding strategy. F2 goes to the security backlog. |
| Consequences | Three P1 findings are addressed early. A minimal F3 fix on the legacy path changes `/t/<slug>` output, which conflicts with rule 4 unless that rule is amended. Gating the slug for one lost card also disables the user's other cards and QR links (doc 01 C2). An interim F4 design may be replaced later. F2 waits. M0.3 takes longer. |
| Affected V5 components | F1 guards on `profiles` / `tap_profiles`; `get_public_profile` and `/t/` (frozen); `card-otp.mjs`, `profiles.phone`; possibly the `Terms.tsx` copy (O-8) |
| Affected SHYGON OS components | Pulls resolver or contact concepts forward, or introduces interim designs (record); shifts the M1 sequence (DEC-026) |
| Migration implications | `020+` migrations for the F1 guards, F3 gating and F4 binding, on the DEC-023 origin; all L3 |
| Security implications | F1, F3 and F4 close sooner. F2 (customers can read admin notes; P2 → P1 once real orders carry notes) stays open. O-3 and O-7 sit naturally with F4/F3. |

**Option B: Position B, M0.3 = F1 + F2 (approved doc 12 §3; the audit).**
| Aspect | Detail |
|---|---|
| Definition | F1 guard triggers (migration `020`) and the admin-notes table (migration `021`, adopting `supabase/proposed/011…` with the `admin_get_order` JSON shape kept). F3 is fixed at `/d/:code` in the resolver milestone; F4 by the full verified-contact model. |
| Consequences | Matches the approved plan and keeps `/t/<slug>` byte-compatible. F3 and F4 (both P1) stay open until Phase 1. Printed `/t/` cards keep resolving when a card is suspended. **Phase 0 acceptance then needs APPROVED, dated risk-acceptance DECs for F3 and F4** (`PHASE_GATE_DECISION_SUMMARY.md` §3). |
| Affected V5 components | F1 guards; `orders.admin_note` → admin-notes table; `admin_get_order` (shape kept); `verify-011` suite into CI |
| Affected SHYGON OS components | F3 in the routing milestone and F4 in the identity milestone (proposed M1.5 / M1.2) |
| Migration implications | `020` + `021` (doc 12 numbering) on the DEC-023 origin; L3 |
| Security implications | F3 and F4 windows remain, with O-3 and O-7 alongside them. Highest reversibility. |

**Other (named in the record).** Combinations are possible, for example Position B plus an interim documented control for F3/F4. The record states that any such variant is the Accountable Owner's to define, and that Claude Code does not propose one.

**Current evidence.**
- The record's source table: owner specification vs doc 12 §3 vs the audit.
- doc 12 §0 rule 4 (golden `/t/`).
- doc 01 C2 (one URL for all of a user's cards).
- doc 12 §2A (RLS = L3; lifecycle waits for DEC-002).
- doc 13 §3.3.
- New: O-3 (OTP bypass through the readable code), O-7 (owner can undo a suspension), O-8 (Terms vs F3).

**Dependencies.**
- DEC-023 (where M0.3 migrations live and are tested);
- DEC-018 (L3 reviewer);
- DEC-002 (only if F3 is included).

The record's other blocker, the M0.2 baseline, is now available.

**Blocks.**
- M0.3, and so Phase 0 acceptance;
- under rule 5, the start of M1 (DEC-026);
- remediation of F1, F2, F3 and F4.

Until decided, F1, F3 and F4 are verify-only.

**Human approval**
- Decision: **APPROVED: Position A (F1 + F3 + F4; F2 to the backlog).** Doc 12 §3 is amended (deviation D-1). **Q2 (F3 semantics) and Q3 (F4 trusted factor) are still OPEN**, so F3 is verify-only and F4 verify + design only until they are answered.
- Approved by: repository owner, in session
- Date: 2026-10-02

---

## 6. DEC-2026-023: Migration origin after M0.2, and the `db:push` safeguard

**Decision.**
1. Does new database work start from the live baseline or from the repository chain?
2. How is `npm run db:push`, which re-applies every historical migration to a real project, kept away from production?

**Why it matters.**
- Every future migration and every database test depends on the answer.
- Today the security suites certify a schema that is not production.
- One command could break sign-up in production.

**Option A: the live baseline is the origin** (doc 12 M0.2 "Then"; recommended by doc 12).
| Aspect | Detail |
|---|---|
| Definition | Local and CI databases are built from `000_live_baseline.sql` plus the platform shim. New migrations start at `020_`. 001–019 stay as history, marked "applied on live, never re-run". The suites move to the baseline. |
| Consequences | Tests target production's real shape. Suites will report real findings (some fail at first: expected, reported, never weakened). The baseline must be re-captured after any out-of-pipeline live change. About one milestone of tooling. |
| Affected V5 components | `supabase/tests/apply.mjs`, `verify.mjs`, `rls-adversarial.mjs`, `verify-011`; `supabase/migrations/README.md`; `apply-remote.mjs` (safeguard) |
| Affected SHYGON OS components | Every module's migrations; the schema-drift tool becomes a CI check |
| Migration implications | Fixes the origin for all `020+` work. No production change. |
| Security implications | Positive: RLS and grants are tested as they exist in production |

**Option B: keep the repository chain and add a reconciliation migration.**
| Aspect | Detail |
|---|---|
| Definition | `020_reconcile_live.sql` makes the chain reproduce live exactly. Proven when `schema-drift.mjs` reports zero differences. |
| Consequences | Keeps one linear history. The migration hand-encodes the live-only legacy layer: 5 tables, 74 columns, 11 functions, 32 column conflicts and 16 differing functions. It is larger and easier to get wrong. |
| Affected V5 components | As in Option A, plus the reconciliation file itself |
| Affected SHYGON OS components | As in Option A |
| Migration implications | The reconciliation migration **must never run on live** ("a no-op at best and destructive at worst"), so it needs its own guard |
| Security implications | Positive once proven. Risk of mis-encoding live RLS or grants. |

**Other: Option C, status quo** (named in the record as "not viable": every new migration would be tested against a schema that is not production).

**Sub-decision required under every option: the `db:push` safeguard** (record).
- **S1:** `apply-remote.mjs` refuses unless the project ref is on a non-production allowlist, or an explicit `--i-know-this-is-not-production` flag is passed. L1 tooling.
- **S2:** remove `db:push` until the approved pipeline exists.
- **S3:** documentation only. The record calls this weak.

**Current evidence (CONFIRMED in isolation, drift report).**
- The baseline rebuilds (492 of 493 entries apply; the exception is benign).
- Repo vs live: 25 vs 30 tables, 284 vs 358 columns, 83 vs 93 functions.
- Replaying 001–019 onto live changes **48 objects**, and sign-up then fails with `23503`.

**Dependencies.** DEC-018 (Data Owner, with Security consulted).

**Blocks.**
- **Every new migration** (G-DB), including M0.3, M0.4, the DEC-024 fix and all M1 database work;
- the M0.2 "Then" step;
- moving the suites to the baseline;
- golden and contract tests on the real schema.

Until decided, no new migrations are written, and `db:push` must not be run against production.

**Human approval**
- Decision (origin): **APPROVED: Option A** (the live baseline is the origin; 001–019 are history, never re-run)
- Safeguard (S1 / S2 / S3): **S1** (allowlist guard on `db:push`)
- Approved by: repository owner, in session
- Date: 2026-10-02

---

## 7. DEC-2026-024: Live-schema runtime incompatibilities (P1 paid-order claim defect)

**Decision.** How are the V5 paths that fail on the live schema made correct without breaking frozen V5 contracts? This covers I-1 (paid-claim trigger), I-2 (profile save), I-3 (fulfilment safety net), I-4 (card records) and I-5 (pgcrypto location).

**Why it matters.**
- Financial integrity: on live, a first-time buyer is charged, but the order claim fails (I-1).
- Profile saves fail for live users (I-2).
- Paid card orders get no card row (I-4).
- **Live payments must stay OFF until this is fixed.**
- **Escalate to P0 immediately if** any of these happen:
  - live keys are enabled first;
  - the mismatch count is ever above 0;
  - the "Failed to claim fulfilment … tap_profiles_customer_id_fkey" log appears.

**Option A: database-side `customer_id` resolution** (record: "the smallest change that leaves the frozen V5 surfaces intact", an advisory note).
| Aspect | Detail |
|---|---|
| Definition | `provision_tap_on_payment()` looks up, or creates, `customers.id` for `NEW.user_id`. A BEFORE INSERT/UPDATE trigger on `profiles` and `tap_profiles` maps a `customer_id` equal to the auth user id onto `customers.id`. |
| Consequences | Fixes I-1, I-2 and I-3 at once. The frozen V5 code is untouched. It is implicit behaviour (a trigger rewriting a client-supplied column), so it must be documented and covered by adversarial tests. |
| Affected V5 components | Trigger `trg_orders_provision_tap` / `provision_tap_on_payment` (on the freeze list: body change only by approved milestone); `profiles`, `tap_profiles`. Code unchanged: `fulfilment.mjs`, `Settings.tsx`, `Checkout.tsx`. |
| Affected SHYGON OS components | The identity contract (DEC-029 enforcement references this trigger); `customer_id` contract tests |
| Migration implications | A `020+` migration on the DEC-023 origin; rollback SQL restores the previous function and trigger; L3 |
| Security implications | RLS-adjacent. Adversarial tests must show that a client cannot use the mapping to bind to another customer. |

**Option B: code-side lookup.**
| Aspect | Detail |
|---|---|
| Definition | The app and `fulfilment.mjs` read `customers.id` before writing. |
| Consequences | Explicit. Edits frozen payment code, which doc 12 §2 allows only as a bug fix with tests. The browser cannot read `customers` (`customers_api_none`), so a new RPC is needed. **Gap in the record (STATIC reading):** I-1 originates in a database trigger. Code-side lookup fixes I-2 and I-3; it fixes I-1 only if the code creates the persona with the correct C *before* the claim (the trigger then skips on `ON CONFLICT (user_id)`), or if the trigger also changes. The record does not say which. |
| Affected V5 components | `netlify/lib/fulfilment.mjs` (frozen, L3), `verify-payment.mjs` / `razorpay-webhook.mjs` (callers), `Settings.tsx`, `Checkout.tsx`, a new RPC |
| Affected SHYGON OS components | Identity helpers called from code |
| Migration implications | A migration for the new RPC (and for the trigger, if changed); DEC-023 origin; L3 |
| Security implications | Payment-file change (L3). The RPC must resolve C from `auth.uid()` only, never from client input. |

**Other (named in the record).**
- **Option C: make `customers.id` equal the user id.** Backfill existing rows; `handle_new_user` inserts `id = NEW.id`.
  - Consequences: removes the mismatch at its source.
  - Affected V5: `customers`, `handle_new_user`, and the FKs from `profiles`, `tap_profiles`, `cards` and `customer_customizations`.
  - Migration: a data migration across those FKs. A destructive class of change (Data Owner, L3) that needs a backup and a restore drill first.
  - Security: no new exposure, but **"poor" reversibility without PITR**, irreversible in practice.
- **Option D: relax or drop the `customer_id` foreign keys.** The record does not recommend it: "it weakens integrity to hide the defect".

**Sub-decision required: I-4 card records** (record). Either:
- **(i)** the conflict target becomes `(order_id, sku, card_slot)` and `card_id` gets a generator; or
- **(ii)** V5 adopts live `fulfil_order()`.

Per E-3 (STATIC), `fulfil_order()` also omits the NOT NULL `card_id`, so direction (ii) needs `card_id` handling as well. This sub-decision depends on DEC-028 and DEC-002.

**Also required:** VERIFY ON LIVE where `pgcrypto` lives (I-5). If it is in `extensions`, every card insert fails. And confirm the trigger state (`ascii(tgenabled::text)` should be 79).

**Current evidence.**
- I-1…I-4 are CONFIRMED in an isolated rebuild of the baseline.
- Owner-run production counts (2026-10-02): mismatch **0**, retry **0**, **6** customers exposed, FK not deferrable.
- The trigger is enabled per the dump; the re-read value is ambiguous.
- See `IDENTITY_DECISION_SUMMARY.md` R-4 and R-13.

**Dependencies.**
- DEC-023 (where the fix migration lives);
- DEC-029 (the contract; the two are coupled);
- DEC-028 + DEC-002 (I-4);
- DEC-018 (Security Owner);
- the VERIFY items above.

**Blocks.**
- **Live payments** (G-PAY);
- profile saves for live users;
- card-record creation;
- identity enforcement;
- the payment/fulfilment abstraction milestone's fix scope.

**Human approval**
- Decision (I-1…I-3): **APPROVED: Option A** (database-side `customer_id` resolution). Recorded from "the documented … fix direction"; the owner should confirm A was meant. **Live payments remain OFF and NOT AUTHORIZED.**
- Decision (I-4): **OPEN** (needs DEC-2026-028 + DEC-2026-002)
- Approved by: repository owner, in session
- Date: 2026-10-02

---

## 8. DEC-2026-025: When are organisations, members and organisation roles built?

**Decision.** Keep the approved deferral of organisations to Phase 2, or override it.

**Why it matters.**
- It introduces a new isolation boundary (T13 cross-tenant, rated critical in doc 07).
- It brings tenant data and minors' data (DPDP).
- Once organisation data exists, the tenancy model is costly to change.

**Option A: keep the deferral (approved plan).**
| Aspect | Detail |
|---|---|
| Definition | Design now (`M1_DOMAIN_MODEL.md` §5). Build in Phase 2 after G3 and OQ-9. M1 adds no `org_id` columns. |
| Consequences | Lowest risk. Organisation verticals (schools, companies, venues) wait. |
| Affected V5 components | None |
| Affected SHYGON OS components | The organisation design stays on paper; tenant RBAC is not built; the organisation console (DEC-030 D) waits |
| Migration implications | None in M1 |
| Security implications | No new tenant boundary in M1 |

**Option B: schema-forward only.**
| Aspect | Detail |
|---|---|
| Definition | M1 adds the nullable `org_id` columns doc 12 already lists (personas, devices), with no FK and no organisation tables. The tables come in Phase 2. |
| Consequences | Small change. Keeps the later migration simple. The columns **must not hold data** until G3. |
| Affected V5 components | `tap_profiles`, `cards` (additive nullable columns). `get_public_profile` output must stay byte-identical. |
| Affected SHYGON OS components | Persona and device milestones |
| Migration implications | Additive `020+` columns (DEC-023); L3 under doc 13 §3.2 |
| Security implications | Unused columns; no boundary until Phase 2 |

**Other: Option C, override and build organisations in M1** (named in the record).
| Aspect | Detail |
|---|---|
| Definition | Organisation tables, memberships, roles and an organisation console in M1 |
| Consequences | Requires waiving G3 and OQ-9 for organisation data, or holding no real organisation data until they are met. The largest scope and risk. |
| Affected V5 components | `cards` ownership (`owner_org_id`), `tap_profiles`, orders and entitlements billing (`subject_kind`, doc 03 §3.5); `admin_users` must never be reused for organisation admins |
| Affected SHYGON OS components | `organizations`, `memberships`, `org_role_permissions`, consent ledger, tenancy isolation matrix in CI, cross-tenant canary |
| Migration implications | New tables plus RLS; L3 |
| Security implications | T13 cross-tenant isolation; DPDP minors' data; a counsel gate |

**Current evidence.**
- doc 12 §4.7: "Organization: none in Phase 1".
- doc 13 §12 G3: no student or organisation data before G3.
- doc 10 §4: not in the first phase.
- OQ-9: counsel before minors' data.
- The owner brief: "DO NOT create organization tables automatically".

**Dependencies.** DEC-2026-017 (OQ-9 counsel); G3; DEC-018. Option B also needs DEC-023.

**Blocks.**
- Organisation tables;
- tenant RBAC;
- organisation verticals;
- the organisation console (DEC-030 D);
- whether the persona milestone adds `org_id`.

**Human approval**
- Decision:
- Approved by:
- Date:

---

## 9. DEC-2026-026: M1 milestone sequence, and the "M0 green before M1" rule

**Decision.**
- Which milestone plan governs SHYGON OS Phase 1?
- Must M0 (at least M0.3–M0.7) finish before M1.1, or which items are waived with a dated risk acceptance?

**Why it matters.**
- The brief's M1.1–M1.13 reuse doc 12's IDs with different content.
- The order decides whether modules are built before the audit, events and flags they need.
- doc 12 §0 rule 5 puts security before features.

**Option A: adopt `M1_ARCHITECTURE_PLAN.md` §35, with M0 completed first** (record: "Recommended by Claude Code (advisory)").
| Aspect | Detail |
|---|---|
| Definition | M1.0a covers M0.3–M0.7 (M0.8 and M0.9 may follow in parallel). Then foundations (audit / events / flags) → identity → cards → persona → routing → notifications → analytics → support → payment abstraction → app shell → detection / DR → integration → gate. The doc 12 mapping is kept, and deviations are recorded (doc 12 §5 item 5). |
| Consequences | Security fixes first, and dependencies in build order. M1 waits on the human-only M0 items (`PHASE_GATE_DECISION_SUMMARY.md` §3). |
| Affected V5 components | None directly. Sets when frozen surfaces are touched. |
| Affected SHYGON OS components | All M1 milestones, renumbered per §35 |
| Migration implications | M0.3/M0.4 migrations come before the M1 foundations |
| Security implications | F1/F2 (and F4 if chosen) closed or risk-accepted before features |

**Option B: adopt the owner brief's order as written.**
| Aspect | Detail |
|---|---|
| Definition | Identity, cards, profiles, audit (M1.4), analytics, notifications, support, routing, payment abstraction, OS dashboard, security hardening (M1.11), integration, gate |
| Consequences | The record: "Accepts that modules are built before the audit and event foundations they need, and that security hardening comes late" |
| Affected V5 components | Same frozen surfaces, touched earlier |
| Affected SHYGON OS components | Modules built before audit and events; audit retrofitted later |
| Migration implications | Retrofitting audit and events into earlier modules means more migrations |
| Security implications | Hardening late; open findings persist longer |

**Other: Option C, keep doc 12 Phase 1 as written** (M1.1 device … M1.13 pipeline, M1.9 last), adding support and abstractions as extra milestones (named in the record).
| Aspect | Detail |
|---|---|
| Definition | The approved doc 12 order, unchanged, with additions |
| Consequences | No deviation record is needed for order. The brief's extra domains are appended. |
| Affected V5 components | As per doc 12 |
| Affected SHYGON OS components | Device layer first (M1.1); unified audit at M1.7, flags at M1.10 |
| Migration implications | As doc 12 |
| Security implications | Follows doc 12, where verified contacts (F4) come at M1.3 |

**Sub-decision required under every option** (record): does M0.3–M0.7 finish before M1.1, or which items are waived, with what dated risk acceptance? See `PHASE_GATE_DECISION_SUMMARY.md` for both paths and the list of work that is genuinely parallel-safe.

**Current evidence.**
- The numbering collision (record).
- Rule 5.
- M0.3–M0.9 not started; M0.3 blocked by DEC-022.
- Phase 0 acceptance needs open P1 findings closed or risk-accepted (F1, F3, F4, F9, DEC-024, DEC-001).

**Dependencies.**
- DEC-022 (what M0.3 contains);
- in practice DEC-023 (no milestone with migrations can start without it);
- DEC-2026-001 (doc 12 §2A "any work at all" row).

**Blocks.**
- **The start of M1.1**;
- milestone numbering in all later PRs, commits and decision records.

**Human approval**
- Decision (sequence):
- Decision (M0 completion / waivers):
- Approved by:
- Date:

---

## 10. DEC-2026-027: Staging and Control environments vs "no additional Supabase project"

**Decision.** Where do staging and the SHYGON Control plane run, given the owner's constraint "Do not create another Supabase project"?

**Why it matters.**
- doc 12 §4.10 requires a separate staging project.
- doc 13 §10.1 / doc 14 §2 require a separate Control project.
- Drills, canaries, the M1.13 pipeline and **the G1 restore drill (Phase 0 acceptance)** all need a real environment.

**Option A: no new projects.**
| Aspect | Detail |
|---|---|
| Definition | Staging = local PGlite on the live baseline + Netlify deploy previews against local or mock backends. Control stays repository- and CI-based (O0/O1) with external paging. |
| Consequences | Integration and drill tests (K1–K8, the restore drill) cannot run against a real Supabase. **G2 evidence is weaker** (record). |
| Affected V5 components | None |
| Affected SHYGON OS components | M1.13 pipeline (no staging hop); kill-switch drills; restore drill |
| Migration implications | Migrations are proven only on PGlite before production |
| Security implications | No production data copies. Weaker drill evidence. |

**Option B: Supabase branching** (preview branches of the existing project, if the plan supports it).
| Aspect | Detail |
|---|---|
| Definition | A real staging database as a branch of the same project. "Arguably not another project" (record). |
| Consequences | Real staging. Cost and plan support to be confirmed. |
| Affected V5 components | None |
| Affected SHYGON OS components | The pipeline gains a staging step |
| Migration implications | Migrations are rehearsed on a real branch before production |
| Security implications | Branch must hold no production data; access control on the branch |

**Other (named in the record).**
- **Option C, approved exception:** one staging project (test keys, no production data), plus the Control project at G3. This is the approved-document position. It costs money, and needs the owner to grant an exception to "no new project".
- **Option D, hybrid:** Option B for staging now; the Control project decided at G3.

**Current evidence.**
- doc 12 §4.10 and M1.13; doc 13 §10.1; doc 14 §2.
- The owner brief of 2026-10-02.
- PITR is unverified (M1 plan §29).

**Dependencies.** DEC-018; cost approval; confirmation of plan support (for B and D).

**Blocks.**
- M1.11–M1.13 pipeline design;
- kill-switch drills;
- **the restore drill required for G1 / Phase 0 acceptance**;
- G2 evidence;
- the Control plane.

**Human approval**
- Decision:
- Approved by:
- Date:

---

## 11. DEC-2026-028: Canonical card lifecycle states and the live dual status columns

**Decision.**
- What is the card state vocabulary, and which column is canonical?
- What do the brief's terms (ISSUED, ACTIVATED, EXPIRED) mean?

Full comparison: `CARD_LIFECYCLE_DECISION_SUMMARY.md`.

**Why it matters.**
- It fixes resolver semantics for printed and future cards (irreversible for shipped cards).
- The Admin APK reads `status` and `card_status`, so changes are APK contract changes.
- It is the basis for the `status` integrity constraint (O-4).

**Option A: doc 08 vocabulary in `status` (the `M1_DOMAIN_MODEL.md` §4 proposal; advisory).**
| Aspect | Detail |
|---|---|
| Definition | `status` is canonical, with doc 08's set (`unassigned, pending, shipped, active, suspended, lost, transfer_pending, replaced, retired`). ISSUED = `pending`/`shipped`. ACTIVATED is the transition into `active` (recorded in `activated_at`). A CHECK on `status` is added NOT VALID, then validated after a human read-only count. `device_transition()` becomes the only writer. |
| Consequences | Today's ten writers (`CARD_LIFECYCLE_DECISION_SUMMARY.md` §3) are re-pointed to one function. The values already in use (`pending, shipped, active, suspended, replaced`) remain valid. `lost`, `transfer_pending` and `retired` are new values for `status`. |
| Affected V5 components | `cards`; `customer_activate_card`, `customer_deactivate_card`, `card_apply_verified_action`, `request_card_replacement`, `expire_tap_cards`, `admin_update_card`, `admin_update_order_status`, `admin_cancel_order`; `Cards.tsx`; `card-otp.mjs`; the Admin APK |
| Affected SHYGON OS components | `device_transition()`; the `/d/` resolver; audit and `domain_events`; notifications; routing |
| Migration implications | CHECK constraint, a new function and function re-pointing: `020+`, L3, with a VERIFY ON LIVE count of distinct `status` values before VALIDATE |
| Security implications | Closes O-4. A single writer can enforce A3 step-up and legal edges, addressing O-3 and O-7 when combined with DEC-022 F4. |

**Option B: brief terms stored literally** (`issued`, `activated`, …).
| Aspect | Detail |
|---|---|
| Definition | The stored values follow the owner brief: UNASSIGNED, ISSUED, ACTIVATED, ACTIVE, SUSPENDED, LOST, REPLACED, RETIRED. ACTIVATED is a stored state. |
| Consequences | Stored values differ from the values the live functions, V5 code and APK use today (`pending`, `shipped`, `active`, …), so existing rows and every writer and reader need mapping. ACTIVATED vs ACTIVE needs a defined distinction. |
| Affected V5 components | As in Option A, plus a data mapping of existing rows |
| Affected SHYGON OS components | As in Option A |
| Migration implications | A data migration of existing `status` values (Data Owner, L3), plus the CHECK |
| Security implications | As in Option A. A bigger change to the Admin APK contract. |

**Sub-decisions required (record, "Options to decide").**
- **Q2: legacy `card_status`.** Frozen (never written by new code), or one-way mapped from `status` by trigger. Today only `request_card_replacement` writes it.
- **Q3: EXPIRED.** A distinct state, reuse `suspended`, or remove expiry. Decided with DEC-002.
- **Q4: `transfer_pending`.** In M1, or later.
- **Not covered by any record:** whether delivery auto-activation (P-3) and admin manual activation (P-4) remain, and whether they set an expiry. The Product Owner may extend this record. Claude Code does not propose an answer.

**Current evidence.**
- Two columns on live (`status` with no CHECK; legacy `card_status` with CHECK).
- E-1 (`admin_update_card` validates five values); E-2 (four activation writers).
- Nothing but admin manual writes `replaced`.
- Expiry writes `suspended`.
- Card state does not gate `/t/` (F3); O-7.

**Dependencies.**
- DEC-002 (Q3);
- OQ-2 (DEC-2026-015, chip family) and OQ-2b (legacy multi-card gating);
- DEC-022 (F3).

**Blocks.**
- Card lifecycle implementation;
- the `status` CHECK;
- `device_transition()`;
- routing and `/d/:code`;
- DEC-024 I-4;
- any Admin APK contract change.

**Human approval**
- Decision (vocabulary):
- Q2 / Q3 / Q4:
- Approved by:
- Date:

---

## 12. DEC-2026-029: Identity key contract (`auth.users.id` vs `customers.id`)

**Decision.** What is the binding identity-key contract every new SHYGON OS module must follow? Full map: `IDENTITY_DECISION_SUMMARY.md`.

**Why it matters.**
- Every module depends on it.
- New modules risk repeating the U-into-C bug behind DEC-024.
- Changing the key after data exists is costly.

**Option A: adopt rules B1–B7 as binding** (advisory recommendation in the record).
| Aspect | Detail |
|---|---|
| Definition | B1: authorize by U. B2: C is resolved server-side and never accepted from a client. B3: new person-owned tables carry U (C only if commercially needed). B4: `orders.customer_id` (= U) is legacy and never joined to `customers`. B5: a device is not an identity. B6: a tap is not authentication. B7: the three suspension levels are distinct. Enforced by contract tests, a review checklist and (with DEC-024 Option A) a normalisation trigger. |
| Consequences | Matches every live policy (0 policies use C). New code needs a server-side U→C helper wherever it writes C. |
| Affected V5 components | None changed by the contract itself. It explains the existing writes in `Settings.tsx`, `Checkout.tsx`, `fulfilment.mjs` and `provision_tap_on_payment` as violations to fix under DEC-024. |
| Affected SHYGON OS components | Every module; RLS patterns; contract tests; `get_my_identity`-style RPCs (proposal) |
| Migration implications | A helper function and contract tests; possibly the DEC-024 A trigger; `020+`, L3 |
| Security implications | Ownership checks stay on the auth identity. Client-supplied C is rejected. |

**Option B: U is the only key; deprecate C for new work.**
| Aspect | Detail |
|---|---|
| Definition | New work uses U only. The legacy C columns remain and must still be filled correctly. |
| Consequences | Simpler for new modules. Legacy writes still need the DEC-024 fix. |
| Affected V5 components | As in Option A |
| Affected SHYGON OS components | New tables never carry C |
| Migration implications | As in Option A for the legacy columns |
| Security implications | As in Option A |

**Other: Option C, make C the authorization key** (named in the record; "Not recommended").
| Aspect | Detail |
|---|---|
| Definition | RLS authorizes by `customers.id` |
| Consequences | Every RLS policy changes (18 + 3 owner policies). Clients would need C, but `customers` is API-denied today. |
| Affected V5 components | All owner policies; every customer RPC (all key on `auth.uid()`) |
| Affected SHYGON OS components | All modules |
| Migration implications | Rewrite of every policy and RPC; L3 |
| Security implications | Highest risk of authorization regressions |

**Current evidence.**
- U authorizes everywhere; C is random; `orders.customer_id` holds U.
- `tap_profiles.user_id` is nullable while it authorizes (VERIFY ON LIVE).
- O-10 (link columns never written).
- `database.types.ts` is stale.

**Dependencies.** Coupled with DEC-024: DEC-029's enforcement refers to DEC-024 Option A, and DEC-024's fix must follow DEC-029's rule. Deciding them together avoids inconsistency.

**Blocks.**
- Identity enforcement (helper, normalisation, contract tests);
- every new module that writes `customer_id`;
- G-ID, and so the identity, card and persona milestones.

**Human approval**
- Decision: **APPROVED: Option A** (rules B1–B7 binding): "do not interchange auth user ID and customer record ID; use the correct key at each boundary"
- Approved by: repository owner, in session
- Date: 2026-10-02

---

## 13. DEC-2026-030: What is the "OS dashboard" (brief M1.10)?

**Decision.** Which dashboard the brief's undefined "M1.10 OS dashboard" means.

**Why it matters.** It cannot be built while undefined, and three of the four candidates are outside Phase 1 or need their own gates.

**Option A: customer app shell `/app/*`** (doc 12 M1.8).
| Aspect | Detail |
|---|---|
| Definition | Devices, Privacy and Security pages; no visual redesign; `/shygontap/*` keeps working. In scope for Phase 1. |
| Consequences | Fits M1 (record's advisory note). Needs data from the identity, card, persona and notification work. |
| Affected V5 components | `/shygontap/*` (kept, redirects later); shared UI primitives (only when touched) |
| Affected SHYGON OS components | `src/apps/customer/` (lazy bundle) |
| Migration implications | None of its own |
| Security implications | Authenticated pages only. Must not enter the public Tap bundle (90 kB gate). |

**Option B: operator Command Center** (doc 13 §10.5, doc 14 §3.1).
| Aspect | Detail |
|---|---|
| Definition | The internal operations console |
| Consequences | On doc 10 §4's do-not-build list until G3/O3. Before then, doc 14 O1 provides a weekly generated ops digest instead. |
| Affected V5 components | None |
| Affected SHYGON OS components | `ops` schema; the Control plane (DEC-027) |
| Migration implications | `ops` schema later |
| Security implications | A privileged internal surface |

**Other (named in the record).**
- **C, a web admin** replacing or complementing the Admin APK (OQ-13). The recommendation there is to keep the APK. It affects the admin RPC surface (frozen `admin_*` contracts) and admin MFA.
- **D, an organisation console** `/org/*`. Phase 2+, tied to DEC-2026-025.

**Current evidence.** The four candidates as listed in the record. "OS dashboard" appears only in the owner brief.

**Dependencies.**
- DEC-025 (for D);
- G3/O3 (for B);
- OQ-13 (for C).

**Blocks.** The OS dashboard milestone.

**Human approval**
- Decision:
- Approved by:
- Date:

---

## 14. DEC-2026-031: Notification providers, including WhatsApp

**Decision.** The record asks three questions:
1. the email provider (OQ-8);
2. whether WhatsApp is a SHYGON OS channel, and via which provider;
3. when push arrives.

**Why it matters.**
- Each provider is a new data processor (DPDP).
- WhatsApp needs business onboarding and has a cost per conversation.
- The adapters cannot be built without the choice.

**Rules for every option (record):**
- adapters sit behind `NotificationProvider`;
- message bodies carry no private data;
- security categories are locked on;
- there is a cost circuit-breaker.

**Sub-decision 1, email.** The record names three options.
| Aspect | Option A: Amazon SES (OQ-8 recommends ap-south-1) | Option B: Resend | Other: C, another provider |
|---|---|---|---|
| Definition | SES adapter | Resend adapter | Owner-named provider |
| Consequences | A new processor; region choice per OQ-8 | A new processor | A new processor |
| Affected V5 components | None today. No email code exists. Live `orders` has unused `email_status`, `email_sent_at`, `email_provider_id` (O-11). | Same | Same |
| Affected SHYGON OS components | The notification outbox and deliveries; the email adapter | Same | Same |
| Migration implications | Delivery tables come with the notification milestone (DEC-023) | Same | Same |
| Security implications | Domain authentication; no private data in bodies | Same | Same |

**Sub-decision 2, WhatsApp.**
| Aspect | Option A: defer | Option B: adopt via a provider |
|---|---|---|
| Definition | A later milestone. The interface is ready but there is no adapter. | Via a provider such as Twilio (already integrated for SMS) or MSG91 WhatsApp. Opted-in security and transactional categories only. |
| Consequences | In-app + SMS only for now | Needs the WhatsApp Business Platform: approved templates, user opt-in, business verification, per-conversation cost and a data processor agreement |
| Affected V5 components | None | `netlify/lib/sms.mjs` provider patterns (MSG91 / Twilio) |
| Affected SHYGON OS components | None now | WhatsApp adapter; opt-in records; templates |
| Migration implications | None | Opt-in and preference storage with the notification milestone |
| Security implications | None | A new processor. Template content must carry no private data. Opt-in evidence. |

**Sub-decision 3, push timing.** The record asks the question but lists **no options**. doc 06 places push in Phase 5. Admin push (Expo tokens) already exists.

**Current evidence.**
- In-app notifications (realtime), SMS (MSG91/Twilio, DLT templates) and admin push exist.
- No email and no WhatsApp exist.
- O-11.

**Dependencies.**
- DEC-018 (processor approval; Data Owner consulted on DPDP);
- OQ-8;
- cost approval;
- external WhatsApp Business onboarding (for B).

**Blocks.**
- The email and WhatsApp adapters;
- the provider part of the notification milestone.

The interface and the in-app/SMS outbox can proceed without it (doc 12 §2A, M1.5 row).

**Human approval**
- Email:
- WhatsApp:
- Push timing:
- Approved by:
- Date:

---

## 15. DEC-2026-032: Vertical taxonomy as data

**Decision.** How are the brief's verticals (students, schools, colleges, companies, restaurants, hotels, clinics, retail, professionals, creators, events, institutions) represented, without redesigning the core for each one?

**Why it matters.**
- Extensibility: whether a new vertical needs a migration.
- Analytics grouping.
- The shape of the persona `context` / `category` fields.

**Option A: coarse CHECK enums + a seeded `category` vocabulary held as data** (advisory recommendation in the record).
| Aspect | Detail |
|---|---|
| Definition | `context` per doc 03 (`professional, student, business, event, member, guest, other`), with `creator` added. Businesses use `context='business'` with a `category` from a seeded vocabulary held as data. Organisation kinds are treated the same way in Phase 2. |
| Consequences | New verticals need no migration |
| Affected V5 components | `tap_profiles` (new additive columns). `get_public_profile` output must stay byte-identical (rule 4). |
| Affected SHYGON OS components | Persona abstraction; analytics grouping; later `organizations.kind` |
| Migration implications | Additive columns + CHECK on `context` + seed data; `020+` (DEC-023) |
| Security implications | Minimal. The seed vocabulary is not user-controlled. |

**Option B: a reference table** `vertical_categories(code, kind, label, active)` with an FK.
| Aspect | Detail |
|---|---|
| Definition | Categories live in a table; personas reference it by FK |
| Consequences | Stronger integrity. Adding a vertical is an INSERT. |
| Affected V5 components | As in Option A |
| Affected SHYGON OS components | As in Option A, plus the reference table |
| Migration implications | A new table + FK + seed; `020+` |
| Security implications | The new table needs RLS (read access; admin-only writes) |

**Other: Option C, CHECK enums only** (doc 03 literal; named in the record). Every new vertical needs a migration. Affects the same components. The CHECK changes per vertical.

**Current evidence.**
- doc 03 §1: no per-vertical tables.
- doc 03 CHECK enums for `context` and `organizations.kind`.
- The brief adds creator, restaurant, clinic, retail, service provider, college, institution, enterprise and community.

**Dependencies.** None. DEC-025 governs only the organisation-kind part.

**Blocks.** The persona abstraction (`context` / `category`).

**Human approval**
- Decision:
- Approved by:
- Date:

---

## 16. Approval record (2026-10-02)

Recorded by Claude Code from the repository owner's instruction in session.

**What is recorded:**
- **DEC-2026-001 (not in the checklist below):** the doc 12 §2A rotation gate is waived for M0.3 only. Rotation is still NOT DONE and the record stays OPEN.
- **Production data modification: NOT AUTHORIZED.**
- "Database / RLS / payment changes authorized" means repository files and local PGlite only. Applying a migration to production remains a human action, after the 24-hour cool-off (DEC-2026-018), and after rotation or a written extension of the DEC-2026-001 waiver.
- **Auth changes and M1.1 were not authorized** in the instruction, so they are recorded as NO.

**Owner confirmation requested:** DEC-2026-024 was recorded as Option A, from "the documented … fix direction". The scope is in `M0_3_IMPLEMENTATION_SCOPE.md`.

## 17. Approval Checklist

```text
DEC-2026-002:  __________________
DEC-2026-018:  APPROVED — Option B (one-person control model; 24 h cool-off + checklist for L3)
DEC-2026-022:  APPROVED — Position A (F1 + F3 + F4; F2 to backlog); Q2 and Q3 OPEN
DEC-2026-023:  APPROVED — Option A (live baseline is the origin) + S1 (db:push allowlist guard)
DEC-2026-024:  APPROVED — Option A for I-1…I-3 (to be confirmed); I-4 OPEN; live payments OFF
DEC-2026-025:  __________________
DEC-2026-026:  __________________
DEC-2026-027:  __________________
DEC-2026-028:  __________________
DEC-2026-029:  APPROVED — Option A (identity contract B1–B7)
DEC-2026-030:  __________________
DEC-2026-031:  __________________
DEC-2026-032:  __________________
```

```text
IMPLEMENTATION AUTHORIZATION:

M1.1 authorized: NO

Database changes authorized: YES

RLS changes authorized: YES

Auth changes authorized: NO

Payment changes authorized: YES (test mode only; live activation NOT AUTHORIZED)

Live payments authorized: NO

Production deployment authorized: NO
```
