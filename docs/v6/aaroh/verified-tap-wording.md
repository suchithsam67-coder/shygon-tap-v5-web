# Verified Tap (`/d/<code>`): every visitor string, for the owner's gate

Session B (frontend), 2026-11-05. V01 task T-07, AAROH-API v0.11 §10d (DEC-2026-043). **All of it is a draft**: the owner approves the exact strings at this gate. Nothing is released: while SHYGON has `VERIFIED_TAP` off, every check answers 404 and the visitor sees "Tap not found".

Source: **C** = the contract's wording (DEC-2026-043 Q4, option 2); **E** = existing public Tap copy, unchanged; **N** = new, written here.

## The verdict line (above the Tap's own page)

| Verdict | Shown | Source |
|---|---|---|
| `genuine` | Verified tap. This card's secure tap was accepted. · No. 037 of 100 (the number padded to the edition size's digits) | C |
| `already_checked` | We couldn't confirm this tap as new. Please tap the card again. | C |
| `not_confirmed` | We couldn't verify this tap. Please tap the card again or contact SHYGON support. | C |
| `needs_service` | This card needs service. Please contact SHYGON. | C |
| `unavailable` | Verification is temporarily unavailable. This tap hasn't been marked as verified. | C |
| `not_verified` (a QR, a typed or shared link) | no line: nothing about authenticity | C |
| `null` (the Tap is in Lost mode) | the Lost page, no line | C |

"Fake" and "counterfeit" are never used. A verdict the page does not know reads as `unavailable`, never as `genuine`.

## When the check gets no verdict

| Case | Shown | Source |
|---|---|---|
| Unknown card, switch off, Tap not live (404), or a malformed code | Tap not found · This Tap is not available. Check the link on your card, or ask the owner to share it again. | E |
| Too many checks (429) | Please try again later · This card has been checked many times in a short while. Try again in about 15 minutes. | N |
| Server failure (503) | Verification is temporarily unavailable · This tap hasn't been marked as verified. Please try again in a moment. · Try again | N (title from C) |
| Offline | You're offline · We couldn't check this card because your device has no connection. Reconnect and try again. · Try again | N |
| Other failure | We couldn't check this card · Something went wrong on our side. Please try again in a moment. · Try again | N |
| Link preview and tab title while checking | SHYGON Tap · A SHYGON Tap card. (not indexed) | N |

## Questions for the owner

- **Q-V1.** Approve the five **N** strings.
- **Q-V2.** The edition line: "No. 037 of 100" alone, as in the contract (recommended), or with the design name ("Obsidian · No. 037 of 100")? The server sends the design.
- **Q-V3.** A damaged link (only one of `e` / `c`, or the wrong length) is checked as a plain link, so it shows no line rather than "We couldn't verify this tap". Recommended as built: the chip always writes both, so only a mangled copy lacks one.
