# DEC-2026-034: Scope and order of the "full-stack e-commerce platform" brief

| Field | Value |
|---|---|
| Domain / Level | Product + Architecture (scope against doc 10 §4; schema and auth changes) / **L3**: irreversible schema work on a live payment system |
| **Accountable Owner** | Product Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** |
| Consulted | Principal Architect, Security Owner, Data Owner, Release Owner (all UNASSIGNED) |
| State | **DECIDED (owner, in session, 2026-10-03)**: Q1–Q4 answered; Q5 is asked per phase. The Accountable Owner role is still UNASSIGNED. |
| Priority | I2 U1 Irr3 R3 = 9 → P1 · matrix P1 · **P1** · deadline: before any commerce schema work starts |
| Related | DEC-001 (SEC-1), DEC-018, DEC-022, DEC-023, DEC-024, DEC-025, DEC-027, DEC-030, DEC-031, DEC-032, DEC-033 |
| Evidence | `docs/shygon-os/COMMERCE_GAP_ANALYSIS.md` |

## Question

On 2026-10-03 the owner gave a brief to turn the existing UI into a "complete, production-ready, full-stack e-commerce platform". It has 33 sections and says: do not change the UI. Four things need deciding:

1. **Scope.** Which parts are built, and which are deferred?
2. **Baseline UI.** Which UI is the "current, approved UI" the brief protects?
3. **Order.** When does schema work start, given M0.3 (020/021) and `fix/upgraded-zip` (022–028)?
4. **Authorization.** What may be changed, and where?

## Evidence (OBSERVED; details in the gap analysis)

**Already exists live:**
- orders, payments (Razorpay: UPI, cards, net banking, wallets; HMAC; idempotent webhook);
- inventory movements, stock and low-stock alerts;
- admin cancel, which does NOT refund;
- support tickets and in-app notifications;
- 5 admin roles with permission strings, and an audit log;
- PIN serviceability, e-bill and SEO meta.

**Already built but unmerged** (`fix/upgraded-zip`, blocked by DEC-033): promo codes, email outbox, reviews, tax/inventory funnel.

**Missing everywhere:**
- carts, wishlist, saved addresses;
- returns and refund records;
- shipments and tracking;
- gift cards, store credit, loyalty, referrals;
- vendors, warehouses and suppliers, a delivery-partner app;
- rate limiting and an end-to-end test suite.

**Conflicts:**
- **With the approved roadmap.** Doc 10 §4 defers organizations/multi-tenancy (brief §20, vendors) and native/push apps (brief §9 and §17 push).
- **With open decisions:**
  - DEC-025 (organizations);
  - DEC-027 (environments, against a production rollout);
  - DEC-030 (admin dashboard scope);
  - DEC-031 (WhatsApp/email providers);
  - DEC-032 (taxonomy);
  - DEC-033 (upgrade zip).
- **With the authorization.** c31f9df allows DB/RLS/payment work only locally, in test mode, for M0.3. Auth, deployment, live payments and production data: NO. The brief needs auth changes (guest checkout, OTP and social login) and live payments.
- **Blockers:**
  - Live payments are blocked by DEC-024.
  - SEC-1 credential rotation is not done.

**Baseline UI is ambiguous.** Three candidates exist:
- the live V5 storefront (`v5-baseline`, 8becea3);
- a 3D hero, uncommitted in the main checkout (`opencode/m0.3-handover`, another session);
- an editorial redesign, uncommitted in `../shygon-tap-v5-web-website` (`feat/website-experience-upgrade`), not yet reviewed by the owner.

**HYPOTHESIZED:**
- The brief reads like a generic template: sizes and colours, warehouses, a vendor marketplace, a delivery fleet. Much of it has no SHYGON product to attach to.
- As written it is a multi-month programme.

## Options

### Option A: build the brief as written, now
- **Benefits:** literal compliance.
- **Risks:**
  - It contradicts doc 10 §4.
  - It pre-empts 6 open decisions.
  - It collides with M0.3 and the upgrade-zip migrations.
  - It needs auth and live-payment authorization that does not exist.
  - It produces many tables with no product behind them.
- **Cost / time:** XL+, months.
- **Reversibility:** low (schema on a live payment database).

### Option B: SHYGON commerce core, in gated phases C0–C5 (recommended)
- **Content:**
  1. Integrate the upgrade zip.
  2. Server cart, wishlist and saved addresses.
  3. Order lifecycle: customer cancel, returns and replacement, refund records and the Razorpay refund API, GST invoice.
  4. Courier shipments and tracking.
  5. Admin parity in the existing Expo app.
  6. SEO.
- **Deferred,** each with its own future DEC: vendors, warehouses / purchase orders, the delivery-partner app, loyalty, referrals, gift cards, store credit, WhatsApp/push, COD, and the auth changes.
- **Benefits:**
  - It covers what SHYGON actually sells.
  - It reuses the existing UI, functions and RPCs.
  - Each phase is testable locally.
- **Risks:** owner expectation ("everything"). This is mitigated by the deferred list and by the gate after each phase.
- **Cost / time:** M–L across phases. Migrations start at 029.
- **Reversibility:** high per phase (additive migrations; local test mode until the owner approves a deploy).

### Option C: finish M0.3 and DEC-033 first, then decide
- **Benefits:** no new risk while P1/SEC items are open.
- **Risks:** commerce gaps stay open longer.
- **Cost:** none now.
- **Reversibility:** n/a.

## Recommendation

**Option B, starting with C0 after M0.3's 021 lands.**
- Keep the live V5 storefront as the UI baseline unless the owner approves one of the redesigns.
- Extend the existing authorization to commerce work **locally, in test mode only**.
- Keep auth changes, live payments, deployment and production data at NO until their own approvals.

## Owner answers needed

| # | Question | Options |
|---|---|---|
| Q1 | Scope | A / B / C |
| Q2 | Baseline UI | live V5 / 3D hero / editorial redesign |
| Q3 | Order | after M0.3 021 + DEC-033 (recommended) / in parallel on its own branch, migrations ≥ 029 |
| Q4 | Authorization for commerce work | local test-mode DB/RLS/payment changes YES/NO; auth, deploy, live payments: stay NO unless separately approved |
| Q5 (later, per phase) | Providers | courier aggregator; COD yes/no; refunds automated via the Razorpay API yes/no |

## Decision (owner, answered in session, 2026-10-03)

| # | Answer |
|---|---|
| Q1 Scope | **Option B**: SHYGON commerce core, gated phases C0–C5. The deferred list stands; each deferred item needs its own DEC. |
| Q2 Baseline UI | **The live V5 storefront** (`v5-baseline`). The editorial redesign (`feat/website-experience-upgrade`) and the 3D hero (`opencode/m0.3-handover`) stay parked on their branches and are not the baseline. New screens follow the V5 design language. |
| Q3 Order | Commerce **database** work starts **after M0.3's migration 021 has landed and DEC-2026-033 Q1/Q2 are decided**. Commerce migrations are numbered from 029. |
| Q4 Authorization | **YES, local test mode only**: local PGlite migrations, RLS and payment code against Razorpay test mode. Still **NO**, each pending its own approval: live database, deployment, live payments, production data, and auth changes (guest checkout, OTP/social login). |

**Expected outcome:**
- C0 begins once the two dependencies close.
- Each phase ends with a PASS/BLOCKED gate report.
- The next phase starts only on the owner's explicit approval.

**Human actions that unblock C0:**
1. Give the M0.3 U3 go-ahead, so that 021 lands.
2. Decide DEC-2026-033 Q1 (`tap_profiles_customer_id_key`) and Q2 (`cards.card_id` NOT NULL).

**Approved by:** owner (session answer, 2026-10-03) · **Recorded by:** Claude Code (agent)
