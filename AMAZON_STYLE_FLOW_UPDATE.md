# Shygon Tap V5 — Amazon-style customer flow update

## What changed
- After login/sign-up, customers now land on `/shygontap/account` (Customer Dashboard), not directly on checkout.
- The in-progress Shygon Tap selection remains stored in `localStorage` as `shygon_pending_order`.
- The dashboard shows the saved physical card image, material, finish, selected Digital UI, item prices and total.
- The dashboard provides **Continue to Checkout** and **Change selection** actions.
- The authentication screen now shows the saved card selection while the customer signs in, so the visual context is not lost.
- Clicking a Digital UI option in the main configurator now immediately opens that UI's live preview while also selecting it.
- Clicking **Select** in the Digital Experience section now selects the UI and opens its live preview.

## Flow
Home → Build Your Tap → choose card/material/finish/UI → live UI preview → Continue to Order → Login/Sign Up → Customer Dashboard → Continue to Checkout.

This preserves the existing V5 requirement that the customer account keeps the card, profile, orders and digital experience connected.
