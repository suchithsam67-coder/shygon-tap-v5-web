# Independent second review: Lost mode frontend (2026-11-02)

| | |
|---|---|
| Scope | Commit `249c8d9` "feat(aaroh): Lost mode frontend: the 'Found this card?' page and the owner's Lost entry (AAROH-API v0.10)", plus its merge `7226a83` of `v6/aaroh-backend` up to `39d87ca`. Read with `git show` only — never checked out, never modified. Contract: `docs/v6/aaroh/api-contract.md` §6 (Lost, v0.10) and §10a (Return to Owner). Wording compared against `GPT-6_result_checked.md` (the coordinator's checked table, 2026-10-30) and the commit's own `docs/v6/aaroh/lost-mode-wording-map.md` (Q-L1 to Q-L5). |
| Mode | **Read-only.** No source, migration or test was changed. The only file added is this report. No push, no network beyond the local test stack. |
| Tests run here | `npx vitest run` → **16 files, 154 tests passed** (exit 0). `npm run lint` → clean (0 errors). `npm run build` → **passed**. `npm run test:bundle` → **PASS: 86,104 B / 90,000 B** (3.90 kB remaining). Lost e2e journey (`e2e/aaroh-server-paths.spec.ts`, "lost mode") → **passed** on `STACK_APP_PORT=4473 STACK_GATEWAY_PORT=54621` (fresh stack; relay on, catalogue on, owner opted in, confirmed switch, finder writes, relay off → "Tap not found", back to Business). a11y Lost page check → **passed** (no serious/critical WCAG 2.2 AA violation). |
| Not run here | `npm test:secrets` (reports pre-existing V6-014 / netlify sun.mjs findings on other branches — not this branch, per the commit). `npm run audit` (commit reports no high findings). |
| Verdict | **No release-blocking finding (no P0, no P1).** Nothing owner-related renders, loads or is fetched while the Tap is in Lost mode: the public reader calls P-6 `get_public_tap_mode` once (returns `{mode:'lost'}`, no P-1 profile fallback), calls `public.status` once, records no visitor event, sets `noindex`, and shows no owner name/photo/theme/palette. The owner's mode page calls only `/api/modes` (`owner.state`, `owner.info.get`, `owner.activate` with a per-intent idempotency key reused on network retry), and never switches the Return to Owner opt-in on. Every contract state maps to a non-dead-end page, and every state re-reads the server. All copy matches the checked GPT-6 table or is a documented deliberate deviation already tracked as Q-L1 to Q-L5 (wording is draft, owner-approval pending). Four nits follow; none leaks data. |

---

## 1. Findings

| # | Severity | Where | What goes wrong (concrete input) | Fix | Status |
|---|---|---|---|---|---|
| 1 | nit | `src/pages/PublicTap.tsx:124` | `startExperience()` is invoked unconditionally on every render of `PublicTap`, so the experience chunk (which holds `PublicLostPage`, `ReturnFinderView`, `showroom.css` and the icon set) is downloaded even when the Tap is in Lost mode. That is by design (the chunk arrives anyway for any Tap address) and it carries **no owner data**, but it is the only network activity on a Lost landing beyond `get_public_tap_mode` + `public.status`. | No code change required. If the head-start is ever considered waste for Lost, gate `startExperience()` behind `outcome.kind !== 'lost'` — but the chunk is what renders the Lost page, so removing the head start would only add a render pass. | **OBSERVED** (read; confirmed in the network trace: only `get_public_tap_mode`, then one `public.status`) |
| 2 | nit | `src/components/showroom/ReturnFinderView.tsx:234` | The finder's conversation-actions button reads "Check for a reply", while the GPT-6 table offers "Open this link to read it." / "View reply" for a reply state. The finder is already on the conversation and the reply appears after refreshing, so "View reply" is not accurate here; the table entry was deliberately dropped in `lost-mode-wording-map.md` (Q-L2 covers closed; the reply label is equally a drafting choice). | Wording is draft: align with the table at the gate, or keep "Check for a reply" and record the deviation in `lost-mode-wording-map.md`. No code change needed now. | **INFERRED** (wording-map already documents deliberate drops; owner gate pending) |
| 3 | nit | `src/components/showroom/ReturnFinderView.tsx:222-232` | Closed thread shows "This conversation is closed." The GPT-6 table's "…because there has been no activity for 30 days" was deliberately dropped because the finder cannot tell owner-close from 30-day idle (§10a). The code is correct; only the wording differs from the table's draft. | No code change. Owner decides wording at the gate; the mapping already flags it (Q-L2). | **INFERRED** (intentional, documented in the wording-map) |
| 4 | nit | `src/pages/TapMode.tsx:456-470` | The owner's Lost `not_available` state shows "Lost mode is not available right now. SHYGON has switched it off." but no "Choose another mode" action (the GPT-6 table lists it). The other modes are on the same page just above, so nothing is lost functionally; the table entry was deliberately dropped (wording-map). | No code change. Owner decides wording at the gate. | **INFERRED** (intentional, documented in the wording-map) |

---

## 2. Leaks in the browser (P0/P1 — none found)

### Public visitor page (`/t/<slug>` while Lost)

Network trace of the full Lost finder journey (fresh stack, relay on, catalogue on, owner opted in), every request in order:

1. `GET /t/<slug>?src=nfc` — the page itself.
2. `POST /rest/v1/rpc/get_public_tap_mode {p_slug: "<slug>"}` (P-6) → `{mode:'lost'}`. **No P-1 `get_public_profile` fallback** — the answer carries only the mode key, per `fetchPublicTap` (`src/lib/publicTapClient.ts:129-149`).
3. `POST /api/rescue {op:"public.status",slug:"<slug>"}` — once, after the page resolved (`readRescueStatus`, `src/lib/publicRescueClient.ts:75-78`). Returns `available:true` → the Lost page renders.
4. `POST /api/rescue {op:"public.start",slug, idempotencyKey, message}` — one intent, one key (`src/lib/publicRescueClient.ts:89-90`).
5. `POST /api/rescue {op:"finder.view",finderToken}` — refresh / view thread.

**Nothing else:** no `record_tap_event` (P-3) call — the contract asks for no visitor event on Lost (`PublicTap.tsx:213-221` only logs for `kind === 'tap'`), no owner profile, no avatar, no theme, no palette, no owner name, no location, no phone, no email, no Business/Info/Connect/emergency element, no analytics event of any kind.

### Title / meta / OG / preview (`src/pages/PublicTap.tsx:74-109`)

`lostMeta(slug)` returns `{title:'Found this card? | SHYGON Tap', description:'This page only lets you send a private message to the owner of this card.', path:'/t/<slug>', noindex:true}`. **No `image`** (so no owner avatar in a share preview), no `type` of profile, `noindex:true`. The fallback `error`/`offline`/`state` metas are also neutral (`noindex:true`, no owner data). `tapMeta`/`infoMeta` are never reached for Lost.

### Owner mode page (`/shygontap/mode`)

Network trace while switching into Lost: `POST /api/modes {op:"owner.state"}`, `owner.info.get`, `owner.activate {mode:'lost',expectedVersion:0,idempotencyKey:<uuid>}`, then `owner.state` + `owner.info.get` again after the 200. **Only `/api/modes`** — no owner profile fetch, no rescue settings/threads call from the mode page itself (those belong to `/shygontap/return-to-owner`, a different route). Switching never calls Return to Owner's `settings.set`, so the opt-in is never turned on from here (`tapMode.ts:99-104`, `TapMode.tsx:187-242`).

### `PublicExperience` is not mounted on the Lost page

`PublicTap` renders `PublicLostPage` directly for `kind === 'lost'` (`:301-307`), not `PublicExperience`. So `PublicExperience`'s per-page-view `fetchRescueStatus`/`fetchPublicAlertsAvailable`/`fetchConnectAvailable` calls (`src/components/showroom/PublicExperience.tsx:92-109`) do not fire — confirmed by the trace (a single `public.status`). No prefetched profile data, no experience-chunk owner payload, no second rescue poll.

---

## 3. States (contract outcomes → page, never a dead end)

All verified by unit tests (`TapMode.test.tsx`, `ServerModes.test.tsx`) and/or the live e2e journey.

| Contract outcome | What the page shows | Verified |
|---|---|---|
| `{mode:'lost'}`, `public.status` available | "Found this card?" + Return to Owner form; `noindex`; no visitor event | Test + e2e |
| `{mode:'lost'}`, `public.status` available:false | Neutral "Tap not found", never P-2, never Business | Test + e2e |
| `{mode:'lost'}`, no answer (500/network) | "We couldn't load this Tap" + retry; never "not found" | Test + e2e |
| P-6 `null` (unknown/draft/paused/suspended/off) | P-2 `fetchPublicTapState`: paused → "Temporarily unavailable"; otherwise "Tap not found" | Contract `fetchPublicTapState` (`publicTapClient.ts:155-158`) |
| `owner.state` Lost `needs_setup`, `missing:['returnToOwner']` | "To use Lost mode, turn on Return to Owner first." + link "Open Return to Owner" (`/shygontap/return-to-owner`); switch disabled; no rescue call from this page | Test (`needs Return to Owner first`) |
| `owner.state` Lost `not_available` | "Lost mode is not available right now. SHYGON has switched it off."; switch disabled | Test |
| `owner.activate` Lost → `previousMode: null` (first switch ever) | Switch still confirmed; success notice shown | Test ("a Tap's first switch ever") |
| `owner.activate` Lost → `stale_version` | Refused, re-reads state, never shown as done; any Info draft kept | Test |
| `owner.activate` Lost → `mode_unavailable` / `needs_setup` mid-flight | Refusal in Lost words; state re-read; Info draft preserved | Test |
| Cancel on either confirm dialog | Sends nothing (`owner.activate` count stays 0) | Test |
| Switching Lost → Business | Asks first ("Switch back to Business?"); confirmed → Business shows; cancelled → nothing | Test + e2e |
| Backend before v0.10 (no Lost entry) | No Lost section, no switch button | Test |

The finder-thread states (`open`/`owner_replied`/`closed`, `canWrite:false` after 3, `rate_limited`, `unavailable`, `invalid_message`/`empty`, `thread_expired`, `thread_not_found`/`invalid_token`) are each rendered in the Lost words and never show a server message verbatim (`ReturnFinderView.tsx:59-80`, `597-656`).

---

## 4. Wording vs the checked table

Every visible string on the Lost pages matches the GPT-6 table as corrected, or is a documented deliberate deviation tracked in `lost-mode-wording-map.md` as Q-L1 to Q-L5. Since the owner has not approved the final wording, these are **nits**, not bugs:

- Page heading "Found this card?" ✓ matches.
- Lead "This card is in Lost mode. This page only lets you send a private message to its owner." ✓.
- Label "Your message", placeholder "Write a message (1–500 characters)", counter "0 / 500", both notes, "Send message"/"Sending…" ✓ all match.
- Sent/saved-link/reply/3-without-a-reply/empty/too-many/expired/closed/blocked/unavailable ✓ match (with the deliberate drops already noted in the wording-map: "View reply"/"Open this link to read it", "…because there has been no activity for 30 days", "Choose another mode").
- Owner screen: mode entry "Lost" / "Let someone who finds your card message you privately.", confirm, success, banner, needs-setup ("turn on Return to Owner first" / "Open Return to Owner"), unavailable, back-to-Business ✓ all match.

Contract §6 draft strings ("Send a message", safety note "Your message goes to the owner without showing them your contact details…") were superseded by the checked GPT-6 table per the commit; the code follows the table. Wording remains draft at the owner's gate — no fix required now.

---

## 5. Accessibility

The axe check of the Live Lost page (`/t/<slug>` in Lost) found **no serious or critical WCAG 2.2 AA violation** (`e2e/a11y.spec.ts` "the Lost page (v0.10)"). Existing showroom styles apply:

- **Labels:** message box labelled "Your message" (`aria-describedby="rt-count rt-note"`); the counter "0 / 500" is visible; notes under the box.
- **Character counter:** `{message.length} / {MAX}` rendered live; `maxLength={MAX}` stops at 500.
- **Focus after send:** when the thread appears, `resultHeading.current?.focus({preventScroll:true})` moves focus to the status heading (`ReturnFinderView.tsx:120-124`).
- **Error announcements:** errors render with `role="alert"` (`ReturnFinderView.tsx:299-303`).
- **Contrast/motion:** existing showroom styles (`showroom.css`); reduced-motion disables animations; focus rings use `--tap-spark`. No new contrast risk introduced (SHYGON's own `midnight` palette, white text on ink/accent; `sr-action-primary` uses accent on on-accent).

No new a11y finding.

---

## 6. Tests that would still pass if the UI were wrong

- `TapMode.test.tsx` mocks `fetch` at `/api/modes` and asserts `testid`s (`tm-lost`, `tm-lost-status`, `tm-active`), the exact `owner.activate` body (`mode`, `expectedVersion`, idempotency-key shape), and the op set sent (`['owner.info.get','owner.state']`). A UI that kept those `testid`s and API bodies but showed wrong copy, wrong colours, or leaked owner name in a non-testid element would pass most of these checks. The leak-specific assertions (`document.body.textContent` not containing `Asha Rao`) live in `ServerModes.test.tsx` (visitor page) — so the *public* leak surface is asserted, but the *owner* page's copy is only asserted via `testid` text, not a full snapshot.
- `ServerModes.test.tsx` asserts the Lost page sends no visitor event, no P-1, and no owner name in body/storage — this is a real, failing-if-broken assertion for the visitor leak surface.

The strongest coverage is the visitor-side leak assertions and the API-shape assertions; wording and visual layout beyond `testid` text are the parts a passing suite would not catch — hence the wording nits above are flagged for the owner's gate rather than blocked on a test.

---

## 7. Counts

- `npx vitest run`: **16 files, 154 passed, 0 failed** (exit 0)
- `npm run lint`: **clean**, 0 errors
- `npm run build`: **passed** (`tsc -b && vite build`)
- `npm run test:bundle`: **PASS — 86,104 B / 90,000 B** (3.90 kB remaining)
- Lost e2e journey (`STACK_APP_PORT=4473 STACK_GATEWAY_PORT=54621`): **passed** (full run + the dedicated "lost mode" test)
- a11y Lost page: **passed**, 0 serious/critical violations

---

## 8. Limits of this review

- The frontend commit was read with `git show`, then the tests/build/e2e were executed against the checked-out tree at `249c8d9`. No source, migration or test was changed.
- `npm run test:secrets` and `npm audit` were not re-run here; the commit reports them clean for this branch except pre-existing findings on other branches.
- One temporary network-trace spec was written, run, and removed (`e2e/_tmp_network.spec.ts`, plus its `test-results/` artifacts). Nothing in the repository was modified except this report file.
- Wording is draft: every string is correct against the checked table or a documented Q-L1..Q-L5 deviation; the owner approves final strings at the gate.

---

## Files reviewed (all under `src/`, read-only)

`src/pages/PublicTap.tsx`, `src/pages/TapMode.tsx`, `src/pages/TapMode.test.tsx`, `src/services/tapMode.ts`, `src/lib/publicTapClient.ts`, `src/lib/publicTapClient.test.ts`, `src/lib/publicRescueClient.ts`, `src/components/showroom/PublicLostPage.tsx`, `src/components/showroom/ReturnFinderView.tsx`, `src/components/showroom/PublicExperience.tsx`, `src/components/showroom/ServerModes.test.tsx`, `src/components/showroom/modes.ts`, `src/components/showroom/showroom.css`, `docs/v6/aaroh/api-contract.md` §6 & §10a, `docs/v6/aaroh/lost-mode-wording-map.md`, `e2e/aaroh-server-paths.spec.ts` (lost mode), `e2e/a11y.spec.ts` (Lost page).
