# F-30 / T-31: rebase V6 onto the live migration line — the plan

Session A, 2026-11-17.

**Status:** PLAN ONLY. No branch exists yet.
- The founder approved F-30 on 2026-11-16 ("Approve F-30"). The coordinator recorded it in `e21c812` on `coord/v01-scope` as task T-31.
- The approval covers a local rebase only: no push, no apply, no production contact.
- The owner, in session on 2026-11-16, also approved this plan as item 3 of "Approve all three".

## 0. Precondition: a fresh production schema (T-31 paused, 2026-11-17)

**Why the rebase is paused.** Session A ran a read-only experiment in throwaway in-memory databases [OBSERVED].
- **The V5 line, replayed, is not the production schema.** V5's test baseline plus migrations 001–057 applies cleanly, but it does not reproduce the 2026-09-30 production dump.
  - The dump has objects that **neither repository's migrations create or drop**:
    - tables `customer_customizations`, `customizations` and `ui_plans`;
    - functions such as `request_card_replacement`, `customer_activate_card`, `fulfil_order` and `set_card_nickname`;
    - every `*_select_owner_or_admin` policy.
  - They were most likely created directly in the database.
  - Against the dump, the replay has 15 tables, 83 functions and 21 policies the dump lacks. It lacks 3 tables, 10 functions and 19 policies the dump has. Another 13 tables and 34 functions differ.
- **V6 on top of the replay:** 23 of 25 migrations apply.
  - 024 fails: its `*_select_owner_or_admin` policies are absent.
  - 041 fails: the replay's `cards` has no `card_id`.
  - Three migrations would put a 09-30 function body back over a newer V5 one: 021 (`provision_tap_on_payment`), 025 (`enforce_tap_edit_rules`) and 035 (`get_public_profile`).

**Consequence.** A rebase proven green on the replay would be proven against a schema that is not production's.

**Decision** [OBSERVED]: the owner, in session on 2026-11-17, answered "Wait for fresh dump" to "Which base should the move build on?".

**The input needed (human, read-only).**
- Whoever holds production access takes a fresh schema-only dump of the production project, as approved on 2026-10-18:
  `pg_dump --schema-only --no-owner --schema=public --verbose`
- It is kept with its provenance: the project, the timestamp, and the git commit at capture time.
- It holds no data and no secrets, and must never include credentials.

**Then:**
1. The base becomes that dump, plus V5's 054–057 (not applied on live), plus the Admin APK's 058.
2. The comparison above is re-run against it.
3. The steps below follow, with the same number rule.
4. 024 and 041 are adapted, and 021, 025 and 035 are regenerated, to whatever production actually has.

**The tool for step 2** (built 2026-11-17 at the coordinator's request; V6-139).
- `npm run rebase:compare -- --dump <file> --v5 <V5 repo> [--extra <the Admin APK's 058>]`. It runs in in-memory databases only, opens no network connection, and refuses a dump that holds table data.
- It writes `report.json` and, for every function V6 replaces whose body has moved since 2026-09-30, a three-way merge of V6's change onto the new body as a **PROPOSAL**. A conflict stops that function's chain and is left marked for a human. Nothing under `supabase/` is written.
- `npm run test:rebase-compare`: 25 checks, including planted differences and a conflict.

**A dry run on the 2026-09-30 dump as a stand-in** (V5 at `12ad050`) [OBSERVED]:
- The comparison reproduces the counts above. The extra kinds add: the replay has 73 column grants that the dump lacks, and 81 function grants differ. The latter probably means V5's test baseline does not carry production's function grants [INFERRED].
- **V5's 055 fails on the dump:** `relation "public.phone_login_attempts" does not exist`. V5's own 046 creates that table, and the 2026-09-30 dump does not have it. Either V5's 046 reached live after that date, or it never did. The fresh dump answers this. It is a concrete signal for V5's "step 0".
- 054, 056 and 057 apply. Then all 25 V6 migrations apply.
- No function V6 replaces was changed by 054, 056 or 057. Both 057 and V6's 046 define `card_otp_begin` (different bodies: the `channel` column) and `card_otp_take_attempt` (the same body). §2.3 already drops 046's part.


## 1. What moves where

**The base (the live line):**
- `shygon-tap-website`, branch `audit/2026-11-15`, at `12ad050`.
- Migrations 001–053 are as on live. Migrations 054–057 are the audit fixes, not applied on live yet.
- It is a separate repository with no shared history. Its `supabase/migrations/` and the test baseline its suites need are imported **as files**; its history is not merged.

**The branch:** a new local `v6/rebase-live`, cut from `v6/aaroh-backend`. `v6/aaroh-backend` stays untouched until the new branch is green.

**The number map** (coordinator's numbering decision, 2026-11-17):
- The Admin APK session's 042 becomes **058** on the live line. It serves the live V5 database and ships before V6.
- V6's 25 migrations then follow from **059**, in the same order. 027 stays held aside under DEC-037.
- **Not hard-coded.** At rebase time, a small mapping script takes "the last migration number on the live line + 1" as V6's first number. A late V5 fix therefore shifts the map instead of forcing another manual renumber.
- The same script fails if any two files share a number, or if a V6 file would land on or below the live line's last number.
- The table below is the map with today's line, which ends at 058 once the Admin APK's file lands.

| V6 | Live line | | V6 | Live line | | V6 | Live line |
|---|---|---|---|---|---|---|---|
| 020 | 059 | | 029 | 067 | | 037 | 075 |
| 021 | 060 | | 030 | 068 | | 038 | 076 |
| 022 | 061 | | 031 | 069 | | 039 | 077 |
| 023 | 062 | | 032 | 070 | | 040 | 078 |
| 024 | 063 | | 033 | 071 | | 041 | 079 |
| 025 | 064 | | 034 | 072 | | 043 | 080 |
| 026 | 065 | | 035 | 073 | | 044 | 081 |
| 028 | 066 | | 036 | 074 | | 045 | 082 |
| | | | | | | 046 | 083 (only `order_admin_note_append` survives; §2) |

**Everything that pins a number or a body is updated with it:**
- every header (Origin, ROLLBACK);
- `FIRST_NEW_MIGRATION` (020 → the first V6 number from the mapping script; 059 today) and `newMigrations()`;
- the frozen-contract hashes in `admin-contract.mjs` (FROZEN_NAMES, APPROVED_BODY_CHANGES), re-pinned to the live line's bodies;
- the generators that edit a live function from its text;
- `APPLY_ALL.sql` (V6's numbers only, 059 onwards today);
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
- **Realtime** (Session B's question, 2026-11-17). `orders` is in the `supabase_realtime` publication, and customers subscribe to their own UPDATEs.
  - Whether Realtime drops a column the subscribing role cannot SELECT from `postgres_changes` payloads is **UNVERIFIED**: no local Realtime server, and no clear public statement found.
  - In V6 nothing writes `orders.admin_note` any more (022, 046; the tests prove both writers). So a payload carries NULL there today.
  - On the rebased line, the rebase checks that no live-line function writes `orders.admin_note` either.
  - **Proposed as defence in depth,** a decision for the release track: a publication column list (PostgreSQL 15+; live is 17.6) that leaves out `admin_note`. Session B's hook uses the event only as a signal, so it needs no payload.

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
- **A negative control:** drop one renumbered migration (card pairing, 079 today). `test:card-lifecycle` and the export-parity gate must fail.
- **The numbering check:** the mapping script's duplicate-number and ordering checks pass, and fail on a planted duplicate.

## 4. Open before or alongside the rebase

- **The Admin APK session's migration 042** (on `feat/admin-v5-coverage`, off V5's 8becea3) is **settled**. The coordinator assigned it **058** on the live line on 2026-11-17, so V6 follows from 059. The mapping script recomputes V6's numbers from whatever the live line ends at when the rebase runs.
- **027** (the AAROH catalogue) stays held aside (DEC-037).
- **The production order:**
  1. V5 applies 054–057 on live;
  2. later, V6's 058 onwards, after the DEC-2026-018 cool-off;
  3. 035 only as its production variant.
  Never `APPLY_ALL` on production.
- **V6-S1** (the analytics ceiling) is built after this, on the rebased branch, so its number is final.
