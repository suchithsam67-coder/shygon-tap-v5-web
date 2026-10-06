# SHYGON V6 backlog (living)

Source: `stage-1-audit.md` §8 (evidence and file:line references are there), re-prioritized by the owner's decisions of 2026-10-05 (DEC-2026-035):
- D-2: the software platform; physical cards out;
- N-1: migrations 022+;
- D-6: Taps only after payment;
- cards deferred and not sold in the RC;
- privacy hardening.

Priority: P0 release blocker · P1 must complete · P2 should complete · P3 defer.

## In V6

| ID | Area | Item | Priority | Stage | Status |
|---|---|---|---|---|---|
| B-1 | Release | Credential rotation: waiver extended (D-1); rotation stays a release requirement; procedure in `docs/runbooks/RUNBOOK-secrets.md` | P0 (release) | Owner, Stage 6 gate | waiver recorded; rotation open |
| B-2 | Release | 020 + 021 (and V6 022+) applied to production after the cool-off and checklist | P0 (release) | Owner, Stage 6 gate | open |
| B-3 | Release | Live payments (G-PAY) | P0 (go-live) | Owner | open |
| B-4 | Release | Create the GitHub repository and push; CI never ran | P1 | Owner | open |
| B-5 | Testing | E2E environment (D-4) | P1 | Decide before Stage 3; Stage 5 | **done (D-4 = no-Docker local stack, 2026-10-06):** `supabase/local/` + Playwright on the installed Edge; the three journeys pass 6/6 (Stage 3) |
| V6-010 | Security | F2: customers read `orders.admin_note`, so move notes to an admin-only table | P1 | 2 | **done locally**: migration 022; `admin-notes.mjs` 12/12 |
| V6-012 | Authorization | O-14: Taps only after payment (D-6) | P1 | 2 | **done locally**: migration 023; RLS matrix (negative control: 2 P0s without 023) |
| V6-030 | RLS | F6: owner-or-admin read policies to `authenticated` only; O-1: revoke `anon` EXECUTE on admin helpers (`admin_has` also from PUBLIC) | P2 | 2 | **done locally**: migration 024; strict anon checks (10 fail without 024) |
| V6-077 | RLS | Full RLS matrix (A→A, A→B, anon, customer→admin, viewer→admin, admin→customer, service) with an explicit expectation table; any unexpected access fails | P1 | 2 | **done**: `rls-matrix.mjs`, 31 tables × 7 callers |
| V6-079 | Migrations | Every migration's rollback exercised on a local database (readiness criterion) | P1 | 2 | **done**: `migration-rollbacks.mjs` (020–024 and the full chain) |
| V6-078 | Authorization | O-15: owner-or-admin policies admit any admin through `is_admin()`, bypassing `admin_has(permission)` (least privilege) | P2 | 4 (decision) | new |
| V6-040 | Migrations | `db:bundle` / `APPLY_ALL.sql` bundles only 020+ (never the 001–019 history) | P2 | 2 | **done**: regenerated (020–024 only); `db:bundle:check` in CI |
| V6-076 | SHYGON ID | Show the account owner their SHYGON ID in the dashboard (read-only, server-resolved) | P2 | 4 | **needs D-9**: what the customer-facing SHYGON ID is (today only the internal `CUST-…` code exists; customers never see it) |
| V6-070 | Payments | Physical card products are not purchasable in the RC (card decision; D-10 digital-first) | P1 | 3 | **done locally:** `create-order` refuses card orders (409) unless `CARD_SALES_ENABLED`; store, product, landing, cart, checkout and dashboard show "coming soon" and offer the digital Tap; card offers removed from the structured data. `payment-chain` + E2E |
| V6-017 / V6-084 | Testing | `fulfilOrder` tested against a database (claim, retry, entitlements, safety net) | P1 | 3 | **done:** `netlify/tests/payment-chain.mjs` 27/27, the real handlers on the local stack |
| V6-031 | Security | Order-id suffix uses `crypto.randomInt` (moved from Stage 2: payment code) | P2 | 3 | **done** (`create-order.mjs`) |
| V6-071 | Privacy | Server-enforced per-field public/private visibility on the public Tap, golden-tested | P1 | 3 | **done locally:** migration 025 (owner can hide phone/email; the legacy `get_public_tap`, which leaked a hidden address to anon, is revoked = O-2); editor "Show on Tap" switches, saveable even while the edit window is closed. Golden output unchanged. Open: **D-11** (login email pre-filled into the public Tap) |
| V6-073 | Privacy | Salted visitor hash in `record_tap_event` (privacy part of V6-032) | P1 | 3 | **done locally:** migration 025, daily random salt, deleted after two days |
| V6-032 | Analytics | `record_tap_event` rate limit / dedupe | P2 | 3 | **done locally:** migration 025, 10-second dedupe + 60 events per visitor per Tap per hour |
| V6-033 | Tap | Per-Tap link previews (`/t/` meta is client-side) | P2 | 3 | **deferred:** needs a server function on the `/t/` path, which puts a cold start before the first byte of the one page that must be instant. Decide with V6-043 (one host, edge runtime) |
| V6-083 | Testing | Frontend test runner + public Tap state component tests | P1 | 3 | **done:** Vitest + Testing Library, `src/pages/PublicTap.test.tsx` 14/14 |
| V6-086 | Payments | **Bug, found by the payment-chain suite:** `create-order.mjs` used `normaliseExperienceKey` without importing it, so any customer who already owned an experience got a 500 buying another. Present since the V5 import (`8becea3`), so expected on production | P1 | 3 | **fixed** (imported from `fulfilment.mjs`); covered by `payment-chain` |
| V6-087 | Customer | **Dead end for new customers (D-10):** the Tiers page refused any purchase without a Tap ("Purchase a SHYGON Tap first"), while a Tap only exists after payment and cards are not sold | P1 | 3 | **fixed:** the first purchase creates the draft Tap; no-Tap dashboard, editor, customizer and analytics invite the purchase instead of showing an error. E2E journey (a) |
| V6-088 | Admin | O-16: reactivating a customer account also lifts a separate moderation of their Tap | P2 | 4 (decision) | new |
| V6-089 | Copy | Copy still card-first after D-10: sign-in page ("Buy a card once"), landing FAQ and delivery claims | P2 | 4 | new |
| V6-080 | SEO | "Not purchasable" product mode | P1 | 3 | **done in V6** (`productMeta`/`storeMeta`/`homeMeta`/`llms.txt` take the card-sales switch). Merging the C5 SEO gate (`93ae352`) is not done |
| V6-018 | Observability | Structured logs, request id, `/api/health`, error tracking hook, React error boundary (doc 12 M0.6) | P1 | 4 | open |
| V6-075 | Auditability | Security/audit events: admin actions are audited today; add payment/webhook and account security events where the server sees them | P1 | 4 | new |
| V6-072 | Privacy | Account data export and deletion flow (was V6-037, now P1) | P1 | 4 (DB part in 2 if needed) | new |
| V6-042 | Admin | Admin foundation = the DB/edge layer plus auditability; no new admin UI (interim reading of D-8) | P2 | 4 | open (D-8) |
| V6-038 | Notifications | Email channel (provider decision, DEC-2026-031) | P2 | 4 | open |
| V6-051 | Admin | Contract test that the edge role map equals `admin_role_permissions()` | P3 | 4 | open |
| V6-014 | Release | Secret-scan gate on `9c8caa7` (D-7) | P1 | 5 | open (D-7) |
| V6-044 | Admin | Edge-function CORS `*` | P3 | 5 | open |
| V6-036 | Auth | Password policy and email confirmation are Supabase project settings: production configuration doc; align the client minimum to it | P2 | 6 (ask) | open |
| V6-039 | Accessibility | Automated a11y checks, skip link | P2 | 6 | open |
| V6-074 | Privacy | Privacy docs updated to the V6 behaviour | P2 | 6 | new |
| V6-041 | Dev env | Node 22 locally | P2 | Owner | open |
| V6-043 | Hosting | One deploy target | P2 | 6 | open |
| V6-052 / 053 / 054 / 055 | Debt | Dead compiled assets, stale root reports, esbuild advisory, unbudgeted CSS | P3 | 6 | open |

## Deferred to the card release (D-2, card decision)
V6-003 (I-4 card records), V6-011 (O-7 owner undoes card suspension), V6-019 (I-5 pgcrypto), V6-034 (F3 card state vs Tap), V6-035 (F4 + O-3 card OTP).

## Deferred / cut / closed
- **Defer:** V6-050 (O-13 at sign-up; it can become a one-line SHYGON ID fix if `handle_new_user` changes are authorized), V6-056, V6-057.
- **Cut:** V6-058 (trusted/organization privacy tiers; wait for DEC-2026-025), V6-059 (subscriptions).
- **Closed, no work:** V6-060 (entitlements are already one backend-authoritative lookup).
