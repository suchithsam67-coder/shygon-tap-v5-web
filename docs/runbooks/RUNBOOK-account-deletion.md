# RUNBOOK: deleting a customer's account (V6-072)

> **Status:** prepared 2026-10-10 for SHYGON V6 (DEC-2026-035, Stage 4). The procedure is proven on a local copy of the live schema (`supabase/tests/account-deletion.mjs`) and has **never been run on production**. Running it is the owner's decision for each request (D-12).
> **Irreversible.** Confirm a backup or a point-in-time-recovery window before step 4. Never paste a customer's personal data into chat, tickets, commit messages or logs. Use the account id and the request reference.

## What the customer was promised

The Privacy Policy (`/shygontap/privacy-policy`, "How long we keep it" and "Your rights") says:

| Data | What happens |
|---|---|
| Account, profile and Tap data | Deleted **within 30 days** of the request |
| Tap visit statistics | Deleted with the account |
| Support conversations | Deleted with the account, unless needed for an open dispute |
| Orders, invoices and payment records | **Kept** for as long as Indian tax and company law requires (up to 8 years), then deleted |
| Server logs | Kept briefly by the hosting providers, for security |

The customer can download a copy of their data at any time (Settings → Your data → Download your data).

## 1. Receive the request

- **In the app** (Settings → "Ask us to delete your account"). This opens a support ticket in the `privacy` category with the subject "Account deletion request" and a reference such as `ST-1A2B3C4D`. It comes from the signed-in account, so it is the account holder's own request. Asking twice reuses the open ticket.
- **By email** to the grievance address. It must come from the address on the account (Privacy Policy, "Your rights"). If it does not, reply asking them to send it from that address, or from Settings while signed in. Record an accepted email request as a `privacy` ticket on the account, so step 4 has a reference.

The 30-day clock starts when the request is received. Note the date.

## 2. Check before deleting

1. **Who:** note the account id (`auth.users.id`) and the account email. You need the email for the confirmation in step 6, and step 5 removes it.
2. **Administrators:** if the account is in `admin_users`, stop. An administrator is removed by the owner through the admin access process, not this runbook. The procedure refuses administrators.
3. **Orders in progress:** an order whose fulfilment is `processing` or `retry` must be finished or refunded first. The procedure refuses until it is.
4. **Disputes:** check Razorpay for an open refund, dispute or chargeback on the customer's payments, and Support for an open complaint. If there is one, tell the customer that deletion waits until it is resolved. The support conversation about it is kept until then.
5. **Their copy:** remind the customer they can download their data first (Settings → Your data).

## 3. Tell the customer what will happen

Reply on the ticket, and by email to the account address:
- what will be deleted and what is kept, and why (the table above);
- that they will no longer be able to sign in;
- that their Tap address and QR code will stop working. See the known limitation O-17 below.

## 4. Delete the account's data (public schema)

1. Open `docs/runbooks/account-deletion.sql`.
2. Replace `'<ACCOUNT ID>'` with the account id and `'<REQUEST REFERENCE>'` with the ticket reference.
3. With the owner's go-ahead for this request, run it once in the Supabase SQL editor.

It is a single statement: it does everything or nothing. It refuses, and changes nothing, if a placeholder is still there, the account does not exist, it is an administrator, the reference is not a `privacy` ticket of that account, or an order is still being fulfilled.

When it succeeds it reports what it did, for example: `deleted 1 Tap(s), 1 profile(s), … orders and payments kept`.

| Deleted | Kept |
|---|---|
| the Tap and its visit statistics (`tap_profiles`, `tap_events`), the profile, the customer record and its customisations, entitlements, notifications, card one-time codes, account events, support conversations (this request included); where migration 029 is applied, the emergency contacts, settings, verification codes, alerts with their recipients and delivery attempts, and the emergency audit trail; where 031 is applied, the Return-to-Owner settings, conversations and messages, blocks and audit trail | orders, order items, payments, order status history, Razorpay webhook records. A card is kept as a hardware record, unlinked from the account and retired, so it opens nothing |

## 5. The sign-in (auth.users)

- **The account has no orders:** Supabase dashboard → Authentication → Users → the account → **Delete user**.
- **The account has orders** (most paying customers): **do not delete the user.** Since migration 026 the delete fails rather than destroying the order and payment records. Before 026 it silently deleted them: never use "Delete user" on a live project that does not have 026 yet. Anonymise the sign-in instead, from a trusted machine, with the Supabase Admin API (`auth.admin.updateUserById`):
  - `email` → `deleted+<account id>@deleted.invalid`
  - `phone` → empty
  - `user_metadata` → `{}`
  - `ban_duration` → `876000h` (the account can no longer sign in or refresh a session)

  Then, in the SQL editor, check that no identity still holds the old address. Delete any row that does:
  `SELECT provider, identity_data->>'email' FROM auth.identities WHERE user_id = '<account id>';`

  The orders keep the account id, which no longer leads to a person. When the retention period for the last order ends, delete the orders, then the user.

Step 5 runs against Supabase Auth's own tables, which the local stack does not reproduce, so it is not covered by the local test. Follow Supabase's documentation for the Admin API.

## 6. Confirm and record

1. Email the customer, at the address noted in step 2, that the deletion is done, and what was kept and why.
2. Record the request reference, the dates (received, done), what was deleted and what was kept, in the deletion register (**D-12: the owner decides where it lives**). The ticket itself was deleted in step 4, so the register is the proof.
3. Discard any note of the email address once the confirmation is sent.

## Known limitations (open)

- **O-17, a deleted Tap's address can be claimed again.** Nothing reserves a deleted address. Another customer could later claim the same address with `claim_tap_slug`, and links or QR codes the deleted customer shared would then open that person's Tap. Reserving deleted addresses means keeping them, and they often contain a name. That trade-off is the owner's decision.
- **Self-service and admin-app deletion** do not exist. Deletion is this manual runbook (D-12).
- **Backups:** deleted data persists in Supabase backups until they expire. State this if the customer asks.

## Owner decisions this runbook needs (D-12)

1. Confirm the procedure: anonymise rather than delete a sign-in that has orders, and apply migration 026 so the dashboard delete cannot destroy order and payment records.
2. Where the deletion register lives, and who may run step 4 and step 5.
3. Whether to reserve deleted Tap addresses (O-17).
