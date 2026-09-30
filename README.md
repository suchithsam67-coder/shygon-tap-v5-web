# SHYGON TAP V5 — Customer Website

Customer-only e-commerce experience for Shygon Tap. This build is intentionally modeled around familiar large-store shopping patterns while keeping Shygon's own visual identity and content.

## Customer flow
Browse → Search → Product details → Configure card/material/finish → Select Digital UI → Live preview → Add to Cart / Buy Now → Login/Sign up → Dashboard → Continue order → Checkout → Razorpay → Orders.

## Included
- Commerce-style header, search, categories, account, orders and cart
- Persistent cart/order selection using localStorage
- Product detail gallery and material switching
- Live Digital UI previews for every tier
- Add to Cart and Buy Now actions
- Slide-out cart drawer
- Customer dashboard and saved-order continuation
- Supabase Auth integration
- Razorpay Standard Checkout backend functions
- Customer order tracking pages

## Local setup
1. Copy `.env.example` to `.env`.
2. Add your Supabase and Razorpay environment values.
3. Run `npm install`.
4. Run `npm run dev` for frontend-only development, or `npx netlify dev` when testing Netlify Functions.

Do not expose `RAZORPAY_KEY_SECRET` or webhook secrets to frontend variables.

## Database

The schema lives in `supabase/migrations/`, applied in numeric order.

```bash
npm run db:apply     # run every migration on a local Postgres (WASM) — no Docker
npm run db:verify    # 21 checks on the rules they enforce
npm run db:bundle    # regenerate supabase/APPLY_ALL.sql (all four, one paste)
npm run db:push      # apply to a real project (needs SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF)
```

Run `db:apply` and `db:verify` after changing anything under
`supabase/migrations/`. See PRODUCTION.md §5.
