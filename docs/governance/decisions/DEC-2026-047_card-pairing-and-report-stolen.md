# DEC-2026-047: Card pairing and "report stolen" (V01 tasks T-08 and T-09): the V01 subset of DEC-2026-028

| Field | Value |
|---|---|
| Decision ID | DEC-2026-047 |
| Title | How an owner takes possession of an AAROH card, and how they switch it off for good, using the smallest part of the card lifecycle (DEC-2026-028) that V01 needs |
| Date opened | 2026-11-10 |
| Domain | Product (card behaviour, irreversible for shipped cards: doc 13 §3.3); Security (who can activate or disable a card) |
| Level | **L3**: card state rules, a new public-path behaviour, and the Verified Tap answer |
| **Accountable Owner (A)** | The repository owner (the founder), who holds the product roles (DEC-2026-018 Option B) |
| Responsible (R) | Session A (backend). Session B (frontend): the card page and the `/d/<code>` "activate" step |
| Consulted | The coordination session (V01 task registry T-08, T-09: "Draft DEC-028's V01 subset as PROPOSED; no build yet") |
| Depends on | **F-14** (the founder accepting the Verified Tap Q5 deviation: the code lives in `tap_device_auth`, not on `cards`). This record assumes it is accepted (Q5) |
| State | **PROPOSED, 2026-11-10.** Docs only. Nothing is built. DEC-2026-028 itself stays PROPOSED; this record answers only what V01 needs from it |

Labels: **OBSERVED** (in the live baseline, the code or a decision record), **INFERRED**, **PROPOSED**.

## 1. Question

V01 scope (§2.3) lists two card features:
- **Card pairing / registry (minimal):** "Bind a personalised card (code + epoch) to an owner at activation; DEC-028 lifecycle states."
- **Lost-card protection:** "An owner action that retires a card (Verified Tap → needs_service)."

Which states, which writer, what proves the owner holds the card, and what does a disabled card show?

## 2. What exists today [OBSERVED]

Sources: `docs/shygon-os/CARD_LIFECYCLE_DECISION_SUMMARY.md`, the live baseline, 037.

- **Two state columns.** `cards.status` (varchar, no CHECK; every function writes it) and the legacy `card_status` (CHECK `inventory, assigned, active, suspended, replacement, retired`; only `request_card_replacement` writes it).
- **Four writers of `active`, three with weak or no owner proof:**
  - P-1 is `card-otp`. Since T-11 it is sent only to a **verified** phone past its wait; before that, the phone was editable (F4).
  - P-2 is the printed activation code, which the owner can read in plain text (O-3).
  - P-3 is delivery auto-activation by an administrator, with no owner step.
  - P-4 is an administrator's manual change.
- **No `lost`, `retired` or "stolen" path for owners.** `request_card_replacement` suspends; `replaced` is written only by an administrator.
- **The public `/t/<slug>` never reads `cards` (F3).** Deactivating a V5 card does not stop it opening the Tap.
- **Verified Tap (037):**
  - `tap_device_auth` binds a chip's public code and key epoch to `cards.id` at personalisation (`verify_register_device`, service only).
  - `verify_device_lookup` answers **`unavailable` (404) unless `cards.status = 'active'`** and the Tap is live.
  - With the device's `retired_at` set on an active card, it answers `needs_service` above the Tap page.
- **Lost mode (036)** is a Tap mode: "Found this card?" plus Return to Owner. It is for "I lost it, help a finder return it", not for "it is gone, switch it off".
- **No AAROH card is sold yet** (DEC-037: checkout off). So no AAROH card runs through the V5 order and delivery path today.

## 3. The proposal [PROPOSED]

### 3.1 States (DEC-2026-028 Q1, Q2, V01 subset)

- **`cards.status` is the canonical column,** with doc 08 §4's names. V01 uses: `pending` (issued to an owner), `shipped`, `active`, `suspended` (reversible), `replaced` (as today) and **`retired`** (terminal, new for owners).
  - `unassigned`, `lost` (as a card state) and `transfer_pending` are not used in V01. Lost is the Tap's mode (036); transfer is later.
- **`card_status` is frozen:** no new code writes it. The admin app reads both columns (frozen contract), so neither is removed.
- **One writer for new code:** `card_transition(card, to, actor, reason)` (service only). It enforces the allowed moves and records each one in a new append-only `card_events` (card, from, to, actor, reason, time).
  - The existing V5 and admin writers stay as they are in V01; they are frozen, and changing them is a separate decision.
- **A CHECK on `status`** (`NOT VALID`, then `VALIDATE`) only after a human read-only count on production (V6-106). Locally it ships `NOT VALID`.

### 3.2 Pairing an AAROH card: "tap to activate" (T-08)

- **The binding chain already exists:** `tap_device_auth.public_code` + key epoch → `cards.id` (personalisation) → `cards.user_id` (the order that bought it). Pairing makes it live for its owner.
- **Activation needs two things at once:**
  - the card in hand: a **genuine** Verified Tap on that card, within 10 minutes;
  - the owner's own signed-in session: the account the card was issued to.
- **The mechanics:**
  - The `/d/<code>` page, after a `genuine` verdict, receives a short-lived, single-use **possession proof**. It is an HMAC of the code, that counter and an expiry, so it cannot be forged or reused.
  - If the visitor is signed in as the card's owner, the page offers "Activate this card". `owner.card.activate { cardId, proof }` checks the proof and calls `card_transition(→ active)`.
- **Why this way:**
  - A stolen session without the card cannot activate it, and a stolen card without the session cannot either.
  - It needs no text message, so it works before the DLT templates exist (F-10, T-11).
  - It retires the readable activation code (O-3) for AAROH cards.
- **AAROH cards do not expire on activation** (no 14-day `activation_expires_at`). V5 cards keep the live behaviour until DEC-2026-002 decides.
- **A guard (Q3):** an AAROH card (one with a `tap_device_auth` row) becomes `active` only through `card_transition`. A trigger refuses any other writer, including delivery auto-activation (P-3) and the code path (P-2). The frozen admin functions themselves are not edited; the trigger sits under them.

### 3.3 "Report stolen" (T-09)

- `owner.card.retire { cardId, confirm: true }`: the signed-in owner, no second factor, so an owner who has also lost their phone can still act. It does:
  - `card_transition(→ retired)`;
  - sets `tap_device_auth.retired_at`;
  - writes an account history entry and an in-app notice;
  - nothing to the Tap itself.
- **What the stolen card shows (Q4):** **nothing.** `/d/<code>` answers the neutral `unavailable`, as 037 already does for any card that is not active. A thief tapping it never reaches the owner's page.
  - The scope's "needs_service" stays for its other case: an active card whose chip is at its limit or being serviced.
- **Terminal for the owner.** Undoing it is SHYGON support's job after an identity check, and it means a new personalisation (the code is never reused). The owner's path forward is a replacement card.
- **V5 cards (no chip):** retiring records the state, but **`/t/<slug>` keeps opening the Tap** (F3). The page must say so plainly. Owners of V5 cards protect their Tap by switching it to Lost mode or pausing it.

### 3.4 Contract (would become v0.15 or later)

- New `/api/cards` (or `/api/account`) operations:
  - `owner.cards.list`, each card with `verifiedTap: { registered, retired }`;
  - `owner.card.activate { cardId, proof }`;
  - `owner.card.retire { cardId, confirm }`.
- `tap.verify` (§10d) adds `possession` to a `genuine` answer: opaque, 10 minutes, single use.
- §7 C-1 to C-5 are unchanged for V5 cards.

### 3.5 Tests (when built)

- A simulated chip (as in `test:verified-tap`) goes through: issue, genuine tap, activate with proof, then retire; afterwards `/d/` is `unavailable`, the device is retired, and `card_events` holds every move.
- **Refused:**
  - a proof for another card, an expired one, or one used twice;
  - activation without the owner's session, or by another account;
  - an AAROH card made `active` by any other writer (the guard);
  - a retire without `confirm`, or on another owner's card.
- **Unchanged:** V5 card paths (`test:payment-chain`, `test:public-tap`, golden) and the frozen admin outputs (admin-contract).

## 4. Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | States and column (DEC-2026-028 Q1, Q2, for V01) | `cards.status` canonical with doc 08's names; V01 adds `retired` for owners; `card_status` frozen; "lost" stays a Tap mode |
| Q2 | How an AAROH card is activated (T-08) | **Tap to activate:** a genuine Verified Tap plus the owner's own session. *Alternatives:* the verified-phone code (`card-otp`), which needs SMS; or a printed secret stored hashed (doc 08 §5) |
| Q3 | Guard other writers? | **Yes:** an AAROH card becomes active only by tap (a trigger under the frozen functions); V5 cards unchanged |
| Q4 | What a reported-stolen card shows | **Nothing:** the neutral "unavailable", never the owner's page |
| Q5 | F-14: accept the Q5 deviation (the code in `tap_device_auth`)? | **Accept.** This design needs it; if the code had to move onto `cards`, the binding chain and the admin outputs would change |
| Q6 | Expiry for AAROH cards | **None.** V5 cards keep the live 14-day behaviour until DEC-2026-002 |
| Q7 | Who can undo "report stolen"? | **SHYGON support only**, after an identity check, with a new personalisation |

## 5. Not affected

The public `/t/<slug>` resolver and its golden outputs. V5 card activation through `card-otp` (now on a verified phone, T-11). The frozen admin functions' bodies and outputs. Lost mode. Verified Tap's crypto and verdicts, except the new `possession` field on `genuine`.

## 6. What the owner approves

To build locally: "Approve T-08/T-09 local build" (Q1–Q7 as recommended), or the answers that differ. F-14 (Q5) is the founder's own register item, so the coordinator records it there too. Session A then writes:
- migration 041 (`card_transition`, `card_events`, the guard, the `NOT VALID` CHECK);
- the `possession` proof in `/api/verify`;
- the card operations;
- contract v0.15+;
- `test:card-lifecycle`.

It runs the full gates, commits locally and tells Session B. Nothing is applied, pushed or deployed. No physical card exists yet.
