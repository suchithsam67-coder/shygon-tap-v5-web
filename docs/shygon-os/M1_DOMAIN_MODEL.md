# SHYGON OS — M1 Domain Model

> Planning document (M1.0). No objects are created by this document.
> Column facts are **OBSERVED** from `supabase/baseline/000_live_baseline.sql` unless marked PROPOSAL.
> Companion to `M1_ARCHITECTURE_PLAN.md` §4–§8.

## 1. Principles

1. **Reuse before create.** Every concept below maps to an existing table where one exists. No `*_v2` tables, and no tables per vertical.
2. **One identity spine for every product and vertical.** Verticals are data (persona context, category, organisation kind, route rules), not schema.
3. **Identity ≠ device ≠ account.**
   - A **persona** is what the world sees.
   - A **device** is how the world reaches it.
   - An **account** is who controls it.
4. **Existing stored names are kept** (D6). This document gives them their domain meaning.

## 2. Identity spine and boundaries

| Layer | Domain name | Table (live) | Key | Key relationships (OBSERVED) |
|---|---|---|---|---|
| Authentication | Auth user | `auth.users` | `id` = **U** | Supabase-managed; never queried by clients |
| Commercial account | Customer | `customers` | `id` = **C** (random UUID) | `user_id` = U (unique, NOT NULL); `customer_id` text `CUST-…` (unique, NOT NULL); `account_status` ∈ active/suspended/disabled |
| Account record (private) | Account profile | `profiles` | `id` = **U** | `customer_id` = C (NOT NULL, UNIQUE, FK → `customers.id`); contact drafts (`phone`, `whatsapp`, `email`, …); legacy `show_*` flags; `suspended_at`, `suspended_reason`; `notify_*` preferences |
| Public identity | **Persona** | `tap_profiles` | `id` = **P** | `user_id` = U (nullable on live); `customer_id` = C (NOT NULL, **UNIQUE** → one persona per customer today); `username` NOT NULL UNIQUE; `slug`; `status`/`published`; legacy `suspended` bool + `suspended_at/_by/_reason`; `ui_plan_id` → `ui_plans`; legacy `card_id` uuid |
| Access device | **Device** (card/tag) | `cards` | `id` = **D** | `user_id` = U (nullable); `customer_id` = C (FK → customers, ON DELETE SET NULL); legacy `card_id` text NOT NULL UNIQUE; `tap_profile_id`; `order_id`, `sku`, `card_slot`; `status` (V5) + `card_status` (legacy); activation columns; edition columns; `nickname` |
| Code | Encoded URL | — | `/t/<slug>` (persona-addressed, legacy) · `/d/<public_code>` (device-addressed, PROPOSAL) | — |
| Resolver | Public resolver | functions | `get_public_profile(text)` v1 (frozen) · `resolve_tap(code)` v2 (PROPOSAL) | — |
| Commerce | Order | `orders` | `id` | `user_id` = U (NOT NULL); **`customer_id` = U** (FK → `auth.users`): a naming hazard, see §2.2 |
| Entitlement | Entitlement | `entitlements` | `id` | `user_id` = U; `UNIQUE(user_id, type, key)` |
| Admin | Platform admin | `admin_users` | `user_id` = U | `role`, `permissions`, `is_active` |

### 2.1 Boundary rules (PROPOSAL; DEC-2026-029)

| # | Rule | Why |
|---|---|---|
| B1 | **Authorization is always by U.** RLS uses `(SELECT auth.uid()) = user_id`, or `id` for `profiles`. | matches every existing policy (OBSERVED) |
| B2 | **C is a commercial key.** It is resolved server-side as `SELECT id FROM customers WHERE user_id = U`, and **never accepted from a client**. | DEC-2026-024 I-1…I-3: V5 writes U into C columns, which fails FK on live |
| B3 | Every new table owned by a person carries `user_id` (U). It carries `customer_id` (C) only when it is a commercial record that needs it. | avoids repeating the dual-key confusion |
| B4 | `orders.customer_id` holds **U** (OBSERVED FK → `auth.users`). It is documented as legacy and never joined to `customers`. New code reads `orders.user_id`. | prevents a silent join bug |
| B5 | A device never *is* an identity. It *points to* a persona through a route. | doc 08 §1; owner brief |
| B6 | A tap never authenticates (assurance A0). | doc 04 §2.2 |
| B7 | Suspension exists at three levels with distinct meanings: `customers.account_status` (commercial), `profiles.suspended_*` (account moderation), `tap_profiles.suspended_*` (persona moderation). Device state is separate (§4). | prevents conflating them; F1 guards apply to each |

### 2.2 Known identity hazards (OBSERVED)
- **H1:** `tap_profiles.suspended` (legacy bool) and `tap_profiles.suspended_at` (V5) both exist. The V5 functions read `suspended_at` and `status`. `suspended` is legacy. Keep both; never write `suspended` from new code (PROPOSAL).
- **H2:** `tap_profiles.card_id` (uuid) and `cards.tap_profile_id` are two legacy device↔persona links. In M1.5, `tap_routes` becomes the routing source of truth. The legacy columns stay readable.
- **H3:** `profiles.customer_id` and `tap_profiles.customer_id` are NOT NULL on live but nullable in the repo. The repository schema is wrong (drift report §4).

## 3. Persona model ("digital profiles")

**Terminology.** "Digital profile" in the owner brief = **persona** = `tap_profiles`. `profiles` is the private account record. Using "profile" for both would create a duplicate concept.

| Brief category | Kinds | Representation (PROPOSAL; DEC-2026-032) |
|---|---|---|
| Personal | individual, professional, student, creator | `tap_profiles.context` ∈ `professional, student, business, event, member, guest, other` (doc 03 §3.1). Add `creator` to the seed vocabulary; `individual` = `professional` default |
| Business | company, restaurant, hotel, clinic, retail, service provider | `context = 'business'` + `category` (seeded vocabulary, data not CHECK) |
| Organisation | school, college, institution, enterprise, community | the organisation's own public page: `tap_routes.target_kind = 'org_page'`, `organizations.kind`. **Phase 2** (§5) |

**Persona attributes added in M1.4** (doc 12 M1.4, PROPOSAL; DB plan §3):
- `context`;
- `is_default`;
- `field_visibility` jsonb (`public|connections|organization|private`; M1 UI exposes public/private only);
- `org_id` (nullable, no FK until Phase 2, **only if DEC-2026-025 allows**);
- `tap_profile_versions` (last 10).

**Kept:** `UNIQUE(customer_id)` (one persona per customer). Multi-persona is Phase 2 (doc 10 §4).

**Behaviour-preserving back-fill:** fields enabled today → `public`; everything else → `private`. A golden test proves `get_public_profile` output is unchanged.

## 4. Device (card) model

### 4.1 Lifecycle (PROPOSAL; DEC-2026-028)

States (canonical column `cards.status`):
`unassigned → pending(issued) → shipped → active ⇄ suspended; active → lost → active | replaced; active → transfer_pending → active; active | suspended | lost → replaced; active | suspended → retired`.

| Brief term | Canonical | Notes |
|---|---|---|
| UNASSIGNED | `unassigned` | inventory; legacy `card_status='inventory'` |
| ISSUED | `pending` (→ `shipped`) | bound to an owner by order or assignment; live fulfilment inserts `pending` |
| ACTIVATED | transition `shipped|pending → active` | recorded in `activated_at`, `activation_count`, `last_activation_at` (OBSERVED live columns) |
| ACTIVE | `active` | resolves |
| SUSPENDED | `suspended` | reversible; **live `expire_tap_cards()` also uses it for expiry**, so EXPIRED is not distinct until DEC-2026-002 |
| LOST | `lost` | new value |
| REPLACED | `replaced` | terminal; live functions already check `'replaced'` |
| RETIRED | `retired` | terminal |
| — | `transfer_pending` | from doc 08; not in the brief |

**Rules:**
- **One transition function,** `device_transition(device, to_state, actor, reason)`. It is the only writer of `status`, it enforces legal edges, and it writes audit + a `domain_event`. The existing `customer_activate_card`, `customer_deactivate_card` and `card_apply_verified_action` paths are re-pointed to it in M1.3, after approval.
- **`card_status` (legacy CHECK) is kept and never dropped.** It is mapped one-way from `status` by trigger, or frozen (DEC-2026-028 option).
- **`status` gets a CHECK** of the canonical set: `NOT VALID` first, validated after a live data check.

### 4.2 Device capabilities
- **Ownership:** `user_id` (U) owns. `owner_org_id` / `assigned_to_user_id` come in Phase 2 (organisation assignment ≠ ownership; doc 08 §5).
- **Activation:** the printed `activation_code` (live, generated by trigger) and/or OTP step-up (A3 after F4).
- **Suspension and reactivation:** owner (A3) or admin (reason required).
- **Lost:** owner (A3), with a rescue route if one exists (Phase 3).
- **Replacement:** `request_card_replacement` exists on live (OBSERVED). The new device inherits routes; the old one goes to `replaced`.
- **Retirement:** terminal; serial and edition history kept.
- **Audit history:** every transition writes unified audit + `device.lifecycle` (analytics) + a notification (security category, locked on).

### 4.3 NFC / QR identity
Three identifiers, never confused (doc 08 §2):
- `card_uid` (chip; inventory only);
- **`public_code`** (≥ 64-bit, Crockford base32; encoded in NFC and QR as `/d/<code>`);
- the optional SDM key reference (OQ-2).

The legacy `card_id` text is a human or inventory code, **not** a routing key.

## 5. Organisation model (designed; **not built in M1**; DEC-2026-025)

```text
organizations (id, slug, name, kind, status, verified_at, settings, …)
   └── memberships (org_id, user_id = U, kind, org_role, status, accepted_at …)  UNIQUE(org_id, user_id, kind)
         └── org_role_permissions (org_role, permission)   seed data
devices:   cards.owner_org_id, cards.assigned_to_user_id
personas:  tap_profiles.org_id (org-issued persona)
consent:   consent_grants (org reads member data only with a grant)
```

**Dependencies:**
- G3 (doc 13);
- OQ-9 (counsel: DPDP, minors);
- the org verification SOP;
- consent ledger design;
- tenancy isolation matrix in CI.

**Conflicts with V5:**
- `customers` (V5 commercial account) is per-person. Organisation billing needs `subject_kind` on orders and entitlements (doc 03 §3.5).
- `admin_users` must never be reused for organisation admins (doc 01 §2 #9).

**Vertical mapping:**

| Vertical | `organizations.kind` | `memberships.kind` |
|---|---|---|
| school, college | school | student, staff |
| company | company | employee |
| hotel, restaurant, clinic, retail | venue | staff, guest |
| event | event_org | attendee |
| institution, community | other | member |

The organisation-kind vocabulary is seed data (DEC-2026-032), and no new table is created per vertical.

## 6. Other aggregates

| Aggregate | Table(s) | M1 role |
|---|---|---|
| Commerce | `products`, `orders`, `order_items`, `payments`, `webhook_events`, `entitlements`, `order_item_fulfillment_actions`, `order_status_history` | frozen; abstraction interfaces only (plan §18–19) |
| Legacy catalogue | `ui_plans`, `customizations`, `customer_customizations` (API-denied on live) | **reuse or ignore; never duplicate**. V5 entitlements remain the source of truth for experiences and the Pass |
| Activity | `account_events` (customer feed) | kept; fed from `domain_events` later |
| Audit | `admin_audit_log` → unified audit | M1.1 |
| Outbox | `domain_events` (new) | M1.1 |
| Notifications | `notifications`, `admin_notifications`, + deliveries/preferences | M1.6 |
| Analytics | `tap_events`, + `tap_daily_stats` | M1.7 |
| Support | `support_tickets`, `support_messages`, + `support_internal_notes` | M1.8 |
| Config | `platform_config`, `feature_flags` | M1.1 |

## 7. Glossary (stored name → domain meaning)

| Stored | Means |
|---|---|
| `profiles` | private account record (key U) |
| `tap_profiles` | persona / public identity |
| `cards` | device (card, tag, badge, label, virtual) |
| `customers` | commercial account (key C) |
| `customer_id` on profiles / tap_profiles / cards | C |
| `customer_id` on orders | **U** (legacy) |
| `card_id` on cards | legacy inventory code (text) |
| `card_id` on tap_profiles | legacy device link (uuid) |
| `status` on cards | V5 lifecycle (canonical, proposed) |
| `card_status` on cards | legacy lifecycle |
| `entitlements.type='lifetime'` | ₹999 Customization Pass |
| `selected_ui_tier` / `digital_plan` | experience: essential, business, premium, goat |
| `username` / `slug` | public vanity address |
