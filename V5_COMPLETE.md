# SHYGON TAP V5 — Complete Build

This package contains the V5 customer web application plus the complete ordered Supabase migration set.

## Locked V5 behavior
- Customer authentication is required before purchase.
- Authentication returns to the customer dashboard; the saved purchase remains available there.
- A Tap is purchased once and its digital experience can be upgraded later without another physical card.
- Experiences: Essential, Business, Premium, GOAT.
- Customization Pass: lifetime editing + all colour palettes; it does not unlock paid experiences.
- Profile edits are limited to one content/theme edit every 14 days unless the Pass is owned.
- Paid tier/add-on ownership is enforced server-side; duplicate purchases are rejected.
- Event themes are automatic platform overrides while the event is active and apply to every experience; the customer base theme returns afterward.
- Public Tap rendering is server-clamped and does not expose private account/order fields.
- Physical-card inventory fulfilment is idempotent per order item, including retries.
- Payments are verified before fulfilment; incomplete fulfilment remains retryable.
- QR codes use the canonical Tap URL and mark QR visits for analytics.
