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
- their owner pages redirect to the AAROH experience page in a production build (Q-C, 2026-10-23); test and preview builds made with `VITE_AAROH_PREVIEW_PAGES=on` keep them reachable by address, for verification.

On a public Tap, a card appears only when the server's `public.status` says the feature is on. That is off in every environment today.

## 2. Status words (owner, 2026-10-20 §3)

Available · Setup required · Coming soon · Unavailable · Demo (for a labelled demonstration). "Live" is never used for customers.

**Q-B, approved 2026-10-23:** the store's other roadmap items (Student Passport, Event mode, Places and objects, Cloud storage, and the use case "Managing a team’s cards") read "Coming soon" too; "Planned" is no longer a status word.

## 3. Approved 2026-10-23 (Q-D, Q-F)

| Item | State |
|---|---|
| Privé demo wording (sample hotel, the demo notice, the services, the result) | **Approved as drafted (Q-F).** `PRIVE_DEMO` is on: the demo showroom only, never on a real Tap. The exact strings are in `frontend-decision-pack-2026-10-23.md` (Q-F); the six further strings flagged there were approved as drafted on 2026-10-24 |
| The real-Tap card notes under the three features ("Found this card? Message the owner through SHYGON. You will not see their details.", and the Emergency and Connect notes) | **Keep (Q-D).** Shown only when a feature's server switch is on |
