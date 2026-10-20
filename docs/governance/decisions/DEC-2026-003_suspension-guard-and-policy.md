# DEC-2026-003: a customer can un-suspend their own Tap or account (F1)

| Field | Value |
|---|---|
| Decision ID | DEC-2026-003 (queue row F1 since 2026-09-30; this record created 2026-10-18) |
| Domain | Security |
| Level | L3 (triggers guarding authorization-relevant columns) |
| Accountable Owner (A) | Security Owner: the repository owner (DEC-2026-018, Option B) |
| Related | DEC-2026-022 Position A (M0.3 F1), DEC-2026-035 (V6, numbering N-1), DEC-2026-001 (rotation), DEC-2026-037 (AAROH terms: 027 held aside; not yet filed) |
| State | **APPROVED 2026-10-18, in session:** the early-fix path for 020 + 028 (conditional, §3.1), and the account-suspension policy (§3.2). **Implemented locally:** 020 (2026-10-03) and 028 (2026-10-16, branch `v6/suspension-guard`). **Not applied to production.** |

## 1. Question
Production lets a signed-in customer update every column of their own `profiles` and `tap_profiles` rows, including the suspension an administrator set. How is that closed, and what does a suspension mean for the account?

## 2. Evidence
- **OBSERVED on production** (read-only packs, 2026-10-16 and 2026-10-18; no values recorded):
  - `authenticated` may UPDATE `suspended_at`, `suspended_reason` and `suspended_by` (A3c);
  - the own-row policies do not limit columns, and `guard_suspension_columns()` and its triggers are absent (A1, A3);
  - the two admin suspension RPCs are SECURITY DEFINER, owned by a server role, and unchanged from the 2026-10-02 baseline (A2, A3b; drift pack);
  - `anon` and `authenticated` inherit no role, and a JWT can select only `anon`, `authenticated` or `service_role` (A3d, A3e);
  - the changed `get_public_profile` still serves only `status = 'active' AND suspended_at IS NULL`;
  - no production function other than the two admin RPCs writes a suspension column, the new `admin_create_tap_page` included (VERIFY-LIVE-INSPECT);
  - 0 Taps and 0 suspended accounts today.
- **CONFIRMED on an isolated copy of the live schema** (`npm run test:suspension`, 46 checks):
  - every owner attack succeeds on the baseline and is refused after 020 + 028, with nothing changed;
  - the admin RPCs still suspend, restore, audit and notify;
  - forged settings, claims and tokens do not help;
  - mutation-tested: the suite fails if the guard is switched off, trusts a caller-set setting, loses 028, or is not the last trigger.
- **020 audit:** sound. It checks the database role that runs the statement (`anon`/`authenticated` are refused), never a session setting. One gap: it guards UPDATE only, and after 021 an account with no profile row could insert its own profile already suspended. **028** closes that with a BEFORE INSERT guard (additive; 020 unchanged).

## 3. Decisions (repository owner, 2026-10-18, in session)

### 3.1 Early fix: APPROVED, conditional
Apply 020 and 028 as a minimal security fix, ahead of the 021–026 bundle, once all five conditions below hold. In the owner's words, "This authorizes the early-fix approach, not immediate execution against production". If verification fails or reveals unexpected schema drift, stop and report the discrepancy. Migration 027 stays reserved for the AAROH catalogue (DEC-2026-037).

| # | Condition | Status on 2026-10-18 |
|---|---|---|
| 1 | `VERIFY-LIVE-DRIFT.sql` and `VERIFY-LIVE-V6.sql` reviewed against production | **Done.** Drift found, none of it in 020/028's objects (backlog V6-106) |
| 2 | Preconditions, trigger order, role assumptions, function ownership and admin authorization paths independently reviewed | Author review done (this record). **Independent sign-off pending** (DEC-2026-018 checklist) |
| 3 | Credential rotation complete | **Not done** (DEC-2026-001: approved, human action) |
| 4 | The exact files pass the required checks, rollback and post-apply smoke tests | Locally done. The production smoke tests are in `docs/release/DEPLOYMENT.md` §3a and run after the apply |
| 5 | The production operator approves the window and the recovery plan | **Pending** |

After the apply, verify (DEPLOYMENT.md §3a):
- customers cannot change or forge suspension, on update or at profile creation;
- admin suspend and restore work and are audited;
- normal edits and V5 flows work;
- suspended public Taps stay unavailable;
- the rollback stays viable.

### 3.2 Account-suspension policy: ADOPTED
The owner's policy, as decided:
- **Suspension enforcement.** An account suspension must not be removable by the account owner. Only an authorized, audited administrative action may change moderation status.
- **Tap suspension.** Account suspension and individual Tap suspension are separate states. Reactivating an account must not automatically remove an independent Tap moderation suspension.
- **New purchases.** A suspended account must not gain an unrestricted public Tap merely by completing a purchase. Provisioning must preserve the suspension state and require authorized review before publication.
- **Sign-in.** A suspended account may sign in to view its status, contact support and appeal. It must not be able to bypass suspension restrictions by editing its profile or changing account settings.
- **Editing.** Permit only the limited account and profile changes needed for support, correction or appeal. Block changes that circumvent suspension or enable prohibited public activity.
- **Orders.** Preserve access to existing order records and customer support. New purchases or fulfilment that would activate a suspended service must be held for review under the published policy.
- **Notifications.** Send a clear suspension notice with the reason where appropriate, the affected service, the effective status and the appeal/support process. Do not expose internal-only moderation notes.
- **Auditability.** Record the actor, action, reason and timestamp for suspension, restoration and appeal outcomes.

"Implement these policies in a separately reviewed change if they require code beyond migrations 020 and 028. Do not expand the narrow security migration into an unreviewed account-lifecycle redesign."

### 3.3 Commit on `v6/suspension-guard`: AUTHORIZED
The authorization covers one dedicated commit:
- only the reviewed suspension-guard changes;
- 020 unchanged;
- 027, unrelated changes, credentials, local artifacts and the AAROH store work excluded.

Known pre-existing failures are reported separately.

## 4. What 020 + 028 deliver against the policy, and what is still needed

| Policy rule | Today (behaviour pinned by `supabase/tests/suspension-guard.mjs`) | Still needed | Backlog |
|---|---|---|---|
| Owner cannot remove a suspension | **Delivered by 020 + 028**: owner UPDATE/INSERT/upsert of a suspension column is refused (42501); only the audited RPCs change it | Apply to production (§3.1) | B-2 |
| Account vs Tap suspension are separate | `admin_set_customer_suspension(..., false)` clears every Tap's suspension, including an independent moderation | Track the source of a Tap suspension; reactivation lifts only the account's own | V6-102 |
| Purchase does not bypass suspension | A suspended account with no Tap gets an unsuspended draft Tap from payment, and can publish it. The new `admin_create_tap_page` refuses suspended customers | Provisioning creates the Tap suspended, or held; checkout and fulfilment hold for review | V6-103 |
| Sign-in allowed; restricted editing | Sign-in works. A suspended owner may still edit Tap content and settings; the Tap stays unavailable | Define and enforce the allowed edits | V6-104 |
| Orders preserved; new activations held | Orders stay readable. New purchases are not held | Hold new purchases and fulfilment for review | V6-103 |
| Clear notice; appeal | A Tap suspension notifies the owner with the reason. An account suspension sends nothing, and there is no appeal flow | Account-suspension notice and an appeal/support path; no internal notes | V6-105 |
| Audit of suspension, restore, appeal | Suspend and restore are in `admin_audit_log` (actor, action, entity, reason, time). Appeal outcomes are not modelled | Record appeal outcomes | V6-105 |
| Second public page system | Production's `shygontap_profiles` (4 published pages) has no suspension at all, and owners publish freely. It is served by a second application on the same project, the corporate site at www.shygontech.com, whose source is not on this machine | Decide the system's future. If kept, add moderation and a whitelisted public read | V6-107 |

## 5. Implementation record
- 020 `supabase/migrations/020_guard_suspension_columns.sql`: unchanged since 2026-10-03.
- 028 `supabase/migrations/028_guard_suspension_on_insert.sql`, 2026-10-16. Numbered 028 because 027 is the held-aside AAROH catalogue.
- Tests: `npm run test:suspension` (in `npm run ci` and the CI workflow).
- Release documents:
  - `docs/release/DEPLOYMENT.md` §3 and §3a;
  - `docs/release/ROLLBACK.md`;
  - `supabase/APPLY_ALL.sql` (020–026 and 028).
