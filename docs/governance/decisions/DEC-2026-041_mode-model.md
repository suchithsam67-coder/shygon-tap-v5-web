# DEC-2026-041: The AAROH mode model, and what "Info" is

| Field | Value |
|---|---|
| Decision ID | DEC-2026-041 |
| Title | Modes: how one Tap shows one of several owner-chosen experiences (Business, Info, …), and the definition of Info |
| Date opened | 2026-10-20 |
| Domain | Product / Data / Privacy |
| Level | L3 if approved (new tables, a new public read function, a new "returns null" rule on `get_public_profile`) |
| **Accountable Owner (A)** | Repository owner (DEC-2026-018 Option B) |
| Responsible (R) | Session A (AAROH backend) |
| Informed (I) | Session B (frontend) |
| Follows | DEC-2026-038 Q7, APPROVED 2026-10-19: "A, then B" (one public profile stays Business; the owner defines Info; Session A then proposes a mode model) |
| State | **PROPOSED: HUMAN DECISION REQUIRED. Not approved for implementation.** Nothing is built: no migration, function, API, contract change or test. **Info's identity is not defined (Q0).** |

## Priority

| Impact | Urgency | Irreversibility | Risk | Score | Final P |
|---|---|---|---|---|---|
| 2 | 1 | 1 | 2 | 6 | **P2**: before any mode work starts |

## How to read this record

Every statement carries one label:
- **[OBSERVED]**: seen in the repository, with a pointer;
- **[INFERRED]**: concluded from observed facts, not verified directly;
- **[PROPOSED]**: Session A's recommendation, which needs the owner's approval;
- **[APPROVED]**: already decided by the owner, with the record.

**OWNER TO DEFINE** marks what Session A will not invent.

---

## 0. Info is not defined yet: the owner's input is needed (Q0)

- [OBSERVED] The owner ordered modes as "Business and Info first, then Return-to-Owner" (2026-10-16; `docs/v6/aaroh/api-contract.md` §6; `backend-audit.md` line 101).
- [OBSERVED] No file in the repository says what Info shows, to whom, or why (`capability-matrix.md` §9; contract §6).
- [OBSERVED] The owner's mode-model text of 2026-10-20 sets rules for every mode, but it does not state Info's purpose.
- [INFERRED] Session A's own capability matrix filed "Info Tap" next to "SHYGON Locations" (doc 03 `locations`, Phase 4). That grouping is Session A's, not the owner's, and it is not a definition.

Therefore:
- sections 1–15 define the **model** (how any mode works);
- Info's own parts are marked OWNER TO DEFINE.

**Questions for the owner:**

| # | Question | Decides |
|---|---|---|
| Q0.1 | **Subject.** Is Info about the owner as a person (a page that is not their business profile)? About a thing or place the card is attached to? Or something else? | §1, §3 |
| Q0.2 | **Problem.** Who taps, and what should they be able to do after reading Info that the following do not do well: a phone's contact card, share sheet, lock-screen medical ID, or a link-in-bio page? | §2 |
| Q0.3 | **Fields.** The list of fields, which ones are required, and the type of each (short text, long text, link, date, choice). | §6, §11 |
| Q0.4 | **Sensitivity.** Does any field carry health details, an address, a child's details, identity documents, or anything else sensitive? If so, who may see it? | §7, §9 |
| Q0.5 | **Reuse.** Should Info show the Business name and photo? Any other Business field? | §6 |
| Q0.6 | **Freshness.** How often will Info content need to change? | §7 (Q3) |
| Q0.7 | **Instead or together.** While Info is shown, should a visitor still be able to reach Business? | §5 (C-1 vs C-3) |

[PROPOSED] Until Q0 is answered, Session A builds nothing for Info.

---

## 1. Mode name and purpose

| Item | Statement | Label |
|---|---|---|
| The model | A **mode** is one of a fixed set of SHYGON-defined public experiences a Tap can show. Exactly one mode is active per Tap at a time (C-1, §5). | PROPOSED |
| The word | The schema and API use `mode`, never `experience`. `experience` already means the paid UI tier: `get_public_profile` returns `experience`, clamped by `canonical_experience` / `user_max_ui_tier` from `selected_ui_tier`. Reusing it would mix a paid tier with a mode. | OBSERVED (the collision); PROPOSED (the word) |
| **Business** | The existing public digital profile at `/t/<slug>` (contract P-1). | OBSERVED |
| Business, in the model | Business is the default mode, and its behaviour does not change. | PROPOSED |
| **Info**, name | "Info" is the owner's word (2026-10-16). | OBSERVED |
| **Info**, purpose | **OWNER TO DEFINE (Q0.1).** | — |
| Not modes | Three capabilities have their own switches: Emergency (029), Return-to-Owner (031) and Connect (032). Contract §6 says so. | OBSERVED |
| Not modes, decisions | Those capabilities were approved as built: DEC-2026-038 Q1/Q12 and DEC-2026-039. | APPROVED |
| Privé | Privé is a signed-in demo. It never appears on a Tap (DEC-2026-040). | APPROVED |

---

## 2. The problem a mode must solve that a phone does not solve well

[OBSERVED] The owner's requirement: modes must be "genuine software experiences, not simple UI pages that duplicate features already available on a phone" (2026-10-20).

[PROPOSED] **Admission test for every mode.** A mode is built only if it answers one concrete question: what does the server do here that the owner's phone cannot? Acceptable answers:

1. **A stable physical tap point.** The owner changes the public content on the server. The tag is never rewritten and nothing is re-sent.
   - [INFERRED] from `/t/<slug>` plus owner edits under T-2.
2. **Server-enforced per-field visibility.** A tap never shows more than the owner published.
   - [OBSERVED] for Business: `enabled_customizations`, paid add-ons, `status`.
3. **An answer decided by server records.** What a viewer gets depends on records the server holds, never on what the viewer claims.
   - [OBSERVED] in 029, 031 and 032.
4. **Reaching the owner without exposing their contact details.**
   - [OBSERVED] the Return-to-Owner relay (031) and the emergency relay (029).

[PROPOSED] A mode fails the test if it only re-displays what a phone can already share: a contact card, a note, a list of links.

| Mode | Answer | Label |
|---|---|---|
| Business | 1 and 2 | OBSERVED |
| Info | **OWNER TO DEFINE (Q0.2).** Session A will not write this answer for Info. | — |

---

## 3. Target users and viewer roles

| Role | How the server establishes it | Exists today? | What a mode may show this role | Label |
|---|---|---|---|---|
| **Public visitor** | No verified token. Reads go through the anonymous resolver. | Yes (P-1) | Only the active mode's published public fields | OBSERVED (exists); PROPOSED (rule) |
| **Authenticated owner** | Server functions check the Supabase access token with GoTrue `/auth/v1/user` (`currentUser`, `netlify/lib/emergency.mjs`). SQL uses `auth.uid()`. The caller must own the `tap_profiles` row. | Yes | Everything they own, in the editor. A preview shows them exactly what a visitor gets. | OBSERVED |
| **Trusted contact** | An account with an active Connect connection and a live consent grant. Grants cover only phone, email, company and job title from the account profile (`032:122`). | **Partly.** Grants exist, but no page shows granted fields to a contact, and no grant covers mode fields. | Treated as a public visitor in v1 | OBSERVED (state); PROPOSED (v1 rule) |
| **Verified organisation member** | None. There are no organisation or membership tables: doc 03 is a proposal, issuers are DEC-2026-025, and verticals are DEC-2026-032 (PROPOSED). | **No** | Treated as a public visitor | OBSERVED (state); PROPOSED (rule) |
| **Authorised emergency context** | None as a viewer. Emergency contacts (029) are verified phone numbers that receive SMS. They never sign in and never read a page. The Emergency Profile (DEC-2026-038 Q11) shows only non-contact information. | **No** | Treated as a public visitor. Any emergency viewer needs its own DEC. | OBSERVED; APPROVED (Q11); PROPOSED (rule) |
| SHYGON admin / support | Admin RPCs with permission checks, audited | Yes | Not a mode viewer. Support reads only through admin functions. | OBSERVED |

[PROPOSED] **No role from the client.** The server never takes a viewer role from:
- a URL or query string;
- a header the browser sets;
- a body field;
- a frontend flag.

The role is decided only by the verified token and the server's records. A request that claims a role gets the public answer (§13 test 8).

[OBSERVED] The AAROH functions built so far already work this way.

**Target users for Info: OWNER TO DEFINE (Q0.1, Q0.2).**

---

## 4. End-to-end journeys

**Owner** [PROPOSED]:
1. Signs in to `/shygontap`. [OBSERVED] The owner app is web-first (owner decision 2026-10-16).
2. Opens **Modes**. For each mode the server answers one of:
   - `active`;
   - `ready`;
   - `needs_setup`, with the missing fields;
   - `not_available`, with a reason.

   The page shows these answers as they are. The browser decides none of them.
3. Opens Info and fills the structured form (fields from Q0.3). On save, the server validates and returns the stored version. "Saved" appears only after that answer.
4. **Previews.** The server returns exactly what a visitor would get, using the same function the public page uses.
5. **Activates Info.** The server runs the checks in §8.
   - Success: the new active mode is shown, with the time it went live.
   - Failure: the reason is shown, and the previous mode stays live.
6. Can switch back to Business at any time, the same way.

**Visitor** [PROPOSED]:
1. Taps the card or scans the QR and lands on `/t/<slug>`.
   - [OBSERVED] V5 cards land there today.
   - [OBSERVED] AAROH `/d/<code>` is BLOCKED (contract P-4). Its reserved shape redirects to `/t/<slug>`.
2. The page asks the server once. The server answers with one of:
   - the active mode and only that mode's public fields;
   - `unavailable` (paused, suspended or unknown). [OBSERVED] These three cannot be told apart, as with P-2 today.
3. **Business active:** exactly today's page. The golden test stays unchanged.
4. **Info active:** Info's public view. **Content OWNER TO DEFINE.**
5. The capability entry points (Return to owner, the emergency alert, Connect) appear on whichever mode is active. Each follows its own `available` answer (§5).

---

## 5. Relationship with Business and other AAROH modes

| Option | Public Tap journey | Privacy | Card configuration | Existing Business behaviour |
|---|---|---|---|---|
| **A.** Info replaces Business while active | The tag lands on Info. Business is hidden. | One set of fields is public at a time. | None. The URL is stable. | Unchanged while Business is active. `get_public_profile` must return null while Info is active. |
| **B.** Info alongside Business, as a separate destination (a second page or a tab) | The tag lands on Business. Info is one link away. | Info is public whenever Business is. This doubles the public surface. Showing one without the other needs two more switches. | None | Unchanged |
| **C.** The owner chooses the active experience per card, optionally several at once | Each card can land on a different mode. | As A, per card. "Several at once" behaves as B. | Needs card-level resolution, which is **BLOCKED**: there is no card registry (P-4) and card sales are deferred (DEC-2026-035). | Unchanged |

All rows are [PROPOSED] analysis, built on these facts:
- [OBSERVED] There is one Tap per account (`UNIQUE(user_id)` on `tap_profiles`).
- [OBSERVED] The public read is keyed by slug.
- [INFERRED] Every card of an account resolves through the same slug today, so per-card answers are impossible until the registry exists.

**[PROPOSED] Recommendation: C, staged.**
- **C-1, now.** One active mode per Tap, which means per account, chosen by the owner. Business is the default. With two modes this behaves exactly like A.
- **C-2, later, with its own DEC.** A per-card choice, once `/d/<code>` and the card registry exist. It is not designed or built now. [OBSERVED] Owner: "Do not implement … per-card differences until the DEC defines their exact behaviour."
- **C-3, later, only if Q0.7 asks for it.** Several modes visible at once (B's behaviour), each with its own switch.

Why C rather than A:
- the behaviour today is the same;
- the state is stored so that a per-card override can be added later without moving data (§11).

Why not B:
- it makes Info public whenever Business is, which reverses the closed-by-default rule. [OBSERVED] `docs/shygon-os/02_TARGET_ARCHITECTURE.md` principle 6: "New fields default to PRIVATE".

**Other AAROH pieces:**
- Emergency, Return-to-Owner and Connect stay per-account capabilities, as approved [APPROVED]. They are independent of the active mode [PROPOSED]:
  - their entry points appear on whichever mode is active;
  - each follows its own `public.status` / `available` answer;
  - a mode can neither turn them on nor hide them. Only the owner's capability switches do that.
- Whether Return-to-Owner should also become a selectable "lost" mode (showing only the relay) is a later DEC [PROPOSED].
- Event themes (`tap_event_themes`) are applied inside `get_public_profile` [OBSERVED]. They apply to Business only [PROPOSED].
- Privé never appears on a Tap [APPROVED DEC-2026-040].

---

## 6. Content schema and source of truth

**Where each mode's data lives:**
- **Business** stays in `tap_profiles` [OBSERVED]. It gains no columns [PROPOSED].
- **Mode state** goes in a new closed table, one row per Tap [PROPOSED].
  - A Tap with no row is in Business mode. Every existing Tap keeps today's behaviour without a backfill.
- **Info content** goes in its own closed table, one row per Tap, with one typed column per field [PROPOSED].
  - **The fields are OWNER TO DEFINE (Q0.3).**
  - There is no jsonb "page", no free-form block editor and no HTML. [PROPOSED] This follows the owner's rule "Do not create one unrestricted content editor for every mode".

**Shared fields are referenced, never copied** [PROPOSED]:
- If Q0.5 says yes, Info shows `display_name` and `avatar_url`, read from `tap_profiles` when the page is requested. The owner controls them with the switches `show_name` and `show_photo`.
- An Info save never writes to `tap_profiles`, and a Business save never writes to Info.

**Contact fields** [PROPOSED]:
- Info has no phone, WhatsApp, email, website or social fields of its own.
- Reason [OBSERVED]: in Business these fields are add-ons the owner pays for, except phone and email, and `enforce_tap_edit_rules` enforces that.
- A free copy in Info would give away a paid feature and bypass the owner's Business visibility choices.
- If Q0 needs a contact field on Info, Info reuses the Business field and its existing visibility switch, never a second copy.

**Never reused by any mode** [PROPOSED]:
- the account profile (`profiles.*`). [OBSERVED] Its phone is unverified (DEC-2026-005 / F4), and it holds the account email;
- emergency, rescue, Connect and Privé data.

No mode resolver reads these (canaries, §13 test 14).

**Files: none in Info v1** [PROPOSED]. [OBSERVED] Storage is not approved for this use:
- the `profile-images` bucket is missing on production (V6-108);
- storage policies can only be verified on live (V6-095);
- the storage scanner is an open item (owner decisions 2026-10-16).

**Links** (only if Q0.3 includes any) [PROPOSED]:
- `https://` only;
- a length limit and a maximum count;
- validated in SQL. [OBSERVED] Precedent: `custom_links` is limited to 10 (`004:580`).

**Validation** [PROPOSED]: every field is checked in SQL for type, length, and whether it is required before activation.

---

## 7. Edit permissions and edit-window rules

**What exists today for Business** [OBSERVED]:
- `tap_edit_interval_days()` returns 14.
- `tap_can_edit(user)` is true if the owner has the Customization Pass (an active `entitlements` row of type `lifetime`), or if the last content edit is at least 14 days old.
- `enforce_tap_edit_rules` counts these changes as an edit, then stamps `last_content_edit_at`:
  - the content columns;
  - the five theme columns;
  - a slug change.
- Visibility changes (`enabled_customizations`) and publish/pause are not edits.
- The refusal message says "The Customization Pass removes the limit."
- The window is per account: there is one `last_content_edit_at`, on the one Tap.

[INFERRED] The 14-day window is a commercial lever: removing it is what the Customization Pass sells.

**Edit policy per mode:**

| Mode | What can be edited | Who | Limit | Re-authentication | Server validation | Label |
|---|---|---|---|---|---|---|
| Business | As today (T-2) | Owner | 14-day window unless the owner has the Pass, as today | None, as today | The trigger, as today | OBSERVED, unchanged |
| Info | Info fields (Q0.3), plus `show_name` and `show_photo` | Owner only. No organisation roles exist. | **No 14-day window.** Anti-abuse limit: 30 saves per hour per account. | Only for a field Q0.4 marks sensitive: a recent sign-in, checked on the server | Per-field SQL validation; the saved version is returned | PROPOSED |
| Switching the active mode | The active mode | Owner | Not a content edit, so it never touches Business's window. Anti-flapping limit: 20 switches per hour. | None | The checks in §8 | PROPOSED |

**[PROPOSED] Why Info has no window:**
- putting the Pass's restriction on a new surface is a pricing change;
- [OBSERVED] DEC-037 forbids unapproved commercial changes.

The alternatives are Q3 B and C (§14).

**Trade-off and mitigation:**
- Risk: an unlimited Info could hold content that belongs in Business, to get around the window.
- Mitigation: Info has its own fields and none of Business's contact or link fields (§6), so it cannot become a second Business page.
- If Q0.3 gives Info free text and links, this must be revisited.

**Re-authentication** [INFERRED]: the server would read the sign-in time from the token claims (GoTrue's `amr`). This must be verified when implementing. It is not needed if Q0.4 marks nothing sensitive.

---

## 8. Mode switching and card lifecycle

**Switching** [PROPOSED]:
- **Control:** `POST /api/modes`, operation `owner.activate { mode, expectedVersion, idempotencyKey }`, signed in.
- **Checks, in one transaction:**
  1. the token is valid;
  2. the caller owns a Tap;
  3. the Tap is not suspended;
  4. SHYGON has the mode switched on in the catalogue;
  5. prerequisites are met (Info: every required field is valid);
  6. the entitlement rule passes (§10);
  7. `expectedVersion` matches.
- **On success, in the same transaction:**
  - the active mode is set;
  - the previous mode is kept;
  - the version goes up;
  - an audit row is written.
- **Result:** `{ activeMode, previousMode, version, changedAt }`.
- **On failure:** the codes are in §11. Nothing changes, because the transaction rolls back, so the previous mode stays live.
- **Frontend states** (handoff to Session B):
  - "pending" while the request runs;
  - "Live" only after the server answers;
  - on failure, the reason and the mode that is still active;
  - never an optimistic switch.
- **Undo:** switching back is the same call, and switching to Business is always allowed.
- **Two devices:** a stale `expectedVersion` gets `stale_version` (409) and the current state.
- **The same request twice:** the idempotency key returns the first result.

**Stable URL:**
- `/t/<slug>` never changes and no tag is rewritten [PROPOSED].
- [OBSERVED] `/t/*` serves the app shell (`vercel.json:151`), and the page fetches its data from Supabase when it is viewed.
- So there is no response cache to clear, and a switch shows on the next tap [INFERRED].

**Out of scope** [OBSERVED: the owner's instruction]: schedules, per-tap switching, per-card differences.

**Lifecycle:**

| Situation | Behaviour | Label |
|---|---|---|
| Tap `draft` or `paused` | Unavailable, whatever the mode | OBSERVED (today's rule); PROPOSED (kept) |
| Moderation suspension | Unavailable, whatever the mode (028). Activation is refused while suspended. | OBSERVED; PROPOSED |
| Clearing a required Info field while Info is active | Refused (`mode_active`): switch to Business first. Info can never be half-empty while live. | PROPOSED |
| SHYGON switches a mode off in the catalogue (the kill switch) | Taps on that mode show Business. The owner gets an in-app notice, and the change is audited. Business is content the owner already published; the alternative ("unavailable") would break every tap. Q4 lets the owner choose otherwise. | PROPOSED |
| Several cards on one account | All of them land on the account's active mode | INFERRED |
| V5 card defects (F3: deactivating a card does not hide the Tap) | Unchanged by this DEC; deferred to the card release | OBSERVED |
| Account deletion | Mode state, Info content and the mode audit are deleted by the runbook. A negative control proves it, as for V6-116. | PROPOSED |

---

## 9. Privacy and authorization matrix

R = read, W = write, — = never. "as public" = treated as a public visitor, because the role does not exist yet (§3).

| Data | Public visitor | Owner | Trusted contact | Organisation member | Emergency context | Admin / support | Label |
|---|---|---|---|---|---|---|---|
| Active mode name | R | R/W | as public | as public | as public | R (support.read, audited) | PROPOSED |
| Business fields, published and switched on, Business active | R | R/W (window) | as public | as public | as public | R | OBSERVED (today); PROPOSED (mode rule) |
| Business fields switched off | — | R/W | — | — | — | R | OBSERVED |
| Business fields while Info is active | — (`get_public_profile` returns null) | R/W | — | — | — | R | PROPOSED |
| Info public fields (Q0.3) | R while Info is active | R/W | as public | as public | as public | R | PROPOSED |
| Info fields marked sensitive (Q0.4) | **OWNER TO DEFINE** | R/W (recent sign-in) | **OWNER TO DEFINE** | — | — | **OWNER TO DEFINE** | — |
| Account profile (`profiles.*`) | — | R/W | Granted scopes only, through Connect (032) | — | — | R | OBSERVED |
| Emergency contacts, alerts | — | R/W (owner functions) | — | — | SMS recipients receive alerts (029); they read no page | Admin function, audited (029) | OBSERVED |
| Rescue threads | The finder's own thread, by its token | R/W | — | — | — | Reports, via an admin function | OBSERVED |
| Connect grants | — | R/W | The grantee sees the granted scopes | — | — | — | OBSERVED |
| Privé demo data | — | R/W (signed-in demo) | — | — | — | — | OBSERVED |
| Internal ids (user, Tap, card), activation codes, tokens | — | Own card rows only (C-1) | — | — | — | R | OBSERVED |
| Admin notes | — | — | — | — | — | Admin only | OBSERVED |
| Mode audit | — | R (own) | — | — | — | R (support.read) | PROPOSED |
| Location / tracking | Nothing is collected beyond the daily salted visitor hash (025) | — | — | — | — | — | OBSERVED |

**The owner's "must never appear" list, as tested invariants for every mode** [PROPOSED]:

| # | Must never appear | How it is enforced | Test (§13) |
|---|---|---|---|
| 1 | Private phone numbers or email addresses, unless authorised for that viewer | The resolver returns only allowlisted fields. Business contact fields follow their existing switch. No mode resolver reads `profiles.*`. | 3, 14 |
| 2 | Emergency contacts or sensitive emergency details on a public page | [OBSERVED] Emergency tables are closed to client roles. The resolver never reads them. | 14 |
| 3 | Private files, documents or storage links | Info v1 has no file fields, and the resolver returns no storage path. | 3 |
| 4 | Credentials, internal ids, security tokens | The allowlist has no id field. [OBSERVED] `get_public_profile` already excludes ids. | 3 |
| 5 | Unverified credentials presented as verified | No mode has a "verified" field. [OBSERVED] No credential model exists (capability matrix §6, NOT IMPLEMENTED). | 3 |
| 6 | Organisation or student information outside its context | No organisation data exists. Any organisation mode needs its own DEC. | — |
| 7 | Internal admin notes or backend-only data | Closed tables; the resolver never reads them. | 14 |
| 8 | Hotel server, reservation or access data from Privé | The Privé demo tables are never read by a mode resolver. | 14 |
| 9 | Unapproved location or tracking information | No location field unless Q0.3 deliberately includes one the owner publishes. No geolocation is captured, and tap events are unchanged. | 3 |

**Other sensitive records** [PROPOSED]:

| Record | Purpose | Visibility | Retention | Revocation |
|---|---|---|---|---|
| Mode audit | Who changed what, and when | The owner, and support.read | Life of the account | Deleted with the account |
| Info content | Q0.2 | Per this matrix | Until the owner clears it or deletes the account | Clearing takes effect on the next tap; there is no cache |
| Any field Q0.4 marks sensitive | **Its row must be added before approval** | — | — | — |

---

## 10. Pricing and entitlement recommendation

**What exists today** [OBSERVED]:
- `entitlements` rows have three types:
  - `digital_plan`: keys normalised to essential, business, premium or goat. They gate `selected_ui_tier` and the theme options.
  - `customization`: add-on keys. They gate the contact fields in `enabled_customizations`.
  - `lifetime`: the Customization Pass. It removes the edit window.
- `products` holds `sku`, `tier` / `ui_tier`, `price_in_paise` and `product_type` (baseline line 3787).
- DEC-037 (the owner, 2026-10-16):
  - no new AAROH SKUs and no prices until the catalogue, the SKU structure and final pricing are approved;
  - ₹999 and ₹1,499 are provisional;
  - AAROH checkout stays off.
- Subscription terms are open. A 3-month trial plus ₹999/month is a direction, not an approval.
- No product, plan or entitlement mentions a mode.

**The four options:**

| Option | Requirements | Label |
|---|---|---|
| Included (always on) | No price. But a mode with no content would be an empty page. | PROPOSED analysis |
| **Available after setup** | No price. Activation requires every required field to be valid. | PROPOSED analysis |
| Plan-gated | A decision on which plan, a plan model (doc 03 `plans`, OQ-4: both proposals), and pricing approval under DEC-037 | PROPOSED analysis |
| Add-on | A new SKU and price, which DEC-037 forbids until they are approved | PROPOSED analysis |

**[PROPOSED] Recommendation: Available after setup, at no charge, for every account that has a Tap.**
- No new SKU, price or plan change.
- **Enforced by the server.** The catalogue row for Info carries `entitlement_rule = 'included'`, and `owner.activate` checks it.
- A future pricing DEC can change the rule to a plan or add-on check without changing the API.
- The page shows the server's `available` / `reason` answer. It never shows a price or a plan state of its own.
- Info is drawn with the owner's current Business theme, which is already checked against their entitlements. Info has no theme options of its own in v1, so there is no new paid surface.

---

## 11. Backend records, APIs and state transitions

[PROPOSED] All of this section; nothing is built.

**Migration 034** (L3: DEC-2026-018 cool-off and checklist before any real database). Four tables:
- **`tap_mode_catalog`** (SHYGON-managed, seeded):
  - `key` (`business` | `info`);
  - `enabled` (the kill switch);
  - `schema_version`, `edit_policy`, `entitlement_rule`, `updated_at`.
- **`tap_mode_state`**:
  - `tap_profile_id` (primary key, referencing `tap_profiles` ON DELETE CASCADE) and `user_id`;
  - `active_mode` (referencing the catalogue) and `previous_mode`;
  - `version`, `changed_at`, plus the last idempotency key and its result.
  - No row means Business.
- **`tap_info_content`**:
  - `tap_profile_id` (primary key) and `user_id`;
  - **the Info fields (Q0.3)**;
  - `show_name`, `show_photo`, `version`, `updated_at`.
- **`tap_mode_audit`**:
  - `id` (uuid), `user_id`, `tap_profile_id`;
  - `action`, `from_mode`, `to_mode`;
  - the names of the changed fields (never their values);
  - `actor` (`owner` | `admin` | `system`) and the time.

All four tables follow the 029–033 pattern [OBSERVED]: RLS on, no policies, no grants to client roles. The rls-matrix gate models each one as NONE for every caller.

**Functions:**
- **service_role only:**
  - `modes_owner_state`, `modes_owner_activate`;
  - `modes_info_get`, `modes_info_save`, `modes_info_clear`;
  - `modes_preview`;
  - `admin_list_mode_changes` (support.read, audited);
  - `modes_catalog_set` (admin, audited).
- **Anonymous, SECURITY DEFINER, read-only: `get_public_tap(p_slug)`.** It returns one of:
  - `{ mode: 'business', profile: <the P-1 payload> }`;
  - `{ mode: 'info', info: <the public view> }`;
  - null.

  It follows the same visibility rules as P-1.
- **`get_public_profile` (P-1):**
  - The shape is unchanged.
  - **It returns null when the active mode is not Business.** This changes the meaning of a frozen contract (doc 12 §2), so it goes in contract v0.8's change note.
  - The change must be written against production's re-baselined function, because production's P-1 has drifted ([OBSERVED] V6-106).
  - Every caller of P-1 moves to `get_public_tap`: `PublicTap.tsx` and any preview or SEO path [INFERRED]. The full list is made when implementing.
- P-2 and P-3 are unchanged.

**API `POST /api/modes`** (signed in):
- `owner.state` → `{ activeMode, version, modes: [{ mode, available, reason, missing? }] }`
- `owner.activate { mode, expectedVersion, idempotencyKey }`
- `owner.info.get`
- `owner.info.save { fields, expectedVersion }`
- `owner.info.clear`
- `owner.preview { mode }` → exactly the public view

Errors use the shape `{ error: { code, message, retryAfter? } }`:

| Code | HTTP |
|---|---|
| `unauthorized` | 401 |
| `no_tap` | 404 |
| `tap_suspended` | 409 |
| `mode_unavailable` | 409 |
| `needs_setup` (with `missing`) | 409 |
| `not_entitled` | 403 |
| `stale_version` | 409 |
| `invalid_field` (with the field and the reason) | 422 |
| `mode_active` | 409 |
| `rate_limited` | 429 |

The `DbError` app-code pattern gains `modes`.

**State transitions:**
- **Active mode:**
  - Business → Info needs Info to be ready;
  - Info → Business is always allowed;
  - the kill switch moves Info → Business (actor `system`).
- **Info content:** empty → draft (saved but incomplete) → ready (every required field valid).
  - Ready → draft is refused while Info is active.
- Tap status and suspension are unchanged, and they win on every read.

**Contract:** AAROH-API v0.8 replaces §6 ("NOT IMPLEMENTED"). It is published only after approval and implementation, with a change note to Session B.

---

## 12. Failure, abuse and recovery cases

| Case | What happens | Label |
|---|---|---|
| A viewer role claimed in a URL, query, header or body | Ignored. The public answer is returned. | PROPOSED |
| Another account tries to read, save, preview or activate | 0 rows / `no_tap`. The owner check is in SQL, not only in the function. | PROPOSED |
| Two devices switch at once | The second one gets `stale_version` and the current state | PROPOSED |
| A double click or a network retry | The idempotency key returns the first result, and only one audit row is written | PROPOSED |
| Switching while suspended | Refused. The suspension also wins on every public read. | PROPOSED |
| A partial failure during a switch | One transaction: state, version and audit are all written or none is. The previous mode stays live. | PROPOSED |
| Using a mode to get around Business's 14-day window | Not possible. A switch is not a content edit. Info cannot write Business fields (a separate table and function). Info has none of Business's contact or link fields. | PROPOSED |
| Using Info to avoid paying for contact add-ons | Not possible. Info has no contact fields of its own (§6). | PROPOSED |
| Abusive or phishing content in Info | The existing moderation suspension covers the whole Tap ([OBSERVED] 028). Links are https only and validated. | OBSERVED; PROPOSED |
| A visitor report button for Info | Not in scope. Rescue's report exists only for relay threads ([OBSERVED] 031). | OBSERVED |
| Rapid flapping between modes | Limited to 20 switches per hour | PROPOSED |
| Save spam | Limited to 30 saves per hour | PROPOSED |
| Slug enumeration | No new surface: the same slug lookup as P-1 (F7 / DEC-2026-011 still open). The mode name tells a visitor only which mode is showing. | OBSERVED; PROPOSED |
| SHYGON has to pull a mode quickly | Kill switch: Business is served, the owner is notified, and the change is audited | PROPOSED |
| Production P-1 has drifted | The null rule must be written against the re-baselined body (human release track) | OBSERVED (V6-106); PROPOSED |
| A bad migration | 034 carries a tested ROLLBACK block and is idempotent, as 029–033 are | PROPOSED |
| Account deletion | The runbook deletes the four tables' rows, proven by a negative control | PROPOSED |
| The UI shows a switch that did not happen | Forbidden by the handoff: "Live" appears only after the server answers. Session B's e2e checks it. | PROPOSED |

---

## 13. Acceptance criteria and tests

**Before implementation (the decision)** [PROPOSED]:
- Q0 is answered.
- Every Info field has a row in §9.
- Q1–Q7 are decided.

**Implementation: `test:modes`**, on the local stack under deny-network [PROPOSED]:
1. A Tap with no state row resolves as Business, and the `get_public_profile` payload is identical to today's (the golden test is unchanged).
2. Activating Info with missing required fields returns `needs_setup` with the field names, and the state is unchanged.
3. Activating a ready Info succeeds. `get_public_tap` then returns `info` with only allowlisted fields, and `get_public_profile` returns null.
4. Switching back restores the identical Business payload.
5. A paused or suspended Tap is unavailable whatever the mode, and activation is refused while it is suspended.
6. Cross-tenant: account B cannot read, save, preview or activate account A's modes.
7. The anonymous role cannot call owner functions. No client role can read the four tables (rls-matrix NONE, all 7 callers).
8. Role spoofing: an anonymous request with a role or viewer field in the body, query or headers gets the public answer.
9. A stale version returns 409 with the current state. Replaying an idempotency key returns the same result and writes one audit row.
10. The save and switch rate limits hold.
11. Info and Business stay separate:
    - an Info save leaves `tap_profiles` untouched, including `last_content_edit_at`;
    - a Business content edit inside the window is still refused;
    - the Pass still removes the Business window.
12. Clearing a required field while Info is active returns `mode_active`.
13. The kill switch serves Business, notifies the owner and writes an audit row.
14. **Public-leak canaries.** Canary strings are placed in:
    - `profiles.*`;
    - Business fields that are switched off;
    - emergency, rescue, Connect and Privé tables;
    - admin notes.

    None of them appears in any output of `get_public_tap` or `get_public_profile`, in any mode (the pattern from doc 13 §6).
15. Field validation: lengths, https-only links, no HTML or script.
16. Account deletion removes the state, Info content and audit rows. Negative control: the old runbook fails this check.
17. 034's ROLLBACK block is tested, and the migration can be re-run safely.
18. `admin-contract` lists the new functions as PROPOSED, and as APPROVED only after this DEC is approved.

**Frontend acceptance** (Session B's e2e):
- the pending, success and failure states;
- no optimistic switch;
- the preview is identical to the public page.

**Regression:** these must stay green:
- test:db, test:public-tap, test:suspension;
- test:emergency, test:rescue, test:connect, test:prive.

---

## 14. Alternatives considered and trade-offs

**Relationship with Business (A / B / C):** see §5.

**Data model:**
- **(i) Personas, from doc 03.** Several `tap_profiles` rows per account: relax `UNIQUE(user_id)`, add `context`, add `tap_routes`.
  - Rejected for now.
  - It changes the frozen Business table, which every admin RPC and the edit trigger depend on.
  - It needs three undecided proposals: OQ-4 (personas per plan), OQ-5 (window per persona) and DEC-2026-032.
  - It puts Business's columns into every mode.
- **(ii) A jsonb "mode pages" column on `tap_profiles`.**
  - Rejected.
  - It is an unrestricted editor in disguise.
  - Every Info save would update `tap_profiles`, which tangles Info with the Business trigger and window.
  - One blob makes per-field public/private separation hard to test.
- **(iii) Recommended: a closed table per mode, plus a small state table.**
  - It only adds; Business rows are untouched.
  - Rollback drops four tables and removes the null rule from P-1.
  - Cost: each new mode needs its own migration. That is intended, because each mode defines its own schema.

**Info's edit policy (Q3):**

| Option | What it means |
|---|---|
| **A (recommended)** | No window; a limit of 30 saves per hour |
| B | Share Business's 14-day window: an edit to either mode starts the 14 days for both |
| C | A separate 14-day window for Info; the Pass removes both |

B and C extend a paid restriction to a new surface, which is a pricing decision under DEC-037.

**Pricing:** see §10.

**Public read path:**
- **An anonymous SQL function (recommended).** It works like P-1, with no extra network hop.
- **A Netlify function.** It would give rate-limit and visitor-digest control. But it adds a hop to every tap and a second public path to keep in step.

**Kill-switch fallback:**
- **Business (recommended).** It is content the owner already published.
- **"Unavailable".** It is stricter, but every tap breaks until the owner acts.

---

## 15. Recommendation

**[PROPOSED] One option: C, staged, starting with C-1.**
- Each Tap has **one active mode**, chosen by its owner in SHYGON OS.
- **Business is the default** and is untouched: no state row means Business, today's payload, and the 14-day rule as it is.
- **Info**, once defined, is a separate structured record:
  - it never writes Business;
  - it reuses Business's name and photo only by reference, behind its own switches;
  - it carries no contact fields of its own.
- **Switching** is a server-validated, versioned, idempotent, audited call, and the public URL never changes.
- **Pricing:** Info is **available after setup at no charge**, enforced by the server, with no new SKU or price (DEC-037).
- **The capabilities** (Emergency, Return-to-Owner, Connect) stay independent of the mode.
- **Later, each with its own DEC:** per-card modes (C-2), several modes visible at once (C-3), and any trusted-contact, organisation or emergency viewer.

**Why:**
- It delivers the owner's model with the smallest change to what already works. Business is untouched, and the only change to the frozen P-1 is "null while another mode is active".
- It keeps privacy closed by default: one mode is public at a time.
- It invents no price.
- It can grow to per-card modes without moving data.

## Questions for the owner

| Q | Decision | Recommended |
|---|---|---|
| **Q0** | What Info is (Q0.1–Q0.7) | **OWNER TO DEFINE.** Nothing is built for Info until this is answered. |
| Q1 | Relationship with Business | **C, staged:** C-1 now; C-2 and C-3 each need their own DEC |
| Q2 | Data model and public read path | **(iii)**: a closed table per mode plus a state table. `get_public_profile` returns null when the mode is not Business; the new `get_public_tap` is an anonymous SQL function. |
| Q3 | Info's edit policy | **A**: no 14-day window, 30 saves per hour. Re-authentication only for fields Q0.4 marks sensitive. |
| Q4 | Switching rules | Owner only, versioned, idempotent, 20 switches per hour. **The kill switch falls back to Business** (alternative: "unavailable"). |
| Q5 | Pricing | **Available after setup, at no charge**, enforced by the server; no SKU, no price |
| Q6 | Viewer roles for Info v1 | **Public visitor and owner only.** Trusted contacts, organisation members and emergency contexts are treated as public visitors until a DEC defines them. |
| Q7 | The "must never appear" list | **Adopted as tested invariants (§9) for every mode** |

## After approval

[PROPOSED] Session A writes 034, `/api/modes`, `test:modes` and contract v0.8. All of it is local.
- L3: DEC-2026-018's cool-off and checklist come before any real database.
- Nothing is applied, pushed or deployed without the release track.

## Expected result vs observed result

To be filled at verification.
