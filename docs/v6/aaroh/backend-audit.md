# SHYGON AAROH backend audit and phase-gate report (Session A, 2026-10-19)

**Scope.** The owner's briefs of 2026-10-19 (two in the morning; the master requirements and the backend-engineering brief later, which added Return-to-Owner and the capability matrix, `capability-matrix.md`):
- "real backend, real emergency contacts and production functionality";
- "Session A: backend owner".

**Branch.** `v6/aaroh-backend`, from `4d730c4` (V6 RC `6d00f2f` + 028).

**Production.** Nothing was applied, pushed or deployed. No credential was read or used.

**Evidence labels.**

| Label | Meaning |
|---|---|
| OBSERVED | seen in the repository or local database |
| CONFIRMED | reproduced by a test, with a negative control where one exists |
| PROPOSED | designed, waiting for a decision |
| BLOCKED | waiting for approval or configuration |
| UNVERIFIED | not checked against production |

---

## 1. Existing backend architecture (OBSERVED)

| Layer | What it is |
|---|---|
| Database | One Supabase project (production `auvgvikdbhbrtsrsaslv`, `LIVE_SUPABASE_STATE.md`). Schema of record: the live baseline captured 2026-09-30. V6 adds 020–026 and 028 locally; this branch adds 029 and 030. Production also carries a second application's objects (V6-106/V6-107: `shygontap_profiles`, the `shygontap-photos` bucket and 7 migrations dated 2026-10-11 to 10-15, origin unknown) |
| Auth | Supabase Auth (GoTrue). `handle_new_user` creates `customers` + `profiles`. Admins come from `admin_users` with `admin_role_permissions(role)` and `admin_has(permission)` |
| Authorization | RLS on all 39 tables. Owner policies use `auth.uid()`. Writes the browser must not make are refused by guard triggers: 020/028 suspension, 021 `customer_id`, `enforce_tap_edit_rules` paid features, now 030 server columns. Privileged work goes through `SECURITY DEFINER` RPCs and `require_admin(permission)` |
| Server functions | `netlify/functions/*.mjs` (shared by Vercel through `api/*.mjs`): payments (`create-order`, `verify-payment`, `razorpay-webhook`, `payment-mode`), `card-otp`, `check-delivery`, `health`, and new `emergency`, `sms-status`, `emergency-dispatch`. Supabase Edge Functions: `admin-push`, `admin-refund` (the admin app) |
| Providers | Razorpay (test mode only; live payments are B-3). SMS through MSG91 or Twilio (`netlify/lib/sms.mjs`), **not configured anywhere**. Shiprocket (pincode). No email |
| Observability | `netlify/lib/log.mjs`: structured, redacted, request ids; `/api/health` |
| Local verification | `supabase/local/`: PGlite running the real schema, a PostgREST/GoTrue subset, the real functions, the Razorpay stand-in and now the SMS stand-in. Outbound network is denied in the suites |
| Deployment | **None of V6 is deployed.** www.shygontech.com serves a second, non-repository app (`live-site-second-app`). `shygon-v5-testing.vercel.app` serves V5. One deploy target is undecided (V6-043) |

## 2. Database entities and relationships (OBSERVED; baseline + 020–030)

Identity chain: `auth.users(id)`, then:
- `customers.user_id` (CASCADE);
- `profiles.customer_id → customers` (CASCADE). `profiles.id` is the user id by convention, with no FK;
- `tap_profiles.customer_id → customers` (CASCADE). `tap_profiles.user_id` has **no FK** and is nullable on live (known, M0.3);
- `orders.user_id` (RESTRICT, 026);
- `entitlements`, `notifications`, `support_tickets`, `account_events`, `card_otp_challenges`: `user_id` (CASCADE).

`cards`:
- `customer_id → customers` (SET NULL) and `tap_profile_id → tap_profiles` (SET NULL);
- `cards.user_id` and `cards.order_id` have **no FK** (V6-003, deferred).

New in 029. All are closed to the API roles; the owner FK cascades from `auth.users`:

| Table | Ownership / FK | Sensitive fields | Retention |
|---|---|---|---|
| `emergency_settings` | `user_id` PK | — | with the account |
| `emergency_contacts` | `user_id`; unique (user, number) | name, **phone_e164** (third party) | until removed by the owner, or the account is deleted |
| `emergency_contact_challenges` | `user_id`; `contact_id` SET NULL | `code_hash` (HMAC), `phone_digest` | deleted after 24 h |
| `emergency_events` | `user_id`; `tap_profile_id` SET NULL; unique (user, initiator, key) | `visitor_digest` (HMAC, per day) | deleted after 180 days |
| `emergency_event_recipients` | `event_id` CASCADE; `contact_id` SET NULL | name snapshot, `phone_e164` | number erased 7 days after completion |
| `emergency_delivery_attempts` | `recipient_id` CASCADE; append-only | provider ids | with the alert |
| `emergency_audit` | `user_id` CASCADE; `event_id` SET NULL; append-only | ids, last 4 digits only | 400 days |

Indexes cover every rate-limit query: owner/time, initiator/time, Tap/time, visitor/time, the due-retry scan and the provider-message lookup.

## 3. RLS and authorization findings

| # | Finding | Evidence | State |
|---|---|---|---|
| AB-1 | A Tap owner can clear `last_content_edit_at` and so bypass the paid edit window (self-granted Customization Pass benefit) | CONFIRMED locally (control open before 030, refused after); production UNVERIFIED | **Fixed locally (030)**, PROPOSED |
| AB-2 | A first address can be written directly, past `claim_tap_slug`'s reserved list | CONFIRMED locally | Fixed locally (030) |
| AB-3 | Server-managed Tap columns (`card_id`, `published_at`, …) are client-writable | CONFIRMED locally | Fixed locally (030) |
| V6-116 | The deletion procedure would have kept emergency contacts for an account with orders | CONFIRMED (the old procedure fails the new check) | Fixed locally |
| V6-112 | `record_tap_event` rate limit keyed on a client-variable `X-Forwarded-For` | OBSERVED (code reading) | Open, P3; a frozen function |
| O-7 / V6-011 | An owner can re-activate an admin-suspended **card** | Known since M1.0 | Deferred to the card release (DEC-2026-035) |
| O-3 / V6-035 | The card OTP can be bypassed through the readable `activation_code` | Known | Deferred to the card release |
| O-15 / V6-078 | Owner-or-admin policies admit any admin through `is_admin()` | Known | Open (decision) |
| V6-095 / V6-108 | `profile-images` storage policies are unverified, and the bucket is absent on production | Known | Open (P1/P0) |

No cross-tenant read or write was found:
- the RLS matrix is 1137/1137 across 39 tables × 7 callers, including the 7 new tables;
- every `admin_*` RPC refuses anon and customers;
- the emergency HTTP suite tries every owner operation as another customer and gets 404 each time.

No critical exposure was found, so the security incident process (doc 13) was not triggered.

## 4. Real features already implemented (LIVE-LOCAL, existing suites)

- Public Tap resolution with lifecycle states and a field allowlist (`test:public-tap` 25, golden).
- Owner profile and Tap editing with server-enforced paid features (identity 69, RLS matrix).
- Server-priced payments, webhook fulfilment and entitlements in test mode (payment-chain 30).
- Analytics with a salted visitor hash, dedupe and caps.
- Suspension guard (`test:suspension` 46).
- Admin RPCs with audit (admin contract, admin edge).
- Data export, and the account-deletion procedure (9).
- In-app notifications.
- Card OTP activation logic (SMS BLOCKED).

## 5. Backend functionality per mode (gap analysis)

| Mode / feature | Purpose | Frontend route | Backend operation | Entities | Authorization | Privacy rules | External dependency | Tests | Status |
|---|---|---|---|---|---|---|---|---|---|
| Digital profile ("Business") | Public identity page | `/t/:slug`, editor `/shygontap/tap` | P-1…P-3, T-1…T-6 | `tap_profiles`, `entitlements` | owner RLS + guard triggers | field allowlist; paused or suspended = dark | none | public-tap, golden, identity, matrix | LIVE-LOCAL |
| Info mode | Owner: "Business and Info first" | — | none | none | — | — | definition | — | **NOT IMPLEMENTED** (undefined; DEC-038 Q7) |
| Emergency | Alert trusted contacts | `/shygontap/emergency` (Session B), visitor control on `/t/:slug` | `/api/emergency` (§10 of the contract) | 029 tables | server function + definer functions; owner from a verified token | relay only; masked numbers; no location; no medical data | SMS provider, DLT, schedule | `test:emergency` 44, matrix | LIVE-LOCAL logic; **BLOCKED** live delivery and visitor alerts |
| Return to owner | Finder reaches owner through SHYGON | owner inbox `/shygontap/return-to-owner` (Session B), finder flow on `/t/:slug` | `/api/rescue` (contract §10a) | 031 tables | server function + definer functions; finder = a hashed token; owner = a verified token | relay only; links stripped; no message text in notices; 90-day retention | none (in-app notice) | `test:rescue` 18 | LIVE-LOCAL, **off** (`RESCUE_RELAY`); lost/found lifecycle BLOCKED (card registry) |
| Connect | Consent-based exchange | — | none | `connections`, `consent_grants` (not built) | — | doc 04 §4 | — | — | NOT IMPLEMENTED |
| Verify | Credential verification | — | none | — | — | — | — | — | NOT IMPLEMENTED (DEC-037: not a credential) |
| Profile management | Account details | `/shygontap/settings` | O-1…O-5 | `profiles`, `support_tickets` | owner RLS, 020/021 | phone is unverified (F4) | — | identity, matrix | LIVE-LOCAL |
| Card management | Link and switch cards off | `/shygontap/cards` | C-1…C-5 | `cards`, `card_otp_challenges` | owner RLS + OTP | — | SMS; card registry | payments, matrix | LIVE-LOCAL for V5 cards; **BLOCKED** for AAROH (no cards sold, no registry, `/d/` not built) |
| Analytics | Owner's numbers | `/shygontap/analytics` | A-1, A-2 | `tap_events` | owner | totals only | — | public-tap §D | LIVE-LOCAL |
| Privé | Demo hotels | — | none | — | — | demo-only by brief | — | — | **BLOCKED**: conflicting owner instructions (DEC-038 Q6) |
| Student, Event, Places, Cloud | Roadmap | — | none | — | — | — | — | — | NOT IMPLEMENTED |

## 6. Emergency-contact architecture (completed, LIVE-LOCAL)

- **Owner setup** (`contacts.*`):
  - up to 5 contacts: name, relationship and one SMS number each;
  - masked to the browser;
  - edits clear verification;
  - removal is audited, and removing the last verified contact switches visitor alerts off.
- **Verification:** the contact receives a 6-digit code naming the owner, and the owner enters it. HMAC storage, a 10-minute expiry and 5 tries; limits per contact, per owner and **per number across all owners** (anti-harassment).
- **Storage:** closed tables (RLS on, no policies, no client grants), reached only through 24 `SECURITY DEFINER` functions that only `service_role` may execute. Called solely from `netlify/functions/emergency.mjs`, which verifies the caller's token with Supabase Auth first. Never in a public RPC, HTML, log or analytics event (all tested).

## 7. Emergency-event and notification architecture (completed, LIVE-LOCAL)

The flow: owner or visitor → `/api/emergency` → token or confirmation check → `emergency_alert_open` → recipients → dispatch → status.

- `emergency_alert_open` runs under a per-owner transaction lock: idempotency key, rate limits, verified recipients, audit, and the owner's notice for visitor alerts.
- Recipients are the verified contacts, snapshotted.
- The dispatch is `emergency_claim_due`: a lease plus an attempt number.
- The provider call goes through `sendText`, with a 6 s timeout.
- `emergency_attempt_finish` records accepted, rejected, transient, timeout or not_configured.
- `emergency_event_refresh` derives the status: queued, sending, sent, delivered, partial, failed, not_sent or cancelled.
- `sms-status` (signature-verified Twilio receipts) moves a message to delivered or undelivered, forward only.
- `emergency-dispatch` (with `CRON_SECRET`) runs the retries, closes expired leases and applies retention.

The rules enforced by this design:
- **Attempts.** At most 3 attempts. A permanent refusal is never retried, and `not_configured` is never retried automatically.
- **Unknown outcomes.** A database failure after a provider accepted a message leaves it `sending`, never `sent`; after the lease it is retried within the limit.
- **Visitor alerts** are relay-only, off unless both the owner and the host switch are on, and capped per owner, Tap, visitor and platform.
- **Safety copy.** Every message and response carries the safety line. Nothing claims to contact emergency services. No location is collected.

## 8. Required provider configuration

`docs/v6/aaroh/provider-requirements.md`: `SMS_PROVIDER` plus credentials, three DLT templates for MSG91, `SMS_STATUS_CALLBACK_URL` for Twilio receipts, `CRON_SECRET` and a schedule, and `EMERGENCY_PUBLIC_ALERTS` (keep it unset). **BLOCKED** until a human provides them.

## 9. Code and schema changes (completed on this branch, uncommitted until the gate)

| Change | Files |
|---|---|
| Migration 029 (PROPOSED) | `supabase/migrations/029_emergency_contacts_and_alerts.sql` (header: purpose, VERIFY ON LIVE, tested rollback) |
| Migration 030 (PROPOSED) | `supabase/migrations/030_guard_tap_server_columns.sql` |
| Migration 031 (PROPOSED), v0.2 | `supabase/migrations/031_return_to_owner_relay.sql`; `netlify/functions/rescue.mjs`, `api/rescue.mjs`; `supabase/tests/rescue.mjs` (18); matrix, contract and deletion updated; the sweep runs `rescue_purge` |
| Bundle | `supabase/APPLY_ALL.sql` regenerated (020–030, applies twice on the baseline). **Do not apply as is**: 025 must be re-based for production drift (V6-106 F-4), and 027 is held aside |
| Server | `netlify/functions/{emergency,sms-status,emergency-dispatch}.mjs`, `netlify/lib/emergency.mjs`, `api/*.mjs` adapters; `netlify/lib/sms.mjs` extended (message ids, timeouts, Twilio callbacks and signature, classified failures; existing callers unchanged); `vite.config.ts` dev allowlist |
| Local stack | `supabase/local/sms-sim.mjs`; `stack.mjs` routes the SMS hosts and adds `useSms()` |
| Tests | new `supabase/tests/emergency.mjs` (44); `rls-matrix.mjs` (7 tables modelled closed); `admin-contract.mjs` (new admin names and relations must be listed; PROPOSED ones are reported as not approved); `account-deletion.mjs` (emergency data) |
| Runbook | `docs/runbooks/account-deletion.sql` and `RUNBOOK-account-deletion.md` delete emergency data (V6-116) |
| CI | `package.json` `test:emergency` in `ci`; `.github/workflows/ci.yml` step |
| Docs | `docs/v6/aaroh/api-contract.md` (AAROH-API v0.1), `provider-requirements.md`, this file; DEC-2026-038; backlog V6-109…V6-116; migrations README |

## 10. Security tests and actual results (2026-10-19, Node 20.18.0, this worktree, v0.2 tree)

| Suite | Result |
|---|---|
| `npm run test:emergency` | **44 passed, 0 failed** |
| `npm run test:rescue` | **18 passed, 0 failed** |
| `npm run test:db` | PASS: apply ×2 (020–031); verify 21; adversarial 64; **rls-matrix 1274 (44 tables × 7 callers)**; identity 69; admin-notes 12; golden 13 (one per migration prefix); **admin-contract 15** (new: admin_list_emergency_events, admin_list_rescue_reports and the 12 new tables reported "PROPOSED, NOT APPROVED"); rollbacks 12 (every 020–031 rollback, plus the chain); **account-deletion 9**; bundle check; history 2 |
| `test:payments:ci` | payments 15; functions-security 13 + **1 BLOCKED** (needs Node 22; known) |
| `test:payment-chain` 30 · `test:public-tap` 25 · `test:suspension` 46 · `test:admin-edge` 11 · `test:observability` 10 · `test:security` 11 · `test:push-guard` 18 | all PASS |
| `lint` · `build` · `test:bundle` · `test:bundle-secrets` (207 files) · `test:seo` · `test:components` 23 | all PASS |
| `npm audit --audit-level=high` | PASS (1 low, known) |
| `test:secrets` (gitleaks 8.30.1) | **FAIL, known:** the single D-7 finding at `9c8caa7` (`ProjectConsultation.tsx:75`, the Web3Forms public key, DEC-2026-020). No new finding |
| `test:e2e` (Playwright) | **not run**: no UI change by Session A |

Three problems found during the runs were real and are fixed, not worked around:
- `functions-security` flagged a log line naming the service-role variable;
- `account-deletion` (V6-116) was missing the emergency and rescue data;
- the relay's link cleaner swallowed a sentence's full stop.

## 11. Known defects and blockers

- **P0 (release, unchanged):** B-1 rotation, B-2 the 020+ apply (now 020–030, with the 025 re-base), B-3 live payments, V6-108 storage bucket.
- **Emergency:**
  - DEC-2026-038 (Q1–Q10);
  - the provider and DLT templates (V6-113);
  - the sweep schedule (V6-115);
  - MSG91 receipts (V6-114);
  - legal review for third-party data (DEC-2026-017).
- **Known limitations, accepted in the design:**
  - a server crash after the provider accepted can repeat a text (at most 3 sends per contact);
  - a cancelled alert cannot recall a sent text, and no "false alarm" follow-up is sent;
  - visitor rate limiting relies on the host's client-IP header (verify it on the chosen host); per-Tap and per-owner caps do not depend on it.
- **Out of scope:** `/d/` codes and the card registry, modes, Return-to-owner, Connect, Verify, Privé.

## 12. Migration and deployment requirements

1. Owner: DEC-2026-038 decisions.
2. DEC-2026-018 review and 24-hour cool-off for 029 and 030.
3. The 020–028 track first (B-1 rotation, the rebaseline with the owner's fresh dump, the 025 re-base).
4. Run the VERIFY ON LIVE queries in the 029/030 headers; apply by a human under break-glass with a backup.
5. Provider setup (`provider-requirements.md` §6).
6. Deploy target (V6-043) and the sweep schedule.
7. Supervised smoke test.

**Session A authorised none of these, and did none.**

## 13. Phase-gate status

| Gate | State |
|---|---|
| Inspection, gap analysis, schema map (brief steps 1–3) | PASS |
| Identity and FK defects (step 4) | No approved, unfixed identity or FK defect remains in scope. The open ones (`tap_profiles.user_id`, `cards.user_id`/`order_id` without FK) are deferred to the card release by owner decision |
| Public Tap resolution and privacy (step 5) | PASS (existing); `/d/` BLOCKED |
| Owner profile operations (step 6) | PASS (existing) + 030 |
| Emergency data model and permissions (step 7) | PASS locally; PROPOSED |
| Emergency events and status (step 8) | PASS locally; PROPOSED |
| Return-to-Owner relay (master requirement 6) | PASS locally (`test:rescue` 18), off; PROPOSED (Q12); lost/found lifecycle BLOCKED |
| Real notification delivery (step 9) | **BLOCKED**: provider and approval |
| Owner and card management (step 10) | Existing; AAROH cards BLOCKED |
| Other modes (step 11) | NOT IMPLEMENTED (no approved definitions); process definitions for all 12 capabilities in `capability-matrix.md` |
| Privé (step 12) | BLOCKED (conflict) |
| Tests (step 13) | PASS except the known secret-scan finding and the Node 22 check |
| **Gate** | **STOPPED for owner review.** Production: NOT AUTHORIZED |

## 14. Next smallest safe stage

After DEC-2026-038 Q1, Q3 and Q5, Session A:
- moves the decided parts from PROPOSED to APPROVED in `admin-contract.mjs`;
- implements the provider choice's remaining piece: MSG91 delivery reports (V6-114) if MSG91 is chosen, or nothing if Twilio is chosen;
- writes the operator smoke-test script.

Nothing touches production until the 020–028 release track has cleared its own gate.
