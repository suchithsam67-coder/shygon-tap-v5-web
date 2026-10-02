# SHYGON OS — M1 Database Plan

> Planning document (M1.0).
> - **No migration is written, and none may be, until DEC-2026-023 is APPROVED.**
> - No production change.
> - Origin assumed: **live baseline** (DEC-2026-023 Option A, recommended; OPEN).
> - Live facts are from `supabase/baseline/000_live_baseline.sql` and `docs/governance/SCHEMA_DRIFT_REPORT.md`.

## 1. Live inventory (OBSERVED; public schema)

30 tables, all with RLS enabled:
- `admin_users`, `customers`, `profiles`, `ui_plans`, `tap_profiles`, `cards`, `customizations`, `customer_customizations`;
- `orders`, `products`, `payments`, `entitlements`, `webhook_events`, `order_items`;
- `notifications`, `support_tickets`, `support_messages`, `tap_events`, `account_events`, `tap_event_themes`, `order_item_fulfillment_actions`;
- `admin_allowed_email_domains`, `admin_audit_log`, `admin_notifications`, `admin_notification_reads`, `admin_push_tokens`, `inventory_movements`;
- `card_otp_challenges`, `card_editions`, `order_status_history`.

Also: 93 functions, 18 triggers, 55 policies. No views, sequences or custom types.

## 2. The reuse check (mandatory before any object is proposed)

For every candidate object, in order:
1. **Live baseline:** does it, or an equivalent, exist?
2. **Migrations:** does a repository migration define it? Was that applied?
3. **Drift report:** is it live-only, repo-only or conflicting?
4. **Conflicts:** naming, keys, semantics, frozen contracts.
5. **Decision:** reuse / extend (additive) / new / defer, with the DEC.

**Stop rule:** if an existing object can be reused, it is reused. No `*_v2` tables without an approved DEC.

## 3. Reuse register (M1 candidates)

| Concept (brief) | Live today | Decision (PROPOSAL) | Form | DEC / gate | Milestone |
|---|---|---|---|---|---|
| users | `auth.users` | **reuse** | — | — | — |
| customers | `customers` (C; `CUST-…`) | **reuse** | none; contract rules only | 029 | M1.2 |
| profiles (account) | `profiles` | **reuse/extend** | none in M1; `shygon_id` later | 029 | — |
| profiles (persona) | `tap_profiles` | **extend** | `+context text DEFAULT 'professional'`, `+category text NULL`, `+is_default bool DEFAULT true`, `+field_visibility jsonb DEFAULT '{}'`; keep `UNIQUE(customer_id)` | 032, (025 for `org_id`) | M1.4 |
| persona history | — | **new** | `tap_profile_versions(id, tap_profile_id, snapshot jsonb, created_at)`, last 10, trigger-written | — | M1.4 |
| verified contacts | `profiles.phone/email` (unverified drafts) | **new** (do not overload `profiles`) | `contact_methods(id, user_id, kind, value_normalized, verified_at, verification_method, high_risk_eligible_after, created_at)` | 022/005 | M1.2 |
| step-up | `card_otp_challenges` (card-scoped) | **extend pattern, new table** | `otp_challenges` generalized (purpose) **or** extend `card_otp_challenges` with `purpose` — **choose at M1.2**; `step_up_tokens(id, user_id, purpose, expires_at, consumed_at)` | 022/005 | M1.2 |
| cards (device) | `cards` (dual status) | **extend** | `+public_code text` (unique, backfilled), `+device_kind`, `+auth_mode DEFAULT 'static'`, `+lost_at`, `+retired_at`, `+transfer_token_hash`, `+transfer_expires_at`; **CHECK on `status`** (NOT VALID → VALIDATE) | 028 | M1.3 |
| card lifecycle history | `admin_audit_log`, `account_events` | **reuse** (unified audit + domain events) | no `card_events` table | — | M1.1/M1.3 |
| card replacement | `request_card_replacement()` (live fn), `cards.is_replacement` | **reuse** | re-point to `device_transition` | 028 | M1.3 |
| NFC/QR identity | `cards.card_uid` (inventory), `card_id` (legacy code) | **extend** | `public_code` only; `card_id` never becomes a routing key | 028 | M1.3 |
| routing | — | **new** | `tap_routes(id, device_id → cards, target_kind, target_id, priority, condition jsonb, enabled, valid_from, valid_until, created_by)`; composite FK so the target has the same owner | 022 (F3) | M1.5 |
| organisations | — | **defer** | `organizations`, `memberships`, `org_role_permissions` | **025** + G3 + OQ-9 | Phase 2 |
| roles/permissions (platform) | `admin_users`, `admin_role_permissions()` | **reuse/extend** | add namespaces in the function; **no `roles` / `permissions` tables** (doc 03 ✕) | — | M1.2 |
| audit | `admin_audit_log` (7 cols) | **extend** | `+actor_kind`, `+org_id`, `+request_id`, `+ip_hash`, `+outcome`, `+category`; append-only trigger; `audit_event()` definer; `admin_audit()` kept | — | M1.1 |
| operational events | `order_status_history`, `account_events` (feed) | **reuse + new outbox** | `domain_events(id, type, aggregate, aggregate_id, org_id NULL, payload jsonb, created_at, processed_at, attempts, last_error)`; server-only | — | M1.1 |
| security events | — | **reuse audit** | `category='security'` rows + log drain; optional view `security_events` | — | M1.1 |
| analytics | `tap_events` | **extend** | `+device_id`, `+route_kind`, `+trust_level`, `+source`, `+country_code`, `+device_class`; HMAC v2 | 010 | M1.7 |
| analytics rollups | — | **new** | `tap_daily_stats(day, subject_kind, subject_id, views, nfc, qr, link_clicks, uniques_approx)` | — | M1.7 |
| notifications | `notifications` (in-app), `admin_notifications` | **extend + new** | `notifications +dedupe_key, +severity, +expires_at`; new `notification_deliveries`, `notification_preferences`; templates in the repository (not the DB) | 031 | M1.6 |
| support | `support_tickets`, `support_messages` | **extend + new** | tickets `+priority`, `+assigned_admin_id`, `+first_response_at`, `+resolved_at`; new `support_internal_notes(id, ticket_id, admin_id, body, created_at)` (admin-only) | — | M1.8 |
| feature flags / kill switches | — | **new** | `platform_config(key, value jsonb, updated_by, updated_at)` + `feature_flags(key, stage, percentage, allow_users[], deny_users[], kill, owner, expires_at, updated_by, updated_at)` | — | M1.1 |
| payments | `orders`, `payments`, `webhook_events` | **reuse, frozen** | none | 024 | — |
| fulfilment | `order_item_fulfillment_actions`, `fulfil_order()` (live, unused) | **reuse, frozen** | none until DEC-024 | 024 | M1.9 |
| catalogue (legacy) | `ui_plans`, `customizations`, `customer_customizations` | **reuse or ignore** | never duplicate; no new catalogue tables | — | — |
| AI | — | **defer** | no tables in M1 | doc 09 | — |
| jobs (async) | — | **defer** | `jobs` when bulk work exists | — | later |

## 4. Migration conventions (inherited from doc 12 §4.1; binding)

1. **Numbering:** `020_…` onward. **001–019 are history, never edited, never re-run on live** (drift report §11.5).
2. **Header:** purpose, dependencies, rollback SQL, post-apply verification SQL, data class.
3. **Idempotent:** `IF NOT EXISTS`, `CREATE OR REPLACE` only for *new* functions, `DROP POLICY IF EXISTS` + `CREATE POLICY` for new policies only.
4. **Additive only through Phase 2.** No drops, renames or type changes of existing columns. No signature changes to frozen functions (plan §2).
5. **Constraints:** `NOT VALID` first; `VALIDATE` in a later migration after a data check (with live counts done by a human, read-only).
6. **Backfills:** batched, with a progress table. **Indexes:** `CREATE INDEX CONCURRENTLY` in their own file (outside transactions).
7. **Every new table:**
   - RLS enabled;
   - explicit policies, **or** "server-only" (no policies + `REVOKE ALL FROM anon, authenticated`);
   - targeted `GRANT`s.
   - **Note:** Supabase default privileges grant ALL on new tables to `anon` / `authenticated` (OBSERVED DEFAULT ACL). Every new table must therefore revoke explicitly.
8. **Every definer function:** `SET search_path = public, pg_temp`; `REVOKE ALL … FROM PUBLIC` **and from anon** unless public by design (default privileges grant EXECUTE to anon); explicit GRANT.
9. **Data classification comment** on every new table and column: `COMMENT … 'class=S0..S4;retention=…;pii=…'` (doc 14 §3.15).
10. **Keys:** person-owned rows carry `user_id` (U). `customer_id` (C) only where commercially required, filled **server-side** (DEC-2026-029).

## 5. Validation of every migration (before review)

| Check | Tool |
|---|---|
| Applies on the **live baseline** + platform shim, twice (idempotent) | `db:apply` on the baseline (DEC-2026-023 harness) |
| Produces **only the intended diff** vs the baseline | `node supabase/tests/schema-drift.mjs` (catalog diff) |
| Rules hold | `db:verify` (extended) |
| No authorization weakening | `rls-adversarial` on the baseline (+ new cases) |
| Frozen contracts unchanged | admin-contract snapshot, golden `/t/` test |
| Definer hygiene | `lint-definer.mjs` (to add) |
| Classification present | `data-class-lint.mjs` (to add, M1.11) |

## 6. Proposed migration sequence (M1; each L3; each needs DEC-2026-023 + Security/Data Owner)

| # | File (proposed) | Content | Milestone | Gates |
|---|---|---|---|---|
| 020 | `020_platform_config_flags.sql` | `platform_config`, `feature_flags`, `flag_enabled()`, `admin_set_flag()` | M1.1 | DEC-023 |
| 021 | `021_audit_generalization.sql` | audit columns, `audit_event()`, append-only trigger | M1.1 | DEC-023 |
| 022 | `022_domain_events_outbox.sql` | `domain_events`, `publish_domain_event()` | M1.1 | DEC-023 |
| 02x | security migrations per DEC-2026-022 (F1 guards, F2 notes table, O-1 revoke) | — | M0.3 / M0.4 | DEC-022, DEC-023 |
| 030 | `030_identity_contract.sql` | DEC-024 fix (option per decision) + `customer_id` normalisation | M1.2 | **DEC-024, DEC-029** |
| 031 | `031_contact_methods_step_up.sql` | verified contacts, step-up tokens, OTP generalization | M1.2 | DEC-022 |
| 032 | `032_device_lifecycle.sql` | card columns, `status` CHECK NOT VALID, `device_transition()`, RPCs | M1.3 | **DEC-028**, DEC-002 |
| 033 | `033_device_public_code_backfill.sql` | batched `public_code` backfill + unique index (CONCURRENTLY, separate file) | M1.3 | DEC-028 |
| 034 | `034_persona_foundation.sql` | persona columns, versions, visibility back-fill (behaviour-preserving) | M1.4 | DEC-032 (taxonomy) |
| 035 | `035_tap_routes.sql` | routes + `resolve_tap()` | M1.5 | DEC-022 (F3), DEC-028 |
| 036 | `036_notifications_platform.sql` | deliveries, preferences, notification columns | M1.6 | DEC-031 |
| 037 | `037_analytics_v2.sql` | `tap_events` columns, HMAC, rollups, retention | M1.7 | DEC-010 |
| 038 | `038_support_foundation.sql` | ticket columns, `support_internal_notes` | M1.8 | — |
| 039 | `039_data_classification_comments.sql` | comments on existing tables (no behaviour change) | M1.11 | — |

Numbers are placeholders. Final numbering is assigned when each migration is approved.

## 7. Backfill & compatibility rules

- **`public_code`** for existing cards: generated server-side (`gen_random_bytes` must resolve; **VERIFY the pgcrypto schema first**, O-6).
- **`field_visibility`:** today's enabled fields → `public`; everything else → `private`. A golden test proves `get_public_profile` output is identical before and after.
- **`status` CHECK:** a human runs a read-only count of the distinct `status` values on live before VALIDATE.
- **Legacy `card_status`** and `tap_profiles.suspended`: never written by new code. They are mapped or frozen per DEC-2026-028.

## 8. What this plan explicitly does **not** do
- It creates no organisation tables (DEC-2026-025).
- It renames or drops nothing.
- It creates no duplicate identity, persona, card or order tables.
- It writes nothing to production. Application happens via the approved pipeline (doc 12 M1.13) or a documented human break-glass.
