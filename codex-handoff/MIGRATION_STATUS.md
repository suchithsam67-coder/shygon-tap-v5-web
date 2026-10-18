# MIGRATION_STATUS

Labels: `VERIFIED IN CURRENT CHECKOUT` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

No migration SQL was changed. No migration was applied.

## 1. Migration numbers vs decision-record numbers

These are **different numbering systems**. Do not infer one from the other.

| Kind | Example | Where it lives |
|---|---|---|
| Migration number | `020_guard_suspension_columns.sql` | `supabase/migrations/` |
| Decision record | `DEC-2026-003` (suspension guard and policy) | `docs/governance/decisions/` |
| Production migration version | `20261011064653` (timestamp) | `supabase_migrations` history on production (recorded in the CSV) |

`DEC-2026-003` is the suspension decision. It is **not** migration 003. Migration 020 is implemented under DEC-2026-003 (and an older decision reference "DEC-2026-022 Position A" appears in the file header of 020).

## 2. Local migration files (rebaseline branch `v6/rebaseline-2026-10-18` at `4d730c4`)

VERIFIED IN CURRENT CHECKOUT (`ls supabase/migrations` in `shygon-tap-v5-web-rebaseline`):

`001`–`026`, `028`, plus `README.md`. Migration `027` is **absent** on this branch.

Note: `011` is also absent from the sequence (`010` → `012`). The repo has `supabase/proposed/011_admin_notes_off_customer_rows.sql` (V5 baseline worktree). Migration 022 is `022_admin_notes_off_customer_rows.sql` on the rebaseline branch, so the proposed 011 file is a different artefact. Its relationship is UNVERIFIED.

## 3. Migration status table

| Migration | Local file (rebaseline `4d730c4`) | Applied to production? | Status | Label |
|---|---|---|---|---|
| **019** `019_order_confirmation_sms.sql` | Present (order-confirmation SMS). **Does not define `tap_slug_reserved` / `tap_slug_taken`.** | Reported: the slug functions were "defined in 019 but not applied" — **contradicted by the file content**; the repo's 019 is an SMS migration. | Applied in repo; the slug-function claim needs its source found | VERIFIED IN CURRENT CHECKOUT (content); REPORTED INVESTIGATION FINDING (the claim) |
| **020** `020_guard_suspension_columns.sql` | Present. Header: "a customer cannot un-suspend their own Tap or account (F1)." DEC-2026-003 §3.1 conditions govern early application. | **No** (DECISIONS.md: "Not applied to production") | Prepared, **not applied** | VERIFIED IN CURRENT CHECKOUT (file); HISTORICAL/Governance (status) |
| **021** `021_resolve_customer_id.sql` | Present on `shygon-tap-v5-web-m03` (`5659d15`) and on the rebaseline branch | UNVERIFIED | UNVERIFIED | VERIFIED IN CURRENT CHECKOUT (file presence) |
| **022** `022_admin_notes_off_customer_rows.sql` | Present (rebaseline) | UNVERIFIED | UNVERIFIED | VERIFIED IN CURRENT CHECKOUT (file presence) |
| **023** `023_taps_only_after_payment.sql` | Present (rebaseline) | UNVERIFIED | UNVERIFIED | VERIFIED IN CURRENT CHECKOUT |
| **024** `024_owner_or_admin_policies_to_authenticated.sql` | Present (rebaseline) | UNVERIFIED | UNVERIFIED | VERIFIED IN CURRENT CHECKOUT |
| **025** `025_public_tap_privacy_and_analytics.sql` | Present (rebaseline). Header: "the public Tap's privacy and analytics hardening (V6 Stage 3)". | UNVERIFIED | **Requires rebase assessment** against production's `enforce_tap_edit_rules` (reported from `card_family_pages`). **Do not rebase until the fresh baseline is reviewed.** | VERIFIED IN CURRENT CHECKOUT (file); REPORTED (rebase requirement) |
| **026** `026_orders_outlive_account_deletion.sql` | Present (rebaseline) | UNVERIFIED | UNVERIFIED | VERIFIED IN CURRENT CHECKOUT |
| **027** `027_aaroh_catalog.sql` | **Absent on rebaseline.** Present on `v6/aaroh-store` / `v6/aaroh-stabilise` worktrees. DECISIONS.md: "Migration 027 stays reserved for the AAROH catalogue (DEC-2026-037)." | No | Reserved | VERIFIED IN CURRENT CHECKOUT (absence + reservation text) |
| **028** `028_guard_suspension_on_insert.sql` | Present (rebaseline; committed on `v6/suspension-guard` at `4d730c4`). Header: "a customer cannot create a row that is already suspended (F1, the INSERT half of 020)." | **No** | Prepared, **not applied** | VERIFIED IN CURRENT CHECKOUT |

Historical and reported results about the commit that added 028: DECISIONS.md states `028_guard_suspension_on_insert.sql (2026-10-16, v6/suspension-guard)`. VERIFIED IN CURRENT CHECKOUT (decision text).

## 4. The seven recorded production migrations

These exist **only** in production migration history (as recorded in the evidence CSV). They are **not** in the repo as migration files under these names, which is the drift. VERIFIED IN CURRENT CHECKOUT (CSV) — see [PRODUCTION_DRIFT.md](PRODUCTION_DRIFT.md) §2.

| Version | Name |
|---|---|
| 20261011064653 | card_family_pages |
| 20261011064710 | hide_unsupported_gallery_addon |
| 20261011094328 | admin_create_tap_page_and_page_templates |
| 20261011100305 | rerun_admin_create_tap_page_repeatable |
| 20261014145548 | shygontap_studio_profiles_v1 |
| 20261014145752 | shygontap_photo_cleanup_policy_v1 |
| 20261015140944 | shygontap_site_content |

The CSV holds their statement bodies as JSON arrays (large; do not copy). Open the file for the statements.

## 5. Suspension columns and triggers

- Migrations 020 and 028 touch suspension columns and triggers on `profiles` / `tap_profiles` (VERIFIED IN CURRENT CHECKOUT: file headers).
- The seven recorded migrations are reported not to touch those columns or triggers (REPORTED). The fresh baseline must confirm this (UNVERIFIED).

## 6. Rules that govern migrations (from the repo)

- Never apply a migration to production before the DEC-2026-003 §3.1 conditions hold (DECISIONS.md, "Not authorized" row: "Applying any migration to production before the §3.1 conditions hold").
- Migration 027 stays reserved (DEC-2026-037; DECISIONS.md).
- Migration numbering: N-1 — V6 migrations from 022 onward (DEC-2026-035 amendment; DECISIONS.md: "N-1 (V6 migrations 022+; amends DEC-2026-034 Q3)").
- Do not change migration SQL in the handoff stage.

## 7. Migrations in V5 baseline (this worktree)

This session's worktree (`8becea3`) has `supabase/migrations/001`–`010`, `012`–`019` (no 011, no 020+). VERIFIED IN CURRENT CHECKOUT. The V5 apply-all file `supabase/APPLY_ALL.sql` is present and is **not** to be pasted into chat (per the upgrade-zip rule in memory; treat as sensitive operator input).
