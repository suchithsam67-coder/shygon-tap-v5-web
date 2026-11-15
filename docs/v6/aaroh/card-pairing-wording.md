# Tap to activate and Report stolen (V01 T-08/T-09): the strings, for the owner's gate

Session B (frontend), 2026-11-15. AAROH-API v0.15 §10d and §7 C-6 to C-8 (DEC-2026-047, approved for the local build 2026-11-10). **All of it is a draft**: the owner approves the strings at this gate.

Every `/api/cards` refusal maps to our own sentence (`src/lib/cardWords.ts`); the server's message is never shown. Customer strings name no chip model.

## `/d/<code>` for a card that is not active yet

The page never shows the owner's Tap for such a card. Only a genuine tap can activate it, and only for the card's owner, signed in on that phone.

| Where | Text |
|---|---|
| Title (every case) | This card isn't active yet |
| Reading the account | Checking your account… |
| Genuine tap, signed out | If it's your card, sign in to SHYGON on this phone, then tap the card again to activate it. (Sign in) |
| Genuine tap, the owner signed in | This card is on your account. Activate it to make it open your Tap. (Activate this card / Activating…) |
| Done | Card activated / Tap it again to open your Tap. (Your cards) |
| Signed in with another account | This card is not on the account you are signed in with. Sign in with the account that ordered it, then tap the card again. |
| A plain link (no chip values) | To activate it, sign in to SHYGON on your phone, then tap the card on the phone. |
| Not new (`already_checked`) | We couldn't confirm this tap as new. Tap the card again to activate it. |
| Not confirmed | We couldn't verify this tap. Tap the card again, or contact SHYGON support. |
| Needs service | This card needs service. Please contact SHYGON. |
| Unavailable | Verification is temporarily unavailable, so the card can't be activated right now. Please try again in a moment. |

## The refusals (C-7, C-8)

| Code | Text |
|---|---|
| `proof_expired` (410) | That tap has expired. Tap the card again. |
| `invalid_proof`, `proof_used` | Tap the card again to activate it. |
| `proof_mismatch`, `card_not_found` | This card is not on the account you are signed in with. Sign in with the account that ordered it, then tap the card again. |
| `already_active` | This card is already active. Tap it again to open your Tap. |
| `card_retired` | This card has been switched off. Contact SHYGON support. |
| `not_pairable` | This card cannot be activated here. Contact SHYGON support. |
| `not_registered` | This card has no secure chip. Activate it from Your cards with a one-time code. |
| session lapsed / offline / anything else | Your session has expired. Sign in again. / You are offline. Reconnect and try again. / Something went wrong. Please try again. |

## Your cards (`/shygontap/cards`)

| Where | Text | Before |
|---|---|---|
| Page description | Activate your NFC cards, and report one stolen. A card with a secure chip is activated by tapping it; any other card with a one-time code sent to your verified mobile number. | "Activate or deactivate your NFC card. Every change is confirmed with a one-time code sent to your registered mobile number." |
| Tag on a card with a chip | Secure chip | new |
| Status after Report stolen | Switched off | new |
| Card with a chip, not active | To activate it, sign in to SHYGON on your phone, then tap the card on the phone. | "Activate it to make your Tap open when the card is tapped." |
| Card with a chip, active | Active since 14 Nov 2026 (no expiry: AAROH cards do not expire, Q6) | "Active until …" |
| Card with a chip, switched off by support or the admin app | Switched off. Contact SHYGON support to turn it back on. | new |
| Reported stolen, with a chip | Reported stolen on 14 Nov 2026. It opens nothing. Contact SHYGON support for a replacement. | new |
| Reported stolen, without a chip | Reported stolen on 14 Nov 2026. It has no secure chip, so tapping it still opens your Tap. | new |
| Button | Report stolen | new |
| Dialog title | Report this card stolen? | new |
| Dialog, card with a chip | It is switched off for good: tapping it will open nothing. Only SHYGON support can undo this, with a replacement card. | new |
| Dialog, card without a chip | It is switched off for good. This card has no secure chip, so tapping it will still open your Tap: to protect your Tap, pause it in Settings (or switch it to Lost mode, once Lost mode is released). Only SHYGON support can undo this. | new |
| Dialog button | Switch it off for good | new |
| Toast, done | Card switched off / Tapping it now opens nothing. (without a chip: It still opens your Tap: pause your Tap in Settings to stop that.) | new |
| Toast, refused | Could not switch the card off / (our refusal words) | new |
| Empty state | Your card appears here once your order is prepared. You can then activate it. | "…activate it with a one-time code." |
| Footnote | Stolen? Report it here. A card with a secure chip then opens nothing. A card without one keeps opening your Tap's address, so also pause your Tap in Settings. (Once released:) Lost it, and hoping it comes back? Switch your Tap to Lost mode so a finder can return it. An activation with a code lasts 14 days; renew it any time. | "Lost your card? Deactivate it here straight away — tapping it will stop opening your Tap. An activation lasts 14 days; renew it any time." |

Each footnote sentence appears only when it applies (a card with a chip, a card without one, Lost mode released).

## Questions

- **Q-C1.** Approve the strings above.
- **Q-C2.** The old footnote said deactivating a card stops it opening the Tap. That was never true for a card without a chip: the Tap's address does not look at the card (DEC-2026-047, F3). The new footnote says so. Approve the correction.
- **Q-C3.** A card with a chip has no "Deactivate" here: once switched off it could not be turned back on by a tap (only pending or shipped cards pair), so only SHYGON support could undo it. The owner has "Report stolen" (for good) and, at the Tap, pausing or Lost mode. Keep it that way, or ask Session A for an owner "pause this card" that a tap can undo?
- **Q-C4 (for Session A, not the owner).** `owner.card.activate` takes the card's id, but a tap tells the page only the chip's code. The page tries the owner's cards that can still be paired, in turn; a wrong one is refused without using the proof. Would Session A accept the proof alone, the server finding the card from it?
