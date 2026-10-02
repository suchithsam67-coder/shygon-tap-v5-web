# DEC-2026-024: Live-schema runtime incompatibilities, including the P1 paid-order claim defect

> G§11 decision record (template: `docs/governance/DECISION_RECORD.md`). Evidence: `docs/governance/SCHEMA_DRIFT_REPORT.md` §11–12.
> **Nothing in this record has been fixed.** Payments and the database are frozen until this decision is APPROVED. Live payments stay disabled (Razorpay test mode) by owner instruction of 2026-10-02.

| Field | Value |
|---|---|
| Decision ID | DEC-2026-024 |
| Title | V5 code paths fail on the live schema (`customer_id` semantics; card record creation) |
| Date opened | 2026-10-02 |
| Domain | Security: financial integrity (doc 13 §5, G§18.9). Data consulted. |
| Level | **L3**. Payments, database and RLS-adjacent. |
| **Accountable Owner (A)** | Security Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted (C) | Data Owner, Principal Architect, Product Owner (card semantics) — all UNASSIGNED |
| Informed (I) | Release Owner, QA Owner (UNASSIGNED) |
| State | **OPEN — HUMAN DECISION REQUIRED** |

## Priority (G§13–15)
| Impact | Urgency | Irreversibility | Risk | Score | Score → P | Matrix → P | **Final P** |
|---|---|---|---|---|---|---|---|
| 2 | 2 | 1 | 2 | 7 | P1 | P1 | **P1** |

**Classification history:**
- Opened as a P0 candidate on 2026-09-30 under the G§19 uncertainty rule.
- **Downgrade evidence (G§22):** the owner ran read-only counts on production on 2026-10-02. Paid payment with an unpaid order: **0**. Orders in retry: **0**. So there is no occurrence.
- **Exposure:** **6** customers have no Tap profile and a `customers.id` that differs from their user id. Every new sign-up is also exposed.
- The FK is confirmed **not deferrable**.
- The trigger is enabled per the dump. The live re-read returned "0", which needs one confirmation: `ascii(tgenabled::text)` should be 79.

**Escalate to P0 immediately if:**
- live Razorpay keys are enabled before this is APPROVED and fixed; or
- any later run of the mismatch count is greater than 0; or
- function logs show "Failed to claim fulfilment … tap_profiles_customer_id_fkey".

## Question
How should the V5 code paths that fail on the live schema be made correct, without breaking the frozen V5 contracts?

## Context & evidence
Each item was CONFIRMED in an isolated rebuild of the live baseline and compared with the repository schema.

| ID | Path | Live result | Root cause (INTERPRETATION) |
|---|---|---|---|
| I-1 | Fulfilment claim marks a first-time buyer's order paid (`fulfilment.mjs:93`) → trigger `provision_tap_on_payment` | `23503 tap_profiles_customer_id_fkey`. The claim throws, so the payment is captured but the order is not marked paid. | Live `customer_id` → `customers.id`, a random UUID created at sign-up. The trigger inserts `customer_id = user_id`. |
| I-2 | Settings / Checkout profile save `customer_id: user.id` (`Settings.tsx:86`, `Checkout.tsx:330`) | `23503 profiles_customer_id_fkey` | Same as I-1 |
| I-3 | Fulfilment safety-net Tap profile `customer_id: userId` (`fulfilment.mjs:331`) | `23503 tap_profiles_customer_id_fkey` (logged, not thrown) | Same as I-1 |
| I-4 | Card record creation, upsert with `onConflict 'order_id,sku'` (`fulfilment.mjs:249`) | `42P10` (no matching unique index), then `23502 card_id NOT NULL`. **It also fails on the repo schema.** Logged, not thrown. | Live uniqueness is `(order_id, sku, card_slot)`. The repo index is partial, so the conflict target never matched. Live `cards` requires a legacy `card_id`. |
| I-5 | `cards_issue_activation_code()` calls `gen_random_bytes` unqualified with `search_path = public, pg_temp` | UNKNOWN: VERIFY ON LIVE where `pgcrypto` is installed | If pgcrypto is in `extensions`, every card insert on live fails |

## Options (fix direction for I-1…I-3; Claude Code has not chosen)
### Option A: database-side `customer_id` resolution (code unchanged)
- A migration makes the database resolve `customer_id` itself:
  - `provision_tap_on_payment()` looks up, or creates, `customers.id` for `NEW.user_id`;
  - a BEFORE INSERT/UPDATE trigger on `profiles` and `tap_profiles` maps a `customer_id` equal to the auth user id onto `customers.id`.
- Benefits: the frozen V5 code and payment functions are untouched. It fixes I-1, I-2 and I-3 at once. It can be tested on the baseline.
- Risks: a trigger rewriting a client-supplied column is implicit behaviour, so it must be documented and covered by adversarial tests (L3, RLS-adjacent).
- Reversibility: rollback SQL restores the previous function and trigger.

### Option B: code-side lookup
- The app and `fulfilment.mjs` read `customers.id` before writing.
- Benefits: explicit.
- Risks: edits frozen payment code (doc 12 §2 allows this only as a bug fix with tests). The browser would also need to read `customers`, which is RLS-denied on live (`customers_api_none`), so it would need a new RPC.
- Reversibility: code rollback.

### Option C: make `customers.id` equal the user id
- Backfill existing rows, and have `handle_new_user` insert `id = NEW.id`.
- Benefits: removes the mismatch at its source.
- Risks: a data migration across the foreign keys of `profiles`, `tap_profiles` and `cards`. It is a destructive class of change (Data Owner, L3), and needs a backup and a restore drill first.
- Reversibility: poor without PITR.

### Option D: relax or drop the `customer_id` foreign keys
- Not recommended: it weakens integrity to hide the defect.

**I-4 (card records)** depends on the card lifecycle decision (DEC-2026-002, DEC-2026-022), because it must choose between the V5 single-card model and live's slot-based model. Either the conflict target becomes `(order_id, sku, card_slot)` and `card_id` gets a generator, or V5 adopts live's `fulfil_order()`.

**Advisory note (not an approval):** Option A is the smallest change that leaves the frozen V5 surfaces intact. Claude Code would build it, after approval, as a `020+` migration on the baseline origin (needs DEC-2026-023), with tests reproducing I-1…I-3 before and after.

## Impact assessment
- Security impact: financial integrity (I-1). No data exposure.
- Data impact: Option C rewrites keys; A and B do not.
- Product impact: first purchases, profile saves and card records work only after the fix.
- Architecture impact: fixes the `customer_id` contract for SHYGON OS (the identity module must use `customers.id`).
- Operational impact: live payments must stay disabled until fixed.
- Irreversible? A and B: no. C: yes, in practice.

## Interim controls (no code)
1. Keep checkout in Razorpay **test mode**, as the owner instructed on 2026-10-02.
2. Before enabling live payments: confirm the `RAZORPAY_KEY_ID` prefix in the Vercel environment, and re-run the mismatch count.
3. Never run `npm run db:push` against production (DEC-2026-023).

## Decision
- Decision: ________ (HUMAN DECISION REQUIRED)
- Required approvals: Security Owner (UNASSIGNED). Data Owner for C. Product Owner for I-4 semantics.
- Blockers: DEC-2026-023 (migration origin); OQ-16 (roles); DEC-2026-002 / DEC-2026-022 (I-4)
- Decision date: ________

## Result (filled at review date)
- Observed result:
- Reviewed on / by:
- Lesson for institutional memory:
