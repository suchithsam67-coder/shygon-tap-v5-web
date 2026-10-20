# SHYGON AAROH V6: frontend phase-gate report (Session B)

**Gate:** Phase K of the 2026-10-19 brief. **Stopped here for the owner's review.**
**Nothing is committed, pushed, applied or deployed.**

| | |
|---|---|
| Worktree | `.claude/worktrees/shygon-aaroh-v6-frontend-c7fab7` |
| Branch | `claude/shygon-aaroh-v6-frontend-c7fab7` = `f0b771c` (V6 RC `6d00f2f` + AAROH store) |
| Backend merged | `v6/aaroh-backend` @ `d1ff25d` (AAROH-API v0.4; v0.5 `f1d2af1` is records only), merged with `--no-commit`. The merge is **staged**; Session B's work is **unstaged** and separate |
| Evidence labels | OBSERVED (seen in code or a run), CONFIRMED (a test run recorded here), HYPOTHESIZED |

## 1. Verdict

| Area | Result |
|---|---|
| Public Tap journey (NFC/QR → opening → showroom → mode → back) | **PASS**, CONFIRMED on desktop and phone (e2e) |
| Owner journey (sign in → OS opening → AAROH experience → change → public reflects it → sign out) | **PASS**, CONFIRMED (e2e) |
| Emergency contacts and owner alerts on the real backend | **PASS**, CONFIRMED: no provider, provider accepted → receipt-delivered, refusal, retry (e2e) |
| Visitor emergency relay | **PASS** with the host switch on (e2e). **Off everywhere** (DEC-2026-038 Q2 = B) |
| Return to owner (finder ↔ owner) | **PASS** with the relay switch on (e2e). **Off everywhere** (`RESCUE_RELAY`) |
| Connect (request → accept → self-reported values → remove revokes grants) | **PASS**, CONFIRMED (e2e, consent ledger checked) |
| Gates | See §6. **One pre-existing FAIL** (`admin-contract`, migration 027, not from this work) |
| Production readiness | **NOT READY.** Inherits every V6 release blocker (B-1 rotation, B-2 migrations unapplied, live payments off, the live site is a second app); the SMS provider is not configured; customer wording awaits approval |

## 2. Existing frontend architecture and routes (OBSERVED)

- Vite + React 19 SPA.
- The public Tap (`/t/:slug`, `/tap/:slug`) is the only page in the entry bundle: no Supabase SDK, plain fetch to SECURITY DEFINER RPCs.
- Everything else (store, checkout, signed-in account `/shygontap/*`) sits behind one lazy `AccountApp`.
- `ProtectedRoute` is a UX guard; RLS and the server functions are the boundary.
- The admin UI is the external Expo app; this repo has no admin route.

## 3. Features found vs built

The full checklist is in `frontend-audit.md` §3 and §7. Summary of what this work adds:

| Feature | Before | Now | Customer word |
|---|---|---|---|
| SHYGON opening | per-tier intros only | brand opening, also the loading state; skippable; none under reduced motion or when the owner turned openings off | — |
| Showroom | none | horizontal snap rail, keyboard and arrow navigation, honest cards | Available |
| Profile, Business, Contact, Links, Owner access | one card | focused modes from the published payload only | Available |
| Emergency (visitor) | none | relay view (name + alert, Q11 = B); shown only when `public.status` says so | Coming soon (Q10) |
| Emergency (owner) | none | contacts, verification, alerts, statuses, visitor opt-in | Coming soon (Q10) |
| Return to owner | none | finder view + owner inbox | Coming soon (Q10/Q12) |
| Connect | none | request page + Connections page + consent record | Coming soon (wording awaits approval) |
| Owner cards and lifecycle | Cards page | also on the AAROH experience page, with shared status wording | — |
| Demo showroom `/aaroh/experience` | none | every mode with its status; emergency walkthrough sends nothing | Demo |
| Privé demo | none | **built, switched OFF** (FE-D5 conflict) | — |
| Student, Events, Places, Cloud | planned | shown only in the demo | Coming soon |
| Verify, Access | — | shown only in the demo | Unsupported (DEC-037) |

## 4. User journeys implemented

**Public.**
- NFC/QR → `/t/:slug` → the SHYGON opening (also the loading state) → the showroom. It lists only what the owner published, plus Emergency, Return or Connect when their servers say they are on.
- A mode opens on its own address (`?mode=`). Back, or the phone's back button, returns focus to the same card.

**Owner.**
- Sign in → SHYGON OS opening (once per session) → dashboard.
- AAROH experience page: status, preview of the real public page, modes read from the live payload, cards and lifecycle.
- Emergency, Return to owner and Connections pages.
- Sign out → protected routes send you to sign in.

**Emergency.** The three workflows are kept apart, per the master brief:
- **Owner SOS:** `alerts.create`.
- **Visitor relay:** `public.alert`, owner opt-in, host switch.
- **Emergency Profile (information view):** not built, undefined (Q11 = B). No contact detail ever reaches a public page.
- SHYGON is never said to contact emergency services; "call 112" is a `tel:` link.

## 5. API contracts consumed

All of them are AAROH-API v0.1–v0.4; the full map is in `frontend-integration-map.md`.

| Area | Operations |
|---|---|
| Public | P-1/P-2/P-3 RPCs; `/api/emergency` `public.status`/`public.alert`; `/api/rescue` `public.*`/`finder.*`; `/api/connect` `public.status` |
| Owner | T-1/T-2/T-3 (existing editor), C-1 cards, `/api/emergency` §10.1/10.2/10.4, `/api/rescue` owner ops, `/api/connect` §10b |

Contract rules honoured:
- one idempotency key per intent, reused only on a network retry;
- `sent` ≠ `delivered`, and `safety` is always shown;
- masked numbers only, and the finder token never in a path, query string or log;
- "blocked" is never shown to a requester; shared values are labelled self-reported; the un-share warning on removal.

## 6. Tests executed and exact results

Run on 2026-10-20 on this branch (merge + Session B's work), Node 20.18, Edge, local stack (`npm run stack`). Every number below was observed in this run; none is copied from an earlier stage.

**Component tests (Vitest):** 76/76 passed, stable across repeated runs. That stability needed one fix: `asyncUtilTimeout` raised to 5 s for the cold lazy-chunk transform, which had made 3 tests flaky at 1.25 s.
- The suites: PublicTap 11, PublicExperience 16, ServerModes 8, EmergencySettings 15, ReturnToOwner 3, Connections 6, plus the existing ones.
- The brief's required cases (successful request, unauthorized, invalid input, network failure, provider failure, retry, duplicate submission) are each covered for emergency, and as applicable for Return to owner and Connect.

**End-to-end (Playwright, local stack):** **33/33** passed.
- The first run's only failure was a browser launch timeout ("browserType.launch: Timeout 180000ms"), not a test assertion. That test (a11y public pages) passed on re-run with no violations reported.
- New: `aaroh-experience.spec.ts`, 6 journeys × desktop + phone (Pixel 7).
- New: `aaroh-server-paths.spec.ts`, 5 journeys using Session A's v0.4 hooks:
  - verify → alert → signed receipt → "Delivered", with the DB recipient `delivered`;
  - refusal final → no provider `not_sent` → retry → `sent`, with the DB showing `['failed','sent']`;
  - visitor relay, DB initiator `public`, no contact detail on the page;
  - Return-to-Owner finder ↔ owner conversation;
  - Connect request → accept → remove, with the DB grants revoked.
- Existing journeys still pass after two kinds of change:
  - locators that matched the owner's name twice were pointed at the page heading;
  - the a11y, landmarks and reduced-motion lists were extended to the new pages.

**Repository gates** (`npm run ci`'s steps, run one by one so a failure hides nothing):

| Gate | Result |
|---|---|
| lint, build | PASS |
| test:bundle (public Tap entry JS) | PASS, **85,247 B / 90,000 B**. The base was 88,908 B: the profile card moved into the lazy experience chunk |
| test:bundle-secrets, test:seo (18 pages), test:push-guard | PASS |
| db:apply, db:verify 21, rls-matrix **1380** (48 tables), identity 69, admin-notes 12, golden 15, rollbacks 14, account-deletion 9, db:bundle:check, db:history, rls-adversarial 64 | PASS |
| **test:admin-contract** | **FAIL 14/15, PRE-EXISTING.** `card_design_of(text)` body changed by migration 027 (AAROH catalogue). The identical failure (same hashes) was **reproduced on the unmodified base `f0b771c`**. Under DEC-037, 027 is held aside by the stabilisation step and must never receive a contract approval, so this work does not change it |
| payments:ci, payment-chain 34, aaroh 15, public-tap 25, suspension 46, emergency **48**, rescue **18**, connect **16**, admin-edge 11, observability 10, security 11 | PASS |
| test:components | PASS 76 |
| **test:secrets** | **FAIL, known:** the only finding is `9c8caa7` / `ProjectConsultation.tsx:75` (D-7, DEC-2026-020). A redacted scan of this work's uncommitted `src`, `e2e`, docs and host files found no new secret |
| npm audit (high) | PASS |

**Performance** (slow 4G, 4× CPU, local host):
- Public Tap LCP **1,432 ms**, CLS 0.001 (budget 2,500 ms / 0.1); landing 1,540 ms.
- Measured side by side earlier on the same machine: unmodified base median 1,848 ms vs this work's 1,924 ms. That is within run-to-run noise.
- An earlier design (the opening after load) measured 3,204 ms and was rejected. The opening is now the loading state and paints from the first frame.

**Not run:** HawkScan DAST. Its runtime and API key are not installed on this machine (hook: `hawk runtime=false, HAWK_API_KEY=false`).

## 7. Accessibility and responsive checks

- **axe (WCAG 2.2 AA, serious and critical fail):** 0 on all public pages, including every showroom mode, the demo and the emergency walkthrough. 0 on all signed-in pages, including AAROH experience, Emergency, Return to owner, Connections and a Connect request.
  - Caught and fixed on the way: the white-on-red "Call 112" button was 3.76:1; now 6.4:1.
- **Landmarks:** one `main` and an `h1` on every new page.
- **Reduced motion:** no running animation on `/t/<slug>` or `/aaroh/experience` (e2e); the opening never mounts (unit and e2e).
- **Keyboard:**
  - the showroom moves with ←/→/Home/End;
  - Back returns focus to the opened card's button;
  - mode headings take focus;
  - dialogs trap and restore focus (existing ConfirmDialog);
  - the opening is `aria-hidden` and ends on any key.
- **Responsive:**
  - phone (Pixel 7 project and a 375 px pane): no sideways scroll, measured;
  - desktop at 1280 px: the active card is centred and the next card peeks in;
  - 11–14 demo cards use a count instead of wrapping dots.
- **Touch:** controls are at least 44 px; dots have 24 px targets.

## 8. UI blocked by backend or owner dependencies

| # | Item | Waiting on |
|---|---|---|
| 1 | Customer wording for Emergency, Return to owner and Connect (`showroom-copy-Q10-draft.md`) | **Owner** (DEC-2026-038 Q10, Connect wording) |
| 2 | Privé: demo-only (master brief) or out (Q6 as recorded) | **Owner** |
| 3 | Real SMS (verification, alerts) | MSG91 credentials + DLT templates (Q3) |
| 4 | Visitor alerts and the relay in production | Host switches, after supervised owner alerts (Q2 = B; Q12) |
| 5 | B-9: the local app host's client-address header | Session A (tooling only) |
| 6 | AAROH card activation and `/d/<code>` | Card registry (card release) |
| 7 | A per-mode model and "Info" mode | Owner (open with Session A) |
| 8 | FE-D1, FE-D2, FE-D3 (opening on every Tap, showroom first, Owner access) | **Owner** confirmation |

## 9. Files changed

**Session B, unstaged:**
- Modified: e2e specs (a11y, journeys, public-tap-mobile), netlify.toml, vercel.json, playwright.config.ts, AccountApp, App, AppShell, TapExperience, Account, Cards, PublicTap(+test), seo/build.ts, services/cards.ts, tap.css, routes.test.ts, test/setup.ts.
- New: `src/components/showroom/*`, the three public clients, the three owner services, the pages (OwnerExperience, EmergencySettings, ReturnToOwner, Connections, ConnectRequest, AarohExperienceDemo), the component tests, two e2e specs, four docs.

**Session A merge, staged:** migrations 028–032, functions, tests and docs. `APPLY_ALL.sql` was regenerated with `db:bundle`.

## 10. Known issues and next actions

**Known issues**
1. `admin-contract` fails on 027 (pre-existing; stabilisation step, DEC-037).
2. The secret-scan gate fails on 9c8caa7 (owner decision D-7).
3. B-9: the e2e supplies the CDN's client-address header itself until the local host adds it (asked of Session A).
4. Node 20.18 is below the `>=22.12` engine; the known payments check is BLOCKED on Node 20, as before.
5. The merge brings in 027 via the base. **This branch's `APPLY_ALL.sql` is not a release bundle.**
6. AAROH-API **v0.6/v0.7 (Privé, migration 033) are not merged here yet.**

**Next actions, each needing the owner's word**
1. Review this gate.
2. Decide whether to **commit**, as two commits: first the staged merge of `v6/aaroh-backend`, then Session B's unstaged work. Nothing is pushed.
3. Approve, edit or reject the customer wording in `showroom-copy-Q10-draft.md` (Emergency, Return to owner, Connect). Approve the wording for Privé too.
4. Confirm FE-D1 (the opening on every Tap unless the owner turned openings off), FE-D2 (showroom first) and FE-D3 (Owner access = the normal sign-in).
5. Then Session B can:
   - merge v0.7;
   - switch `PRIVE_DEMO` on;
   - build the signed-in Privé page against §10c (showing the `notice`, "SHYGON's demo desk");
   - replace the store's untrue "nothing like it is stored today" line together with the 029 deployment.
6. Production stays gated by the V6 release blockers (rotation, migrations review/apply, the live site being a second app, the SMS provider, the host switches).
