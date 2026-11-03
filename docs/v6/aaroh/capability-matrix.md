# SHYGON AAROH capability matrix and backend process definitions (Session A, 2026-10-19)

**Status update 2026-10-19:** DEC-2026-038 approved (Q1–Q13 as recommended). See the record for outcomes.

**Sources:**
- this repository at `v6/aaroh-backend`;
- the architecture pack `docs/shygon-os/` (docs 03, 04, 05, 07, 08, 10; their designs are PROPOSED unless a DEC approves them);
- the owner's decisions of 2026-10-16 (relayed; DEC-037 not yet filed);
- the three briefs of 2026-10-19.

**Labels:**

| Label | Meaning |
|---|---|
| OBSERVED | in code, schema or tests |
| INFERRED | reasoned from them |
| PROPOSED | designed, not approved |
| APPROVED | an owner decision or DEC says so |
| IMPLEMENTED | built and tested locally (LIVE-LOCAL) |

Nothing here is deployed. Production runs the V5 schema with drift (V6-106).

## 1. Matrix

| # | Capability | Implemented | Partial | Planned | Unknown | Evidence | Gap |
|---|---|---|---|---|---|---|---|
| 1a | **Emergency SOS** (owner alerts verified contacts) | ✔ (local), APPROVED Q1 | | | | 029, `/api/emergency`, `test:emergency` 47 | live SMS: MSG91 account + DLT templates (Q3, human), smoke test |
| 1b | **Emergency alert from the public page** (visitor → owner's contacts, relay only) | ✔ (local), OFF by Q2 = B | | | | same; host switch `EMERGENCY_PUBLIC_ALERTS`, owner opt-in | revisit after supervised owner alerts |
| 1c | **Emergency Profile / Emergency Tap information view** | decided Q11 = B (no new backend) | | | | presentation of `public.status`; only action = 1b | hidden while 1b is off; never a contact detail |
| 2 | **Return-to-Owner / SHYGON Rescue** (protected finder relay) | ✔ (local), APPROVED Q12, off until release | item lifecycle | | | 031, `/api/rescue`, `test:rescue` 18 | lost mode needs the card registry |
| 3 | **Smart Identity / SHYGON ID** | account identity ✔ | customer-facing ID | | the ID's format | `customers.customer_id` (`CUST-…`), 021 identity contract 69 | D-9 (what the customer-facing ID is) |
| 4 | **SHYGON Connect** | ✔ (local), APPROVED (DEC-2026-039, 2026-10-20); **off by host switch** `CONNECT_PUBLIC` (amendment A-1, built 2026-10-23) | guest requesters: not built, by decision (Q1 = A) | | | 032, `/api/connect`, `test:connect` 17 | release track; customer wording; the owner sets `CONNECT_PUBLIC=on` only after verifying the connection and consent workflows |
| 5 | **Student Passport / Student Tap** | | | ✔ | | doc 10 Phase 2; minors' data | legal review DEC-2026-017 (hard gate) |
| 6 | **SHYGON Verify** | | | ✔ | | doc 03 `credentials`, `verification_records`; doc 10 Phase 3 | issuers (organisations); DEC-037: an AAROH card is not a credential |
| 7 | **Business Tap / professional profile** | ✔ (local) | | | | `get_public_profile`, Tap editor, add-ons, themes; public-tap 25, golden, identity, matrix | production parity (V6-106) |
| 8 | **Event Tap** | | seasonal event themes ✔ | event mode | | `tap_event_themes` (admin-managed timed themes) | event-specific profile, attendees: Phase 2 |
| 9 | **Info** (a public page about a thing or place) / SHYGON Locations | ✔ (local), implementation approved 2026-10-24 (DEC-2026-041); **off in the catalogue** (a per-environment owner switch; BQ-1 built in 035) | Locations ✔ (Phase 4); multiple pages, images, languages and links: not in v1 | | | 034, 035, `/api/modes`, `get_public_tap_mode`, `test:modes` 28 | wording (F-19); Terms (F-13); P1/P2 previews; release track |
| 10 | **Access Tap** | | | gated (Phase 5) | | doc 10: pen-test, SDM hardware, legal | **Unsupported** for AAROH (DEC-037) |
| 11 | **SHYGON Privé demo** | ✔ (local), demo only; APPROVED (DEC-2026-040, 2026-10-20) | | real hotel integrations: not built, by decision | | 033, `/api/prive`, `test:prive` 12 | release track; customer wording |
| 12 | **Cloud Storage** | | | ✔ | | showroom Planned; storage bucket gaps V6-095/V6-108 | no design approved |
| 13 | **Lost mode** (the owner's own card is missing: "Found this card?" and Return to Owner's form only) | ✔ (local), APPROVED (DEC-2026-041 A-1, 2026-10-25); **off in the catalogue and behind `RESCUE_RELAY`**; hardened after the OpenCode review (contract v0.11.1, 2026-11-02) | Guardian and a lost-item lifecycle: not built, by decision | | | 036, `/api/modes`, `get_public_tap_mode`, `/api/rescue`, `test:modes` 28 | Return to Owner live (hosted P1); wording (F-19); L-1 to L-6 confirmation (F-27); OC-7 frontend review |
| 14 | **Verified Tap** (NTAG 424 DNA SUN at `/d/<code>`; the verdict and the edition line) | backend ✔ (local), APPROVED FOR THE LOCAL BUILD ONLY (DEC-2026-043, 2026-10-31); **off by host switch `VERIFIED_TAP`**; test keys only | the `/d/` page and badge (Session B): not started | real keys, personalisation, the first chip batch | | 037, `/api/verify`, `netlify/lib/sun.mjs`, `test:verified-tap` 17, `test:sun` 27 | key custody (F-16 Q2), personalisation (Q3), inlay (Q7); the Q5 deviation (F-14); OC-6 review |

Card lifecycle sits under every capability that a physical tap starts. It is partial for V5 cards (activation, OTP, replacement request) and BLOCKED for AAROH: no cards are sold, there is no registry, and `/d/` is not built (contract §3 P-4 and §7).

## 2. Honest availability states

These describe what a customer could be told if this branch were deployed with its prerequisites. The showroom's own vocabulary stays the owner's (DEC-038 Q10).

| Capability | State today | State once its blockers clear |
|---|---|---|
| Business profile | Available after setup (claim an address, publish); Plan-gated for themes and add-ons | same |
| Emergency SOS | Coming soon (provider not configured) | Available after setup (verify a contact) |
| Visitor emergency alert | Coming soon (switch off) | Available after setup (owner opt-in), if Q2 = A |
| Emergency Profile | Coming soon (undecided) | after Q11 |
| Return-to-Owner | Coming soon (switch off) | Available after setup (owner opt-in), if Q12 = A |
| SHYGON ID | Available (account), customer-facing ID Coming soon | after D-9 |
| Connect, Verify, Student, Event mode, Info, Locations, Cloud | Coming soon | after their decisions |
| Access | Unsupported | — |
| Privé | not shown | Demo, if Q6 = A |
| Lost mode | Coming soon (switches off) | Available after setup (Return to Owner opt-in), once Return to Owner is live |
| Verified Tap | not shown (`/d/` answers 404) | Available on new cards from the first personalised batch; older cards keep `/t/` |

## 3. Process definitions

Format per capability:
- **Actor · Trigger · Preconditions**
- **Authorization** (server-side)
- **Reads / writes**
- **States**
- **Response**
- **Failures**
- **Limits**
- **Audit**
- **Privacy**
- **Tests**
- **Existing vs new**

### 1a. Emergency SOS (IMPLEMENTED locally; brief 1 of 2026-10-19 specifies this flow)

- **Actor · Trigger · Preconditions.** The signed-in owner presses "Alert my contacts" (`alerts.create`). At least one verified contact.
- **Authorization.** A Supabase Auth token verified by the server. Every database step is a definer function only `service_role` can run, scoped to the token's user.
- **Reads / writes.** Reads `emergency_contacts` (verified). Writes `emergency_events`, `emergency_event_recipients`, `emergency_delivery_attempts` and `emergency_audit`.
- **States.** queued → sending → sent, delivered, partial, failed, not_sent or cancelled (contract §10.4).
- **Response.** 201 with the event (per-recipient status and a `safety` line); 200 replay.
- **Failures.**
  - 422 no verified contacts; 409 in progress; 429 limits;
  - provider refusal → failed; outage or timeout → retry_wait (3 attempts);
  - no provider → not_sent;
  - database failure → `sending`, never `sent`.
- **Limits.** One per 2 min, 5 per hour, 10 per 24 h; idempotency key.
- **Audit.** `alert.created`, `alert.refused`, `delivery.attempt`, `delivery.receipt`, `alert.cancelled`, `alert.reported`.
- **Privacy.** Masked numbers to the browser only; no location; never claims emergency services.
- **Tests.** `test:emergency` Part A and B.
- **Existing vs new.** All new (029). It reuses `netlify/lib/sms.mjs`, which was extended.

### 1b. Emergency alert from the public page (IMPLEMENTED locally, OFF)

- **Actor · Trigger · Preconditions.** An anonymous visitor on `/t/<slug>` confirms "Alert this person's emergency contacts" (`public.alert`, `confirm: true`). Preconditions:
  - host `EMERGENCY_PUBLIC_ALERTS=on`;
  - the owner opted in with an acknowledgement;
  - a verified contact exists;
  - the Tap is published and nothing is suspended.
- **Authorization.** None for the visitor. The server decides availability (`emergency_public_target`) and re-checks it under lock.
- **Reads / writes.** As 1a, plus an owner `notifications` row of category `security`.
- **States.** As 1a.
- **Response.** 202 `{ outcome, safety }`. Never who was alerted or how many.
- **Failures.** 404 unavailable (indistinguishable causes); 429; 503 `service_busy`.
- **Limits.** 3 per owner per 24 h; 15 min per Tap; 1 per visitor per Tap and 3 per visitor per day; 50 per hour platform-wide.
- **Audit.** As 1a; a refusal records only its code.
- **Privacy.** Relay only. The visitor identity is an HMAC of the host-reported IP and the day.
- **Tests.** `test:emergency` (host switch off, then on).
- **Existing vs new.** New.

### 1c. Emergency Profile / Emergency Tap information view (NOT IMPLEMENTED: AMBIGUOUS)

Three readings exist, and the repository does not choose between them:
- **(i)** doc 04: a responder deliberately triggers a purpose-bound "release" of an owner-approved emergency payload, rate-limited 3 per day per device, with owner notification and audit. Doc 07 T18 recommends relaying a callback, not revealing numbers, and no medical data;
- **(ii)** the showroom: "emergency details that you approve, shown only in an emergency flow";
- **(iii)** a public emergency page that shows contact numbers to anyone who taps. This is **excluded** by every source and by the master requirement: "must not be disclosed to a stranger merely because an NFC/QR page was opened".

Undecided: which fields, whether any number is ever shown or only relayed, the trigger, and whether it is default-off. **Not built. DEC-038 Q11.** 1b already provides the relay form of (i).

### 2. Return-to-Owner / SHYGON Rescue (IMPLEMENTED locally, OFF; migration 031)

- **Actor · Trigger · Preconditions.**
  - The finder (anonymous) on `/t/<slug>`: `public.start` with a message, then `finder.view` and `finder.post` with the finder token.
  - The owner (signed in): `settings.*`, `threads.*`.
  - Preconditions: host `RESCUE_RELAY=on`; the owner opted in; the Tap is published; nothing is suspended; the finder is not blocked.
- **Authorization.**
  - Finder: possession of a 256-bit token, derived by the server and stored only as SHA-256. It expires 14 days after the last activity.
  - Owner: a verified token, scoped to their own threads.
- **Reads / writes.** `rescue_settings`, `rescue_threads`, `rescue_messages`, `rescue_blocks` and `rescue_audit`; `notifications` (category `rescue`, never the message text); `admin_notifications` on a report.
- **States.**
  - thread: open → owner_replied ⇄ open; closed (owner or 30 days idle); blocked; spam (reported);
  - a finder may write at most 3 messages in a row without a reply.
- **Response.**
  - finder: `{ finderToken, thread: { status, canWrite, expiresAt, messages[{from, body, at}] } }`;
  - owner: thread lists and details.
- **Failures.** 404 unavailable or not found; 410 expired; 409 closed or awaiting the owner; 429 limits; 400 invalid.
- **Limits.**
  - finder: 3 threads per hour and 10 per day per finder digest; 5 threads per owner per day; 10 follow-ups per thread per hour; 60 polls per thread per hour;
  - messages: 1–500 characters with links removed;
  - idempotency per thread (start) and per message (client key).
- **Audit.** `thread.opened`, `thread.refused`, `message.sent`, `thread.close`, `thread.block`, `thread.report`, `settings.*`. `admin_list_rescue_reports` reads are in `admin_audit_log`.
- **Privacy.** The finder gets no owner field; the owner sees only what the finder writes. The finder digest is a keyed HMAC of the host-reported IP, kept for limits and blocks. Retention: 90 days after close.
- **Tests.** `test:rescue`.
- **Existing vs new.** New.
- **Not built (BLOCKED).**
  - lost / found item lifecycle and device-bound items (card registry; DEC-2026-028);
  - a bot check (no Turnstile key);
  - a text-message notice to the owner: the account phone is unverified (F4) and no provider is configured. The notice is in-app only.

### 3. Smart Identity / SHYGON ID (PARTIAL, existing)

- **Actor · Trigger.** The account owner signs up or signs in.
- **Authorization.** Supabase Auth.
- **Writes.** `handle_new_user` writes `customers` (`CUST-…`) and `profiles`. 021 resolves `customer_id`.
- **Tests.** `test:identity` 69.
- **Gap.** The customer-facing SHYGON ID is undefined (D-9). Nothing new was built.

### 4. SHYGON Connect (IMPLEMENTED locally, 032; APPROVED, DEC-2026-039)

Built as described below, for signed-in accounts only. See contract §10b.

**Since 2026-10-23 (B-10, DEC-2026-039 amendment A-1):** Connect is public only where the host sets `CONNECT_PUBLIC=on`; it is unset everywhere by default.
- While off, `public.status` is false and creating, accepting or widening a connection answers 404 `unavailable` before any database call.
- Decline, block, remove and the lists always work.
- Settings report `publicAllowed`.

Evidence: `test:connect` 17 and `docs/v6/aaroh/B-10_release-readiness.md`.

The rest of this section is the original design note.


- **Actor · Trigger.** A visitor (signed in, or a guest who enters details voluntarily) requests to connect from `/t/<slug>`. The owner accepts or declines; either side may revoke.
- **Writes.** `connections` (requested → accepted, declined, blocked, expired or removed) and `consent_grants` (append-only; revocation sets `revoked_at`).
- **Authorization.** Owner RPCs scoped by `auth.uid()`. The guest path is a relay like Rescue.
- **Limits and audit.** As doc 04 §4.2.
- **Status.** NOT IMPLEMENTED. It depends on the consent ledger design and on DEC-2026-025 (organisations), and the owner's order puts it after Return-to-Owner. DEC-038 Q13.

### 5. Student Passport (PLANNED)

Doc 10 Phase 2: self-asserted achievements, restricted defaults for minors, and an age band. **Hard gate:** legal review of minors' data under the DPDP Act (DEC-2026-017). NOT IMPLEMENTED.

### 6. SHYGON Verify (PLANNED)

Doc 03: `credentials` (provenance `self_asserted`, `org_attested` or `platform_verified`, enforced by a trigger) and `verification_records` (append-only). The master requirement "distinguish self-reported from source-backed" is exactly that provenance column. It needs issuers (organisations, DEC-025). DEC-037 says an AAROH card is not a credential. NOT IMPLEMENTED.

### 7. Business Tap (IMPLEMENTED locally, existing)

The contract's §3 and §5: `get_public_profile`, `get_public_tap_state` and `record_tap_event` (public); owner reads and writes under RLS with the paid-feature triggers and 030; `claim_tap_slug`. States: draft → active ⇄ paused, plus moderation suspension. Tests: public-tap, golden, identity, matrix, suspension and emergency (030).

### 8. Event Tap (PARTIAL, existing themes only)

`tap_event_themes` are admin-defined, date-bounded theme overrides applied in `get_public_profile` (`activeEvent`). An event-specific profile, attendees and check-in are not built (doc 10 Phase 2; "ticketing and check-in are not part of AAROH" in the showroom).

### 9. Info (IMPLEMENTED locally, 034; implementation approved 2026-10-24, DEC-2026-041; OFF in the catalogue) / SHYGON Locations (PLANNED)

Built as contract §6: one Info page per account, plain text (title, short description, category, details), switched by the owner through `/api/modes` and read by visitors through `get_public_tap_mode`. Info stays off in `tap_mode_catalog` until BQ-1. The notes below are the earlier state.


- "Info" is named by the owner (2026-10-16) but defined nowhere.
- Locations (doc 03 `locations`, `location_content`) is Phase 4.

NOT IMPLEMENTED. DEC-038 Q7.

### 10. Access Tap (UNSUPPORTED)

Doc 10 Phase 5 gates: an independent pen-test, SDM hardware in the field, and legal review for physical access. DEC-037: an AAROH card is not an access credential.

### 11. SHYGON Privé demo (IMPLEMENTED locally, demo only; 033, APPROVED, DEC-2026-040)

Decided 2026-10-20: demo-only. Built as below, for signed-in accounts; see contract §10c. The rest of this section is the original design note.


The conflict is DEC-038 Q6. If the owner chooses demo-only:
- a `demo_` schema area holding SHYGON-owned sample hotels;
- guest-service requests written to it under the requester's account, each marked `demo: true` in every response;
- no network calls to any hotel, PMS, booking or access system, and a future integration interface left as a stub.

### 12. Cloud Storage (PLANNED)

No design is approved. The existing storage gaps come first: `profile-images` policies (V6-095) and the bucket missing on production (V6-108). NOT IMPLEMENTED.

### 13. Lost mode (IMPLEMENTED locally, OFF; migration 036, APPROVED, DEC-2026-041 A-1)

- **Actor · Trigger · Preconditions.**
  - The owner (signed in) switches the Tap to Lost with `/api/modes` `owner.activate`.
  - A finder (anonymous) opens the Tap and sees only "Found this card?" with Return to Owner's form (§2 above).
  - Preconditions, all needed: SHYGON has Lost on (`tap_mode_catalog`, OFF by default); the host has `RESCUE_RELAY=on`; the owner's own Return to Owner opt-in is on. Switching to Lost never turns the opt-in on (L-1).
- **Authorization.** Owner: a verified token, scoped to their own Tap. Finder: Return to Owner's own rules (§2).
- **Reads / writes.** `tap_mode_state` and `tap_mode_audit` (one row per switch); reads `tap_mode_catalog` and `rescue_settings` (share-locked during activation). Finder messages live in Return to Owner's tables.
- **States.** Business, Info or Lost: one active mode per Tap. Switching to Business is always allowed; nothing switches while the Tap or the account is suspended.
- **Response.** The public reader answers `{ mode: 'lost' }` (one key) or `null`, never Business. The owner's preview answers `{}` or `null`, exactly as a visitor would get it.
- **Failures.** `mode_unavailable` (catalogue or relay off); `needs_setup` with `missing: ['returnToOwner']`; `stale_version`; `tap_suspended`. With the relay off and the catalogue on, the reader may still answer `{ mode: 'lost' }`; `public.status` then answers `false` and the page shows the neutral "unavailable" copy (contract v0.11.1).
- **Limits.** Return to Owner's finder limits apply unchanged.
- **Audit.** `tap_mode_audit` (`activate`, with the from and to modes); Return to Owner's audit for messages.
- **Privacy.** The Lost page carries no Business or Info field, no owner detail and no new public field. P-1 (`get_public_profile`) is `null` while Lost is active (035). Any switch turned off gives the neutral `null`.
- **Tests.** `test:modes` section C (the catalogue × relay matrix, the relay-off reader, the replay across the relay switch, the lock order); `test:rescue`.
- **Existing vs new.** A new mode on the 034 machinery; Return to Owner (031) is unchanged.
- **Not built.** Guardian (deferred with visitor alerts); a lost-item lifecycle tied to the card registry (DEC-2026-028, T-08/T-09).

### 14. Verified Tap (backend IMPLEMENTED locally, OFF; migration 037, APPROVED FOR THE LOCAL BUILD ONLY, DEC-2026-043)

- **Actor · Trigger · Preconditions.**
  - A visitor (anonymous) taps a new card. The phone opens `/d/<code>?e=…&c=…`, and the page's script calls `/api/verify` `tap.verify` after load.
  - Preconditions: host `VERIFIED_TAP=on`; keys for the card's key epoch on the host; the card active and its Tap live; the host reports a trusted visitor address (`TRUSTED_CLIENT_IP_HEADER`).
- **Authorization.** None for the visitor: the proof is the chip's per-tap MAC. Keys are derived per card (AN10922, by the device id, D-a) and never stored, logged or returned.
- **Reads / writes.** `tap_device_auth` (locked per check: the last counter, last verified and retired dates); `tap_verify_events` (append-only: code, verdict, a daily visitor digest, time). Reads `cards` and the Tap.
- **States.** Device: ready, then retired (or at its counter limit: `needs_service`). Each counter value can be `genuine` once.
- **Response.** `{ slug, verdict, edition? }`. Verdicts: `genuine`, `already_checked`, `not_confirmed`, `needs_service`, `unavailable`, `not_verified`; `null` for a Tap in Lost mode. Never "fake".
- **Failures.** 404 `unavailable` (switch off, unknown code, card or Tap not live, no trusted address: indistinguishable); 400; 405 (a GET consumes nothing); 429; 503 (never a positive verdict).
- **Limits.** 30 checks per visitor per hour; 20 refused checks per card per hour.
- **Audit.** `tap_verify_events` (90-day retention, `verify_purge`).
- **Privacy.** The chip UID is compared only as a keyed digest and is never stored or returned. The page strips `e` and `c`, sends no referrer and is not cached. It proves the chip, never the person holding it.
- **Tests.** `test:verified-tap` 17 (a simulated chip with random test keys); `test:sun` 27 (published known-answer vectors; secret-scan exception E-1).
- **Existing vs new.** New. Legacy `/t/<slug>` cards are unaffected.
- **Not built.** Real keys and their custody (Q2), personalisation (Q3), the first batch and inlay (Q7), the `/d/` page and badge (Session B), card pairing and "report stolen" (T-08/T-09, DEC-2026-028).

## 4. Order of work (the owner's 2026-10-16 order, applied)

1. Business (done).
2. Info (needs a definition).
3. **Return-to-Owner (built, off).**
4. Emergency (built, off/BLOCKED).
5. Then by dependency and approval: Connect (consent ledger), Verify (organisations), Student (legal), Event mode, Locations, Cloud, Access (gated), Privé (decision).
