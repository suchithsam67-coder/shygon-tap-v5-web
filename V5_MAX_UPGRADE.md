# Shygon Tap V5 — Max Customer Experience

This build pushes the customer website toward a premium commerce flow: product detail views, live Digital UI previews, persistent configuration, dashboard continuation after login, desktop/mobile selection dock, richer account shortcuts, and clearer checkout progression.

## Customer journey
1. Browse card collection
2. Open product details and material images
3. Build a card configuration
4. Select a Digital UI and immediately preview that exact experience
5. Continue to order
6. Login/signup if needed
7. Return to dashboard with the saved configuration
8. Continue to checkout
9. Complete payment

No fake reviews, sales numbers, delivery promises, or invented social proof were added.

## Final hardening
- Active seasonal event styling is a platform override applied to every experience while the event is live; the customer's saved theme remains the base theme and returns automatically when the event ends.
- The 14-day profile-edit window is enforced in the database and does not rely on UI state.
- Paid fulfilment retries are idempotent for entitlements, cards and physical-card inventory.
- Returning customers are sent to the dashboard after authentication, with their unfinished selection available to continue or replace.
