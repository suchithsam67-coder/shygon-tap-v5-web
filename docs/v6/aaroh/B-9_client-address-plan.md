# B-9: The visitor address on the local stack, and which address header production trusts

| Field | Value |
|---|---|
| Requested by | Session B, 2026-10-20 (B-9) |
| Owner's direction, 2026-10-20 | "Authorise investigation and a local-development-only solution. Keep this separate from DEC-2026-041. Do not trust a client-supplied address header in production. Production must rely on correctly configured trusted proxy infrastructure." |
| Status | **Investigation done. Plan PROPOSED. Nothing changed.** Part A (local only) is ready to build on the owner's word. Part B touches production code, so it needs separate approval. |
| Backlog | V6-124 (Part A, local), V6-126 (Part B, production header trust) |

Labels: **OBSERVED** (verified in this repository), **INFERRED**, **UNKNOWN**, **PROPOSED**.

## 1. What happens today

**Production code: which header the functions trust** [OBSERVED]:
- `visitorDigest` (`netlify/lib/emergency.mjs:84–91`, for visitor emergency alerts) and `finderDigest` (`netlify/functions/rescue.mjs:80–87`, for Return-to-Owner finders) both read:

  ```
  x-nf-client-connection-ip  ??  x-vercel-forwarded-for  ??  x-real-ip
  ```

  They use the first comma-separated entry, and refuse with `unavailable` when no header is present (fail-closed).
- The order is the **same on every host**. The Vercel entry points (`api/emergency.mjs`, `api/rescue.mjs`) pass the request through unchanged, and nothing detects which host is running.
- These digests drive per-visitor limits and blocks:
  - visitor emergency alerts: 3 per day per visitor;
  - Return-to-Owner finders: 3 threads per hour and 10 per day, plus address blocks.
- Related and separate: `record_tap_event` takes the first `X-Forwarded-For` entry (V6-112, a frozen function).

**The local stack** [OBSERVED]:
- `supabase/local/app-host.mjs:117–125` copies every incoming header into the function's `Request` and adds none.
- So from a real browser on `npm run stack`, no address header arrives, and emergency `public.alert` and rescue `public.start` answer `unavailable` while `public.status` says `available: true`. That is Session B's report: the server is right, and the stand-in differs from the hosts.
- Session B's e2e works around it by sending `x-nf-client-connection-ip: 203.0.113.x` from the browser.
- The stack listens on `127.0.0.1` only (`supabase/local/stack.mjs:64`). The PostgREST gateway already adds `x-forwarded-for` from the socket (`gateway.mjs:100`).

## 2. A production finding (Part B)

[INFERRED; verify on preview deployments]

- On **Vercel**, the platform sets `x-vercel-forwarded-for` but not Netlify's `x-nf-client-connection-ip`.
- A visitor who **sends** `x-nf-client-connection-ip` themselves is read **first**, so they can pick any "address".
  - That would let one person get around the per-visitor limits on visitor emergency alerts and Return-to-Owner messages, and get around address blocks.
- On **Netlify**, the platform header is read first. Whether Netlify overwrites a client-supplied value is not verified: **UNKNOWN**.

**Exposure today: none** [OBSERVED]:
- migrations 029 and 031 are applied to no real database;
- both public switches are off (`EMERGENCY_PUBLIC_ALERTS` and `RESCUE_RELAY` unset);
- nothing V6 is deployed.

**Severity** [PROPOSED]: P1, to fix before either public switch is turned on in any deployed environment. It is not a live incident.

## 3. Plan

### Part A: local development only (authorised; ready to build)

**Change** [PROPOSED], in `supabase/local/app-host.mjs`, for every `/api/*` request:
1. **Remove** any client-supplied `x-nf-client-connection-ip`, `x-vercel-forwarded-for`, `x-real-ip` and `x-forwarded-for`.
2. **Set** `x-nf-client-connection-ip` from the socket address (`::ffff:127.0.0.1` normalised to `127.0.0.1`), the way Netlify's edge does.
3. **For e2e visitors that must look distinct:**
   - a test-only header, `x-shygon-sim-client`, is honoured **only** when the stack is started with `STACK_SIM_CLIENT_ADDRESS=1` and the caller is on loopback;
   - its value must be in a documentation range (`203.0.113.0/24` or `198.51.100.0/24`);
   - it is off by default.

   Session B's e2e moves its workaround to this header and sets the flag.

**Tests** (a local-stack check):
- no header → the host's socket address is used;
- a client-supplied `x-nf-client-connection-ip` is replaced;
- the sim header is ignored without the flag, and accepted with it only from loopback and only in a documentation range;
- the emergency and rescue public operations then work from a plain browser.

**Scope:**
- local stack files plus one test and the local-stack notes;
- **no file under `netlify/`, `api/` or `supabase/migrations/` changes;**
- the contract is unchanged.

### Part B: production header trust (needs separate approval)

**Change** [PROPOSED]:
- One shared `clientAddress(request)` in `netlify/lib`, used by both digests.
- It reads **only** the header named by a new host setting, `TRUSTED_CLIENT_IP_HEADER`:
  - `x-nf-client-connection-ip` on Netlify;
  - `x-vercel-forwarded-for` on Vercel.
- If the setting is unset, it **refuses** (fail-closed).
- It never falls through to another header, and never reads `X-Forwarded-For`.
- The local stack sets `TRUSTED_CLIENT_IP_HEADER=x-nf-client-connection-ip`. This is the "correctly configured trusted proxy infrastructure" the owner asked for: an explicit per-host setting, not a guess.

**Verification** (needs a preview deployment on each host: **the owner's action**):
- send a forged header from a test client;
- confirm the function sees the platform's address.

Until that verification is done, both public switches stay off.

**Also:** review V6-112 (`record_tap_event`) at the 025 re-base.

**Files:**
- `netlify/lib/emergency.mjs`, `netlify/functions/rescue.mjs` (the digests);
- a new helper;
- the deployment documentation (the new environment variable);
- tests in `test:emergency` and `test:rescue`: the configured header is used; other headers are ignored; unset means refused.

## 4. Questions for the owner

1. **Part A:** build it now, as described? (Authorised by your direction; Session A waits for your word because you asked for this plan first.)
2. **Part B:** approve the `TRUSTED_CLIENT_IP_HEADER` design, and a preview deployment on each host to verify it before any public switch is turned on?
