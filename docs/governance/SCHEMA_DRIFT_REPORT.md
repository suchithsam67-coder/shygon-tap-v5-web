# Schema Drift Report: live baseline vs repository migrations (M0.2)

| | |
|---|---|
| Date | 2026-09-30 (analysis) · 2026-10-02 (written up) |
| Live baseline | `supabase/baseline/000_live_baseline.sql`: `pg_dump --schema-only --schema=public` of the live project (server 17.6, pg_dump 18.6). 274,597 bytes, sha256 `c12b46eb…`. **Authoritative** for the current production schema. |
| Repository | `supabase/migrations/001…019` (18 files; 011 exists only as a proposal), as built by `npm run db:apply` |
| Tool | `node supabase/tests/schema-drift.mjs --replay --json <out>`. Reproducible, read-only, in-memory PGlite only. |
| Production touched | **No.** No production query was run by Claude Code. The triage counts in §12 were run by the repository owner. |
| Evidence labels | **OBSERVED** (read from the dump or code) · **CONFIRMED** (reproduced in an isolated database) · **INTERPRETATION** · **UNKNOWN** |

---

## 1. Executive summary

1. **The baseline is valid and rebuilds cleanly.**
   - It is schema-only: no `COPY` blocks, and the only `INSERT` is inside a function body.
   - gitleaks finds 0 secrets. The `\restrict` line is pg_dump's random per-dump nonce, not a credential.
   - It applies to an empty database (492 of 493 entries). The one exception is `CREATE SCHEMA public`, which already exists in any new database.
2. **Every repository migration was applied to live**, but live has since diverged.
   - Migrations 005–019 are on live almost exactly. Only 4 items from 005 are absent, and 1 policy from 007 differs.
   - 001–004 are mostly on live, with differences.
3. **003 vs 013 (F6):** live carries 013's version of all 22 objects 013 redefined, plus 252 of the 294 objects 003 introduced, unchanged. The other 42 of 003's objects differ on live or are absent from it.
4. **Live has a pre-V5 layer the repository has never described.**
   - 5 tables: `customers`, `customizations`, `customer_customizations`, `ui_plans`, `order_status_history`.
   - Legacy columns on `cards`, `profiles`, `tap_profiles` and `orders`.
   - 11 live-only functions, including `expire_tap_cards()`, `customer_activate_card()`, `customer_deactivate_card()` and `fulfil_order()`.
5. **The repository cannot reproduce live.** Repo-built database vs live:

   | Object | Repo | Live |
   |---|---|---|
   | Tables | 25 | 30 |
   | Columns | 284 | 358 |
   | Functions | 83 | 93 |

6. **Re-applying the repository migrations to live (`npm run db:push`) is unsafe.**
   - The replay simulation raised no errors.
   - It would net-change 48 live objects.
   - It broke sign-up in the same simulation (§11.5).
7. **Several V5 code paths are incompatible with the live schema** (§11; CONFIRMED in isolation). The most serious: on the live schema a first-time buyer's order cannot be marked paid. **Production triage found no occurrence** (mismatch 0, retry 0), but **6 existing customers are exposed**. This is tracked as a **P1 latent defect** in DEC-2026-024.

## 2. Repository schema (as `db:apply` builds it)
- 25 tables, 284 columns, 83 functions, 20 triggers, 46 policies.
- RLS is enabled on every table.
- The pre-001 tables come from `supabase/tests/baseline.sql`, a hand-written stand-in reconstructed from migration 002's header (`profiles`, `orders`, `products`, `tap_profiles`, `admin_users`). It is **not** live.

## 3. Live schema (from the baseline)
- 30 tables, 358 columns, 93 functions, 18 triggers, 55 policies, 111 constraints, 93 indexes. There are no views, sequences or custom types in `public`.
- RLS is enabled on all 30 tables. None uses FORCE RLS.
- **Table generations.** These are inferred from object IDs (OIDs, which increase as objects are created; OBSERVED values, INTERPRETED as creation order):

  | Generation | Approx. OID | Tables |
  |---|---|---|
  | 0 — pre-V5 | 17.5k | `admin_users`, `customers`, `profiles`, `ui_plans`, `tap_profiles`, `cards`, `customizations`, `customer_customizations` |
  | 1 — V5 core | 25.5k | `orders`, `products`, `payments`, `entitlements`, `webhook_events`, `order_items`, `notifications`, `support_*`, `tap_events`, `account_events`, `tap_event_themes`, `order_item_fulfillment_actions` |
  | 2 — admin platform | 41.8k | the admin tables (003/013) |
  | 3 — newest | 50.2k | `card_otp_challenges` (015), `card_editions` (017), then `order_status_history`. That table is **newer than every migration** and is not in the repository. |

- **Not covered by a `--schema=public` dump.** VERIFY ON LIVE:
  - extensions, and in particular where `pgcrypto` is installed;
  - the `auth` schema, including triggers on `auth.users`;
  - storage buckets and policies;
  - realtime publication membership (014);
  - cron jobs (is `expire_tap_cards()` scheduled?);
  - Vault;
  - data-only migrations (016, 018).

## 4. Migration lineage (F6)

Comparison is semantic: comments and whitespace are ignored, because live stores compacted bodies. Column meanings:
- **changed:** objects the migration created or altered.
- **=live:** live has exactly that version.
- **later=live:** a later migration's version is the one on live.
- **different:** live has another version.
- **absent:** not on live.

| Migration | changed | =live | later=live | different | absent |
|---|---|---|---|---|---|
| 001 production payments & catalog | 89 | 81 | 2 | 1 | 5 |
| 002 shygon v5 platform | 222 | 156 | 12 | 12 | 42 |
| 003 admin platform | 294 | 252 | 20 | 12 | 10 |
| 004 experiences, status & edit window | 107 | 79 | 2 | 9 | 17 |
| 005 event themes & rule hardening | 40 | 36 | 0 | 0 | 4 |
| 006 fulfilment retry state | 4 | 4 | 0 | 0 | 0 |
| 007 rls performance & rpc permissions | 10 | 9 | 0 | 1 | 0 |
| 008 tighten event function permissions | 0 | 0 | 0 | 0 | 0 |
| 009 v5 complete event & stock safety | 14 | 14 | 0 | 0 | 0 |
| 010 fix card stock timestamp | 1 | 1 | 0 | 0 | 0 |
| 012 products anon read | 2 | 2 | 0 | 0 | 0 |
| 013 admin platform live | 22 | 22 | 0 | 0 | 0 |
| 014 realtime notifications | 0 | — | — | — | — (a publication; not visible in this dump) |
| 015 card OTP activation | 20 | 20 | 0 | 0 | 0 |
| 016 card art image urls | 0 | — | — | — | — (data only) |
| 017 limited edition numbers | 27 | 27 | 0 | 0 | 0 |
| 018 design collection products | 0 | — | — | — | — (data only) |
| 019 order confirmation sms | 2 | 2 | 0 | 0 | 0 |

### F6 in the required format

**MIGRATION: 003_admin_platform.sql vs 013_admin_platform_live.sql**
- **REPOSITORY STATE:** both run in sequence. 013 redefines 22 of 003's objects (policies and `get_public_tap`).
- **LIVE STATE:**
  - All 22 objects carry 013's version.
  - 252 of 003's objects are present exactly as 003 wrote them.
  - 12 differ: NOT NULL/defaults on `admin_audit_log` and `admin_notifications`; `inventory_movements.sku` is `text`; the `admin_users_role_valid` check is validated; the `admin_audit_log` FK is `ON DELETE RESTRICT`; and grants are tighter.
  - 10 are absent: the domain-format check; `admin_push_tokens`' unique constraint, which exists on live as the index `idx_admin_push_tokens_token`; and the `anon` grants.
- **DIFFERENCE:** live = 013 ∪ (003 − 013's redefinitions) + manual hardening.
- **IMPACT:** the fork itself is harmless on live. A fresh rebuild from the repository is not live, though: the admin tables would be looser.
- **SAFE MIGRATION PATH:** treat the baseline as the origin (DEC-2026-023, Option A). Never re-run 003 or 013 on live.
- **REQUIRES HUMAN APPROVAL:** YES (Data Owner, Security Owner).

**MIGRATION: 002_shygon_v5_platform.sql (`cards`)**
- **REPOSITORY STATE:** `CREATE TABLE IF NOT EXISTS public.cards (…)` defines `user_id`, `order_id`, `sku`, `card_uid`, `status`, `is_replacement`. No repository migration adds these columns to an existing table.
- **LIVE STATE:** `cards` predates V5 (generation 0). Its column order is:
  1. legacy columns (`card_id NOT NULL`, `customer_id`, `card_type`, `card_status`, `nfc_url`, …);
  2. the V5 columns;
  3. the live-only activation columns;
  4. 017's edition columns;
  5. `nickname`.
- **DIFFERENCE:** 002's create was a no-op on live. The V5 columns were added outside the migrations.
- **IMPACT:** two card models share one table (§7.1). The V5 fulfilment insert is incompatible with it (§11.3).
- **SAFE MIGRATION PATH:** baseline as origin. Any change to `cards` follows a lifecycle decision (DEC-2026-002, DEC-2026-022).
- **REQUIRES HUMAN APPROVAL:** YES.

**MIGRATION: the pre-001 tables (`supabase/tests/baseline.sql`)**
- **REPOSITORY STATE:** a hand-written stand-in for `profiles`, `orders`, `products`, `tap_profiles`, `admin_users`.
- **LIVE STATE:** 32 column conflicts, mainly on these tables:
  - `orders` money and status columns are `numeric(12,2)` / `text NOT NULL`, against `numeric(10,2)` / `varchar`;
  - `profiles.customer_id`, `tap_profiles.customer_id` and `tap_profiles.username` are NOT NULL;
  - `tap_profiles.card_id` is `uuid`, against `text`.
- **DIFFERENCE:** the stand-in is inaccurate.
- **IMPACT:** tests built on it (`db:verify`, `rls-adversarial`) prove properties of a schema that is not production.
- **SAFE MIGRATION PATH:** run the test suites against the baseline once DEC-2026-023 is approved.
- **REQUIRES HUMAN APPROVAL:** YES.

## 5. Specific investigation targets

| Object | LIVE | REPOSITORY | BOTH | LIVE ONLY | REPOSITORY ONLY | CONFLICTING |
|---|---|---|---|---|---|---|
| `expire_tap_cards()` | yes | no | — | **yes** | — | — |
| `cards.activated_at` | yes | no | — | **yes** | — | — |
| `cards.activation_expires_at` | yes | no | — | **yes** | — | — |
| `cards` table | 29 columns | 14 columns | 14 columns | 15 columns | 0 | 2 (`status` and `user_id` are nullable on live, NOT NULL in the repo) |
| 003/013 lineage | 013 ∪ 003 remainder | both files | — | manual hardening | — | 12 objects of 003 |

**OBSERVED:**
- **`expire_tap_cards()`** (SECURITY DEFINER, `search_path = public, pg_temp`) runs `UPDATE cards SET status='suspended', deactivated_at = COALESCE(deactivated_at, now()) WHERE status='active' AND activation_expires_at <= now()`.
- **`customer_activate_card(card, code)`**:
  - checks the printed activation code against the caller's own card;
  - sets `status='active'` and `activation_expires_at = now() + interval '14 days'`.
- **`customer_deactivate_card`** sets `status='suspended'`.
- Both are executable by `authenticated`.

**UNKNOWN:** whether `expire_tap_cards()` is scheduled. That needs `cron.job` on live, which this dump doesn't include.

**INTERPRETATION:** the 14-day expiry is real on live. Whether it runs depends on the schedule. Decision DEC-2026-002 still governs it.

## 6. Live-only objects

| Kind | Count | Objects |
|---|---|---|
| Tables | 5 | `customers` (`id` random, `user_id` unique, `customer_id` 'CUST-…'), `customizations`, `customer_customizations`, `ui_plans`, `order_status_history` |
| Columns on shared tables | 32 | **`cards`:** `activated_at`, `activation_code` NOT NULL, `activation_count`, `activation_expires_at`, `assigned_at`, `card_id` NOT NULL UNIQUE, `card_slot`, `card_status`, `card_type`, `customer_id`, `deactivated_at`, `last_activation_at`, `nfc_url`, `nickname`, `qr_code_url` · **`orders`:** `custom_note`, `delivery_fee_in_paise`, `discount_in_paise`, `email_provider_id`, `email_sent_at`, `email_status`, `promo_code` · **`profiles`:** `show_email/instagram/linkedin/location/phone/website/whatsapp` · **`tap_profiles`:** `suspended`, `ui_plan_id` · **`admin_notifications`:** `read_at` |
| Columns on the 5 live-only tables | 42 | — |
| Functions | 11 | `expire_tap_cards`, `customer_activate_card`, `customer_deactivate_card`, `fulfil_order` (not called by any code), `request_card_replacement`, `set_card_nickname`, `get_card_tap_history`, `cards_issue_activation_code` (trigger), `record_order_status_history` (trigger), `admin_set_product_inventory`, `admin_update_order_shipping` |
| Triggers | 2 | `trg_cards_activation_code` (BEFORE INSERT on cards), `orders_status_history_trigger` |
| Constraints | 38 | 19 on the legacy tables. On shared tables they include `cards_card_id_key`, `cards_status_check` (on `card_status`), `profiles_customer_id_fkey` → customers, `tap_profiles_customer_id_fkey` → customers, `tap_profiles_username_key`, `orders_order_id_key`, `admin_users_pkey`. |
| Indexes | 37 | One is a rename (`idx_admin_push_tokens_token`). The rest back the constraints above, plus `idx_cards_order_sku_slot` UNIQUE (`order_id`, `sku`, `card_slot`) |
| Policies | 20 | 8 × `*_select_owner_or_admin` (TO `public`, `is_admin()`), 5 × `*_api_none` (USING false), 4 admin notification-reads policies, `admin_allowed_domains_admin_select`, `entitlements_select_own`, `order_status_history_customer_read` |

## 7. Repository-only objects

| Kind | Count | Objects |
|---|---|---|
| Functions | 1 | `tap_profiles_track_publication()` |
| Triggers | 4 | `trg_tap_profiles_publication`; `touch_updated_at` triggers on `cards`, `support_tickets` and `tap_profiles` |
| Constraints | 10 | `tap_profiles_slug_format`, `tap_profiles_published_needs_slug`, `tap_profiles_custom_links_shape`, the FKs `profiles.id`/`tap_profiles.user_id`/`cards.user_id` → `auth.users` and `cards.order_id` → orders, `admin_allowed_email_domains_domain_check`, `admin_push_tokens_expo_token_key` (exists on live as an index), `tap_event_themes_dates_valid` (live has the equivalent `tap_event_themes_dates`) |
| Indexes | 5 | `idx_cards_order_sku` (partial unique), `idx_notifications_unread`, `idx_support_tickets_user`, `idx_support_messages_ticket`, `admin_push_tokens_expo_token_key` (a rename) |
| Policies | 11 | `*_select_own` (replaced on live by the combined owner-or-admin policies), `support_tickets_close_own`, "Anyone can view active products" (live has `products_select_active`), "Customers can view their entitlements" (live has `entitlements_select_own`) |

### 7.1 The `cards` dual model (OBSERVED)
Live `cards` carries two state columns:
- **`card_status`**: CHECK `inventory | assigned | active | suspended | replacement | retired`, default `inventory`.
- **`status`**: `varchar(32)`, default `pending`, nullable, with **no CHECK**. `expire_tap_cards`, the customer activation functions and `card_apply_verified_action` all write this one.

**INTERPRETATION:** the lifecycle of record is `status`, but it is unconstrained on live.

## 8. Conflicting objects (same name, different definition)
- **Columns (32):** type, NOT NULL and default differences on `orders`, `products`, `profiles`, `tap_profiles`, `admin_*`, `inventory_movements` and `cards` (§4).
- **Constraints (2):**
  - `admin_audit_log_admin_id_fkey`: live `ON DELETE RESTRICT`, repo `SET NULL`;
  - `admin_users_role_valid`: validated on live, `NOT VALID` in the repo.
- **Functions:**
  - **14 cosmetic:** comments and layout only. These include `get_public_profile`, `get_public_tap_state`, `card_apply_verified_action`, `enforce_tap_edit_rules`, `cards_assign_edition`.
  - **11 differ in logic:** see §10.
  - **5 differ only in configuration:** live pins `search_path` on `canonical_experience`, `tap_edit_interval_days`, `tier_rank`, `touch_updated_at`, `notifications_only_read_state`.
- **Grants (3):** live gives `authenticated` only `SELECT` on `admin_audit_log` and `admin_notifications`, and no `MAINTAIN`/`TRUNCATE` on `admin_notification_reads`.

## 9. RLS differences

**OBSERVED:**
- **Enablement:** RLS is on for all 30 live tables.
- **Customer reads:** on live these go through 8 combined `*_select_owner_or_admin` policies, TO `public`, using `user_id = (SELECT auth.uid()) OR (SELECT is_admin())`. This confirms F6(d) and LIVE_SUPABASE_STATE.md, which counted 7; there are 8, including `tap_profiles`.
- **Admin reads:** the `*_select_admin` policies (`admin_has(…)`) are identical to the repository's.
- **The 4 legacy tables** deny all API access (`USING false`).
- **`order_status_history`:** customers can read rows for their own orders.
- **Conflicts (2):**
  - `account_events_select_own` (expression form only; semantically equal);
  - `admin_users_self_read` (TO `authenticated` on live, `public` in the repo).

**Facts recorded for later F1 verification. No verdict is given here; that is M0.3 work and is gated by DEC-2026-022:**
- live `profiles_update_own` and `tap_profiles_update_own` are row-level only (owner = `auth.uid()`);
- no live trigger on `profiles` or `tap_profiles` references `suspended_*`;
- customers have no UPDATE policy on `cards`.

**RECOMMENDATION:** run `rls-adversarial` against the baseline as part of DEC-2026-023.

## 10. RPC differences

**RPCs the code calls:**
- **OBSERVED:** all of them exist on live with the same signature.
- **Identical on live and in the repo** (comments aside): the public Tap and card-OTP RPCs, `get_public_profile`, `get_public_tap_state`, `record_tap_event` and `card_apply_verified_action`.
- **Same signature, different logic:** `claim_tap_slug`, `generate_tap_slug`, `tap_edit_state`, `get_tap_analytics` and `get_tap_link_clicks`. The last two differ only in column aliases.

**Logic differences, live vs repo:**

| Function | Live | Repo |
|---|---|---|
| `handle_new_user` (sign-up) | creates a `customers` row and upserts the profile | profile only, `ON CONFLICT DO NOTHING` |
| `provision_tap_on_payment` | creates the Tap **published/active** at the purchased experience; inserts `customer_id = user_id` | creates it as a draft at the essential experience |
| `notify_order_change` | ignores the customer's opt-out | honours `notify_order_updates` |
| `claim_tap_slug` / `generate_tap_slug` | reserves more words (`cards`, `qr`, `terms`, policy slugs, …) | fewer reserved words |
| `tap_profiles_sync_status` | enforces "claim a slug before publishing" | relies on the CHECK constraint, which is absent on live |
| `theme_options`, `tap_edit_state` | different pass/next-edit logic | — |

**Grants:** live is **stricter**.
- `EXECUTE` is revoked from `anon`/`PUBLIC` on 17 functions, including `is_admin()`, `claim_tap_slug`, `tap_edit_state` and all trigger functions.
- Live-only grants let `authenticated` call `customer_activate_card`/`customer_deactivate_card`, `request_card_replacement`, `set_card_nickname` and `get_card_tap_history`. This is a second card-activation route, by printed code. It is relevant to F4.

## 11. Trigger differences and runtime conflicts

**Triggers:**
- 16 are identical.
- **Live-only:** activation-code issue and order-status history.
- **Repository-only:** three `updated_at` triggers and publication tracking.

**Runtime conflicts.** The live schema meets the V5 code. Each was CONFIRMED in an isolated rebuild of the baseline and compared with the repository schema.

| # | Path | Live schema | Repo schema |
|---|---|---|---|
| 11.1 | Fulfilment claim `UPDATE orders SET payment_status='paid'` (`fulfilment.mjs:93`) for a first-time buyer created by live sign-up → trigger `trg_orders_provision_tap` | **FAILS** `23503 tap_profiles_customer_id_fkey` | succeeds |
| 11.2 | Settings / Checkout profile save `customer_id: user.id` (`Settings.tsx:86`, `Checkout.tsx:330`) | **FAILS** `23503 profiles_customer_id_fkey` | succeeds |
| 11.3 | Card record creation `upsert onConflict 'order_id,sku'` (`fulfilment.mjs:249`) | **FAILS** `42P10` (no matching unique index); without the conflict target, `23502 card_id NOT NULL` | **FAILS** `42P10` (the repo index is partial) |
| 11.4 | Fulfilment safety net creating a Tap profile `customer_id: userId` (`fulfilment.mjs:331`) | **FAILS** `23503 tap_profiles_customer_id_fkey` | succeeds |
| 11.5 | `npm run db:push` (re-apply 001–019 to live), then sign-up | **sign-up FAILS** `23503 profiles_customer_id_fkey`; 48 live objects reverted | — |

**Root cause (INTERPRETATION):**
- Live keys `customer_id` to `customers.id`, a random UUID created by live sign-up.
- V5 code and live's own `provision_tap_on_payment` assume `customer_id = auth user id`.
- Separately, the `cards` upsert's conflict target has never matched a usable unique index in either schema.
- **Swallowed errors:** 11.3 and 11.4 are logged, not thrown. 11.1 is thrown.

**VERIFY ON LIVE:**
- The activation-code trigger calls `gen_random_bytes` unqualified with `search_path = public, pg_temp`. It works only if `pgcrypto` is installed in `public`, which is not visible in this dump.

## 12. Risk assessment

| ID | Risk | Evidence | Rating |
|---|---|---|---|
| R1 | **Paid order cannot be marked paid** (§11.1) | CONFIRMED in isolation. Production triage (owner, 2026-10-02): mismatch **0**, retry **0**, customers exposed **6**, FK not deferrable, trigger enabled per the dump (the live re-read returned "0", which needs one confirmation). | **P1 latent.** Becomes P0 if live payments are on and an exposed customer pays before a fix, or if any mismatch is greater than 0. DEC-2026-024. |
| R2 | `db:push` against production silently reverts 48 objects and breaks sign-up | CONFIRMED in simulation | High; DEC-2026-023 |
| R3 | The test suites validate a schema that is not production | OBSERVED (§4) | High for every future DB change; DEC-2026-023 |
| R4 | Card records are never created by fulfilment (no activation, no edition number) | CONFIRMED (§11.3) | Medium; DEC-2026-024 |
| R5 | Profile save fails for customers created by live sign-up | CONFIRMED (§11.2) | Medium (customer-visible); DEC-2026-024 |
| R6 | Two card status columns, with the authoritative one unconstrained | OBSERVED (§7.1) | Medium; DEC-2026-002 / DEC-2026-022 |
| R7 | Unknown platform objects (pgcrypto location, auth triggers, storage, cron) | not in the dump | Medium; VERIFY ON LIVE |

## 13. Recommended migration strategy (needs approval: DEC-2026-023)
Treat the baseline as the origin (doc 12 M0.2 "Then", Option A):
- `000_live_baseline.sql` plus the platform shim becomes the starting point for local databases and tests. New work starts at `020_…`.
- 001–019 stay in the repository as history, marked "applied on live" in `supabase/migrations/README.md`. They are **never re-run**.
- `db:verify`, `rls-adversarial` and the probes run against the baseline. Expect new failures: they would be real findings about production, not regressions.
- Guard `npm run db:push` so it cannot target the live project, until the M1.13 approved pipeline exists.

Every new migration must:
- apply cleanly on the baseline;
- re-apply idempotently;
- show the intended diff, and only that, in `schema-drift.mjs`.

## 14. Human decisions required

| Decision | Owner (role) | Status |
|---|---|---|
| DEC-2026-023: migration strategy and the `db:push` safeguard | Data Owner (UNASSIGNED) | OPEN — HUMAN DECISION REQUIRED |
| DEC-2026-024: live-schema runtime incompatibilities, including the P1 paid-claim defect | Security Owner (UNASSIGNED) | OPEN — HUMAN DECISION REQUIRED |
| DEC-2026-002: 14-day card activation expiry (now confirmed on live) | Product Owner (UNASSIGNED) | OPEN |
| DEC-2026-022: M0.3 scope | UNASSIGNED | OPEN |
| VERIFY ON LIVE: pgcrypto location, `auth.users` triggers, storage policies, realtime publication, whether `expire_tap_cards` is scheduled, the trigger `tgenabled` byte | Data Owner | HUMAN ACTION REQUIRED |
