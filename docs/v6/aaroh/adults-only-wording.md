# Adults-only gate (V01 T-13): the strings, for the owner's gate and counsel

Session B (frontend). Built 2026-11-10 and parked while the founder decided; the founder chose F-26, "Option A: 18+ now" (2026-11-12, relayed by the coordinator), and the server-side record is AAROH-API v0.17 §4c (DEC-2026-048, migration 044). Wired 2026-11-14. **All of it is a draft.** The owner approves the product strings at this gate; counsel (F-23) approves the Terms and Privacy wording before release.

## Sign-up (`/shygontap/auth`)

| Where | Text | Before |
|---|---|---|
| First box (required, never pre-ticked) | I am 18 or older. | part of one combined box |
| Second box (required, never pre-ticked) | I agree to the Terms and Conditions and Privacy Policy. | "I am 18 or older and I agree to the …" |
| If the age box is skipped (only reachable when the browser's own check is bypassed) | Please confirm you are 18 or older. SHYGON Tap is for adults only. | one combined message |
| If the Terms box is skipped (likewise) | Please agree to the Terms and Conditions and the Privacy Policy. | one combined message |

What the account records: the sign-up sends `adult_confirmed: true` (the JSON value true), `adult_confirmed_at` (the browser's time, kept for information) and `policies_version` (`LEGAL.lastUpdated`). The database records the confirmation once, with its own time, when the account is created (044); later edits of the sign-up data change nothing. `age.status` then says `source: 'signup'`.

## The one-time prompt (any signed-in page, for an account with no confirmation on record)

Accounts made before the gate (the six live accounts, DEC-2026-048 Q3) have no record. The first signed-in page asks once; `age.confirm { adult: true, policiesVersion }` records it with the server's time (`source: 'reconfirm'`). Nothing else is asked: no date of birth. The page behind cannot be used until the box is ticked and confirmed; signing out is always possible. A reset-password visit is not interrupted.

| Where | Text |
|---|---|
| Title | Confirm your age |
| Body | SHYGON Tap is for adults only. Before you continue, please confirm that you are 18 or older. We record your answer once, with the date. |
| Box (required, never pre-ticked) | I am 18 or older. |
| Note | If you are under 18, please do not use SHYGON Tap. Sign out, and write to (the contact email) to close your account. |
| Buttons | Sign out / Confirm / Saving… |
| Save failed | We could not save your confirmation. Please try again. |
| Session lapsed / offline | Your session has expired. Sign in again. / You are offline. Reconnect and try again. (existing) |

`already_confirmed` (another tab confirmed first) closes the prompt with no message. A failed status read shows nothing and asks again on the next page.

## Terms and Conditions, "Who can use SHYGON Tap" (added paragraph)

> SHYGON Tap and AAROH cards are for adults only. When you create an account (or, for an account made before we asked, the next time you sign in), you confirm that you are 18 or older, and we record that confirmation and when you gave it. Do not create an account for anyone under 18. If we learn that an account belongs to someone under 18, we will close it and delete its data as our Privacy Policy describes.

## Privacy Policy, "Children" (added sentence)

> When you create an account (or, for an account made before we asked, the next time you sign in), we record that you confirmed you are 18 or older, and when.

The owner's data export (§4a) now carries `ageConfirmation` (`confirmed`, `at`, `source`, `policiesVersion`), so the account holder can see what was recorded.

## Questions

- **Q-A1.** Approve the four sign-up strings.
- **Q-A2.** Counsel: the Terms paragraph and the Privacy sentence.
- **Q-A3.** When counsel approves, change `LEGAL.lastUpdated` (`src/data/legal.ts`, now "29 September 2026"). Every confirmation records that date as `policies_version`, so it must move with the wording.
- **Q-A4.** Answered by v0.17: accounts from before the gate are asked once, at their next sign-in (the prompt above).
- **Q-A5.** Approve the prompt's strings, including the under-18 note that names the contact email.
- **Q-A6.** The prompt blocks the account until it is confirmed (signing out stays possible). Keep it blocking, or let the owner close it and ask again next time?
