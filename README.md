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

The schema of record is the live baseline, `supabase/baseline/000_live_baseline.sql`
(DEC-2026-023). `supabase/migrations/001–019` are history: they were applied on live
and are **never re-applied**. New work starts at `020_`. See
`supabase/migrations/README.md`.

```bash
npm run db:apply     # live baseline + migrations 020+, on a local Postgres (WASM) — no Docker
npm run db:verify    # behaviour checks on that database
npm run db:push      # 020+ only, and only to a project on supabase/non-production-projects.json
```

> **Do not paste `supabase/APPLY_ALL.sql` into any Supabase SQL editor.** It bundles
> the 001–019 history; replaying it onto the live project changes dozens of objects and
> breaks sign-up (`docs/governance/SCHEMA_DRIFT_REPORT.md`). `npm run db:bundle` still
> regenerates it from the same history; that is unchanged until M0.4.

Run `db:apply` and `db:verify` after changing anything under
`supabase/migrations/`.
