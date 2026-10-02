# SHYGON OS — M1 Decision Gate Report

| | |
|---|---|
| Date | 2026-10-02 |
| Repository | `feat/m0-governance-ci` @ `972e04c` (local only; no remote) |
| Inputs | `M1_ARCHITECTURE_PLAN.md` and its 5 companions; `docs/governance/SCHEMA_DRIFT_REPORT.md`; DEC-2026-002, -018, -022 … -032; approved pack 01–14; live baseline `supabase/baseline/000_live_baseline.sql` |
| Status | **Decision-review gate. Nothing is implemented. No decision is resolved by this report.** |
| Labels | **OBSERVED** (baseline, code), **CONFIRMED** (isolated reproduction), **DECISION REQUIRED** |

---

## 1. Decision register

| Decision | Question | Affected components | Dependency | If approved | If rejected / deferred | Blocks |
|---|---|---|---|---|---|---|
| **DEC-2026-002** (OPEN, Product Owner) | Should a card stop working 14 days after activation? | `cards` activation columns; `expire_tap_cards()`; `customer_activate_card`; `card_apply_verified_action`; resolver semantics | Card-path findings in §3 (three activation paths, two with expiry) | The expiry rule becomes explicit: either keep it (a distinct `expired` state or `suspended`) or remove it (the sweeper becomes a no-op behind config) | Live behaviour continues: OTP and printed-code activations expire after 14 days; delivery auto-activations never expire (§3, C4) | Card lifecycle; routing semantics |
| **DEC-2026-018** (OPEN, Founder) | Who holds each governance role (Security, Data, Product, Architect, Release, QA, Engineering, Incident Leads)? *No separate record file exists; index row only.* | every L3 approval; CODEOWNERS; kill-switch matrix; G2 | — | Named owners can approve L3 changes; CODEOWNERS becomes real | Every RLS, auth, payment or migration change has no valid approver; the repository owner approves ad hoc (as so far) | All L3 work; G2 launch gate |
| **DEC-2026-022** (OPEN, UNASSIGNED) | M0.3 scope: F1+F3+F4 (owner spec) or F1+F2, with F3/F4 deferred (doc 12) | `profiles`/`tap_profiles` guards (F1); `orders.admin_note` (F2); resolver (F3); OTP / contacts (F4) | DEC-023 (tests on the baseline); DEC-018 (L3 approver) | M0.3 can start with a fixed scope | F1/F2/F4 risk stays open; M0 can't complete | M0.3 → the M0 gate → M1 (per DEC-026) |
| **DEC-2026-023** (OPEN, Data Owner) | Origin for new database work (live baseline vs repo chain) + `db:push` safeguard | every migration; `db:apply`/`verify`/`rls-adversarial`; `apply-remote.mjs` | DEC-018 | Option A: the baseline is the origin; suites move to the baseline; `db:push` is guarded (S1/S2) | No migration can safely be written; `db:push` stays one command away from reverting 48 live objects and breaking sign-up | **Every migration** (all of M0.3 onward) |
| **DEC-2026-024** (OPEN, Security Owner, **P1**) | How to fix V5 paths that fail on the live schema (`customer_id`; card records) | `provision_tap_on_payment` (trigger); `fulfilment.mjs` claim, `issueCards`, safety net; `Settings.tsx`, `Checkout.tsx` | DEC-023 (where the fix migration lives); DEC-029 (contract); DEC-028 (for I-4) | The chosen option (A–D) is implemented as an L3 change with tests | **Live payments must stay OFF**; 6 customers stay exposed; profile save stays broken for new users | Live payments (G-PAY); identity work |
| **DEC-2026-025** (PROPOSED, Product Owner) | When are organisations, members and organisation roles built? | future `organizations`, `memberships`, `org_role_permissions`; `org_id` columns | G3; OQ-9; DEC-018 | A: deferred (documents stand). B: nullable `org_id` columns only. C: override and build now (waives G3/OQ-9) | The approved plan applies (Phase 2 after G3) | Organisation build; tenant RBAC; organisation verticals |
| **DEC-2026-026** (PROPOSED, Product Owner) | Which M1 sequence governs, and must M0.3–M0.7 finish first? | milestone plan; M0.3–M0.7 | DEC-022 (M0.3) | Plan §35 (or another option) becomes binding; deviations from doc 12 are recorded | doc 12 Phase 1 (M1.1 = device layer) plus rule 5 stay binding | **Start of M1.1** |
| **DEC-2026-027** (PROPOSED, Principal Architect) | Staging and Control environments vs "no new Supabase project" | staging, M1.13 pipeline, kill-switch drills, restore drill, SHYGON Control | DEC-018; cost | A (local only), B (branching), C (exception) or D (hybrid) | Staging stays local-only; G2 drill evidence is weaker | M1.11–M1.13; G2 |
| **DEC-2026-028** (PROPOSED, Product Owner) | Canonical card states; `status` vs `card_status`; ACTIVATED/ISSUED/EXPIRED | `cards`; 9 live functions that write `status` (§3); `Cards.tsx`; `card-otp.mjs`; Admin APK | DEC-002; OQ-2/2b; DEC-022 (F3) | `device_transition()` and the `status` CHECK can be designed concretely | Lifecycle stays undefined; `status` stays unconstrained at column level (no CHECK). *Corrected 2026-10-02: `admin_update_card` itself accepts only 5 values; see `HUMAN_DECISION_PACK.md` §2 E-1* | Card lifecycle; routing; the I-4 fix |
| **DEC-2026-029** (PROPOSED, Security Owner) | Binding identity key contract (U vs C) | every new module; RLS patterns; contract tests | DEC-024 (the current breakage) | Rules B1–B7 are binding; adapters per §2.4 | New modules risk repeating the U-into-C bug | Identity mapping; every module that writes `customer_id` |
| **DEC-2026-030** (PROPOSED, Product Owner) | What is the "OS dashboard"? | `/app` shell, or the Command Center, web admin, or organisation console | DEC-025 (for the organisation console); G3 (for the Command Center) | A defined target milestone | Not buildable: undefined | OS dashboard |
| **DEC-2026-031** (PROPOSED, Principal Architect) | Email provider (OQ-8); WhatsApp channel; push timing | `NotificationProvider` adapters; DPDP processor list | DEC-018; cost; WhatsApp Business onboarding | Adapters can be built per the chosen providers | In-app + SMS only; the interface is ready, no new adapters | Email/WhatsApp notifications |
| **DEC-2026-032** (PROPOSED, Principal Architect) | Vertical taxonomy as data, or schema per vertical | `tap_profiles.context`/`category`; future `organizations.kind` | — | Verticals become seed data | doc 03 CHECK enums apply literally; each new vertical needs a migration | Persona abstraction (category) |

---

## 2. Special analysis 1: Identity

### 2.1 The chain, exactly as it exists on live (OBSERVED)

```text
auth.users.id (U)
   │  customers.user_id = U   (UNIQUE, NOT NULL, FK auth.users ON DELETE CASCADE)
   ▼
customers.id (C)              random UUID, set by live handle_new_user(); customers.customer_id = 'CUST-…'
   │  profiles.customer_id = C (NOT NULL, UNIQUE, FK customers ON DELETE CASCADE)
   │  profiles.id = U          (the PK is the auth user id)
   ▼
profiles (account) ─────────── tap_profiles (persona): customer_id = C (NOT NULL, UNIQUE, FK customers CASCADE)
                                                        user_id = U (NULLABLE, no FK on live)
                                                        card_id uuid (legacy, no FK)
   ▼
cards (device): user_id = U (nullable, no FK on live) · customer_id = C (nullable, FK customers SET NULL)
                tap_profile_id → tap_profiles (FK SET NULL) · card_id text (legacy code, UNIQUE)
   ▼
public resolver: get_public_profile(p_slug) → tap_profiles by lower(slug); tier and Pass looked up by tap_profiles.user_id (U)
                 (card state is never consulted, F3)
```

### 2.2 Every live table carrying these identifiers (OBSERVED, FK targets in brackets)

| Identifier | Tables |
|---|---|
| **U** (auth user id) | `customers.user_id` [auth.users] · `profiles.id` (PK) · `tap_profiles.user_id` (nullable) · `tap_profiles.suspended_by` [auth.users] · `cards.user_id` (nullable) · `orders.user_id` [auth.users] · **`orders.customer_id` [auth.users]** · `entitlements.user_id` [auth.users] · `notifications.user_id` [auth.users] · `account_events.user_id` [auth.users] · `support_tickets.user_id` [auth.users] · `support_messages.author_id` [auth.users] · `card_otp_challenges.user_id` [auth.users] · `admin_users.user_id` [auth.users] · `admin_audit_log.admin_id`, `admin_notifications.admin_id`, `admin_notification_reads.admin_id`, `admin_push_tokens.admin_id`, `inventory_movements.admin_id`, `admin_allowed_email_domains.added_by` [all auth.users] |
| **C** (customers.id) | `profiles.customer_id` [customers] · `tap_profiles.customer_id` [customers] · `cards.customer_id` [customers] · `customer_customizations.customer_id` [customers] |
| **P** (persona) | `cards.tap_profile_id` [tap_profiles] · `tap_events.tap_profile_id` [tap_profiles] · `customer_customizations.tap_profile_id` [tap_profiles] |
| **D** (device) | `card_otp_challenges.card_id` [cards] · `tap_profiles.card_id` (no FK) |

### 2.3 Functions, policies and code using these identifiers

**Live functions (OBSERVED):**
- Only `handle_new_user` (creates C) and `provision_tap_on_payment` (**writes `customer_id = U`, the defect**) write C.
- Admin readers of `customers`: `admin_dashboard`, `admin_get_customer`, `admin_list_customers`, `admin_set_customer_suspension`.
- `admin_get_order` strips `orders.customer_id` from its output and joins profiles by `orders.user_id`.
- All customer RPCs key on `auth.uid()` = U: `customer_activate_card`, `customer_deactivate_card`, `set_card_nickname`, `request_card_replacement`, `get_card_tap_history`, `get_tap_analytics`, `claim_tap_slug`, `tap_edit_state`.
- `card_apply_verified_action` keys on `cards.user_id = p_user_id` (U).
- The public resolver uses slug → `tap_profiles.user_id` (U) for tier and Pass.

**Live policies (OBSERVED):**
- 18 policies keyed on `user_id = auth.uid()` and 3 on `profiles.id = auth.uid()`.
- **0 policies key on `customer_id`.** C plays no part in authorization.
- 19 admin policies; 7 deny-all.

**Code (OBSERVED):**
- Reads filter by U (`services/*`: `.eq('user_id', userId)`; `account.tsx`: `.eq('id', user.id)`).
- **Writes of `customer_id`:**
  - `create-order.mjs:156` → `orders.customer_id = U`. **Correct on live**, because the FK points to `auth.users`.
  - `Settings.tsx:89`, `Checkout.tsx:333` → `profiles.customer_id = U`. **Wrong on live** (I-2).
  - `fulfilment.mjs:331` → `tap_profiles.customer_id = U`. **Wrong on live** (I-3).
  - The live trigger `provision_tap_on_payment` → `tap_profiles.customer_id = U`. **Wrong on live** (I-1).
- `src/lib/database.types.ts` types `profiles` and `tap_profiles` `customer_id` as nullable, which is stale against live (NOT NULL).

### 2.4 Where adapters may eventually be required (no schema change now; DECISION REQUIRED via DEC-029 / DEC-024)

| Need | Candidate mechanism | Notes |
|---|---|---|
| Resolve C from U for any write that needs C | definer helper `current_customer_id()` (or `customer_id_for(u)`); a BEFORE INSERT/UPDATE normalisation trigger on `profiles`/`tap_profiles` (DEC-024 Option A) | keeps frozen code unchanged |
| Client reads of the identity bundle | RPC `get_my_identity()` → `{user_id, customer_code, persona_id, …}` | `customers` is API-denied (`customers_api_none`); the client must never need C |
| Persona ↔ device linkage | `tap_routes` (M1.5); the legacy `tap_profiles.card_id` / `cards.tap_profile_id` stay readable | single routing source of truth |
| `orders.customer_id` (= U) | service-layer glossary + typed alias; never joined to `customers` | a naming hazard, documented only |
| `tap_profiles.user_id` nullable | VERIFY ON LIVE: are there rows with `user_id IS NULL`? (human, read-only count) | the resolver's tier lookup would degrade for such rows |
| TypeScript types | regenerate `database.types.ts` from the baseline (tooling, L1) | after DEC-023 |

---

## 3. Special analysis 2: Card lifecycle (conflict matrix; **no model chosen**)

### 3.1 States across sources

| State | doc 08 (approved) | Live schema | Live functions (writers / readers) | V5 code | M1 proposal (`M1_DOMAIN_MODEL` §4) | Owner brief |
|---|---|---|---|---|---|---|
| unassigned | ✔ | `card_status='inventory'` (legacy default); not a `status` value | — | — | `unassigned` | UNASSIGNED |
| pending | ✔ | `status` default `'pending'` | **writer:** `fulfil_order` insert; read by admin order functions | `fulfilment.mjs` inserts `'pending'` | `pending` = ISSUED | ISSUED |
| shipped | ✔ | — (free text) | **writer:** `admin_update_order_status` (order shipped / out for delivery) | not handled in `Cards.tsx` | `shipped` | (ISSUED) |
| *(activated)* | transition shipped→active (A3) | `activated_at`, `activation_count`, `last_activation_at` | — | — | transition, not a state | **ACTIVATED (state)** |
| active | ✔ | value | **writers:** `customer_activate_card`, `card_apply_verified_action` (+14 days), **`admin_update_order_status` on delivery (no expiry)**, `admin_update_card` | `Cards.tsx`, `card-otp.mjs` | `active` | ACTIVE |
| suspended | ✔ (reversible) | value; legacy `card_status='suspended'` | **writers:** `customer_deactivate_card`, `card_apply_verified_action`, **`expire_tap_cards` (expiry)**, `admin_cancel_order` (pending/shipped), **`request_card_replacement`** (also writes `card_status`) | `Cards.tsx` | `suspended` | SUSPENDED |
| lost | ✔ | — | — | — | `lost` | LOST |
| transfer_pending | ✔ | — | — | — | optional | — |
| replaced | ✔ terminal | value is read; legacy uses **`'replacement'`** | **only writer:** admin manual `admin_update_card` (validated list; *corrected 2026-10-02, E-1*); read by activate/deactivate/OTP | `Cards.tsx`, `card-otp.mjs` read it | `replaced` | REPLACED |
| retired | ✔ terminal | legacy `card_status='retired'` only | — | — | `retired` | RETIRED |
| expired | — | implicit: `activation_expires_at` + `suspended` | `expire_tap_cards` | — | DEC-002 | — |
| inventory / assigned | — | legacy `card_status` only | — | — | mapped / frozen | — |

### 3.2 Conflicts (DECISION REQUIRED: DEC-2026-028, DEC-2026-002)

| # | Conflict | Sources |
|---|---|---|
| C1 | **Two state columns.** `status` (V5, unconstrained, written by 9 live functions: 8 updates + the `fulfil_order` insert, plus the V5 `fulfilment.mjs` insert) vs `card_status` (legacy, CHECK, written only by `request_card_replacement`) | live schema |
| C2 | **`status` has no CHECK** at column level. *Corrected 2026-10-02 (E-1): `admin_update_card` rejects any `p_status` outside `pending, shipped, active, suspended, replaced`; it does not store any string.* | live |
| C3 | **ACTIVATED** is a state in the brief, but a transition in doc 08 and the M1 proposal | brief vs doc 08 |
| C4 | **Three activation paths with different semantics:** OTP (`card-otp` → `card_apply_verified_action`) and printed code (`customer_activate_card`) both set **+14-day expiry**; **delivery auto-activation** (`admin_update_order_status`) sets `active` with **no owner action, no OTP and no expiry**. doc 08 requires owner activation with A3. *Corrected 2026-10-02 (E-2): a fourth writer, admin manual `admin_update_card(p_status='active')`, also activates with no expiry and no owner action; see `CARD_LIFECYCLE_DECISION_SUMMARY.md` §2.* | live vs doc 08 |
| C5 | **Expiry conflated with suspension:** `expire_tap_cards` writes `suspended`. EXPIRED exists in none of doc 08, the brief or the schema. | live vs all |
| C6 | **A replacement request suspends instead of replacing:** `request_card_replacement` sets `suspended` (+ `card_status='suspended'`); nothing sets `replaced`, yet the UI and OTP check for it. | live vs doc 08 / code |
| C7 | **Vocabulary drift:** `replaced` (doc 08, V5) vs `replacement` (legacy CHECK); `inventory`/`assigned` vs `unassigned`/`pending` | live legacy vs doc 08 |
| C8 | **Lost and transfer** exist in doc 08 and the brief but have no schema, functions or UI | doc 08 vs live |
| C9 | **Card state does not affect resolution (F3).** Every lifecycle state is cosmetic for `/t/<slug>` today. | live resolver |
| C10 | **The fulfilment card insert fails on live** (I-4), so a paid card may never reach any state | DEC-024 |
| C11 | **The Admin APK** reads and writes `status` through `admin_update_card` / `admin_update_order_status`, so any vocabulary change is an APK contract change | admin RPCs |

---

## 4. Special analysis 3: Payment / fulfilment defect (DEC-2026-024; **not fixed**)

| Aspect | Detail |
|---|---|
| **Failure mechanism** (CONFIRMED, isolated) | Live sign-up creates `customers.id = C` (random). On the first paid order, the fulfilment claim (`UPDATE orders SET payment_status='paid'`, `fulfilment.mjs:93`) fires `trg_orders_provision_tap` → `provision_tap_on_payment()` → `INSERT tap_profiles(customer_id = NEW.user_id …)`. **`23503 tap_profiles_customer_id_fkey`** (FK not deferrable; no exception handler) → the claim UPDATE aborts → `fulfilOrder` throws "Failed to claim fulfilment" **before** the `retry` marker. By then the payment has been **captured** at Razorpay and recorded in `payments`. |
| **Affected objects** | `orders` (trigger `trg_orders_provision_tap`); `provision_tap_on_payment()`; `tap_profiles_customer_id_fkey`; `customers`; `netlify/lib/fulfilment.mjs` (claim; `issueCards` I-4; safety net I-3); `verify-payment.mjs`, `razorpay-webhook.mjs` (callers); `Settings.tsx` / `Checkout.tsx` (I-2) |
| **Current production exposure** (owner-run counts, 2026-10-02) | paid-but-unpaid mismatch **0** · retry **0** · customers without a Tap profile and C ≠ U **6** · FK deferrable **false** · trigger enabled per the dump (re-read showed "0", which needs the `ascii()` confirmation). **No occurrence; latent.** Public evidence suggests test mode (deployed bundle key `rzp_test_`); the server key is unverified (`/api/payment-mode` is missing from the deployment). |
| **Why live payments must stay OFF** | 1. any of the 6 exposed customers, or any new sign-up, paying for a first order would be **charged with the order not completing**; 2. card records are never created for paid card orders (I-4), so there's no activation and no edition number; 3. G-PAY prerequisites are unmet (DEC-024, DEC-001 rotation, K5, G2). |
| **Remediation options** (from DEC-024; not chosen) | **A** DB-side `customer_id` resolution (trigger looks up or creates C; normalisation trigger on `profiles`/`tap_profiles`); frozen code untouched · **B** code-side lookup (edits frozen payment code; needs an RPC because `customers` is API-denied) · **C** make C = U (data migration across FKs; destructive class) · **D** relax the FKs (not recommended). I-4 separately: conflict target `(order_id, sku, card_slot)` + a `card_id` generator, or adopt live `fulfil_order()`. Depends on DEC-028. |
| **Dependencies** | DEC-023 (migration origin and test harness) · DEC-029 (contract) · DEC-028 + DEC-002 (I-4) · DEC-018 (L3 approver) · VERIFY the pgcrypto location (the activation-code trigger) |
| **Tests required** (fail before / pass after) | 1. the isolated probes from M0.2 as regression tests on the baseline: first-time-buyer claim, profile save, safety net, card upsert, sign-up; 2. `customer_id` contract tests (a client sending U is rejected or normalised); 3. `test:payments:ci` unchanged; 4. golden `/t/` unchanged; 5. admin-contract snapshot unchanged; 6. post-fix production verification by a human: mismatch count = 0, a test-mode order end to end, then G-PAY's controlled live ₹1 order + refund (doc 13 PB-4). |

---

## 5. Special analysis 4: Migration strategy

### 5.1 Comparison

| Source | What it is | Can it produce production? | Notes |
|---|---|---|---|
| Repository migrations 001–019 | 18 files, applied on top of `supabase/tests/baseline.sql` (a hand-written stand-in for the pre-001 tables) | **No.** It is missing 5 tables, 74 columns and 11 functions, and has 32 conflicting columns and 16 conflicting functions | Every migration *was* applied to live, but live diverged afterwards; **replaying them onto live is destructive** (48 objects changed; sign-up breaks) |
| Live baseline | `pg_dump --schema-only --schema=public`, 2026-09-30 | **Yes** for `public` (rebuilds cleanly with the platform shim) | Lacks auth/storage/extensions/cron/publication; stale if live is edited outside a pipeline |
| DEC-2026-023 | Proposal: baseline as the origin (A) or a reconciliation migration (B); `db:push` safeguard S1/S2/S3 | — | OPEN |
| Test infrastructure | `apply.mjs`, `verify.mjs` (23), `rls-adversarial.mjs` (48), `verify-011` (16): **hard-wired to `supabase/migrations` + `tests/baseline.sql`**; `schema-drift.mjs` + `live-platform-shim.sql` already load the baseline | — | The security suites currently certify a schema that isn't production |

### 5.2 What must be true before the first new SHYGON OS migration is created

1. **DEC-2026-023 APPROVED:** the origin (A or B) and a `db:push` safeguard (S1 or S2), with the safeguard **implemented before any `020_` file exists**.
2. **DEC-2026-018 resolved for L3 sign-off.** Every migration is L3 (CODEOWNERS: Data + Security).
3. **The test harness runs on the chosen origin:** `db:apply` (twice, idempotency), `db:verify` and `rls-adversarial` against the baseline + shim, plus a negative control. Real findings this surfaces (e.g. F1 on live) are recorded, never weakened.
4. **`supabase/migrations/README.md`** marks 001–019 as "applied on live, history only, never re-run".
5. **Baseline freshness:** a human confirms live hasn't been changed since 2026-09-30, or re-captures, followed by a `schema-drift.mjs` re-run.
6. **The VERIFY ON LIVE items** relevant to the migration's scope are answered: pgcrypto location; `auth.users` triggers (if auth is touched); `tgenabled` byte; and if the migration adds a CHECK, `tap_profiles.user_id IS NULL` / distinct `cards.status` counts.
7. **Sequencing approved** (DEC-2026-026), so the first migration is the intended one, and the **feature-level DEC** for that migration's content is APPROVED.
8. **Migration conventions are enforceable:** header template, rollback SQL, data-class comments, and `lint-definer` available or explicitly deferred with a DEC note.
9. **An application path is defined:** a human applies it via documented break-glass with post-apply verification SQL (doc 12 §4.10) until the M1.13 pipeline exists, **and PITR or backup is confirmed** before any production apply.
10. **Pre-production test environment decided** (DEC-2026-027), or explicitly accepted as local-only.

---

## 6. M1.1 IMPLEMENTATION READINESS

| Component | Classification | Gate / reason |
|---|---|---|
| Baseline test harness (pre-requisite) | **READY AFTER DECISION** | DEC-023 (+ DEC-018 for sign-off). Tooling only (L1/L2); no runtime change |
| Audit / event foundation (unified audit, `domain_events`) | **READY AFTER DECISION** | DEC-023, DEC-026, DEC-018 (L3: new definer functions and grants). Design complete; no product-semantics conflict |
| Feature flags / kill switches (`platform_config`, `feature_flags`) | **READY AFTER DECISION** | DEC-023, DEC-026, DEC-018 |
| Identity mapping: documentation | **READY** (complete in §2 and `M1_DOMAIN_MODEL`) | — |
| Identity mapping: enforcement (helper, normalisation, contract tests) | **READY AFTER DECISION** | DEC-029, DEC-024, DEC-023 |
| RBAC: platform permission namespaces (`devices.*`, `security.read`, `config.manage`) | **READY AFTER DECISION** | DEC-018 (L3), DEC-023, DEC-026 |
| RBAC: tenant roles | **DO NOT IMPLEMENT YET** | DEC-025, G3, OQ-9 |
| Card lifecycle | **BLOCKED** | DEC-028, DEC-002, DEC-022 (F3/F4 scope), DEC-024 (I-4); conflicts C1–C11 |
| Profiles (persona abstraction) | **READY AFTER DECISION** | DEC-032, DEC-023; golden equality test required |
| Routing (`/d/:code`, `tap_routes`) | **BLOCKED** | card lifecycle (DEC-028), OQ-2b, DEC-022 (F3) |
| Notifications: outbox / in-app infrastructure | **READY AFTER DECISION** | DEC-023, the M1.1 foundation |
| Notifications: email / WhatsApp providers | **READY AFTER DECISION** | DEC-031 (OQ-8) |
| Analytics v2 | **READY AFTER DECISION** | DEC-010 (F5), DEC-023; `device_id` columns depend on routing (BLOCKED portion) |
| Support foundation | **READY AFTER DECISION** | DEC-023, DEC-018 (new table + RLS = L3) |
| Organisations | **DO NOT IMPLEMENT YET** | DEC-025, G3, OQ-9 |
| OS dashboard | **BLOCKED: DECISION REQUIRED** | DEC-030 (meaning undefined) |
| Payment abstraction: interfaces, test fixtures, `rzp_live_` CI check, read-only reconciliation script | **READY** (no runtime or payment behaviour change; L1) | needs only approval of the next phase |
| Payment / fulfilment defect fix | **BLOCKED** | DEC-024 (+ DEC-023, DEC-029, DEC-028) |
| Live payment activation | **DO NOT IMPLEMENT YET** | G-PAY: DEC-024 fixed, DEC-001, K5, G2 |

---

## 7. Gate summary

- **Highest-priority decisions, in order:**
  1. **DEC-2026-023**, because every migration is blocked by it;
  2. **DEC-2026-026**, the M1 sequence and the M0 gate;
  3. **DEC-2026-022**, M0.3 scope;
  4. **DEC-2026-024**, the P1 defect, before any live payment;
  5. **DEC-2026-018**, role holders, without whom no L3 change has a valid approver.
- **Then:** DEC-029 (before identity work), and DEC-028 + DEC-002 (before cards and routing).
- **New facts recorded by this report** (not in earlier documents):
  - three live activation paths with conflicting expiry semantics, one of them automatic on delivery (C4); *corrected 2026-10-02: four writers of `active`, counting admin manual `admin_update_card` (E-2)*;
  - nothing sets `replaced`, and the replacement request suspends instead (C6);
  - `tap_profiles.user_id` is nullable while the resolver depends on it (§2.4);
  - `database.types.ts` is stale against live.
