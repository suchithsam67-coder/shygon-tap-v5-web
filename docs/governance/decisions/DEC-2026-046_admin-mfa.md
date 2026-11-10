# DEC-2026-046: Admin multi-factor authentication (V01 task T-12): impact assessment and plan

| Field | Value |
|---|---|
| Decision ID | DEC-2026-046 |
| Title | How administrators get a second factor without locking the admin app out |
| Date opened | 2026-11-10 |
| Domain | Security (administrator access to every customer's data, refunds and moderation); Operations (the admin app, recovery) |
| Level | **L3**: it changes frozen authorization functions (`is_admin`, `require_admin`; doc 12 §2) and how administrators sign in |
| **Accountable Owner (A)** | The repository owner (the founder), for the product choice. The break-glass recovery belongs with the adult incident lead (F-3) |
| Responsible (R) | Session A (backend): the database rule, its status function, the local stack and the tests. **The admin app has no owning session** (Q2). Codex: the two admin edge functions, after V6-094 |
| Consulted | The coordination session (V01 task registry T-12: "FIRST assess the impact on the Expo admin app … Report before building anything") |
| State | **PROPOSED, 2026-11-10.** Assessment only, read-only. Nothing is built or changed, and no admin account is touched |

Labels: **OBSERVED** (read in the admin app folder or this repository), **INFERRED** (vendor documentation, not tested here), **PROPOSED**.

## 1. Question

Version 01 lists "Admin MFA: Admin login requires 2FA" (`docs/shygon-os/v01/SHYGON_AAROH_VERSION_01_COMPLETE_SCOPE.md` §2.1). Requiring a second factor could lock every administrator out of the admin app. What breaks, and in what order must it be done so that nothing does?

## 2. Impact assessment

### 2.1 The admin app (`../shygon-tap-v5-admin`) [OBSERVED]

- **Expo / React Native** (Android, plus a web target), `@supabase/supabase-js` ^2.109. **The folder is not under version control** (`git` reports no repository), so it has no history or review trail.
- **Sign-in is email and password only** (`signInWithPassword`, `src/lib/session.tsx:148`). There is no MFA code anywhere: no `auth.mfa` call, and nothing about two-factor in its README, `ARCHITECTURE_AND_READINESS.md` or `PRODUCTION.md`.
- **Its admin check:** on every sign-in **and every token refresh**, it calls `admin_me()` (`session.tsx:77-117`). If the call fails with SQLSTATE `42501`, or with a message matching "administrator access" or "does not permit" (`src/lib/supabase.ts:168-172`), the app shows "This account does not have administrator access." and **signs the operator out**.
- **What it calls:**
  - 35 database functions (`admin_*`, `src/lib/api.ts`), each re-authorised in Postgres;
  - two edge functions, `admin-refund` and `admin-push`;
  - one live feed, `admin_notifications` (its read policy uses `is_admin()`).

### 2.2 The backend [OBSERVED]

- **One check point for the database functions:** `require_admin(permission)` calls `is_admin()` and `admin_has()`. The live baseline calls `require_admin` 39 times.
- **`is_admin()` also guards row-level policies:** 13 in the baseline, plus those rewritten by 024 and the admin paths of 020, 022, 029 and 031.
- **`admin_me()`** does its own lookup.
- **All three are frozen** (`FROZEN_NAMES` in `supabase/tests/admin-contract.mjs`; doc 12 §2). A body change needs an approved entry.
- **The two edge functions do not use `is_admin()`.** `supabase/functions/_shared/admin.ts` `resolveAdmin` checks the token with `auth.getUser`, then reads `admin_users` with the service key. **A rule in the database alone would leave refunds and push notifications with password-only access.**
  - These files are reserved for Codex (V6-094), so Session A does not touch them.
- **The customer web app calls no admin function** (a search of `src/` finds none).

### 2.3 What happens if a second factor were required today

Suppose `require_admin` / `is_admin` / `admin_me` started refusing sessions without a second factor:
- **every administrator is locked out** at their next sign-in, or within the hour at the next token refresh. `admin_me()` refuses with `42501`, the app reads it as "not an administrator" and signs them out;
- **the app offers no way to add a factor**, and the message misleads ("does not have administrator access");
- the live alert feed goes silent;
- **refunds and push would still work** (§2.2), an inconsistent half-control;
- recovery needs direct database or dashboard access.

**The coordinator's concern is confirmed: a database-first switch locks the admin app out.**

### 2.4 Supabase's mechanism [INFERRED: vendor documentation, not tested here]

- **Cost and availability:** TOTP authenticator-app factors are free and enabled on every project. Phone factors are a paid add-on. ([MFA](https://supabase.com/docs/guides/auth/auth-mfa), [TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp), [pricing](https://supabase.com/pricing))
- **The session's access token carries an `aal` claim:** `aal1` after the password, `aal2` after the second factor. Postgres can require `(auth.jwt() ->> 'aal') = 'aal2'`.
  - The documentation also shows the rule applied **only to users who have a verified factor** (`auth.mfa_factors`, `status = 'verified'`). ([MFA via RLS](https://supabase.com/blog/mfa-auth-via-rls))
- **Client flow:** after the password, `getAuthenticatorAssuranceLevel()` says whether a second factor is due; then `mfa.challenge` / `mfa.verify` raise the session to `aal2`. `mfa.enroll` adds a factor, at `aal1` while none exists.
- **The claim updates only on the next token refresh,** so a change in factors shows up then.

### 2.5 The local test stack [OBSERVED]

- The auth stand-in (`supabase/local/auth.mjs`) always issues `aal: 'aal1'` and has no factor endpoints. The local `auth` schema has no `mfa_factors` table.
- The admin suites sign administrators in at `aal1`: identity 69, admin-notes 12, the RLS matrix, admin-edge 11. **A strict rule would fail all of them** until test tokens can reach `aal2`.

## 3. Options

| Option | What | Assessment |
|---|---|---|
| **A (recommended): staged** | **1. The app first:** MFA screens (add an authenticator app, enter the code at sign-in), and a new refusal that sends the operator to that screen instead of signing them out. **2. The backend, opt-in:** a database rule that requires `aal2` **only from an administrator who already has a verified factor**, a status function the app can ask, and the same rule in the two edge functions. **3. Mandatory:** once every active administrator has a factor, the owner flips a switch and `aal2` is required for all; adding a factor stays possible | No step locks anyone out. Step 2 changes nothing until someone enrols, so it can be built and tested before the app is ready. Every surface (database functions, policies, live feed, edge functions) ends with one rule |
| B: strict at once | `aal2` required for every administrator from the moment it is deployed | Locks everyone out (§2.3) until the app ships and each administrator enrols. Not recommended |
| C: in the app only | The app asks for a code, the database does not check | Not a control: the database functions accept any administrator's password-only token. Rejected |
| D: after V01 | Leave administrators password-only at launch | V01 lists admin MFA; administrators can read every customer and issue refunds. Not recommended |

## 4. Option A in detail [PROPOSED]

- **Database (Session A, migration 040):**
  - `is_admin()` / `require_admin()` refuse an `aal1` session for an administrator who has a verified factor, or for every administrator once the switch is on. The refusal is **not** `42501` and does not match the app's sign-out pattern: a distinct `admin:mfa_required`. An app that does not yet know it shows "blocked", it does not sign out (`session.tsx:112`, versus the sign-out at `:97-104`).
  - A new `admin_mfa_status()` returns `{ factorEnrolled, aal, required }`. `admin_me()`'s frozen shape is not changed.
  - The switch is a closed, audited settings row, OFF.
  - Approved-change entries for the frozen functions in the admin-contract gate.
- **Local stack (Session A):** the auth stand-in gains TOTP factors (enrol, challenge, verify; RFC 6238) and issues `aal2`. The local `auth` schema gains `mfa_factors`. A new `test:admin-mfa` proves:
  - opt-in enforcement;
  - the switch;
  - that enrolment still works at `aal1`;
  - the live feed and policies;
  - no lock-out for administrators without a factor while the switch is off.
  - The existing admin suites keep passing at `aal1` with the switch off and no factor.
- **Edge functions (Codex, after V6-094):** `resolveAdmin` reads the verified token's `aal` and applies the same rule.
- **The admin app (an owner to be assigned, Q2):** the MFA screens and the `admin:mfa_required` route, before step 3.
- **Recovery (runbook):** at least two owner-role administrators with factors. A lost authenticator is reset only through Supabase's dashboard or auth admin API, by the adult incident lead (F-3), and audited.

## 5. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Which option? | **A, staged**, starting with step 2, which locks no one out |
| Q2 | Who builds the admin app's MFA screens? No session owns `../shygon-tap-v5-admin`, and it is not under version control | The coordinator assigns an owner, and the folder is put under git first so every change has a history |
| Q3 | Which second factors? | **Authenticator-app codes (TOTP) only:** free, and not open to SIM swaps. No text-message factor |
| Q4 | When does step 3 (mandatory) switch on? | By the owner's word, once every active administrator has a verified factor and the app's screens are released |
| Q5 | Break-glass recovery | Two owner-role administrators with factors; resets only by the adult incident lead (F-3), with an audit entry; written as a runbook |

## 6. Not affected

Customers' sign-in and the customer web app (they call no admin function). Server functions that use the service key (they never carry an administrator's session). The frozen admin functions' outputs; only their refusal changes, and only for the cases in §4.

## 7. What the owner approves

To build step 2 locally: "Approve T-12 option A" (Q1–Q5 as recommended), or the answers that differ. Session A then writes:
- migration 040 (opt-in rule, status function, switch OFF);
- the local stack's TOTP factors;
- `test:admin-mfa` and the admin-contract approvals.

It runs the full gates, commits locally and reports. **Nothing changes for any administrator until someone enrols a factor.** The app screens (Q2), the edge functions (Codex) and step 3 (Q4) follow their own approvals.
