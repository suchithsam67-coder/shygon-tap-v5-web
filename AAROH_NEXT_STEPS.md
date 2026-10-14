# AAROH next steps

Order follows dependencies, not the generic list. Nothing here authorises deployment, migration, DNS or credential changes: those stay human steps under DEC-2026-018 and DEC-2026-035. Stage 0 comes first because every later check is meaningless on a tree that does not build.

## Stage 0: freeze and decide (blocks everything)
- **Do:** the session editing `v6/aaroh-store` finishes or pauses; commit that work to its branch. Owner answers: which edition set; whether DEC-2026-037 is approved as drafted (V5 + AAROH side by side, ₹999/₹1,499, card checkout gated by `CARD_SALES_ENABLED`).
- **Files:** `docs/governance/decisions/DEC-2026-037_*.md` (new), amend `DEC-2026-036_aaroh-store.md`, `DESIGN.md` or `src/data/aaroh.ts` (whichever loses).
- **Acceptance:** DEC-037 exists with the SHA-256 of `027_aaroh_catalog.sql`; one edition set remains anywhere in the repo.
- **Tests:** `grep -rn "Signature Noir\|Heritage Geometry" src docs DESIGN.md` shows one set.

## Stage 1: critical blockers and release risks (human)
- **Do:** B-1 rotate credentials (`docs/runbooks/RUNBOOK-secrets.md`); B-4 create the repository so CI runs on Node 22; D-7 decide the `9c8caa7` finding; V6-095 run the read-only storage queries on live; DEC-2026-018 review and cool-off for 020–027.
- **Acceptance:** CI green on a remote run; storage policies confirmed; rotation recorded without values.
- **Dependencies:** owner access to Supabase/Netlify/Razorpay.

## Stage 2: foundational bugs (the build and the contract)
- **Do:** complete the `aaroh.ts` refactor so pages use the two-finish model (`images`, `finish`, `AAROH_DESIGNS_ON_SALE`); fix `shygonTapData.ts:395,406,427` copy; update `supabase/tests/aaroh-catalog.mjs` to the approved 027; add the `card_design_of` change to the admin-contract exception list with its DEC; `npm run db:bundle` to refresh `supabase/APPLY_ALL.sql`.
- **Files:** `src/data/aaroh.ts`, `src/pages/NotFound.tsx`, `ShygonTap.tsx`, `shygontap/AarohProduct.tsx`, `Store.tsx`, `ProductDetail.tsx`, `supabase/tests/aaroh-catalog.mjs`, admin-contract test, `supabase/APPLY_ALL.sql`.
- **Acceptance:** `tsc -b`, `build`, `test:aaroh`, `test:db` (all steps), `db:bundle:check` all pass; `dist/` freshly built before bundle/SEO/security checks.
- **Tests:** `npm run ci` locally on a machine that stays awake.

## Stage 3: core customer journey
- **Do:** re-run Playwright E2E (`npm run test:e2e`) including the AAROH journey and `e2e/tap-qr.spec.ts`; verify sign-up → buy digital experience → publish Tap on the rebuilt tree; add a password-reset test or document the Supabase hosted flow (R-21).
- **Acceptance:** E2E all green under the production CSP; axe 0 violations on the AAROH pages (new, never audited).

## Stage 4: public Tap and card lifecycle (precondition for opening card sales)
- **Do:** implement or consciously cut V6-003 (card record + activation code on paid card orders), O-7 (suspension undo), F3, F4; decide loss/expiry/replacement rules (DEC-2026-035 D-5); decide the NFC chip and authentication (R-10); prototype read tests with the border as built (R-11).
- **Acceptance:** a paid AAROH order creates exactly one card and activation path; admin suspension cannot be undone by the owner; read test ≥19/20 on ≥10 phones; no clone-proof claim unless server-verified.
- **Files:** `netlify/lib/fulfilment.mjs`, `card-otp.mjs`, new migration (L3), `Cards.tsx`, `design-assets/manufacturing-handoff.md`.
- **Tests:** extend `payment-chain` and `public-tap`; new lifecycle suite; RLS matrix re-run.

## Stage 5: orders, payments and fulfilment
- **Do:** review the uncommitted `fulfilment.mjs` and `create-order.mjs` diffs line by line; keep `CARD_SALES_ENABLED` unset in every environment until Stage 4 is done; set counted stock (027 inserts stock 0); Razorpay test-mode run on a deploy preview; G-PAY last and separately.
- **Acceptance:** `payment-chain` ≥34 with AAROH cases; test-mode smoke test per `docs/release/DEPLOYMENT.md` §5; live payments still off until G-PAY.

## Stage 6: customer and admin
- **Do:** decide D-8 (admin UI: this repo or the Expo app) and re-audit the Expo app against the current database; D-12 account deletion; V6-038 email channel; D-11, V6-093, V6-096 privacy items.
- **Acceptance:** admin can suspend/restore and refund through a tested surface; `test:admin-edge` and `admin-contract` still pass.

## Stage 7: design-system integration and polish
- **Do:** adopt or drop the lotus emblem (trademark search); build the digital profile palettes paired to each edition (O-A1; no light palette for Ivory); use only the supplied SHYGON logo files.
- **Acceptance:** each edition's card art, store imagery and profile theme agree; owner signs off.

## Stage 8: regression, security and end-to-end
- **Do:** full `npm run ci` on Node 22 in CI; `test:security` against a fresh build; hawkscan/DAST on a deploy preview; storage and RLS re-check; bundle budget (CSS) V6-055.
- **Acceptance:** 0 open P0, P1 closed or owner-accepted, clean install passes.

## Stage 9: release readiness
- **Do:** refresh `docs/v6/readiness-report.md` for the AAROH tree; rollback exercised; owner signs. Order if 027 is applied: deploy frontend that tolerates the rows, then apply 020–027 in the SQL editor (never `db:push`), per DEC-037.
- **Acceptance:** report READY by its own rule (no open P0/P1, every row PASS). Production deploy remains a human decision.
