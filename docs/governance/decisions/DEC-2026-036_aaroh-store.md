# DEC-2026-036: the SHYGON store sells one product, SHYGON Version 1 — AAROH

| Field | Value |
|---|---|
| Domain / Level | Product + Data / **L3** (migration 027 is under `supabase/migrations/**`). Hosting redirects in `netlify.toml` / `vercel.json` are L2 |
| **Accountable Owner** | Repository owner (one-person model, DEC-2026-018) |
| State | **APPROVED in session, 2026-10-11** (Q1, Q3, Q4). **Amendment A-1, same day:** Q2 superseded; the new designs are in `DESIGN.md`. **Amendment A-2, 2026-10-12:** round-2 designs (portrait, a proposed AAROH lotus emblem, material renders). **IMPLEMENTED LOCALLY** on branch `v6/aaroh-store` (from the V6 RC, `6d00f2f`). Migration 027 is **NOT APPLIED** anywhere |
| Evidence | `supabase/tests/aaroh-catalog.mjs` (`npm run test:aaroh`), `e2e/journeys.spec.ts` (AAROH journey), `DESIGN.md`, the session report |
| Related | DEC-2026-035 (D-2, D-5 "cards", D-10: no physical card sales in the V6 RC), DEC-2026-018 (L3 cool-off and checklist), DEC-2026-023 (live baseline; 020+ only), DEC-2026-034 (commerce, follows V6) |

## Question
Three briefs (2026-10-11) turn the store into one product. Together they ask for:
- **SHYGON Version 1 — AAROH**: a physical NFC card with a QR fallback, linked to the SHYGON digital profile.
- **Three designs:** Signature Noir, Ivory Atelier and Midnight Titanium. They are variations of the one card, not separate products.
- **Use cases, not categories:** business, student, event and hotel are uses of the card.
- **A product page that explains everything before purchase:** what the card and the software do, who sees what, what is included, and an FAQ. Only verified capabilities are shown as available.

## Owner answers (2026-10-11, in session)

| # | Question | Answer | Recorded effect |
|---|---|---|---|
| Q1 | Sales | **Build AAROH, keep sales gated** | Card sales stay closed (`CARD_SALES`: UI `VITE_CARD_SALES_ENABLED`, server `CARD_SALES_ENABLED`). DEC-2026-035 D-2 and D-5 stand |
| Q2 | Editions | ~~Map existing designs~~ **Superseded by A-1** | — |
| Q3 | What a design changes | **Visual only** | Designs differ in surface only. Platform, chip, QR, prices of digital experiences and entitlements are the same for all |
| Q4 | Database | **Local only + exact SQL** | Migration 027 is tested locally. The exact production SQL is the migration file. Nothing touches live |

## Amendment A-1 (2026-10-11, in session)
The owner rejected the first implementation, which mapped AAROH onto four existing designs (Rose Marble, Obsidian Smoke, Sapphire Night, Aurora Glass): "these designs are not good, delete these designs and plan more beautiful designs". The owner then supplied the physical design brief.

**Recorded effect**
- **New designs.** AAROH has three new designs, specified in `DESIGN.md` and drawn in `design-assets/`:
  - 01 Signature Noir;
  - 02 Ivory Atelier;
  - 03 Midnight Titanium.

  They are concepts, PROPOSED — REQUIRES VALIDATION with a card manufacturer.
- **No catalogue rows yet.** Adding SKUs and prices needs the owner's approval, so the store shows the designs as coming soon and nothing is offered for sale. In `src/data/aaroh.ts`, every design has `sku: null`.
- **"Delete" means delist, never delete.** All ten existing card designs (60 SKUs) are delisted with `active = false` (migration 027). Their rows, past orders, card serials and `card_editions` counters stay.
- **The old card art leaves the customer experience.** The store, product page, home page, footer, 404 page, search, SEO and sitemap now show only AAROH. The home page card builder, which sells those cards, shows only while card sales are open; it must be re-pointed to the AAROH SKUs before then.

## Amendment A-2 (2026-10-12, in session)
After the round-1 designs (landscape, the ribbon S as the front emblem, flat line art), the owner said "Try again" and chose, in session:

| # | Question | Answer |
|---|---|---|
| A2-1 | What to change | **Redesign the cards** |
| A2-2 | Orientation | **Portrait, like the moodboard** |
| A2-3 | Emblem | **A new AAROH lotus emblem** |
| A2-4 | Look | **More like the moodboard**: real materials, not flat vector |

**Recorded effect**
- `DESIGN.md` is rewritten for round 2. The cards are upright (53.98 × 85.60 mm). Each front carries a lotus emblem, AAROH, BY SHYGON (the real wordmark) and VERSION 01, with an edition ornament:
  - Noir: a Mughal ogee lattice in relief under a gold temple skyline;
  - Ivory: an embossed botanical garland;
  - Titanium: brushed blue with flowing platinum lines.
- **The lotus emblem is a proposal.** It is an original construction, not traced from the moodboard or any existing mark. Adopting it as a brand asset needs the owner's approval and a trademark clearance search (O-A4). The SHYGON wordmark and ribbon S are unchanged and still used.
- **New NFC risk, recorded for the supplier:** the metal border must not form a closed loop around the antenna (`DESIGN.md` §11).
- **Store:** the images are now upright (`AAROH_IMAGE_SIZE` 960 × 1522, small 480 × 761) and the layouts follow. The edition descriptions changed to match. Nothing else on the store changed: no prices, SKUs, schema or payment behaviour. Migration 027 and its SHA-256 are unchanged.
- The round-1 artwork was regenerated, so it no longer exists in the repository.

## What changed (implemented locally)

**Store and product page**
- **`/shygontap/store`:** the AAROH introduction.
  - Headline "One Card. Many Possibilities."
  - CTAs "Explore AAROH" and "How It Works".
  - Four answers: what it is, how it works, what software comes with it, what you receive.
  - The three designs, marked as concept designs that are coming soon.
- **`/shygontap/store/aaroh`:** the one product page.
  - A design picker with front and back renders, which changes only the variation.
  - Overview: the card vs the software.
  - How it works: 4 steps.
  - The software experience, with each feature's real status.
  - Cardholder vs recipient.
  - One platform, with each use case's status.
  - The design comparison.
  - What is included, with live catalogue prices for what is on sale today.
  - 14 FAQs.
- **Source of truth for claims:** `src/data/aarohProduct.ts`. Every claim was checked against the code.
  - Not implemented, so not claimed: vCard "save contact", and student, hotel, attendance, payments and ticketing services.
  - Labelled "with the card release": card activation, lost-card protection and card numbering.

**Old URLs**
- The ten card pages (`/shygontap/store/<card>`) return 301 to `/shygontap/store/aaroh`, on both hosts and in the app.
- `/shygontap/store/aaroh/<design>` opens the product page with that design selected.

**Copy corrected in passing (verified against the code)**
- Essential does not include WhatsApp (`Tiers.tsx`); WhatsApp is a paid add-on.
- Business does not include website and social links (`shygonTapData.ts`); those are add-ons.
- The card-release copy no longer names the retired categories or materials.

## Data change: migration 027 (exact production SQL)
The exact production SQL is the whole file `supabase/migrations/027_aaroh_catalog.sql`. Its SHA-256 at approval time is recorded below; if the file changes, this record must be updated before the file is applied.

SHA-256: `3b87538894d62a836d1fe7e8e3a88bee8242e09fdf600d6ab4ea20e3e971d5da`

- **What it does:** `UPDATE public.products SET active = false` for the 60 card SKUs (10 designs × 2 finishes × 3 materials).
- **What it does not touch:**
  - other columns or rows;
  - inserts or deletes;
  - schema, policies, grants or functions.
- **Rollback:** in the header, setting the same 60 rows active again. It is tested to restore the catalogue exactly.
- **Idempotent:** a second run changes nothing.

**Production gate (human only)**
1. DEC-2026-018: 24-hour cool-off plus the checklist review, then approve.
2. Run the file's VERIFY ON LIVE queries, which are read-only:
   - 10 designs × 6 rows, with their active state;
   - no card rows outside the 60;
   - pending card checkouts.
3. Order:
   1. Deploy the AAROH frontend first.
   2. Then apply 027.

   Applying 027 under the current live V5 storefront would make its card buttons fail at checkout.
4. Apply in the Supabase SQL editor, never through `db:push` (DEC-2026-023 A-1).

## Open items
- **O-A1: digital pairing.** Today the designs only change the card. Matching profile palettes are proposed in `DESIGN.md` §12: there is no light palette for Ivory Atelier, and `titanium` is a proposal. Any such palette is a renderer change plus an entitlement decision (L3).
- **O-A2: card-release prerequisites.** Sales stay closed until the DEC-2026-035 card items land:
  - I-4 activation;
  - O-7;
  - F3, deactivation that actually stops a card (V6-034);
  - F4 + O-3;
  - I-5.
- **O-A3: catalogue rows and prices for the three designs.** These are new products, which need owner approval. Then:
  - re-point the home builder (`BUILDER_CARDS` in `ShygonTap.tsx`) and the product page purchase panel;
  - add `card_editions` rows for numbering.
- **O-A4: design approvals.** These are listed in `DESIGN.md` §14:
  - the three round-2 editions and AAROH as set;
  - the proposed AAROH lotus emblem, after a trademark clearance search;
  - ~~orientation~~: decided, portrait (A-2);
  - the serial format and its link to chapters of 100;
  - the URL scheme;
  - the legal name on the back, and the back wording.

  Physical-card-visible choices are irreversible (G§78) and need this record or their own.
- **O-A5: two existing inaccuracies outside the store, flagged and not fixed here.**
  - The Cards page and the Terms say deactivating a card stops the Tap; it does not (F3).
  - The QR page's "Download PNG" looks for a `<canvas>` while the QR is drawn as `<svg>`.
