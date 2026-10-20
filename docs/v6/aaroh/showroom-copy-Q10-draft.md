# DRAFT for owner approval: AAROH customer wording for Emergency and Return to owner (DEC-2026-038 Q10)

Status: **PROPOSED**. Nothing here is shipped.

- Until the owner approves it, both features keep the customer word **"Coming soon"** wherever a customer can read it.
- The store's current emergency line, "Highly sensitive: nothing like it is stored today" (`src/data/aarohProduct.ts`, `AAROH_SHOWCASE`), becomes untrue once 029 is deployed. It must be replaced in the same release that deploys 029.

Every sentence below describes behaviour that exists in AAROH-API v0.3 and is covered by `test:emergency` (44), `test:rescue` (18) and this branch's component and e2e tests. The wording deliberately avoids implying delivery, emergency-service dispatch or identity.

## 1. Store showcase (`AAROH_SHOWCASE`): replacement entries

### Emergency contacts and alerts (replaces "Emergency information")

| Field | Proposed text |
|---|---|
| name | Emergency contacts and alerts |
| benefit | Alert the people you trust, in one press. |
| useCase | You add up to five people and confirm their numbers. If you need help, one press in your SHYGON account texts them that you have asked for help. |
| ownerControls | Add, confirm and remove contacts, send an alert and see what happened to each message, from your SHYGON account. |
| privacy | Your contacts’ numbers stay on SHYGON’s server and are never shown on your public profile. SHYGON does not contact emergency services: in an emergency, call 112. |
| status after deployment | `setup` (“Available after setup”), and only once a text-message provider is live in production. Until then: `future`. |

**Not proposed for the store yet.** Alerts sent by someone who taps the card stay off in production (Q2 = B), so the store does not mention them.

### Return to owner

| Field | Proposed text |
|---|---|
| benefit | Help a finder give your card back, privately. |
| useCase | Someone finds your card, taps it and sends you a message through SHYGON. You reply from your account. They never see your number or email. |
| ownerControls | Turn it on or off, add a short note for finders, then reply, close, block or report, from your SHYGON account. |
| privacy | Finders see only what you write, and you see only what they write. Links are removed from every message. Conversations are deleted 90 days after they close. |
| status after deployment | `setup`, once `RESCUE_RELAY` is on in production. Until then: `future`. |

## 2. Showroom (a real Tap): shown only when the server says the feature is on

| Card | Proposed text (already in the build, behind the server switch) |
|---|---|
| Emergency | “Alert the owner’s emergency contacts. You will not see who they are. SHYGON never contacts emergency services.” Action: **Alert their contacts** |
| Return to owner | “Found this card? Message the owner through SHYGON. You will not see their details.” Action: **Message the owner** |

## 2a. SHYGON Connect (DEC-2026-039 approved; wording awaits approval)

| Where | Proposed text (in the build; reachable only once the owner of a Tap turns Connect on) |
|---|---|
| Showroom card | “Share your details with <name>, with consent. You need a SHYGON account.” Action: **Ask to connect** |
| Request page | “Share your details with consent. You choose exactly what they see.” Fields: mobile number, email, company, job title, “marked as self-reported”. “You can stop sharing at any time. Removing stops them seeing your details from now on. Details they already copied or saved cannot be un-shared.” |
| Owner opt-in | “Let people who tap your card ask to connect. Only signed-in SHYGON accounts can ask, and each request says what they share. You choose what to share back, if anything.” |
| Store showcase | Connect stays **Planned** until this wording is approved and 032 is deployed. |

## 3. Status words (owner-approved vocabulary)

Available · Available after setup · Plan-gated · Coming soon · Unsupported · Demo. “Live” is never used for customers.

**Decision needed:** approve, edit or reject sections 1 and 2.
