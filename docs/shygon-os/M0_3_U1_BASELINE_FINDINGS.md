# M0.3 U1: Results of running the existing suites on the live baseline

| | |
|---|---|
| Date | 2026-10-02 |
| Unit | U1 (DEC-2026-023 Option A) |
| Status | **U1 complete** (2026-10-02, after the owner decided D-U1-a, D-U1-b and D-U4; §5). Earlier it stopped at the U1 stop rule. The suites now run on the live baseline. **`db:verify` is red until U4**, because of the I-1 production defect: all 15 failures cascade from it. Nothing is weakened to hide it. |
| Delivered | `supabase/tests/lib/live-db.mjs`, `live-auth-shim.sql`; `apply.mjs`, `verify.mjs`, `rls-adversarial.mjs` on the baseline; `history-seed.mjs` (D-U1-a); `supabase/migrations/README.md`; `test:db:history` script and CI step. |
| Method | The suites were copied to scratch and their database prelude was replaced with the builder. Only fixtures that cannot exist on the live table shapes were adapted: `cards.card_id`, NOT NULL `customer_id`, and filling profile names by UPDATE. **No assertion was changed.** A second verify run applied a scratch-only prototype of the DEC-2026-024 fix, to see past the I-1 cascade. The prototype is not committed. |

## 1. Results

| Suite | History chain (today's CI) | Live baseline | Live baseline + scratch I-1 prototype |
|---|---|---|---|
| `rls-adversarial.mjs` | 48 / 48 | **44 pass, 4 fail** | (unchanged) |
| `verify.mjs` | 23 / 23 | **6 pass, 17 fail** | **20 pass, 3 fail** |

## 2. Failure categories

| # | Checks | Cause | Inside M0.3? |
|---|---|---|---|
| R-1 | `rls-adversarial`: "anon cannot read orders / profiles / tap_profiles / notifications" (4) | On live, an anonymous read **errors**: `permission denied for function is_admin`. The `*_select_owner_or_admin` policies apply to every role and call `is_admin()`, which `anon` may not execute. **No data is returned, so nothing leaks.** The test expects 0 rows. Doc 12 M0.4 already covers this ("0 rows, no error is acceptable but error also ok — document") through the `TO authenticated` policy clean-up. | No (M0.4) |
| V-1 | `verify`: 14 checks under "payment & provisioning", "entitlement enforcement", "14-day rule" and "public read path" | **I-1.** Marking the order paid fails with `23503 tap_profiles_customer_id_fkey`, so no Tap exists and the later checks cascade | **Yes** (U4) |
| V-2 | `verify`: "four experiences + the Pass are the active digital SKUs"; "retired SKUs are delisted, not deleted" (2) | The baseline is **schema-only**, so it holds no product rows. These checks test seed **data** that migrations 001–019 inserted, not schema | No |
| V-3 | `verify`: "paying the order provisions a draft Tap" (1) | **Live behaviour differs from the repository's intent.** Live `provision_tap_on_payment` creates the Tap `status='active'`, `published=true` ("Your SHYGON Tap is live"). The repository version, and `fulfilment.mjs`'s safety net, create a draft | No. **Product decision; see §3** |

## 3. New observation O-12: auto-publication on first payment, activated by the approved fix

**What happens (CONFIRMED in isolation, with a scratch prototype of DEC-2026-024 Option A):**
- A first-time buyer's order is marked paid.
- `provision_tap_on_payment` creates a **published** Tap at `/t/<slug from full name>` (for example `priya-example`, from `generate_tap_slug`).
- It carries `display_name` = the account's full name and `email` = the account email, with `enabled_customizations = {phone,email}`.
- An **anonymous** call to `get_public_profile` immediately returns the full name **and the account email**. The customer has taken no action.

**Why it does not happen on production today:** I-1 makes the INSERT fail for every first-time buyer, because live sign-up always creates a random `customers.id`. Live payments are also off. Owner counts on 2026-10-02 showed 0 stuck orders. Customers who already have a Tap are unaffected (`ON CONFLICT DO NOTHING`).

**Why it matters now:**
- DEC-2026-024 Option A, with point 5 confirmed (`provision_tap_on_payment` unchanged), **switches this path on**.
- From then on, every first-time paying customer's name and email become public at a name-derived (guessable, F7) address on payment.
- The repository's intent and the V5 safety net create a draft instead.

**P0 check (doc 13 §5, 18.3):** no occurrence today, so it is latent. Phone and email are V5's always-allowed public fields. But publication without any customer action is a product and privacy decision. This is **not a P0 today**. It must be decided **before U4 is implemented or applied**.

## 4. Decisions needed before U1 can be finished and U4 can start

**D-U1-a: the schema-only seed checks (V-2).** Pick one:
1. **Keep them as history tests.** They run on the existing history chain (tests/baseline.sql + 001–019, isolated PGlite only) as a separate "migration history" job, never against live.
2. **Turn them into a read-only VERIFY ON LIVE query** for a human to run on production.
3. **Seed product rows in the test.** Not advised: the check would then only prove its own fixture.

**D-U1-b: the anonymous-read errors (R-1).** Pick one:
1. **Treat "refused with an error" as "no access"** in those four checks, as doc 12 M0.4 explicitly allows. This is a documented assertion change, not a weakening: data still must not be returned.
2. **Leave them failing until M0.4.** CI is then red on the baseline run.
3. **Pull the M0.4 `TO authenticated` policy clean-up into M0.3.** That is an RLS change outside the approved M0.3 scope.

**D-U4: auto-publication on first payment (O-12, V-3).** Pick one:
1. **Keep live behaviour.** Fix I-1 as approved; first-time buyers' Taps go live with name and email on payment; the verify check is updated to assert live behaviour.
2. **Create the Tap as a draft.** This changes the frozen `provision_tap_on_payment` body (so point 5 is reversed), matches the repository's intent and the V5 safety net, and changes what customers see after paying.
3. Something else you define.

Nothing else in U1 is blocked. When D-U1-a and D-U1-b are answered, U1 completes with the suites rewired.

## 5. Decisions (repository owner, 2026-10-02, in session)

| Decision | Choice | Effect |
|---|---|---|
| **D-U4 (O-12)** | **Create the Tap as an unpublished draft.** | `provision_tap_on_payment` (a frozen function) is changed in U4 so that the Tap provisioned on first payment is a draft: `status='draft'`, `published=false`. That matches the repository's intent and V5's fulfilment safety net. **This reverses scope point 5.** The verify check "paying the order provisions a draft Tap" is kept as written and becomes the regression test. |
| **D-U1-a** | **Keep the two catalogue checks as history tests.** | They move out of `verify.mjs` into a separate migration-history check. That check runs on the old stand-in plus 001–019, in isolated PGlite only, and never against live. |
| **D-U1-b** | **Accept "refused with an error OR 0 rows" as no access** for the four anonymous-read checks. | Either a permission/RLS error or a zero-row result counts as successful denial. **The check fails if any protected row is returned**, and on any other kind of error. The assertion change and its reason (the live baseline legitimately refuses these queries with an error) are documented in the test. **RLS policies are not modified, and the M0.4 policy clean-up is not pulled into M0.3.** The checks stay in `rls-adversarial.mjs`. |

Owner instruction: "Proceed with D-U1-b and continue U1 only." So U1 completes, and work then **stops before U2**.

## 6. U1 result (after the decisions)

| Suite | On the live baseline |
|---|---|
| `db:apply` | live baseline loads; no `020+` migrations yet; **PASS** |
| `rls-adversarial` | **48 / 48.** The four anon checks report "refused (permission denied for function is_admin)" under D-U1-b; entitlements still gets 0 rows. **Negative control:** with a deliberate anon SELECT policy on `orders`, the check fails with `LEAK — 2 row(s)` (scratch run, not committed). |
| `test:db:history` | **2 / 2** (catalogue seed data on 001–019, isolated) |
| `db:verify` | **6 pass, 15 fail. Every failure cascades from I-1** (`23503 tap_profiles_customer_id_fkey` when the order is marked paid). The earlier scratch-prototype run, together with D-U4, indicates all checks pass once U4 lands. |

**Consequence:** `npm run test:db` and `npm run ci` fail on this branch until U4. That is the DEC-2026-023 handling: real findings are reported, not weakened, and a finding fixed inside M0.3 turns green with its fix.
