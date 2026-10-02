# SHYGON OS — M1 Architecture & Implementation Readiness Plan

| | |
|---|---|
| Status | **PLANNING ONLY.** No schema, RLS, auth, payment, deployment or production change. Live payments are OFF (Razorpay test mode only). |
| Date | 2026-10-02 |
| Inputs | **Repository:** `feat/m0-governance-ci` @ `441c152`. **Live schema baseline:** `supabase/baseline/000_live_baseline.sql`. **Drift analysis:** `docs/governance/SCHEMA_DRIFT_REPORT.md`. **Approved pack:** docs 01–14. **Product direction:** owner brief of 2026-10-02. |
| Companions | `M1_DOMAIN_MODEL.md`, `M1_API_CONTRACTS.md`, `M1_SECURITY_MODEL.md`, `M1_DATABASE_PLAN.md`, `M1_TEST_STRATEGY.md` |
| Authority | Where this plan and an approved document disagree, the approved document stands until a DEC record changes it. Each conflict is listed in §33 with its proposed DEC. |

Evidence labels: **OBSERVED** (repository or live baseline), **INTERPRETATION**, **PROPOSAL** (needs approval).

---

## 1. Executive architecture

SHYGON OS is an **additive platform layer around the frozen V5 core**. It is not a rewrite.

The plan uses three ideas:

1. **One identity spine** shared by every SHYGON product:
   `AUTH USER → CUSTOMER → ACCOUNT PROFILE → PERSONA (identity) → DEVICE (card/tag) → CODE (NFC/QR) → RESOLVER`.
   Every vertical (student, school, restaurant, hotel…) is configuration on this spine: persona context, organisation kind, routes. None gets its own tables.
2. **The database is the policy point.** Postgres (Supabase) remains the system of record and enforces authorization through RLS and SECURITY DEFINER functions. Edge functions handle anonymous traffic, rate limits, secrets and providers. The browser only renders. This is unchanged from V5 and from doc 02 §1.
3. **Four separate event streams:** product analytics, operational events, security events and audit. Each has its own retention, access and integrity rules. Notifications, AI and future verticals consume these streams. They never write into the core directly.

What M1 delivers once approved, in summary:
- the foundations (audit, events, flags);
- identity and authorization hardening;
- the card lifecycle;
- the persona abstraction;
- device routing (`/d/:code`);
- notifications, analytics and support foundations;
- payment and fulfilment *abstractions*, test mode only;
- a customer app shell.

**Organisations are designed here but not built in M1.** See §8 and DEC-2026-025.

## 2. Current V5 boundaries (frozen compatibility surface)

OBSERVED. These do not change in M1, except through an approved DEC.

| Surface | What is frozen | Guarded by |
|---|---|---|
| Public Tap | `/t/:slug`, `/tap/:slug`; `get_public_profile(text)` output shape; `src/components/tap/*`, `src/lib/publicTapClient.ts`; entry bundle ≤ 90 kB gz (88.55 kB today) | bundle gate (CI); golden test (to add, M1_TEST_STRATEGY §4) |
| Checkout and payments | `create-order`, `verify-payment`, `razorpay-webhook`, `check-delivery`, `payment-mode`; `netlify/lib/{fulfilment,razorpay,supabase,sms,orderMessages}.mjs`; `api/*` mirrors | `test:payments:ci`; CODEOWNERS (L3) |
| Card OTP | `card-otp` endpoint and `card_apply_verified_action` | tests; L3 |
| Admin | 45 `admin_*` RPCs (signatures and return shapes), `is_admin`, `admin_has`, `require_admin`, `admin_audit(uuid,text,text,text,jsonb)`; Admin APK contract | contract snapshot test (to add) |
| Auth | Supabase email auth, `localStorage` session, `handle_new_user` | L3 |
| Product rules | 4 experiences, ₹999 Pass, 14-day edit rule, event themes, limited editions (chapters of 100) | `db:verify` |
| Stored names | no table renames, no column drops (doc 12 §0 rule 3) | review + drift tool |
| URLs | `/shygontap/*` (may be redirected later, never removed), canonical origin `shygontech.com` | — |

**Known defects that stay frozen until decided:** DEC-2026-024 (the live `customer_id` contract) and F1–F7 (§16). M1 builds *around* them and never fixes them silently.

## 3. SHYGON OS boundaries

| Context | Contains | Lives in | Notes |
|---|---|---|---|
| **SHYGON OS Platform** (this plan) | identity, personas, devices, routing, commerce, notifications, analytics, support, audit | the existing Supabase project and the existing Vite/Netlify/Vercel repository | additive modules |
| **SHYGON Control** (doc 14) | decisions, incidents, change risk, posture, agent registry | doc 14 places it in a **separate Supabase project**. That conflicts with the owner's "no new Supabase project" rule; see DEC-2026-027. | not built in M1 (doc 10 §4); repository templates and CI cover O0/O1 |
| **Verticals** (student, school, hospitality…) | configuration and later feature modules | same platform | M1 builds primitives only |

**Boundary rule** (doc 02 §7): a module talks to another only through documented RPCs or functions, never by reaching into another module's tables from the client.

## 4. Domain model

Full detail is in **`M1_DOMAIN_MODEL.md`**. Bounded modules and their aggregates:

| Module | Aggregates (existing ● / extended ◐ / new ○ / deferred ⧗) |
|---|---|
| Identity | ● `auth.users`, ● `customers`, ◐ `profiles`, ○ `contact_methods` |
| Persona | ◐ `tap_profiles` (= persona), ○ `tap_profile_versions` |
| Devices | ◐ `cards` (= device), ● `card_editions`, ● `card_otp_challenges`, ○ `tap_routes` |
| Organisations | ⧗ `organizations`, `memberships`, `org_role_permissions` (Phase 2, DEC-2026-025) |
| Commerce | ● `products`, `orders`, `order_items`, `payments`, `webhook_events`, `entitlements`, `order_item_fulfillment_actions`, `order_status_history` (live-only) |
| Legacy (live-only) | ● `customizations`, `customer_customizations`, `ui_plans` (API-denied; reuse, don't duplicate) |
| Events & audit | ◐ `admin_audit_log` (unified audit), ● `account_events` (customer activity), ○ `domain_events` (outbox), ○ `security_events` view or sink |
| Analytics | ◐ `tap_events`, ○ `tap_daily_stats` |
| Notifications | ◐ `notifications`, ● `admin_notifications`, ○ `notification_deliveries`, `notification_preferences` |
| Support | ◐ `support_tickets`, ● `support_messages`, ○ `support_internal_notes` |
| Platform config | ○ `platform_config`, `feature_flags` (kill switches) |

## 5. Identity model

Detail is in `M1_DOMAIN_MODEL.md` §2. Proposed contract: DEC-2026-029.

```text
AUTH USER (auth.users.id = U)              authentication only; RLS key everywhere (user_id = U)
   │ 1:1  customers.user_id = U (unique)
CUSTOMER (customers.id = C, customer_id 'CUST-…')   commercial account; account_status
   │ 1:1  profiles.id = U, profiles.customer_id = C
ACCOUNT PROFILE (profiles)                  private account record; contact drafts; suspension
   │ 1:N (1 today: tap_profiles.customer_id UNIQUE)
PERSONA = IDENTITY (tap_profiles.id = P)    what the public sees; context, field visibility
   │ N:M via tap_routes (today: implicit, by slug)
DEVICE = CARD (cards.id = D, public_code)   physical/digital access device; lifecycle state
   │ encodes
CODE: /t/<slug> (legacy, persona-addressed) │ /d/<public_code> (new, device-addressed)
   │
PUBLIC RESOLVER: get_public_profile v1 (frozen) │ resolve_tap v2 (new, M1.5)
```

**Invariants** (PROPOSAL, DEC-2026-029):
1. `U` and `C` are never interchangeable.
2. Authorization always uses `U`.
3. `customer_id` holding `C` is **derived server-side, never client-supplied**.
4. `orders.customer_id` is a legacy column that holds **`U`** (its FK points to `auth.users`). It is documented as a naming hazard and never used for joins to `customers`.
5. A device is never an identity.
6. A tap is never authentication (A0, doc 04 §2.2).

## 6. Card model

Detail is in `M1_DOMAIN_MODEL.md` §4. Decision: DEC-2026-028.

The owner brief's lifecycle maps onto doc 08 and onto live values as follows (OBSERVED live: `status` varchar, unconstrained; legacy `card_status` CHECK):

| Owner brief | doc 08 | live `status` | live `card_status` (legacy) | Resolver result |
|---|---|---|---|---|
| UNASSIGNED | `unassigned` | — | `inventory` | "Activate your SHYGON Tap" landing |
| ISSUED | `pending` → `shipped` | `pending` | `assigned` | activation landing |
| ACTIVATED | *(the activation transition; recorded as `activated_at`)* | — | — | — |
| ACTIVE | `active` | `active` | `active` | route → persona |
| SUSPENDED | `suspended` | `suspended` (also set by `expire_tap_cards()`) | `suspended` | neutral "unavailable" |
| LOST | `lost` | — | — | rescue route if any, else unavailable |
| REPLACED | `replaced` | `replaced` | `replacement` | unavailable (+ optional hint) |
| RETIRED | `retired` | — | `retired` | unavailable |
| *(not in brief)* | `transfer_pending` | — | — | as active |
| *(not in brief; live behaviour)* | — | `suspended` after 14 days | — | **EXPIRED is not distinct today**; decided by DEC-2026-002 |

**Proposed:**
- `status` is the canonical lifecycle column, with a CHECK added `NOT VALID` and then validated.
- `card_status` is retained, read-only and mapped, never dropped.
- The single transition function is `device_transition()` (doc 12 M1.1).
- ACTIVATED is an event, not a stored state.

All of this needs approval (DEC-2026-028).

## 7. Profile (persona) model

Detail is in `M1_DOMAIN_MODEL.md` §3.

- **A "digital profile" in the owner brief means a persona**, stored as `tap_profiles` (doc 01 §2 #5). It is not `profiles`, which is the private account record.
- **Personal kinds** (individual, professional, student, creator) map to `persona.context`.
- **Business kinds** (company, restaurant, hotel, clinic, retail, service provider) map to `context = 'business'` plus a **vertical category** held as *data*.
- **Organisation profiles** (school, college, institution, enterprise, community) are the public page of an organisation (`tap_routes.target_kind = 'org_page'`). That arrives with organisations in Phase 2.
- **Vertical taxonomy as seed data, not schema:** DEC-2026-032.
- **M1 keeps one persona per customer.** The live constraint `UNIQUE(customer_id)` stays (doc 12 M1.4). Multi-persona is Phase 2.

## 8. Organisation model (designed, not built)

Detail is in `M1_DOMAIN_MODEL.md` §5.
- **Model:** `organizations`, `memberships` (kind + `org_role`), `org_role_permissions`, plus nullable `org_id` columns on tenant-owned tables (doc 03 §3.3).
- **Gate:**
  - doc 12 §4.7 says "Organisation: none in Phase 1";
  - doc 13 G3 must be complete before any organisation or student data is stored;
  - OQ-9 counsel review is required before minors' data.
- **Conflict:** the owner brief lists organisations, members and roles.
- **Resolution:** DEC-2026-025 (PROPOSED). Design now; build in Phase 2 after G3. Optionally add nullable `org_id` columns in M1 only if doc 12's "nullable `org_id` columns specified above" is approved again.

## 9. RBAC model

Detail is in `M1_SECURITY_MODEL.md` §3. Three role systems, never merged (doc 02 §5, doc 13 §2.1):

| System | Canonical roles (from approved documents; no new names) | Where | Grants DB privilege? |
|---|---|---|---|
| Platform admin | `owner, admin, fulfilment, support, viewer` + 19 permissions (OBSERVED: `orders.*, customers.*, tap.*, products.*, inventory.*, entitlements.*, support.*, analytics.read, audit.read, admins.manage`) | `admin_users` + `admin_role_permissions()` | yes, via `admin_has()` inside definer RPCs |
| Tenant (Phase 2) | `org_owner, org_admin, manager, staff, member` | `memberships.org_role` + `org_role_permissions` | yes, via `has_org_permission(org_id, perm)` |
| Customer | implicit owner of their own rows | RLS `user_id = (SELECT auth.uid())` | own rows only |
| Governance | Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner, Incident Lead | `ROLE_ROSTER.md` → later `ops.role_assignments` (Control) | **never** (doc 13 §2.1) |

**Conflict flagged:** the brief's list mixes governance roles (Security, Product, Data, Release Owner, Incident Lead) into product RBAC. That is resolved by the existing rule: governance roles never grant database privilege. Containment rights come only from the kill-switch matrix (doc 13 §7.2). No new role names are introduced.

**M1 additions:** permission namespaces `devices.*`, `security.read`, `config.manage` (doc 12 M1.7), added to the existing mapping.

## 10. API architecture

Detail is in `M1_API_CONTRACTS.md`. There are three surfaces (doc 05):
1. **Signed-in customer:** PostgREST + RPC under RLS.
2. **Public / anonymous:** versioned REST `/api/v1/public/*` via edge functions, returning problem+json, with uniform negative responses.
3. **Admin:** definer RPCs and Edge Functions.

Existing endpoints stay byte-compatible. All new RPCs are additive (never change a signature; add `_v2`).

## 11. Database architecture

Detail is in `M1_DATABASE_PLAN.md`.
- **Origin:** the live baseline (DEC-2026-023, Option A recommended; OPEN). **No migration is written until it is approved.**
- **Every proposed object** passes the reuse check (baseline → migrations → drift report → conflicts) before it is proposed. The register is in M1_DATABASE_PLAN §3.
- **Additive only:** `NOT VALID` → validate for constraints; batched backfills; `CREATE INDEX CONCURRENTLY` in separate files; rollback SQL in every header; data-classification comments.

## 12. Event architecture

Four streams, never one table:

| Stream | Purpose | Store (existing ● / new ○) | Retention | Who reads |
|---|---|---|---|---|
| **Product analytics** | taps, views, scans, link clicks, shares | ◐ `tap_events` → ○ `tap_daily_stats` | raw 90 days, rollups 25 months | owner (own), admin (aggregate) |
| **Operational events** | state changes that drive work (order paid, device suspended, ticket opened) | ○ `domain_events` (transactional outbox); ● `order_status_history`; ● `account_events` (customer feed) | outbox 30 days after processing | workers; customer feed |
| **Security events** | auth anomalies, step-ups, role changes, device actions, policy denials | rows in unified audit with `category='security'`, plus an alerting sink (log drain) | ≥ 2 years (doc 07 §3); ≥ 180 days in the log drain (doc 13 §9) | Security Owner, admins with `security.read` |
| **Audit events** | who did what (append-only) | ◐ `admin_audit_log` generalized (actor_kind, org_id, request_id, ip_hash, outcome) | ≥ 2 years | admins with `audit.read` |

**Common envelope:** `actor_kind, actor_id, action, entity_type, entity_id, occurred_at, source, request_id, outcome, metadata`.
**Never stored:** passwords, OTP values or codes, API secrets, service-role keys, payment secrets, full tokens, raw IP or UA.

## 13. Analytics architecture

- **Event taxonomy** (doc 06 C2): `tap.resolved`, `persona.viewed`, `persona.link_clicked`, `persona.contact_action`, `persona.shared`, `qr.scanned` (`source=qr`), `device.lifecycle` (activation, suspension, replacement), `commerce.checkout_started/completed`, `payment.*`, `fulfilment.*`, `support.*`, `security.*`. Operational and security kinds go to their own streams (§12).
- **Privacy:** no IP, no UA, no precise location. Visitor uniqueness is an HMAC with a rotating secret (fixes F5). k ≥ 5 for organisation views.
- **Forgery resistance:** a signed resolve token for public events (doc 12 M1.2/M1.6). The legacy `record_tap_event` keeps its signature but gains dedupe and limits.

## 14. Notification architecture

Provider-independent pipeline (doc 06 Part B):
`domain_events` → rules (event → recipients → category → template) → `notifications` (in-app, existing realtime) + `notification_deliveries` (one row per channel) → provider adapters.

- **Channels:**
  - in-app: exists;
  - email: provider OQ-8;
  - SMS: exists via MSG91/Twilio;
  - **WhatsApp: new in the owner brief and not in doc 06.** It needs Business API template approval and opt-in (DEC-2026-031);
  - push: Phase 5.
- **Support:** templates (repo-versioned, snapshot-tested), delivery states, retries with backoff, dead-letter, `dedupe_key` idempotency, per-category preferences, security categories locked on, and an audit trail.

## 15. Support architecture

Existing tables: `support_tickets` (reference, subject, category, status, `order_id`) and `support_messages` (`author_role`). Additions, all additive:
- `priority`;
- `assigned_admin_id`;
- `first_response_at`, `resolved_at`;
- **a separate `support_internal_notes` table** that is admin-only and has no customer RLS path. This is the same separation pattern as the F2 fix: internal data never lives on customer-readable rows.

Admin access uses the existing `support.read/respond` permissions. Every assignment or status change writes audit.

## 16. Security architecture

Detail is in `M1_SECURITY_MODEL.md`.

| Finding | Current state | Risk | Dependency | Proposed fix | Decision required | Phase |
|---|---|---|---|---|---|---|
| F1 self-unsuspension | live UPDATE policies on `profiles`/`tap_profiles` are row-level only; no trigger guards `suspended_*` (OBSERVED) | moderation bypass | DEC-2026-022; Security Owner L3 | column-guard BEFORE UPDATE triggers + adversarial tests | DEC-2026-022 / 003 | M0.3 |
| F2 admin notes readable | `orders.admin_note` on a customer-readable row | internal note leak | DEC-2026-022 | proposed 011 → `admin_order_notes` | DEC-2026-022 / 009 | M0.3 |
| F3 deactivated card still resolves | `get_public_profile` ignores card state; `/t/` is persona-addressed | lost-card promise broken | DEC-2026-028, OQ-2b, DEC-2026-022 | device-addressed `/d/:code` gated by lifecycle; legacy `/t/` per OQ-2b | DEC-2026-022 / 004 | M1.5 (or M0.3 if A) |
| F4 OTP to an editable phone | `card-otp` sends to `profiles.phone`; live also has activation by printed code | stolen session can authorize device actions | DEC-2026-022; DEC-2026-029 | `contact_methods` + 72 h cool-down + step-up tokens | DEC-2026-022 / 005 | M1.2 (or M0.3 if A) |
| F5 forgeable analytics | `md5(UA‖IP‖day)`; open writes | inflated or forged counts | M1.1 events; secrets | HMAC hash, signed resolve token, dedupe | DEC-2026-010 | M1.7 |
| F6 drift | quantified (drift report) | unsafe migrations, `db:push` danger | — | baseline origin + `db:push` guard | DEC-2026-023 | M1.1 (pre-req) |
| F7 slug enumeration | name-derived slugs, enumerable | harvesting public personas | M1.5 | unguessable device codes; per-IP throttling; uniform negatives | DEC-2026-011 | M1.5 |
| DEC-2026-024 | `customer_id` contract broken on live | paid claim fails for first-time buyers (P1 latent) | DEC-2026-023 | Option A/B/C (record) | DEC-2026-024 | before live payments |

## 17. AI boundary

Doc 09 and doc 14 §3.9 apply.
- **M1 builds no AI feature and no AI tables in the core.**
- **Interfaces only:**
  - AI consumers read **authorized, aggregate or redacted views** through definer functions;
  - AI outputs are **suggestion objects** stored apart from canonical records (later, behind flag K18);
  - every AI action is logged in the AI audit trail (doc 14 §3.18);
  - agents never hold production credentials.
- **Excluded from AI:** identity verification, access decisions, moderation enforcement, emergency release.

## 18. Payment boundary

- **Frozen pipeline** (§2): server-priced orders, HMAC verify, Razorpay re-confirm, webhook ledger, atomic claim.
- **M1 may add only:**
  - a documented `PaymentProvider` interface that matches `netlify/lib/razorpay.mjs`;
  - test-mode fixtures;
  - a read-only reconciliation script;
  - observability (structured logs, the retry-age alert).
- **Live activation is a release gate** (§34 G-PAY). It requires all of:
  - DEC-2026-024 APPROVED and fixed;
  - G2;
  - kill switch K5 built;
  - the `rzp_live_` prefix only in host environment variables;
  - the mismatch count is 0.
- **Proposed CI rule:** a test that fails if `rzp_live_` appears anywhere outside test fixtures. An L1 PROPOSAL.

## 19. Fulfilment boundary

OBSERVED: two fulfilment implementations exist.
- **JS `fulfilOrder()`:** used by the code, frozen.
- **Live-only DB `fulfil_order()`:** unused by the code, slot-based cards.

The card-record path (I-4) and the Tap-provisioning path (I-1, I-3) both fail on live (DEC-2026-024).

**M1:** document a `FulfilmentStep` interface (grant entitlement, issue device, decrement stock, provision persona, notify) and add observability. Choosing the canonical implementation and fixing it waits for DEC-2026-024 and DEC-2026-028.

## 20. Routing architecture

- **New, device-addressed:** `/d/:code` → edge `resolve` function → `resolve_tap(code)`. It is STABLE, a definer, anon-callable and read-only. The chain is DEVICE → STATE → ROUTE → PERSONA → DESTINATION payload, using `get_public_profile` v1 output unchanged.
- **Legacy, persona-addressed:** `/t/:slug` stays frozen. Optional legacy-card gating follows OQ-2b and is a separate DEC.
- **`tap_routes`:**
  - target kinds `persona` now; `rescue_item`, `location`, `event` and `org_page` later;
  - priority and conditions;
  - composite FK so the target belongs to the same owner;
  - **no arbitrary URL targets** (T16).
- **Caching:** ≤ 30 s, with purge on state change. Rate limits are per IP and per code.
- **Kill switch:** K1 maintenance mode, including when the database is unreachable.

## 21. Frontend architecture

- **Kept:** Vite, React 19, Router 7, Tailwind 4, `services/` and `useAsync`. No new state library.
- **New:**
  - `src/apps/customer/` (`/app/*`) as a lazy bundle;
  - `/shygontap/*` keeps working, with redirects later;
  - pages for Devices, Privacy and Security;
  - shared primitives extracted **only when touched**.
- **The public Tap bundle must not import SHYGON OS code.** That is enforced by the 90 kB gate and a proposed import-boundary lint.
- **"OS dashboard" (brief M1.10) is ambiguous.** It could mean the customer `/app` shell (doc 12 M1.8) or an operator Command Center. The Command Center is on doc 10's do-not-build list until G3/O3. See DEC-2026-030.

## 22. Backend architecture

- **Modular monolith** (doc 02 §1).
- **Netlify functions are primary, with Vercel mirrors** (`api/*.mjs`), and the build guard keeps routes in step.
- **New functions** (M1, when approved): `resolve`, `otp` (generalized from `card-otp`), `notify-worker` (scheduled), `health`.
- **Shared libraries** live in `netlify/lib/`. There is a structured logger with a request id (M0.6).
- **Observation:** the deployed Vercel site is missing `/api/payment-mode`. Deployments drift from the repository (M1_SECURITY_MODEL §7).

## 23. Supabase architecture

- **One product project.** No new project for the platform (owner constraint).
- **Staging and the Control plane:** doc 12 §4.10 requires a separate staging project and doc 14 a separate Control project. Both conflict with the owner constraint (DEC-2026-027). Options: Supabase branching, a local-only environment, or an approved exception.
- **RLS on every table.**
- **Definer functions** pin `search_path` and `REVOKE … FROM PUBLIC`. A lint for this is proposed.
- **Server-only tables** have no policies and `REVOKE ALL`.
- **Auth:** existing email auth plus TOTP MFA for admins (flagged), and verified contacts (F4).
- **To verify on live:** storage policies, the pgcrypto location, `auth.users` triggers, cron.

## 24. Edge-function architecture

| Function | Runtime | Status |
|---|---|---|
| `create-order`, `verify-payment`, `razorpay-webhook`, `check-delivery`, `payment-mode`, `card-otp` | Netlify + Vercel mirror | frozen |
| `admin-refund`, `admin-push` | Supabase Edge (Deno) | frozen |
| `resolve` (`/d/:code`, `/api/v1/public/resolve/*`) | Netlify + mirror | new (M1.5) |
| `otp` (`/api/v1/otp/*`) | Netlify + mirror | new (M1.2), wrapping `card-otp` primitives |
| `notify-worker` | Supabase Edge (scheduled) or a Netlify scheduled function | new (M1.6) |
| `health` | Netlify + mirror | new (M0.6) |

**Rules:**
- the client IP comes only from platform headers;
- secrets never live in `VITE_*`;
- problem+json errors;
- requests carry an idempotency key.

## 25. Testing architecture

Detail is in `M1_TEST_STRATEGY.md`.

- **Existing:** `db:verify` (23), `rls-adversarial` (48), `verify-011` (16), `test:payments:ci` (15 + 14), the bundle gate, gitleaks, audit, and the schema-drift tool.
- **Key change (DEC-2026-023):** run the database suites against the **live baseline**. Today they run against a schema that isn't production.
- **To add:** golden legacy `/t/` test, admin-contract snapshot, public-leak canary, lifecycle matrix, `customer_id` contract tests, Playwright and axe, k6.

## 26. Deployment architecture

- Netlify is primary and Vercel the mirror (OBSERVED: the Vercel deployment is stale).
- **No deployment happens in M1 planning.** Deployments follow G1/G2: CODEOWNERS, environment protection, `RELEASE_HANDOFF.md`, and the approved migration pipeline (doc 12 M1.13).
- **Feature flags** let features ship dark.

## 27. Environment separation

| Env | Database | Payments | Purpose |
|---|---|---|---|
| local | PGlite (baseline + migrations) | Razorpay **test** keys only; tests use fakes | development and CI |
| staging | **undecided** (DEC-2026-027) | test keys | integration, drills |
| production | live Supabase | **test mode until G-PAY** | customers |

**Rules:**
- `rzp_live_` keys exist only in the production host environment, and only after G-PAY;
- the service-role key is never in agent environments;
- `db:push` cannot target production (DEC-2026-023 S1/S2).

## 28. Observability

- **Today:** none (doc 02 §8).
- **M0.6:** structured JSON logger with a request id, error tracking (optional DSN), and `/api/health`.
- **M1.11:**
  - SLOs (doc 13 §6);
  - synthetic probes;
  - the public-leak canary;
  - DB detectors (row-count, reconciliation, mass-change);
  - a log drain ≥ 180 days;
  - the rollback watch.
- **Tracing:** `X-Request-Id` from edge → function → RPC via `set_config('app.request_id')` → audit rows.

## 29. Disaster recovery considerations

- PITR is unverified on the current plan (VERIFY).
- **Storage** objects need their own backup (doc 14 §3.16).
- **Proposed objectives** (Data Owner + Product Owner approve):

  | Target | Objective |
  |---|---|
  | Database RPO | ≤ 5 min |
  | Database RTO | ≤ 4 h |
  | Tap path, degraded (K1 static page) | ≤ 5 min |

- **Restore drill:** restore to an isolated environment, then check row counts and invariants. Evidence goes in `docs/runbooks/DR-LOG.md`.
- **The live baseline is part of DR.** Re-capture it after any out-of-pipeline change.

## 30. Migration strategy

Per DEC-2026-023 (Option A recommended):
- the baseline is the origin;
- new work starts at `020_…`;
- 001–019 are history and never re-run;
- `db:push` is guarded.

Each migration is idempotent, additive and expand-first, carries rollback SQL, and passes `schema-drift.mjs` with the intended diff only. **Nothing is applied to production without the approved pipeline (doc 12 M1.13) or a documented human break-glass.**

## 31. Backward compatibility

- **Golden tests:**
  - `/t/<slug>` output is byte-identical;
  - the admin RPC contract snapshot is unchanged;
  - the bundle stays ≤ 90 kB;
  - `test:payments:ci` passes.
- **New behaviour ships behind flags,** defaulting to off.
- **Legacy names** stay (D6), with a glossary in M1_DOMAIN_MODEL §7.
- **The Admin APK** keeps working: new admin RPCs are additive.

## 32. Risk register

| ID | Risk | L | I | Mitigation | Owner (role) |
|---|---|---|---|---|---|
| MR-1 | Building on a schema that isn't production | H | H | DEC-2026-023 before any migration | Data Owner |
| MR-2 | `customer_id` contract misuse spreads into new modules | H | H | DEC-2026-029 invariants + contract tests | Security Owner |
| MR-3 | Live payments enabled before DEC-2026-024 is fixed | M | C | G-PAY gate; `rzp_live_` CI check; K5 | Security / Release |
| MR-4 | Scope explosion (21 domains, 12 verticals) | H | H | primitives only; doc 10 §4; phase gates | Product Owner |
| MR-5 | Organisations built before G3 / counsel | M | H | DEC-2026-025 | Product / Data |
| MR-6 | Public Tap regression or bundle growth | M | H | golden + bundle gates; import-boundary lint | Architect |
| MR-7 | Card lifecycle breaks shipped cards | M | C | DEC-2026-028; flags; legacy gating per OQ-2b | Product / Security |
| MR-8 | Deployment drift (Vercel stale; live edits outside the pipeline) | H | M | re-baseline; M1.13 pipeline; deploy records | Release Owner |
| MR-9 | One-person team; no independent L3 review | H | H | external reviewer or 24 h cool-off (doc 13 §2.2) | Product Owner |
| MR-10 | SEC-1 credentials unrotated | M | C | DEC-2026-001 human actions | Security Owner |
| MR-11 | Unknown platform objects (storage, pgcrypto, cron, auth triggers) | M | M | VERIFY ON LIVE list | Data Owner |

## 33. Decision dependencies

| DEC | Topic | State | Blocks |
|---|---|---|---|
| 001 | Credential rotation (SEC-1) | OPEN | G-PAY, launch |
| 002 | 14-day card activation expiry | OPEN | M1.3 lifecycle semantics |
| 018 | Role holders (OQ-16) | OPEN | every L3 approval |
| 022 | M0.3 scope | OPEN | M0.3 |
| 023 | Migration origin + `db:push` guard | OPEN | **every migration** |
| 024 | Live `customer_id` incompatibilities (P1) | OPEN | M1.2, G-PAY |
| **025** (new) | Organisations timing vs Phase 2 / G3 | PROPOSED | organisation build |
| **026** (new) | M1 sequence vs doc 12 Phase 1 milestones; the "M0 green before M1" rule | PROPOSED | the start of M1.1 |
| **027** (new) | Staging and Control environments vs "no new Supabase project" | PROPOSED | M1.11–M1.12, G2 |
| **028** (new) | Canonical card lifecycle vocabulary and status column | PROPOSED | M1.3 |
| **029** (new) | Identity key contract (`U` vs `C`) | PROPOSED | M1.2 and every module |
| **030** (new) | Meaning and scope of the "OS dashboard" | PROPOSED | M1.10 |
| **031** (new) | Notification providers incl. WhatsApp (extends OQ-8) | PROPOSED | M1.6 |
| **032** (new) | Vertical taxonomy as data (persona context/category, organisation kinds) | PROPOSED | M1.4 |
| OQ-2 / 2b | Chip family; legacy multi-card gating | OPEN | M1.3, M1.5 |
| OQ-8 | Email provider | OPEN | M1.6 |
| OQ-9 | Counsel (DPDP, minors) | OPEN | Phase 2 |

## 34. Phase gates

| Gate | Required before | Conditions |
|---|---|---|
| **G-M0** (doc 12 rule 5) | M1.1 implementation | M0.3–M0.7 done or explicitly waived by DEC-2026-026; DEC-2026-022/023 decided |
| G-DB | any migration | DEC-2026-023 APPROVED; test harness on the baseline |
| G-ID | identity / cards / personas | DEC-2026-029 (+ DEC-2026-024 fix direction) APPROVED |
| G-L3 | any RLS / auth / payment change | named Security Owner approval (DEC-2026-018) |
| G-ORG | any organisation table | DEC-2026-025 APPROVED; G3; OQ-9 |
| **G-PAY** | live payments | DEC-2026-024 fixed + verified; DEC-2026-001 rotation done; K5 built; G2; `rzp_live_` only in the host environment; mismatch = 0 |
| G2 (doc 13) | production launch of Phase 1 | roster, paging, drills, SLOs, canary, log drain |

## 35. Implementation order (proposed; DEC-2026-026)

**The brief's order has been changed.** The repository evidence shows a better dependency order:

| Proposed | Scope | doc 12 equivalent | Why here |
|---|---|---|---|
| **M1.0** | Architecture package (this) | — | done |
| **M1.0a** | **M0 completion:** DEC-022/023/024 decided; M0.3 (security fixes per DEC-022), M0.4 (policy lineage on the baseline), M0.5 (secrets/hygiene), M0.6 (observability minimum), M0.7 (review controls) | M0.3–M0.7 | doc 12 rule 5, "security before feature"; F1/F2/F4 risk is open now |
| **M1.1** | **Platform foundations:** test harness on the baseline; `platform_config` + `feature_flags` (kill-switch table); unified audit generalization; `domain_events` outbox | parts of M1.10, M1.7, M1.5 | **every later module writes audit and events and ships behind flags.** The brief put audit and events at M1.4, after modules that need them. |
| **M1.2** | **Identity & authorization:** `customer_id` contract (DEC-029, +024); `contact_methods`, step-up, generalized `otp` (F4); admin permission namespaces; admin MFA flag | M1.3, M1.7 | the identity contract must exist before devices and personas are built on it |
| **M1.3** | **Card lifecycle:** canonical status + CHECK; `device_transition()`; `public_code`; lost/replace/retire/transfer RPCs (A3); card-record creation fix (I-4, if approved) | M1.1 | needs the A3 step-up from M1.2 |
| **M1.4** | **Persona abstraction:** context, `is_default`, `field_visibility`, version history; vertical taxonomy (DEC-032) | M1.4 | independent of routing, needed by it |
| **M1.5** | **Routing:** `tap_routes`, `resolve_tap`, `/d/:code`, edge resolver behind a flag; `/t/` frozen (F3/F7) | M1.2 | needs lifecycle (M1.3) and persona visibility (M1.4) |
| **M1.6** | **Notifications:** deliveries, preferences, templates, adapters (email/SMS/WhatsApp per DEC-031) | M1.5 | needs the outbox (M1.1) |
| **M1.7** | **Analytics:** `tap_events` v2, HMAC, rollups, retention, signed event token (F5) | M1.6 | needs `device_id` from routing (M1.5) |
| **M1.8** | **Support foundation:** priority, assignment, internal notes, audit | — (new) | needs audit (M1.1); independent otherwise |
| **M1.9** | **Payment/fulfilment abstraction:** interfaces, test-mode fixtures, reconciliation script, observability; DEC-024 fix only if APPROVED | — | after identity (M1.2) and lifecycle (M1.3) settle the contracts it uses |
| **M1.10** | **Customer app shell / "OS dashboard"** (per DEC-030): `/app`, Devices, Privacy, Security pages | M1.8 | needs M1.2–M1.7 data |
| **M1.11** | **Detection, data governance, DR:** SLOs, canaries, data-class lint, restore drill, cost breakers | M1.11, M1.12 | security hardening is **spread across M0.3 and M1.2–M1.5**, not deferred to a late milestone as in the brief |
| **M1.12** | **Integration and hardening:** golden, contract, Playwright/axe, k6; approved migration pipeline | M1.9, M1.13 | last before the gate |
| **M1.13** | **Phase gate** (G2 + G-PAY review) | — | — |

Organisations are not in M1 (DEC-2026-025).

## 36. Definition of Done (for M1 as a whole)

1. **Compatibility:** `/t/<slug>` golden suite identical; admin-contract snapshot unchanged; bundle ≤ 90 kB; `test:payments:ci` green; no table renamed and no column dropped.
2. **Security:**
   - `rls-adversarial` ≥ 100 checks, **run against the live baseline**;
   - every F-item either closed with a regression test or carrying an APPROVED risk-acceptance DEC;
   - the definer lint is green;
   - no privilege escalation path.
3. **Database:** no duplicate domain concept (the reuse register in M1_DATABASE_PLAN §3 is satisfied); every migration has rollback SQL and data-classification comments; the drift tool shows only intended diffs.
4. **Payments:** live payments OFF; the G-PAY gate is documented; the CI check for `rzp_live_` passes.
5. **Observability:** every privileged action writes unified audit with a request id; the outbox is processed with dead-letter alerts.
6. **Extensibility:** a new vertical, persona category or organisation kind needs only seed data; a new provider needs only an adapter.
7. **Governance:** every L2/L3 change has a DEC, CODEOWNER approval and a rollback plan; `DECISIONS.md` is current; G2 evidence is recorded.
