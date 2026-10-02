# SHYGON OS: Card Lifecycle Decision Summary

| | |
|---|---|
| Date | 2026-10-02 |
| Repository | `feat/m0-governance-ci` @ `008992d` (local only; no remote) |
| Feeds | DEC-2026-028 (vocabulary and canonical column), DEC-2026-002 (14-day expiry), DEC-2026-022 (F3 scope), DEC-2026-024 (I-4 card records), OQ-2b (legacy multi-card gating) |
| Status | **Analysis only. No lifecycle model is chosen. Nothing is changed.** |
| Evidence labels | **OBSERVED** (read in the live baseline `supabase/baseline/000_live_baseline.sql` or in code), **CONFIRMED** (reproduced in isolated PGlite during M0.2), **STATIC** (read from source, not executed), **UNKNOWN / VERIFY ON LIVE** |

Line numbers below refer to `supabase/baseline/000_live_baseline.sql` unless another file is named.

---

## 1. The four sources side by side

| State | 1. Approved doc 08 §4 | 2. Live database | 3. V5 application | 4. M1 proposal (`M1_DOMAIN_MODEL.md` §4.1; DEC-028 advisory, **not approved**) | Owner-brief term |
|---|---|---|---|---|---|
| unassigned | Blank inventory (batch import) | Not a `status` value. The legacy `card_status` default is `inventory` | Not handled | `unassigned` | UNASSIGNED |
| pending | Owner set by order or assignment | `status` default `'pending'`; inserted by `fulfil_order` (unused by code) | `fulfilment.mjs:249` inserts `'pending'` (fails on live, I-4). UI label "Not activated", with an **Activate** button | `pending` (= ISSUED) | ISSUED |
| shipped | Set by fulfilment | Set by `admin_update_order_status` on order `shipped` / `out_for_delivery` | UI label "Not activated", with an **Activate** button | `shipped` | (ISSUED) |
| activated | **A transition** `shipped → active` (owner activation, A3 OTP) | Columns `activated_at`, `activation_count`, `last_activation_at`; no state | Toast "Card activated" | **A transition**, not a state | **ACTIVATED (a state)** |
| active | Resolves to its route | `status='active'` (4 writers, §2) | "Active" (+ "Active until <date>" when an expiry is set) | `active` | ACTIVE |
| suspended | Reversible; owner (A3) or admin | `status='suspended'` (6 writers, §3); also used for **expiry** | "Deactivated" | `suspended` | SUSPENDED |
| lost | Rescue route or unavailable | No value, function or UI | None | `lost` | LOST |
| transfer_pending | Owner keeps control until accepted | None | None | Optional (DEC-028 Q4) | — |
| replaced | Terminal; old device dead immediately | Read by 4 functions; **written only by `admin_update_card`** (manual admin). Legacy CHECK spells it `replacement` | "Replaced"; actions hidden | `replaced` | REPLACED |
| retired | Terminal | Legacy `card_status='retired'` only | None | `retired` | RETIRED |
| expired | Not a state (OQ-1 open) | Implicit: `activation_expires_at` passed → sweeper writes `suspended` | None | Decided by DEC-002 | — |
| inventory / assigned | — | Legacy `card_status` CHECK values only | None | Mapped or frozen (DEC-028 Q2) | — |

**Two state columns exist on live (OBSERVED, lines 3204–3236):**
- `status varchar(32)`, default `pending`, nullable, with **no CHECK** at column level.
- `card_status text NOT NULL`, default `inventory`, with CHECK `inventory, assigned, active, suspended, replacement, retired`.
- Only `request_card_replacement` ever writes `card_status` (line 3154).

---

## 2. All current activation paths (every writer of `status='active'`)

| # | Path | Actor and entry point | Owner step-up | Allowed from (OBSERVED) | Expiry set | Records `activated_at` | Notifications / audit |
|---|---|---|---|---|---|---|---|
| **P-1** | SMS OTP | Owner → `Cards.tsx` → `/api/card-otp` (`card-otp.mjs`) → `card_apply_verified_action(p_user_id, p_card_id, 'activate')` (service_role only, lines 2145–2224) | SMS OTP to `profiles.phone`: **editable and unverified (F4)**. 10-min code, 5 attempts | **Any state except `replaced`**, including `pending` (not yet shipped) and `suspended` | **+14 days** | Yes | Customer + admin notifications (`verified_by: sms_otp`) |
| **P-2** | Printed activation code | Owner → RPC `customer_activate_card(p_card_id, p_activation_code)` (granted to `authenticated`, lines 2362–2378). **No V5 web caller found** (repo-wide search) | Activation code only. The owner can SELECT `activation_code` (O-3), so in practice there is **no step-up** | **Any state except `replaced`** | **+14 days** | Yes | None in the function body |
| **P-3** | Delivery auto-activation | Admin → `admin_update_order_status(p_status='delivered')` (permission `orders.fulfil`, lines 1916–1980). PRODUCTION.md §8 "Blockers", item 5: "activating a card" happens in the Admin APK | **None. No owner action** | `pending`, `shipped` | **None (no expiry)** | **No** | Order-level `admin_audit('order.status_changed')`; no card-level audit |
| **P-4** | Admin manual status | Admin → `admin_update_card(p_status='active')` (permission `orders.fulfil`, lines 1855–1891) | **None** | **Any state** (no transition rules) | **None** | **No** | `admin_audit('card.updated')` |

**Approved doc 08 §5:**
- Activation means the owner signs in and enters or scans an activation secret. The secret is printed on the packaging insert and **stored hashed**.
- The transition is `shipped → active`.
- "Activation via OTP stays but uses **verified** phone."

**Mismatches (OBSERVED):**
- P-3 and P-4 skip the owner entirely.
- P-1 and P-2 allow activation before shipping.
- The live activation code is stored in plain text and is readable by the owner.
- P-1's phone is unverified.

> **Correction to `M1_DECISION_GATE_REPORT.md` C4.** That report counted three activation paths. Including the admin manual path P-4, there are **four writers** of `active`. It also said `admin_update_card` accepts any string. It does not: lines 1864–1866 restrict `p_status` to `pending, shipped, active, suspended, replaced`. The column itself still has no CHECK (O-4 stands at column level). See `HUMAN_DECISION_PACK.md` §2.

---

## 3. All current status writers (`cards.status`)

Nine live functions write `status`, plus one V5 code path.

| # | Writer | Kind / grant | Transition (OBSERVED) | Other columns written | Notes |
|---|---|---|---|---|---|
| W-1 | `fulfil_order()` (lines 2552–2612) | live-only; `service_role`; **not called by any code** | INSERT `pending`, one row per slot, `ON CONFLICT (order_id, sku, card_slot) DO NOTHING` | `is_replacement` (from the item name) | **STATIC:** the insert omits `card_id`, which is `NOT NULL` with no default and no trigger that sets it. The insert would therefore fail with `23502` for card items. Not executed; VERIFY in isolation before relying on it (DEC-024 I-4). |
| W-2 | `fulfilment.mjs:249` `issueCards` (V5, frozen) | service key | UPSERT `pending`, `onConflict 'order_id,sku'` | `is_replacement` | **CONFIRMED to fail on live** (`42P10`, then `23502 card_id`), logged and not thrown (I-4). Paid card orders may therefore have **no card row**. |
| W-3 | `admin_update_order_status` | admin, `orders.fulfil` | `pending → shipped` (order shipped / out_for_delivery); `pending \| shipped → active` (delivered) | — | Requires the order to be paid and to have a tracking number |
| W-4 | `admin_update_card` | admin, `orders.fulfil` | any → `pending \| shipped \| active \| suspended \| replaced` | `card_uid` (write-once) | No transition rules; no `activated_at`; the **only writer of `replaced`** |
| W-5 | `admin_cancel_order` (lines 314–360) | admin, `orders.cancel` | `pending \| shipped → suspended` | — | Refused for delivered orders |
| W-6 | `customer_activate_card` | `authenticated` (owner) | any except `replaced` → `active` | +14 days; `activation_count`; `deactivated_at = NULL` | Code-only (O-3) |
| W-7 | `customer_deactivate_card` | `authenticated` (owner) | `active → suspended` | `deactivated_at` | Code-only, no OTP (O-3) |
| W-8 | `card_apply_verified_action` | `service_role` (via `card-otp`) | activate: any except `replaced` → `active` (+14 days); deactivate: `active → suspended` | as W-6 / W-7 | SMS OTP to an unverified phone (F4) |
| W-9 | `expire_tap_cards()` (lines 2481–2492) | `service_role` | `active` and expired → `suspended` | `deactivated_at` | See §4 for who calls it |
| W-10 | `request_card_replacement` (lines 3145–3159) | `authenticated` (owner) | any except `replaced` → `suspended` | **`card_status='suspended'`**, `deactivated_at`; opens a support ticket; notification | No code or OTP required. **No V5 web caller found.** |

**Readers of state:**
- `Cards.tsx` and `card-otp.mjs` read `status`.
- Admin dashboards count `pending/shipped/active/suspended` (lines 453–456).
- The legacy `get_public_tap` reads `status` and the expiry (§7).
- **The Admin APK** reads and writes through `admin_update_card` and `admin_update_order_status`. The APK contract is still outstanding (DEC-2026-016), so any vocabulary change is an APK contract change.

**Never written by any current path (STATIC):**
- `cards.customer_id`;
- `cards.tap_profile_id`;
- `tap_profiles.card_id`.

So no current code links a card to a persona except through the owner's user id. `get_card_tap_history` joins on `cards.tap_profile_id` (line 2686), so for such cards it returns no rows. VERIFY ON LIVE: count cards with `tap_profile_id` set.

---

## 4. Expiry behaviour

| Aspect | Fact |
|---|---|
| Who sets an expiry | Only P-1 (OTP) and P-2 (code): `activation_expires_at = now() + 14 days` (OBSERVED) |
| Who does not | P-3 (delivery) and P-4 (admin) leave `activation_expires_at` unchanged. A delivered card therefore has **no expiry** unless it was activated earlier (OBSERVED). |
| Renewal | "Renew activation" in `Cards.tsx` re-runs P-1, which **adds** a 14-day expiry to a card that had none (STATIC) |
| Effect of expiry | `expire_tap_cards()` sets `suspended` and `deactivated_at`. EXPIRED is **not a distinct state**, so an expired card is indistinguishable from an owner-deactivated one (OBSERVED) |
| Who runs the sweeper | The only in-database caller is the legacy `get_public_tap` (line 2803). TEST_REPORT.md records that `get_public_tap` errors on live and that nothing calls it. **Whether a cron job runs `expire_tap_cards()` is UNKNOWN**: the dump excludes the `cron` schema (VERIFY ON LIVE). So whether the 14-day expiry takes effect on live at all is **UNKNOWN**. |
| Effect on the public Tap | **None.** `get_public_profile` (the resolver the web app uses) never reads `cards` (F3). An "expired" card still opens `/t/<slug>` (OBSERVED). |
| Customer-facing text | `src/pages/legal/Terms.tsx:99` says a deactivated card's Tap "stops opening until it is reactivated or replaced". The live resolver does not do this (F3). |
| Decision | DEC-2026-002 (OQ-1). Until it is decided, doc 12 §0 rule 11 requires the live behaviour to be preserved. |

---

## 5. Replacement behaviour

| Aspect | doc 08 §5 | Live (OBSERVED) | V5 app |
|---|---|---|---|
| Request | — | `request_card_replacement` **suspends** the card (`status` and `card_status`), opens a support ticket and notifies. It does not set `replaced`. | No UI for it in `src/` |
| New device | Issued without a new edition serial; inherits routes and persona | A replacement is an ordinary order item whose name contains "replacement". `is_replacement` is set from the name, and `cards_assign_edition` skips the edition serial for it | Fulfilment sets `is_replacement` by name |
| Link old ↔ new | Implied (routes inherited) | **None.** There is no column linking the two cards | None |
| Old device | `replaced` immediately (hard stop) | Stays `suspended` until an admin runs `admin_update_card(…,'replaced')`. Until then the owner can re-activate it (§6) | Shows "Replaced" only when an admin has set it |
| Vocabulary | `replaced` | `status='replaced'` (read) vs legacy `card_status='replacement'` (never written) | `replaced` |

---

## 6. Suspension behaviour

- **Six writers produce `suspended`, for six different reasons:** owner deactivation (W-7), OTP deactivation (W-8), expiry (W-9), admin cancel (W-5), replacement request (W-10) and admin manual (W-4). No reason column is stored; only `deactivated_at` is (OBSERVED).
- **The owner can reverse any card suspension.** W-6 and W-8 activate from any state except `replaced`, so an owner can re-activate:
  - a card an admin suspended (cancelled order, or manual);
  - an expired card;
  - a card under a replacement request.

  This is OBSERVED in the function bodies. Recorded as **new observation O-7** in `HUMAN_DECISION_PACK.md` §2, for Security Owner triage.
  - It is the same class as F1 (a customer undoing an admin action), but at device level.
  - Its public effect today is **none**, because card state does not gate `/t/<slug>` (F3).
- **Card suspension is separate from the three account and persona suspension levels** (M1 domain model B7):
  - `customers.account_status`;
  - `profiles.suspended_*`;
  - `tap_profiles.suspended_*`.

  **Only persona suspension gates the public Tap:** `get_public_profile` requires `tap_profiles.status='active' AND suspended_at IS NULL` (lines 2714–2719).

---

## 7. Delivery behaviour

| Order event (admin) | Card effect (OBSERVED, `admin_update_order_status` / `admin_cancel_order`) |
|---|---|
| `placed`, `processing`, `packed` | None |
| `shipped`, `out_for_delivery` | `pending → shipped`. Requires `payment_status='paid'` and a tracking number |
| `delivered` | `pending \| shipped → active`: **auto-activation, no expiry, no owner action** (P-3) |
| Cancel (any non-delivered order) | `pending \| shipped → suspended`. No refund is made by this function |
| Card row missing (I-4) | None of the above can affect a card that was never created |

doc 08 has no delivery-triggered activation. Activation is owner-initiated (`shipped → active`, A3).

---

## 8. Owner step-up requirements

| Action | doc 08 requirement | Live (OBSERVED) | Gap |
|---|---|---|---|
| Activate | Signed-in owner, hashed activation secret, A3 OTP on a **verified** phone | P-1: OTP to an unverified phone (F4) · P-2: plain-text code the owner can read (O-3) · P-3 and P-4: none | F4, O-3; DEC-022 decides whether F4 is in M0.3 |
| Suspend / deactivate | Owner (A3) or admin; admin reason mandatory | W-7 code-only; W-8 OTP; admin W-4 and W-5 (cancel requires a reason; `admin_update_card` does not) | O-3 |
| Resume | Owner A3 | Same as activate (any non-replaced state) | O-7 |
| Lost | Owner A3 | Not implemented | — |
| Transfer | Token + recipient A3 | Not implemented | — |
| Replacement request | — | Session only; no code or OTP | — |

---

## 9. `/t/:slug` implications (legacy, persona-addressed)

1. **Card state does not affect `/t/<slug>` today (F3, OBSERVED).** Every lifecycle state is cosmetic for the public Tap.
2. **The output is frozen.** Doc 12 §0 rule 4 requires `/t/<slug>` to be byte-compatible (same JSON from `get_public_profile`), enforced by a golden test.
3. **One URL serves every card a user owns.** Doc 01 §3 C2: all of a user's chips print the same `/t/<slug>`, and that URL "must never change". Blocking the slug for one lost card would also disable the user's other cards and shared QR links (DEC-022, Position A risk).
4. **doc 08 §6 offers persona-level gating for legacy cards (OQ-2b):** "if the owner has exactly one active legacy device, its state gates `/t/<slug>`; with multiple, the persona stays reachable while any legacy device is active." Not decided.
5. **The legacy `get_public_tap` does card-gate**, hiding a Tap whose cards are all inactive or expired (lines 2804–2810). But it errors on live (TEST_REPORT.md), it is unused, and O-2 warns that "fixing" it could expose contact fields.
6. **Choosing any lifecycle that should stop taps on printed cards requires one of:**
   - amending rule 4 (DEC-022 question 2);
   - adopting persona-level gating (OQ-2b);
   - accepting that lifecycle is enforced only on `/d/` devices (§10).

   This is physical-card-visible, so doc 13 §3.3 treats it as irreversible.
7. **The published Terms statement (§4) and actual behaviour disagree.** The decision should state which one is corrected. That is a Product Owner / legal matter, not a code matter.

---

## 10. Future `/d/:code` implications (device-addressed; doc 08 §2, §4; not built)

| Topic | Implication |
|---|---|
| Per-state resolution | doc 08 table: `unassigned`/`pending`/`shipped` → activation landing; `active` → route; `suspended` → neutral unavailable; `lost` → rescue or unavailable; `replaced`/`retired` → unavailable. It **needs a canonical vocabulary (DEC-028) before any resolver exists** |
| Expiry | If expiry maps to "unavailable" (DEC-002), every P-1/P-2 card stops resolving 14 days after activation, while P-3/P-4 cards never do. The population is mixed today (§4) |
| Delivery auto-activation | Under `/d/`, P-3 would make a device resolve without any owner step-up, contrary to doc 08 §5 |
| Owner re-activation (O-7) | Becomes security-relevant once state gates resolution: an owner could undo an admin or expiry suspension |
| `replaced` | Needs a real writer (today only manual admin) for the "old device dead" rule |
| Backfill | `public_code` is backfilled onto existing `cards` rows (doc 08 §6). Paid orders hit by I-4 have **no card row** to backfill |
| Legacy cards | Chips already printed carry `/t/<slug>`, not `/d/<code>`. Device-level lifecycle reaches them only via OQ-2b |
| Persona linkage | `cards.tap_profile_id` is never written today (§3). Routing needs `tap_routes` (M1 plan §20) or a backfill |
| Chip family | `auth_mode='sdm'` waits for OQ-2 (DEC-2026-015); `static` only until then (doc 12 §2A) |

---

## 11. What must be decided (no answer given here)

| Question | Record | Options in the record |
|---|---|---|
| State vocabulary (doc 08 vs brief literal) | DEC-2026-028 Q1 | doc 08 set · brief terms stored literally |
| Legacy `card_status`: frozen or mapped | DEC-2026-028 Q2 | frozen · one-way mapped by trigger |
| EXPIRED: distinct, reuse `suspended`, or no expiry | DEC-2026-028 Q3 + DEC-2026-002 | 002: A never expires · B 14-day window with renewal · C expiry as a plan feature |
| `transfer_pending` in M1 or later | DEC-2026-028 Q4 | M1 · later |
| Is F3 fixed in M0.3, and what does `/t/<slug>` return when one of several cards is inactive? | DEC-2026-022 Q2 | Position A · Position B · owner-defined combination |
| Legacy multi-card gating | OQ-2b (doc 08 §6) | rule as written · not adopted |
| Card-record creation (I-4): slot model and `card_id` generator, or adopt live `fulfil_order()` | DEC-2026-024 | both directions need `card_id` handling (STATIC finding W-1) |
| Delivery auto-activation (P-3) and admin manual activation (P-4): keep, change, or record expiry | **Not covered by any record yet**; it falls under DEC-028 / DEC-002 scope | — (the Product Owner may need to extend DEC-028) |

**VERIFY ON LIVE (human, read-only), useful before DEC-028/002:**
- distinct `cards.status` values with counts;
- cards with `activation_expires_at` set vs NULL among `active` cards;
- whether `expire_tap_cards()` is scheduled (`cron.job`);
- cards with `tap_profile_id` set;
- paid card orders with no card row (I-4 exposure).
