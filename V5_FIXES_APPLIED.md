# SHYGON Tap V5 — fixes applied

Build: 1.0.1
Date: 2026-09-12

## Product/runtime fixes
- Customer editing now fails closed if the authoritative edit-state RPC cannot be read.
- The 14-day rolling edit rule is enforced by Supabase and now includes customer-selected visual theme changes.
- Phone and email are server-enforced as the built-in contact actions.
- Locked add-ons cannot be enabled or saved by a tampered client.
- Location & Directions is wired to the existing paid Location add-on.
- The retired Gallery add-on is no longer purchasable because the shipped editor/public renderer did not implement it.
- YouTube remains supported for legacy/public data but is no longer presented as a purchasable add-on that has no catalog SKU.
- The account editor refreshes its lock state after saves and automatically rechecks an expired cooldown while the page remains open.
- Theme customizer preview now applies the same active-event theme rules as the public renderer.
- Public profile data now carries active event metadata.

## Commerce/fulfilment fixes
- Digital experiences cannot be purchased again when the customer already owns the same or a higher experience.
- Customization add-ons cannot be purchased repeatedly after entitlement ownership exists.
- Checkout response now returns the human SHYGON order number rather than the internal database UUID as `shygonOrderId`.
- Payment fulfilment now has explicit pending/processing/retry/fulfilled state so a transient grant failure can be retried instead of permanently stranding a paid order.

## Supabase fixes
- Added the missing source-controlled seasonal event theme schema/function and seeded the 2026 event calendar.
- Event date selection uses Asia/Kolkata civil dates to avoid UTC midnight boundary bugs.
- Public profile event overrides remain constrained by the customer's purchased theme options.
- Public-facing SECURITY DEFINER RPCs are no longer exposed to the authenticated role when the anon role is the intended caller.
- RLS policies now wrap auth calls with statement-stable subqueries for better scale.
- Added fulfillment retry columns and indexes.

## Verification performed
- Live Supabase migration set applied successfully through migrations 005–008.
- Live database reports a 14-day edit interval, 19 active event-theme rows, 5 active customization add-ons, and 0 orders currently stuck in `retry`.
- Live event resolver returns Ganesh Chaturthi for the configured 2026-09-14 event date.
- Performance advisor no longer reports the previous auth-RLS initialization-plan warnings.
- Node syntax checks passed for the modified Netlify backend modules.
- Full frontend `npm ci`/build could not be completed in this environment because dependency installation timed out; the source tree itself is included with the fixes.
