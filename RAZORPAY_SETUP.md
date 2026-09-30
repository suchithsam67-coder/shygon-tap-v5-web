# Razorpay setup

Secret values are never written in this repository, in code or in docs. Every
server-side function reads them from its own runtime's environment by name, and
refuses to run (HTTP 503) if one is missing rather than falling back to anything.

## Where each variable lives

Two different runtimes use Razorpay, and **each reads only its own environment**.
A value set in one is invisible to the other.

| Variable | Netlify → Environment variables | Supabase → Edge Function Secrets | Browser build |
|---|---|---|---|
| `RAZORPAY_KEY_ID` | **required** — checkout | **required** — refunds | — |
| `RAZORPAY_KEY_SECRET` | **required** — checkout | **required** — refunds | — |
| `RAZORPAY_WEBHOOK_SECRET` | **required** — webhook | not used | — |
| `SUPABASE_URL` | **required** | injected by Supabase | — |
| `SUPABASE_SERVICE_ROLE_KEY` | **required** | injected by Supabase | — |
| `VITE_RAZORPAY_KEY_ID` | set at build time | — | public by design |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | set at build time | — | public by design |

Which code reads what:

| Runtime | Function | Reads |
|---|---|---|
| Netlify | `netlify/functions/create-order.mjs` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Netlify | `netlify/functions/verify-payment.mjs` | `RAZORPAY_KEY_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Netlify | `netlify/functions/razorpay-webhook.mjs` | `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Supabase | `supabase/functions/admin-refund` | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` (plus the two injected) |

**If the Razorpay secrets are set only in Supabase, customer checkout returns 503
"Payments are not configured" for everyone.** The customer payment functions run
on Netlify. Moving them to Supabase Edge Functions — so the secrets live in one
place — is possible, but it is a rewrite of the payment backend, not a
configuration change.

Never give any of these a `VITE_` prefix. Vite compiles every `VITE_*` value into
the JavaScript that ships to visitors.

`RAZORPAY_WEBHOOK_SECRET` is not the API key secret. It is the separate value you
choose when creating the webhook in the Razorpay dashboard.

## Setting them

Netlify: *Site configuration → Environment variables*, then redeploy.

Supabase:

```bash
supabase secrets set RAZORPAY_KEY_ID=...
supabase secrets set RAZORPAY_KEY_SECRET=...
supabase functions deploy admin-refund
```

## The webhook

In the Razorpay dashboard, *Settings → Webhooks*:

- URL: `https://<your-site>/api/razorpay-webhook` (`netlify.toml` maps `/api/*`
  to the functions)
- Events: `payment.captured`, `order.paid`, `payment.failed`
- Secret: the value you set as `RAZORPAY_WEBHOOK_SECRET` in Netlify

## The flow

The browser states what it wants to buy. It never decides a price, and it never
marks anything paid.

1. The signed-in customer submits an **intent** — which card, material, finish,
   experience, quantity — to `POST /api/create-order` with their session token.
2. `create-order` prices every line from the `products` table, checks stock,
   creates the Razorpay order, and writes the SHYGON order (`payment_status =
   'pending'`) and its line items, linked by `razorpay_order_id`.
3. Razorpay Checkout opens with the order id and key id the server returned.
4. On success, the browser posts Razorpay's three callback fields to
   `POST /api/verify-payment`. The server recomputes the HMAC over
   `order_id|payment_id` with `RAZORPAY_KEY_SECRET`, compares it in constant
   time, confirms the order belongs to this customer, then fulfils it.
5. Independently, Razorpay calls `POST /api/razorpay-webhook`. Its HMAC over the
   raw body is mandatory, and each event is claimed once in `webhook_events`, so
   a redelivery is recognised and acknowledged.
6. Both paths call the same fulfilment, which only one of them can win, so a
   customer who closes the tab still gets what they paid for, and nothing is
   granted twice.

A cancelled or failed payment never grants anything. A database trigger refuses
any attempt by a browser session to mark an order paid.

## Local development

`npm run dev` serves the site only — it does not run Netlify Functions, so
`/api/*` will not respond. Use `npx netlify dev` for the full flow, with the
variables above in a local `.env`, which is gitignored.

The security tests do **not** need real secrets. `netlify/tests/functions-security.mjs`
generates throwaway values for every Razorpay variable on each run and never reads
a secret from `.env`:

```bash
node netlify/tests/functions-security.mjs .
```
