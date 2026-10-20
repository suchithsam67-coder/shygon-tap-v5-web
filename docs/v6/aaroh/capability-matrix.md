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
| 4 | **SHYGON Connect** | ✔ (local), APPROVED (DEC-2026-039, 2026-10-20) | guest requesters: not built, by decision (Q1 = A) | | | 032, `/api/connect`, `test:connect` 16 | release track; customer wording |
| 5 | **Student Passport / Student Tap** | | | ✔ | | doc 10 Phase 2; minors' data | legal review DEC-2026-017 (hard gate) |
| 6 | **SHYGON Verify** | | | ✔ | | doc 03 `credentials`, `verification_records`; doc 10 Phase 3 | issuers (organisations); DEC-037: an AAROH card is not a credential |
| 7 | **Business Tap / professional profile** | ✔ (local) | | | | `get_public_profile`, Tap editor, add-ons, themes; public-tap 25, golden, identity, matrix | production parity (V6-106) |
| 8 | **Event Tap** | | seasonal event themes ✔ | event mode | | `tap_event_themes` (admin-managed timed themes) | event-specific profile, attendees: Phase 2 |
| 9 | **Info Tap / SHYGON Locations** | | | Locations ✔ (Phase 4) | **Info is undefined** | owner 10-16: "Business and Info first" | definition (DEC-038 Q7) |
| 10 | **Access Tap** | | | gated (Phase 5) | | doc 10: pen-test, SDM hardware, legal | **Unsupported** for AAROH (DEC-037) |
| 11 | **SHYGON Privé demo** | | | | | Q6 read as B: out of the launch | owner says "Privé demo-only" to change it |
| 12 | **Cloud Storage** | | | ✔ | | showroom Planned; storage bucket gaps V6-095/V6-108 | no design approved |

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

Built as described below, for signed-in accounts only. See contract §10b. The rest of this section is the original design note.


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

### 9. Info Tap / SHYGON Locations (PLANNED / UNDEFINED)

- "Info" is named by the owner (2026-10-16) but defined nowhere.
- Locations (doc 03 `locations`, `location_content`) is Phase 4.

NOT IMPLEMENTED. DEC-038 Q7.

### 10. Access Tap (UNSUPPORTED)

Doc 10 Phase 5 gates: an independent pen-test, SDM hardware in the field, and legal review for physical access. DEC-037: an AAROH card is not an access credential.

### 11. SHYGON Privé demo (BLOCKED: conflicting instructions)

The conflict is DEC-038 Q6. If the owner chooses demo-only:
- a `demo_` schema area holding SHYGON-owned sample hotels;
- guest-service requests written to it under the requester's account, each marked `demo: true` in every response;
- no network calls to any hotel, PMS, booking or access system, and a future integration interface left as a stub.

### 12. Cloud Storage (PLANNED)

No design is approved. The existing storage gaps come first: `profile-images` policies (V6-095) and the bucket missing on production (V6-108). NOT IMPLEMENTED.

## 4. Order of work (the owner's 2026-10-16 order, applied)

1. Business (done).
2. Info (needs a definition).
3. **Return-to-Owner (built, off).**
4. Emergency (built, off/BLOCKED).
5. Then by dependency and approval: Connect (consent ledger), Verify (organisations), Student (legal), Event mode, Locations, Cloud, Access (gated), Privé (decision).
