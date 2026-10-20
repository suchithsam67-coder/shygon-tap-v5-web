# SHYGON AAROH V6: frontend audit, feature inventory and gap analysis

Session B (frontend owner), 2026-10-19. These are Phases A and B of the owner's brief "SHYGON AAROH V6 — Complete Interactive OS Experience".

**Evidence labels:**
- OBSERVED: seen in the code or a run on this branch.
- CONFIRMED: proven by a test run recorded here.
- HYPOTHESIZED: inferred, not proven.

## 1. Where this was done

| Item | Value |
|---|---|
| Worktree | `.claude/worktrees/shygon-aaroh-v6-frontend-c7fab7` |
| Branch | `claude/shygon-aaroh-v6-frontend-c7fab7`, fast-forwarded from `8becea3` (V5) to **`f0b771c`**. That is the V6 RC `6d00f2f` plus the AAROH store work (`99110f7`…`f0b771c`), and nothing else. |
| Backend (Session A) | `v6/aaroh-backend` @ `4d730c4` (RC + 028 suspension guard). New migrations start at 029. Its contract will be `docs/v6/aaroh/api-contract.md` on that branch; **not published at the time of this audit**. |
| Not merged | `4d730c4` / `v6/aaroh-backend`. Session A owns `supabase/**`, `netlify/**` and `api/**`, and its branch is still in progress. |
| Baseline gates on `f0b771c` (CONFIRMED, Node 20.18) | lint PASS · build PASS · `test:bundle` PASS at **88,908 B / 90,000 B** (1.09 kB headroom) · `test:seo` PASS (18 pages) · `test:components` 28/28 PASS |

The `v6/aaroh-store` branch is frozen for the stabilisation session. This work does not commit to it or edit its worktree. It only builds on top of its last commit.

## 2. What exists today (OBSERVED)

### Public visitor path
- `/t/:username` and `/tap/:username` render `PublicTap` (`src/App.tsx`). It is the only page in the entry bundle, with no Supabase SDK and no session.
- Data comes from `get_public_profile(p_slug)`: SECURITY DEFINER, whitelisted fields, active Taps only, clamped to the owner's entitlements. It goes through `src/lib/publicTapClient.ts` (plain fetch).
- `get_public_tap_state` tells a visitor only active, paused or unavailable. `record_tap_event` logs view, nfc, qr and link_click.
- The payload (`PublicProfile`) holds:
  - slug, experience, displayName, headline, designation, company, bio, avatarUrl, location;
  - phone, whatsapp, email, website, instagram, linkedin, youtube, customLinks;
  - theme, and activeEvent. activeEvent is a **platform-wide seasonal theme** (`tap_event_themes`), not an "event mode".
- `TapExperience` renders one profile card for four paid experiences (Essential, Business, Premium, GOAT) and applies the owner's theme: palette, layout, buttons, font, animation.
- The per-tier opening `ExperienceIntro` follows `intro-rules.ts`:
  - Essential: none. Business: a wipe. Premium: a sweep. GOAT: rings.
  - `theme.animation = 'none'` turns it off on every tier; reduced motion skips it.
- State pages cover: loading, offline, error, paused ("temporarily unavailable"), and unavailable ("Tap not found").

### AAROH store (AccountApp bundle)
- `AarohHero` plays a cinematic edition intro on `/shygontap` and `/shygontap/store/aaroh`.
- `AarohOverview` is the edition modal. `FeatureShowcase` is driven by `AAROH_SHOWCASE` (`src/data/aarohProduct.ts`) and states each feature's status honestly: available, setup, package, add-on, card-release or future.
- In that list, Return to owner, Emergency information, Student Passport, Event mode, Places and objects, and Cloud are **future ("Planned")**. Privé, access and credentials are **left out on purpose**: owner decision 2026-10-16; per DEC-2026-037, an AAROH card is not a credential.

### Owner path (AccountApp bundle, `/shygontap/*`, `ProtectedRoute`)
- Account (overview), Tap profile editor (fields, per-field visibility, publish/pause), Digital experience (tiers), Customize (theme), QR, Cards (OTP activate/deactivate for existing cards), Add-ons, Orders, Analytics, Notifications, Support, Settings (data export, deletion request).
- `ProtectedRoute` is a UX guard only. Data is protected by RLS: the rls-matrix covers 946 checks, CONFIRMED on the RC.

### Platform admin
- The admin UI is the **external Expo app** (Friend 2; D-8, V6-042). This repo has only the admin edge functions (`supabase/functions/admin-*`), which check `admin_users.user_id` server-side, and the `admin_*` RPCs.
- **No admin route exists in this web app**, and none will be added (out of Session B scope).

## 3. Feature checklist

Status vocabulary from the brief:

| Feature (brief section) | Status today | Evidence / remark |
|---|---|---|
| NFC/QR → browser → public page | IMPLEMENTED AND VERIFIED | `/t/:slug`; e2e `public-tap-mobile`, `journeys (a)`; NFC/QR `src` events recorded |
| SHYGON opening animation (§3) | PARTIALLY IMPLEMENTED | Per-tier openings exist (wipe, sweep, rings). There is **no SHYGON → AAROH brand reveal**, and Essential has no opening at all |
| Scrollable AAROH showroom (§4) | NOT IMPLEMENTED | The visitor lands straight on the profile card. A showcase exists only in the store's marketing modal (`FeatureShowcase`), not on a Tap |
| Select mode → use → return (§4) | NOT IMPLEMENTED | No mode navigation on the public Tap |
| My Identity (§7) | IMPLEMENTED AND VERIFIED | `TapExperience`; golden payload `test:golden`; public-tap 25 |
| Business / Professional (§7) | PARTIALLY IMPLEMENTED | Role, company and location block inside the profile card. Products/services and enquiry: **NOT IMPLEMENTED** (no schema) |
| Contact actions (call / WhatsApp / email) | IMPLEMENTED AND VERIFIED | Inside the profile card; hidden fields absent (e2e) |
| Links / social | IMPLEMENTED AND VERIFIED | Inside the profile card; add-on gated server-side |
| Owner Tap (§6) | NOT IMPLEMENTED; **not defined in any document** | `grep -i "owner tap"` finds nothing in docs, src or migrations. See FE-D3 |
| Emergency / Rescue, visitor side (§5) | NOT IMPLEMENTED; **BLOCKED BY APPROVAL** | Planned in the store. Docs 03/05/07 design Rescue as a Phase 3 finder relay. Session A: visitor alert is owner opt-in, default OFF, owner decision needed |
| Emergency contacts, owner side | NOT IMPLEMENTED; backend IN PROGRESS (Session A) | No schema on this branch; Session A is building CRUD with masked numbers |
| Emergency alert + event status, owner side | NOT IMPLEMENTED; backend IN PROGRESS (Session A); delivery BLOCKED | No SMS provider or DLT template, so the API will return `not_sent` |
| Return to owner relay | NOT IMPLEMENTED; OUT this release (Session A) | Owner's order: Business/Info first, then Return-to-Owner |
| Connect, consent-based exchange (§7) | NOT IMPLEMENTED; OUT (no schema, Phase 2) | |
| Student / Portfolio (§7) | NOT IMPLEMENTED; OUT OF CURRENT RELEASE SCOPE | Planned; needs a student privacy review |
| Verify / credentials (§7) | NOT IMPLEMENTED; **BLOCKED BY APPROVAL** | DEC-2026-037: an AAROH card is not a credential. No schema |
| Events, event identity (§7) | NOT IMPLEMENTED; OUT OF CURRENT RELEASE SCOPE | Only platform seasonal themes exist |
| Locations / objects (§7) | NOT IMPLEMENTED; OUT OF CURRENT RELEASE SCOPE | Planned |
| Privé / Hospitality demo (§7) | **BLOCKED BY APPROVAL** | Owner 2026-10-16: Privé outside launch scope and removed from the store. The 10-19 brief asks for a demo. Conflict, FE-D5 |
| `/d/<code>` NTAG 424 DNA resolve | BLOCKED BY DEPENDENCY | Card registry schema and SDM keys; card release deferred (DEC-035/037). Session A: reserved stub only |
| Owner authentication | IMPLEMENTED AND VERIFIED | Supabase Auth; e2e journeys |
| Owner opening experience | NOT IMPLEMENTED | |
| Owner dashboard (overview) | IMPLEMENTED AND VERIFIED | `/shygontap/account` |
| Manage profile / Tap / publish-pause / field visibility | IMPLEMENTED AND VERIFIED | Tap editor; `enforce_tap_edit_rules`; e2e (a) |
| Configure available modes | NOT IMPLEMENTED; BLOCKED BY DEPENDENCY | Session A: no per-mode model exists; one needs an owner decision. See FE-D8 for what works without it |
| Preview the public experience | PARTIALLY IMPLEMENTED | The editor preview mounts `TapExperience`; no "open my public Tap" preview of the full flow |
| Review emergency event status | NOT IMPLEMENTED; waits for the Session A contract | |
| Card controls (activate/deactivate) | IMPLEMENTED, legacy cards only | AAROH card activation: card release (DEC-035) |
| Analytics | IMPLEMENTED AND VERIFIED | |
| Platform admin app | OUT OF CURRENT RELEASE SCOPE for this repo | External Expo app; server-side checks tested (`test:admin-edge`) |
| Responsive / a11y / reduced motion | IMPLEMENTED AND VERIFIED for existing pages | axe 0 violations on 20 pages (Stage 6); must be re-run for the new screens |

**Defects or misleading items found:**
- None that misstate today's functionality. The store's showcase statuses match the code (OBSERVED).
- Risk to manage: any new showroom must not promise Planned modes on a real person's Tap.

## 4. Gap analysis against the brief

1. **Showroom and mode navigation are missing on the public Tap.** This is the central gap. Everything a real Tap can do today (identity, business details, contact actions, links) is real but lives in one card.
2. **No SHYGON brand opening.** The tier openings exist but are not the SHYGON → AAROH sequence the brief describes.
3. **There is no mode model in the backend.** Only per-field publish and visibility exist. So "modes" on a real Tap can only be views over the published fields until Session A and the owner decide on one.
4. **Emergency has no backend yet** (Session A is building it). Visitor-initiated alerts need an owner decision. SMS delivery needs a provider.
5. **Owner Tap is undefined.** It needs the safest interpretation plus an owner decision.
6. **Privé and Verify conflict with recorded owner decisions.**
7. **Bundle headroom is 1.09 kB**, so new public-Tap code must load lazily and not count against the entry budget.

## 5. Decisions needed from the owner (drafts; nothing here is decided)

Each item has a recommended safe default, which is what gets implemented until the owner rules. Numbered FE-Dn so they do not collide with DEC numbers Session A may take. They become DEC records once ruled.

| # | Question | Options | Safe default implemented | Why |
|---|---|---|---|---|
| **FE-D1** | Does every Tap open with the SHYGON animation, even Essential, and even when the owner set the opening to "none"? | A: every Tap. B: every Tap except owner "none" and reduced motion. C: only the tiers that have an opening today | **B** | The brief (10-19) asks for the opening on every tap. The customizer promises "a customer who finds their own opening tiresome can always skip it". Essential's "nothing to wait for" is honoured by keeping the opening short and non-blocking: content is usable underneath and any tap or key skips it |
| **FE-D2** | On a real Tap, does the showroom come before the profile? | A: showroom first, its first card being the identity with Call/WhatsApp on it. B: profile first, showroom below | **A** | The brief's flow is explicit. Contact stays one tap away on the first card |
| **FE-D3** | What is "Owner Tap"? | A: the owner's entry point. The visitor sees whose card it is and "I'm the owner — sign in", which leads to the normal sign-in and the dashboard; tapping never authenticates. B: owner-only controls on the public page. C: something else | **A** | Never authenticate by tap (doc 07 T1, A0 rule). B would need a session in the public bundle. No document defines the term |
| **FE-D4** | Is there an Emergency card on real Taps? | A: hidden until the owner opts in and the backend exposes a public flag. B: always shown, with "alerts not set up · call 112" | **A** | Do not show unavailable functionality on a person's page (brief §10, "DISABLED must not expose…"). The emergency walkthrough lives in the clearly labelled demo |
| **FE-D5** | Privé: build the demo the 10-19 brief asks for, or keep the 10-16 decision (outside launch, removed)? | A: keep removed. B: demo in the demo showroom only, labelled DEMO, no network | **A** | A recorded decision stands until the owner changes it. Session A raised the same conflict |
| **FE-D6** | Verify / credentials | A: not shown (DEC-037). B: shown as Planned | **A** | DEC-037: an AAROH card is not a credential |
| **FE-D7** | Where does the public demo showroom live? | A: `/aaroh/experience`, a public route, noindex, sample data, in its own lazy chunk. B: inside the store modal | **A** | It has the same shell as a real Tap and does not touch the frozen store files |
| **FE-D8** | Mode configuration before a mode model exists | A: modes derive from what the owner publishes (Business appears when a role or company is published, and so on), configured through the existing server-enforced Tap editor. B: wait for a mode table | **A** | No fake toggles; the source of truth stays the server |

## 6. Implementation sequence (Phases C–K)

| Phase | Work | Backend dependency |
|---|---|---|
| C | Public navigation flow: `/t/:slug` → opening → showroom → `?mode=<id>` view → Back to showroom (history-aware) | none |
| D | `TapOpening` and `TapShowroom` as one lazy chunk, preloaded in parallel with the profile fetch | none |
| E | Modes: Identity (the existing `TapExperience`, unchanged), Business, Contact, Links, Owner. All are real and derived from the published payload | `get_public_profile` (LIVE-LOCAL) |
| F | Emergency: the demo walkthrough in the demo showroom (sends nothing). Owner screens wait for the Session A contract | Session A v0.1 |
| G | Demo showroom `/aaroh/experience`: every mode with LIVE, DEMO, COMING SOON or BLOCKED status, sample data labelled | none |
| H | Owner dashboard panel "Your public experience": the modes this Tap shows today (the same derivation function as the public page), how to turn each on in the Tap editor, and Preview | existing owner reads |
| I | Integrate the Session A emergency operations once v0.1 is published and its suites pass | Session A v0.1 |
| J | Vitest, Playwright on the local stack, axe, mobile, reduced motion, LCP/CLS, bundle, SEO, security probes | local stack |
| K | Phase-gate report; stop | — |

## 7. Update, later on 2026-10-19: what changed after this audit

- **The backend contract is published and merged.** AAROH-API v0.1 → v0.3 (`c8b869d`, `b12967a`, `6be94e3`) is merged into this branch with `--no-commit`. It provides emergency contacts and alerts (029), the Tap column guard (030) and the Return-to-Owner relay (031).
- **The owner answered DEC-2026-038 Q1–Q13** (relayed by Session A; recorded on `v6/aaroh-backend`).
  - Q2 = B: visitor alerts stay off.
  - Q3 = MSG91.
  - Q6: Privé is read as "out".
  - Q10 = A: new customer copy needed.
  - Q11 = B: the Emergency Profile is the relay view only.
- **Decision status:**

| # | Now |
|---|---|
| FE-D1 | Implemented as B. The opening is now also the public Tap's loading state: it paints from the first frame and lifts when the content is ready (performance fix, see the phase-gate report). **Still needs the owner's confirmation** |
| FE-D2 | Implemented as A. Owner to confirm |
| FE-D3 | Implemented as A (Owner access → normal sign-in). Owner to confirm |
| FE-D4 | **Superseded by the contract:** Emergency appears on a real Tap only when `/api/emergency` `public.status` says available, which is never today (Q2 = B, host switch unset). The same rule applies to Return to owner (`RESCUE_RELAY`) |
| FE-D5 | **Conflict, open.** The master brief (2026-10-19) says "Demo-only Privé"; DEC-2026-038 Q6 as recorded keeps Privé out. The demo is built and tested, and switched **off** (`PRIVE_DEMO = false`) until the owner says which stands |
| FE-D6 | Verify and Access are shown only in the demo showroom, as **Unsupported**, with the reason (DEC-037). Never on a real Tap |
| FE-D7 | Implemented (`/aaroh/experience`, noindex, no backend calls) |
| FE-D8 | Confirmed by the contract (§6: no mode model) |
| Status words | Customer copy uses Available / Available after setup / Plan-gated / Coming soon / Unsupported / Demo (master brief §10). "Live" is never shown to a customer (contract §12) |
