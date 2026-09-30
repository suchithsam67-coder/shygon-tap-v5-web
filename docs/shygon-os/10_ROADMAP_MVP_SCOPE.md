# 10 — Phased Roadmap · MVP Definition · Do-Not-Build List

*Covers requested docs 16 (Phased Roadmap), 17 (MVP Definition).*

## 1. Challenging the assumed MVP

The brief's likely core is **SHYGON ID + Tap + Profile + NFC/QR + Privacy + Card management + Analytics + Authentication + Payments/subscriptions + Admin foundation**. Against the real V5 code:

| Assumed MVP item | Already in V5? | Verdict |
|---|---|---|
| Authentication | Email auth ✔, sessions ✔; verified phone ✘, MFA ✘ | **Harden** (small) |
| Payments | Production-grade one-time payments ✔ | **Do not rebuild** |
| **Subscriptions** | ✘ (all purchases perpetual) | **Not MVP.** No plan is being sold that needs them until Phase 4 (org plans). Build the `plans` mapping later; do not touch billing now. |
| SHYGON ID / Profile | 1 profile per user ✔ | **Foundation only** (schema-forward columns, no multi-persona yet) |
| NFC/QR | ✔ (static, name-slug URL) | **Redesign the resolution layer** (device codes, lifecycle, F3) — this is the real MVP work |
| Privacy | binary field on/off | **Per-field visibility (public/private) + consent ledger schema**; connections/org tiers arrive with their features |
| Card management | activate/deactivate via OTP ✔ (semantics unclear) | **Fix + complete state machine**; resolve OQ-1 |
| Analytics | basic ✔ | **Harden** (F5) + rollups |
| Admin foundation | ✔ (45 RPCs) | **Extend** (MFA, new perms, unified audit) |
| Organizations/tenancy | ✘ | **Not in the first Claude Code phase.** Schema + helpers land at the start of Phase 2 (Student needs schools); UI in Phase 4. |

**Conclusion:** the first implementation phase is **not** "build the MVP features"; it is **"make V5 a safe, reproducible platform base and replace tap→profile with tap→route→target."** Roughly 70% hardening/foundation, 30% new capability. This is the smallest change set that (a) closes real vulnerabilities, (b) unblocks every later module, and (c) ships nothing customers must relearn.

## 2. Roadmap

Effort is expressed as relative size (S ≤ 1 wk, M ≈ 2–3 wk, L ≈ 4–6 wk, XL > 6 wk) for a small team using Claude Code with human review. Dates deliberately omitted: they depend on team size and hardware lead times.

### Governance & operating layer run alongside every phase
Docs 13 and 14 add two tracks to each phase. The stages line up as follows:

| Product phase | Governance stage (doc 13 §12) | Operating-layer stage (doc 14 §5) | Gate it imposes |
|---|---|---|---|
| **Now, before Phase 0** | **G0** — credential rotation (DEC-2026-001), role roster, decision queue, out-of-band channel, printed runbook | — | No Claude Code work uses old credentials |
| Phase 0 | G1 — CODEOWNERS, branch & environment protection, release handoff, secret/rollback/PITR runbooks tested, tabletop #1 | O0 — pre-deploy gate, change-risk engine, service catalog + blast radius, AI change reviewer, agent boundaries, AI audit via PR/trailers, DR drill | Phase 0 exit |
| Phase 1 | **G2 (launch gate)** — kill switches drilled, SLOs + paging, status page, public-leak canary, log drain ≥ 180 d, tabletop #2 | O1 — feature flags, migration pipeline with approval, rollback watch (notify), posture & ops digest reports, data-classification lint + catalog, storage backup, cost circuit breakers | **No production launch without G2** |
| Phase 2 | **G3** — `ops` module in the separate SHYGON Control project, decision queue + incident records + timers, minimal Command Center, cross-tenant canary, regulatory notification procedure | O2 — auto-rollback (stateless), QA agent on staging, org usage rollups | **No student/org data before G3** |
| Phase 3 | G4 — safety incident class (Rescue), automated P0 creation, action tracking, hardware playbook | O3 — Executive Command Center, dashboards, institutional memory search, agent registry + AI audit ingestion + change requests | Rescue launch requires G4 |
| Phases 4–5 | G5 — org-facing incident notices, enterprise SLAs, Access playbooks, audit hash anchoring | O4 — knowledge graph, customer impact simulator, semantic memory, cost attribution, optional Release Agent | Access launch requires G5 + pen-test |
| Phase 6 | — | O5 — decision pattern suggestions; productization evaluation (OQ-22) | — |

### Phase 0 — Stabilize & Baseline (prerequisite, size M)
* **Features:** none customer-visible. Reproducible DB baseline; CI; security fixes F1–F6, F8–F10; secret hygiene; runbooks.
* **Dependencies:** access to live Supabase (read schema), owner decision OQ-1 for card semantics (can ship F1/F2/F6/F8 without it).
* **DB changes:** captured baseline (`supabase db pull`) + squash plan; migration 020+: suspension-column guards, apply proposed 011 (admin notes table), policy `TO public → TO authenticated` cleanups, `cards` CHECK/constraints made explicit, missing live-only objects (`expire_tap_cards`, activation columns, activate/deactivate fns) captured **as written on live**.
* **API changes:** none.
* **Security:** F1, F2, F4-design, F5-design, secrets rotated, admin MFA plan, storage policy audit.
* **Frontend:** none.
* **Backend:** CI workflow (lint, tsc, build, db:apply from baseline, db:verify, rls-adversarial, test:payments, bundle-size gate).
* **Testing:** new adversarial tests for each finding (must fail on old schema, pass on new).
* **Ops:** staging Supabase project + Netlify deploy preview wired; backup/restore drill.
* **Risks:** live drift larger than expected; baseline capture may reveal unknown policies. *Mitigation:* do it first, on staging copy.

### Phase 1 — Core SHYGON Tap Platform (first Claude Code build; size L)
* **Features:** device codes + edge resolver + tap routes + lifecycle-enforced resolution (fix F3); legacy `/t/<slug>` untouched; per-field visibility (public/private) + `is_default`/`context` columns (single persona still); verified phone + step-up (A3) generalized `otp` service; unified audit log; notification outbox + email channel + preferences + security notifications; analytics hardening (signed event token, HMAC hash, rollups, retention); admin: MFA required, new `devices.*` perms, device admin views; customer app shell `/app` with old `/shygontap/*` redirects (no visual redesign); persona version history.
* **Dependencies:** Phase 0; email provider choice (OQ-8); chip decision informs only `auth_mode` default (`static`).
* **DB changes:** `cards`+ columns/states, `tap_routes`, `contact_methods`, `domain_events`, `notification_deliveries/preferences`, `tap_daily_stats`, `audit_log` generalization, persona columns, `field_visibility` back-fill (behaviour-preserving), `jobs` table for async work.
* **API changes:** resolver + `/api/v1/public/*` (resolve/event), `/api/v1/otp/*`, RPCs for device state/transfer/claim; existing routes unchanged.
* **Security:** rate limits (edge + DB), uniform public responses, column-guard matrix, public-payload snapshot test, CSP report-only endpoint, admin MFA.
* **Frontend:** `/app` shell & layouts; Privacy page (field visibility); Devices page (lifecycle, transfer, lost); security notifications UI; empty/error states; a11y pass on touched screens.
* **Backend:** resolver function; SDM *hooks* (interface + feature flag, not enabled); outbox worker; sweeper/retention jobs.
* **Testing:** adversarial RLS additions; resolver contract tests; load test (200 rps); legacy-card compatibility suite (golden slugs); notification idempotency; real-phone NFC/QR matrix (iOS/Android).
* **Ops:** dashboards/alerts (webhook failures, outbox lag, resolve p95), incident runbooks, secret rotation runbook.
* **Risks:** cache invalidation bugs showing stale/suspended pages (mitigate: purge tags + 30 s ceiling); state-machine edge cases; email deliverability (DMARC warm-up).

### Phase 2 — SHYGON Connect + Student (size XL)
* **Features:** organizations + memberships (schema + helpers + basic console for schools: invite, roster); multi-persona (context `student|professional|…`, plan-gated); **Connect** (consent-based exchange, connection list, follow-up notes, event mode "lite"); **Student persona** (portfolio, projects, achievements as self-asserted credentials, skills, restricted default visibility, age band, guardian-link stub); `consent_grants` live; `sensitive_profile_data` (guardian/emergency *contact only*).
* **Dependencies:** Phase 1; counsel review of minors' data (OQ-9); org verification workflow (manual by admin).
* **DB:** `organizations`, `memberships`, `org_role_permissions`, `consent_grants`, `connections`, `credentials` (self-asserted only), `sensitive_profile_data`, `events` (lite), `event_participations`; unique-index relaxation on personas.
* **API:** authenticated persona/connection/consent RPCs; public connect endpoints; org member endpoints.
* **Security:** tenancy isolation matrix in CI; consent revocation tests; connect anti-spam; minors defaults.
* **Frontend:** persona switcher (ActingAs), Connect inbox, Privacy center (audiences, consent list), Student editor, minimal `/org` console.
* **Testing:** cross-tenant matrix; consent expiry sweeps; accessibility audit (WCAG 2.2 AA) on new screens.
* **Ops:** org onboarding SOP, support macros.
* **Risks:** consent UX complexity; minors' compliance; scope creep into events (keep "lite").

### Phase 3 — SHYGON Verify + Rescue (size XL)
* **Features:** Verify (org-attested credentials, issuer tools, public verify page, revocation, provenance UI); **Rescue** (rescue items, lost mode, finder relay, owner replies, moderation queue); notifications for rescue; abuse prevention (Turnstile, rate limits, scoring); admin rescue/verify queues.
* **Dependencies:** Phase 1 notification/edge infra; Phase 2 orgs; **SDM tags strongly recommended** for Rescue hardware (OQ-2).
* **DB:** `rescue_items/threads/messages`, `verification_records`, credential status machinery.
* **API:** public rescue/verify endpoints; owner rescue RPCs; issuer RPCs.
* **Security:** Rescue threat model (doc 07 T6) signed off; external pen-test of public endpoints (**gate**); privacy review of finder-location (default off).
* **Frontend:** rescue owner console, finder page (accessible, low-bandwidth), verify page, issuer console.
* **Testing:** abuse simulation (spam bots, enumeration), message-privacy snapshot tests, cloned-tag replay tests.
* **Ops:** moderation SOP & staffing, SLA for abuse reports.
* **Risks:** harassment vectors; support load; false "verified" perception (mitigate with provenance labels).

### Phase 4 — Organizations, Locations, Accessibility (size XL)
* **Features:** full org console (roles, bulk device import/assign, credential templates, analytics k-anon, billing/GSTIN, audit view); **Locations** (dynamic content, versions, publish, multilingual, audio/simplified variants); event management; organization subscriptions (annual prepaid orders); org API (read) + API keys; i18n of UI; accessibility features (large text, high contrast, audio, screen-reader QA).
* **Dependencies:** Phases 1–3; accountant/GST decisions; translation workflow (OQ-10).
* **DB:** `locations`, `location_content`, `plans`, `subscriptions`, `api_clients/keys`, `webhook_endpoints`, `jobs` for bulk.
* **Security:** org SSO/MFA policy, API key lifecycle, tenant-isolation full matrix + pen-test.
* **Testing:** accessibility conformance audit (external), load tests for event-scale taps, translation QA.
* **Risks:** content moderation for org-published locations; performance at events.

### Phase 5 — Access, Hospitality, Enterprise (size XL, **gated**)
* **Features:** SHYGON Access (policy engine, temporary permissions, access decisions, short-lived signed tokens), hospitality (Privé) integrations with PMS/booking, enterprise SSO (SAML/OIDC), outbound webhooks, SLAs, advanced security (audit hash-anchoring).
* **Entry gates:** independent pen-test; documented Access threat-model sign-off; SDM/secure hardware in the field; incident response drill; legal/compliance for physical access.
* **Risks:** highest-liability phase; commercially justify each integration (master doc §19.5).

### Phase 6 — Full SHYGON OS ecosystem (continuous)
Cross-product identity portability (OIDC provider "Sign in with SHYGON" — evaluate), developer ecosystem/marketplace, verifiable-credential export (W3C VC/OpenID4VC, evaluate), large deployments (dedicated tenancy), internationalization & data residency, additional hardware, AI features per doc 09.

## 3. MVP definition (what "first production release of SHYGON OS Platform" means)

**Ships (Phase 0 + Phase 1):**
1. Everything V5 does today, unchanged for customers (cards, purchases, editor, public Tap, QR, analytics, admin app).
2. Reproducible, CI-tested database from an empty project; security findings F1–F6 closed with tests.
3. **Tap resolver**: per-device codes, lifecycle-enforced resolution, legacy slugs intact, edge rate limiting & caching.
4. **Privacy v1**: per-field public/private, default-private for new fields.
5. **Verified phone + step-up**, MFA for admins, security notifications on email + SMS.
6. **Notification outbox** with email channel and preferences.
7. **Analytics v2**: forge-resistant, coarse, rolled-up, retention-limited.
8. **Unified audit log**, extended admin permissions.
9. Customer `/app` shell with redirects; no visual redesign.
10. **Operational readiness (docs 13–14):**
    * kill switches K1–K8, K13, K14, K16 and K19, drilled;
    * feature flags with staged rollout;
    * SLO alerts to a phone-escalating pager;
    * public-leak canary;
    * approved migration pipeline;
    * change-risk engine and pre-deploy gates in CI;
    * role roster;
    * printed P0 runbook;
    * decision log.

**Success criteria (measurable):** all 100% of legacy `/t/<slug>` golden cases pass; resolve p95 ≤ 300 ms server / 1.5 s tap→paint on 4G; 0 open High findings; adversarial suite ≥ 100 checks incl. every F-item; zero customer-visible regression in Playwright smoke; email deliverability ≥ 98% on test set.

## 4. DO NOT BUILD YET (first Claude Code phase) — and why

| Do NOT build now | Why |
|---|---|
| SHYGON **Access** (policy engine, temp permissions, door integration) | Highest risk; needs SDM hardware, pen-test, legal; rule 13. Only the assurance-level concept and `evaluate_access` *interface* are documented. |
| SHYGON **Rescue** | Needs privacy/abuse design implemented in Phase 1 infra (edge limits, outbox, email) *first*; rule 14. |
| SHYGON **Verify** (issuing/attestation) | Depends on organizations and org verification; premature verification UI creates false trust. |
| **Organizations UI / multi-tenancy** | Not needed until Student (Phase 2); tenancy schema built with its first consumer avoids speculative design. |
| **Subscriptions / recurring billing** | Nothing sold that needs it; touching working payments adds risk. |
| Multiple personas per user | Schema-forward columns only; behaviour change belongs with Student/Connect UX. |
| Connect, Events, Locations | Need consent ledger + orgs. |
| Public developer API / API keys / outbound webhooks | No integrator exists yet; contracts freeze too early. |
| AI features | None required; doc 09 gates. |
| Push notifications / native customer app | No app exists; web + email/SMS suffice. |
| UI i18n framework & translations | Phase 4; only *centralize strings* now. |
| Visual redesign of Tap experiences or storefront | Explicit rule 1/5; renderer contains hard-won fixes. |
| Table renames (`tap_profiles`→`personas`, `cards`→`tap_devices`) | Break 45 admin RPCs and the Admin APK for zero function; use views later if desired. |
| Microservices, Kafka, GraphQL, new DB, new auth provider | Rule 4; Postgres + functions suffice. |
| Blockchain/DID/verifiable-credential infra | Unproven need; evaluate in Phase 6. |
| Emergency medical data | High liability; contact-only in Phase 2 at most. |
| Hotel PMS integrations | Phase 5, commercially justified. |
| Migration of existing customers to new plan model | Grandfather entitlements untouched. |
| **SHYGON Control project / in-product Command Center / `ops` schema / timers engine** (doc 13 §10, doc 14 O3) | Phase 0–1 governance runs on repo templates + external paging + out-of-band channel; the software comes at G3 when there is data worth protecting and people to coordinate |
| Knowledge graph, decision intelligence suggestions, customer impact simulator, cost attribution per customer | Need volume (decisions, orgs, usage) that doesn't exist yet; the raw links are captured from O0 so they can be back-filled |
| Automated rollback (auto) and any Release Agent that deploys | Notify-only watch window in Phase 1; automation later, never for migrations |
| Productizing the operating layer for external companies | Separate strategic bet (OQ-22); revisit after 2+ SHYGON products run on it |
