# SHYGON OS — M1 Security Model

> Planning document (M1.0).
> - No RLS, auth or payment change is made by this document.
> - Findings are **mapped, not fixed**. Fixes follow DEC-2026-022 / 024 and L3 approval by a named Security Owner (DEC-2026-018).
> - Sources: docs 04 and 07 (threat model), doc 13 (governance), the live baseline, and the drift report.

## 1. Security principles (inherited; binding)

1. **Policy lives in the database.**
   - RLS is on every table.
   - SECURITY DEFINER functions pin `search_path` and `REVOKE … FROM PUBLIC`.
   - The UI is advisory only.
2. **A tap is never authentication** (A0). Device codes select *what to show*, nothing more.
3. **Deny by default, fail closed.** Uniform public negatives (anti-enumeration).
4. **Identity keys:** authorization by `U` (auth user id). `C` (`customers.id`) is resolved server-side and never client-supplied (DEC-2026-029).
5. **Defense in depth:** RLS → definer RPC (`require_*` first, audit last) → edge controls → UI → tests (doc 04 §3.2).
6. **Secrets:**
   - never in `VITE_*`, the repository, logs, audit, chat or commit messages;
   - the service-role key exists only in server runtimes, never in agent environments;
   - `rzp_live_*` exists only in the production host environment, and only after G-PAY.

## 2. Assurance levels (doc 04 §2.2)

| Level | Meaning | M1 use |
|---|---|---|
| A0 | anonymous / static tap | public resolver only |
| A1 | authenticated chip (SDM) | not in M1 (OQ-2); `auth_mode` column only |
| A2 | session | ordinary customer actions |
| **A3** | session + step-up ≤ 10 min (OTP to a **verified** contact, or TOTP) | device state changes, phone change, transfer, deletion, export, `config.manage` |
| A4 | A3 + A1 on the same request | Phase 5 (Access) |

## 3. Authorization model (RBAC)

### 3.1 Role systems (never merged; doc 02 §5, doc 13 §2.1)

| System | Roles (canonical; **no new names**) | Mechanism |
|---|---|---|
| Customer | implicit owner | RLS `user_id = (SELECT auth.uid())` |
| Platform admin | `owner, admin, fulfilment, support, viewer` | `admin_users` + `admin_role_permissions()` + per-user `permissions`; `admin_has(perm)` inside definer RPCs |
| Tenant (Phase 2; DEC-2026-025) | `org_owner, org_admin, manager, staff, member` | `memberships.org_role` + `org_role_permissions`; `has_org_permission(org_id, perm)` |
| Governance | Product Owner, Principal Architect, Security Owner, Data Owner, Engineering Owner, QA Owner, Release Owner, Incident Lead (primary/secondary) | `ROLE_ROSTER.md` / later `ops.role_assignments` in SHYGON Control. **Grants no database privilege.** |

**Owner brief → canonical mapping:**

| Brief role | Canonical equivalent |
|---|---|
| Platform Admin | `admin_users` role (`owner` / `admin`) |
| Organisation Admin | `org_admin` (Phase 2) |
| Organisation Member | `member` (Phase 2) |
| Customer | implicit owner |
| Security Owner, Product Owner, Data Owner, Release Owner, Incident Lead | **governance roles; not RBAC** (conflict resolved by doc 13 §2.1) |

Containment rights come only from the kill-switch matrix (doc 13 §7.2).

### 3.2 Platform permissions
**Live (OBSERVED):** `orders.read/fulfil/cancel/refund`, `customers.read/manage`, `tap.read/moderate`, `products.read/manage`, `inventory.read/manage`, `entitlements.read/grant`, `support.read/respond`, `analytics.read`, `audit.read`, `admins.manage`.

**M1 additions (PROPOSAL; doc 12 M1.7):** `devices.read`, `devices.manage`, `devices.issue`, `security.read`, `config.manage`. Each new permission:
- is added to `admin_role_permissions()` without changing its signature;
- needs a contract test that every existing role keeps exactly its current permissions.

### 3.3 Authorization flow (target)
```text
request → (edge: rate limit, trust level, request_id)
        → RLS (row ownership by U) or definer RPC:
              require_admin(perm) | require_owner(resource) | has_org_permission(org, perm)  [Phase 2]
              → required_assurance check (A3 via step_up_tokens)
              → state machine / business rule
              → audit_event(…) + publish_domain_event(…)   (same transaction)
```

## 4. Findings map (F1–F7 and related)

| ID | Current state (OBSERVED) | Risk | Dependency | Proposed fix | Decision | Phase |
|---|---|---|---|---|---|---|
| **F1** | Live `profiles_update_own` / `tap_profiles_update_own` are row-level only; no trigger references `suspended_*`. Live also has the legacy `tap_profiles.suspended` bool. | a moderated customer un-suspends themselves | DEC-2026-022; Security Owner; DEC-2026-023 (tests on the baseline) | BEFORE UPDATE column guards on `suspended_*`, `suspended`, and `status`-while-suspended for non-admin callers; admin RPCs still work; adversarial tests | DEC-2026-022 / 003 | M0.3 |
| **F2** | `orders.admin_note` on a customer-readable row (`orders_select_owner_or_admin`) | internal note leak | DEC-2026-022 | `supabase/proposed/011` → `admin_order_notes`; keep the `admin_get_order` shape | DEC-2026-022 / 009 | M0.3 |
| **F3** | `get_public_profile` ignores card state; `/t/` is persona-addressed; `expire_tap_cards()` writes `cards.status`, which nothing in resolution reads | lost or deactivated cards keep resolving | DEC-2026-028, OQ-2b, DEC-2026-022 | `/d/:code` gated by lifecycle (M1.5); legacy `/t/` gating only per OQ-2b, as a separate DEC | DEC-2026-022 / 004 | M1.5 (or M0.3 under Position A) |
| **F4** | `card-otp` sends to `profiles.phone` (editable, unverified). **Also (O-3, §5):** live `customer_activate_card` / `customer_deactivate_card` accept the card's `activation_code`, which the owner can SELECT, so **no OTP is needed at all** on that path. | a stolen session changes device state | DEC-2026-022; DEC-2026-029; DEC-2026-028 | `contact_methods` + verification + 72 h cool-down; `step_up_tokens`; route **both** card paths through `device_transition()` with A3; stop exposing `activation_code` to client SELECT (column privilege or a view) | DEC-2026-022 / 005 | M1.2–M1.3 (or M0.3 under A) |
| **F5** | `record_tap_event` is anon-writable; `md5(UA‖IP‖day)` | forged or inflated analytics; IP-space enumeration | M1.1 (secrets in Vault/config), M1.5 (event token) | HMAC visitor hash with a rotating secret; signed resolve token; dedupe and limits in the legacy RPC (signature frozen) | DEC-2026-010 | M1.7 |
| **F6** | Quantified in the drift report: repo ≠ live; `db:push` would revert 48 objects and break sign-up | unsafe migrations | — | baseline origin + `db:push` guard + tests on the baseline | DEC-2026-023 | M1.1 (pre-req) |
| **F7** | Name-derived slugs are enumerable; the resolve oracle returns null vs data | harvesting public personas | M1.5 | device codes ≥ 64-bit; uniform negatives; per-IP throttling; optional "not listed by slug" persona setting later | DEC-2026-011 | M1.5 |
| **DEC-024** | the live `customer_id` contract breaks the paid claim (I-1), profile save (I-2), Tap safety net (I-3) and card records (I-4) | P1 latent: 6 customers exposed; 0 occurrences | DEC-2026-023 | Options A–D in the DEC record | DEC-2026-024 | before G-PAY |

## 5. New observations from M1 analysis (OBSERVED; not fixed; for the Security Owner)

| ID | Observation | Evidence | Initial rating | Proposed handling |
|---|---|---|---|---|
| **O-1** | `require_admin(p_permission)` can be executed by `anon` | live grants (function ACL) | Low (it raises for non-admins; no data returned). It needlessly widens the surface. | `REVOKE EXECUTE … FROM anon` in the M0.4 policy clean-up (L3) |
| **O-2** | The legacy `get_public_tap(p_slug)` is anon-callable and returns contact columns (phone, WhatsApp, email). It currently **errors** on live (F14, "slug is ambiguous"). | live grants + TEST_REPORT §2.1 | Medium-latent: if anyone "fixes" the ambiguity, it may expose contact fields that `get_public_profile` would hide | DEC (F14): retire or revoke. **Never fix in place without a leak snapshot test.** |
| **O-3** | Card actions bypass OTP. `activation_code` is readable by the owner (no column privileges; `authenticated` has `GRANT ALL` on `cards`; owner SELECT policy), and `customer_activate_card` / `customer_deactivate_card` accept it with no OTP. | live baseline lines (grants, policy, function bodies) | P2 today: needs session theft; device state does not affect `/t/` (F3) | Part of F4 (§4) |
| **O-4** | Live `cards.status` has **no CHECK** (any string is accepted); the CHECK is on legacy `card_status` | live table definition | Medium (integrity) | DEC-2026-028 |
| **O-5** | The deployed Vercel app lacks `/api/payment-mode` while the checkout functions exist: the deployment is stale against the repository | public GET (2026-09-30) | Medium (operational) | Release Owner: deploy records; G-PAY requires a payment-mode check |
| **O-6** | `cards_issue_activation_code()` calls `gen_random_bytes` unqualified with `search_path = public, pg_temp` | live function | Unknown: VERIFY where pgcrypto lives | Data Owner verify (drift report §11) |

## 6. Security invariants (each needs a CI test; doc 04 §6 + M1)

1. No anon table policies. Anonymous reads go only through whitelisted functions or the resolver.
2. Public payloads never contain `user_id`, `customer_id`, `org_id`, device ids, order or account data, or S3/S4 data (leak snapshot with canary values).
3. A customer cannot change, by direct table write:
   - suspension state (F1);
   - entitlements;
   - order payment state;
   - `customer_id`;
   - `org_id` or `is_default` of others;
   - card `status`, except through the A3 RPC.
4. `customer_id` (C) is never taken from a client: the contract test sends U and expects rejection or normalisation (DEC-2026-029).
5. Every definer function pins `search_path`, revokes PUBLIC and grants only intended roles (`lint-definer.mjs`, doc 12 §4.1). This would currently flag O-1.
6. Every high-risk action requires A3 and writes audit.
7. No cross-tenant read or write (Phase 2 matrix).
8. No secret patterns in the repository, CI logs, audit rows or notification bodies (gitleaks + log/audit lint).
9. `rzp_live_` appears nowhere outside host environment variables (CI check, PROPOSAL).
10. Admin RPC contract snapshot unchanged (APK).

## 7. Audit & security-event model

**Unified audit** (`admin_audit_log` generalized; doc 03 §3.6):
- fields: `actor_kind ∈ {user, admin, org_member, system, api_client, agent}`, `actor_id`, `action`, `entity_type`, `entity_id`, `org_id`, `request_id`, `ip_hash`, `outcome ∈ {allowed, denied, error}`, `metadata`, `created_at`;
- append-only (REVOKE UPDATE/DELETE + a trigger);
- `admin_audit()` signature kept.

**Security events:** audit rows with `category='security'`, mirrored to the log drain (≥ 180 days) and alert rules. These cover:
- new login;
- step-up success or failure;
- phone change;
- device transitions;
- role or permission changes;
- policy denials;
- `db`-level detectors.

**Never stored anywhere:** passwords, OTP codes, API or webhook secrets, service-role keys, payment secrets, full JWTs or refresh tokens, raw IP or UA, card numbers.

## 8. Threat coverage for M1 modules (doc 07 references)

| Module | Primary threats | Controls required before merge |
|---|---|---|
| Identity / step-up | T1, T2, T12 | verified contacts, cool-down, step-up tokens, security notifications, MFA flag for admins |
| Card lifecycle | T1, T4, T16 | single transition function, A3, audit + notification on every change, CHECK on `status` |
| Routing | T5, T7, T8, T16, T21 | uniform negatives, ≥ 64-bit codes, no URL targets, cache ≤ 30 s + purge, rate limits, K1 |
| Persona privacy | T3, T7 | default-private new fields, leak snapshot, golden equality, version history |
| Notifications | T7, T6 | minimal bodies, rate limits, locked security categories, provider secrets server-only |
| Analytics | T7, T8, T15 | no PII, HMAC hash, signed token, k ≥ 5 for organisations |
| Support | T7, T11 | internal notes in a separate admin-only table; audit on assignment and status |
| Payments / fulfilment | T14 | frozen; test mode; G-PAY; reconciliation (read-only) |
| AI (future) | T22 | K18/K19; no production credentials; suggestion objects; redacted inputs |

## 9. Approval requirements
- **Every** change touching RLS, `SECURITY DEFINER`, `GRANT`/`REVOKE`, `auth.`, OTP, payments or `supabase/migrations/**` is **L3**. It needs:
  - a named Security Owner approval (+ Data Owner for migrations), which needs DEC-2026-018 first;
  - adversarial tests that fail before the change and pass after;
  - rollback SQL;
  - a DEC id in the PR.
- AI review (doc 14 §3.6) is advisory and never counts as an approval.
