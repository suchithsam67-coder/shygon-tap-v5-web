# AAROH customer wording: Emergency Profile, Return to Owner, SHYGON Connect (DEC-2026-038 Q10)

**Status: APPROVED by the owner on 2026-10-20** ("Frontend gate decisions" §1), for implementation. This is not production-release approval.

## 1. Approved wording (in the build)

| Feature | Title | Description | Availability shown |
|---|---|---|---|
| Emergency | **Emergency Profile** | Keep the emergency information you choose ready when it matters. You control what is stored and what may be shared. | **Coming soon** until the complete backend flow, permissions, contact handling and notification delivery are verified |
| Return to owner | **Return to Owner** | Lost something with SHYGON? Let the finder contact you through a privacy-conscious relay, without automatically exposing your personal contact details. | **Coming soon** until the real relay, owner notifications, abuse controls and failure handling are verified |
| Connect | **SHYGON Connect** | Build meaningful connections and exchange the information you choose to share. | **Coming soon** until the connection and consent workflows are verified |

Owner's rule: do not claim emergency-service dispatch, guaranteed message delivery, verified identity or live functionality unless the implemented system demonstrably supports it. Each feature's availability may change on its own once it passes its own backend and end-to-end checks.

Where the wording is used:
- the showroom registry `src/components/showroom/modes.ts` (`name`, `tagline`);
- the store showcase `src/data/aarohProduct.ts` for Emergency and Return (status word "Coming soon" through `statusLabel`);
- the owner pages' titles and descriptions (`EmergencySettings`, `ReturnToOwner`, `Connections`);
- the owner's "Your AAROH experience" panels.

`src/test/availability.test.tsx` checks every one of these against the exact approved text.

**Release switch.** `RELEASED` in `modes.ts` is false for all three:
- the account menu does not list them;
- the AAROH experience page shows "Coming soon" with nothing to press;
- their owner pages stay reachable by address, for verification on test systems.

On a public Tap, a card appears only when the server's `public.status` says the feature is on. That is off in every environment today.

## 2. Status words (owner, 2026-10-20 §3)

Available · Setup required · Coming soon · Unavailable · Demo (for a labelled demonstration). "Live" is never used for customers.

The store's other roadmap items (Student Passport, Event mode, Places and objects, Cloud storage) still use the store's earlier word "Planned". **Open question for the owner:** should they also read "Coming soon"?

## 3. Still awaiting approval

| Item | State |
|---|---|
| Privé demo wording (sample hotel, "SHYGON's demo desk", the demo notice) | Not yet approved. `PRIVE_DEMO` stays false |
| The real-Tap card notes under the three features (e.g. "Found this card? Message the owner through SHYGON…") | In the build behind server switches; shown only when a feature is on. Owner to confirm, or replace with the approved description alone |
