# 13 — Decision Governance, Priority & P0 Incident Response (applied to SHYGON OS)

**Canonical sources (adopted as-is, they win on process):**
(G) *SHYGON OS — Decision Governance, Priority & P0 Incident Response Specification* (§§1–92) · (R1) *P0 Quick-Reference Runbook* · (R2) *P0 Incident — Quick-Reference Runbook (print)*.
Section references like "G§23" point into the governance spec.

**What this document adds.** The governance spec defines *how* SHYGON decides and responds. This document applies it to the SHYGON OS architecture:
1. It triages today's audit findings with the spec's priority model.
2. It names the SHYGON-specific P0 scenarios, detection signals and containment controls ("kill switches") the platform must have.
3. It specifies the governance module (decisions, incidents, timers, Command Center) as software.
4. It turns governance into gates on the roadmap and on Claude Code.
5. It lists the gaps and ambiguities found in the spec (§13), rather than filling them in silently (G§70, G§92).

---
## 1. Immediate triage (Claude Cowork classification per G§68, G§72)

### 1.1 SEC-1: Possible credential exposure. **Security Owner decision needed now.**

```text
P0 DETECTION (classification record — produced by Claude Cowork, 2026-09-29)

P0 ID:                 (not opened — see classification below) → tracked as DEC-2026-001
DETECTED AT:           2026-09-29 (document review of V5 zip)
DETECTED BY:           Claude Cowork architecture audit
OBSERVED FACT:         (1) PRODUCTION.md §8.3 states the Razorpay key secret was once written
                       in plaintext in that file and "is currently present in .env, which is
                       gitignored but was distributed inside the project ZIPs".
                       (2) TEST_REPORT.md §2.1 states a Supabase SERVICE-ROLE key for the live
                       project (auvgvikdbhbrtsrsaslv) was installed into the local .env
                       (12–17 Sep) and a backup .env.bak-* kept.
                       (3) The ZIP provided on 2026-09-29 contains NO .env and no real secrets
                       (scanned: only test placeholders).
AFFECTED SYSTEM:       Razorpay account; Supabase production project (service role bypasses ALL RLS)
AFFECTED USERS/TENANTS: Live DB held 0 orders/cards/taps and 2 profiles on 17 Sep (TEST_REPORT);
                       current contents UNKNOWN.
KNOWN IMPACT:          None observed.
POTENTIAL IMPACT:      Service-role key → full read/write of production DB (severe).
                       Razorpay secret → API access to payments/refunds (severe if LIVE mode; low if TEST).
ENTRY CRITERION:       G§18.1 (compromised service credentials) / G§18.9 (payment credential
                       exposure) — ONLY IF the secret reached anyone outside the owner's control.
CURRENT RISK:          Exposure path confirmed for the Razorpay secret (ZIP distribution);
                       SUSPECTED for the service-role key (depends on whether any later ZIP
                       included .env); misuse UNKNOWN.
CURRENT CONTAINMENT:   Unknown whether keys were rotated.
ACCOUNTABLE OWNER:     Security Owner (to be named — see §2)
INCIDENT LEAD:         n/a unless escalated
REQUIRED SPECIALISTS:  Data Owner (DB contents), Release Owner (env update + redeploy)
NEXT ACTION:           Rotate BOTH secrets (cheap, reversible, minutes) and confirm where ZIPs went.
NEXT REVIEW:           On the owner's answer.
```

**Classification: P1, with an explicit escalation trigger to P0.**

* **Score:** Impact 3 + Urgency 3 + Irreversibility 1 + Risk 2 = **9 → P1**.
* **Matrix:** System-wide × High → **P0**.
* **Why P1 despite the matrix** (G§15 requires a documented reason to take the lower result):
  * On the last known evidence, production held no customer data.
  * There is no evidence of misuse.
  * The known distribution was of owner-controlled archives.
* **Escalate to P0 immediately if any of these is true:**
  * a ZIP containing `.env` was shared with anyone else, a contractor, a public link or a third-party service outside your control;
  * the Razorpay secret was a **live** (`rzp_live_…`) key and is unrotated;
  * the production DB now holds customer data and the service-role key is unrotated;
  * there is any unexplained activity in Supabase or Razorpay logs.

**Recommended containment, needed at either priority:**
1. Rotate the Supabase service-role/secret key.
2. Rotate the Razorpay key secret and the webhook secret.
3. Update Netlify/Vercel and Supabase Edge secrets, then redeploy.
4. Review the Supabase and Razorpay access logs for 12 Sep → now.
5. Delete stray `.env.bak-*` files.

The playbook is §8, PB-4. These steps are reversible and fast, so G§2.6 applies.

### 1.2 Priority triage of the audit findings (doc 01) and open decisions (doc 11)

**Scoring conventions** (clarified in §13, gap GAP-1):
* The four 0–3 scores map directly onto the matrix: Impact 0/1/2/3 = Low/Medium/High/System-wide; Risk 0/1/2/3 = Low/Medium/High/Critical.
* **Context:** SHYGON is pre-launch, and production had ~no customer data at last check. This is what keeps most items below P0. The same defects on a live customer base would score higher.

| ID | Item | I | U | Irr | R | Score→P | Matrix | **Final** | Reason for lower / escalation trigger | A (domain) |
|---|---|---|---|---|---|---|---|---|---|---|
| SEC-1 | Credential exposure (§1.1) | 3 | 3 | 1 | 2 | 9→P1 | P0 | **P1** | see §1.1 | Security Owner |
| F1 | Customer can un-suspend own Tap/account | 1 | 2 | 1 | 2 | 6→P2 | P1 | **P1** | → **P0** if exploited on live (G§18.5 "normal user → privileged op") | Security Owner |
| F3 | Card deactivation doesn't stop public Tap | 2 | 2 | 1 | 2 | 7→P1 | P1 | **P1** | product promise broken for lost cards | Principal Architect (C: Product, Security) |
| F4 | OTP sent to unverified, user-editable phone | 2 | 1 | 1 | 2 | 6→P2 | P1 | **P1** | higher of two | Security Owner |
| F6 | Repo ≠ live DB (drift; live `get_public_tap` errors "slug is ambiguous") | 3 | 2 | 2 | 2 | 9→P1 | P0 | **P1** | no active harm; a *process* risk that makes any migration dangerous. **Blocks all DB work.** | Data Owner |
| F8 | No CI | 2 | 2 | 0 | 2 | 6→P2 | P1 | **P1** | higher of two | Engineering Owner |
| F9 | Storage policies unaudited | 2 | 1 | 1 | 2 | 6→P2 | P1 | **P1** (provisional) | re-score after audit | Security Owner |
| OQ-1 | 14-day card-activation expiry on live | 2 | 2 | 1 | 2 | 7→P1 | P1 | **P1** | → P0 if live customers' cards are being auto-suspended (G§18.7 core function) | **Product Owner** (C: Data, Security) |
| F2 | Customers can read internal admin notes | 1 | 2 | 2 | 1 | 6→P2 | P2 | **P2** | → P1 once real orders with admin notes exist | Security Owner |
| F5 | Forgeable analytics, weak visitor hash | 1 | 1 | 0 | 1 | 3→P3 | P2 | **P2** | higher of two | Data Owner |
| F7 | Slug enumeration | 1 | 0 | 1 | 1 | 3→P3 | P2 | **P2** | by-design for public personas | Security Owner |
| F11 | Session in localStorage | 2 | 0 | 1 | 1 | 4→P2 | P1 | **P2** | documented reason: platform default + strict CSP; tracked as risk | Security Owner |
| F12 | Secrets held in two runtimes | 1 | 0 | 1 | 1 | 3→P3 | P2 | **P2** | higher of two | Security Owner |
| F10 | Order id uses Math.random | 0 | 0 | 0 | 0 | 0→P3 | P3 | **P3** | — | Engineering Owner |
| OQ-2 | NFC chip family | 2 | 1 | 3 | 2 | 8→P1 | P1 | **P1** (before any hardware batch order) | hardware is irreversible | Security Owner (C: Product for cost, Architect) |
| OQ-3 | Live schema dump + Admin APK contract | 3 | 2 | 0 | 2 | 7→P1 | P0 | **P1** | prerequisite, not harm | Data Owner |
| OQ-9 | Legal/compliance review (DPDP, minors, CERT-In, GST) | 3 | 1 | 2 | 3 | 9→P1 | P0 | **P1** | not active; **hard gate before Student (Phase 2)** | Data Owner (C: counsel, Product) |
| OQ-16 | Name the canonical role holders (§2) | 3 | 2 | 0 | 2 | 7→P1 | P0 | **P1** | **hard gate before production launch** (G§80) | Product Owner (Founder) |

These rows become the initial **decision queue** (§10.2): DEC-2026-001 … with the listed owners.

---
## 2. Canonical roles for SHYGON

### 2.1 Governance roles vs. product RBAC (do not confuse)

| Concept | Where it lives | Examples |
|---|---|---|
| **Canonical governance roles** (G§3): Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner, Incident Lead | People and their responsibilities; recorded in `ops.role_assignments` (§10) and `docs/governance/ROLE_ROSTER.md` | "Who decides whether to roll back?" |
| **Platform admin roles** (existing `admin_users.role`): owner, admin, fulfilment, support, viewer | Database authorization for the Admin app | "Who can press refund?" |
| **Tenant roles** (future `memberships.org_role`) | Customer organizations | "Who can invite students?" |

A person may hold a governance role without a matching admin role, and the reverse.
**Holding a governance role never grants database privilege by itself.** Containment authority comes only from the pre-authorized control matrix (§7.2), which enforces G§13 "no authority inflation".

### 2.2 Small-team assignment (G§79), to be completed by the Founder (decision OQ-16)

| Role | Proposed holder | Minimum requirement |
|---|---|---|
| Product Owner | Founder | — |
| Principal Architect | Technical lead (TBD) | Can review schema/RLS |
| Security Owner | Security-trained engineer (TBD) **or external retained reviewer** | Must be independent of the author for Level-3 changes |
| Data Owner | TBD (may be the Architect initially) | SQL access to production; PITR knowledge |
| Engineering Owner | Developer/Tech lead | — |
| QA Owner | TBD (may be the developer, with a checklist) | Owns test sign-off |
| Release Owner | Whoever holds Netlify/Vercel and Supabase deploy rights | Has rollback rights |
| Primary Incident Lead / Secondary Incident Lead | Two **different** people | Reachable by phone 24×7 during launch windows |
| Escalation contacts: security, data, infrastructure, production (G§80) | Named, with phone numbers in the roster | — |

**If SHYGON has only one human, name the reality explicitly rather than pretend there is independence.** The compensating controls are:
1. Level-3 changes get review from an **external retained reviewer** (security contractor), or at minimum a 24-hour cool-off plus the checklist review.
2. Claude may do a *non-author review* in a separate session. This is **advisory, not independent human review**, and it never counts as an approval.
3. The Secondary Incident Lead can be a trusted, trained co-founder or contractor with pre-authorized containment rights only (K1, K5, K11 in §7).

### 2.3 Pre-production setup is a launch gate (G§80)
No production launch of SHYGON OS Phase 1 happens until all of these are true:
* `ROLE_ROSTER.md` is complete.
* A paging path is tested.
* The printed runbook (R2) is filled in with names and numbers.
* The kill-switch matrix (§7) has been drilled once.

---
## 3. Decision ownership, RACI and escalation levels for SHYGON

### 3.1 SHYGON decision types → Accountable owner (one A, G§5)

| Decision type (SHYGON examples) | A | Typically C | Level |
|---|---|---|---|
| Feature priority, MVP scope, plan pricing, personas-per-plan (OQ-4), 14-day edit rule, card-activation semantics (OQ-1), language priority | Product Owner | Architect, Security, Data | L1–L2 |
| Resolver design, tap_routes model, service boundaries, email/SMS provider (OQ-8), tenancy model, API versioning, table extension vs new table | Principal Architect | Security, Data, Engineering | L2–L3 |
| RLS policies, SECURITY DEFINER functions, auth/MFA/step-up, verified contacts, chip security (OQ-2), rate limits, secret rotation, Rescue abuse controls, Access policy engine | Security Owner | Architect, Data | **L3** |
| Retention periods, deletion/erasure, destructive or backfill migrations, baseline capture (F6), legal hold, analytics data collected, student data handling | Data Owner | Security, counsel | **L3** |
| Code structure, library choice within approved stack, test implementation, refactors | Engineering Owner | Architect | L0–L1 |
| Test readiness, defect severity, release test sign-off | QA Owner | Engineering | L1 |
| Deploy/rollback, release windows, feature-flag enablement in production | Release Owner | QA, Security | L2 (L3 if flags touch security) |

### 3.2 Level-3 path triggers (enforced by CODEOWNERS + PR template, §11)

Any change touching the following paths is **Level 3** and needs explicit specialist approval before merge:

| Path | Level | Required reviewer |
|---|---|---|
| `supabase/migrations/**`, `supabase/baseline/**` | L3 | Data Owner **and** Security Owner |
| Any SQL containing `POLICY`, `SECURITY DEFINER`, `GRANT`, `REVOKE`, or `auth.` | L3 | Security Owner |
| `netlify/functions/{create-order,verify-payment,razorpay-webhook}.mjs`, `netlify/lib/{razorpay,fulfilment}.mjs`, `supabase/functions/admin-refund/**` | L3 | Security Owner |
| `netlify/functions/{otp,card-otp,resolve}.mjs`, `netlify/lib/otp.mjs`, `src/lib/auth*` | L3 | Security Owner |
| `netlify.toml` / `vercel.json` headers & redirects | L2 | Security + Release |
| Everything else under `src/**` | L1 | Engineering; product-visible copy/UX also needs Product |

### 3.3 Deadlock and founder escalation
Follow G§9–10 as written. Two SHYGON-specific rules:
1. **Security blocking authority (G§2.4) applies to commercial deadlines** such as a launch date, a pilot school demo or a hardware batch order. The Founder may escalate, but the decision record must show the Security Owner's blocking reason and the accepted risk.
2. Any decision that changes a *physical-card-visible behaviour* (URL scheme, resolver semantics, lifecycle rules) is treated as **irreversible** (G§78). Printed cards can't be recalled, so these always need a full decision record.

---
## 4. Decision process in practice

* **Log.** Every material decision gets a record using the G§11 template in `docs/governance/decisions/DEC-YYYY-NNN.md` (Phases 0–1). From Phase 2 it lives in the `ops.decisions` table (§10).
* **Priority.** Priority is computed with G§13–15, and the matrix-vs-score conflict rule is applied (§1.2).
* **Deadlines by priority** (proposal — gap GAP-4):
  * P1: decide within 2 business days.
  * P2: decide within 10 business days.
  * P3: decide at the next planning session.
  * An overdue deadline triggers G§77 escalation.
* **Priority changes** are recorded per G§76: previous, new, evidence, reason, owner, time.

---
## 5. SHYGON P0 taxonomy: entry criteria → concrete scenarios → detection

| G§18 criterion | SHYGON scenarios | Detection signal | Auto-P0? | Default Incident Lead | Domain A's |
|---|---|---|---|---|---|
| 18.1 Security compromise | Admin account taken over; service-role/Razorpay/OTP secret leaked; Netlify/Supabase account compromise; malicious deploy | Admin login from new device + privileged action; `admin_users` change outside a DEC; secret-scanner hit; unexpected deploy | Admin privilege change by unknown actor → **auto** | Security Owner | Security; Release |
| 18.2 Cross-tenant exposure | Org A reads org B roster/credentials (Phase 2+); a customer reads another's persona private fields, orders, rescue threads | **Cross-tenant canary job** (§6.3) returns data; 403 spikes turning into 200s; bug report | Canary success → **auto** | Security Owner | Security; Data; Architect |
| 18.3 Sensitive data exposure | Public resolver/cache/vCard leaks private or S3 fields; notification/email contains message text or contacts; logs contain PII; export sent to wrong user; AI assistant returns another user's data | **Public-leak canary** (canary strings in a test persona's private fields scanned on every public output); log PII scanner | Canary string found → **auto** | Security Owner | Security; Data |
| 18.4 Authentication compromise | OTP bypass; session fixation; magic-link redirect to attacker; MFA bypass for admins | Auth anomaly rules; OTP verify without request; login success rate anomalies | Manual (alert = P1 page) | Security Owner | Security |
| 18.5 Authorization failure | Customer performs admin op (e.g., F1 class); org staff escalates to org_owner; member edits org-owned device routes | Adversarial CI failing on main; audit rows with `outcome=allowed` on actions not in the actor's permission set (post-hoc check job) | Post-hoc violation → **auto** | Security Owner | Security; Architect |
| 18.6 Data loss/corruption | Bad backfill (e.g., `field_visibility`, `public_code`); fulfilment granting wrong entitlements; edition serial duplicates; retention job deleting non-expired data | Row-count guard on core tables (>1% drop in 10 min); invariant checks (unique serials, entitlements vs orders reconciliation) | Row-count guard → **auto** | Data Owner | Data; Engineering |
| 18.7 Critical outage | **Resolver down ⇒ every card in the world is dead**; auth down; checkout down; DB unavailable | SLO burn alerts (§6.1); external synthetic tap probe from ≥ 2 regions | SLO threshold → **auto** | Release Owner | Release; Engineering |
| 18.8 Safety event (Phase 3+) | Rescue message routed to the wrong owner; finder receives owner contact data; emergency release fails or goes to wrong party; harassment campaign via relay | Thread integrity check (message.item.owner == recipient); emergency flow error; abuse score spike | Integrity mismatch → **auto** | Security Owner | Security; Product |
| 18.9 Financial integrity | Paid orders not fulfilled at scale; fulfilment without capture; amount mismatches; unauthorized refunds; Razorpay credential exposure | Existing critical admin notification (amount mismatch); `fulfillment_status='retry'` age; daily reconciliation diff; refund velocity | Reconciliation diff > threshold → **auto** | Security Owner | Security; Data; Release |
| 18.10 Destructive change | Migration run against wrong project; mass route rewrite; mass device suspension; tenant-wide mutation | Mass state-change detector (> N device/route changes per actor per 5 min); migration job monitor | Detector → **auto** | Data Owner | Data; Release |
| (Platform-specific) Malicious Tap redirection | Routes of many devices changed to one target; DNS/registrar hijack of `shygontech.com`; open redirect | Route-change anomaly; CT-log alert for unexpected certificates; synthetic check of top devices' resolved targets | Mass route change → **auto** | Security Owner | Security; Release |

**Uncertainty rule (G§19):** any credible alert above is opened as P0 first, then downgraded with evidence (G§22).

---
## 6. SLOs, outage thresholds and detectors (proposal — G§18.7 asks for SLOs)

### 6.1 Service level objectives (Product Owner approves; Release Owner monitors)

| Service | SLO (30-day) | P1 threshold | **P0 threshold** |
|---|---|---|---|
| Tap resolve (`/d/*`, `/t/*`) | 99.9% success; p95 server ≤ 300 ms | ≥ 5% errors for 15 min, or p95 > 1 s for 15 min | **≥ 20% errors for 5 min**, or synthetic probe failing from ≥ 2 regions for 3 min |
| Sign-in / auth | 99.9% | success rate < 90% for 15 min | **< 50% for 10 min** |
| Checkout (create-order + verify) | 99.5% (excl. user errors) | ≥ 10% errors for 15 min | ≥ 50% for 10 min **with captured payments not fulfilling** |
| Fulfilment latency | p99 paid→fulfilled ≤ 5 min | any order in `retry` > 15 min | ≥ 5 paid orders unfulfilled > 30 min |
| Security notifications | p95 ≤ 5 min | outbox lag > 15 min | outbox stalled > 60 min **and** security events pending |
| Rescue relay (Phase 3) | p95 delivery ≤ 2 min | lag > 15 min | integrity mismatch (any) |

### 6.2 Detection stack (minimal, fits the existing stack)
* External uptime/synthetic monitor on the resolver, sign-in and checkout health endpoints, from ≥ 2 regions.
* Error tracking in the functions and frontend.
* Supabase log drains, and DB-side detector jobs (run by the Phase 1 sweeper).
* Alerts go to a **paging service with phone-call escalation**, which is decision OQ-17. The platform's own notification outbox is never the only channel.

### 6.3 Synthetic canaries (Phase 1 public leak canary; Phase 2 cross-tenant canary)
* **Public-leak canary.** A canary account's persona has a unique random string in *every* private field and in the sensitive tier.
  * A scheduled job resolves its device/slug through every public route, vCard, OG image and export.
  * The job also scans a sample of logs.
  * **Any match opens a P0.**
* **Cross-tenant canary.** Two canary orgs with canary members. On a schedule the job signs in as each and attempts reads/writes on the other org, across every org-scoped table and API.
  * **Any success opens a P0.**
* Canary identities are excluded from analytics and billing, and are known to the moderation team.

---
## 7. Containment controls ("kill switches")

G§28 lists containment *actions*. The platform must **pre-build** them so that containment is a switch, not a code change during an incident (G§30: "never deploy untested fix").

### 7.1 Catalogue

| K | Control | Effect | Mechanism | Time to effect | Reversal | Phase |
|---|---|---|---|---|---|---|
| K1 | **Resolver maintenance mode** | All taps show a static "temporarily unavailable" page (no DB) | `platform_config.resolver_mode='maintenance'` + CDN-served static page; also an env-var fallback if the DB is unreachable | ≤ 60 s | flip back | 1 |
| K2 | Revoke one device / persona / account | Target shows neutral "unavailable" | Existing admin suspension RPCs + `device_transition` | ≤ 30 s (cache) | admin resume | 0–1 |
| K3 | Disable a public write endpoint (connect, rescue, emergency, events event-log) | 503 problem+json | per-route flag in `platform_config` read by edge functions | ≤ 60 s | flip back | 1 (routes as they ship) |
| K4 | **Freeze customer writes** (read-only mode) | Persona edits, device actions, consents refused with a clear message | flag checked by edit-rule triggers and write RPCs | immediate | flip back | 1 |
| K5 | Pause checkout | `create-order` returns 503 "paused"; existing paid orders still fulfil | env/flag checked first in `create-order` | ≤ 60 s | flip back | 1 |
| K6 | Hold fulfilment | Webhooks recorded in the ledger but not fulfilled; replay after the hold | flag checked in `fulfilOrder` (ledger unchanged) | immediate | release + replay job | 1 |
| K7 | Pause notification channel(s) | Outbox keeps rows; no sends | per-channel flag in worker | ≤ 60 s | resume (dedupe prevents doubles) | 1 |
| K8 | Revoke sessions (user / all users / all admins) | Forces re-login | Supabase admin sign-out per user; JWT signing-key rotation for "all" | minutes | n/a | 1 |
| K9 | Deactivate admin (existing `is_active=false`) | Admin loses all rights, audit preserved | SQL / owner RPC | immediate | reactivate | 0 |
| K10 | Rotate a secret (Supabase keys, Razorpay key & webhook secret, OTP secret, resolver HMAC, email/SMS keys) | Old secret dead | Runbook per secret (`RUNBOOK-secrets.md`) | 5–30 min | n/a | 0 |
| K11 | Roll back deploy | Previous build live | Netlify/Vercel deploy history | ≤ 2 min | redeploy | 0 |
| K12 | Stop migration / restore | Abort job; PITR restore to staging and then decide | Supabase PITR (verify plan supports it) | varies | n/a | 0 |
| K13 | Purge edge cache | Stale/leaked payloads removed | cache tag purge API | ≤ 60 s | n/a | 1 |
| K14 | **Legal hold** | Retention/purge jobs skip the incident's scope (evidence preservation vs data minimisation) | `ops.legal_holds` checked by retention jobs | immediate | release hold | 1 |
| K15 | Suspend organization | Org console disabled; org-issued credentials flagged; members unaffected | admin RPC | ≤ 30 s | resume | 2 |
| K16 | Freeze route changes platform-wide | `tap_routes` writes refused | flag in route RPCs | immediate | flip back | 1 |
| K17 | Domain/DNS lockdown | Registrar lock, DNSSEC, CAA; recovery contacts | registrar console (manual) | — | — | 0 |
| K18 | Disable AI feature(s) (future) | Feature returns non-AI fallback | per-feature flag | ≤ 60 s | flip back | when AI ships |
| K19 | Disable an AI agent identity (doc 14 §3.9) | Agent's GitHub App/bot token and DB role revoked | registry + provider consoles | ≤ 5 min | re-enable after review | 0 (Claude Code identities) |

**Every switch must meet four requirements:**
1. It works when the Admin APK is unavailable. A break-glass SQL snippet and a `scripts/ops/` CLI are kept.
2. It writes an audit row and a timeline event.
3. It is exercised in staging on a schedule: monthly for K1/K4/K5/K8, quarterly for the rest.
4. It has a one-line customer-visible message.

### 7.2 Authorization matrix: who may pull which switch (no authority inflation, G§49/§64)

| Control | Security Owner | Release Owner | Data Owner | Engineering Owner | Product Owner | Authorized responder (any on-call) |
|---|---|---|---|---|---|---|
| K1 resolver maintenance | ✔ | ✔ | — | ✔ (P0 only) | ✔ | ✔ **if P0 declared and IL unreachable ≥ 5 min** |
| K2 revoke device/persona/account | ✔ | — | — | — | — | support-role admin for single accounts |
| K3 disable public endpoint | ✔ | ✔ | — | ✔ | — | ✔ (P0 only) |
| K4 freeze writes | ✔ | — | ✔ | — | — | — |
| K5 pause checkout | ✔ | ✔ | — | — | ✔ | ✔ (P0 only) |
| K6 hold fulfilment | ✔ | — | ✔ | — | — | — |
| K7 pause notifications | ✔ | ✔ | — | ✔ | — | — |
| K8 revoke sessions (all) | ✔ | — | — | — | — | — |
| K9 deactivate admin | ✔ (+ owner role) | — | — | — | Founder | — |
| K10 rotate secret | ✔ | ✔ (deploy step) | — | — | — | — |
| K11 roll back | — | ✔ | — | ✔ (if RO unreachable) | — | — |
| K12 stop migration / restore | — | — | ✔ | — | — | stop only |
| K13 purge cache | ✔ | ✔ | — | ✔ | — | ✔ |
| K14 legal hold | ✔ | — | ✔ | — | — | — |
| K15 suspend org | ✔ | — | — | — | ✔ | — |
| K16 freeze routes | ✔ | ✔ | — | — | — | ✔ (P0 only) |
| K17 DNS lockdown | ✔ | — | — | — | Founder | — |
| K19 disable AI agent | ✔ | ✔ | — | ✔ | ✔ | ✔ (any responder may disable an agent; re-enable needs Security Owner) |

**Emergency rule (G§49, G§58):** a responder acting without the Accountable Owner may use only the "✔ (P0 only)" controls in their column. They must then notify, escalate and hand off formally.

---
## 8. SHYGON P0 playbooks (condensed; each becomes `docs/runbooks/PB-n.md`)

Every playbook follows the R1/R2 sequence: declare → acknowledge ≤ 5 min → owner ≤ 10 → specialists ≤ 15 → contain ≤ 30 → recovery direction ≤ 60 → verify → close → review ≤ 3 business days. Below are only the SHYGON-specific parts.

| PB | Scenario | Contain (K) | Preserve evidence | Recovery options | **Verification before closing (G§33)** | External notifications to assess |
|---|---|---|---|---|---|---|
| PB-1 | Cross-tenant / RLS exposure | K4 freeze writes; K3 affected endpoints; K13 purge; K14 legal hold; K11 rollback of the policy change | Postgres logs, audit rows, the offending policy SQL, the request ids | Fix-forward policy with an adversarial test that reproduces it; rollback | Full `rls-adversarial` + cross-tenant matrix green on prod-equivalent; canary green 24 h | Affected orgs; DPDP breach assessment (counsel); CERT-In (counsel) |
| PB-2 | Public payload leaks private data | K1 or per-route K3; K13 purge **immediately**; K14 | Cached responses, the canary hit, deploy diff | Rollback renderer/resolver; fix shaping function | Public-leak canary green; snapshot tests; manual check of the top 20 personas | Affected users; DPDP assessment |
| PB-3 | Admin account compromise | K9 deactivate; K8 revoke that admin's sessions (and all admins if unsure); K10 rotate anything they could read; K4 if the actor wrote data | `admin_audit_log` (append-only), auth logs, device info | Restore altered rows from audit/PITR; re-enroll MFA | Audit review of every action by that admin since the last known-good time; `admin_users` diff; permission tests | Affected users/orgs if data accessed |
| PB-4 | Secret exposure (service role, Razorpay, OTP, webhook, email/SMS) | K10 rotate; K6 hold fulfilment if payment secrets; K5 if abuse is seen | Where/when exposed; provider access logs | Redeploy with new secrets; revoke old | Payment path test in test mode then a controlled ₹1 live order+refund; OTP flow test; webhook signature test | Razorpay (if payment secret); CERT-In (counsel) |
| PB-5 | Payment integrity (unfulfilled paid orders, mismatches, fraud) | K6 hold; K5 pause checkout if new orders affected | Webhook ledger, `payments`, Razorpay dashboard export | Replay fulfilment (idempotent); refund via `admin-refund` | Reconciliation job shows 0 diff; test purchase end-to-end | Affected customers; Razorpay |
| PB-6 | Resolver outage (all cards dead) | K1 static page (better than an error); K11 rollback | Error tracking, synthetic results | Rollback; DB failover/support; scale | Synthetic probe green ≥ 30 min from ≥ 2 regions; golden legacy slugs test | Status page; organizations with events that day |
| PB-7 | Malicious Tap redirection / route hijack / DNS | K16 freeze routes; K2 affected devices; K17 DNS; K13 purge | Route history, audit, CT logs, registrar logs | Restore routes from history; registrar recovery | Top-N device targets verified; CT monitor clean | Affected owners; public notice if DNS |
| PB-8 | Destructive migration / data corruption | K12 stop; K4 freeze writes; K14 hold | Migration logs, row-count snapshots | PITR restore to staging → verify → targeted repair (**never blind prod restore**) | Invariant checks (serial uniqueness, entitlements vs orders, persona counts) + business spot checks | Affected users if visible |
| PB-9 | Auth compromise / outage (OTP bypass, SMS provider abuse, Supabase Auth down) | K7 pause SMS (cost abuse); K3 OTP endpoint; K8 sessions if bypass | Auth logs, OTP challenge table | Provider switch (MSG91 ↔ Twilio); fix | Login + OTP + password reset tests; MFA tests | Users if accounts affected |
| PB-10 | Rescue safety event (Phase 3+) | K3 disable rescue thread creation; per-item pause; block abuser hashes | Thread/message records (legal hold) | Fix routing; notify owners | Integrity check green; routing tests | Affected owner (+ police/legal per counsel for threats) |
| PB-11 | Hardware batch defect or cloned SDM keys (Phase 3+) | K2 batch revoke; route to neutral page | Batch manifest, CMAC failure stats | Reissue; key rotation per batch | Tap tests on a sample of the new batch | Affected owners/orgs |

---
## 9. Communications & regulatory notification

* **Cadence:** every 30 minutes while a P0 is unresolved (G§31), using the status-update template. Every update labels statements CONFIRMED / SUSPECTED / UNKNOWN (G§32).
* **Channels**, in order of dependence on SHYGON itself:
  1. An **out-of-band incident channel** (e.g., a private WhatsApp/Signal/Slack group) plus the paging service. This is the authoritative record until the in-product Command Center exists, and it stays the fallback afterwards.
  2. A **public status page hosted outside SHYGON infrastructure** (OQ-17).
  3. Email to affected users/orgs.
  4. In-app banner.
* **External statement approval:** a customer-facing statement is approved by the **Product Owner**, with the Security Owner consulted for security incidents. This is gap GAP-3: the spec has no communications owner.
* **Regulatory and contractual clocks (India). Counsel must confirm these; they are not legal advice.**
  * CERT-In's 2022 Directions require reporting specified cyber incidents within **6 hours** of noticing, and require ICT logs to be kept for **180 days** in India.
  * The DPDP Act 2023 requires personal-data breach notification to the Data Protection Board and to affected Data Principals, with timelines set by the DPDP Rules.
  * Razorpay/merchant agreement obligations apply to payment incidents.
  * School and organization contracts may set their own notification clauses.
  * The **Data Owner** triggers the counsel check within the first hour of any P0 involving personal data. That makes it an explicit step in PB-1, PB-2, PB-3 and PB-4.
  * *Consequence for the architecture:* doc 06's 90-day raw-analytics retention stays, because analytics events are not security logs. **Security/access logs (edge, function, auth, audit) must be retained ≥ 180 days**; doc 07 §3 already says ≥ 2 years for audit. Netlify/Vercel log retention alone is too short, so a log drain to durable storage is needed (Phase 1).

---
## 10. Governance as SHYGON OS software (the "ops" module)

G§81 and G§85–89 ask the platform to expose governance. Design principle: **the incident system must not depend on the system that is failing.** The in-product module is therefore a *record and coordination* tool with an out-of-band fallback. It is never the only way to page people or to contain.

### 10.1 Placement and access
* **Placement is decided in doc 14 §2:** a **separate internal "SHYGON Ops" Supabase project** (`shygon-ops`). The `ops` tables below live there, not in the customer platform database. This isolates incident records from customer-platform compromise or outage, and it serves every SHYGON product (Tap, School OS, Privé).
* **Access:** only through SECURITY DEFINER RPCs that require staff authentication with **MFA (AAL2)** plus an ops permission: `ops.read`, `ops.write`, `ops.incident_lead`, `ops.approve`, `ops.security_restricted`.
* **Kill switches stay in the product database** (`platform_config`, read by triggers and edge functions). The ops layer pulls them only through audited product admin RPCs, using a credential scoped to those RPCs.
* **UI:** an internal web app (`ops.shygontech.com`) with its own deploy. The Admin APK gets a read-only P0 banner.
* **Restricted incidents:** security incidents involving possible insiders are flagged `restricted`. Only Security Owner and Founder can see them, and they are mirrored out-of-band.
* **Evidence:** evidence is stored as *references* (log query links, object keys), not raw PII.

### 10.2 Data model (ERD-level)

| Table | Key fields / rules |
|---|---|
| `ops.role_assignments` | `role` (8 canonical + `incident_lead_primary/secondary`), `user_id`, `fallback_order`, `valid_from/to`, contact refs. Constraint: exactly one active primary per role. |
| `ops.escalation_policies` | Fallback chains per incident type, seeded from G§52–57 (security, production, data, cross-domain) |
| `ops.decisions` | `id` (DEC-YYYY-NNN), title, question, context, domain, level L0–L3, scores (I/U/Irr/R), `score` (generated), `matrix_priority`, `priority`, `priority_override_reason` (**required when priority < max(score, matrix)**), `accountable_owner_id` (**single column ⇒ exactly one A by construction**), `original_owner_id`, `escalated_to_id`, `accountability_changed` bool (G§2.3), `state`, `deadline`, reversibility, impacts (security/data/product/architecture/ops), decision text, timestamps |
| `ops.decision_options` | Option A/B…: benefits, risks, cost, time, reversibility |
| `ops.decision_participants` | `raci ∈ {R,C,I}` (A is never stored here) |
| `ops.approvals` | Subject (decision / incident recovery / release), required role, approver, status, note, time |
| `ops.incidents` | `id` (P0-YYYYMMDD-NN), title, priority, `state` (G§65 list), detection time/source/by, entry criterion, affected systems/tenants, known/potential impact, containment/recovery/verification status, `restricted`, `legal_hold_id`, `incident_lead_id` (nullable only before ACKNOWLEDGED), next update due, closure fields |
| `ops.incident_domain_owners` | `(incident_id, domain) → accountable_user_id`. Keeps Incident Lead ≠ domain A explicit (G§63). |
| `ops.incident_events` | **Append-only timeline:** type (state_change, priority_change, action, containment_switch, evidence, decision, handoff, comms, note), `evidence_class ∈ {OBSERVED, HYPOTHESIZED, CONFIRMED}` (G§67), actor, role, time, payload |
| `ops.handoffs` | from, to, role/domain, requested_at, accepted_at, status (requested / accepted / declined / timed_out), checklist JSON (G§46). **Takes effect only on acceptance.** |
| `ops.timers` | Incident, kind (ack 5′, lead_fallback 5′, owner 10′, specialist 15′, containment_plan 20′, containment 30′, leadership_notify 30′, recovery_direction 60′, update cadence 30′, handoff_ack 10′), due_at, met_at, status (ON_TARGET / AT_RISK / OVERDUE) |
| `ops.status_updates` | Structured update (impact, status, done, underway, risks, unknowns, next decision, next update) |
| `ops.legal_holds` | Scope (tables/ids/time range), reason, set_by, released_at. Read by retention jobs (K14). |
| `ops.reviews` / `ops.action_items` | Post-incident review answers (G§35) and corrective actions (owner, due, status, link to DEC/issue) |
| Governance audit | Reuses the unified append-only `audit_log` (doc 03) with `actor_kind='ops'`, previous/new state, reason, evidence (G§82). **Hash-chained** for tamper evidence. |

### 10.3 State machines and invariants (enforced in the DB, not the UI)
* **Decision states** (G§84): PROPOSED → TRIAGED → ASSIGNED → UNDER_REVIEW → DECIDED → APPROVED → IMPLEMENTING → VERIFYING → CLOSED, plus BLOCKED / ESCALATED / REJECTED / ROLLED_BACK.
  * The queue statuses in G§75 are *views* over these states (GAP-2).
  * ASSIGNED requires an `accountable_owner_id`.
  * APPROVED requires every required approval to be `approved`.
  * Every transition writes an event with who, when, what and why (G§83).
* **Incident states** (G§65): DETECTED → ACKNOWLEDGED → … → CLOSED.
  * Backward moves are allowed (e.g., RECOVERED → CONTAINMENT_ACTIVE) and need evidence.
  * **CLOSED is only allowed when all of these exist:** a verification event with evidence; the Accountable Owner's confirmation; containment and recovery marked complete; action items created; and the final status update posted (G§34, G§66).
* **Priority change:** needs evidence text plus the owner (G§76). A downgrade from P0 needs the G§22 fields.
* **Handoff:** the previous owner stays current until `accepted_at` is set (G§36). A 10′ timer escalates to the next fallback (G§45, G§62).

### 10.4 Escalation engine
* **Sweeper:** runs every minute, reusing the Phase 1 sweeper. It evaluates `ops.timers` and sets them to AT_RISK at 80% and OVERDUE at 100%.
  * Lead ack missing at 5′: pages the next person in the fallback chain (G§53), records a timeline event, and the incident continues.
  * Update cadence missing: pings the Incident Lead.
  * Decision deadline passed: escalates (G§77).
* **Paging:** goes through the external paging service's API (primary) **and** the SMS channel (secondary). It never goes only through the in-app outbox.
* **Automated P0 creation:** detectors in §5 marked "auto" create an incident in DETECTED state with the entry criterion and evidence link, then page the policy's first responder (Phase 3; Phase 1–2 page only).

### 10.5 Command Center UI (G§85–89)
* **Sections:** Command Center · Decisions · Escalations · Incidents · P0 Response · Ownership (roster) · Approvals · Security · Data Governance (legal holds, retention) · Releases (release handoffs) · Audit Log · Post-Incident Reviews.
* **The P0 panel shows on one screen:** severity, elapsed time, Incident Lead, domain A's, affected systems, impact, containment state, recovery state, next decision, next update, blocker, required approval, and timers with ON_TARGET / AT_RISK / OVERDUE.
* **The timeline** has one-tap buttons for "record action", "pull switch K-n" (only switches the viewer's role permits; each writes the event), "request handoff" and "post update" (a template with CONFIRMED/SUSPECTED/UNKNOWN fields).
* **"Nine questions" completeness bar (G§89):** each unanswered question shows as a red gap, which implements "surface the gap".
* **Accessibility & resilience:** works on mobile; renders from cached data if Supabase is degraded (read-only, with a banner "live data unavailable — use out-of-band channel"); **printable** incident record export.

---
## 11. Governance in the engineering workflow (Claude Cowork & Claude Code)

| Rule (from G) | Implementation in the repo |
|---|---|
| One decision → one A; decision records (G§5, §11) | `docs/governance/decisions/DEC-*.md` from the template; `docs/DECISIONS.md` index; later the `ops.decisions` table |
| Level-3 specialist review (G§8) | `.github/CODEOWNERS` maps the §3.2 paths to role handles; branch protection requires CODEOWNER approval; PR template asks for Level, Accountable Owner, DEC id, rollback plan, security/data impact |
| Release handoff (G§44) | `docs/governance/RELEASE_HANDOFF.md` filled in for each production deploy of an L2/L3 change: Engineering → QA → Security (if L3) → Release Owner → deploy → **verification evidence** |
| Irreversibility rule (G§78) | PR template section required for migrations, URL/resolver semantics, public API, hardware manifests |
| Claude Code STOP/FLAG/ESCALATE (G§69–70) | Encoded in doc 12 §0. Claude Code writes a DEC draft and **stops** on architecture, security, data or product ambiguity. It never applies production changes or pulls kill switches. |
| Claude Cowork classification (G§68, §71–72) | Used in this pack (§1). Future Cowork sessions use the same templates. |
| AI agents (G "Applies to") | Future SHYGON AI features (doc 09) and automation agents (auto-replies, social posting) fall under the same governance. An AI output leaking data is a P0 under 18.3, and K18 exists for them. |

---
## 12. Governance rollout by phase (joins the roadmap in doc 10)

| Stage | When | Deliverables |
|---|---|---|
| **G0 — Now (before Phase 0 code)** | days | SEC-1 decision and rotation; role roster (OQ-16); decision log started with the §1.2 queue; out-of-band incident channel; printed runbook (R2) filled in; templates in `docs/governance/` |
| **G1 — with Phase 0** | | CODEOWNERS, branch protection, PR template, release handoff; secret-rotation, rollback and PITR runbooks (K9–K12, K17) **tested**; backup restore drill; tabletop #1 (PB-4 secret exposure) |
| **G2 — with Phase 1 (launch gate)** | | Kill switches K1–K8, K13, K14, K16 built and drilled; SLOs and alerts; paging with phone escalation; external status page; public-leak canary; log drain ≥ 180 days; tabletop #2 (PB-6 resolver outage) |
| **G3 — with Phase 2 (before student/org data)** | | `ops` schema + decision queue + incident records + timers/escalation engine + minimal `/ops` Command Center; cross-tenant canary; K15; regulatory notification procedure signed off by counsel; tabletop #3 (PB-1 cross-tenant) |
| **G4 — with Phase 3** | | Safety incident class (PB-10) + moderation escalation; automated P0 creation from detectors; action-item tracking linked to the backlog; hardware incident playbook (PB-11) |
| **G5 — Phases 4–6** | | Org-facing incident notices and per-tenant status; enterprise SLAs; Access-specific playbooks (physical); audit hash anchoring; external audit/pen-test cadence |

---
## 13. Gaps and ambiguities found in the governance spec (for the Product Owner / Founder)

These need a decision. Claude has not filled them in silently. Each has a proposed resolution.

| ID | Gap | Proposed resolution |
|---|---|---|
| GAP-1 | The priority matrix (G§15) has 4 rows/columns but the scores are 0–3; the mapping isn't stated | 0/1/2/3 → Low/Medium/High/(System-wide or Critical) |
| GAP-2 | Two decision-status vocabularies (G§75 queue vs G§84 state machine) | State machine is canonical; queue statuses are views |
| GAP-3 | No **communications owner** for external statements; no **legal/compliance** role | Product Owner approves external statements; add "Legal/Compliance (Consulted)" to the roster |
| GAP-4 | Response targets exist only for P0; none for P1/P2 incidents or decision deadlines | P1: ack ≤ 1 h (business hours ≤ 30 min), mitigate ≤ 1 business day; P2: ≤ 1 business day ack, fix in planned sprint; decision deadlines per §4 |
| GAP-5 | "Authorized responder" is undefined | = a person on the on-call roster with the §7.2 "(P0 only)" rights; list maintained in ROLE_ROSTER |
| GAP-6 | Evidence preservation (G§67) vs data minimisation/retention (doc 06, DPDP) conflict | Legal hold mechanism (K14) pauses deletion for incident scope; hold release is a Data Owner decision |
| GAP-7 | The spec assumes tooling that may be down during the incident | Out-of-band channel and external paging are authoritative in Phases 0–2 and remain the fallback afterwards |
| GAP-8 | Regulatory clocks (CERT-In 6 h, DPDP) aren't in the P0 targets | Add "regulatory assessment ≤ 60 min" as a P0 target for incidents involving personal data or security |
| GAP-9 | Independence of review in a one-person team (G§79 "where practical") | External retained reviewer for L3; Claude review is advisory only |
| GAP-10 | Security incident involving an insider: the incident record may be visible to the suspect | `restricted` incidents + out-of-band mirror; Security Owner + Founder only |
| GAP-11 | Customer-facing and org-facing SLAs are unspecified | §6 SLO proposal; contractual SLAs only in Phase 4–5 |
| GAP-12 | Priority applies to decisions and incidents; roadmap items need the same scale | Use the same I/U/Irr/R scoring for backlog items tagged security/data |

---
## 14. Drills and continuous improvement
* **Tabletop exercise** once per phase, at minimum (§12), rotating through the playbooks. Each drill produces a post-incident-style review with action items (G§35).
* **Monthly:** switch drills on staging (K1, K4, K5, K8), a backup restore test, and a paging test.
* **Quarterly:** review the role roster and escalation policies; access review of admins; secret rotation for long-lived secrets.
* **Metrics** (fed back into doc 06 analytics):
  * time to acknowledge, own, contain and verify;
  * % of timers ON_TARGET;
  * decisions overdue;
  * action items open past due.
