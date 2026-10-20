# DEC-2026-041: The AAROH mode model, and Info

| Field | Value |
|---|---|
| Decision ID | DEC-2026-041 |
| Title | Modes: one owner-chosen public experience per Tap (Business, Info), and the definition of Info |
| Date opened | 2026-10-20 |
| Revision | **3, 2026-10-20.** Records the Product Owner's conditional direction on revision 2. Adds production-drift findings from the local evidence file, a compatibility plan for older clients, the status of the seven mandatory checks, and the remaining blockers with their owners. |
| Domain | Product / Data / Privacy / Commercial |
| Level | L3 if approved (new tables, a new public read function, a later change to `get_public_profile`) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B), acting as Product Owner |
| Responsible (R) | Session A (AAROH backend). The schema and reuse path need the **Principal Architect, who is UNASSIGNED** (`docs/DECISIONS.md`). |
| Informed (I) | Session B (frontend) |
| Follows | DEC-2026-038 Q7, APPROVED 2026-10-19: "A, then B" |
| State | **PROPOSED. Conditional direction recorded; NOT implementation approval.** The owner: "Do not implement Info yet. Do not merge or deploy. I will review the evidence and approve the implementation scope separately." There is no migration 034 and no `/api/modes`; the public APIs are unchanged, and AAROH-API stays at v0.7. |

## How to read this record

**Decision status** (each decision item has exactly one):

| Status | Meaning |
|---|---|
| **APPROVED** | The owner decided this rule or exclusion on 2026-10-20. **It authorises no implementation.** Most approved items say what Info V1 will not do. |
| **CONDITIONALLY ACCEPTED** | The owner accepted the direction, subject to the named condition |
| **BLOCKED** | Cannot proceed until the named dependency is resolved, by the named owner |
| **PROPOSED** | Session A's recommendation, not yet decided |

**Evidence labels** (facts only):

| Label | Meaning |
|---|---|
| **OBSERVED** | Verified directly in this repository, a sibling checkout or a local evidence file, with a pointer. **Never** a check against live production: none was made. |
| **INFERRED** | Concluded from observed facts |
| **UNKNOWN** | Not knowable from what is on this machine |
| **OWNER** | The owner's own words (2026-10-20) |

**Info as a feature is not approved.** Only the listed rules and exclusions are.

---

## Decision table (revision 3)

| ID | Topic | Owner direction, 2026-10-20 | Status | Condition / blocker | Next-step owner |
|---|---|---|---|---|---|
| A0 | Relayed details (120/280 limits, category list) | "Treat … as unconfirmed until I explicitly confirm them" | **PROPOSED** (unconfirmed) | The owner's explicit confirmation | Product Owner |
| PQ-1 | One Info page per account in V1 | "Accept for V1, subject to the Principal Architect confirming how the current account-level Tap resolver supports it" | **CONDITIONALLY ACCEPTED** | The Principal Architect's confirmation. Note: production has an admin function that creates *additional* Tap pages (§0.11, F-4) | Principal Architect (UNASSIGNED) |
| PQ-1b | Per-card Info routing | "Do not build per-card Info routing yet" | **APPROVED** (exclusion) | — | — |
| PQ-2 | Visitor counts on Info | "No visitor counts for Info V1" | **APPROVED** (exclusion) | — | — |
| PQ-3 | Return-to-Owner, emergency, Connect buttons on Info | "Do not show these buttons on Info V1" | **APPROVED** (exclusion) | — | — |
| SQ-1 | A separate, structured Info record | "Approve the direction … not migration approval" | **CONDITIONALLY ACCEPTED** | The Principal Architect finalises the schema after reviewing production drift and the planned Locations model | Principal Architect (UNASSIGNED) |
| SQ-2 | Production `page_template` and card-family features | "Investigate … before any production schema or resolver change" | **BLOCKED** for any production change | Purpose found in local evidence (§0.11). Origin UNKNOWN. A fresh production capture is needed to verify. | Repository owner (capture; origin) + Principal Architect |
| SQ-2b | Existing production behaviour | "Preserve existing behavior until understood" | **APPROVED** (rule) | — | — |
| SQ-3 | Image upload | "No Info image upload in V1" until storage is established and verified | **APPROVED** (exclusion) | — | — |
| SQ-4 | Language field | "No new language field in Info V1" | **APPROVED** (exclusion) | Revisit with a multilingual content model | — |
| CQ-1 | Does the 14-day Terms rule cover Business only? | "Do not unilaterally change the Terms. Ask the appropriate legal reviewer to clarify" | **BLOCKED** | A legal reviewer's clarification. DEC-2026-017 (counsel) has its Data Owner UNASSIGNED; no counsel is engaged. | Repository owner (engage reviewer) |
| CQ-1b | Marketing claims | "Until resolved, do not advertise Info as free and unlimited" | **APPROVED** (rule) | — | — |
| CQ-2 | Action / custom links on Info | "Exclude custom/action links from Info V1 … Revisit through an explicit commercial decision" | **APPROVED** (exclusion) | A later commercial decision | Product Owner |
| CQ-3 | Compatibility with future SHYGON Locations | "Designed so it can support the future Locations model … do not merge the products or promise organisation-level functionality" | **CONDITIONALLY ACCEPTED** (design) + **APPROVED** (no merge, no org promise) | The Principal Architect documents the reuse path; Session A's draft is in §0.9 | Principal Architect (UNASSIGNED) |
| AQ-1 | Viewer roles | Anonymous visitors and the authenticated owner only | **APPROVED** (rule) | — | — |
| AQ-2 | Status validation | Validate the Tap's status server-side; "Do not claim card-level validation exists today" | **APPROVED** (rule). Card-level validation: **BLOCKED** | A real card registry (`/d/<code>`, contract P-4) | Repository owner (card registry decision) |
| BQ-1 | Changing the legacy `get_public_profile` | "Do not change the production public-profile function until the production schema and current callers have been verified and a compatibility plan is approved" | **BLOCKED** | (1) a fresh production capture; (2) the callers verified; (3) the compatibility plan (§0.12) approved | Repository owner |
| BQ-2 | Fallback | Neutral **unavailable** page when Info is disabled, missing or invalid; "Never silently expose the Business profile" | **APPROVED** (rule) | — | — |
| BQ-3 | Business link | "No automatic Business name, photo or link on Info V1" | **APPROVED** (exclusion) | — | — |
| RQ-1 | Save quota | "Do not invent a fixed quota. Before release, assess abuse risk and implement proportionate server-side protection if needed" | **CONDITIONALLY ACCEPTED** | A pre-release abuse assessment (§7) | Session A (assessment) → owner (acceptance) |
| M-1 | The mode model (C-1: one active mode per Tap, Business default) | Accepted for V1 through PQ-1 | **PROPOSED** (implementation scope to be approved separately) | Mandatory checks 1–7 | Repository owner |
| M-2 | Price: Info free, no new SKU | "Keep this recommendation PROPOSED pending … approval" | **PROPOSED** | Commercial approval; CQ-1 | Product Owner |
| M-3 | New records (`info_pages`, `tap_mode_state`, `tap_mode_catalog`, `tap_mode_audit`), the `get_public_tap` function, `/api/modes` | — | **PROPOSED** | SQ-1 and the Principal Architect | Principal Architect (UNASSIGNED) |
| M-4 | Implementation (migration 034, API, tests, contract v0.8) | "Do not implement Info yet" | **BLOCKED** | Mandatory checks 1–7 (§0.13), then the owner's implementation-scope approval | Repository owner |

**Info V1's content after these decisions** [PROPOSED shape, under SQ-1 / A0]:
- required: **title**, **short description**;
- optional: **category**, **detailed information** (plain text);
- system: **publication status** (server-computed) and **last updated** (server timestamp).

There is no image, no language field, no links, no Business data, no visitor counts and no capability buttons.

---

## Earlier revisions (summary)

- **Revision 1** (`ef2d976`): the model, with Info undefined (Q0).
- **Revision 2** (`7380a6e`): the owner's Q0–Q7 answers recorded as direction. Facts on `/t/<slug>`, caching, products and Terms. Conflicts CQ-1 to CQ-3. Fallback changed to "unavailable"; no invented quota.
- **Revision 3** (this one):
  - the decision table above;
  - production-drift findings (§0.11);
  - the Terms and entitlement conflicts, with production evidence (§0.8);
  - the compatibility plan (§0.12);
  - the mandatory checks (§0.13);
  - blockers and owners (§16).

---

## 0. Facts

### 0.1 How `/t/<slug>` resolves today [OBSERVED in this repository]

1. **Hosting.** `/t/*` and `/tap/*` are served as the app shell:
   - `vercel.json:151, :155`;
   - `netlify.toml:249–257`, where `/tap/` is kept for old links.
2. **Routes.** `src/App.tsx:39–40` → `PublicTap`.
3. **The read.** `PublicTap` (`src/pages/PublicTap.tsx:86–105`) calls `src/lib/publicTapClient.ts`.
   - That client sends a `fetch` POST to `/rest/v1/rpc/get_public_profile` with the anon key and gives up after 12 s.
   - It returns the payload or null.
4. **When there is no payload.** On null, the page calls `get_public_tap_state` (`active` / `paused` / `unavailable`).
   - `paused` shows "Temporarily unavailable".
   - **Every other state, including `active`, shows "Tap not found"** (`PublicTap.tsx:178–191`).
   - A network failure shows "offline" or "couldn't load".
5. **Analytics.** One `view` per landing, plus `nfc` / `qr` from `?src=`, through `record_tap_event`. Link clicks send `link_click`.
6. **Refresh.** The page re-resolves every 5 minutes (`:116`).
7. **What resolves.** One `tap_profiles` row per account (`UNIQUE(user_id)`, `idx_tap_profiles_user`, baseline line 4795), looked up by slug. No resolver uses a card, a device or a mode.
8. **Server functions.** None: the public page calls no `/api/*` endpoint on this branch.
9. **Sharing.** `navigator.share({ title: displayName, url })`, falling back to copying the URL to the clipboard (`:199–210`).

### 0.2 The public contract today [OBSERVED]

- **P-1 `get_public_profile`** returns the whitelisted Business payload, or null unless the Tap is `active` and not suspended.
  - Contact and link fields need the owner's switch plus an owned `customization` add-on (except phone and email).
  - The repository's live definition is the baseline's (no migration from 020 to 033 changes it).
- **P-2 `get_public_tap_state`** and **P-3 `record_tap_event`**.
- **Session B's branch (0ae7e47):**
  - the public page reads only P-1, P-2 and P-3 [OBSERVED with `git show`];
  - [OBSERVED with `git show`, commit c0e27a0, not pushed] `src/test/contract.test.ts` asserts that "the public Tap reads only the three published RPCs" (P-1, P-2, P-3), and that every `/api/emergency`, `/api/rescue` and `/api/connect` operation the frontend sends is documented in AAROH-API. Any new public read (for example `get_public_tap`) must update that test.

### 0.3 Caching, metadata, browser storage, errors [OBSERVED unless marked]

- **Caching.**
  - No `Cache-Control` rule on any path in either host configuration.
  - No service worker.
  - The public reads are POST requests.
  - [INFERRED] No shared cache holds Tap data.
- **Metadata.** Set in the browser by `usePageMeta`:
  - title `<displayName> | SHYGON Tap`;
  - description from headline, bio or role;
  - share image `avatarUrl`.

  Unavailable states use fixed text and `noindex`. There is no prerendering, and Taps are not in the sitemap.
- **Browser storage.** The public path writes nothing. The only storage access is `public/theme-init.js` *reading* the site's light/dark preference (`shygon_theme`), which is not Tap data.
- **Errors.** Every failed read becomes fixed visitor copy (`publicTapClient.ts:47–51`).

### 0.4 Card ownership and lifecycle [OBSERVED]

- `cards` rows carry the owner and `tap_profile_id`. Activation and deactivation need an OTP.
- **The public address is not bound to a card**, and F3 is open: deactivating a card does not hide the Tap.
- Cards are not sold ("coming soon"); the release is digital-first.
- `/d/<code>` is BLOCKED: there is no card registry.

### 0.5 Mode-like behaviour today

- [OBSERVED] **This repository** has no mode entity.
- [OBSERVED in the evidence file, §0.11] **Production** has `tap_profiles.page_template` and card-family features, which are mode-like.
- [OBSERVED] **Session B's showroom** uses "mode" for presentational sections shown together. Its `places` entry ("Information attached to a place or a thing", coming soon) is Info.

### 0.6 What the current repository schema can represent for Info [OBSERVED]

- **No object, place, device-registry or tag table.**
- **No content-language field;** the page language is fixed at `lang="en-IN"`.
- `tap_profiles` holds a person's profile.

Info needs new records.

### 0.7 Storage for images [OBSERVED]

- The repository uses `profile-images`, which is missing on production (V6-108).
- Production has `shygontap-photos`, of unknown provenance.
- Policies can be verified only on live (V6-095).

→ SQ-3 (excluded).

### 0.8 Terms and entitlement conflicts [OBSERVED; production rows from the evidence file]

| # | Source | What it says or does | Effect on Info |
|---|---|---|---|
| T-1 | Terms (`src/pages/legal/Terms.tsx:94`) | "You can change your Tap's content once every 14 days. The Customization Pass removes that limit…" | Unlimited Info edits on the same Tap contradict this wording → **CQ-1 BLOCKED** (legal reviewer); CQ-1b no "free and unlimited" claims |
| T-2 | Pass FAQ (`src/data/shygonTapData.ts:406–421, :460`) | "lets you change your Tap as often as you like"; "You can change your profile once every 14 days" | Same as T-1 |
| T-3 | **Production `card_family_pages`** (2026-10-11) | **Taps with an event or restaurant card are exempt from the 14-day window** ("Purpose-built pages need timely edits to dates, hours, addresses, menus, and RSVP/review links. Keep the normal edit limit for personal/business pages.") | **Production already contradicts the Terms as written** for card-family Taps. For the legal reviewer: precedent for a purpose-built page with no window. |
| E-1 | Repository: P-1 + `enforce_tap_edit_rules` + `fulfilment.mjs:192–195` | Website, Instagram, LinkedIn, YouTube, WhatsApp and custom links are **paid add-ons per key** (`addon-<key>`); only phone and email are free. Buying a tier grants no add-on. | Action links on Info would give the `links` add-on away → **CQ-2: links excluded** |
| E-2 | **Production `hide_unsupported_gallery_addon`**: `tier_buttons` | Production grants buttons **by tier**: essential = phone, email, WhatsApp; business = + Instagram, LinkedIn, website; premium and GOAT = + location, YouTube, custom links | **The repository and production disagree on what is paid.** The storefront copy ("Website and social links" in Business) matches production, not the repository. |
| E-3 | **Production `card_family_pages`**: `tap_card_features` | An event or restaurant card unlocks location, website and custom links **at every tier**; a Google Review card unlocks location and website | Production already gives links free with a purpose card. A precedent for the CQ-2 commercial decision, not a reason to change V1. |
| E-4 | **Production `admin_create_tap_page_and_page_templates`** | Deactivated products: transparent cards, `plan-pro`, `plan-3d`, `plan-custom`, `plan-lifetime`, `addon-gallery` | The commercial catalogue on production differs from the repository's |
| P-1 | Storefront: the Restaurant card | "Digital menu ready, Location and hours, Direct reservations" | [INFERRED] There is no reservation backend. Info must not repeat such a promise (OWNER Q0.2). |

**Who decides:**
- T-1 to T-3: the legal reviewer (CQ-1).
- E-1 to E-4: the Product Owner, at the rebaseline (which entitlement model is canonical) and at the later links decision (CQ-2).

### 0.9 The planned Locations model, and a draft reuse path

- [OBSERVED] Doc 03 proposes `locations` ("Physical place/object information nodes") and `location_content` (versioned, per-locale content). They are organisation-owned, reached from devices through `tap_routes`, in Phase 4. Doc 10 places them beside `plans` and `subscriptions`.
- [INFERRED] Info is the same concept, scoped to one account and one page.

**Draft reuse path** [PROPOSED, for the Principal Architect to confirm or replace]:
1. Info V1's record (`info_pages`) is the **content** of one place or object: title, short description, category, details, status, timestamps. It has its own id and an owner.
2. A future `locations` decision adds what V1 lacks:
   - organisation ownership (`org_id`);
   - a hierarchy (`parent_id`);
   - per-locale versions;
   - addressing from devices (`tap_routes` / `/d/<code>`).

   Either `locations` gains a reference to `info_pages`, or `info_pages` is renamed and extended into `location_content`. Either way, no second table holds the same title and description.
3. Nothing in V1 promises organisations, hierarchies, multiple languages or many pages [APPROVED, CQ-3].

### 0.10 Migration dependencies [OBSERVED / BLOCKED]

- A future 034 depends on the baseline and 020–033 (028, 030, 029/031/032); not on 027.
- For production it is BLOCKED by V6-106: the schema must be re-captured and the drift understood first (SQ-2, BQ-1).

### 0.11 Production-drift findings (SQ-2 investigation)

**Source:** `docs/governance/evidence/2026-10-18_production-schema-migrations.csv`, in the `shygon-tap-v5-web-rebaseline` checkout (untracked; 35,718 bytes; `version,name,statements`). The drift register (`codex-handoff/PRODUCTION_DRIFT.md`, commit adf0c06) says it was "recorded from production migration history by an earlier investigation".

Everything below is **OBSERVED in that evidence file**, not verified against live production. Nothing here was checked live, and the owner has not authorised live inspection.

| # | Finding | Evidence |
|---|---|---|
| F-1 | Seven production-only migrations, 2026-10-11 to 2026-10-15: `card_family_pages`, `hide_unsupported_gallery_addon`, `admin_create_tap_page_and_page_templates`, `rerun_admin_create_tap_page_repeatable`, `shygontap_studio_profiles_v1`, `shygontap_photo_cleanup_policy_v1`, `shygontap_site_content` | CSV rows; also `codex-handoff/PRODUCTION_DRIFT.md` (commit adf0c06) |
| F-2 | **`tap_profiles.page_template`**: `TEXT`, `NULL` or one of `business`, `restaurant`, `event`, `review`. Comment: "Page families are independent of visual layout and physical card finish." | `admin_create_tap_page_and_page_templates`; repeated in the `rerun…` migration |
| F-3 | **Production's `get_public_profile` returns an extra key, `pageTemplate`.** It also gates contact and link keys with `tier_buttons(tier)` and `tap_card_features(tap)` as well as owned add-ons, and gates `location` behind the same switch set. Grants: `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO anon`, `REVOKE EXECUTE FROM authenticated`. | Same migrations |
| F-4 | **`admin_create_tap_page`** (needs `tap.moderate`) creates an *additional* draft Tap page for an existing customer, with a page template, and notifies them. | Same migrations |
| F-4, can it run? [INFERRED] **Not today.** | (1) It calls `tap_slug_reserved` / `tap_slug_taken`, which exist in no repository (V6-106). (2) The baseline's unique index `idx_tap_profiles_user` allows one Tap per account, and none of the seven migrations drops it, so a second page for an existing customer would be refused. | — |
| F-5 | **Card families** (`tap_card_features`): event and restaurant cards unlock location, website and links; Google Review cards unlock location and website, at every tier. Card-family Taps are **exempt from the 14-day window**. `tap_page_edit_state` reports `card_family`. | `card_family_pages` |
| F-6 | `tier_buttons` grants contact and link buttons by tier. The gallery add-on is withdrawn because there is no renderer. | `hide_unsupported_gallery_addon` |
| F-7 | Products deactivated: transparent cards, `plan-pro`, `plan-3d`, `plan-custom`, `plan-lifetime`, `addon-gallery` | `admin_create_tap_page_and_page_templates` |
| F-8 | `shygontap_*`: a separate corporate-site profile system (`shygontap_profiles`, photos, site content) | CSV names; V6-107 |
| F-9 | **Production had 0 Taps** on 2026-10-18 | Backlog V6-109 (a reported read-only finding, re-verify at capture) |

**Purpose** [INFERRED from F-2 to F-6]:
- `page_template` and card families are a **production-only "page family" mechanism**: purpose-built Tap pages (restaurant, event, review) with their own buttons and edit rules, selected per Tap page and created by administrators.
- **This is a mode-like concept that overlaps this DEC's model and Info's restaurant-table use case.**

**Origin** [UNKNOWN]:
- The SQL says what the migrations do, not who or what applied them ("owner input only", per the drift register).

**What this means for DEC-2026-041** [PROPOSED]:
- The Principal Architect must decide, with the owner, whether production's page-family mechanism becomes canonical at the rebaseline or is reverted.
- If it becomes canonical, **Info should probably be a page family** (e.g. `page_template = 'info'`) **rather than a parallel mode table**: two mechanisms that choose what a Tap page is would be a duplicate model.
- Until then the mode-state design (M-3) stays PROPOSED and must not be written for production [APPROVED SQ-2b: preserve existing behaviour].

### 0.12 Compatibility plan for older clients (BQ-1) [PROPOSED; approval required]

**Who calls `get_public_profile`:**

| Caller | Evidence | Status |
|---|---|---|
| This repository's public page (`publicTapClient.ts`) | Code | OBSERVED |
| Session B's branch (0ae7e47) | `git show` | OBSERVED |
| The Expo admin app (`../shygon-tap-v5-admin`, local copy) | No reference found | OBSERVED (local copy only; the deployed build is UNKNOWN) |
| The production corporate site | Reads `shygontap_profiles` (V6-107); whether it also calls P-1 is unknown | UNKNOWN |
| Anything else on production | — | UNKNOWN until the capture and logs are reviewed (owner) |

**The plan:**
1. **Re-pin the contract first.** At the rebaseline, the owner decides whether production's P-1 (with `pageTemplate`, tier buttons and card features) or the repository's P-1 is canonical, and the golden test is re-pinned to it.
2. **No behaviour change until approved.** Info stays switched off in the mode catalogue in every non-local environment until BQ-1 is approved and the P-1 change is applied.
   - So no Tap can be on Info while P-1 would still serve its Business payload (BQ-2 holds).
   - And no older client sees any difference before then.
3. **The single change, when approved.** P-1 gains one condition: return null when the Tap's active mode is not Business. The shape is unchanged, and every Tap not on Info returns byte-identical payloads (golden test).
4. **What an older client shows.** For a Tap on Info: P-1 returns null, then P-2 returns `active`, so the page shows the existing **"Tap not found"** (`PublicTap.tsx:186–190`, with `noindex`). Nothing leaks, and no new copy is needed.
   - Optional: P-2 could answer `unavailable` for Info Taps, which reads the same. Not recommended; it changes a second frozen function.
5. **New clients** call `get_public_tap` first, and fall back to P-1 only if the function does not exist yet (PostgREST 404). So the frontend can deploy before the backend.
6. **Rollback.** Switch Info off in the catalogue (Taps on Info show "unavailable", per BQ-2), then remove the P-1 condition. Business payloads are unaffected throughout.
7. **Tests:**
   - the golden P-1 for Taps not on Info;
   - an older-client simulation (P-1 null plus P-2 `active` renders "Tap not found");
   - the new client's fallback;
   - the canaries (§13).

### 0.13 Mandatory checks before implementation approval (owner §2)

| # | Check | Status | Evidence / gap | Owner |
|---|---|---|---|---|
| 1 | Origin and purpose of `page_template` and card-family pages | **Purpose: done** from local evidence (§0.11). **Origin: UNKNOWN.** **Live verification: BLOCKED** (not authorised) | F-1 to F-9 | Repository owner (origin; authorise the capture) |
| 2 | Capture and verify the current production schema | **Not done: BLOCKED** on the owner's fresh schema dump. The rebaseline validation is prepared on `v6/rebaseline-2026-10-18`. | V6-106 | Repository owner (Data Owner) |
| 3 | Trace `/t/<slug>` end to end | **Done for this repository and Session B's branch** (§0.1–0.4). **The production site's app is UNKNOWN** (its source is not on this machine, V6-107). | §0.1–0.3 | Session A (done); repository owner (production app source) |
| 4 | No duplicate of Locations | **Draft reuse path** (§0.9), plus the page-family finding (§0.11). Needs the Principal Architect. | §0.9, §0.11 | Principal Architect (UNASSIGNED) |
| 5 | Terms and paid-link conflict | Links: **resolved for V1** by exclusion (CQ-2). Terms: **BLOCKED** (CQ-1). Production already exempts card-family Taps (T-3). | §0.8 | Repository owner → legal reviewer |
| 6 | Negative tests for leaks through API, page, metadata, caches, storage, errors | **Defined** (§13), not written | §13 | Session A (API and DB), Session B (page, metadata, storage) |
| 7 | Compatibility for older P-1 callers | **Plan drafted** (§0.12), PROPOSED | §0.12 | Repository owner (approve) |

---

## 1. Mode name and purpose

| Item | Statement | Label |
|---|---|---|
| The model | One SHYGON-defined public experience is active per Tap (per account in V1) | PROPOSED (M-1) |
| The word | `mode` in the schema and API; never `experience` (the paid tier). The showroom's presentational "modes" and production's `page_template` are different things that must be reconciled (§0.5, §0.11). | OBSERVED (collisions); PROPOSED |
| Business | The existing public profile at `/t/<slug>`: the default, unchanged | OBSERVED; OWNER |
| Info | A public information page about a physical object, product, place or service point, updated without replacing the tag. Not a personal identity, medical profile, student passport or Business profile. | OWNER (Q0.1, Q0.2) |
| Not modes | Emergency, Return-to-Owner, Connect, Privé | OBSERVED; APPROVED (DEC-038, 039, 040) |

## 2. The problem Info solves

- [OWNER] It answers "What should I know or do about this thing or place?": opened in a browser by NFC or QR, in the right physical context, maintained centrally, changeable after the tag is issued, with no app.
- [PROPOSED] It passes the admission test on two criteria:
  - a stable physical tap point whose content changes on the server;
  - the server decides what is public.
- [APPROVED, PQ-2] **No visitor counts.**
- [OWNER] Integrations, booking, payments, device control and analytics are not promised.

## 3. Viewer roles

[APPROVED, AQ-1]:
- **Public visitor:** published Info fields only, while the Tap is active, unsuspended and on Info.
- **Authenticated owner:** manages their own Info and previews the exact public view.
- **No other roles.** No Friend, School, Organisation or emergency role exists or is introduced. [OBSERVED] None of them has a server-side authorization model.

[PROPOSED] No role ever comes from a URL, query, header, body field or frontend flag.

## 4. Journeys [PROPOSED]

**Owner:**
1. Opens Modes, where the server answers `active`, `ready`, `needs_setup` or `not_available` for each mode.
2. Edits Info in a structured form; "Saved" appears only after the server confirms.
3. Previews the exact public view.
4. Activates Info; "Live" appears only after the server confirms.
5. Can switch back to Business the same way.

**Visitor:**
1. Lands on `/t/<slug>`.
2. Sees Info (title, short description, optional category and details, "Last updated"), or Business, or the neutral "unavailable" page.
3. **No capability buttons on Info** [APPROVED, PQ-3].

## 5. Relationship with Business [CONDITIONALLY ACCEPTED, PQ-1; PROPOSED mechanism]

- **C-1:** one active mode per account. Business is the default; with no mode selection, nothing changes.
- **Per-card routing:** not built [APPROVED, PQ-1b].
- **Multi-mode display:** not built [OWNER].
- **While Info is active, the account's Business is not public** [INFERRED consequence; accepted for V1 through PQ-1].
- **No Business name, photo or link on Info** [APPROVED, BQ-3].
- [PROPOSED, for the Principal Architect] With production's page families (§0.11), the cleaner V1 may be "Info is a page family of the Tap page" rather than a separate mode switch. The decision belongs to SQ-1 / SQ-2.

**Options compared** [PROPOSED analysis]:

| Option | Public journey | Privacy | Card configuration | Business behaviour |
|---|---|---|---|---|
| A. Info replaces Business while active | The tag lands on Info | One set of fields public at a time | None | Unchanged when Business is active |
| B. Info alongside Business | The tag lands on Business; Info one link away | Info is public whenever Business is | None | Unchanged |
| C. Per card (optionally several) | Each card can differ | As A, per card | Needs the card registry: BLOCKED | Unchanged |
| S2. Info pages with their own addresses (separate decision) | Business untouched; each Info on its own address | Independent | Tag provisioning | Unchanged |

## 6. Content schema [CONDITIONALLY ACCEPTED direction, SQ-1; field details PROPOSED]

The Principal Architect finalises this.

| Field | Rule | Status |
|---|---|---|
| `title` | Required, plain text. **The limit is unconfirmed** (relayed 120). | PROPOSED (A0) |
| `short_description` | Required, plain text. **The limit is unconfirmed** (relayed 280). | PROPOSED (A0) |
| `category` | Optional, from an allowlist. **The list is unconfirmed** (relayed: place, product, equipment, exhibit, service point, instructions). | PROPOSED (A0) |
| `detailed_information` | Optional, plain text with line breaks; no HTML or markup links. The maximum length is the Principal Architect's call. | PROPOSED |
| `publication_status` | Server-computed: `draft` / `ready` / `live` / `unavailable`. Never written by the client. | PROPOSED (owner: server-controlled) |
| `updated_at` | Server timestamp, shown as "Last updated" | PROPOSED (owner: system-generated) |
| Image | **Excluded from V1** | APPROVED (SQ-3) |
| Language | **Excluded from V1** | APPROVED (SQ-4) |
| Action / custom links | **Excluded from V1** | APPROVED (CQ-2) |
| Business name, photo, link | **Excluded** | APPROVED (BQ-3) |
| Maps, bookings, contact databases, file sharing, forms | Excluded without a separate decision | OWNER (relayed); PROPOSED |

- The record has its own id; **one per account in V1** [CONDITIONALLY ACCEPTED, PQ-1].
- It reads no `tap_profiles` content, `profiles.*`, emergency, rescue, Connect or Privé data, and no admin notes [PROPOSED].

## 7. Editing and abuse protection

**Who edits and when** [OWNER]:
- the authenticated owner of the Tap only;
- **no 14-day window** on Info.

**No fixed quota** [CONDITIONALLY ACCEPTED, RQ-1]. The rationale (from revision 2) [OBSERVED]:
- Every existing limit protects something that sends messages, reaches other people or costs money: 025, 029, 031, 032, 033.
- Owner-only edits have no throttle; Pass holders save Business without limit.

**Pre-release abuse assessment** [PROPOSED method, to be run before release]:
1. Measure save and switch payload sizes and write costs on the local stack.
2. Model a scripted owner loop: the write rate, the growth of audit rows, and the effect on the public read path.
3. Review moderation reach: a whole-Tap suspension (028) covers Info.
4. Record the conclusion: either no limit needed, or a proportionate ceiling with its derivation.

The owner accepts the result.

## 8. Switching, lifecycle and fallback

- **Switching** [PROPOSED]:
  - owner only, in one transaction;
  - `expectedVersion` and an idempotency key;
  - audited (field names only);
  - "Live" only after the server confirms.
- **Lifecycle:**
  - the Tap's status is checked server-side [APPROVED, AQ-2];
  - card-level checks are BLOCKED until a card registry exists and are never claimed [APPROVED, AQ-2].
- **Fallback** [APPROVED, BQ-2]. The tests are written first at implementation.

| Situation | Public result | Test |
|---|---|---|
| Info switched off by SHYGON while a Tap is on it | Neutral "unavailable"; the owner is told and can switch to Business themselves | F-1 |
| Info record **missing** (deleted, or never created) while the mode says Info | Neutral "unavailable" | F-2 |
| Info record **invalid** (fails today's validation, or content removed by moderation) | Neutral "unavailable" | F-3 |
| Unknown or retired mode value | Neutral "unavailable" | F-4 |
| Tap paused or suspended | As today | F-5 |
| Clearing a required field while Info is live | Refused (`mode_active`) | F-6 |

**Never** Business as a fallback.

## 9. Privacy and authorization

R = read, W = write, — = never. Roles that do not exist are treated as public visitors [APPROVED, AQ-1].

| Data | Public visitor | Owner | Admin / support | Label |
|---|---|---|---|---|
| Active mode name | R | R/W | R (audited) | PROPOSED |
| Info published fields, Tap active, unsuspended and on Info | R | R/W | R (audited) | PROPOSED |
| Info draft, or a record while the Tap is not on Info | — | R/W | R (audited) | PROPOSED |
| Business fields, Business active | R (per switches and entitlements) | R/W | R | OBSERVED |
| Business fields while Info is active | — | R/W | R | PROPOSED (needs BQ-1) |
| Account profile, emergency, rescue, Connect, Privé, admin notes, ids, tokens | — | Their own functions | Their admin functions | OBSERVED |
| Mode audit (field names only) | — | R (own) | R | PROPOSED |

Every item on the owner's "must never appear" list is mapped to a negative test (§13).

## 10. Pricing and entitlement

- **Info is free with no new SKU:** PROPOSED (M-2), pending commercial approval.
- **Not advertised as "free and unlimited"** until CQ-1 is resolved [APPROVED, CQ-1b].
- **Links stay a paid Business add-on** and are absent from Info [APPROVED, CQ-2].
- **The entitlement model differs between the repository and production** (E-1 to E-4). The rebaseline decision fixes which one is canonical before any Info pricing claim.

## 11. Records, APIs, transitions [PROPOSED, M-3; production BLOCKED, BQ-1 / SQ-2]

- **Records:**
  - `tap_mode_catalog` (the kill switch);
  - `tap_mode_state` (no row = Business);
  - `info_pages` (§6);
  - `tap_mode_audit`.

  All four are closed to client roles (the 029–033 pattern). **May become a `page_template` value instead** (§0.11).
- **Public read:** a new anonymous function, `get_public_tap(p_slug)`. The P-1 change is BLOCKED (§0.12).
- **Owner API:** `POST /api/modes`:
  - `owner.state`, `owner.activate { mode, expectedVersion, idempotencyKey }`;
  - `owner.info.get`, `owner.info.save { fields, expectedVersion }`, `owner.info.clear`;
  - `owner.preview { mode }`.

  Errors are `{ error: { code, message } }` with fixed messages: `unauthorized` 401, `no_tap` 404, `tap_suspended` / `mode_unavailable` / `needs_setup` / `stale_version` / `mode_active` 409, `not_entitled` 403, `invalid_field` 422.
- **Transitions:**
  - Business → Info needs a valid record;
  - Info → Business is always allowed;
  - the kill switch, a missing record or an invalid record makes the Tap unavailable, never Business;
  - Tap status and suspension always win.
- **Account deletion:** the runbook removes the rows, proven by a negative control.

## 12. Failure, abuse and recovery [PROPOSED]

| Case | Handling |
|---|---|
| A claimed viewer role in a URL, query, header or body | Ignored; the public answer is returned |
| Cross-tenant read, save, preview or activate | 0 rows / `no_tap`; the owner check is in SQL |
| Concurrent or duplicate switches | `stale_version`; idempotent replay |
| A switch while suspended | Refused |
| A partial failure during a switch | One transaction; the previous mode stays |
| Getting around Business's window or paid add-ons through Info | Info has no Business fields, no contact fields and no links (CQ-2) |
| Scripted save or switch loops | Pre-release assessment (RQ-1); audited |
| SHYGON must pull Info | Kill switch, which makes the Tap unavailable (BQ-2) |
| Abusive content | The existing whole-Tap moderation suspension (028) |
| Production page families collide with modes | BLOCKED until §0.11 is resolved (SQ-2); production behaviour preserved (SQ-2b) |
| An older client loads a Tap on Info | Shows "Tap not found" (§0.12), no leak |
| A bad migration | Tested ROLLBACK; idempotent |
| Account deletion | The runbook, with a negative control |
| The UI shows a switch that did not happen | "Live" only after the server answers |

## 13. Negative tests and acceptance (mandatory check 6) [PROPOSED; defined, not written]

**Canaries.** Unique strings are placed in:
- `profiles.*`;
- Business fields that are switched off;
- Business fields while the Tap is on Info;
- an unpublished Info draft;
- emergency contacts and alerts, rescue threads, Connect grants, Privé requests and admin notes.

| Surface | Test | Writer |
|---|---|---|
| Public API | No canary in `get_public_tap`, P-1, P-2 or `record_tap_event` responses, for every Tap state and mode | Session A (`test:modes`) |
| Error responses | No canary and no submitted value in any error body, for each failure code (anonymous and owner) | Session A |
| Rendered page | No canary in the DOM of `/t/<slug>`, in every mode and state | Session B (e2e) |
| Metadata | No canary in the title, description or share tags; unavailable states are `noindex` | Session B (e2e) |
| Caches | No shared-cache directive on any public response; no service worker | Session A (headers) + Session B (e2e) |
| Browser storage | After a visit, `localStorage`, `sessionStorage` and IndexedDB hold no canary (only the site theme preference) | Session B (e2e) |

**Functional tests:**
1. Without mode state, P-1's payload is identical (golden).
2. Activating an invalid Info returns `needs_setup`.
3. Activating a valid Info shows only the allowlisted fields.
4. Switching back restores the identical Business payload.
5. Paused or suspended Taps are unavailable in every mode.
6. Cross-tenant attempts are refused.
7. The anonymous role cannot call owner functions, and the rls-matrix shows NONE.
8. A claimed role is ignored.
9. Stale versions and idempotent replays behave as specified.
10. An Info save leaves `tap_profiles` untouched.
11. Clearing a required field while Info is live is refused (`mode_active`).
12. The fallbacks F-1 to F-6.
13. Account deletion removes the rows (negative control).
14. The ROLLBACK works.
15. The `admin-contract` states are correct.
16. Field validation: plain text and the unconfirmed limits.
17. The older-client simulation (§0.12).

**Regression:** test:db, public-tap, suspension, emergency, rescue, connect and prive stay green.

## 14. Alternatives and trade-offs

| Decision | Options | Current position | Trade-off |
|---|---|---|---|
| Relation to Business | A / B / C staged / S2 | C-1, CONDITIONALLY ACCEPTED (PQ-1) | One Info per account; Business hidden while Info is active |
| Mechanism | A mode table / a production page family (`page_template = 'info'`) | **Open: the Principal Architect, after SQ-2** | A mode table duplicates page families if those become canonical; adopting page families inherits unknown-origin code |
| Info storage | Own addressable record / `tap_profiles` columns / jsonb | Own record, CONDITIONALLY ACCEPTED (SQ-1) | One more table; a clean reuse path to Locations |
| Public read | P-1 null rule + `get_public_tap` / leave P-1 / function hop | PROPOSED; P-1 change BLOCKED (BQ-1) | A frozen-contract change, gated by the compatibility plan |
| Fallback | Business / unavailable | Unavailable, APPROVED (BQ-2) | A tap shows nothing until the owner acts |
| Limits | An invented quota / an assessed one | Assessed, CONDITIONALLY ACCEPTED (RQ-1) | A pre-release assessment is needed |
| Links | Free / existing add-on / none | None, APPROVED (CQ-2) | A thinner V1; no paid-feature bypass |

## 15. Recommendation [PROPOSED]

**Proceed only to the evidence steps:**
1. The owner authorises and supplies the fresh production schema capture (check 2), and states the origin of the page-family migrations if known (check 1).
2. The owner assigns the **Principal Architect**, who decides between "mode table" and "page family" for Info (§0.11), confirms PQ-1 and SQ-1, and documents the Locations reuse path (check 4).
3. The owner engages the **legal reviewer** for CQ-1 (check 5).
4. The owner approves the compatibility plan (check 7) or amends it.

Then Session A brings a final implementation scope (migration, API, tests, contract v0.8) for separate approval. Nothing is implemented until then.

## 16. Remaining blockers and owners

| # | Blocker | Blocks | Owner |
|---|---|---|---|
| BL-1 | A fresh production schema capture; verify drift F-1 to F-9 and P-1's callers | BQ-1, SQ-2, check 2, any production change | Repository owner (Data Owner) |
| BL-2 | The origin of the 2026-10-11 to 10-15 production migrations | Check 1 (origin) | Repository owner |
| BL-3 | **The Principal Architect is UNASSIGNED** | PQ-1, SQ-1, CQ-3, M-3, the mode vs page-family choice | Repository owner (assign, or act in the role) |
| BL-4 | Legal review of the 14-day Terms wording (DEC-2026-017; Data Owner UNASSIGNED; no counsel engaged) | CQ-1, any "free/unlimited" claim | Repository owner → legal reviewer |
| BL-5 | Approval of the compatibility plan (§0.12) | BQ-1 | Repository owner |
| BL-6 | Confirmation of the relayed limits and categories | A0, §6 field limits | Product Owner |
| BL-7 | Commercial approval of "Info free, no SKU" | M-2 | Product Owner |
| BL-8 | A card registry (`/d/<code>`) | Card-level validation (AQ-2), per-card routing | Repository owner (card decision) |
| BL-9 | The pre-release abuse assessment | RQ-1 | Session A, then owner acceptance |
| BL-10 | The owner's implementation-scope approval | M-4 (034, `/api/modes`, tests, contract v0.8) | Repository owner |

**Outside this DEC, recorded only:**
- the Business tier's "Website and social links" copy versus the repository's add-on gating (E-1 / E-2);
- the Restaurant card's "Direct reservations" promise.

## Expected result vs observed result

To be filled at verification.
