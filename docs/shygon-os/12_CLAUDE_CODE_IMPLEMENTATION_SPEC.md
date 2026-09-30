# SHYGON OS — CLAUDE CODE IMPLEMENTATION SPECIFICATION

**Audience:** a Claude Code session that has the V5 repo (`shygon-tap-v5-web`) checked out and has read docs 01–14 in this set. **Docs 13 (governance & P0) and 14 (operating layer) are binding on how Claude Code works.**
**Scope of THIS spec:** in build-ready detail:
* **Phase 0 (Stabilize & Baseline)** plus governance stage **G0/G1** and operating-layer stage **O0**;
* **Phase 1 (Core platform)** plus **G2/O1**.

Phases 2–6 are specified at architecture level in docs 02–10, 13 and 14; each needs its own spec written when it starts.

**Status of decisions:**
* Items marked **[DECISION NEEDED: DEC-… / OQ-n]** have an Accountable Owner (doc 13 §1.2, §3.1).
* The "default" given for each open question in doc 11 is a **recommendation, not permission**:
  * **L0–L1:** Claude Code may proceed on the recommendation, recording it as a PROPOSED decision.
  * **L2–L3** (architecture, security, data, product behaviour visible to customers or on printed cards): Claude Code **stops at the gate** until the decision record shows APPROVED (§2A). This follows G§69–70: no silent defaults.

---
## 0. Working rules for Claude Code (read first)

1. **Do not modify production data or apply migrations to the live Supabase project.** Produce migration files; a human applies them (V5's existing practice). Run everything against local PGlite and staging only.
2. **Migrations 001–019 are history: never edit them.** New work = `020_…` and up, each idempotent, each with a header (purpose, rollback SQL, dependencies) in V5's style, each covered by `db:verify` and `rls-adversarial` additions.
3. **Additive only** in Phases 0–1: no drops, no renames, no signature changes to any existing function/table that the Admin APK or shipped clients use (list in §2).
4. **Legacy `/t/<slug>` behaviour must be byte-compatible** (same JSON from `get_public_profile`). A golden test enforces it.
5. **Security before feature.** Milestone M0 must be green before M1 starts.
6. **No mock production systems, no hardcoded business data, no fake payment verification, no client-side authorization.** Every gate is enforced in Postgres or a server function.
7. **Every task ends with:** tests written, `npm run lint`, `npx tsc -b`, `npm run build`, `npm run db:apply`, `npm run db:verify`, `node supabase/tests/rls-adversarial.mjs`, `npm run test:payments` all passing; CHANGELOG entry; docs updated.
8. Prefer the smallest change that meets the acceptance criteria. If a requirement conflicts with existing behaviour, **stop, write a DEC draft from `docs/governance/DECISION_RECORD.md`, and escalate** rather than picking silently.
9. Commit per task with a message that names the finding/requirement id (e.g. `fix(F1): guard suspended_* columns`).
10. Never commit `.env`, keys, or ZIPs containing them.
11. **Governance behaviour (doc 13 §11; G§69–70).**
    * **STOP → FLAG → ESCALATE** to the right owner:
      * architecture ambiguity → Principal Architect;
      * security uncertainty → Security Owner;
      * data ownership or retention uncertainty → Data Owner;
      * product ambiguity → Product Owner.
    * Claude Code must never silently: change architecture, security boundaries, RLS or the auth model; delete production data; run destructive migrations; change product rules; bypass QA or release gates; invent business rules; or resolve governance conflicts by guessing.
    * **Preserve current behaviour** where a decision is pending. Example: card activation expiry keeps its live value until DEC-2026-002 is approved.
12. **Priority template.** For every material decision encountered, fill the G§71 template (I/U/Irr/R, score, matrix, final P, reviewers) in the DEC draft.
13. **If you discover a possible P0 while working** (a live secret, an exposure, cross-tenant access, data corruption):
    * stop the task;
    * fill in `P0_INCIDENT_RECORD.md` §1 with OBSERVED facts only;
    * tell the human immediately and name the doc 13 §5 criterion.
    * **Never** take production containment actions yourself. You have no production credentials, and kill switches are pulled by humans per doc 13 §7.2.
14. **Risk level drives review.** Run `scripts/ops/risk-engine.mjs` (once M0.8 exists) and put its level, blast radius and rollback plan in the PR using the template. L3 PRs need the specialist CODEOWNER approval. An AI review is advisory and never counts as an approval (doc 14 §3.6, §3.9).
15. **Agent boundaries (doc 14 §3.9).** Work only on feature branches. Never merge, deploy, apply migrations to staging/production without the pipeline's human approval, delete data, or approve anything. Keep the `Claude-Session` commit trailer (the AI audit trail, doc 14 §3.18).
16. **Evidence discipline.** In PRs, reports and DEC drafts, label claims OBSERVED / HYPOTHESIZED / CONFIRMED (G§67). "Tests pass" is stated only with the CI run link.

---
## 1. What exists (summary; full detail in doc 01)

React 19 + Vite 7 + Router 7 + Tailwind 4 (TS). Supabase = backend (RLS + triggers + SECURITY DEFINER functions). Netlify functions (`create-order`, `verify-payment`, `razorpay-webhook`, `check-delivery`, `card-otp`) mirrored in `api/*.mjs` for Vercel; Supabase Edge Functions `admin-refund`, `admin-push`. Public Tap at `/t/:username` in a tiny entry bundle using plain `fetch` to `get_public_profile`/`get_public_tap_state`/`record_tap_event`. One Tap per user. Admin APK external.

## 2. MUST REMAIN UNCHANGED (contract freeze)

| Item | Rule |
|---|---|
| `netlify/lib/{fulfilment,razorpay,supabase,sms,orderMessages}.mjs`, `netlify/functions/{create-order,verify-payment,razorpay-webhook,check-delivery}.mjs`, `api/*.mjs` | Behaviour frozen. Allowed: additive changes to `fulfilOrder` **only** for M-later plan grants; none in Phase 0–1 except bug fixes with tests. |
| `netlify/functions/card-otp.mjs` | Extend via the new generalized OTP service (M1.3); keep the old endpoint working until the customer UI migrates. |
| Tables & columns: `orders, order_items, payments, entitlements (existing cols), products, profiles (existing cols), tap_profiles (existing cols), cards (existing cols), notifications (existing cols), support_*, tap_events (existing cols), webhook_events, card_editions, tap_event_themes, admin_*` | No drop/rename/type change. |
| Functions: `get_public_profile(text)`, `get_public_tap_state(text)`, `get_public_tap(text)`, `record_tap_event(text,text,text)`, `get_tap_analytics`, `get_tap_link_clicks`, `tap_edit_state`, `theme_options`, `tier_rank`, `user_max_ui_tier`, `user_has_pass`, `claim_tap_slug`, `provision_tap_on_payment`, all `admin_*`, `is_admin`, `admin_has`, `require_admin`, `admin_audit(uuid,text,text,text,jsonb)`, `card_apply_verified_action` | Signatures/return shapes frozen. Bodies may change **only** where a milestone below says so, with contract tests. |
| Public URLs: `/t/:slug`, `/tap/:slug`, `/shygontap/*` (redirect, not remove), `/api/create-order`, `/api/verify-payment`, `/api/razorpay-webhook`, `/api/check-delivery`, `/api/card-otp` | Keep working. |
| Product rules: 4 experiences, ₹999 Pass semantics, 14-day edit rule, event themes, edition numbering, canonical origin `shygontech.com` | Unchanged. |
| `src/components/tap/*`, `src/styles/tap.css`, `src/lib/publicTapClient.ts` | Public renderer & client unchanged in Phase 0; in Phase 1 only *additive* support for resolver envelope (M1.2) behind a flag. Bundle ≤ current +5 kB gz (CI gate). |
| Visual design tokens/components | No restyling. |

---
## 2A. Decision gates (Claude Code must check before starting a milestone)

| Milestone | Blocked until APPROVED | Accountable Owner | If not approved yet |
|---|---|---|---|
| Any work at all | DEC-2026-001 credential rotation **completed** (human) | Security Owner | Claude Code may do M0.0/M0.1 (repo-only) but must not use any credential from older ZIPs |
| M0.2 baseline | OQ-3 live schema dump provided | Data Owner | Proceed repo-only; label every result VERIFY ON LIVE |
| M0.3/M0.4 (RLS changes) | L3 review by Security Owner on the PR | Security Owner | PR stays open |
| M1.1 lifecycle | DEC-2026-002 (card activation expiry, OQ-1) | Product Owner | Build the state machine; keep expiry **at live behaviour** |
| M1.1 hardware fields (`auth_mode='sdm'`) | OQ-2 chip decision | Security Owner | Ship `static` only; SDM interface behind a default-off flag |
| M1.5 email channel | OQ-8 provider | Principal Architect | Build the provider interface + in-app/SMS; email adapter waits |
| M1.11 paging/status page | OQ-17 paging & status tool | Release Owner | Alerts to email + SMS only (not launch-ready) |
| **Production launch of Phase 1** | OQ-16 role roster complete; G2 launch gate (doc 13 §12) | Product Owner | Staging only |

---
## 3. MILESTONES (exact implementation order)

Legend per task: **Goal · Files · DB · Tests (must fail before / pass after) · Acceptance.**

### PHASE 0 — STABILIZE & BASELINE

#### M0.0 — Governance bootstrap (G0) — *first commit*
* **Goal:** Put the governance system into the repo before any risky change.
* **Files:**
  * Copy the pack's `templates/` into `docs/governance/` (templates, `ROLE_ROSTER.md`, `decisions/DEC-2026-001…002`) and `docs/runbooks/P0_RUNBOOK_SHYGON_PRINT.md`.
  * Create `docs/DECISIONS.md` as an index table of every DEC with ID, title, priority, A, state and deadline. Seed it with the doc 13 §1.2 queue.
  * Add `.github/pull_request_template.md`, and `.github/CODEOWNERS` from the example with placeholders.
* **Human-only parts** (Claude Code lists them in the PR and does not fake them):
  * name the role holders;
  * create the out-of-band incident channel;
  * pick the paging service;
  * print and fill in the runbook;
  * rotate the credentials (DEC-2026-001).
* **Acceptance:** files present; `DECISIONS.md` lists DEC-2026-001… with owners; the PR records which human steps are still open.

#### M0.1 — CI & reproducibility scaffold
* **Goal:** Every push runs the full gate set; environments reproducible.
* **Files:** `.github/workflows/ci.yml`, `.nvmrc` (22), `package.json` scripts (`ci`, `test:db`, `test:bundle`), `scripts/check-bundle-size.mjs`, `docs/DECISIONS.md`, `docs/CHANGELOG.md`.
* **Gates:** `npm ci` → `eslint` → `tsc -b` → `vite build` → bundle-size check (public Tap chunk ≤ 90 kB gz) → `db:apply` (twice = idempotency) → `db:verify` → `rls-adversarial` → `test:payments` → secret scan (gitleaks) → `npm audit --audit-level=high`.
* **Acceptance:** CI green on main; a deliberately broken policy fails CI.

#### M0.2 — Capture the live baseline **[DECISION NEEDED: OQ-3]**
* **Goal:** Repo can rebuild a database equal to production.
* **Steps (human-assisted):** owner provides `pg_dump --schema-only --no-owner --schema=public` (and `auth` triggers list) from live. Claude Code: create `supabase/baseline/000_live_baseline.sql`, diff against 001–019 applied on PGlite, and write `supabase/baseline/DRIFT.md` listing every live-only object (expected: `cards.activated_at/last_activation_at/activation_expires_at/activation_count/deactivated_at`, `expire_tap_cards()`, `customer_activate_card()`, `customer_deactivate_card()`, `admin_set_product_inventory`, `admin_update_order_shipping`, original `profiles/orders/tap_profiles/admin_users` definitions, all policies, cards status CHECK, storage policies).
* **Then:** update `supabase/tests/baseline.sql` to be the real baseline; make `db:apply` = baseline + 020+. Keep 001–019 for history but mark as *already applied on live* (`supabase/migrations/README.md`).
* **Tests:** `db:apply` on empty DB succeeds; `card_apply_verified_action` executes end-to-end in a test (currently uncallable on fresh DB).
* **Acceptance:** empty-DB rebuild passes all suites; `DRIFT.md` reviewed by owner.
* **If the dump is unavailable:** proceed with M0.3–M0.6 using the repo, and mark every result **VERIFY ON LIVE**.

#### M0.3 — Close verified findings F1, F2
* **F1** `supabase/migrations/020_guard_suspension_columns.sql`: BEFORE UPDATE triggers on `tap_profiles` and `profiles` raising `42501` when `suspended_at/suspended_reason/suspended_by` (and on `tap_profiles`: `status` moving out of a suspended state) change while `auth.uid() IS NOT NULL AND NOT public.is_admin()`. Admin RPCs (`admin_set_tap_suspension`, etc.) must still work — they run as SECURITY DEFINER with the admin's `auth.uid()`; guard must allow `is_admin()` callers only through those RPCs (check `current_setting('app.admin_action', true)` set inside the definer functions **or** compare to caller privilege — pick one, document, test both paths).
* **F2** `021_admin_notes_table.sql`: adopt `supabase/proposed/011_admin_notes_off_customer_rows.sql` (review it, renumber, keep its header/rollback, keep `admin_get_order` JSON shape). Move `proposed/verify-011-admin-notes.mjs` into `supabase/tests/` and wire into CI.
* **Tests (add to `rls-adversarial.mjs`):** customer cannot clear `suspended_at` on own tap/profile (fails today); customer cannot select admin note; admin can still suspend/unsuspend via RPC; admin APK RPC shapes unchanged (contract snapshot test of every `admin_*` return type: `supabase/tests/admin-contract.mjs`).
* **Acceptance:** all pass; **VERIFY ON LIVE** statement in PR body with the SQL to check the live state.

#### M0.4 — Policy/lineage clean-up (F6)
* `022_policy_role_cleanup.sql`: recreate the seven `*_select_owner_or_admin` policies `TO authenticated` (from LIVE_SUPABASE_STATE.md); keep semantics; prove anon still gets denied (0 rows, no error is acceptable but error also ok — document).
* Merge 003/013 lineage decision: **keep both files untouched**; baseline supersedes; document in `supabase/migrations/README.md`. Regenerate `APPLY_ALL.sql` via `db:bundle` from baseline+020+ (or delete and document).

#### M0.5 — Secrets & hygiene (F10–F13)
* `create-order.mjs`: order id suffix via `crypto.randomInt` (only allowed edit to frozen file; test that id format `ST-<base36 time>-<4 digits>` unchanged).
* `docs/RUNBOOK-secrets.md` (switch **K10**): rotation steps for the Razorpay key and webhook secret, the Supabase service-role/secret keys, the OTP secret, the resolver HMAC and the email/SMS keys. Each has a verification step: payment test-mode order, webhook signature test, OTP test.
* **SEC-1 / DEC-2026-001:** the human performs the rotation. Claude Code records the completion evidence in the DEC, and verifies that no file in the repo or history contains a secret (`gitleaks` over full history). **If history contains a secret: stop, open a P0 classification (rule 13).**
* Scrub docs of dead project refs; add `SECURITY.md`.
* Storage audit script `supabase/tests/storage-audit.md` (checklist for human) → **OQ-15**.

#### M0.6 — Observability minimum
* Structured JSON logger `netlify/lib/log.mjs` (request id, no PII), error tracking hook (Sentry DSN env, optional), `/api/health` (DB ping, no secrets).

#### M0.7 — Review & approval controls (G1 / O0; doc 13 §11, doc 14 §3.5, §3.10)
* Document and script the GitHub settings. The human applies them; Claude Code writes `docs/governance/REPO_SETTINGS.md` with exact values:
  * branch protection on `main` (PR required, CODEOWNER review, status checks required, no force-push, linear history);
  * a **GitHub Environment `production`** with required reviewers (Release Owner, plus Security Owner for L3);
  * the Claude/agent bot account **without** merge or admin rights.
* `docs/governance/RELEASE_HANDOFF.md` becomes a required link in production deploy PRs.
* **Acceptance:** a test PR that touches `supabase/migrations/` cannot merge without the Data + Security CODEOWNERS.

#### M0.8 — Service catalog, blast radius & change-risk engine (O0; doc 14 §3.3–3.4)
* **Catalog:** `catalog/components/*.yaml` for every component in doc 14 §3.3. `catalog/journeys.yaml` lists the critical journeys: tap→resolve→render, sign-in, checkout→webhook→fulfilment, card OTP, admin refund.
* **Scripts:**
  * `scripts/ops/catalog-lint.mjs` fails on uncovered paths or a missing owner/runbook.
  * `scripts/ops/blast-radius.mjs` maps diff → components → dependents → journeys.
  * `scripts/ops/risk-engine.mjs` applies the rules table in doc 14 §3.4 and outputs `{level, reasons[], required_approvals[], rollback_required}`.
* **CI workflow `risk.yml`:** on every PR it posts one comment with level, reasons and blast radius, sets a `risk:L0..L3` label, and **fails** when a High/Critical PR lacks a rollback plan or DEC id.
* **Tests:** fixture diffs for each rule, e.g. migration with `DROP` → Critical, CSS-only → Low, payment file → Critical, flag-guarded UI → Medium.
* **Acceptance:** the engine explains every level; CODEOWNERS and the risk level agree on the M0.7 test PR.

#### M0.9 — AI change reviewer & AI audit trail v1 (O0; doc 14 §3.6, §3.18)
* **Workflow `ai-review.yml`:** calls Claude with the diff, catalog output and risk result. It posts the structured review (WHAT CHANGED … REQUIRED APPROVALS), which is **advisory** and never a required check that can approve.
* **Pre-send filter:** secret-pattern scan before any diff leaves CI; the job is skipped when it matches.
* **Key handling:** the API key lives only in the CI secret for this workflow.
* **Audit:** the PR template's AI section is required when a commit carries a `Claude-Session` trailer (a CI check).
* **Acceptance:** the review appears on test PRs; a secret-bearing fixture diff is not sent.

* **Acceptance for Phase 0:**
  * all gates green;
  * no open P1-or-higher security findings, **or** each one has an APPROVED DEC accepting the risk with a date;
  * the owner has signed off `DRIFT.md`;
  * G1 is done: the tabletop exercise for PB-4 has been run and a restore drill recorded.

---
### PHASE 1 — CORE PLATFORM

#### M1.1 — Device layer (cards → tap_devices) + lifecycle
* **Migration `030_tap_devices.sql`** (additive on `cards`): `public_code text` (unique, NOT NULL after backfill; generated by `gen_public_code()` — Crockford base32, 12 chars, `gen_random_bytes`), `device_kind text default 'card'`, `auth_mode text default 'static'`, `sdm_key_id text`, `sdm_last_counter bigint`, `owner_org_id uuid null` (nullable FK added later), `assigned_persona_id uuid`, `lost_at`, `retired_at`, `transfer_token_hash`, `transfer_expires_at`, `batch_id uuid`, `activation_secret_hash`. Status CHECK extended to `unassigned|pending|shipped|active|suspended|lost|transfer_pending|replaced|retired` (`NOT VALID` first, then `VALIDATE` after data check). Backfill `public_code` for all rows in batches; trigger sets it for new rows (fulfilment inserts unchanged).
* **State machine function** `device_transition(device_id, to_state, actor, reason)` (definer): enforces the legal edges from doc 08 §4, writes audit + `domain_events`, returns new state. **Only** path for state changes from clients/admin (existing `customer_*`/OTP paths call it).
* **RPCs (definer, granted `authenticated`):** `claim_device(code, activation_secret)`, `set_device_state(device_id, to_state, step_up_token)` (requires A3), `begin_transfer`, `accept_transfer`, `request_replacement`. Admin: `admin_issue_batch`, `admin_retire_device`, `admin_reassign_device` (reason required, `devices.*` permissions added via `admin_role_permissions`).
* **OQ-1 / DEC-2026-002 handling:** implement expiry behind the config `platform_config('card_activation_expiry_days')`.
  * **Its initial value must equal current live behaviour** (14, if M0.2 confirms it on live).
  * The value changes only by an APPROVED DEC-2026-002, applied by a human.
  * `0` means never expires; the sweeper is a no-op at 0.
  * Do **not** delete `expire_tap_cards()`.
* **Tests:** legal/illegal transition matrix; customer cannot set `status` directly on `cards` (new column guard — extend F1 pattern); transfer flow incl. expiry and replay; legacy cards backfilled with unique codes; admin batch export contains no secrets.
* **Acceptance:** doc 08 §4 table implemented; no existing admin RPC signature changed (contract test).

#### M1.2 — Resolver & routes (fixes F3)
* **Migration `031_tap_routes.sql`:** `tap_routes` per doc 03 §3.2 with composite FK ensuring target belongs to same owner; auto-create default route on assignment; backfill one route per existing device→owner's persona.
* **DB function** `resolve_tap(p_code text, p_kind text /* 'device'|'slug' */)` → JSONB envelope (doc 05 §7) — `STABLE`, definer, anon-executable, **cheap and read-only** (no sweeps). Semantics: state gating per doc 08 §4; `persona` payload = `get_public_profile()` output unchanged. Uniform `unavailable` for every negative case.
* **Edge function** `netlify/functions/resolve.mjs` (+ `api/resolve.mjs` mirror; update `netlify.toml` and `vercel.json` routes — build guard requires both): computes trust level (T0), client IP from platform header only, per-IP/per-code token buckets (store: Postgres table `rate_limits` with atomic upsert **or** platform KV if available; choose simplest, document), caches T0 responses ≤ 30 s (`Cache-Control: public, s-maxage=30, stale-while-revalidate=60` + cache tags for purge on persona publish/device change), returns problem+json on 429.
* **Routes in app:** add `/d/:code` to `src/App.tsx` next to `/t/:username` reusing `PublicTap` via a resolver client (`src/lib/resolveClient.ts`, plain `fetch`, **no SDK**). Legacy `/t/:slug` path unchanged unless flag `VITE_USE_RESOLVER=1`.
* **Signed event token:** resolve response includes short-lived HMAC token; `POST /api/v1/public/taps/:code/event` requires it (replaces open `record_tap_event` for new path; old RPC remains for legacy path but gets an internal per-hash dedupe/limit — see M1.6).
* **Tests:** golden set (≥ 20 real-shaped slugs incl. paused/draft/suspended/unknown) — legacy output byte-identical; device state matrix → correct envelope; anti-enumeration (all negatives identical body & similar timing within tolerance); rate-limit test; cache-purge test; bundle-size gate; **real-phone NFC/QR checklist** (`docs/QA-NFC.md`) run manually on ≥ 2 iOS + 2 Android models.
* **Acceptance:** suspending a device stops `/d/<code>` within 30 s; F3 test (card suspended ⇒ device URL unavailable) passes; `/t/<slug>` unchanged.

#### M1.3 — Verified contacts & step-up (fixes F4)
* **Migration `032_contact_methods.sql`:** table per doc 03; backfill from `profiles.email/phone` as *unverified* phone / *verified* email (Supabase-verified emails only).
* **Generalized OTP service** `netlify/functions/otp.mjs` (+ mirror): `POST /api/v1/otp/request|verify` with `purpose ∈ phone_verify | device_action | account_deletion | data_export`; reuse `card-otp.mjs` primitives (HMAC hashing, 10-min TTL, 5 attempts, 45 s resend, 5/hr) by extracting them to `netlify/lib/otp.mjs`. `card-otp.mjs` becomes a thin wrapper (unchanged external contract).
* **Rules:** OTP for `device_action` is sent **only to a verified phone**; if none, respond `needs_verified_phone`. A newly verified phone gets `high_risk_eligible_after = now()+72h`; changing phone notifies old email/phone (via M1.5 outbox). Step-up token: short-lived (10 min) signed record `step_up_tokens(user_id, purpose, expires_at, consumed_at)`; `set_device_state` etc. require a fresh one.
* **UI:** Settings → "Verify your phone" flow; device actions prompt step-up; copy explains why.
* **Tests:** attacker-with-session cannot pass device deactivation by editing phone (fails before); cool-down enforced; OTP brute-force limits; old contact notified (outbox row present).
* **Acceptance:** F4 closed; existing OTP tests unchanged.

#### M1.4 — Privacy v1: field visibility
* **Migration `033_persona_foundation.sql`:** `tap_profiles` + `context text default 'professional'`, `is_default bool default true`, `field_visibility jsonb default '{}'`, `org_id uuid null` (no FK yet). **Keep `UNIQUE(user_id)` in Phase 1** (multi-persona = Phase 2). Backfill `field_visibility` from `enabled_customizations` ∩ entitlements → `public`; everything else `private`. Constraint: values ∈ `{public, connections, organization, private}`; Phase-1 UI only exposes public/private.
* **Behaviour:** new definer `get_public_profile` body variant must produce **identical output** for existing data; visibility only *narrows* (a field marked private is dropped even if enabled). Implement by wrapping: `get_public_profile` continues to call current logic then removes private fields — **golden test proves equality when visibility back-filled**.
* **Persona version history:** `tap_profile_versions(id, tap_profile_id, snapshot jsonb, created_at)` written by trigger; keep last 10; owner can restore via RPC (counts as content edit under 14-day rule? — **decide: restore does not consume the edit allowance if restoring within 24 h**, document).
* **UI:** `Privacy` page (`/app/privacy`) — table of fields with visibility toggle, live preview of the public view, "what visitors can see" summary.
* **Tests:** private field never in public payload (canary values in every field); back-fill equality; version history bounded; 14-day trigger still passes existing 21 `db:verify` checks.

#### M1.5 — Notification outbox, email, preferences, security notifications
* **Migration `034_notifications_platform.sql`:** `domain_events`, `notification_deliveries`, `notification_preferences`; `notifications` + `dedupe_key`, `severity`, `expires_at`; `platform_config` key/value table (admin-editable via RPC) for tunables.
* **Worker:** Supabase Edge Function `supabase/functions/notify-worker` (Deno) or Netlify scheduled function — drains with `FOR UPDATE SKIP LOCKED`, retries with backoff, dead-letters; email provider adapter `notify/providers/email-<provider>.ts` **[DECISION NEEDED: OQ-8; default SES]**; SMS adapter reuses `netlify/lib/sms.mjs` logic (DLT template ids via env).
* **Producers:** DB triggers/RPCs insert `domain_events` in-transaction for: device state changes, phone change, password reset (via Supabase auth hook or client-initiated event), consent (later), payment captured (extend `notify_order_change`, keep in-app behaviour), admin actions of note.
* **Security categories are non-disableable.** Templates in `notifications/templates/en/*.txt|html`, snapshot-tested. Email bodies contain no private data.
* **Tests:** idempotency (`dedupe_key`); provider failure retries then dead-letter alert; preference respected except locked categories; no PII in templates (lint).

#### M1.6 — Analytics hardening (F5)
* **Migration `035_analytics_v2.sql`:** `tap_events` + `device_id, route_kind, trust_level, country_code, source, device_class`; replace md5 with HMAC using secret from `platform_secrets` (Vault) — implement `visitor_hash_v2(ua, ip_hash, day)`; `tap_daily_stats`; rollup + retention functions; partition plan doc (don't partition yet).
* **Legacy `record_tap_event`:** body may change *only* to (a) use v2 hash, (b) dedupe identical `(persona, hash, event, link_key)` within 30 s, (c) reject when > N events/min per hash. Signature frozen.
* **Jobs:** daily rollup + purge raw > 90 days (`platform_config`). Purge jobs **skip anything under an active `legal_holds` scope** (K14, M1.10). Security, access and audit logs are **not** subject to this purge (≥ 180 days per M1.11; audit ≥ 2 years).
* **Customer analytics** UI unchanged; reads rollups where cheaper.
* **Tests:** forged-burst test (1,000 calls) yields bounded counts; hash not reproducible with md5(UA|IP|day); rollup equals raw for a fixture; retention purge.

#### M1.7 — Unified audit + admin extensions
* **Migration `036_audit_generalization.sql`:** `admin_audit_log` + `actor_kind, org_id, request_id, ip_hash, outcome`; keep `admin_audit()` signature; new `audit_event(actor_kind, actor_id, action, entity_type, entity_id, org_id, outcome, meta)` definer used by all new RPCs; append-only enforced (revoke UPDATE/DELETE; trigger raising on attempts).
* **Admin:** `admin_role_permissions()` gains `devices.*`, `security.read`, `config.manage`; new RPCs `admin_list_devices`, `admin_get_device`, `admin_security_events`. **MFA:** enable Supabase TOTP; enforce **AAL2** in `require_admin()` for roles owner/admin (feature-flag `platform_config('admin_mfa_required')`, default on for owner); document rollout so admins enroll first.
* **Tests:** audit rows for every new privileged function; non-admin cannot call; append-only; MFA gate (simulate AAL claim).

#### M1.8 — Customer app shell (no visual redesign)
* **Files:** `src/apps/customer/` (`CustomerApp.tsx`, `routes.tsx`, `layouts/CustomerLayout.tsx`), move (via re-export, not rewrite) existing pages under `/app/*`; keep `/shygontap/*` routes as `<Navigate replace>` for one release; `src/lib/scope.tsx` (`ActingAs` context — persona only in Phase 1, org later); `src/components/ui/` for extracted primitives **only when a page you are touching needs it**.
* **New pages:** `/app/devices` (list, state chips, lost/suspend/transfer with step-up), `/app/privacy` (M1.4), `/app/security` (phone verification, sessions list, recent security events).
* **Requirements per new page:** loading/empty/error states, keyboard & screen-reader pass, ≥ 44 px targets, `prefers-reduced-motion`, no new global CSS (scope with a root class).
* **Tests:** Playwright smoke (login, view devices, suspend device, change privacy, public page reflects change ≤ 30 s), axe-core zero serious violations on new pages.

> **Execution order for the rest of Phase 1:** after M1.1–M1.8 come M1.10–M1.13 (M1.10 may start in parallel with M1.2, because the resolver needs K1), and **M1.9 is always last**.

#### M1.10 — Feature flags & kill switches (G2 / O1; doc 13 §7, doc 14 §3.17)
* **Migration `037_feature_flags.sql`:** `feature_flags(key PK, stage ('off'|'dev'|'internal'|'pct'|'on'), percentage int, allow_users uuid[], allow_orgs uuid[], deny_users uuid[], kill bool, owner text, description, expires_at, updated_by, updated_at)`.
  * Evaluate with `flag_enabled(key, subject uuid)`: a stable hash of subject id, then compared with the percentage. It is `STABLE` and definer-safe.
  * All writes go through `admin_set_flag(key, …, reason)`. That requires `config.manage` and **A3/AAL2**, writes an audit row, and needs an approved change request for L3 flags (a GitHub-recorded DEC id in the reason until the O3 approvals UI).
* **Kill switches as flags or config:**
  * K1 `resolver_mode`; K3 `public_endpoint.<name>`; K4 `writes_frozen`; K5 `checkout_paused`; K6 `fulfilment_hold`; K7 `notify.<channel>_paused`; K16 `routes_frozen`.
  * Read by triggers/RPCs (K4, K6, K16) and edge functions (K1, K3, K5, K7) with ≤ 30 s cache.
  * **K1 must work when the DB is unreachable:** the resolver falls back to the static page on DB timeout, and an env var `RESOLVER_FORCE_MAINTENANCE` exists.
  * K6 must keep writing the webhook ledger; a replay job `scripts/ops/replay-fulfilment.mjs` releases held orders idempotently.
  * K14: table `legal_holds`, honoured by every retention/purge job (M1.6).
* **Break-glass:** `scripts/ops/break-glass/K*.sql`, one reviewed SQL file per switch plus its reversal, each writing an audit row. Also `docs/runbooks/PB-1…PB-11.md` stubs from doc 13 §8 with the switch commands filled in.
* **Frontend:** a tiny flag client (`src/lib/flags.ts`) reading a public, non-sensitive flag snapshot for UI gating. Authorization never depends on flags.
* **Tests:**
  * each switch flips effect on staging within its target time (automated where possible);
  * K1 works with the DB unreachable (simulated);
  * K6 replay is idempotent;
  * retention skips legal-hold scope;
  * flag hash distribution within ±2% at 10k subjects;
  * `flag-lint.mjs` fails on a flag without owner/expiry.
* **Switches that already exist or live outside flags:**
  * K2 device/persona/account revoke is covered by M1.1's `device_transition` plus the existing admin suspension RPCs.
  * K8 session revocation: `scripts/ops/break-glass/K8-revoke-sessions.*` (per user, all admins, all users via signing-key rotation runbook).
  * K9–K12, K17 are runbooks from M0.5/M0.7.
  * K19 agent disable: documented steps for the GitHub App/bot token, the CI Anthropic key and the agent DB role.
* **Acceptance:** the kill-switch drill checklist (`docs/runbooks/DRILLS.md`) passes on staging for **K1–K8, K13, K14, K16 and K19**, each with time-to-effect recorded against doc 13 §7.1.

#### M1.11 — Detection, SLOs, paging, canaries, rollback watch (G2 / O1; doc 13 §6, doc 14 §3.12–3.14)
* **SLO definitions** in `catalog/slo.yaml` (from doc 13 §6.1), wired into the chosen monitoring tool **[DECISION NEEDED: OQ-17]**, with synthetic probes from ≥ 2 regions for the resolver (a canary device code, a legacy golden slug), sign-in and checkout health. Alerts go to the paging service and SMS.
* **Public-leak canary job** (scheduled function):
  * fetches the canary persona through every public route and export, and scans for canary strings;
  * a hit pages as P0 (PB-2) and writes a `domain_events` security event.
* **DB detector jobs** (sweeper): row-count guard on core tables; mass device/route change detector; reconciliation diff (orders paid vs fulfilled vs payments); admin privilege-change detector. Thresholds live in `platform_config`.
* **Log drain** to durable storage with **≥ 180-day retention** for edge, function, auth and audit logs (doc 13 §9; counsel to confirm).
* **Rollback watch:**
  * `deploy_records` table (deploy id, commit, level, flags snapshot, migrations, watch result, last_known_good bool);
  * a post-deploy job compares SLO indicators with the baseline for 15 min (30 for L3) and **notifies** on anomaly with the one-click rollback target. Auto-rollback is O2, not now.
* **Weekly generated reports** as artifacts (markdown/HTML): **security posture** (doc 14 §3.14 table, fed by CI + Supabase advisors) and **ops digest** (open DECs by priority/overdue, incidents, deploys, SLO burn, cost vs budget).
* **Acceptance:**
  * a simulated resolver outage on staging pages within 5 min;
  * a planted canary leak on staging pages;
  * the watch job flags an injected error-rate regression;
  * the reports generate from real CI data.

#### M1.12 — Data governance catalog, DR automation, cost guardrails (O1; doc 14 §3.15, §3.16, §3.19)
* **Data classification:** every table/column created or altered from `020_` onward carries a `COMMENT … 'class=S0..S4;retention=…;pii=…'`. `scripts/ops/data-class-lint.mjs` fails CI on unclassified columns. Back-fill comments for existing tables in `038_data_classification_comments.sql` (comments only; no behaviour change).
* **Data catalog:** `catalog/data/*.yaml` covers stores, processors (Razorpay, MSG91/Twilio, email, hosting, AI later), regions, retention and legal basis. It generates `docs/data/INVENTORY.md` and a draft **record of processing** for counsel review.
* **DR:** confirm PITR on the Supabase plan (human). Add `scripts/ops/restore-drill.mjs`: restore to staging from a backup, verify row counts/checksums/invariants, and write evidence to `docs/runbooks/DR-LOG.md`. Add a **Storage backup job** (object copy to separate storage) with its own restore test. RPO/RTO targets go in `catalog/dr.yaml` (doc 14 §3.16), pending Data + Product Owner approval.
* **Cost:** per-provider monthly budgets and alerts. **Circuit breakers:** the SMS daily cap (per purpose; OTP protected) and the notification worker refuse over-budget non-critical sends.
* **Acceptance:** CI blocks an unclassified column; the restore drill passes with evidence; the SMS cap trips in a staging test while security OTP still sends.

#### M1.13 — Approved migration pipeline (O1; doc 14 §3.5)
* **Workflow `deploy-db.yml`:**
  * on merge to `main` with new migrations, apply to **staging** automatically, then run `db:verify`, adversarial tests and golden tests against staging;
  * then wait for **GitHub Environment `production` approval** (Data Owner + Security Owner for L3);
  * then apply to production with a scoped access token stored only in that environment;
  * then run post-migration verification SQL from each migration header and write a `deploy_records` row.
* **Manual SQL-editor application** remains documented as break-glass only, with an audit note required.
* **Acceptance:** a dry-run migration flows through staging, waits for approval and records evidence. Production application happens only after owner sign-off of this milestone (a human decision).

#### M1.9 — Hardening, load, docs, release (runs last)
* Load test resolver (k6): 200 rps, p95 server ≤ 300 ms; chaos: DB slow → stale-while-error page works.
* Dashboards & alerts per doc 02 §8; runbooks per doc 07.
* Update `README.md`, `PRODUCTION.md` (replace stale sections), `docs/ARCHITECTURE.md` (link to these docs), `docs/DECISIONS.md`.
* Staged rollout: staging → internal → canary account → 5% → 25% → 50% → 100% using `feature_flags` (M1.10). Each stage has its own watch window; stage increases for L3 features need the Release Owner's approval recorded in `RELEASE_HANDOFF.md`.
* Tabletop exercise #2 (PB-6 resolver outage), recorded as a post-incident-style review.

---
## 4. Cross-cutting requirements

### 4.1 Database
* Naming: snake_case; tenant/user columns `user_id`/`org_id`; timestamps `timestamptz`; `id uuid default gen_random_uuid()`.
* Every new table: RLS enabled in the same migration; explicit policies **or** documented "server-only"; `REVOKE ALL FROM anon, authenticated` then targeted `GRANT`.
* Every definer function: `SET search_path = public, pg_temp`; `REVOKE ALL ON FUNCTION … FROM PUBLIC`; explicit `GRANT`.
* Indexes per doc 03 §5; large backfills batched with `pg_sleep` and progress table; `CREATE INDEX CONCURRENTLY` outside transactions (separate migration file).
* Add a CI lint script `supabase/tests/lint-definer.mjs` failing on any `SECURITY DEFINER` function lacking pinned `search_path` or a `REVOKE … FROM PUBLIC`.

### 4.2 RLS requirements (must be tested)
Follow doc 03 §6 table. Additionally: every **column a customer must not change** on tables they can UPDATE (`tap_profiles`: `suspended_*`, `org_id`, `is_default`, `status` when suspended; `cards`: everything — customers change state only through RPC; `profiles`: `suspended_*`, `shygon_id`, `email` is display-only) is guarded by trigger and has an adversarial test line.

### 4.3 Auth
Implement per doc 04 §2: verified phone, step-up, MFA for admins, notifications on security changes, session revocation on password change. Do **not** switch auth providers. Keep email login as is.

### 4.4 API
Freeze envelope + problem+json + limits from doc 05. New public routes get contract tests (schema, rate limit, uniform negatives, oversized body, fuzz, leak snapshot).

### 4.5 Frontend
Follow doc 02 §6. No new heavy dependencies (allowed: `@axe-core/playwright`, `@playwright/test` dev-only). Public renderer bundle budget enforced. i18n prep: new copy in `src/copy/*.ts` keyed constants (extractable later).

### 4.6 Payments
**No changes** in Phase 0–1 apart from M0.5 order-id fix. Add reconciliation script `scripts/reconcile-razorpay.mjs` (read-only, run by human) and alert on `fulfillment_status='retry'` age. Grandfathered entitlements untouched.

### 4.7 Admin & Organization requirements
* Admin: M1.7 extensions only. Existing APK must continue to work — run the admin-contract snapshot in CI.
* Organization: **none in Phase 1** (schema arrives in Phase 2; do not create org tables early, except the nullable `org_id` columns specified above).

### 4.8 Security requirements (Phase 0–1 gates)
See doc 07 §2. Additionally: CSP report-only endpoint `/api/csp-report`; `Permissions-Policy` unchanged; dependency scanning in CI; `security.txt` at `/.well-known/security.txt`.

### 4.9 Testing requirements (summary)
| Layer | Tooling | Minimum |
|---|---|---|
| DB rules | PGlite `db:verify` | one check per new rule/trigger |
| RLS/security | `rls-adversarial.mjs` | ≥ 100 checks by end of Phase 1 (from 48), one per finding & column guard |
| Contract | `admin-contract.mjs`, `golden-legacy.mjs`, `public-leak.mjs` | run in CI |
| Functions | node test files like `netlify/tests/*` | resolver, otp, notify-worker |
| E2E | Playwright | smoke journeys above |
| a11y | axe | 0 serious/critical |
| Load | k6 | doc M1.9 |
| Devices | manual `docs/QA-NFC.md` | ≥ 4 phones |

### 4.10 Deployment requirements
* Environments: `local` (PGlite/`netlify dev`), `staging` (separate Supabase project + Netlify site, Razorpay **test** keys), `production`.
* Env vars added: `RESOLVER_HMAC_SECRET`, `VISITOR_HASH_SECRET_V` (rotating), `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `TURNSTILE_SECRET` (M1.2 optional for public POSTs), `SENTRY_DSN` (optional), `PLATFORM_ENV`. Document in `.env.example`; none `VITE_`-prefixed except public site keys.
* Migrations: until M1.13 is signed off, a human applies them in order (staging first) with the post-migration verification SQL from each header. After M1.13, **only through the approved pipeline**, with the SQL editor as documented break-glass.
* Env vars added by governance/ops milestones: `RESOLVER_FORCE_MAINTENANCE` (K1 fallback), `PAGING_WEBHOOK_URL`/`PAGING_API_KEY` (OQ-17), `LOG_DRAIN_*`, `ANTHROPIC_API_KEY` (**CI secret only**, for M0.9 — never in app runtimes).
* Every production deploy writes a `deploy_records` row, and L2/L3 deploys link a `RELEASE_HANDOFF.md`.
* Feature flags in `platform_config`; ship dark, enable per environment.
* Rollback: each migration header contains rollback SQL; app deploy rollback via Netlify deploy history.

### 4.11 Migration requirements
Follow doc 11 Part B sequence and principles. Legacy compatibility golden tests block release.

---
## 5. Definition of done (Phase 0+1)

1. All milestones' acceptance criteria met; CI green; no open P1+ security findings without an APPROVED risk-acceptance DEC.
2. The Accountable Owners have APPROVED the gating decisions in §2A (DEC-2026-001 completed; DEC-2026-002; OQ-2, OQ-3, OQ-8, OQ-17). Recommendations don't count unless recorded as approved.
2a. **Governance launch gate G2 (doc 13 §2.3, §12):** role roster complete (OQ-16); paging tested; printed runbook filled in; kill-switch drill passed; SLO alerts live; public-leak canary live; log drain ≥ 180 days; tabletop #1 and #2 done.
3. Staging soak ≥ 7 days with synthetic taps and a canary account; no state/cache anomalies.
4. Runbooks written and rehearsed once (secret rotation, device revoke, restore from backup).
5. Docs 01–12 updated to reflect what was actually built (deviations recorded in `docs/DECISIONS.md`).

## 6. Handoff to Phase 2 (preview — not to be built now)
Organizations/memberships/consent/connect/student per doc 10 Phase 2; new spec required. Prerequisites: counsel review (OQ-9), org verification SOP, first pilot school (OQ-11).
The operating layer's O2/O3 work (SHYGON Control project, `ops` schema, Command Center, cross-tenant canary, agent registry) also gets its own spec (doc 14 §5). **G3 must be complete before any student or organization data is stored.**

## 7. Appendix — glossary of V5 terms (so nothing is misread)

| Stored / code | Means |
|---|---|
| `entitlements.type='lifetime'`, SKU `pass-customization` | ₹999 Customization Pass (unlimited edits + all palettes; **not** a tier) |
| `digital_plan` / `selected_ui_tier` / `ui_tier` | the digital experience: `essential|business|premium|goat` (legacy `free|pro|3d|custom` remapped by `tier_rank`/`normaliseExperienceKey`) |
| `tap_profiles.slug` / `username` | public address (vanity), unique case-insensitively |
| `cards` | physical NFC/QR devices (future `tap_devices`) |
| `published` boolean | mirrored from `status='active'` |
| `orders.user_id` / `customer_id` | both = owner (legacy dual columns) |
| `event themes` | seasonal platform presentation overrides |
