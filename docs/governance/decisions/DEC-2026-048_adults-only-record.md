# DEC-2026-048: The server-side 18+ record (V01 task T-13, founder decision F-26)

| Field | Value |
|---|---|
| Decision ID | DEC-2026-048 |
| Title | How SHYGON records, on the server, that each account holder confirmed they are 18 or older, so that the confirmation cannot be edited afterwards |
| Date opened | 2026-11-14 |
| Domain | Legal (DPDP: children's data, risk R-05); Privacy (what is kept, and for how long); Product (sign-up) |
| Level | **L3**: a new closed table, a new trigger on `auth.users`, and a change to the owner export. DEC-2026-018 applies: a 24-hour cool-off and the checklist before any real database |
| **Accountable Owner (A)** | The repository owner (the founder), who holds the product roles (DEC-2026-018 Option B). Counsel (F-23) approves the legal wording. The founder signs nothing (the adult authorised signatory does, F-2) |
| Responsible (R) | Session A (backend): the record. Session B (frontend): the sign-up boxes and the one-time prompt (`e048a66`, parked) |
| Consulted | The coordination session (registry T-13; founder register F-26) |
| State | **APPROVED FOR THE LOCAL BUILD, 2026-11-14, and built (§11).** The owner, in session: "Approve the build", answering "Approve building DEC-2026-048 on the recommended answers (Q1–Q5, option A)?". Local only: nothing is applied, pushed or deployed. History: PROPOSED (`15862db`) |

Labels: **OBSERVED** (in this repository, the live baseline or a decision record), **INFERRED**, **PROPOSED**.

## 1. Question

The founder decided F-26 on 2026-11-12. The coordinator relayed it verbatim: "Option A: 18+ now". Version 01 is for people aged 18 and over, including college students of 18 or more. Under-18 users come later, through Student mode with verified parental consent and a counsel review.

The sign-up form will ask for the confirmation, but only the server can keep a record of it that holds up. What should that record be, and what should happen to accounts that have none?

## 2. What exists today [OBSERVED]

- **One sign-up path.** `src/pages/Auth.tsx` calls `supabase.auth.signUp` with an e-mail address and a password. There is no social sign-in and no invitation flow in the code.
- **What sign-up stores today.** `terms_accepted_at` (the browser's time) and `policies_version` (`LEGAL.lastUpdated`) go into the account's sign-up data (`raw_user_meta_data`). Nothing on the server records them.
- **Session B's parked change** (`e048a66`, `wip/t13-adults-only`):
  - two separate required boxes: "I am 18 or older." and the Terms box;
  - it adds `adult_confirmed: true` and `adult_confirmed_at` to the same sign-up data;
  - draft Terms and Privacy wording, questions Q-A1 to Q-A4.
  - Its commit says the server-side record is Session A's.
- **The sign-up trigger.** `on_auth_user_created` (AFTER INSERT on `auth.users`) runs `handle_new_user()`, which creates the `customers` and `profiles` rows. `test:identity` asserts that `handle_new_user` is unchanged.
- **The live accounts.** The owner's count on 2026-10-18 was 6 accounts. All of them predate any age confirmation.
- **The Connect ledger (032, `consent_grants`)** records consent between two users for profile fields. It does not fit a one-person declaration.
- **V01 scope and the architecture note** ask for "an 18+ confirmation at sign-up; Terms" and a "sign-up confirmation stored with a timestamp".

## 3. Why the sign-up data alone is not a record [INFERRED]

- The account holder can rewrite `raw_user_meta_data` at any time (`auth.updateUser({ data })`). So it cannot show whether or when the confirmation was given.
- Its times come from the browser's clock.
- It is also mixed with display data, such as the name.

## 4. The proposal [PROPOSED]

### P-1. A closed, append-only table: `account_age_confirmations`

| Column | Meaning |
|---|---|
| `id` | uuid |
| `user_id` | references `auth.users`, `ON DELETE CASCADE` |
| `confirmed` | true only for an explicit "I am 18 or older" |
| `source` | `signup` or `reconfirm` (P-4) |
| `policies_version` | the Terms and Privacy version shown, at most 40 characters |
| `client_confirmed_at` | the browser's time, for information only; null unless it is a valid time within a day of the server's |
| `created_at` | **the server's time**: the time of record |

- RLS is on, with no policy. The service role may SELECT and INSERT only; UPDATE, DELETE and TRUNCATE are revoked, as for `card_events` (041).
- No client role can read or write it.

### P-2. Recording at sign-up: a second trigger on `auth.users`

- `on_auth_user_age_confirmation` (AFTER INSERT) runs `record_signup_age_confirmation()`: SECURITY DEFINER, with a fixed search path.
- It reads the new account's sign-up data **once, at creation**:
  - `confirmed` is true only when `adult_confirmed` is the JSON value `true`. A string, a number or a missing value is false;
  - `policies_version` is trimmed to 40 characters;
  - `client_confirmed_at` is kept only if it parses.
- **It never raises over bad data,** so it cannot make a sign-up fail. Every new account gets exactly one `signup` row, `confirmed` true or false, so a missing confirmation is visible rather than silent.
- **`handle_new_user()` is not touched** (`test:identity`).

### P-3. Later edits do not count

There is no trigger on UPDATE. Changing the sign-up data afterwards never alters the record.

### P-4. Accounts without a confirmation

These are the six accounts that predate the gate, and any account created by another means.
- **`POST /api/account`, `age.status`:** returns `{ confirmed, confirmedAt, source }` for the signed-in owner, from their latest row.
- **`POST /api/account`, `age.confirm` `{ policiesVersion }`:** records a `reconfirm` row with the server's time, for the signed-in owner only. It is rate-limited, and answers `already_confirmed` when a confirmed row exists.
- **Session B** shows a one-time "I am 18 or older" prompt at the next sign-in when `age.status` says the account is not confirmed (Q3).

### P-5. A self-declaration, not proof of age

- There is no date of birth and no identity document. This is data minimisation: F-26 asks for a confirmation and the Terms.
- **Counsel (F-23) decides** whether that is enough under the DPDP Act for an adults-only service. This record is not legal advice. The Terms already tell people under 18 not to sign up, and say that an account found to belong to a child is closed and its data deleted (Session B's draft).

### P-6. Export and deletion

- **Export:** the owner export (`account_export_build`, from 041's text) gains `ageConfirmation`: the latest row's `confirmed`, `at`, `source` and `policiesVersion`.
- **Deletion:** deleting an account removes its rows (cascade). The account-deletion and export-parity gates cover the new table.

### P-7. The database does not refuse a sign-up

- A failing trigger makes the hosted auth service answer with a generic error.
- It would also block accounts created another way, such as the dashboard or a future sign-in method.
- The record (P-2) plus the prompt (P-4) give a confirmation on file for every account without that risk. Stronger enforcement is Q2's option C.

### P-8. No administrator view in V01

The table is service-only. An admin read can be added later through the frozen-contract process (doc 12 §2) if support needs it.

## 5. Options for enforcement (Q2)

| Option | What | For | Against |
|---|---|---|---|
| **A (recommended)** | Record at sign-up (P-2), plus the one-time prompt for accounts without a confirmation (P-4) | Matches V01 scope and F-26; cannot break sign-up | An account can exist briefly before it confirms (legacy accounts, until their next sign-in) |
| B | A as well, and the trigger refuses an unconfirmed sign-up | Every new account confirms first | A generic error to the person signing up; blocks any other account-creation route; still a self-declaration |
| C | A as well, and server functions that start a paid or public action refuse an unconfirmed account (checkout, publishing a Tap, activating a card) | Nothing that matters happens without a confirmation | Touches the payment and Tap paths, so more surface and more tests; better decided after counsel's view |

## 6. Contract (AAROH-API v0.17 when built) and Session B

- **§4c `POST /api/account`:** `age.status` and `age.confirm`, as in P-4.
- **Sign-up data keys,** exactly as in `e048a66`:
  - `adult_confirmed: true` (a JSON boolean);
  - `policies_version`;
  - `adult_confirmed_at` (optional, for information only).
- **Session B** owns the boxes, the prompt and the strings (Q-A1 to Q-A4 at its gate; counsel for the Terms and Privacy).

## 7. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | The record as in P-1 to P-3 (a closed append-only table, written by a second trigger at sign-up, never by later edits)? | Yes |
| Q2 | Enforcement: option A, B or C (§5)? | A |
| Q3 | Accounts with no confirmation (the six live ones): ask once at their next sign-in, or leave them? | Ask once (P-4) |
| Q4 | A self-declaration only: no date of birth and no document, subject to counsel (P-5)? | Yes |
| Q5 | The export shows the latest confirmation (P-6)? | Yes |

## 8. Tests the build must pass (`test:age-gate`, local stack)

1. A sign-up with `adult_confirmed: true` writes one `signup` row: `confirmed` is true, the time is the server's, and the policies version is kept.
2. A sign-up without it, or with `"true"`, `1` or a missing value, writes `confirmed` false. The sign-up still succeeds.
3. Bad or oversized values (the version, the time) never fail a sign-up. They are trimmed or left out.
4. Editing the sign-up data afterwards (`updateUser`) changes nothing in the record.
5. `age.status` answers for the signed-in owner only. `age.confirm` adds one `reconfirm` row, answers `already_confirmed` the second time, and refuses anyone who is not signed in.
6. Closure: no client role can read, insert, update or delete a row. The service role cannot update or delete one.
7. The export carries `ageConfirmation`. Deleting the account removes the rows (export-parity and account-deletion gates).
8. `handle_new_user` is unchanged (`test:identity`). Sign-up still creates the customer and the profile.
9. The trigger runs once per account, and the two triggers do not depend on each other's order.
10. A negative control: without the trigger, checks 1 to 3 fail.

**Not testable here:** the hosted auth service's own behaviour (the trigger is checked on the local stack's stand-in), and counsel's view.

## 9. What approval would unlock, and what it would not

- **Unlocks (local only):**
  - migration **044** (043 is the Verified Tap fixes; 042 is reserved by the Admin APK session);
  - the two `/api/account` operations;
  - contract v0.17;
  - `test:age-gate`.
- **Does not unlock:**
  - applying anything to a hosted database;
  - the Terms and Privacy wording (counsel);
  - Session B's strings (its own gate);
  - option C's enforcement unless chosen.

## 10. Not affected

- `/t/` and every public page.
- The cards and the Verified Tap.
- The admin functions and their frozen outputs.
- `handle_new_user`.
- Phone verification (039).
- Student mode and any under-18 design, which is a later decision with parental consent and counsel (F-26).

## 11. As built (2026-11-14, local)

**Approval** [OBSERVED in session, 2026-11-14]: the owner answered "Approve the build" to "Approve building DEC-2026-048 on the recommended answers (Q1–Q5, option A)?". So:
- Q1: the record as proposed;
- Q2: option A (record and prompt; the database never refuses a sign-up);
- Q3: the accounts without a confirmation are asked once;
- Q4: a self-declaration only;
- Q5: the export shows the confirmation.

**Built:**
- **Migration 044:**
  - `account_age_confirmations`: closed; the service role may only SELECT and INSERT; one `signup` row per account (a partial unique index);
  - `record_signup_age_confirmation()` on a second AFTER INSERT trigger on `auth.users`, which never fails a sign-up. `handle_new_user` is untouched;
  - `account_age_status` and `account_age_confirm` (service only). `account_age_confirm` holds an advisory lock per account, so two confirmations write one row;
  - `account_export_build` (from 041's text) gains `ageConfirmation`. The rollback restores 041's text verbatim.
- **`/api/account`:** `age.status` and `age.confirm` (`adult` must be the JSON value true).
- **Contract AAROH-API v0.17** (§4c).
- **`test:age-gate`:** 11 checks, in `ci` and `ci.yml`.
- **The gates:** the export-parity map, the RLS matrix and the admin-contract relations now include the table.

**Evidence** [OBSERVED, Node 20.18.0]: the readiness report §31.

**Not built:**
- Session B's boxes and prompt;
- counsel's wording;
- option C's enforcement (not chosen).
