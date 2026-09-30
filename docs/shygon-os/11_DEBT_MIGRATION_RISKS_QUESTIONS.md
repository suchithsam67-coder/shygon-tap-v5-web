# 11 — Technical Debt / Migration Plan · Risks & Open Questions

*Covers requested docs 18 and 19.*

## Part A — Technical debt register (ordered by payoff)

| ID | Debt | Impact | Fix | Phase |
|---|---|---|---|---|
| D1 | Repo ≠ live DB (live-only tables/functions/columns/policies; 003 vs 013 fork; stale `APPLY_ALL.sql`; gap at 011) | Cannot rebuild, test or safely change prod | `supabase db pull` baseline → squash → CI from empty | 0 |
| D2 | No CI | Great tests run only manually | GitHub Actions gates | 0 |
| D3 | Migration ordering fragility ("re-run 002 wipes admin policies") | Regressions when replaying | Baseline squash; every migration idempotent *and* order-independent, or checked by CI in order | 0 |
| D4 | Business rules in triggers/functions w/o unit-level tests per rule | Hard to extend safely | Keep DB-centric approach; add rule-per-test files; document each function's contract | 0–1 |
| D5 | Hard-coded contact columns + `enabled_customizations` array | Blocks field-level visibility & new contexts | `field_visibility` jsonb; keep columns | 1 |
| D6 | Legacy names (`lifetime`, `pro`, `3d`, `username`/`slug`, `published`/`status`, `customer_id`/`user_id`) | Cognitive load, bugs (already bit once) | Don't rename; add glossary + typed aliases in TS; deprecate in place | ongoing |
| D7 | Public reads unauthenticated straight to Supabase (no cache/rate-limit) | Scrape/DoS, no trust level | Edge resolver | 1 |
| D8 | `expire_tap_cards()` executed on read (legacy fn) | Writes on GET, slow | Scheduled sweeper | 1 |
| D9 | Duplicated serverless entries (Netlify + `api/*.mjs` + Supabase Edge for refund) | Drift; secrets in 2 runtimes | Keep mirror guard; single shared `lib`; document; consider consolidating refund | 1–4 |
| D10 | Large page components (`ShygonTap.tsx` 1455 lines, `TapEditor` 983, `Checkout` 843, `Settings` 680) | Slows change; regression risk | Extract hooks/sections *when touched*, not a rewrite | opportunistic |
| D11 | Three overlapping CSS systems (`tokens`, `app`, `customer-experience`, `enhance`, `motion`, `tap`) with `body:has(.storefront)` scoping | Style conflicts as new apps added | Keep; scope new apps with their own root class; no global overrides | 1–2 |
| D12 | Unrouted corporate site code shipped in repo (`Home.tsx` + components) | Dead code | Move to separate repo/route later | low |
| D13 | Realtime/Node versions pinned by workaround (Node 22 for supabase-js WebSocket) | Env drift | Pin `.nvmrc`/engines/CI; add `NoRealtime` test | 0 |
| D14 | Docs contain history & stale statements (deleted project ref; "four migrations") | Misleads new engineers | Single `docs/` truth + CHANGELOG; archive old notes | 0 |
| D15 | Secrets hygiene (ZIP distribution of `.env`) | Leak | Never zip env; rotate; secret-scan CI (**now tracked as SEC-1 / DEC-2026-001, doc 13 §1.1**) | 0 |
| D16 | Production migrations applied by pasting SQL into the editor | Unaudited, error-prone, no approval record | Approved migration pipeline (doc 12 M1.13) | 1 |
| D17 | No governance records (decisions scattered across chat and docs) | Lost context, silent decisions | Decision log + templates (doc 12 M0.0) | 0 |

## Part B — Migration plan (V5 → SHYGON OS) — principles & sequence

**Principles.** (1) *Additive first, destructive never* within Phases 0–2: new columns/tables, no drops/renames of stored names. (2) *Expand → backfill → switch → (later) contract.* (3) Every step reversible (rollback SQL in header, as V5 already does). (4) **Legacy card URLs must resolve identically before and after every release** (golden test set of real slugs). (5) Feature-flag anything user-visible; migrations ship dark. (6) Staging first with a **copy of production data** (scrubbed).

### Sequence

| Step | Change | Backfill | Switch | Rollback |
|---|---|---|---|---|
| M0.1 | Capture live baseline; reconcile 003/013; create staging | — | CI builds DB from baseline | n/a |
| M0.2 | Guards for `suspended_*`; apply 011 (admin note table); tidy policies | copy `admin_note` → new table | admin RPC reads new table | keep old column until verified |
| M1.1 | `cards` +`public_code`, `device_kind`, `auth_mode`, states | generate codes for all rows | resolver reads codes | columns nullable → drop is safe |
| M1.2 | `tap_routes`; default route per (device→default persona) | one route per existing device with owner persona | resolver v2 | disable flag → v1 |
| M1.3 | `contact_methods`; `profiles.phone` copy as *unverified* | phone rows `verified_at NULL` | high-risk actions require verified | flag off = old OTP path |
| M1.4 | `tap_profiles` +`context`, `is_default`, `field_visibility` | today's enabled fields → `public`; others `private`; `is_default=true` | privacy page reads/writes; **public payload unchanged** | columns ignorable |
| M1.5 | Outbox + deliveries + preferences; email provider | — | dual-run: triggers keep in-app; outbox drives email/SMS | stop worker |
| M1.6 | `tap_events` +cols; HMAC hash; rollups; retention | rollup from history | dashboards read rollups | keep raw table |
| M1.7 | `audit_log` generalization | existing rows `actor_kind='admin'` | new writers | additive |
| M1.8 | Frontend `/app` shell; redirects from `/shygontap/*` | — | 301/client redirects, keep old routes alive one release | remove redirects |
| M2.1 | Orgs/memberships/consents/… (new tables) | none | UI behind flag | drop new tables (empty) |
| M2.2 | Relax persona uniqueness | — | multi-persona flag | restore unique (only if ≤1 per user) |

**Data migration risks:** slug collisions with reserved codes (mitigated by `/d/` namespace); users with several legacy cards (OQ-2b); cards lacking `card_uid`; orders with legacy plan ids (existing normalizer stays); replayed webhooks during cutover (ledger handles).

**Cutover safeguards:** maintenance-free migrations (no long locks: `CREATE INDEX CONCURRENTLY`, batched backfills with progress table), pre-flight checks like 003's, post-migration verification SQL (as PRODUCTION §7), and a production canary account.

## Part C — Risks

| ID | Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|---|
| R-1 | Live DB differs from repo in unknown ways | H | H | M0 baseline first; freeze schema changes until captured | Eng |
| R-2 | Card-activation semantics wrong (14-day expiry) silently disables paying customers' cards | M | **H** | Decide OQ-1 before touching lifecycle; audit `expire_tap_cards` on live; alert if > X cards expire/day | Owner+Eng |
| R-3 | Scope explosion (platform vision > team capacity) | H | H | Phase gates; DO-NOT-BUILD list; one module per phase | PM |
| R-4 | Rescue harassment / safety incident | M | H | Doc 07 T6; launch invite-only; kill switch; moderation staffing | Sec |
| R-5 | Minors' data compliance (DPDP Act 2023 children's provisions; school contracts) | M | H | Counsel review before Student launch; restricted defaults; age band only | Legal |
| R-6 | Cloned static NFC tags erode trust in Rescue/Access | M | H | SDM tags for anything with ownership meaning | Hardware |
| R-7 | Cache/edge bug leaks or serves stale suspended pages | M | H | Purge tags, 30 s ceiling, golden tests, suspension canary | Eng |
| R-8 | Tenant isolation defect | L | **C** | Matrix tests, external pen-test, staged rollout | Sec |
| R-9 | Sensitive (medical/emergency) data liability | L | H | Exclude medical from scope; contact-only; encryption | Legal |
| R-10 | Email/SMS deliverability & DLT compliance blocks critical alerts | M | M | Domain auth, DLT templates pre-registered, dual-channel for critical | Ops |
| R-11 | Vendor concentration (Supabase, Netlify, Razorpay) | M | M | Portable Postgres schema, IaC for env, exit notes | Eng |
| R-12 | Breaking the Admin APK contract | M | H | Contract tests on all `admin_*` RPC signatures; never change signatures | Eng |
| R-13 | Performance at events (burst taps) | M | M | Edge cache, load tests, static fallback | Eng |
| R-14 | Support burden from new lifecycle (transfers, lost) | M | M | Admin tooling first, macros, clear UX copy | Ops |
| R-15 | Over-collection in analytics | L | H | PII lint, schema review | Sec |
| R-16 | Possible credential exposure from earlier ZIPs (SEC-1) | M | **C** | Rotate now; review access logs; escalate to P0 on triggers (doc 13 §1.1) | Security Owner |
| R-17 | One-person team can't provide independent review or a secondary incident lead | H | H | External retained reviewer for L3; trained secondary responder with limited switch rights (doc 13 §2.2) | Product Owner |
| R-18 | Incident tooling down together with the platform | M | H | Separate Control project + out-of-band channel + external paging (doc 14 §2) | Release Owner |
| R-19 | Governance theatre (templates filled, controls not enforced) | M | M | Every rule mapped to a technical control; drills with evidence | Security Owner |
| R-20 | AI agent overreach (merge/deploy/delete) | L | H | Technical agent boundaries, no prod credentials, K19 (doc 14 §3.9) | Security Owner |
| R-21 | Operating-layer scope explosion | H | M | Only O0–O1 in the first build; ★ items only (doc 14 §5) | Product Owner |

## Part D — Open questions (decisions needed; owner answers unblock Claude Code)

**Blocking for Phase 0/1**

> **Governance note (doc 13, G§69–70):** the right-hand column is a **recommendation**, not a default Claude Code may apply. For L2–L3 questions, Claude Code stops at the gate (doc 12 §2A) until the Accountable Owner records a decision. Each question's Accountable Owner and priority are in doc 13 §1.2 and §3.1.

| # | Question | Why it matters | Recommendation (needs owner approval for L2–L3) |
|---|---|---|---|
| **OQ-1** | What is the **14-day card activation** meant to do? Is a card *supposed* to stop working 14 days after activation unless renewed (live `expire_tap_cards`), or is that a mix-up with the 14-day *edit* interval? | Determines lifecycle rules & resolver gating; may be silently disabling cards | Treat as **bug**: activation does not expire; cards stay active until suspended; sweeper disabled after audit |
| **OQ-1b** | Confirm live `get_public_profile` — does it check card status on live? (repo version doesn't) | F3 severity | Assume repo version |
| **OQ-2** | Which NFC chip is in shipped cards (NTAG213/215/216/424 DNA?), and can the metal/transparent designs carry a 424-class inlay? | Cloning resistance, Rescue hardware plan | Assume NTAG21x static; SDM optional for new batches |
| **OQ-2b** | Users with several legacy cards: does suspending one card gate the persona? | Legacy behavior | Persona reachable while ≥ 1 legacy device active |
| **OQ-3** | Grant read access to **live Supabase schema** (or a `pg_dump --schema-only`) and the **Admin APK** repo contract | Baseline & contract tests | Work from repo only (risky) |
| **OQ-4** | How many personas per plan (Essential/Business/Premium/GOAT/Pass)? | Gating in trigger | Essential 1; multi-persona unlocked by Pass or paid tier — *decide at Phase 2* |
| **OQ-5** | Is the 14-day edit limit per persona or per account? | Trigger semantics | Per persona |
| **OQ-6** | Phone as a **login** method or only a verification/2FA channel? (Supabase phone auth cost & SMS DLT) | Auth design | Verification/2FA only |
| **OQ-8** | Transactional email provider (SES vs Resend vs other)? Sending domain? | Phase 1 email | Amazon SES (ap-south-1), sender `no-reply@shygontech.com` |

**Needed by Phase 2–4**

| # | Question | Recommendation |
|---|---|---|
| **OQ-7** | Recurring billing: annual prepaid vs Razorpay Subscriptions vs invoice? | Annual prepaid orders |
| **OQ-9** | Legal/compliance review: DPDP Act 2023 (consent, children's data/verifiable parental consent, breach notification, data-principal rights), data residency, GST invoicing for org plans, retention periods, terms for orgs issuing credentials. **This plan is not legal advice.** | Engage counsel before Phase 2 |
| **OQ-10** | Languages required first (Hindi + regional?), translation workflow (human vs MT + review)? | English + Hindi; MT with human review for safety text |
| **OQ-11** | Which organizations are the first pilots (a school? a hotel?) and what do they need contractually (SSO, data residency, SLAs)? | Schools first (Student + School OS memory) |
| **OQ-12** | Who staffs moderation/abuse handling for Rescue and Verify? | Founder-run queue with SLA, tooling first |
| **OQ-13** | Should the Admin become a web app too (currently APK)? | Keep APK; add `/admin` web only if staff need desktop |
| **OQ-14** | Is a customer mobile app planned (affects auth/push)? | Not planned; PWA first |
| **OQ-15** | Storage: which bucket/policies exist for avatars/org documents? | Audit in Phase 0 |

**Added by governance & operating-layer planning (docs 13–14)**

| # | Question | A | Recommendation |
|---|---|---|---|
| **OQ-16** | Who holds each canonical role (Product, Architect, Security, Data, Engineering, QA, Release, primary/secondary Incident Lead)? Is there an external L3 reviewer? | Product Owner (Founder) | Fill in `ROLE_ROSTER.md` before Phase 1 launch; engage a retained security reviewer if only one engineer |
| **OQ-17** | Paging service with phone escalation + external status page + out-of-band incident channel | Release Owner | Any service with phone-call escalation and a free/small tier; status page hosted off SHYGON infrastructure |
| **OQ-18** | Confirm with counsel: CERT-In 6-hour reporting and 180-day log retention; DPDP breach notification; Razorpay obligations | Data Owner | Counsel review before Phase 1 launch (security logs) and Phase 2 (student data) |
| **OQ-19** | Approve the SLO/threshold proposal (doc 13 §6) and RPO/RTO (doc 14 §3.16) | Product Owner (SLO) + Data Owner (RPO/RTO) | Accept as proposed; revisit after 90 days of data |
| **OQ-20** | Approve the governance-spec clarifications GAP-1…GAP-12 (doc 13 §13) | Product Owner | Accept as proposed |
| **OQ-21** | Naming: "SHYGON OS" (platform) vs the internal operating layer ("SHYGON Control") | Product Owner | Two names, two bounded contexts |
| **OQ-22** | Productize the operating layer for other companies? | Product Owner (Founder) | Internal only until 2+ SHYGON products run on it and external validation exists |

## Part E — Assumptions made (explicit, per rule 17)

1. Supabase remains the platform (no migration to another BaaS).
2. Team is small; Claude Code implements under human review; migrations are applied by a human with SQL access (as V5 has done).
3. Cards already sold use static URLs of the form `https://shygontech.com/t/<slug>` (per V5 docs) and can't be rewritten.
4. The Admin APK uses only the RPC/table contracts visible in migrations 003/013.
5. India is the primary market (INR, DLT SMS, GST, DPDP Act).
6. The public page for a persona remains publicly reachable by slug (V5 product promise), so device *state* gating for legacy cards is best-effort (OQ-2b).
7. Master document's phase order is the commercial intent; this plan only inserts Phase 0 and moves orgs' *schema* into Phase 2.
