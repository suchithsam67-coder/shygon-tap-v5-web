# Verify your phone (V01 T-11): the strings, for the owner's gate

Session B (frontend), 2026-11-12. AAROH-API v0.13 §4b (DEC-2026-045, finding F4). **All of it is a draft**: the owner approves the strings at this gate. The text message itself is Session A's (`account.mjs` `phoneVerifyMessage`, to be registered on DLT, F-10) and is not part of this sheet.

Every server refusal maps to our own sentence in `src/lib/phoneVerification.ts`; the server's `message` is never shown on these pages.

## The page, `/shygontap/phone` (from Settings and from the card page)

| Where | Text | Source |
|---|---|---|
| Title | Verify your phone | new |
| Under the title | Codes for activating or deactivating your card are sent only to a verified mobile number. | new |
| Panel | Your mobile number / We text a one-time code to the number in your account details. | new |
| Not verified | (masked number) is not verified yet. We text a 6-digit code to this number to check it is yours. | new |
| Button | Send code / Send code in 40s | new |
| Code sent | Enter the 6-digit code we texted to (masked number). It expires in 10 minutes. | new, like the card dialog |
| Buttons | Verify / Checking… / Send a new code / Send a new code in 40s | new |
| Done | Your number is verified: (masked number) | new |
| Verified, on return | Verified: (masked number) | new |
| Verified, usable | Codes for activating or deactivating your card are sent to this number. | new |
| Verified, still waiting | For your security, a number that replaces a verified one can confirm card changes from 13 Nov, 4:05 pm. | new |
| Always, once verified | To use another number, change it in Settings, then verify it here. | new |
| No number | Add your mobile number in Settings first. We text the code to that number. (Open Settings) | new |
| Not a number we can text | The number in Settings is not a mobile number we can text. Check it in Settings. | new |
| Status read failed | Something went wrong. Please try again. (Try again) | existing words |
| Link under the panel | Back to your cards | new |

## The refusals (§4b)

| Code | Text |
|---|---|
| `verify_cooldown` (429) | Please wait 40 seconds before sending another code. |
| `verify_rate_limited` (429, five an hour) | You have asked for several codes in the last hour. Try again in about 20 minutes. |
| `number_rate_limited` (429, three a number a day) | This number has had three codes today. Try again in about 3 hours. |
| `sms_unavailable` (503) | We cannot send text messages yet, so no code was sent. Please try again later. |
| `sms_failed` (502) | We could not send the code. Please try again. |
| `invalid_code` (400) | Enter the 6-digit code. |
| `wrong_code` (400) | That code is not right. 3 tries left. (1 try left; no count when the server gives none) |
| `no_challenge` (410) | Send a new code first. |
| `code_expired` (410) | This code has expired. Send a new one. |
| `too_many_attempts` (429) | Too many wrong tries. Send a new code. |
| `phone_changed` (409) | Your number changed after the code was sent. Send a new code. |
| `no_phone` (409) | Add your mobile number in Settings first. (Open Settings) |
| `invalid_phone` (422) | The number in Settings is not a mobile number we can text. Check it in Settings. (Open Settings) |
| `already_verified` (409) | not shown: the page reads the status again and shows "Verified" |
| session lapsed (401) | Your session has expired. Sign in again. (existing) |
| offline | You are offline. Reconnect and try again. (existing) |

## Settings, "Mobile number"

| Where | Text | Source |
|---|---|---|
| Hint (changed) | One-time codes for activating or deactivating your card are sent to this number, once it is verified. | was: "…sent to this number." |
| Verified | Verified | new |
| Verified, still waiting | Verified. It can confirm card changes from 13 Nov, 4:05 pm. | new |
| Not verified | Not verified yet. Verify your phone | new |
| **Before saving a new number** (shown as soon as the field holds a different number, only when the current one is verified; reformatting the same number does not count) | Saving a new number removes the verification from your current one. You then verify the new number, and for your security it can confirm card changes 24 hours after that. | new |

## The card page

| Where | Text | Source |
|---|---|---|
| Note, number not verified | Verify your mobile number before you change a card: we send the one-time code only to a verified number. (Verify your phone) | new |
| Note, number still waiting | Your mobile number changed recently. For your security, it can confirm card changes from 13 Nov, 4:05 pm. | new |
| Dialog, `phone_not_verified` (409) | Verify your mobile number first. Codes for your card are sent only to a verified number. (Verify your phone) | new; the server's own text is not shown |
| Dialog, `phone_cooling_down` (409) | Your mobile number changed recently. For your security, it can confirm card changes from 13 Nov, 4:05 pm. | new; the time is now + `retryAfter` |

Times are shown in the viewer's own time zone, as "13 Nov, 4:05 pm" (`en-IN`).

## Questions

- **Q-P1.** Approve the strings above.
- **Q-P2.** The warning before saving a new number appears as the owner types, with no extra click. Keep it that way, or ask for a confirmation on Save?
- **Q-P3.** "This number has had three codes today" names the limit (three a number a day, §4b). Keep the number, or say "several codes" as the hourly limit does?
