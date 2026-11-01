# Lost mode: every customer string, mapped to the real flow (for the owner's gate)

Session B (frontend), 2026-10-31. Lost mode is AAROH-API v0.10 §6 (migration 036, DEC-2026-041 amendment A-1). The wording comes from the coordinator's checked table (GPT-6, 2026-10-30), which replaces the contract's four draft strings. **Everything here is a draft**: the owner approves the exact strings at this gate. Nothing is released: `LOST_RELEASED` is false, Lost is off in the catalogue, and it needs `RESCUE_RELAY`.

Source column: **T** = the GPT-6 table as checked; **E** = the existing Return to Owner form, unchanged; **N** = new, written here because a state needed words the table does not give.

## Finder (the Lost page, `/t/<slug>` while the Tap is on Lost)

| State in the real flow | Text shown | Source |
|---|---|---|
| Page heading | Found this card? | T |
| Lead | This card is in Lost mode. This page only lets you send a private message to its owner. | T |
| The owner's own note (`public.status` `hint`, if they wrote one) | The owner’s note: “…” | E |
| Message box label | Your message (after a send: Write again) | T / E |
| Placeholder | Write a message (1–500 characters) | T |
| Counter | 0 / 500 | T |
| Notes under the box | The owner sees only what you write here. Do not include personal or sensitive details. · Links are removed automatically from messages. | T |
| Button | Send message (while sending: Sending…) | T |
| Sent (thread `open`) | Your message has been sent. | T (first sentence) |
| The saved-link note | Save this private link to return and check for replies. Your access ends 14 days after the last activity. **Anyone with the link can read this conversation.** | T + E (the last sentence is kept from the existing form: see Q-L1) |
| Buttons in a conversation | Check for a reply · Copy a link to this conversation / Link copied | E |
| Reply (thread `owner_replied`) | There is a reply. | T (first sentence) |
| 3 without a reply (`awaiting_owner`, or a thread with `canWrite` false) | You have sent 3 messages without a reply. You cannot send another right now. Check this link for a reply. | T |
| Empty after links were removed (`invalid_message`) | Enter a message before sending. | T |
| Too many (`rate_limited`) | You have sent too many messages. Please try again later. | T |
| Expired saved link (`thread_expired`) | Your access to this conversation has expired. This link can no longer be used. | T |
| Gone, blocked or reported (`thread_not_found`, `invalid_token`) | This conversation is not available. | T ("Blocked") |
| Closed (thread `closed`) | This conversation is closed. | T (first clause: see Q-L2) |
| Unavailable (`public.start` 404) | This service is not available right now. Please try again later. | T |
| No connection | We could not reach SHYGON. Check your connection and try again. | E |
| Lost but Return to Owner cannot take a message (`public.status` false) | Tap not found (the neutral page every unavailable Tap shows) | contract §6 |
| Tab title / description | Found this card? \| SHYGON Tap · This page only lets you send a private message to the owner of this card. (noindex) | N |
| Footer | Powered by SHYGON · Privacy | E (shortened) |

## Owner (`/shygontap/mode`)

| State | Text shown | Source |
|---|---|---|
| Mode entry | **Lost:** Let someone who finds your card message you privately. | T |
| Switch button | Switch to Lost mode | N |
| Needs Return to Owner (`needs_setup`, `missing: ['returnToOwner']`) | To use Lost mode, turn on Return to Owner first. + link **Open Return to Owner** | T (corrected by the coordinator) |
| Off (`not_available`: catalogue off or relay off), or refused by `mode_unavailable` | Lost mode is not available right now. SHYGON has switched it off. | T |
| Ready / showing | Ready to show · Showing on your Tap | E (Info's words) |
| Confirm | Switch this card to Lost mode? · Taps will show only a page where a finder can message you privately. Your profile stays hidden until you switch back. · Cancel · Yes, switch to Lost | T (body corrected by the coordinator) |
| Success | Your card is now in Lost mode. Taps show only the private message page. | T |
| Banner (Showing now) | Lost mode is on. Taps show only the private message page. | T |
| Where messages arrive (while Lost is on) | Messages from finders arrive on your Return to Owner page. + link **Open Return to Owner** | N |
| Back to Business | Switch back to Business? · Your card's Business profile will show when someone taps it. · Cancel · Switch to Business | T |
| Page description | Your Business profile, an Info page about a thing or a place, or Lost mode if your card is missing. | N |

## Table entries dropped, and why

| Table entry | Why it is not shown |
|---|---|
| Too long: "Messages can be up to 500 characters." | The box stops at 500 characters and the counter shows it, so this state cannot happen. |
| Reply: "Open this link to read it." / "View reply" | The finder is already on the conversation: the reply appears in it after "Check for a reply". There is no message or link sent to the finder. |
| Closed: "…because there has been no activity for 30 days." | A conversation also closes when the owner closes it, and the finder cannot tell which (§10a). Only "This conversation is closed." is true in both cases. |
| Owner unavailable: "Choose another mode" | The other modes are on the same page, just above. |

## Questions for the owner

- **Q-L1.** Keep "Anyone with the link can read this conversation." after the saved-link note? It is a safety fact from the existing form; the table's "private link" alone could suggest only the finder can open it. Recommended: keep.
- **Q-L2.** Closed: "This conversation is closed." only (recommended), as above.
- **Q-L3.** Show the owner's own note (`hint`) on the Lost page as on the Business page? It is the owner's text for finders (cleaned, links removed). The "never use" list rules out rewards; the owner could still write one there. Recommended: keep, since the owner chose it.
- **Q-L4.** Heading: "Found this card?" (recommended) or the alternative "Found this card? Message its owner privately."
- **Q-L5.** The four **N** strings above.
