# 04 — Authentication, Authorization, Identity Verification & Privacy Model

*Covers requested docs 6 (Auth & Authz) and 7 (Permission / Privacy).*

## 1. Three separate questions (never conflate)

| Question | Name | Answered by | Example in SHYGON |
|---|---|---|---|
| *Are you the same account holder?* | **Authentication (AuthN)** | Supabase Auth session + assurance level | Login with email link; OTP step-up |
| *What may you do here?* | **Authorization (AuthZ)** | RLS, `has_org_permission`, `admin_has`, `evaluate_access` | Org staff may assign devices; support may read tickets |
| *Is this claim about you true?* | **Identity/credential verification** | `credentials.provenance` + `verification_records` | "Student of X school" attested by school |

Consequences encoded in the design:
* A verified credential never grants access by itself; it is an *input* to policy.
* An NFC tap is **not** authentication (assurance level A0). It selects *what to show*, nothing more.
* Being `org_admin` never implies being able to read a member's private data — that needs a consent grant (§5).

## 2. Authentication

### 2.1 Methods & decisions

| Capability | V5 today | Target | Decision |
|---|---|---|---|
| Signup / login | Supabase email (magic link + password), phone collected into `profiles` but not a credential | Keep. Add verified phone as a *second factor and recovery channel*, not initially a login method. | Enable Supabase Phone provider only if login-by-phone is required (OQ-6); otherwise keep the custom `card-otp`-style SMS OTP service, generalized as **`otp` service** (`purpose`, `subject`, `channel`) — same HMAC/attempt/rate-limit design. |
| Email verification | Supabase default | Required before publishing a persona or joining an org | Enforce in RPCs, not UI. |
| Phone verification | None (F4) | `contact_methods` verified via OTP **to the new number**; old email/number notified; **72-hour cool-down** before a *new* phone may authorize high-risk actions | Fixes F4. |
| Password reset | Email reset link, change-password form exists | Keep; on reset: revoke other sessions, send security notification, put account in 24-h "sensitive actions locked" state (no phone change, device transfer, deletion) | |
| Session | `localStorage`, refresh tokens | Keep for customers with a "keep me signed in" option (default on mobile web, off on shared/public devices); short JWT (≤ 1 h), refresh rotation on; admin/org-admin sessions ≤ 8 h absolute | PRODUCTION §8 open item closed here. |
| MFA | None | **TOTP required for platform admins and org owners/admins**; passkeys (WebAuthn) as recommended upgrade; SMS OTP is *step-up only*, never sole factor for admins | Supabase MFA (TOTP) is native. |
| Account recovery | Email link only | Tiered: (1) email link; (2) if email lost → verified phone OTP + waiting period (7 days, notify all channels) + admin-assisted path with identity checks and audit; **no recovery via a Tap/card alone** | Document as runbook + admin RPC `admin_start_recovery`. |
| Organization accounts | n/a | Individual users with org memberships. **No shared logins.** Org owner created at org signup, verified by platform admin. | |
| Admin accounts | `admin_users` allow-list + email-domain guard | Keep + MFA-required flag; JIT elevation for destructive RPCs (re-auth within 10 min) | |
| API auth | n/a | Org API keys (hash stored, scoped, rotatable, IP allow-list optional) → OAuth2 client-credentials in Phase 5 | |

### 2.2 Assurance levels (used by policy)

| Level | Meaning | How reached |
|---|---|---|
| **A0** anonymous / static tap | Nothing proven | Plain NFC URL, QR, no session |
| **A1** authenticated tap | Chip authenticity proven (cloning-resistant), *still no person identified* | NTAG 424 DNA SDM CMAC valid + fresh counter (optional hardware) |
| **A2** session | Known account | Valid Supabase session |
| **A3** step-up | Account + recent second factor | Session + OTP/passkey/TOTP within last 10 min |
| **A4** bound | A3 + A1 on the same device in the same request | Session + step-up + authenticated tap |

`evaluate_access()` (Phase 5) takes `required_assurance`; high-risk actions (card deactivate, device transfer, emergency data release, any physical access) require ≥ **A3**; physical access requires **A4** (or org-defined higher). Card deactivate/activate in V5 already behaves like A3 (OTP) — after F4 is fixed it actually is.

## 3. Authorization

### 3.1 Roles

**Platform (unchanged, `admin_users`):** `owner, admin, fulfilment, support, viewer` + explicit permission overrides. New permission namespaces added by prefix: `orgs.*` (verify/suspend orgs), `rescue.*` (moderate), `verify.*` (review credentials), `devices.*` (issue/retire), `consent.audit`, `security.*`. Role→permission mapping stays in `admin_role_permissions()`.

**Tenant (new, `memberships.org_role`):** `org_owner` (all, billing, delete org) · `org_admin` (members, devices, events, locations, credentials) · `manager` (events/locations/analytics; no member removal) · `staff` (assist: assign devices, issue credentials from templates) · `member` (no console access). Mapping in `org_role_permissions`.

**Customer:** implicit: owner of own rows.

### 3.2 Enforcement layers (defense in depth — all must exist)

1. **RLS** on every table (tenant helper `has_org_permission(org_id, perm)` reads `memberships` for `auth.uid()`; never trusts a parameter).
2. **Definer RPCs** for anything with semantics beyond CRUD; first line is `require_*()`; last line is an audit insert.
3. **Edge layer** for anonymous flows: rate limits, bot checks, trust-level computation.
4. **UI** hides what can't be done (courtesy only).
5. **Tests**: adversarial matrix per role per table in CI (extends `rls-adversarial.mjs`).

### 3.3 Policy evaluation (Access, Phase 5; design now)

`evaluate_access(subject, action, resource, context) → {decision, reasons[], obligations[]}` — **deny by default**, evaluated server-side only.

Inputs: subject (user/org/api client), assurance level, tap trust level, org membership & role, credentials held (with provenance), active `temporary_permissions`, `access_policies` for the resource (org-owned, ordered), time window, device state (lost/suspended), rate/anomaly signals.
Rules compose as *all conditions in a rule must hold; any matching explicit deny wins; otherwise allow only if some allow rule matches.*
Outputs are logged in `access_decisions` (allowed **and** denied) with request id, assurance, reasons. Obligations may include "require step-up", "notify owner", "single use".
**Fail closed:** evaluator error, missing policy, or unreachable dependency ⇒ deny. Offline/physical controllers get **short-lived signed access tokens (≤ 60 s, single-use jti)**; revocation = stop issuing + push revocation list. Physical actuation is out of platform scope.

## 4. Privacy model

### 4.1 Audiences (challenging the ladder)

The brief's ladder `PUBLIC → TRUSTED CONTACT → ORGANIZATION → EMERGENCY → PRIVATE` mixes two different things. The design separates them:

* **Visibility tiers for ordinary fields** (a strict ladder, per field): `public` ⊃ `connections` ⊃ `organization` ⊃ `private`. Setting a field to a tier means *that audience and any broader-trust audience*… precisely: `public` = anyone; `connections` = accepted connections; `organization` = members of orgs with an active grant (per org); `private` = owner only.
* **Emergency is not a rung.** It is a **separate, purpose-bound release channel** with its own payload (`sensitive_profile_data`), its own trigger (deliberate "emergency" action, not a normal tap), rate limits, mandatory owner notification and audit. Putting it on the same ladder would risk it leaking to "Organization" viewers.

| Audience | Sees | Requested how | Consent | Modify | Revocation / expiry |
|---|---|---|---|---|---|
| Anonymous (tap/QR) | `public` fields of the routed persona | Automatic | Owner's per-field choice | Nothing | Owner flips field/persona status instantly (cache ≤ 30 s) |
| Connection (trusted contact) | `public` + `connections` fields | Connect request → owner accepts (or mutual exchange on the spot) | Each party picks what to share; recorded in `consent_grants` | Nothing of the other's data | Either side removes connection; grant revoked; **already-copied data can't be un-shared — UI says so** |
| Organization | `organization` fields + roster info the org itself holds | Membership invitation/acceptance (or org-issued persona) | User accepts membership; per-field org visibility default **off** except fields the org *itself* supplied (name, student ref) | Org edits only org-supplied fields | User leaves org → grant ends; org retains its own records per policy |
| Emergency responder | The **emergency payload only** | Emergency action on the device page: responder confirms purpose; optional callback code to owner | Owner pre-configures *what* and *whether*; default **off** | Nothing | Immediate notify owner; audit; rate-limited (3/day/device), no bulk |
| Guardian (Student, Phase 2) | Guardian-visible subset | Guardian linked at onboarding via verified contact | Guardian consent recorded (minor) | Configurable | Ends at age/consent change |
| Platform admin | Account/order/support data; **never** S3 by default | Support workflow | Terms of service | Suspend/refund etc. | Break-glass for S3: reason + second-admin approval + audit + user notification where lawful |
| Private | Owner only | — | — | Owner | — |

### 4.2 Consent mechanics
* Consent is **data** (`consent_grants`): who, what fields, why (`purpose`), when, until when, revoked when. UI copy is generated from the same record so what the user agreed to and what is enforced cannot diverge.
* **Expiry:** every non-connection grant has `expires_at` (org default 12 months; event grants end at event end + 7 days; emergency grants have no expiry but require re-confirmation annually).
* **Revocation:** one tap in Customer → Privacy; effect is immediate for future reads (read functions re-check on every call); user sees "what changed" list. Revocation is recorded and cannot be undone by the grantee.
* **Re-consent** required whenever the requested scope widens.
* **Minors:** any persona with `context='student'` and a user under 18 is created in a *restricted default* (no public fields other than display name/school badge; org visibility only; Connect limited to same-org). Age is captured as an **age band**, not a date of birth. Verifiable guardian consent required before any public exposure — **legal review required (India DPDP Act 2023 children's-data provisions; OQ-9). This document is not legal advice.**

### 4.3 Data deletion & portability
* **Delete account:** request → 30-day grace (cancelable) → erasure job: personas, credentials (self-asserted), connections, consent grants (kept as de-identified evidence), notifications, contact methods, sensitive data (hard delete + vault key destroy), storage objects (avatars). Orders/payments retained de-identified for statutory periods. Devices linked to the account go to `retired`/`unassigned` per owner choice. Audit rows keep `actor_id` hashed after erasure.
* **Export:** machine-readable JSON + human ZIP of everything the user owns (personas, credentials, connections, analytics summary, orders). Self-serve, rate-limited, requires A3.
* **Org offboarding:** org can export/erase its data; members' personas are unaffected (they own them).
* **Rescue/analytics:** rescue messages purge 90 d after close; raw tap events 90 d.

## 5. Org ↔ member data flow (explicit rules)

1. Org can create *invitations* and *org-supplied attributes* (student ref, class, role). It cannot read anything else about a person until they accept and grants exist.
2. `org_read_member(org_id, user_id)` (definer): returns ⋂ of (fields user placed at `organization` tier) ∩ (active grant scope), audits every call with actor + purpose, rate-limits bulk enumeration (max N/min), **denies for suspended memberships**.
3. Org admins can never read: login email (unless user granted), phone, orders, other orgs' memberships, sensitive data (except emergency release with the responder rules above), other personas.
4. Cross-tenant: a user in two orgs appears to each org only through that org's grant; orgs cannot learn of each other.

## 6. Security invariants (each has a CI test)

1. No anon table policies; anonymous reads only through whitelisted functions.
2. Public payloads never contain `user_id`, `org_id`, device ids, order/account data, or S3/S4 data.
3. A customer cannot change: suspension state, entitlements, order payment state, `org_id`, `is_default` of others, consent rows of others, card `status` except via OTP-verified RPC.
4. No cross-tenant read/write for any table for any role (matrix test).
5. Every SECURITY DEFINER function pins `search_path`, revokes PUBLIC, grants only intended roles.
6. Every high-risk action requires ≥ A3 and writes audit.
7. Static NFC/QR (A0) can never authorize anything beyond rendering a public payload and *initiating* an escalation flow.
