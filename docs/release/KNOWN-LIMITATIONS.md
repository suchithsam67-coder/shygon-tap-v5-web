# Known limitations (SHYGON V6 release candidate)

What the release candidate does not do, or does only partly, and why. Each item has an owner decision or a follow-up in `docs/v6/backlog.md`.

## Product

- **No physical cards are sold** (D-10, digital-first). The store and landing page show cards as "coming soon". Card records, activation by OTP and limited editions remain for customers who already have a card. The card release items (V6-003, V6-011, V6-019, V6-034, V6-035) are deferred.
- **No email channel** (V6-038): customers are notified in the dashboard, and by SMS once a provider is configured.
- **Account deletion is manual**: a request opens a privacy ticket and a person runs the tested runbook (D-12). There is no self-service delete.
- **A deleted Tap's address can be claimed again** (O-17 / V6-093), so old shared links and QR codes could later open someone else's Tap.
- **A new Tap starts with the login email as its public email** (D-11). The owner can hide it, and it is public only once the Tap is published.
- **The profile photo URL is not restricted to SHYGON's storage** (V6-096): an owner can point it at any host.
- **Per-Tap link previews** are not generated (V6-033): a shared `/t/` link previews with the site's general card until the page's script runs.
- **The company homepage** (`src/pages/Home.tsx` and its components) is not routed in this app (V6-098); `/` goes to `/shygontap`.

## Operations

- **Production has never been deployed from V6.** Migrations 020–026 and 028 are applied only locally, and the credentials are not rotated yet (B-1, B-2).
- **Live payments are off** (B-3). Everything is verified with Razorpay test keys and the local Razorpay stand-in.
- **CI has never run on a remote** (B-4: no GitHub repository yet). The full gate set runs locally (`npm run ci`, clean install), and the workflow is ready in `.github/workflows/ci.yml`.
- **No error-tracking provider, log drain or alerting.** The hooks and events exist (`docs/v6/observability.md`).
- **Storage policies are verified only on live** (V6-095): the local stack has no storage service.
- **Admin edge functions** log free text and allow any origin by CORS. They take bearer tokens, so this is not exploitable without a token (V6-044, V6-094).
- **Node 22** is the target runtime. The local verification ran on Node 20.18, where one payments check is blocked (V6-041). What it checks, verify-payment refusing a caller without a valid token, is proven on the local stack by `test:security`.

## Verification

- The end-to-end and performance checks run on the local stack (the real schema, the real functions, a Razorpay stand-in) and the installed Edge, not on the production hosts. Production-only behaviour (the hosts' CDN, Supabase Auth's own pages, real SMS, real Razorpay) is covered by `DEPLOYMENT.md` §5's smoke test.
- The secret-scan gate fails on one historical finding, `9c8caa7` (the Web3Forms key, public by design). Making the gate pass needs the owner's decision D-7.
- **A local run must not be suspended.** The public Tap analytics checks measure real time (the 10-second dedupe window). If the machine sleeps mid-run, the suite fails although nothing is wrong (Stage 6 incident, `docs/v6/stage-6-report.md` §2). Keep the machine awake for `npm run ci`. CI runners do not sleep.
