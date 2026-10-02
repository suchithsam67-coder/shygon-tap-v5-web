# DEC-2026-033: Integrating the 2026-09-29 "upgraded" zip (cards, promo codes, emails)

| Field | Value |
|---|---|
| Domain / Level | Product + Data + Payments / **L3** (live schema constraints, card model, identity) |
| **Accountable Owner** | Product Owner and Data Owner: **UNASSIGNED — HUMAN ACTION REQUIRED** (repository owner under DEC-2026-018 Option B) |
| Consulted | Security Owner, Principal Architect |
| State | **PROPOSED — HUMAN DECISION REQUIRED** |
| Priority | I3 U2 Irr2 R3 = 10 → P1 · **P1** · before any part of the upgrade is applied or deployed |
| Related | DEC-2026-023 (migration origin), DEC-2026-024 (I-1…I-4), DEC-2026-028 (card lifecycle), DEC-2026-029 (identity keys), D-U4 (draft Tap), DEC-2026-019 (bundle budget) |
| Evidence | Branch `fix/upgraded-zip` (worktree `../shygon-tap-v5-web-upgrade-fix`); commit messages carry each finding and its test |

**Question:** Should the upgrade enter the governed line, and if so, how are its two live-schema conflicts resolved?

## What the zip is (CONFIRMED)

- It was built from `shygon-tap-v5-web-2026-09-28-final.zip`, not from V5 as committed in `v5-baseline`.
  - On its own it removes the 2026-09-29 payments work: Razorpay confirmation, the order SMS, payment-mode, the live migration 019, and `theme-init.js`.
  - It was merged three-way on the branch, so nothing is lost there.
- Its migrations were numbered 019–025 and tested only on the PGlite stand-in.
  - They are now 022–028 (DEC-2026-023; M0.3 reserves 020 and 021).
- Commits `import/v5-2026-09-28-final` and `import/upgraded-zip-2026-09-29` record both zips byte-exact.

## Fixed on the branch (no decision needed; see the commits)

**Migrations on live**
- 026 failed on live: `order_status_history` already exists there.
- New pages wrote `customer_id = user_id`. That is I-1, and it breaks DEC-2026-029 B1/B2.
- New pages were published automatically, against D-U4. The D-U4 regression test had been rewritten to expect a live Tap.

**Live behaviour the upgrade dropped**
- A paid digital upgrade no longer raised the customer's page tier on live.

**Release hazards**
- The regenerated `APPLY_ALL.sql` (a replay of history), and the notes that told the reader to paste it.

**Crashes and test breaks**
- `create-order` crashed for any customer who owned an experience and bought a higher one. This crash is also in live V5.
- The checkout test mocks were broken by the merge.
- The public Tap was over the bundle budget (fixed without changing the budget).

**Security and correctness**
- vCard injection on Save contact.
- Regex injection in `bought_product`.
- No store-wide cap on anonymous funnel events.
- The e-bill email called draft pages live.

## Decisions needed

**Q1. One page per card versus live `tap_profiles_customer_id_key` (UNIQUE `customer_id`).**
- Live allows one page per customer record, so the upgrade's core feature cannot work.
- Migration 022 refuses to run while this constraint exists.
- Options:
  - **A.** Drop the constraint (pages are owned by `user_id`, and `customer_id` stays the commercial key, per DEC-2026-029 B3). This is a schema change on live.
  - **B.** Keep one page per customer. The upgrade's card management (Card IDs, lost and replacement, analytics) would have to be reworked to share a single page. That is a large rework of 022.
  - **C.** Do not take the page-per-card feature.
- Advisory: **A**, if the product wants several pages per customer. Proven only in a scratch simulation (14/14 live-shape flows pass).

**Q2. Card records on live: `cards.card_id` NOT NULL without a default; uniqueness `(order_id, sku, card_slot)` (I-4).**
- No card can be inserted by V5 or the upgrade.
- Quantity 2–10 also issues only one card, because there is one insert per order line.
- This is the open I-4 / DEC-2026-028 decision. It must also define `card_slot` numbering for multi-card orders.
- 022 refuses to run until it is decided.

**Q3. Sequencing.**
- Recommended: the upgrade lands after M0.3 (020 F1 guard, 021 customer_id resolution) and after Q1 and Q2.
- Each of 022–028 then needs the DEC-2026-023 header (purpose, rollback, data class) and L3 review (24 h cool-off + checklist).

**Q4. Product choices the zip made that this review did not change (confirm or reject).**

*Public addresses and QR codes*
- New QR codes and the displayed address use `/shygontap/<slug>` instead of `/t/<slug>`.
  - Both routes work today.
  - A future app screen named like an existing customer's slug would break that customer's printed QR.
  - `/t/` cannot collide.
- Opening a `/c/` link logs both a view and a tap, including the owner's own "Test tap".

*Promo codes*
- DRAGON (30%) and NEWTAP (20%) are seeded with no usage, per-customer or date limits.
- A reservation lasts 30 minutes; a payment after that can exceed `max_uses`.

*Buttons by tier*
- Business now includes Instagram, LinkedIn and website free. These were previously sold as add-ons.

*OTP and email delivery*
- With SMS off, card OTPs go to the account email: the same factor as the login.
- On Vercel the email cron is daily. Prompt status emails need a database webhook.

*Usability and addresses after D-U4*
- With D-U4, a delivered and activated card shows "unavailable" until the customer publishes the page. There is no prompt in My cards yet.
- Existing live slugs that equal the newly reserved words (`billing`, `card-details`, `card`, `c`, `t`, `login`, …) lose `/shygontap/<slug>`. Their `/t/<slug>` still works. **VERIFY ON LIVE** with a read-only count.

## Not changed by this review

- Nothing is applied to any Supabase project, and nothing is deployed.
- Live payments stay OFF (DEC-2026-024).

**Decision:** ________ **Approved by:** ________ **Date:** ________
