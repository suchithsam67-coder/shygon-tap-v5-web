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

> **`supabase/APPLY_ALL.sql` contains only the migrations from 020 onward** (SHYGON V6,
> V6-040). The 001–019 history is no longer bundled and must never be replayed on live
> (`docs/governance/SCHEMA_DRIFT_REPORT.md`). Even so, apply nothing from it except at the
> human production gate: each migration needs its VERIFY ON LIVE queries and its
> DEC-2026-018 approval first. `npm run db:bundle` regenerates it, and CI fails if it is stale.

Run `db:apply` and `db:verify` after changing anything under
`supabase/migrations/`.

## The local stack and the test suites (SHYGON V6)

`supabase/local/` runs the whole product on this machine with no Docker and no
production value (decision D-4): the live schema on a local Postgres (PGlite), a
Supabase-compatible gateway (the REST and Auth calls the app makes), the real
server functions, and a Razorpay stand-in. Every key is generated locally, no
`.env` is read, and nothing leaves the machine.

```bash
npm run stack               # build the site against the stack and serve it on http://127.0.0.1:4173
npm run test:payment-chain  # checkout → payment → webhook → fulfilment → entitlement, every failure path
npm run test:public-tap     # Tap lifecycle, the six public states, field privacy, analytics
npm run test:components     # the public Tap page in every state (Vitest + Testing Library)
npm run test:e2e            # the three journeys in a real browser (Playwright; starts the stack itself)
npm run ci                  # every gate except the browser journeys
```

`test:e2e` drives the browser already installed (Edge by default; set
`E2E_BROWSER_CHANNEL=chrome` for Chrome), so nothing is downloaded.
