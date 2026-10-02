# SHYGON OS: Identity Decision Summary

| | |
|---|---|
| Date | 2026-10-02 |
| Repository | `feat/m0-governance-ci` @ `008992d` (local only; no remote) |
| Feeds | DEC-2026-029 (identity key contract), DEC-2026-024 (live `customer_id` defect, P1) |
| Status | **Analysis only. No key is chosen. No schema, RLS, auth or code change. No rename.** |
| Evidence labels | **OBSERVED** (live baseline or code), **CONFIRMED** (reproduced in isolated PGlite, M0.2), **STATIC** (read, not executed), **VERIFY ON LIVE** |
| Shorthand | **U** = `auth.users.id` · **C** = `customers.id` · **P** = `tap_profiles.id` (persona) · **D** = `cards.id` (device) |

---

## 1. The current situation (OBSERVED, live baseline)

```text
auth.users.id  (U)                      Supabase Auth. Not in the dump (auth schema excluded)
   │
   ├── customers.user_id = U            UNIQUE, NOT NULL, FK auth.users ON DELETE CASCADE
   │      customers.id = C              random gen_random_uuid(), created by live handle_new_user()
   │      customers.customer_id         text 'CUST-' + first 10 hex digits of U (derived from U)
   │      RLS: customers_api_none        no client can read or write customers
   │
   ├── profiles.id = U                  PK; no FK to auth.users on live
   │      profiles.customer_id = C      NOT NULL, UNIQUE, FK customers ON DELETE CASCADE
   │
   ├── tap_profiles.user_id = U         NULLABLE, no FK on live, unique index (idx_tap_profiles_user)
   │      tap_profiles.customer_id = C  NOT NULL, UNIQUE (one persona per customer), FK customers CASCADE
   │      tap_profiles.card_id          legacy uuid, no FK, never written by current code
   │
   ├── cards.user_id = U                nullable, no FK on live: the effective owner key
   │      cards.customer_id = C         nullable, FK customers ON DELETE SET NULL; never written today
   │      cards.tap_profile_id = P      nullable, FK tap_profiles SET NULL; never written today
   │      cards.card_id                 legacy text code, NOT NULL, UNIQUE
   │
   ├── orders.user_id = U               NOT NULL, FK auth.users CASCADE
   │      orders.customer_id = U (!)    nullable, FK auth.users ON DELETE SET NULL. Named "customer", holds U
   │      payments.order_id → orders.id payments carry no user or customer column
   │
   └── entitlements.user_id = U         NOT NULL, FK auth.users CASCADE; source_order_id → orders
```

**Authorization (OBSERVED):**
- 18 owner policies key on `user_id = auth.uid()`, and 3 on `profiles.id = auth.uid()`.
- **0 policies key on `customer_id`.** C plays no part in authorization today.

---

## 2. Relationship register

Each block gives:
- **CURRENT KEY:** what the live schema stores and enforces.
- **INTENDED KEY:** what each source assumes. Where the sources disagree, the block says **CONFLICT**.
- **CURRENT USAGE:** who reads or writes the relationship.
- **RISK.**
- **FUTURE CONTRACT:** what each DEC-2026-029 option would make binding. **None is approved.**

DEC-2026-029 options, as written in the record:
- **A:** rules B1–B7. Authorize by U; resolve C server-side and never accept it from a client; new person-owned tables carry U; `orders.customer_id` is legacy and never joined to `customers`.
- **B:** U is the only key for new work. Legacy C columns stay and must still be filled correctly.
- **C:** C becomes the authorization key. Every RLS policy changes; the record does not recommend it.

How the legacy C columns get filled is DEC-2026-024's question (A: database-side resolution, B: code-side lookup, C: make C = U, D: relax FKs).

### R-1 `auth.users.id` → `customers` (U → C mapping)
| | |
|---|---|
| CURRENT KEY | `customers.user_id = U` (UNIQUE, NOT NULL, FK). `customers.id = C` is random. |
| INTENDED KEY | Live: C is a separate commercial key. V5 code: no knowledge of `customers` (the table is live-only; drift report §4). **CONFLICT.** |
| CURRENT USAGE | Written only by live `handle_new_user()`, which inserts `customers`, then `profiles(id=U, customer_id=C)` (lines 2867–2908). Read by `admin_dashboard`, `admin_get_customer`, `admin_list_customers`, `admin_set_customer_suspension`. Never read by clients (`customers_api_none`). |
| RISK | The trigger that runs `handle_new_user` on `auth.users` is outside the dump (**VERIFY ON LIVE**). Every sign-up creates C ≠ U, which is the root of DEC-024. Owner-run count (2026-10-02): **6 customers** with C ≠ U and no Tap profile. |
| FUTURE CONTRACT | A: the U→C lookup happens only server-side (`customer_id_for(U)` or an equivalent helper). B: same lookup, used only to fill legacy columns. C: C becomes the key that RLS uses. Any adapter waits for DEC-029 + DEC-023. |

### R-2 `auth.users.id` → `profiles.id` (profile ownership)
| | |
|---|---|
| CURRENT KEY | `profiles.id = U` (PK). Live has no FK to `auth.users` (repo-only constraint, drift report §4). |
| INTENDED KEY | U in every source. |
| CURRENT USAGE | RLS `profiles_*_own` on `id = auth.uid()`; `account.tsx` reads `.eq('id', user.id)`; `card-otp.mjs` reads `profiles.phone` by U; `provision_tap_on_payment` reads name and email by U. |
| RISK | Low for keying. The phone in this row is the OTP target, and it is user-editable (F4). |
| FUTURE CONTRACT | Unchanged under A and B (B1). Under C, the policies would need rewriting. |

### R-3 `customers.id` → `profiles.customer_id`
| | |
|---|---|
| CURRENT KEY | C. NOT NULL, UNIQUE, FK `customers` CASCADE. |
| INTENDED KEY | Live: C. V5 code (`Settings.tsx:89`, `Checkout.tsx:333`): **U**. Repo schema: nullable, no FK. **CONFLICT.** |
| CURRENT USAGE | Set correctly at sign-up by `handle_new_user`. Overwritten with U by V5 profile saves. Typed nullable in `database.types.ts:167` (stale; live is NOT NULL). |
| RISK | **CONFIRMED (I-2):** a profile save by a live user fails with `23503 profiles_customer_id_fkey`. |
| FUTURE CONTRACT | A: clients never send C; the server normalises it (DEC-024 A trigger, or B lookup). B: the same, filled for legacy only. C: C becomes client-visible and authorizing. |

### R-4 `customers.id` → `tap_profiles.customer_id` (persona's commercial owner)
| | |
|---|---|
| CURRENT KEY | C. NOT NULL, **UNIQUE** (one persona per customer), FK `customers` CASCADE. |
| INTENDED KEY | Live: C. Live trigger `provision_tap_on_payment` and V5 `fulfilment.mjs:334`: **U**. **CONFLICT inside live itself.** |
| CURRENT USAGE | Written on first payment by the trigger (line 3022: `customer_id = NEW.user_id`) and by the fulfilment safety net. |
| RISK | **CONFIRMED (I-1, P1):** a first-time buyer's fulfilment claim fails with `23503`, after Razorpay has captured payment. Owner counts: 0 occurrences, 6 exposed, FK not deferrable. **Live payments must stay OFF** (DEC-024). |
| FUTURE CONTRACT | Fix direction is DEC-024 (A/B/C/D). DEC-029 sets the rule that new code follows. |

### R-5 `auth.users.id` → `tap_profiles.user_id` (persona ownership)
| | |
|---|---|
| CURRENT KEY | U. **Nullable**, no FK on live, unique index. |
| INTENDED KEY | U in every source (V5 code, live functions, RLS). |
| CURRENT USAGE | RLS `tap_profiles_select_owner_or_admin`, `_insert_own`, `_update_own` on `user_id = auth.uid()`. The resolver `get_public_profile` looks up tier, Pass and add-ons by `v_tap.user_id` (lines 2722–2727). Analytics RPCs join through it. The trigger and fulfilment use `ON CONFLICT (user_id)`. |
| RISK | A row with `user_id IS NULL` is invisible to its owner under RLS. Its public page finds no entitlements, so it renders with the no-entitlement result (STATIC). Whether such rows exist is **VERIFY ON LIVE** (a human read-only count). |
| FUTURE CONTRACT | A and B: `user_id` is the authorizing persona key. Whether to add NOT NULL or an FK is a separate migration decision (DEC-023 origin; L3). |

### R-6 Card ownership: `auth.users.id` → `cards.user_id`
| | |
|---|---|
| CURRENT KEY | U. Nullable, **no FK on live**. |
| INTENDED KEY | U (V5 code, live functions, RLS). doc 08 §5 adds `owner_org_id` and `assigned_to_user_id` in Phase 2. |
| CURRENT USAGE | Both fulfilment paths set it from `orders.user_id`. RLS `cards_select_owner_or_admin`. All customer card RPCs (`customer_activate_card`, `customer_deactivate_card`, `request_card_replacement`, `set_card_nickname`, `get_card_tap_history`) and `card_apply_verified_action` key on it. |
| RISK | Cards are never created for paid card orders on live (I-4, CONFIRMED). The legacy `get_public_tap` matches cards by `user_id` **or** `tap_profile_id`. |
| FUTURE CONTRACT | A and B: U owns the device (B5: a device is not an identity). Organisation ownership waits for DEC-2026-025. |

### R-7 `customers.id` → `cards.customer_id`
| | |
|---|---|
| CURRENT KEY | C. Nullable, FK `customers` ON DELETE SET NULL. |
| INTENDED KEY | Live legacy layer: C. V5: unused. |
| CURRENT USAGE | **No current writer** (STATIC: neither fulfilment path sets it). |
| RISK | Low today. Any new code that writes it from client input would repeat the U-into-C bug. |
| FUTURE CONTRACT | A: filled only server-side, if at all (B3). B: legacy; filled correctly or left NULL. |

### R-8 Persona ↔ card linkage: `cards.tap_profile_id` (P) and `tap_profiles.card_id` (legacy)
| | |
|---|---|
| CURRENT KEY | `cards.tap_profile_id` → `tap_profiles` (FK SET NULL). `tap_profiles.card_id` (uuid, no FK). |
| INTENDED KEY | Legacy single-card link. doc 08 / M1 plan §20: a `tap_routes` table becomes the routing source (not built). |
| CURRENT USAGE | **Never written by current code** (STATIC). `get_card_tap_history` joins on `tap_profile_id`; the legacy `get_public_tap` reads it. |
| RISK | The per-card tap history returns nothing for cards without the link (STATIC; VERIFY ON LIVE how many rows have it set). |
| FUTURE CONTRACT | Decided with routing (M1.5 in the proposed plan; DEC-028, OQ-2b, DEC-022). |

### R-9 Order ownership: `auth.users.id` → `orders.user_id`
| | |
|---|---|
| CURRENT KEY | U. NOT NULL, FK `auth.users` CASCADE. |
| INTENDED KEY | U everywhere. |
| CURRENT USAGE | RLS `orders_select_owner_or_admin`. `create-order.mjs` sets it server-side. Fulfilment, entitlements, the trigger and `admin_get_order` all use it. |
| RISK | None found. |
| FUTURE CONTRACT | Unchanged under A and B (B4: new code reads `orders.user_id`). |

### R-10 `orders.customer_id` (the naming hazard)
| | |
|---|---|
| CURRENT KEY | **U.** FK → `auth.users` ON DELETE SET NULL. Not C, despite the name. |
| INTENDED KEY | Live FK: U. `create-order.mjs:156` writes U, which is **correct on live**. The column name suggests C. **CONFLICT (naming only).** |
| CURRENT USAGE | Written once at order creation. `admin_get_order` strips it from its output and joins profiles by `orders.user_id`. |
| RISK | A future join `orders.customer_id = customers.id` would silently match nothing. Writing C into it would violate the FK. |
| FUTURE CONTRACT | A: documented legacy; never joined to `customers` (B4); new code uses `user_id`. B: the same. C: would need a data change. **No rename either way** (doc 12 §0 rule 3). |

### R-11 Payment relationships
| | |
|---|---|
| CURRENT KEY | `payments.order_id` → `orders.id` (FK CASCADE). Razorpay ids on `orders` and `payments`. **No user or customer key on `payments`.** |
| INTENDED KEY | Identity is reached only through the order (U via `orders.user_id`). |
| CURRENT USAGE | `fulfilment.mjs` records the payment, then claims the order. Live `fulfil_order` (unused) cross-checks payment and order amounts. `enforce_server_only_payment_status` blocks client changes to the payment fields. |
| RISK | **The money path is U-consistent. The failure is downstream:** claiming the order fires `provision_tap_on_payment` (R-4). |
| FUTURE CONTRACT | Frozen (doc 12 §2). The M1 plan proposes only the `PaymentProvider` interface, fixtures and a read-only reconciliation script. Any identity change here goes through DEC-024 (L3). |

### R-12 Payment → entitlement: `entitlements.user_id` (U), `source_order_id`
| | |
|---|---|
| CURRENT KEY | U. NOT NULL, FK; `UNIQUE(user_id, type, key)`. |
| INTENDED KEY | U everywhere. |
| CURRENT USAGE | Granted by fulfilment from `orders.user_id`. Read by the resolver (tier, Pass, add-ons) through `tap_profiles.user_id` (R-5), and by edit rules. |
| RISK | Correct keying. The resolver depends on R-5 being non-NULL. |
| FUTURE CONTRACT | Unchanged under A and B. |

### R-13 Fulfilment relationships (order → persona, card, entitlement)
| | |
|---|---|
| CURRENT KEY | Everything starts from `orders.user_id` (U). |
| INTENDED KEY | U for the user id; **C required** for `tap_profiles.customer_id` (live FK). |
| CURRENT USAGE | (1) `fulfilment.mjs:93` claim UPDATE → trigger `trg_orders_provision_tap` → INSERT `tap_profiles(user_id=U, customer_id=U)`. (2) `issueCards` upsert of `cards(user_id=U)`. (3) Entitlements by U. (4) Safety net `tap_profiles(customer_id=U)`. |
| RISK | (1) **CONFIRMED** failure after capture (I-1, P1). (2) **CONFIRMED** failure, logged and not thrown (I-4). (4) **CONFIRMED** failure, logged (I-3). Live `fulfil_order()` (unused) also omits the NOT NULL `cards.card_id` (STATIC). |
| FUTURE CONTRACT | DEC-024 decides the fix. DEC-028 + DEC-002 decide the card-record model for I-4. |

### R-14 Public resolver: slug → persona → owner
| | |
|---|---|
| CURRENT KEY | `lower(tap_profiles.slug)` → row → `user_id` (U) → entitlements. |
| INTENDED KEY | Persona-addressed (`/t/<slug>`), frozen (doc 12 §0 rule 4). |
| CURRENT USAGE | `get_public_profile` (anon) and `get_public_tap_state` (anon). **No card or customer key is consulted** (F3). |
| RISK | NULL `user_id` (R-5); card state ignored (F3). |
| FUTURE CONTRACT | `/t/` stays frozen. The device-addressed `/d/<code>` would resolve device → route → persona (proposal; DEC-028, OQ-2b). |

### R-15 Card OTP: `card_otp_challenges(user_id U, card_id D)`
| | |
|---|---|
| CURRENT KEY | U (FK `auth.users`) and D (FK `cards`). |
| INTENDED KEY | U and D. |
| CURRENT USAGE | `card-otp.mjs` creates a challenge for `cards.user_id = U`, sends the SMS to `profiles.phone` (by U), then calls `card_apply_verified_action(U, D, action)`. |
| RISK | The trust factor is an unverified phone (F4). The same action is also reachable without an OTP (O-3). |
| FUTURE CONTRACT | Verified contacts and step-up (doc 12 M1.3 / proposed M1.2), subject to DEC-022. |

---

## 3. Where the conflicts are (summary)

| # | Conflict | Relationship | Decision |
|---|---|---|---|
| X-1 | V5 code writes U into C columns | R-3, R-4, R-13 | DEC-024 (fix), DEC-029 (rule) |
| X-2 | A live trigger writes U into a C column | R-4 | DEC-024 |
| X-3 | `orders.customer_id` holds U | R-10 | DEC-029 (documentation contract only; no rename) |
| X-4 | `tap_profiles.user_id` nullable but authorizing | R-5, R-14 | DEC-029; VERIFY ON LIVE count |
| X-5 | Persona ↔ card link never written | R-8 | DEC-028 / routing |
| X-6 | TypeScript types stale vs live | R-3, R-4 | after DEC-023 (regenerate from the baseline) |

## 4. Not changed by this document
- Nothing is renamed.
- No column, constraint, policy, trigger, function or code path is changed.
- No adapter is built.
- The adapter candidates listed in `M1_DECISION_GATE_REPORT.md` §2.4 remain proposals.
