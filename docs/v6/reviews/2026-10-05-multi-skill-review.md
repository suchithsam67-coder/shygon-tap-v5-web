# SHYGON V6: multi-skill review (2026-10-05)

| | |
|---|---|
| Scope | (1) The V6 release candidate: `v6/stage-2-identity-rls` @ `40b26ee`. (2) The outputs of the session "shygon tap v5 production part 2": the uncommitted 3D hero in the original checkout, DEC-2026-034 and the C5 SEO gate (`feat/commerce-c5-seo` @ `93ae352`) |
| Lenses | system design · architecture (ADR) · Supabase Postgres best practices · testing strategy · code review · frontend design · security |
| Mode | **Read-only.** No source, migration or test changed. Findings feed `docs/v6/backlog.md` after owner approval |

> **Security lens: the claude-security scan did not run.** Its pipeline needs the Workflow tool, which this session does not have. It ran no scan, wrote nothing and changed nothing. The security observations below are a manual review plus the Stage 2 RLS matrix (921 checks). They are **not** a claude-security result.
>
> **To run it:** if `/config` shows a "Dynamic workflows" row, enable it and restart. Then start the scan in a new session whose own message acknowledges the token use. Point it at a throwaway clone of `40b26ee` under a scratch folder, because the scan writes its report folder inside the repository it scans.

---

## 1. System design: the V6 platform as it stands

```
 visitor (NFC/QR) ──► /t/:slug  (entry bundle 88.55 kB gz, no SDK)
                         │ fetch: get_public_profile / get_public_tap_state / record_tap_event (anon, DEFINER)
                         ▼
 customer ──► SPA (lazy AccountApp) ──supabase-js──► PostgREST ──► Postgres (RLS + 86 DEFINER fns)
                │                                                   ▲   │ triggers: provision draft Tap,
                └─► /api/create-order ─┐                            │   │ notifications, account events
                    /api/verify-payment├─► Netlify/Vercel fns ─service_role─┘
 Razorpay ──webhook──► /api/razorpay-webhook ┘  (HMAC, idempotency ledger, amount check, capture)
 admin APK (external) ──► admin_* RPCs (require_admin) + edge fns admin-refund / admin-push
```

**Requirements as decided (D-2):**
- **Functional:** the software platform (identity, Tap lifecycle, public Tap, dashboard, payments for digital products, entitlements, notifications, analytics, admin foundation).
- **Non-functional:**
  - The public Tap must be fast on a stranger's phone (90 kB gate).
  - No customer-to-customer data exposure (RLS matrix: 0 unexpected access).
  - Payments are server-authoritative.
- **Constraints:** one week; Supabase + Razorpay; no new stack; production apply, deploy and rotation are human-gated.

**Load estimate (assumption, not measured):** early-stage traffic, at most tens of thousands of Tap views per day. Postgres comfortably serves that. The scale risks are the per-row RLS function calls (§3) and the unbounded `tap_events` table, which has no retention or partitioning.

**Revisit as the system grows:**
- `tap_events` retention or partitioning;
- keyset pagination in the 7 `admin_list_*` functions (they use OFFSET);
- per-Tap link previews served at the edge (the meta is client-side today);
- an event/outbox for notifications once email and WhatsApp arrive (DEC-2026-031).

## 2. ADR-V6-01 (Proposed): what a new customer buys in the V6 RC (decision **D-10**)

**Context:** three facts, which together leave a gap no single decision anticipated:
- D-2 removes physical cards, and the card decision means the RC sells no cards.
- D-6 makes a Tap exist only after payment.
- Essential is never sold (`create-order.mjs`: `SELLABLE_EXPERIENCES` = business, premium, goat).

Consequences, OBSERVED in code:
- **A new customer can get a Tap only by buying Business or higher.** A paid `digitalUpgrade` order provisions a draft Tap through `provision_tap_on_payment`. Essential is unreachable.
- The store, product pages, sitemap and C5 JSON-LD still advertise card **offers**. Structured data that claims offers which cannot be bought misleads search engines (merchant policy risk).
- Checkout copy frames experiences as upgrades "for your Tap".

| Option | Complexity | Cost to customer | Notes |
|---|---|---|---|
| **A. Digital-first RC.** Sell Business+ experiences as the entry product; cards shown as "coming soon / join the waitlist" (no payment); card JSON-LD switched off or marked unavailable | Medium (storefront + SEO + copy) | Entry price = Business | Uses the existing payment path unchanged; honest structured data |
| B. Free Essential Tap at sign-up (server-provisioned draft) | Medium (DB + server; reverses D-6) | Free | Changes the business model; D-6 would need re-deciding |
| C. Keep selling cards with manual card records | Low (no change) | Card price | Already rejected (paid cards cannot be activated: I-4) |

**Recommendation:** A, built in Stage 3 (V6-070 plus SEO) and Stage 4 (copy). **Consequence:** the C5 SEO gate must learn "not purchasable" product pages. **Revisit** when the card release lands.

## 3. Database (Supabase Postgres best practices)

Checked as catalogue queries and `EXPLAIN ANALYZE` on baseline + 020–024 (PGlite):

| Rule | Result |
|---|---|
| SECURITY DEFINER hygiene | **Pass.** All 86 definer functions pin `search_path`. Anon can execute only the 4 public-Tap functions and `admin_role()` |
| Primary keys | **Pass.** Every table has one |
| Growth-table indexes | **Pass.** `tap_events (tap_profile_id, occurred_at DESC)`, `account_events (user_id, created_at DESC)`, `notifications (user_id, created_at DESC)` |
| `security-rls-performance` | **20 policies** call `admin_has()` / `is_admin()` / `auth.uid()` unwrapped (not `(SELECT …)`). **Measured:** a customer reading `orders` *without* an owner filter scans all rows and calls `admin_has('orders.read')` per row (5,000 rows → 10,198 buffers to return 3). With the owner filter it is an index scan (3 buffers). **Every client read in `src/services` filters by owner** (OBSERVED), so this bites only RLS-only reads: admin-app table reads and Realtime fan-out. **P3** |
| Redundant permissive policies | 12 groups. Two are true duplicates (`admin_notification_reads` INSERT and SELECT). Eight are owner-or-admin plus `*_select_admin` pairs. Fixing O-15 (`admin_has` instead of `is_admin`) merges them, so do both in one Stage 4 migration: one SELECT policy per table, `(SELECT auth.uid())` / `(SELECT public.admin_has(...))` |
| `schema-foreign-key-indexes` | 9 unindexed FKs. Notable: `card_otp_challenges.card_id` (ON DELETE CASCADE), `admin_notifications.admin_id` and `admin_notification_reads.admin_id` (also policy predicates), and `order_admin_notes.updated_by` (**022, mine**; tiny table). All small today. **P3** |
| `data-pagination` | 7 `admin_list_*` use OFFSET. **P3** (admin scale) |
| Trigger load | `orders` has 7 triggers, `tap_profiles` 6, `profiles` 4. Acceptable; record the write amplification |
| Invoker functions calling `auth.uid()` | `notifications_only_read_state()` depends on USAGE on schema `auth` (Stage 2 shim fix; VERIFY ON LIVE) |

## 4. Testing strategy (V6 stages 3–6)

**Current pyramid (OBSERVED):**
- **Strong DB layer:** 1,100+ checks on the live baseline (verify, adversarial, matrix, identity, admin-notes, golden, admin contract, rollbacks).
- **Thin service layer:** payments and SMS, plus function security with 1 check blocked on Node 22.
- **No component tests and no browser E2E.**

| Area | Test type | Target | Stage |
|---|---|---|---|
| `fulfilOrder` (claim, retry, entitlements, safety net, SMS) | **Integration**: the real `netlify/lib/fulfilment.mjs` against PGlite through a minimal supabase-js-compatible adapter, or a local PostgREST | Every branch of the claim/retry state machine; I-1 no longer reachable | 3 |
| Webhook / verify-payment | Integration: signed fixtures through the handler into the DB (success, failure, duplicate, replay, invalid signature, amount mismatch) | The Stage 3 payment matrix | 3 |
| Public Tap UI states | Component tests (Vitest + Testing Library, mocked `publicTapClient`) for active / paused / unavailable / error / offline | 1 test per state + no private field rendered | 3 |
| Dashboard | Component tests per page: loading / empty / error / success | No dead buttons or routes (route table test) | 4 |
| Admin isolation | Already DB-proven (41 RPCs × anon/customer). Add an edge-function test: `resolveAdmin` refuses a customer token | | 4 |
| **E2E journeys** (a) sign-up → profile → Tap → public Tap, (b) checkout → payment → fulfilment → entitlement, (c) admin suspend → public unavailable → restore | **Playwright against local Supabase** (D-4) with Razorpay test mode or a signed-webhook stub | 3 journeys green, in CI | 5 |
| Accessibility | axe on built pages (public Tap states, auth, dashboard), keyboard pass | 0 serious/critical | 6 |
| Performance | Existing bundle gate, plus Lighthouse CI on `/t/:slug` (LCP, INP) on a throttled mobile profile | Public Tap LCP < 2.5 s on 4G | 6 |

**Gaps to close first:** the D-4 environment (blocks the E2E journeys), the Node 22 runner, and a test runner for the frontend. **Dependency note:** Vitest, Testing Library and Playwright are new devDependencies (a lockfile change), so they need an owner OK in Stage 3.

## 5. Part 2's work: fitness for V6

### 5.1 3D landing hero (uncommitted, original checkout; scope approved 2026-10-02, **not the baseline** per DEC-2026-034 Q2)
- **Good:**
  - capability-gated progressive enhancement (WebGL, reduced motion, save-data, 2G, low memory);
  - a lazy chunk;
  - an error boundary back to 2D;
  - no remote assets;
  - a thoughtful `manualChunks` fix (D-UI-4).
- **Code review (7 findings, reported in the review UI):**
  1. Once the 3D card takes over, the product image's accessible description disappears (the canvas is `aria-hidden`). This violates the scope's own Rule 4.
  2. `setPointer` on every pointer move re-renders the hero (60–120 renders/s), even when 3D is off.
  3. The canvas renders every frame forever, off-screen too.
  4. The `no-static-3d` guard cannot detect bundled three.js (it looks for specifiers that Rollup removes) and can false-positive on the word "three".
  5. That guard is not wired into `ci` or the workflow.
  6. The 2D card is swapped out before the 3D texture loads (visible pop).
  7. The hidden canvas keeps animating after reduced motion turns on.
- **Budget:** the unit's own record shows the gated entry at **89,640 B**, 1,092 B over the baseline with 360 B headroom. That is unexplained and unverified here: building in that checkout would write into another workstream's folder.
- **Frontend-design lens:**
  - The 3D card is a good choice of the "one memorable element" (the real card art, in context).
  - The idle float plus pulsing rings is non-user-triggered motion running forever. Prefer **one entrance moment plus pointer-driven tilt only**.
  - The surrounding chips use numbered markers (`01 PHYSICAL / 02 DIGITAL`) for a non-sequence, in all-caps labels. That is a generic tell, but it is live-baseline UI and out of scope to change without an owner decision.
- **Verdict:** **not for the V6 RC** (DEC-2026-034 Q2; and D-2 removes physical cards, the hero's subject). If revived, fix 1–5 and explain the +1.1 kB first.

### 5.2 DEC-2026-034 + C5 SEO gate (`93ae352`)
- **Good:** `check-seo.mjs` (711 checks, negative control), the 160-character description cap, and JSON-LD prices matching the live catalogue. No DB or function change.
- **Conflict with V6:** the product JSON-LD and sitemap advertise **card offers that the RC will not sell** (see ADR-V6-01). Merging C5 into V6 requires the "not purchasable" mode first.
- **Numbering:** DEC-2026-034 Q3 is amended by N-1 (V6 takes 022+). The record on that branch still says 022–028 / 029+.
- **Verdict:** valuable. **Merge into V6 in Stage 3, together with V6-070**, after adding unavailable-product handling to `productMeta` and `check-seo.mjs`.

## 6. Security (manual; see the note at the top)
- V6 RC: the Stage 2 matrix proves 0 unexpected table access for 7 caller types, and every callable `admin_*` function refuses anon and customers. Open items are tracked already: O-15, card items (deferred), the `record_tap_event` rate limit and hash, the Math.random order id, CORS `*` on the edge functions.
- **New, low:** `admin_role_permissions(text)` is executable by anon. It discloses the static permission catalogue; nothing secret. **P3**.
- Part 2's work: no security-relevant surface (client-only rendering, same-origin assets, build-time SEO). Supply chain: three + R3F + drei add about 640 lockfile lines. Run `npm audit` on that tree if it is revived.

## 7. New items proposed for the backlog (owner approval needed)

| ID | Item | Priority | Stage |
|---|---|---|---|
| **D-10** | Decide the RC's entry purchase (ADR-V6-01; recommended A: digital-first, cards as waitlist) | P1 (decision) | before Stage 3 |
| V6-080 | SEO: "not purchasable" product mode in `productMeta` + `check-seo.mjs`; then merge C5 (`93ae352`) into V6 | P1 | 3 |
| V6-081 | One SELECT policy per table with wrapped `(SELECT auth.uid())` / `(SELECT admin_has(...))`, combined with the O-15 fix | P2 | 4 |
| V6-082 | Index the 9 unindexed FKs (one migration) | P3 | 6 |
| V6-083 | Frontend test runner + public Tap state component tests | P1 | 3 |
| V6-084 | `fulfilOrder` integration tests against the database (supersedes V6-017's approach) | P1 | 3 |
| V6-085 | If the 3D hero is ever revived: fix the 7 review findings + explain the +1.1 kB entry growth | P3 | after V6 |
