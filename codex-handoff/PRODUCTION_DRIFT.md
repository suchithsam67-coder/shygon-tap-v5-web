# PRODUCTION_DRIFT — evidence register

Labels: `VERIFIED IN CURRENT CHECKOUT` · `VERIFIED BY CURRENT TEST` · `HISTORICAL RESULT` · `REPORTED INVESTIGATION FINDING` · `INFERENCE` · `UNVERIFIED`

Nothing here was checked against live production. No production query, dump, or website request was made. The owner has not authorized live production inspection.

## 1. Baseline date correction — CONFIRMED

| Claim | Status | Evidence |
|---|---|---|
| The original baseline's capture time is **2026-09-30 20:24:52**, not 2 October. | VERIFIED IN CURRENT CHECKOUT | `supabase/baseline/000_live_baseline.sql` header: `-- Started on 2026-09-30 20:24:52`, also `supabase/baseline/history/000_live_baseline_2026-09-30.sql` (identical SHA-256). |
| 2 October was the approval date. | REPORTED INVESTIGATION FINDING | Stated in the request; DECISIONS.md references the baseline seeding 2026-09-30 and approvals on 2026-10-02 (`docs/DECISIONS.md`, line 7 region). Not re-checked line by line. |
| Server 17.6, pg_dump 18.6 | VERIFIED IN CURRENT CHECKOUT | Header lines `Dumped from database version 17.6` / `Dumped by pg_dump version 18.6`. |

## 2. Seven post-baseline production migrations — CONFIRMED in local evidence file

Source: `docs/governance/evidence/2026-10-18_production-schema-migrations.csv` (rebaseline worktree, untracked). Recorded from production migration history by an earlier investigation.

| # | Version | Name | Label |
|---|---|---|---|
| 1 | 20261011064653 | card_family_pages | VERIFIED IN CURRENT CHECKOUT (name/version present in CSV) |
| 2 | 20261011064710 | hide_unsupported_gallery_addon | VERIFIED IN CURRENT CHECKOUT |
| 3 | 20261011094328 | admin_create_tap_page_and_page_templates | VERIFIED IN CURRENT CHECKOUT |
| 4 | 20261011100305 | rerun_admin_create_tap_page_repeatable | VERIFIED IN CURRENT CHECKOUT |
| 5 | 20261014145548 | shygontap_studio_profiles_v1 | VERIFIED IN CURRENT CHECKOUT |
| 6 | 20261014145752 | shygontap_photo_cleanup_policy_v1 | VERIFIED IN CURRENT CHECKOUT |
| 7 | 20261015140944 | shygontap_site_content | VERIFIED IN CURRENT CHECKOUT |

Note: the request dated these "11–15 October". The version timestamps agree (2026-10-11 to 2026-10-15).

**Not verified:** the "44 objects", the bucket `shygontap-photos`, and "four storage policies" counts. The CSV does reference `shygontap-photos` (7 occurrences) and `shygontap_profiles` (24 occurrences), but no object count was computed in this pass. Label: UNVERIFIED (counts).

## 3. Reported findings awaiting revalidation

Each item below is a reported investigation finding. None has been re-proven against a fresh baseline.

| Finding | Status | What would verify it |
|---|---|---|
| The recorded statements changed product activation for the gallery add-on, transparent card products, and `plan-pro`, `plan-3d`, `plan-custom`, `plan-lifetime`. | REPORTED INVESTIGATION FINDING | Search the CSV for those SKUs/plan codes and compare to the fresh baseline's `products` seed data. |
| `shygontap_profiles` has grants broader than intended. | REPORTED INVESTIGATION FINDING. The CSV holds `GRANT`/`REVOKE` statements for other functions; a `GRANT ... shygontap_profiles` pattern was **not** found by search. | Read the fresh baseline's table-privilege section. |
| `tap_page_edit_state` allows anonymous invocation through default grants, though the function rejects anonymous callers internally. | REPORTED INVESTIGATION FINDING. CSV shows `REVOKE ALL ... FROM PUBLIC` and `GRANT EXECUTE ... TO authenticated`. Anonymous access would need the `anon` role grant, which is not in the CSV excerpt. | Fresh baseline + `has_function_privilege('anon', ...)` on production (requires authorization). |
| `admin_create_tap_page` references `tap_slug_reserved` and `tap_slug_taken`, reportedly defined in migration **019** but never applied to production. | **CONTRADICTED IN REPO (partly).** Migration `019_order_confirmation_sms.sql` does not define these functions. The name `tap_slug_reserved` does not appear in any tracked file in any worktree searched. The CSV does reference both names. | Locate the definition in production or in an unmerged/untracked file; fix the finding's source reference. |
| A later `get_public_profile` definition omitted card-family buttons supported by an earlier version. | REPORTED INVESTIGATION FINDING. CSV contains `get_public_profile` in 6 places, including `REVOKE ... FROM authenticated`, `REVOKE ALL ... FROM PUBLIC`, `GRANT EXECUTE ... TO anon`. | Diff the two definitions in the repo history after the fresh baseline. |
| None of the V6 migrations from 020 onward appear in production migration history. | REPORTED INVESTIGATION FINDING; consistent with DECISIONS.md, which says 020 and 028 are not applied to production. | Compare the production `supabase_migrations.schema_migrations` table (read-only, requires authorization). |
| The person, tool, and machine responsible for the drift are unknown. | UNVERIFIED | Owner input only. Do not speculate in code or docs. |

## 4. Live website uncertainty — DO NOT OVERSTATE

- **Verified:** the deployed JavaScript on www.shygontech.com (source not in this repo) contains a query path that reads `shygontap_profiles` by slug for `/shygontap/`. Source of this claim: backlog item V6-107 in `docs/v6/backlog.md` (rebaseline worktree, line 73). Label: REPORTED INVESTIGATION FINDING.
- **Not verified:** that a live profile page actually uses it. No live network request has been captured. Label: UNVERIFIED.
- **Required wording:** "Deployed code contains a query path to `shygontap_profiles`; live use is unverified."
- Backlog V6-107 is the item the owner intends to correct; DEC-2026-003 is the other item. (DECISIONS.md line 24 records DEC-2026-003 as the suspension-guard decision, **not** a website decision. The request's description of DEC-2026-003 as a website-related record is an inference that should be re-read against the actual file.)

## 5. Baseline capture intake — status

| Check | Status |
|---|---|
| Intake script exists | **NOT FOUND** in any checked-out worktree. VERIFIED IN CURRENT CHECKOUT (absence). |
| URL-encoded path bug fixed | UNVERIFIED (script absent) |
| Phone regex matching timestamps fixed | UNVERIFIED (script absent) |
| September dump passes intake | UNVERIFIED (script absent) |
| Fresh dump `000_live_baseline_2026-10-18.sql` | **NOT PRESENT**. VERIFIED IN CURRENT CHECKOUT. |

Required fresh-baseline command (documented in the request; **do not run by an agent** — requires the owner's secure password prompt and dashboard connection string; reproduced without credentials):

```bash
pg_dump --schema-only --no-owner --schema=public --verbose \
  --file 000_live_baseline_2026-10-18.sql \
  "postgresql://postgres.<project-ref>@<host>:5432/postgres"
```

Expected header checks (to be verified once the file exists): `Dumped from database version 17.6`, `Dumped by pg_dump version 18.x`, `Started on 2026-10-18 ...`, schema-only, verbose object markers present, no secret strings, SHA-256 and size recorded in provenance.

## 6. Inferences (not proven)

- INFERENCE: the seven migrations and the reported drift are the reason the owner decided to rebaseline before applying 020 or 028.
- INFERENCE: migration 025 must be rebased because the production `enforce_tap_edit_rules` (from `card_family_pages`) differs from the repo version. Not checked: the repo's `025_public_tap_privacy_and_analytics.sql` does not contain `enforce_tap_edit_rules`, so the dependency is inferred from the CSV, not from a file-to-file comparison.

## 7. Unknowns

- Whether production currently has the `shygontap_profiles` table with four published rows (V6-107 states this; not verified).
- Whether `shygontap-photos` bucket policies match the repo (no repo copy identified).
- Whether production's `admin_users` table matches the `user_id`-based check in `supabase/functions/_shared/admin.ts`.

## 8. Required next checks (all need owner authorization for production)

1. Obtain the fresh baseline; run the intake checks (see TESTING_GUIDE).
2. Diff the fresh baseline against `supabase/migrations` on the rebaseline branch.
3. Confirm or refute each §3 finding with the fresh baseline before any fix.
4. Only with explicit owner approval: read-only grant checks on production.
