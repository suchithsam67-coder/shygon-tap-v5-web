# Preview check runbook: P1 (address header) and P2 (Connect)

One page for the operator. Every value below is a placeholder: fill it in from
your own preview, never from chat, and never paste a token, an address or a
message text anywhere.

## 1. Prerequisites (all of them, from `preview-infrastructure-plan.md`)

- [ ] **AP-1** - deploy target decided (V6-043): `<netlify | vercel>` (or both, approved).
- [ ] **AP-2** - a dedicated non-production Supabase project exists and its ref is listed in `supabase/non-production-projects.json`, and it is **not** the production ref (compare refs, never keys).
- [ ] **AP-3** - migrations applied to it: baseline, 020-026 and 028-033, **without 027**. (034 and 035, Info mode and BQ-1, came after the plan was written: include them only if your AP-3 approval says so. P1 and P2 do not need them.)
- [ ] **AP-4** - a preview deployment exists at `<preview-url>` with access protection.
- [ ] **AP-5** - the preview-scoped settings from plan §3 are set by you in the provider dashboard: `TRUSTED_CLIENT_IP_HEADER=<x-nf-client-connection-ip | x-vercel-forwarded-for>`, `RESCUE_RELAY=on` (P1 preview only), `CONNECT_PUBLIC` unset to start, everything else as plan §3 says.
- [ ] **AP-6** - authorisation to run the P1/P2 requests against `<preview-url>` and to read the non-production database for the checks.
- [ ] Isolation checks (plan §4) done: only test accounts `*@example.test`, no customer data, no production webhook or callback pointing at the preview.
- [ ] Test fixtures: a published test Tap `<test-tap-slug>` whose owner switched **Return to Owner** on (P1), and four signed-in test accounts for P2:
  - the Tap owner;
  - a second account (the request, accept and remove journey);
  - a third account and a fourth (decline and block, run for real in phase on).

  The third and fourth cannot request this Tap again: decline has a 30-day cool-down and the block stays. Use fresh ones for every phase-on run.

## 2. Commands

```sh
# P1: four forged-address public.start requests (B-9 §6). RESCUE_RELAY=on,
# TRUSTED_CLIENT_IP_HEADER set, Return-to-Owner on for <test-tap-slug>.
P1_BASE_URL=<preview-url> \
P1_TAP_SLUG=<test-tap-slug> \
P1_HOST_LABEL=<netlify | vercel> \
node scripts/release/preview-p1-address.mjs

# P2 phase off: CONNECT_PUBLIC is UNSET on the host.
P2_BASE_URL=<preview-url> \
P2_OWNER_TOKEN=<owner-session-access-token> \
P2_VISITOR_TOKEN=<second-account-session-access-token> \
P2_TAP_SLUG=<test-tap-slug> \
P2_PHASE=off \
P2_HOST_LABEL=<netlify | vercel> \
node scripts/release/preview-p2-connect.mjs

# Now set CONNECT_PUBLIC=on in the preview settings and redeploy. Note the
# time: how long the change takes is R2 evidence. Then run phase on.
P2_BASE_URL=<preview-url> P2_OWNER_TOKEN=<owner-session-access-token> \
P2_VISITOR_TOKEN=<second-account-session-access-token> \
P2_DECLINE_TOKEN=<third-account-session-access-token> \
P2_BLOCK_TOKEN=<fourth-account-session-access-token> \
P2_TAP_SLUG=<test-tap-slug> P2_PHASE=on \
P2_HOST_LABEL=<netlify | vercel> \
node scripts/release/preview-p2-connect.mjs

# Finally set CONNECT_PUBLIC back to unset and redeploy.

# The runners' own test, local stack only (ports 4373 / 54521 by default; set
# STACK_APP_PORT and STACK_GATEWAY_PORT if another stack already uses them):
npm run test:preview-checks
```

Get each token by signing in on the preview yourself, and pass it only as an
environment variable. Every account must be `*@example.test`; the scripts
cannot verify that and print a reminder instead.

Hosted phase on runs decline and block for real. Without `P2_DECLINE_TOKEN` and
`P2_BLOCK_TOKEN` it stops as INCONCLUSIVE before anything is written. The
evidence records `declineAndBlock: "real"`.

**Exit codes (both scripts):** `0` PASS, `1` FAIL, `2` INCONCLUSIVE, `3`
refused (production host, non-https host or bad input - refused before any
request).

## 3. What the verdicts mean

| | PASS | FAIL | INCONCLUSIVE |
|---|---|---|---|
| **P1** | 201, 201, 201, then `rate_limited`: one finder, so the forged address headers were ignored. | all four 201: the host forwarded a visitor's forged header. Keep both public switches off and report it (B-9 §6). | anything else: relay unavailable, a limit already used, 401/5xx, and the reason in the evidence. |
| **P2** | every check matched §11.2 for that phase (phase on: decline and block for real). | a documented behaviour contradicted: a locked operation worked while off, an unlocked one was locked, or the journey broke while on. | the host's `CONNECT_PUBLIC` disagrees with `P2_PHASE`, a token was refused (401), the host answered 5xx, or a hosted phase on lacks the decline and block accounts (or they were used before). No check was run. |

## 4. Evidence: what to record and where

Each run prints **one JSON object**: host label, base URL origin, timestamp,
the outcomes and the verdict (P2: every check, plus a database checklist). It
never contains a token, a finder token, message text, a shared value or any
address.

1. Paste the P1 JSON into the **P1** section of the release readiness report
   (`B-10_release-readiness.md` §11.1), through the Coordinator, with the
   preview URL and the deploy time.
2. Paste both P2 JSON objects into the **P2** section (`§11.2`), with the time
   the `CONNECT_PUBLIC` change took to apply (R2).
3. For P2 phase on, work through the printed `[ ]` checklist **in the
   non-production database** (read-only): every grant on the removed
   connection is revoked, and no row was added by a refused call. Record the
   result next to the evidence. The scripts never connect to a database.
4. Keep any logs sanitised: no tokens, no message text, no addresses.

## 5. Never

- Never aim a script at production: both refuse `shygontech.com` and every
  subdomain before sending anything.
- Never deploy, push, or change provider settings from this runbook: those are
  AP-4/AP-5 actions by the owner.
- Never turn `RESCUE_RELAY` or `CONNECT_PUBLIC` on outside the preview.
