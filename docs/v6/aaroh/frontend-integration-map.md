# SHYGON AAROH V6: frontend ↔ backend integration map

Session B (frontend), 2026-10-19/20. This maps every visible control on the AAROH surfaces to the backend operation behind it. Contract: Session A's `docs/v6/aaroh/api-contract.md`, **AAROH-API v0.7.1**, from `v6/aaroh-backend`. `d1ff25d` (v0.4) was merged in `8358495`; `26eecd9` (v0.5–v0.7: Connect approved, the Privé demo 033, B-9 Part A) was merged in `3adf1f5`; `34a482d` (v0.7.1: B-9 Part B, the B-10 Connect host switch) was merged in `bd3a85e`. No frontend page calls `/api/prive` yet: the Privé demo stays off.

Two vocabularies, kept apart:
- **Engineering status** (this file and the reports only):
  - LIVE-LOCAL: verified on the local stack; nothing is on production.
  - BLOCKED: waits on a named approval or configuration.
  - NOT IMPLEMENTED.
- **Customer words** (what a page says): Available, Available after setup, Plan-gated, Coming soon, Unsupported, Demo. **Nothing is shown as "Live"** (contract §12).

## 1. Public visitor (`/t/:slug`, no session)

| Control / surface | Component | Backend operation | Auth | Success confirmed by | On failure | Engineering status |
|---|---|---|---|---|---|---|
| Resolve the Tap | `pages/PublicTap.tsx` → `lib/publicTapClient.ts` | P-1 `get_public_profile` | anon key; SECURITY DEFINER | non-null payload | P-2 state → paused / not found; network → offline / error with retry | LIVE-LOCAL |
| Why unavailable | `PublicTap.tsx` state pages | P-2 `get_public_tap_state` | anon | `'paused'` vs anything else | → "Tap not found" | LIVE-LOCAL |
| View, NFC and QR counting | `PublicTap.tsx` | P-3 `record_tap_event` | anon | fire-and-forget | swallowed | LIVE-LOCAL |
| SHYGON opening (also the loading state) | `showroom/TapOpening.tsx`, `opening.css` (entry bundle) | none | — | — | timers lift it; no opening under reduced motion; lifts at once for owner animation `none`, deep links and state pages | frontend only |
| Showroom cards | `showroom/TapShowroom.tsx`, `modes.ts` `liveModesFor` | derived from the P-1 payload, plus the two `public.status` answers below | — | — | — | LIVE-LOCAL |
| Profile (the owner's paid design) | `tap/TapExperience.tsx` via `?mode=identity` | P-1 | — | — | — | LIVE-LOCAL |
| Business, Contact, Links | `showroom/ModeViews.tsx` | P-1 fields; P-3 `link_click` | — | the OS handles `tel:`, `mailto:`, `wa.me` | mode hidden if nothing is published | LIVE-LOCAL |
| Owner access | `ModeViews.OwnerView` | none: a link to `/shygontap/auth` | the ordinary sign-in | session | — | LIVE-LOCAL |
| Emergency (visitor relay; "Emergency Profile", Q11 = B) | `showroom/EmergencyPublicView.tsx`, `lib/publicEmergencyClient.ts` | §10.3 `public.status` (once per view, after the profile renders), `public.alert` `{slug, idempotencyKey, confirm:true}` | none; relay only | 202 `{outcome, safety}` shown as returned | 404, 429 (+`retryAfter`), 503 and network handled; network retry reuses the key; no second press after a result | LIVE-LOCAL; **hidden**: `EMERGENCY_PUBLIC_ALERTS` unset (Q2 = B) |
| Return to owner (finder) | `showroom/ReturnFinderView.tsx`, `lib/publicRescueClient.ts` | §10a `public.status`, `public.start`, `finder.view`, `finder.post` | finder token (sessionStorage or URL fragment only; stripped from the address bar on load) | 201/200 thread | 409 `awaiting_owner`, `thread_closed`; 410 expired → forgotten; 429; network retry reuses the key | LIVE-LOCAL; **hidden**: `RESCUE_RELAY` unset |
| Connect (ask to connect) | `TapShowroom` card → link to `/shygontap/connect/:slug` (signed in); `lib/publicConnectClient.ts` | §10b `public.status` (anon, once per view) | none for the status; the request needs a session | — | any failure → not shown | LIVE-LOCAL; **hidden** unless the Tap's owner turned Connect on |
| Student, Events, Places, Cloud | not rendered on real Taps | none | — | — | — | NOT IMPLEMENTED |
| Verify, Access | not rendered on real Taps | none | — | — | — | NOT IMPLEMENTED; customer word "Unsupported" (DEC-037) |
| `/d/<code>` | no route | P-4 | — | — | — | BLOCKED (card registry) |

## 2. Demo showroom (`/aaroh/experience`, no session, noindex)

| Control | Component | Backend | Status |
|---|---|---|---|
| Opening, showroom, available modes with sample data | `pages/AarohExperienceDemo.tsx` → `PublicExperience demo` | **none.** e2e asserts zero requests to the gateway, `/api/*` or functions | Demo |
| Emergency walkthrough | `ModeViews.EmergencyDemoView` | **none.** It ends with "Demo finished. No alert was sent." | Demo; card says "Coming soon" (Q10) |
| Coming-soon and unsupported cards | `TapShowroom` | none; no button; the note says why | — |
| Privé demo | `showroom/PriveDemoView.tsx` | none | **OFF** (`PRIVE_DEMO = false`): FE-D5 conflict with DEC-2026-038 Q6 |

## 3. Owner (`/shygontap/*`, Supabase session; `ProtectedRoute` is a UX guard, RLS and the functions are the boundary)

| Control | Component | Backend operation | Success confirmed by | On failure | Affects the public Tap | Status |
|---|---|---|---|---|---|---|
| Sign in / out | `pages/Auth.tsx`, `AppShell` | Supabase Auth | session | existing messages | — | LIVE-LOCAL |
| Owner opening (SHYGON OS) | `showroom/OwnerOpening.tsx` on `/shygontap/account` | none; a `sessionStorage` flag (convenience only) | — | plays again if storage is blocked | no | frontend only |
| What visitors see, and preview | `pages/OwnerExperience.tsx` | T-1 via `AccountProvider`; P-1 for the modes | P-1 read exactly as visitors get it | retry state | no | LIVE-LOCAL |
| Which modes show | `OwnerExperience` → `liveModesFor(P-1)` | none of its own: no mode model (§6), so modes derive from T-2 fields | P-1 re-read (e2e) | — | yes, via the Tap editor | LIVE-LOCAL |
| Your cards and their lifecycle | `OwnerExperience` → `services/cards.ts` | C-1 own cards (RLS); `cardStatusOf` shared with `/shygontap/cards` | the server rows | retry state | no | LIVE-LOCAL (V5 cards; AAROH cards BLOCKED, §7) |
| Edit fields, publish / pause | `pages/TapEditor.tsx` (existing) | T-2, T-3 | saved row | 42501 / 22023 messages | yes | LIVE-LOCAL |
| Emergency contacts | `pages/EmergencySettings.tsx` → `services/emergency.ts` | §10.1 `contacts.list/save/remove/verify.request/verify.confirm` | the server's re-read after every change; masked numbers only | per error code; the field gets `aria-invalid` | removing the last verified contact switches visitor alerts off (server) | LIVE-LOCAL; real SMS BLOCKED (provider credentials, Q3 = MSG91) |
| Alert my contacts | `EmergencySettings` `AlertPanel` | §10.4 `alerts.create` (one key per press; reused on a network retry), `alerts.get` (polled while queued or sending), `retry`, `cancel`, `report`, `list` | the server's Event and its per-recipient status; `safety` always shown | 409 `alert_in_progress` → shows that alert; 422; 429 with wait; network | no | LIVE-LOCAL; delivery BLOCKED (provider) |
| Visitor alerts setting | `EmergencySettings` `VisitorAlertsPanel` | §10.2 `settings.set {publicAlertsEnabled, acknowledge:true}`, after the contract's exact consequence text | the returned settings | 422 and others | only once the host switch is on | LIVE-LOCAL; host switch OFF (Q2 = B) |
| Return-to-Owner inbox | `pages/ReturnToOwner.tsx` → `services/rescue.ts` | §10a `settings.get/set`, `threads.list/get/reply/close/block/report` | the server's thread; a reply clears only after the server confirms it | 409 / 404 messages; the reply text is kept for retry | the opt-in shows the finder mode, once the host switch is on | LIVE-LOCAL; `RESCUE_RELAY` OFF |
| Ask to connect (requester) | `pages/ConnectRequest.tsx` → `services/connect.ts` | §10b `requests.create {slug, idempotencyKey, share, note?}` | the returned Connection (`iShare`) | 404 unavailable, 409 already_connected / target_busy, 429 recently_declined (+days), `self`, network retry with the same key | — | LIVE-LOCAL |
| Connections (owner and requester) | `pages/Connections.tsx` | §10b `settings.get/set`, `requests.accept/decline/block`, `connections.list/share/remove`, `consents.list` | server re-read after each action; shared values always labelled **Self-reported** | per error; block and remove ask first; removal shows "Details they already copied or saved cannot be un-shared" | the opt-in shows the Connect card | LIVE-LOCAL (DEC-2026-039 approved; **customer wording awaits approval**) |
| `security`, `rescue` and `connect` notifications | `pages/Notifications.tsx` (existing) | N-1; links to `/shygontap/emergency`, `/shygontap/return-to-owner`, `/shygontap/connections` (all routed) | — | — | — | LIVE-LOCAL |

## 4. Platform admin

None in this app. The admin UI is the external Expo app. `admin_list_emergency_events` and `admin_list_rescue_reports` (§12a) are for that app.

## 5. Dependencies Session B still needs

| # | Need | From | State, 2026-10-19 |
|---|---|---|---|
| B-1 | AAROH-API committed | Session A | **Done**: v0.1 `c8b869d` → v0.4 `d1ff25d` (merged, `8358495`) → v0.7 at `26eecd9` (merged, `3adf1f5`) → v0.7.1 at `34a482d` (merged, `bd3a85e`) |
| B-2 | SPA rewrites in `netlify.toml` / `vercel.json` | Session A | **Done**: page routing is Session B's; four rewrites added |
| B-3 | `public.status` once per page view | Session A | **Confirmed** |
| B-4 | A way for browser e2e to turn on the SMS stand-in and the two host switches on the running stack | Session A | **Done** in v0.4 (`/__sim/sms/*`, `/__sim/switches`); used by `e2e/aaroh-server-paths.spec.ts` |
| B-5 | Owner approval of the Q10 customer wording | Owner | **Approved 2026-10-20** for Emergency Profile, Return to Owner and SHYGON Connect: `docs/v6/aaroh/showroom-copy-Q10-draft.md` |
| B-6 | Which Privé instruction stands (FE-D5 vs Q6) | Owner | **Decided:** demo only (Q6 → A, DEC-2026-040 approved; 033 merged). Wording approved as drafted (Q-F, 2026-10-23): `PRIVE_DEMO` on, in the demo showroom only. The signed-in demo page (§10c) is not built |
| B-7 | Connect, consent ledger | Session A | **Done** (v0.4; DEC-2026-039 approved); UI built; wording approved; "Coming soon" until verified |
| B-9 | The local app host should add the client-address header the real hosts add (`x-nf-client-connection-ip`), or visitor `public.alert` and `public.start` fail closed in a browser | Session A (`supabase/local/app-host.mjs`) | **Done locally** (Part A, `f1a2548`, owner-approved): the host sets the address from the connection and drops any address header a browser sends. The e2e visitors now use `x-shygon-sim-client` with `STACK_SIM_CLIENT_ADDRESS=1`. Part B (which header production trusts, V6-126) is not approved |
| B-10 | `/api/connect` had no host switch, so on any host with 032 an owner could expose Connect while it reads "Coming soon" | Session A (`CONNECT_PUBLIC`) | **Done** (v0.7.1, `34a482d`; DEC-2026-039 amendment A-1, owner-approved). Off by default: `public.status` false; create, accept and share 404 `unavailable`; decline, block, remove and the lists always work; `settings.publicAllowed`. Frontend: the request page asks `public.status` before offering its form; Connections says when SHYGON has not switched Connect on; a refused accept or share reads as refused. The Connect e2e checks it off, then switches it on |
| B-8 | SMS provider credentials and DLT templates; the host switches in production | Owner / operator | BLOCKED |
