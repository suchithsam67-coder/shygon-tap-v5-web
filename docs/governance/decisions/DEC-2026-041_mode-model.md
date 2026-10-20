# DEC-2026-041: The AAROH mode model, and Info

| Field | Value |
|---|---|
| Decision ID | DEC-2026-041 |
| Title | Modes: one owner-chosen public experience per Tap (Business, Info), and the definition of Info |
| Date opened | 2026-10-20 |
| Revision | **2, 2026-10-20.** Records the Product Owner's answers to Q0–Q7. Documents the current `/t/<slug>` resolution, contract, caching, migration dependencies and backward compatibility, then revises the recommendation (see "Decision diff"). |
| Domain | Product / Data / Privacy / Commercial |
| Level | L3 if approved (new tables, a new public read function, a new "returns null" rule on `get_public_profile`) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B), acting as Product Owner |
| Responsible (R) | Session A (AAROH backend). The schema needs the Principal Architect's confirmation (owner, Q0.3). |
| Informed (I) | Session B (frontend) |
| Follows | DEC-2026-038 Q7, APPROVED 2026-10-19: "A, then B" |
| State | **PROPOSED. NOT APPROVED.** The owner's answers are "product direction confirmed for drafting"; the DEC "remains PROPOSED until formally reviewed and approved. No implementation is authorized." Nothing is built: no migration 034, no `/api/modes`, no contract change (AAROH-API stays v0.7), no test for the new behaviour. |

## How to read this record

| Label | Meaning |
|---|---|
| **[OBSERVED]** | Verified directly in this repository's code, schema or documents, with a pointer |
| **[INFERRED]** | Concluded from observed facts, not verified directly |
| **[OWNER]** | The Product Owner's answer of 2026-10-20: direction for drafting, **not an approval** |
| **[OWNER, relayed]** | Owner text that reached Session A through Session B, not in this session. Consistent with [OWNER]; **the owner should confirm it** |
| **[PROPOSED]** | Session A's recommendation, needing approval |
| **[APPROVED]** | Decided by the owner earlier, with the record |
| **[UNKNOWN]** | Not knowable from this repository today |
| **[BLOCKED]** | Cannot proceed until the named dependency is resolved |

Technical facts are always OBSERVED, INFERRED or UNKNOWN. Product decisions are always OWNER, PROPOSED or APPROVED. **Nothing about Info is APPROVED.**

---

## Decision diff (revision 1 → revision 2)

| # | Item | Revision 1 | Revision 2 | Why |
|---|---|---|---|---|
| D1 | What Info is | OWNER TO DEFINE | A public information page attached to a physical object, product, place or service point. It is not a personal profile and not a replacement for Business. | [OWNER] Q0.1 |
| D2 | Info's fields | Open | Required: title, short description. Optional: detailed information, image, category, language, action links. Server-controlled: publication status, last updated. | [OWNER] Q0.3 |
| D3 | Image | (not discussed) | **BLOCKED** on the storage reconciliation (V6-108 / V6-095) | §0.7: no approved storage path on production |
| D4 | Language | (not discussed) | **Deferred**: the existing content architecture has no content-language field | The owner's condition "if supported by the existing content architecture" is not met (§0.6) |
| D5 | Action links | "Only if Q0.3 includes any" | Listed by the owner, but **in conflict with the paid `links` add-on**. Commercial question CQ-2. | §0.8: on Business, custom links, website, social and WhatsApp are paid add-ons |
| D6 | Info's data shape | One row per Tap, keyed by `tap_profile_id` | **Its own addressable record** (its own id; one per account in v1). The Tap's mode state points to it. | Avoids a second model when the planned `locations` arrive (§0.9) and when per-tag pages are decided |
| D7 | Save and switch limits | 30 saves/hour, 20 switches/hour | **No fixed quota.** Abuse protection without one; the rationale comes from the existing limits (§7) | [OWNER] Q0.6: "Do not invent a fixed save quota without evidence and a documented rationale" |
| D8 | Fallback when Info is disabled or invalid | Serve Business | **Serve the neutral "unavailable" page, never Business.** The owner is told and can switch to Business themselves. | [OWNER] Q0.7: Business must not become public automatically |
| D9 | Business name/photo reuse | Referenced, behind `show_name` / `show_photo` | **Removed from v1.** No Business field is read by Info. | [OWNER] Q0.5: "Not automatically"; a reference to a published Business needs a resolver change (§5) |
| D10 | Business attribution/link | (not discussed) | **Not in v1. Separate decision.** | Under C-1, Business has no public address while Info is active (§5) |
| D11 | Price | "Available after setup, no charge" (recommended) | Still recommended, but **not approved**, and conditional on CQ-1 and CQ-2 | [OWNER] Q3/Q5; §10 lists conflicts with existing promises |
| D12 | Card lifecycle on switching | Not addressed | The server enforces **Tap** lifecycle now. **Card** lifecycle is BLOCKED until the card registry exists. | §0.4: the public address is not bound to any card |
| D13 | Privacy tests | Canaries on API output | Canaries also on **page rendering, metadata, caches and error responses** | [OWNER] Q7 |
| D14 | Re-authentication for sensitive fields | Proposed for any Q0.4 field | **Dropped.** Info v1 is public-content-only, so no field is sensitive. | [OWNER] Q0.4 |

---

## Product Owner answers, 2026-10-20 (all [OWNER] or [OWNER, relayed]; none approved)

| Q | Answer (condensed) | Label |
|---|---|---|
| Q0.1 | Info is a dynamic information page attached to a physical object, product, place, location or service point: classrooms, libraries, exhibits, equipment, product tags, restaurant tables. It is not a second personal profile and not a replacement for Business. | OWNER |
| Q0.1 (extra) | "Support one public information page per configured Info experience." "Do not assume that the existing database already supports every object or location type; identify what the current schema can actually represent." Info is not "another personal identity, medical profile, student passport or Business profile". | OWNER, relayed |
| Q0.2 | Someone taps or scans a physical SHYGON tag and at once sees relevant information or instructions in a browser. Authorised owners update it without replacing the tag. It answers "What should I know or do about this thing or place?" No promise of integrations, booking, payments, device control or analytics unless each is implemented and verified. | OWNER (+ relayed wording) |
| Q0.3 | Required: title, short description. Optional: detailed information, image, category, language, validated action links. System-controlled: publication status, last updated. Validated content, never executable HTML. The Principal Architect confirms the final schema. | OWNER |
| Q0.3 (extra) | Title plain text, max 120. Short description plain text, max 280. Category one of: place, product, equipment, exhibit, service point, instructions. Detailed information is sanitised text. Image comes through the existing storage architecture. Action links are a label plus a validated URL, with no executable URL schemes. Language only "if supported by the existing content architecture". No maps, bookings, contact databases, file sharing or custom forms without a separate decision. | OWNER, relayed |
| Q0.4 | Public content only in v1. Never: private medical information, emergency details, children's sensitive information, identity documents, credentials, private files, access codes, internal admin notes. A physical tag grants no permission to disclose unrelated private information. | OWNER |
| Q0.4 (extra) | Do not use Info to bypass the privacy rules of Emergency Profile, Student Passport, Smart Identity or Business. Location details appear only when deliberately configured for public disclosure. | OWNER, relayed |
| Q0.5 | Do not copy Business data into Info automatically. An explicit Business attribution or link only if the existing authorization model safely supports it. Info must not bypass Business editing restrictions or paid entitlements. | OWNER |
| Q0.6 | The owner updates Info whenever necessary, behind authentication, ownership checks, validation and server-side abuse protection. Do not apply the 14-day window automatically. Do not invent a fixed save quota without evidence and a documented rationale. | OWNER |
| Q0.7 | One active mode at a time. Info shows its own published content. Business must not become public automatically whenever Info is active. Multi-mode display and per-card selection are separate decisions. | OWNER |
| Q0.7 (extra) | "If that requires a different resolver contract or another mode-composition rule, leave it for a separate decision rather than quietly expanding DEC-2026-041." | OWNER, relayed |
| Q1 | Staged C: one active mode per account, with Business as the default where no selection exists. No per-card selection until the card registry and ownership model support it. No multi-mode composition. | OWNER |
| Q2 | Keep Business unchanged. Prefer isolated, structured mode data and a server-authoritative active-mode selection, but mark them PROPOSED. Before recommending tables or `get_public_tap`, document the current resolution, contract, caching, migration dependencies and backward compatibility (done in §0). | OWNER |
| Q3 | Do not extend the paid Business customization entitlement to Info. Free availability is a recommendation, not an approved commercial decision; first confirm it does not conflict with existing products, promises or entitlements (done in §0.8 and §10). | OWNER |
| Q4 | Only an authenticated, authorised owner switches. The server enforces ownership, card lifecycle and any applicable entitlement. Switching is auditable and safe against stale or duplicate requests. Nothing is "live" until the server confirms. Define an explicit fallback for disabled or invalid modes and test it before implementation. | OWNER |
| Q5 | Recommend Info as free in the first release with no new SKU, if existing rules support it. It stays PROPOSED pending product/commercial approval. | OWNER |
| Q6 | Anonymous visitors see only published public content; owners manage their own. No Friend, School, Organisation or emergency viewer roles until each has a verified server-side authorization model. | OWNER |
| Q7 | Turn the prohibited-data rules into negative tests with private-field canaries. Verify that no canary appears through public APIs, page rendering, metadata, caches or error responses. | OWNER |

---

## 0. The current system, verified (answers Q2's prerequisite)

### 0.1 How `/t/<slug>` resolves today [OBSERVED]

1. **Hosting.** `/t/*` and `/tap/*` are served as the single-page app shell:
   - `vercel.json:151` and `:155`;
   - `netlify.toml:249–257`, where `/tap/` is "kept so links shared before the change keep resolving".
2. **Routes.** `src/App.tsx:39–40` maps `/t/:username` and `/tap/:username` to `PublicTap`.
3. **The read.** `PublicTap` (`src/pages/PublicTap.tsx:86–105`) calls `fetchPublicProfile(slug)` from `src/lib/publicTapClient.ts`.
   - That client sends a `fetch` POST to `<SUPABASE_URL>/rest/v1/rpc/get_public_profile` with the anon key, and gives up after 12 s.
   - It returns the payload or null.
4. **When there is no payload.** On null, `PublicTap` calls `get_public_tap_state`, which answers `active`, `paused` or `unavailable`. Suspended, draft and unknown Taps all read as `unavailable`.
   - A network failure is shown as "offline" or "couldn't load", never as "not found".
5. **Analytics.** One `view` per landing, plus `nfc` or `qr` when the URL has `?src=nfc` or `?src=qr`, sent through `record_tap_event` (`PublicTap.tsx:130–138`). Link clicks send `link_click`.
6. **Refresh.** The page re-resolves every 5 minutes while open (`PublicTap.tsx:116`).
7. **What resolves.** Only the account's single Tap: there is one `tap_profiles` row per account (`UNIQUE(user_id)`), looked up by slug.
8. **What does not exist.** No resolver uses a card, a device or a mode.

### 0.2 The public contract today [OBSERVED]

- **P-1 `get_public_profile(p_slug)`** returns the whitelisted Business payload, or null unless the Tap is `active` and not suspended (contract §3).
  - Each contact and link field is returned only if the owner switched it on in `enabled_customizations`. The keys are `whatsapp`, `website`, `instagram`, `linkedin`, `youtube` and `links` (= `customLinks`) (`000_live_baseline.sql` around line 2770).
  - `enforce_tap_edit_rules` lets an owner switch on only keys they own as `customization` entitlements, plus the free `phone` and `email`.
  - P-1 is a frozen contract (doc 12 §2).
- **P-2 `get_public_tap_state`** and **P-3 `record_tap_event`**: as above.
- **Definitions in the repository:**
  - P-1's live definition is the baseline's;
  - migrations 004, 005, 007 and 009 shaped it before the baseline;
  - **no migration from 020 to 033 changes it.**
- **Production has drifted** [OBSERVED, V6-106]. Since the baseline, production's `get_public_profile` and `enforce_tap_edit_rules` have changed, from a source absent from every repository on this machine.
  - What changed in them: **[UNKNOWN]**.
- **Frontend (Session B's branch, commit 0ae7e47)** [OBSERVED with `git show`]:
  - the public page still reads only P-1, P-2 and P-3;
  - Session B mentioned an automated check in `src/test/contract.test.ts`. That file is **not in 0ae7e47**: [UNKNOWN] until it is committed.

### 0.3 Caching and metadata [OBSERVED unless marked]

- **Response caching.**
  - Neither host configuration sets `Cache-Control` on any path; both set only security headers (`vercel.json` headers, `netlify.toml:22`).
  - No service worker is registered: searched `src`, `index.html`, `vite.config.ts` and `public`.
  - The public reads are POST requests, which browsers and CDNs do not cache by default.
  - [INFERRED] No shared cache holds a Tap's data. The payload lives only in the open page's memory, and a change shows on the next load or within 5 minutes.
- **Metadata.** `usePageMeta` sets the tab title, description and share image in the browser, from the payload:
  - title `<displayName> | SHYGON Tap`;
  - description from headline, bio or role;
  - image from `avatarUrl` (`PublicTap.tsx:36–47`).

  Unavailable states set fixed text and `noindex` (`:66–77`).
  - There is no server-side rendering or prerendering for `/t/*`, and Taps are not in the sitemap (`src/seo/build.ts:112`).
  - [INFERRED] A crawler that does not run JavaScript sees only `index.html`'s default tags.
- **Error responses.** The client turns every failed read into fixed visitor copy; "a Postgres detail can never reach a stranger" (`publicTapClient.ts:47–51`).

### 0.4 Card ownership and lifecycle [OBSERVED]

- **The `cards` table** has `user_id`, `customer_id`, `tap_profile_id`, `status` / `card_status`, activation columns and edition columns (baseline line 3204).
- **Card operations** (activate, deactivate) need the owner's OTP (contract §7, C-2).
- **The public address is not bound to a card.** `/t/<slug>` resolves the account's Tap whatever its cards' states, and deactivating a card does not hide the Tap (F3 / V6-034, deferred).
- **No cards are sold.** The site says "SHYGON NFC cards are coming soon" (`src/data/shygonTapData.ts:449, :465`), and the V6 release is digital-first (DEC-2026-035 D-2 and D-10).
- **AAROH `/d/<code>` is BLOCKED:** there is no card registry (contract P-4).

### 0.5 Mode behaviour today

- [OBSERVED] No mode entity exists in this repository's schema: no table, column or function.
- [UNKNOWN] **Production has `tap_profiles.page_template`, `tap_card_features`, `tap_page_edit_state` and `tier_buttons`.** They come from production-only migrations named `card_family_pages` and `admin_create_tap_page_and_page_templates` (V6-106; `codex-handoff/PRODUCTION_DRIFT.md` in commit adf0c06).
  - Their meaning and provenance are unknown.
  - **They may already be a page-type mechanism that overlaps this mode model.**
- [OBSERVED] Session B's showroom (0ae7e47, `src/components/showroom/modes.ts`) uses the word "mode" for **presentational sections** of the one Business payload, several shown at once: identity, business, contact, links, owner, and others.
  - It already lists **"Places and objects: Information attached to a place or a thing"** as `coming-soon` / `not-implemented`.
  - [INFERRED] That entry is Info. The showroom's "modes" are not the exclusive modes of this DEC.

### 0.6 What the current schema can represent for Info [OBSERVED]

- **Physical objects, places or service points: nothing.** There is no `locations`, object, device-registry or tag table.
  - `cards` describes a person's card, with an edition and `card_type`.
  - `tap_event_themes` describes date-bounded themes.
- **Info content: nowhere.** `tap_profiles` holds a person's profile. Storing Info in it would mean reusing person columns (display name, bio, avatar) for a thing, which the owner rejected (Q0.1, Q0.5).
- **Content language: no field.** The page language is fixed (`index.html`: `lang="en-IN"`), and no payload carries a language.

So Info needs new records. **Every object or place type the owner listed is a category value, not a schema of its own** [PROPOSED].

### 0.7 Storage for images [OBSERVED]

- The repository's editor uploads to `profile-images`, which **does not exist on production** (V6-108).
- Production has `shygontap-photos` instead (public, 5 MB, owner-folder writes), of unknown provenance (V6-106).
- Storage policies can be verified only on live (V6-095), and the storage scanner is an open item.

**There is no approved storage architecture for an Info image today: BLOCKED.**

### 0.8 Products, promises and entitlements that touch Info [OBSERVED]

| Source | What it says or does | Relevance |
|---|---|---|
| `entitlements` | `digital_plan` (essential / business / premium / goat), `customization` (add-on keys), `lifetime` (Customization Pass) | No mode or Info entitlement exists |
| `netlify/lib/fulfilment.mjs:176–195` | A tier purchase grants only the tier. An `addon-<key>` purchase grants `customization:<key>`. The Pass grants `lifetime`. | Links are add-ons, bought per key |
| P-1 + `enforce_tap_edit_rules` | Website, Instagram, LinkedIn, YouTube, WhatsApp and custom links (`links`) are paid add-ons; phone and email are free | **Info "action links" are functionally the paid `links` add-on** (CQ-2) |
| Storefront tiers (`shygonTapData.ts:348–385`) | Essential ₹0 ("Name and profile photo", "Phone and email"); Business ₹299 ("Website and social links", "Business information block"); Premium ₹599; GOAT ₹999 | Free Info must not deliver what these sell |
| Customization Pass FAQ (`shygonTapData.ts:406–421, :460`) | "lets you change your Tap as often as you like"; "You can change your profile once every 14 days" | Free unlimited Info edits on the same Tap blur what the Pass sells (CQ-1) |
| **Terms** (`src/pages/legal/Terms.tsx:94`) | "You can change your Tap's content once every 14 days. The Customization Pass removes that limit…" | **Contradicts unlimited free Info edits on the same Tap as written** (CQ-1) |
| Terms (`Terms.tsx:83`) | "Upgrades and the Customization Pass are one-time payments, not subscriptions." | No conflict with a free Info |
| Storefront cards (`shygonTapData.ts` ~160–205) | "Shygon Tap Restaurant": "Digital menu ready, Location and hours, Direct reservations"; "Event": "Event schedule, Registration links"; "Google Review" | Overlaps Info's restaurant-table use case. [INFERRED] No reservation backend exists, so "Direct reservations" is an existing promise this DEC must not repeat for Info |
| DEC-037 (owner, 2026-10-16) | No new AAROH SKUs or prices until approved; ₹999 / ₹1,499 provisional; checkout off | A free Info needs no SKU |
| Doc 10 Phase 4 (proposal) | "Locations" are an organisation feature next to `plans` and `subscriptions` | [INFERRED] A free Info now may set expectations for a product doc 10 planned as organisational (CQ-3) |

Two observations sit **outside this DEC** and are recorded only, for the owner:
- [INFERRED] The Business tier's storefront copy promises "Website and social links", but buying the tier grants no link add-on, and the trigger requires one.
- The Restaurant card promises "Direct reservations", and no reservation backend exists.

### 0.9 The planned model this must not duplicate [OBSERVED: proposals, not approved]

- Doc 03 proposes `locations` ("Physical place/object information nodes") and `location_content` (versioned, per-locale content). They are organisation-owned, reached from devices through `tap_routes`, and planned for Phase 4 (doc 10).
- [INFERRED] **The owner's Info is the same concept.**
- The AAROH brief says: "Do not create … duplicate core data models."
- [PROPOSED] Info's record should be shaped so that a later `locations` decision can adopt or extend it rather than build a second table for the same thing (§6).

### 0.10 Migration dependencies and backward compatibility [OBSERVED / INFERRED]

**Dependencies of a future 034** [OBSERVED]:
- the baseline and 020–033: the 028 suspension guard, the 030 server-column guard, and the 029/031/032 capabilities;
- **not** 027, which is held aside (DEC-037).

**Production** [BLOCKED]:
- The P-1 change must be written against production's re-baselined body (V6-106), and the `page_template` family must be understood first.
- Locally, 034 can be built once approved.

**Callers of P-1** [OBSERVED in this repository]:
- `publicTapClient.ts`;
- comments in `services/tap.ts`, `Tiers.tsx` and `TapExperience.tsx`;
- the tests: public-tap, golden, identity, verify, suspension, emergency, admin-contract and `013_live_dry_run.sql`.

**Callers outside this repository** [UNKNOWN]:
- the Expo admin app (its source is not here);
- the production corporate site. [INFERRED] It reads `shygontap_profiles` directly, not P-1 (V6-107).

**Effect on existing Tap URLs** [INFERRED]:
- A Tap with no mode state behaves exactly as today.
- An owner who activates Info changes what their own `/t/<slug>` shows. Anyone holding that link as the owner's profile then sees the Info page, and **old clients that call P-1 see "unavailable"**. That is intended under C-1, but it is a visible change for that owner's visitors.

---

## 1. Mode name and purpose

| Item | Statement | Label |
|---|---|---|
| The model | A **mode** is a SHYGON-defined public experience. Exactly one is active per Tap (per account in v1). | OWNER (Q0.7, Q1); PROPOSED (wording) |
| The word | The schema and API say `mode`, never `experience`: P-1's `experience` is the paid UI tier. The showroom's presentational "modes" (§0.5) are not modes in this sense. | OBSERVED (collisions); PROPOSED (wording) |
| **Business** | The existing public profile at `/t/<slug>`. Default and unchanged. | OBSERVED; OWNER (Q1, Q2) |
| **Info** | A public information page about a physical object, product, place or service point, which its owner updates without replacing the tag. | OWNER (Q0.1, Q0.2) |
| Not Info | A personal identity, medical profile, student passport or Business profile | OWNER (Q0.1), OWNER, relayed |
| Not modes | Emergency (029), Return-to-Owner (031), Connect (032): per-account capabilities | OBSERVED; APPROVED (DEC-038, DEC-039) |
| Privé | Never on a Tap | APPROVED (DEC-040) |

## 2. The problem Info solves that a phone does not

- [OWNER] Info connects a physical object or place to its current information, with five properties:
  - it opens in a browser by NFC or QR;
  - it sits in the physical context where it is needed;
  - it is maintained centrally by an authorised owner;
  - it can be changed after the tag is issued;
  - it needs no app.

  "A phone's contact card or share sheet is not the primary comparison."
- [PROPOSED] **Admission test for every mode** (kept from revision 1). A mode is built only if the server does something here that the owner's phone cannot. The four qualifying answers:
  1. a stable physical tap point whose content the owner changes on the server;
  2. server-enforced per-field visibility;
  3. answers decided by server records, never by what a viewer claims;
  4. reaching the owner without disclosing their contact details.

  **Info passes on 1 and 2.**
- [OWNER] **What it does not do:** no analytics, booking, payments, device control or external integrations are promised.
  - [OBSERVED] The existing anonymous tap counts (`record_tap_event`) are Business analytics.
  - [PROPOSED] Info v1 records no visitor events. An owner-facing Info analytics feature would need its own decision.

## 3. Target users and viewer roles

| Role | Established by | Info v1 | Label |
|---|---|---|---|
| Public visitor | No verified token; the anonymous resolver | Sees only the published Info fields of an active, unsuspended Tap whose active mode is Info | OWNER (Q6); PROPOSED (mechanism) |
| Authenticated owner | A Supabase token verified with GoTrue `/auth/v1/user` in the function; the caller owns the Tap | Manages their own Info; previews exactly the public view | OBSERVED (mechanism); OWNER (Q6) |
| Trusted contact, organisation member, emergency context, student roles | Not verified server-side roles. [OBSERVED] Connect grants (032) cover account-profile scopes only; there are no organisation or membership tables; emergency contacts (029) receive SMS and read no page. | **Not introduced.** Treated as public visitors. | OWNER (Q6) |
| SHYGON admin / support | Audited admin functions | Not a viewer; support reads audit and content through an admin function only | PROPOSED |

**Users** [OWNER]: people and organisations that put a tag on a thing or place (classrooms, libraries, exhibits, equipment, product tags, restaurant tables). [INFERRED] In v1 the "organisation" is an ordinary account, because no organisation model exists (§0.6).

[PROPOSED] No role ever comes from a URL, query, header, body field or frontend flag (§13 test 8).

## 4. Journeys

**Owner** [PROPOSED]:
1. Signs in to `/shygontap` and opens **Modes**. For each mode the server answers `active`, `ready`, `needs_setup` (with the missing fields) or `not_available` (with a reason).
2. Opens **Info** and fills the structured form. On save, the server validates and returns the stored version, and only then shows "Saved".
3. **Preview**: the server returns the exact public view.
4. **Activate Info**: the checks in §8 run. "Live" appears only after the server confirms [OWNER Q4]. On failure, the reason is shown and the previous mode stays.
5. Switches back to Business the same way.

**Visitor** [PROPOSED]:
1. Taps or scans and lands on `/t/<slug>` (unchanged, §0.1).
2. Gets one of:
   - the Info page: title, short description, the optional fields, and "last updated";
   - Business;
   - the neutral "unavailable" page.
3. Capability entry points (Return to owner, emergency, Connect) appear according to their own `available` answers on whichever mode is active. [PROPOSED] Whether they belong on an Info page about a thing (for example "Return to owner" on a restaurant table) is a product question: **PQ-3**.

## 5. Relationship with Business

[OWNER] **Staged C: C-1 now.** One active mode per account; Business by default; per-card selection (C-2) and multi-mode display (C-3) are separate decisions.

**The options compared** [PROPOSED analysis, from revision 1]:

| Option | Public journey | Privacy | Card configuration | Business behaviour |
|---|---|---|---|---|
| A. Info replaces Business while active | The tag lands on Info | One set of fields is public at a time | None | Unchanged when Business is active |
| B. Info alongside Business | The tag lands on Business; Info one link away | Info is public whenever Business is | None | Unchanged |
| C. The owner chooses per card (optionally several) | Each card can differ | As A, per card | Needs the card registry: BLOCKED | Unchanged |

C-1 behaves as A for the two modes. The stored state allows a per-card override later.

**Consequences, stated so they are approved knowingly** [INFERRED unless stated]:
1. **One Info page per account in v1.** The owner's examples (many tables, exhibits or classrooms) need many pages, each on its own tag. Under C-1 that takes one account per page, or a later decision. **PQ-1.**
2. **While Info is active, the owner's Business is not public**, because `/t/<slug>` shows Info and P-1 returns null. For a person whose card is their business card, choosing Info hides their profile.
3. **A "Business attribution or link" has no destination under C-1.** Business has no public address while Info is active. Supporting one needs a second resolver path or a composition rule, which is exactly what the owner said to leave for a separate decision [OWNER, relayed].
   - [PROPOSED] **Not in v1**, and no Business field is read by Info (D9, D10).

**Alternative, recorded and not recommended now** [PROPOSED, separate decision]:
- **S2: Info pages with their own addresses.** Many pages per account, each with a stable public address of its own; Business stays on `/t/<slug>` untouched, and no switching is needed.
- It fits the owner's examples better and removes consequences 2 and 3.
- But it is not a mode of the Tap. It needs a new public route (Session B's routing), a new resolver and tag provisioning, and it is close to doc 03's `tap_routes` / `locations`.
- [PROPOSED] Revision 2's record shape (§6) keeps S2 possible later without moving data.

## 6. Content schema and source of truth

All of this section is [PROPOSED]. The names and limits are provisional, and **the Principal Architect confirms them** [OWNER Q0.3].

- **Business:** `tap_profiles`, unchanged [OWNER Q2]. No column added.
- **Info record: `info_pages`.** Its own `id` (uuid) and `owner_user_id`.
  - [PROPOSED] v1 allows **one per account** (a unique constraint that a later decision can drop).
  - It is not keyed by `tap_profile_id`, so a future per-tag or `locations` decision can address it directly (D6, §0.9).

| Field | Type and rule | Required | Label |
|---|---|---|---|
| `title` | Plain text, 1–120 characters, trimmed; no markup | Yes | OWNER (field); OWNER, relayed (120) |
| `short_description` | Plain text, 1–280 characters | Yes | OWNER (field); OWNER, relayed (280) |
| `category` | One of `place`, `product`, `equipment`, `exhibit`, `service_point`, `instructions` | No | OWNER (field); OWNER, relayed (list) |
| `detailed_information` | Plain text with line breaks; no HTML, no markdown links. The maximum length is **for the Principal Architect to set** (a bounded payload is required, §7). | No | OWNER (field); PROPOSED (plain text) |
| `action_links` | Array of `{ label (1–40), url }`. The URL is `https://` only, with no credentials in it; `javascript:`, `data:`, `file:` and every other scheme are refused. At most 10, the same bound as `custom_links` (004:580). **Subject to CQ-2.** | No | OWNER (field); PROPOSED (rules) |
| `image` | **BLOCKED** (§0.7). Not in v1 until storage is reconciled. | No | OWNER (field); BLOCKED |
| `language` | **Deferred** (§0.6): the existing architecture has no content language. If the owner wants it anyway: a tag from a small allowlist, used only for the page's `lang` attribute. | No | OWNER (field); PROPOSED (defer) |
| `publication_status` | **Server-computed, never written by the client:** `draft` (required fields missing), `ready` (valid, not shown), `live` (active mode on an active, unsuspended Tap), `unavailable` (Tap paused or suspended, or SHYGON switched Info off). | — | OWNER (server-controlled); PROPOSED (states) |
| `updated_at` | Server timestamp on each save; shown to visitors as "Last updated" | — | OWNER; PROPOSED (shown) |
| `version` | Server counter for stale-write detection | — | PROPOSED |

**Rules for the record** [PROPOSED]:
- **No Business data.** Info never reads or writes `tap_profiles` content fields [OWNER Q0.5].
- **No contact fields of its own.** Info has no phone, email, WhatsApp, address-book or map fields.
- **No location field.** A place's address appears only if the owner deliberately types it into the description [OWNER, relayed Q0.4].
- **Never read by Info:** `profiles.*`, emergency, rescue, Connect and Privé data, and admin notes.
- **Excluded modules** [OWNER, relayed]: maps, bookings, contact databases, file sharing, custom forms.

## 7. Edit permissions and edit-window rules

**Business today** [OBSERVED]:
- the 14-day window per account; the Customization Pass (`lifetime`) removes it;
- visibility changes and publish/pause are not edits;
- **no other throttle on owner edits.** A Pass holder can save Business without limit.

**Existing server-side limits** [OBSERVED], the evidence the owner asked for. Every one of them protects an action that sends messages, reaches other people or costs money:

| Where | Limit | Protects |
|---|---|---|
| 025:229 | 60 visitor events per hour per visitor per Tap | Visitor analytics inflation |
| 029 | 5 contacts per owner; verification codes 5 per hour per owner and 3 per day per number; owner alerts 5 per hour and 10 per day; public alerts 50 per hour in total, 3 per day per owner and 3 per day per visitor | Paid SMS; harassment of third parties |
| 031 | Finder threads 3 per hour and 10 per day per finder, 5 per day per owner; 10 messages per hour; 60 polls per hour | A relay reaching the owner |
| 032:347–349 | Connect requests per hour per requester; 50 pending per target | Unwanted requests to other people |
| 033:189 | Privé demo requests 10 per hour, 50 per day | Simulator load |

**Edit policy** [PROPOSED]:

| Mode | Who edits | Limit | Validation |
|---|---|---|---|
| Business | Owner | As today (OBSERVED, unchanged) | As today |
| Info | The authenticated owner of the Tap | **No 14-day window** [OWNER Q0.6]. **No fixed save quota.** | Per-field SQL validation; bounded payload; `expectedVersion` (stale writes refused); the saved version is returned |
| Switching | The authenticated owner | **No fixed quota**; every switch audited | The checks in §8 |

**Rationale for no quota** [PROPOSED]:
- An Info save changes only the owner's own public page. It sends nothing to anyone, costs SHYGON nothing per call, and is already bounded by the payload size and the version check.
- The closest precedent, a Pass holder's Business saves, has no throttle (OBSERVED).
- The other abuse controls: authentication, ownership, validation, an audit of field names (never values), and the existing moderation suspension (028).

**Residual risk** [INFERRED]: scripted save or switch loops by a signed-in owner produce write load and audit rows.
- [PROPOSED] Add a ceiling **later, from measured use**, with its rationale recorded.

**Commercial guard** [OWNER Q0.5, Q3]: Info must not deliver paid Business customization for free. The open conflicts are CQ-1 (Terms) and CQ-2 (links), in §10.

## 8. Switching and card lifecycle

**Switching** [PROPOSED] keeps revision 1's mechanism: `POST /api/modes` `owner.activate { mode, expectedVersion, idempotencyKey }`.
- **The checks run in one transaction:**
  1. a valid token;
  2. the caller owns the Tap;
  3. the Tap is not suspended;
  4. SHYGON has the mode switched on;
  5. Info's required fields are valid;
  6. the entitlement rule passes;
  7. the version matches.
- **Then**, in the same transaction: set the active mode, bump the version, write the audit row.
- **On failure**, nothing changes and the previous mode stays live.
- **A stale version** returns `stale_version`; **a repeated idempotency key** returns the first result [OWNER Q4].
- **The frontend shows "Live" only after the server confirms** [OWNER Q4].

**Card lifecycle** [OWNER Q4: "enforce card lifecycle"]:
- [OBSERVED] The public address is not bound to any card (§0.4), and cards are not sold.
- [PROPOSED] The server enforces **Tap** lifecycle now: draft, paused, active, suspended.
- [BLOCKED] **Card** lifecycle checks wait for the card registry (`/d/<code>`). Until then, card states cannot affect the mode, and F3 is unchanged.

**Explicit fallback** [PROPOSED; replaces revision 1, D8]. The tests are written first at implementation.

| Situation | Public result | Owner sees | Test |
|---|---|---|---|
| SHYGON switches Info off (kill switch) while a Tap is on Info | **Neutral "unavailable"**, never Business | Notice: "Info is switched off by SHYGON; switch to Business to show your profile" | F-1 |
| Info record fails validation at read time (a stricter rule after a schema change, or moderation removed content) | Neutral "unavailable" | `needs_setup` with the fields | F-2 |
| Unknown or retired mode value | Neutral "unavailable" | `not_available` | F-3 |
| Tap paused or suspended | As today: paused / unavailable | As today | F-4 |
| Clearing a required field while Info is live | Save refused (`mode_active`); the page is unchanged | Must switch to Business first | F-5 |

Business becomes public again **only by the owner's own switch** [OWNER Q0.7].

## 9. Privacy and authorization matrix

R = read, W = write, — = never. Every role that does not exist (trusted contact, organisation, student, emergency) is treated as a public visitor [OWNER Q6].

| Data | Public visitor | Owner | Admin / support | Label |
|---|---|---|---|---|
| Active mode name | R | R/W | R (audited) | PROPOSED |
| Info published fields (§6), Tap active, unsuspended and on Info | R | R/W | R (audited) | PROPOSED |
| Info draft, or a record while the Tap is not on Info | — | R/W | R (audited) | PROPOSED |
| Business fields switched on, Business active | R | R/W (window) | R | OBSERVED (today) |
| Business fields while Info is active | — (P-1 returns null) | R/W | R | PROPOSED |
| Business fields switched off | — | R/W | R | OBSERVED |
| Account profile (`profiles.*`) | — | R/W | R | OBSERVED |
| Emergency, rescue, Connect, Privé data | — (through their own functions only) | R/W (own functions) | Their admin functions | OBSERVED |
| Internal ids, activation codes, tokens, admin notes | — | Own card rows only | R | OBSERVED |
| Mode audit (field names only) | — | R (own) | R (support.read) | PROPOSED |

No Info field is sensitive [OWNER Q0.4: public content only].

**Never appears**: the owner's list as negative tests [OWNER Q7; PROPOSED mechanism]:

| Must never appear | Enforcement |
|---|---|
| Private medical or emergency information; children's sensitive details; identity documents; credentials; access codes | No such field exists in Info. Emergency, Connect, rescue and Privé tables are closed to client roles (OBSERVED 029–033) and never read by a mode resolver. |
| Private files, storage links | No file field. Image is BLOCKED. The resolver returns no storage path. |
| Internal ids, tokens, admin notes, unpublished owner data | The resolver allowlist has no id; drafts are never returned publicly |
| Unverified credentials shown as verified | Info has no "verified" field, and no credential model exists (OBSERVED) |
| Organisation or student data outside its context | None exists; any such mode needs its own DEC [OWNER Q6] |
| Privé hotel data | Never read by a mode resolver (APPROVED DEC-040 boundary) |
| Unapproved location or tracking | No location field; no geolocation; Info v1 records no visitor events (§2) |
| Bypassing Emergency Profile, Student Passport, Smart Identity or Business privacy rules [OWNER, relayed] | Info reads none of their data. [OBSERVED] Student Passport and Smart Identity do not exist in the backend. |

**Surfaces under test** [OWNER Q7; PROPOSED, §13 test 14]:
- public API outputs: `get_public_tap`, P-1 and P-2, plus `record_tap_event` and resolver error bodies;
- the rendered page DOM (Session B e2e);
- metadata: tab title, description, share tags, `index.html` defaults;
- caches: response headers carry no shared-cache directive, and nothing is written to `localStorage`, `sessionStorage` or IndexedDB;
- error responses for every failure code.

## 10. Pricing and entitlement recommendation

[OWNER Q3, Q5]:
- Do not extend the paid Business customization entitlement to Info.
- "Free with no new SKU" is a recommendation only, pending product and commercial approval.

**Conflicts found** (§0.8):

| # | Conflict | Options | Session A lean |
|---|---|---|---|
| **CQ-1** | The Terms say "You can change your Tap's content once every 14 days", and the Pass is sold as "change your Tap as often as you like". Unlimited free Info edits on the same Tap contradict that wording. | **A:** change the Terms and FAQ so the 14-day rule covers the **Business profile** (owner + counsel; DEC-2026-017 process). **B:** apply a window to Info (the owner declined, Q0.6). **C:** keep Info off until A. | **A**; Info cannot be "free and unlimited" while the Terms say otherwise. [BLOCKED] on owner + counsel. |
| **CQ-2** | Info "action links" are functionally the paid `links` add-on (and could carry website or social links that Business sells per key). | **A:** free links in Info, accepting the overlap. **B:** Info links require the existing `links` customization entitlement (server-enforced on save and read); Info itself stays free. **C:** no action links in v1. | **B**: it follows "do not provide paid customization for free" literally, reuses an existing entitlement, and needs no new SKU or price. The commercial call is the owner's. |
| **CQ-3** | Doc 10 (proposal) plans Locations as an organisation feature beside plans and subscriptions. A free Info now may pre-empt that. | Confirm a free Info v1 is intended, or mark it as an introductory scope | Owner's call; not blocking for v1 |

**Recommendation** [PROPOSED]:
- Info is **"Available after setup"**: no price and no new SKU, activated once the required fields are valid.
- It is **conditional on CQ-1 = A** and on the owner's CQ-2 choice.
- It is enforced on the server through the catalogue's entitlement rule, and the page shows the server's `available` / `reason` answer.
- Not approved [OWNER Q5].

## 11. Backend records, APIs and state transitions

All [PROPOSED], not approved [OWNER Q2]. These are revision 1's records with the changes below. They are written only after approval, and only locally.

- **`tap_mode_catalog`**: the kill switch and per-mode rules.
- **`tap_mode_state`**:
  - `tap_profile_id` (primary key), `active_mode`, `info_page_id` (set when the mode is Info), `previous_mode`, `version`, `changed_at`, the last idempotency key and its result;
  - no row means Business.
- **`info_pages`**: as in §6.
- **`tap_mode_audit`**: field names only, never values.
- **Closed tables**: RLS on, no policies, no client grants (the 029–033 pattern), NONE in the rls-matrix.

**Public read path**:
- a new anonymous, read-only function, `get_public_tap(p_slug)`, returning `{mode:'business', profile}`, `{mode:'info', info}` or null;
- **P-1's shape is unchanged, but P-1 returns null while the active mode is not Business**, so Business is never readable through the old path when the owner chose Info.

  That is a semantic change to a frozen contract. It goes in contract v0.8's change note, written against production's re-baselined body (§0.10, BLOCKED for production).
- **Alternatives considered**:
  - leave P-1 alone: rejected, because Business would stay public through P-1 while Info is active, which breaks Q0.7;
  - serve Info through a Netlify function: an extra hop per tap and a second public path to keep in step.

**Owner API `POST /api/modes`** (signed in):
- `owner.state` → `{ activeMode, version, modes: [{ mode, available, reason, missing? }] }`;
- `owner.activate { mode, expectedVersion, idempotencyKey }`;
- `owner.info.get`, `owner.info.save { fields, expectedVersion }`, `owner.info.clear`;
- `owner.preview { mode }` → exactly the public view.

Errors are `{ error: { code, message } }`. Messages are fixed text and never echo a submitted value:

| Code | HTTP |
|---|---|
| `unauthorized` | 401 |
| `no_tap` | 404 |
| `tap_suspended` | 409 |
| `mode_unavailable` | 409 |
| `needs_setup` (+ `missing`) | 409 |
| `not_entitled` | 403 |
| `stale_version` | 409 |
| `invalid_field` (+ field, reason) | 422 |
| `mode_active` | 409 |

There is no `rate_limited`: no quota (D7).

**State transitions**: business ⇄ info.
- Business → Info needs the record to be valid.
- Info → Business is always allowed.
- **The kill switch makes the Tap unavailable; it does not switch it to Business** (D8).
- Tap status and suspension always win.

**Account deletion**: the runbook deletes the four tables' rows, proven by a negative control.

## 12. Failure, abuse and recovery

| Case | Handling | Label |
|---|---|---|
| A viewer role claimed in a URL, query, header or body | Ignored; the public answer is returned | PROPOSED |
| Another account reads, saves, previews or activates | 0 rows / `no_tap`; the owner check is in SQL | PROPOSED |
| Two devices switch at once | The second gets `stale_version` and the current state | PROPOSED |
| A double click or retry | The idempotency key returns the first result; one audit row | PROPOSED |
| A switch while suspended | Refused; suspension also wins on every read | PROPOSED |
| A partial failure during a switch | One transaction; the previous mode stays live | PROPOSED |
| Using a switch to get around Business's 14-day window | A switch is not a content edit; Info cannot write Business fields | PROPOSED |
| Rapid switching or save loops | No fixed quota; audited; a ceiling later from measured use (§7) | PROPOSED |
| SHYGON must pull Info quickly | Kill switch: neutral "unavailable", the owner notified, audited (§8) | PROPOSED |
| Abusive or phishing content | Existing moderation suspension of the whole Tap (028); https-only validated links | OBSERVED; PROPOSED |
| Slug enumeration | No new surface: the same slug lookup as P-1 (DEC-2026-011 open) | OBSERVED |
| A bad migration | 034 ships a tested ROLLBACK block and is idempotent | PROPOSED |
| Account deletion | The runbook removes the four tables' rows; negative control | PROPOSED |
| The UI shows a switch that did not happen | "Live" only after the server answers; Session B e2e | PROPOSED |
| Info used as a free personal profile to avoid Business tiers or add-ons | Info has no person fields, no contact fields and no Business data. Links follow CQ-2. The Terms say Info describes a thing or place, and moderation suspension (028) applies. | PROPOSED |
| An owner points a tag at someone else's object or place | Out of scope for software. The content is the owner's own public statement, under the Terms and moderation. | INFERRED |
| Production's unknown `page_template` / `card_family_pages` behaviour collides with modes | Unknown until the rebaseline. 034 is not written for production before V6-106 is resolved. | UNKNOWN; BLOCKED |
| A visitor holds an old link expecting the owner's profile | Sees Info (an intended C-1 effect) | INFERRED |

## 13. Acceptance criteria and tests

**Before implementation** [PROPOSED]:
- the owner approves the decision, including PQ-1 to PQ-3, CQ-1 to CQ-3, SQ-1 to SQ-4 and BQ-1 to BQ-3 below;
- the Principal Architect confirms §6;
- the owner confirms the relayed answers.

**`test:modes`**, on the local stack under deny-network [PROPOSED]:
1. A Tap without mode state resolves as Business, and P-1's payload is identical to today's (golden test).
2. Activating an invalid Info returns `needs_setup` with the fields; the state is unchanged.
3. Activating a valid Info succeeds: `get_public_tap` returns only allowlisted Info fields, and P-1 returns null.
4. Switching back restores the identical Business payload.
5. Paused or suspended Taps are unavailable in every mode; activation is refused while suspended.
6. Cross-tenant: another account cannot read, save, preview or activate.
7. The anonymous role cannot call owner functions; client roles cannot read the four tables (rls-matrix NONE).
8. A claimed viewer role in the body, query or headers gets the public answer.
9. A stale version returns 409; an idempotent replay returns the same result with one audit row.
10. An Info save leaves `tap_profiles` (including `last_content_edit_at`) untouched.
11. Clearing a required field while Info is live returns `mode_active`.
12. The kill switch gives "unavailable" (F-1).
13. Account deletion removes all four tables' rows (negative control).
14. Public-leak canaries (see below).
15. 034's ROLLBACK block works, and the migration re-runs safely.
16. `admin-contract` lists the new functions as PROPOSED, and as APPROVED only after approval.

Added in revision 2:
- **F-1 to F-5**: the fallbacks in §8, written first.
- **Test 14, extended**: canary strings go into `profiles.*`, Business fields that are switched off, an unpublished Info draft, emergency, rescue, Connect, Privé and admin-note tables. None may appear in:
  - any `get_public_tap` or P-1 / P-2 response;
  - any error body for each failure code;
  - the rendered DOM, title, description or share tags (Session B e2e);
  - browser storage after a visit (Session B e2e).
- **Field validation**:
  - title and short-description limits;
  - category allowlist;
  - plain text only;
  - link schemes (`javascript:`, `data:`, `file:`, `http:` and credentials in the URL are refused);
  - at most 10 links.
- **CQ-2 B**, if chosen: links refused without the `links` entitlement, and dropped from the public read if the entitlement becomes inactive.
- **Business unchanged**: the golden P-1 payload is identical for Taps without mode state, and the 14-day window and Pass behaviour are unchanged.

**Regression**: test:db, test:public-tap, test:suspension, test:emergency, test:rescue, test:connect and test:prive must stay green.

## 14. Alternatives considered and trade-offs

| Decision | Options | Recommended | Trade-off |
|---|---|---|---|
| Relation to Business | A replace / B alongside / C per card, staged | C-1 [OWNER] | Simple and private; one Info per account; Business hidden while Info is active |
| Info addressing | C-1 mode on `/t/<slug>` / S2 own addresses | C-1 now [OWNER]; record shaped for S2 [PROPOSED] | S2 fits many-object use better but needs a new route and resolver: a separate decision |
| Info storage | Columns on `tap_profiles` / jsonb page / row per Tap / **own addressable record** | Own record (D6) [PROPOSED] | One more table; avoids reusing person columns and a later duplicate of `locations` |
| Public read | Change P-1 + new `get_public_tap` / leave P-1 / function hop | Change P-1 + new function [PROPOSED] | Frozen-contract change; blocked on the rebaseline for production |
| Fallback | Business / neutral unavailable | Unavailable [PROPOSED, per OWNER Q0.7] | A tap shows nothing until the owner acts |
| Limits | Invented quota / no quota plus a later measured ceiling | No quota [PROPOSED, per OWNER Q0.6] | Scripted loops are possible but cheap and audited |
| Links | Free / existing `links` entitlement / none | Entitlement (CQ-2 B) [PROPOSED] | Info is "free" except links |
| Image | External URL / wait for storage | Wait (BLOCKED) | An external URL leaks visitor addresses to third-party hosts and skips moderation |
| Language | Add a field / defer | Defer [PROPOSED] | One-language pages until a content-language decision |
| Business link | Allow now / separate decision | Separate decision [OWNER, relayed] | No attribution in v1 |

## 15. Recommendation

[PROPOSED]:
- **C-1, as the owner directed.** One active mode per Tap; Business is the untouched default.
- **Info** is its own structured, public-only record: title and short description required; category, plain-text details and links optional.
  - It is addressable by its own id and limited to one per account in v1.
  - It reads no Business data, has no image until storage is reconciled, and no language field until a content-language decision.
- **Switching** is owner-only, server-validated, versioned, idempotent and audited, and the public URL never changes.
- **Fallback**: a disabled or invalid Info shows a neutral "unavailable", never Business.
- **Limits**: no invented quota; a ceiling is added later from measured use.
- **Price**: available after setup at no charge, **only once the Terms are corrected (CQ-1 A)** and with links under the existing entitlement (CQ-2 B).

**Why:**
- It follows every owner direction.
- It keeps Business, its window and its paid add-ons exactly as they are.
- It makes the privacy rules testable on every public surface.
- It leaves per-tag and many-page Info (S2), attribution and language to their own decisions without data moves.

## Remaining approval questions

| ID | Question | Recommended | Type |
|---|---|---|---|
| **A0** | Confirm the relayed answers (limits 120/280; the category list; "one public information page per configured Info experience"; no maps, bookings, contact databases, file sharing or forms; the Student Passport / Smart Identity rule; "leave it for a separate decision") | Confirm | Product |
| **PQ-1** | Accept **one Info page per account** in v1, which hides that account's Business while Info is active? (Many-object use needs S2 or C-2 later.) | Accept for v1; open S2 as its own DEC if many-object use is wanted soon | Product |
| **PQ-2** | Should Info v1 record visitor events at all? | No (§2) | Product / Privacy |
| **PQ-3** | Should capability entry points (Return to owner, emergency, Connect) appear on an Info page about a thing? | No: an Info page about a thing shows no personal capability | Product / Privacy |
| **SQ-1** | Approve the record shape (§6) for the Principal Architect to finalise, including the maximum length of detailed information | Approve the direction | Schema |
| **SQ-2** | Production drift: establish what `page_template`, `card_family_pages` and `tap_card_features` are (V6-106) before 034 is written for production | Required | Schema / Release |
| **SQ-3** | Ship Info v1 **without an image** until V6-108 / V6-095 are resolved? | Yes | Schema |
| **SQ-4** | Ship Info v1 **without a language field**? | Yes | Schema |
| **CQ-1** | Change the Terms and FAQ so the 14-day rule covers the Business profile only (owner + counsel) | A | Commercial / Legal |
| **CQ-2** | Action links: free / existing `links` entitlement / none | B | Commercial |
| **CQ-3** | A free Info v1 versus the planned organisational Locations product | Owner's call | Commercial |
| **AQ-1** | Viewer roles: public visitor + owner only | As directed [OWNER Q6] | Authorization |
| **AQ-2** | Switching enforces Tap lifecycle now; card lifecycle waits for the registry | Approve | Authorization |
| **BQ-1** | P-1 returns null while Info is active (frozen-contract semantic change, contract v0.8) | Approve | Backward compatibility |
| **BQ-2** | Fallback is neutral "unavailable", never Business | Approve | Backward compatibility / Privacy |
| **BQ-3** | No Business attribution or link in v1; separate decision | Approve | Backward compatibility |
| **RQ-1** | No fixed save or switch quota; a ceiling later from measured use | Approve | Security |

## After approval

[PROPOSED] Session A writes 034, `/api/modes`, `test:modes` (fallback tests first) and contract v0.8, all locally.
- L3: DEC-2026-018's cool-off and checklist come before any real database.
- Production waits for V6-106.
- Nothing is applied, pushed or deployed without the release track.

**Recorded only, outside this DEC** (§0.8):
- the Business tier's "Website and social links" copy versus fulfilment;
- the Restaurant card's "Direct reservations" promise.

## Expected result vs observed result

To be filled at verification.
