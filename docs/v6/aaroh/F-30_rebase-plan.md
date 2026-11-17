# F-30 / T-31: rebase V6 onto the live migration line — the plan

Session A, 2026-11-17.

**Status:** PLAN ONLY. No branch exists yet.
- The founder approved F-30 on 2026-11-16 ("Approve F-30"). The coordinator recorded it in `e21c812` on `coord/v01-scope` as task T-31.
- The approval covers a local rebase only: no push, no apply, no production contact.
- The owner, in session on 2026-11-16, also approved this plan as item 3 of "Approve all three".

## 1. What moves where

**The base (the live line):**
- `shygon-tap-website`, branch `audit/2026-11-15`, at `12ad050`.
- Migrations 001–053 are as on live. Migrations 054–057 are the audit fixes, not applied on live yet.
- It is a separate repository with no shared history. Its `supabase/migrations/` and the test baseline its suites need are imported **as files**; its history is not merged.

**The branch:** a new local `v6/rebase-live`, cut from `v6/aaroh-backend`. `v6/aaroh-backend` stays untouched until the new branch is green.

**The number map:** V6's 25 migrations move to 058 onwards, in the same order. 042 is the Admin APK session's (see §4), and 027 is held aside under DEC-037.

| V6 | Live line | | V6 | Live line | | V6 | Live line |
|---|---|---|---|---|---|---|---|
| 020 | 058 | | 029 | 066 | | 037 | 074 |
| 021 | 059 | | 030 | 067 | | 038 | 075 |
| 022 | 060 | | 031 | 068 | | 039 | 076 |
| 023 | 061 | | 032 | 069 | | 040 | 077 |
| 024 | 062 | | 033 | 070 | | 041 | 078 |
| 025 | 063 | | 034 | 071 | | 043 | 079 |
| 026 | 064 | | 035 | 072 | | 044 | 080 |
| 028 | 065 | | 036 | 073 | | 045 | 081 |
| | | | | | | 046 | 082 (only `order_admin_note_append` survives; §2) |

**Everything that pins a number or a body is updated with it:**
- every header (Origin, ROLLBACK);
- `FIRST_NEW_MIGRATION` (020 → 058) and `newMigrations()`;
- the frozen-contract hashes in `admin-contract.mjs` (FROZEN_NAMES, APPROVED_BODY_CHANGES), re-pinned to the live line's bodies;
- the generators that edit a live function from its text;
- `APPLY_ALL.sql` (058 onwards);
- the migrations README;
- every "migration 0NN" reference in the contract (AAROH-API), the DEC records and the readiness report. The contract becomes **v0.19**, with no shape change, and Session B is told.

## 2. Overlaps and the choice for each

**1. Column guards: V5's 056 against V6's 020, 028 and 030.**
- 056's `..._000_` triggers silently put the old value back. V6's guards refuse with 42501.
- On one line, 056 fires first, so for the columns both guard, V6's guards never see a change. The overlapping columns are `suspended_*`, `card_id`, `customer_id`, `provisioned_at`, `last_content_edit_at` and `edit_window_started_at`.
- **Choice: one behaviour per column, namely 056's silent keep wherever 056 guards the column.** Reasons:
  - it is the live line's approved fix and the behaviour production will run;
  - V5's app is built around it;
  - editing V5's 056 is outside this lane.
- V6's 020, 028 and 030 stay as defence in depth. They still **refuse** the columns only they guard: `slug`, `username`, `published_at` and `ui_plan_id` on `tap_profiles`, plus 028's insert-time checks.
- `test:suspension` and the 030 checks then expect "kept" for the overlapping columns and "refused" for the rest. Each expectation names the trigger responsible.

**2. The admin note.** 022 (→ 060) moves the note to `order_admin_notes`, and 054 closes the column.
- Both are kept, and they agree.
- 046's column grant is **dropped**, because 054 already does it.
- `order_admin_note_append` (from 046) stays, because admin-refund needs it.
- 054's rule carries over: any V6 migration that adds a column to `orders` must `GRANT SELECT (col) ON public.orders TO authenticated`. The rebase checks every V6 migration that touches `orders`.

**3. The card one-time codes.** V5's 057 is the same design as V6's 046 card-code part, so that part is **dropped**.
- V6's `card-otp.mjs` keeps its calls; they match 057's signature.
- With `channel` present on the live line, `p_channel` is stored.

**4. `support_tickets`.** The live line has a customer UPDATE policy, which 056 guards. V6 inherits both. The table-level UPDATE grant stays on the checklist.

**5. Functions that V6 rewrites from their text,** in 021, 022, 024, 025, 035, 036, 037, 039, 040, 041, 043, 044 and 045.
- Each is **regenerated from the live line's latest body**, not the 2026-09-30 dump.
- This is the main work. It includes 025 against the live `get_public_profile` and `enforce_tap_edit_rules` (the old V6-106 drift, now in the line).
- Each generator's anchors either still match or fail loudly. Nothing is hand-merged.

**6. Tier and add-on refusals.** These are re-run against the live line's `enforce_tap_edit_rules` (in `test:modes`, `test:public-tap` and the probe used for the 2026-11-16 verdict). The re-check against a fresh production dump stays open under V6-106.

**7. Phone sign-in.** V5's 055 lands on the line. V6's app does not call it until the owner decides on phone sign-up or login; Session B has raised this. The client-address rules differ:
- V5's `client.mjs` uses one header per host;
- V6's `client-address.mjs` uses one configured header and fails closed.

They are recorded and not merged, because they live in different apps.

## 3. Proof (all local)

- **Every V6 suite green on the rebased chain:**
  - the whole `test:db` family, `test:card-otp-limits` included;
  - every stack suite;
  - `test:components`, `test:preview-checks` and `test:secrets` (V6-014 only).
- **V5's own `db:verify`, including verify-054 to 057, green on the same chain.**
- **A schema-equivalence check:**
  - the live line's 001–053, replayed, against the 2026-09-30 dump plus the seven drift migrations of 2026-10-11 to 10-15;
  - every difference is listed.
- **A negative control:** drop one renumbered migration (078, card pairing). `test:card-lifecycle` and the export-parity gate must fail.

## 4. Open before or alongside the rebase

- **The Admin APK session's migration 042** (on `feat/admin-v5-coverage`, off V5's 8becea3) also needs a slot on the live line. Two lines must not both claim 058. The coordinator should assign numbers: V6 takes 058–082, and the Admin APK takes the next free slot after that, or before it if it ships first.
- **027** (the AAROH catalogue) stays held aside (DEC-037).
- **The production order:**
  1. V5 applies 054–057 on live;
  2. later, V6's 058 onwards, after the DEC-2026-018 cool-off;
  3. 035 only as its production variant.
  Never `APPLY_ALL` on production.
- **V6-S1** (the analytics ceiling) is built after this, on the rebased branch, so its number is final.
