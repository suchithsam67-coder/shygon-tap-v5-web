# SHYGON Version 1 — AAROH: physical card design specification

> **SUPERSEDED (2026-10-14/16). The rest of this file describes round 2 (three upright editions with a proposed lotus) and is kept as history only.**
>
> Current direction, on the owner's instructions:
> - **Editions.** The ten editions of the AAROH design system, E01 Obsidian to E10 Liquid Form, with that system's own materials, motifs and colours.
> - **Format.** **Landscape** ID-1, 85.60 × 53.98 mm.
> - **Logo.** The **official SHYGON logo** (ribbon S and wordmark), not the lotus.
> - **Name.** "SHYGON AAROH, Version 01".
> - **Print.** Printer-ready to the design system's print rules.
>
> Sources of truth:
> - `design-assets/src/editions.mjs`: geometry, materials, CMYK values and Tier B finishes per edition;
> - `design-assets/src/print.mjs` and `design-assets/PRINT.md`: the printer files, and the serial and card-registry decision;
> - `src/data/aaroh.ts`: store data and the per-edition UI themes;
> - the design canvas, https://claude.ai/artifact/PDDgqUPUVtd2SShFBXfUXz.
>
> **Status: PROPOSED — REQUIRES VALIDATION.** This is the design baseline for the SHYGON Version 1 — AAROH smart-card collection (round 2, 2026-10-12). No dimension, process, material or colour here is approved for manufacturing until the selected card supplier validates it. The renders are **concept** artwork drawn from this specification, with lighting filters for relief and foil. They are not photographs and not production files. No manufacturing approval or test result is claimed anywhere in this document.

| | |
|---|---|
| Product | SHYGON Version 1 — AAROH |
| Brand | SHYGON (SHYGON Technologies Pvt. Ltd.) |
| Family | One unified smart-card platform |
| Launch editions | 01 Signature Noir · 02 Ivory Atelier · 03 Midnight Titanium |
| Orientation | **Portrait**: the card held upright, 53.98 mm wide × 85.60 mm tall |
| Units | Millimetres. Origin: the top-left corner of the face being described, card upright |
| Supporting files | `design-assets/texture-directions.md`, `design-assets/manufacturing-handoff.md`, `design-assets/**` (artwork and generators) |
| Regenerate | `node design-assets/src/build.mjs && node design-assets/src/sheet.mjs && node design-assets/src/render.mjs` |

**Round 2.** Round 1 (2026-10-11: landscape, the ribbon S as the front emblem, flat line art) was replaced after the owner's feedback ("Try again"). On 2026-10-12 the owner chose:
- portrait cards, like the moodboard;
- a new AAROH lotus emblem;
- a look closer to the moodboard: real materials (textured black, embossed ivory, brushed blue metal), not flat vector.

This document describes round 2. The round-1 artwork has been regenerated and no longer exists in the repository.

---

## 1. Product identity

AAROH is one product: a physical NFC card, a QR fallback and the SHYGON digital experience the card opens. Business, student, event, hospitality and other applications are **use cases of the same card**, not separate card categories. Nothing on any edition names a use case.

The three editions share everything except their surface: the same platform, chip, QR, layout, emblem and typography. Each has its own colour, texture, ornament and finish.

Direction: modern Indian luxury, after the moodboard:
- a lotus emblem at the top;
- the AAROH name in a wide-tracked serif, BY SHYGON beneath it, VERSION 01 at the foot;
- Indian architecture and botany in relief: a Mughal ogee lattice and temple skyline, a garland like the carved plant panels of Mughal marble, flowing machined lines;
- controlled champagne-gold or platinum detail and a fine metal border.

### Emblem and logo

- **The AAROH lotus emblem is new and is a proposal.** It is an original construction drawn for this round (`LOTUS` in `design-assets/src/build.mjs`; sheet `design-assets/layout/aaroh-emblem.svg`):
  - a pointed central petal with an inner petal;
  - two petal pairs opening outwards;
  - a bindu above and two water lines below;
  - drawn as 0.35 mm strokes, so it reads as engraved foil rather than a filled icon.
- It is not traced from the moodboard or from any existing mark. Lotus emblems are common, so before adoption it needs the owner's approval as a brand asset **and a trademark clearance search** (§14).
- **The SHYGON logo is unchanged and used exactly as supplied**: scaled uniformly, never redrawn, distorted, outlined, rotated or recoloured beyond a single foil colour.
  - The SHYGON wordmark (`public/brand/shygon-wordmark.svg`) forms "BY SHYGON" on the front.
  - The ribbon S mark (`public/brand/shygon-mark.svg`, 428 × 798 units, 1 : 1.865) sits on the back.

## 2. Common physical specification (all editions)

| Parameter | Specification | Status |
|---|---|---|
| Card format | ID-1 (ISO/IEC 7810) | PROPOSED |
| Width (upright) | 53.98 mm | PROPOSED |
| Height (upright) | 85.60 mm | PROPOSED |
| Nominal thickness | 0.84 mm (see note) | PROPOSED — REQUIRES VALIDATION |
| Corner radius | 3.18 mm | PROPOSED |
| Orientation | Portrait, both faces designed | Owner decision, 2026-10-12 |
| Default substrate | Premium NFC-compatible polymer or composite (PVC or PETG, §10) | PROPOSED — REQUIRES VALIDATION |
| Base surface | Soft-touch matte with a fine grain (Noir), satin with a fine tooth (Ivory), satin with a brushed effect (Titanium) | PROPOSED |
| Metal border | A foil band on the face at the die line: 0.55 mm (Noir, Titanium), 0.70 mm (Ivory). Must not form a closed loop (§11) | PROPOSED — REQUIRES VALIDATION |
| NFC | Integrated inlay; chip and antenna validated in the finished construction | REQUIRES VALIDATION |
| QR code | High-contrast, generated per card from a verified URL | PROPOSED |
| Serial number | Unique per issued card; format example `AR01-000001` | PROPOSED |
| Printed safe margin | 4.0 mm from every edge (the border band excepted) | PROPOSED |
| Texture boundary | Relief stops 1.0 mm inside the die line, to protect the cut edge | PROPOSED — REQUIRES VALIDATION |
| Emblem clear space | At least 1 u on every side (u = 3.50 mm, §7) | PROPOSED |

**Thickness note.** ISO/IEC 7810 ID-1 is 0.76 mm ± 0.08 mm, so the 0.84 mm target sits at the top of the tolerance band. Before approving it, the supplier must confirm that 0.84 mm:
- is achievable with the inlay;
- stays within tolerance after lamination;
- fits common card printers and wallets.

## 3. Colour

The HEX values are digital references. Production colour is approved on physical drawdowns or prototype cards, as follows:
- Viewing booth: D50 (ISO 3664) light, plus a check under D65 and warm 3000 K retail light.
- Target: ΔE00 ≤ 2.0 against the approved master (PROPOSED).
- The approved master card becomes the reference, not the screen.

### Edition 01 — Signature Noir
| Element | HEX | Use |
|---|---|---|
| Primary black | `#101010` | Face base |
| Secondary graphite | `#252525` | Grain and relief highlights |
| Champagne gold | `#C6A567` | Foil base tone, VERSION 01 |
| Highlight gold | `#E2C98E` | Foil highlight, serial |
| Shadow detail | `#080808` | Relief shadows |

Finish: soft-touch matte black with a fine grain, champagne-gold foil and a gold border.

### Edition 02 — Ivory Atelier
| Element | HEX | Use |
|---|---|---|
| Primary ivory | `#F0E8D9` | Face base |
| Warm stone | `#D9CCB6` | Relief tone |
| Champagne gold | `#B59A64` | Foil |
| Shadow beige | `#C7B79E` | Relief shadows |
| Typography | `#292720` | Serial, QR modules |

The AAROH name on Ivory is debossed in a warm taupe (`#5E5546`) rather than foiled; VERSION 01 prints `#6B6252`. The foil gradient on Ivory runs darker than on Noir (`#D8BF86` to `#6F5A30`) so the gold type holds contrast on the light ground.

Finish: warm ivory satin with blind-embossed botanical relief, champagne-gold foil and a gold border.

### Edition 03 — Midnight Titanium
| Element | HEX | Use |
|---|---|---|
| Primary midnight blue | `#101D32` | Face base |
| Secondary navy | `#192A45` | Brushed highlights |
| Graphite blue | `#26354A` | Etched lines |
| Platinum silver | `#C7CDD4` | Foil base tone, VERSION 01 |
| Highlight silver | `#E5E8EC` | Foil highlight, serial, QR plate |

Finish: deep blue with a brushed effect, etched and platinum-silver flowing lines, and a silver border.

## 4. Front layout (all editions)

Origin: top-left of the front face, card upright. Everything is centred on x = 26.99 mm. Drawing: `design-assets/layout/aaroh-front-layout.svg`; numbers: `design-assets/measurements.json`.

| Element | Position (mm) | Size (mm) | Typeface | Notes |
|---|---|---|---|---|
| AAROH lotus emblem | x 19.99–33.99, top 12.00, bottom 25.30 | 14.00 × 13.30; stroke 0.35 | Emblem (proposal) | Foil, bevelled |
| Emblem clear space | x 16.49–37.49, y 8.50–28.80 | 1 u = 3.50 | — | No texture, foil or text |
| AAROH | top 33.00, baseline 37.40; x 12.68–41.30 | cap 4.40; width 28.62 | Playfair Display 400 | Proposed wordmark, not an official logo |
| BY SHYGON | top 40.60, baseline 41.85; x 15.55–38.43 | cap 1.25; width 22.88 | "BY" Inter 500 + the SHYGON wordmark asset | Gap between BY and SHYGON: 2.10 |
| VERSION 01 | baseline 74.60; x 20.42–33.56 | cap 1.30; width 13.13 | Inter 500 | Tracking 0.18 em |
| Calm zone | Ellipse centred (26.99, 29.50), 46.0 × 42.0 | — | — | Noir's lattice fades out under the identity; Ivory's and Titanium's motifs are composed to avoid it |
| Edition ornament | Lower half (§8) | — | — | Noir: temple skyline. Ivory: garland and a rule under the byline. Titanium: silver flow |

- Nothing personal, no QR and no serial on the front.
- Minimum distance from any printed element to an edge: 4.00 mm, except the border band and the relief, which runs to 1.0 mm. Noir's plinth line sits on the 4.00 mm line.

## 5. Back layout (all editions)

Origin: top-left of the back face, card upright. Drawing: `design-assets/layout/aaroh-back-layout.svg`.

| Element | Position (mm) | Size (mm) | Typeface | Notes |
|---|---|---|---|---|
| Tap glyph | centre (26.99, 14.00) | 3.65 × 4.90 | Custom drawing | A point and three arcs. Deliberately **not** the NFC Forum N-Mark or the EMVCo Contactless Indicator, which are licensed marks |
| TAP OR SCAN | centre y 22.00, baseline 22.75; x 16.89–37.09 | cap 1.50; width 20.20 | Inter 500 | Tracking 0.30 em |
| QR symbol | top-left (17.99, 28.00) | 18.00 × 18.00 | — | Version 3 (29 × 29) gives a 0.621 mm module; the final version depends on the real URL length |
| QR quiet zone | 4 modules = 2.48 | clear box (15.51, 25.52), 22.97 square | — | The light plate fills the clear box |
| Serial | centre y 57.00, baseline 57.85; x 17.73–36.25 | cap 1.70; width 18.51 | Inter 500 | Format example `AR01-000001`, not an issued identifier |
| SHYGON mark | x 24.99–28.99, y 61.20–68.66 | 4.00 × 7.46 | Logo asset | At its minimum size (§7) |
| SHYGON TECHNOLOGIES | centre y 72.00, baseline 72.63; x 11.63–42.35 | cap 1.25; width 30.72 | Inter 500 | Tracking 0.30 em |

**QR rules**
- On every edition the QR sits on a **smooth printed light plate** that fills the clear box: no grain, relief or brushing under the code.
  - Noir: `#EFE6D3` plate, `#101010` modules.
  - Ivory: `#F8F3E9` plate, `#292720` modules.
  - Titanium: `#E5E8EC` plate, `#101D32` modules.
- A 0.16 mm foil hairline frames the plate, 0.9 mm outside the clear box. The relief is masked 1.0 mm beyond the box.
- No relief, foil, varnish texture or text inside the clear box. Never print QR modules in foil: reflective foil scans unreliably.
- Codes are generated per card from verified URLs only. **Until the production URL scheme exists, every render shows a labelled placeholder ("QR PLACEHOLDER — NOT A REAL CODE"): finder patterns only, with no data modules.**

## 6. Typography

| Role | Family | Weight | Size | Cap height | Tracking | Line spacing |
|---|---|---|---|---|---|---|
| AAROH (proposed wordmark) | Playfair Display | 400 | 6.21 mm (17.6 pt) | 4.40 mm | 0.30 em | Single line |
| BY | Inter | 500 | 1.72 mm (4.9 pt) | 1.25 mm | 0.62 em (matches the SHYGON wordmark's letter rhythm) | Single line |
| VERSION 01 | Inter | 500 | 1.79 mm (5.1 pt) | 1.30 mm | 0.18 em | Single line |
| TAP OR SCAN | Inter | 500 | 2.06 mm (5.8 pt) | 1.50 mm | 0.30 em | Single line |
| Serial | Inter | 500 | 2.34 mm (6.6 pt) | 1.70 mm | 0.14 em | Single line |
| SHYGON TECHNOLOGIES | Inter | 500 | 1.72 mm (4.9 pt) | 1.25 mm | 0.30 em | Single line |

- Two families only: Playfair Display, an editorial serif, for AAROH; Inter for everything else. Both are SIL Open Font License 1.1 and already self-hosted by the project (`@fontsource`).
- In artwork, all text is converted to outlines at 0.001 mm precision (`scripts/brand/type.mjs`, `decimals: 3`), so the supplier needs no fonts.
- **AAROH as set here is a proposal**, not an existing official logo. If the owner approves it, it becomes a logo asset with its own file.
- Every element stays single-line, so line spacing does not apply; the vertical rhythm is set by the positions in §4–§5.
- The smallest text (4.9 pt, uppercase, tracked) is at the practical minimum for legibility in foil. The supplier should confirm the minimum stroke for its foil and print processes; Inter 500 at 1.25 mm cap has stems of about 0.15 mm.

## 7. Emblem and logo usage

Drawing: `design-assets/layout/aaroh-emblem.svg`.

**AAROH lotus emblem (proposal)**
- **Reference unit u** = ¼ of the emblem's width. On the card: 3.50 mm.
- **Clear space:** at least 1 u on all sides. No texture, foil, varnish or text inside it. The calm zone (§4) already leaves it free.
- **Minimum size:** 8.0 mm wide, with the stroke kept at 0.20 mm or more.
- **Treatment:** one foil colour, champagne gold (Noir, Ivory) or platinum silver (Titanium), with a slight raised bevel if the supplier can register a foil-and-emboss die.

**SHYGON marks (unchanged assets)**
- **Wordmark** in BY SHYGON: 1.25 mm letter height, foil.
- **Ribbon S** on the back: minimum 4.0 mm wide (7.46 mm high); one foil colour.

## 8. Textures and ornament (final selection)

Nine texture concepts were developed, three per edition. The comparison and scores are in `design-assets/texture-directions.md`; the final three are below. **The artwork's line widths are design intent.** The width and depth actually achieved depend on the process (emboss tooling, textured UV varnish, laser etch) and must be measured on prototypes.

The metallic coverage below was measured on the rendered fronts and **includes the border band**, which alone is about 3.3% of the face at 0.55 mm and 4.2% at 0.70 mm.

### Signature Noir — Architectural Relief: "Mughal Ogee Lattice" with a temple skyline
- **Lattice:** two mirrored families of sine curves, x = 26.99 + 9k ± 4.5 sin(2π(y − 1.5)/14), meeting in onion-shaped (ogee) cells 9.00 × 14.00 mm. A four-petal rosette (petals 1.55 mm) sits at each cell centre. Lines 0.30 mm.
- **Relief:** raised tonal emboss or tactile varnish, **0.03–0.08 mm to investigate**. Black on black; it fades out under the emblem and name.
- **Temple skyline (gold foil):**
  - A tall onion dome on the centre line: base on the 4.0 mm line, 26.00 mm wide (x 13.99–39.99), springing at y 66.00, apex 50.20. Two inner echoes at 23.60 and 21.20 mm wide. VERSION 01 sits inside it.
  - A finial line to y 48.40 and a diamond (y 46.60–48.70).
  - Two chhatris (small domes) at x 8.59 and 45.39, 8.00 mm wide, apex 64.80, with inner echoes and diamond finials.
  - A plinth line along the 4.0 mm line, x 4.00–49.98.
  - Lines: dome 0.42 mm, echoes 0.20 mm, chhatris 0.32 and 0.16 mm, finials 0.26 mm, plinth 0.24 mm.
- **Gold (measured):** 6.57% of the front, border included. That also covers the emblem, AAROH and BY SHYGON.
- **Edge:** black core, gold border on the face. Optional gold edge paint if it passes abrasion testing.

### Ivory Atelier — Crafted Stone: "Botanical Garland"
- **Construction**
  - Two leafy branches rise from the bottom centre around VERSION 01 and end in tendrils at about y 47.50 near each side. Each is a cubic curve from (25.79, 82.20) to (5.80, 47.50), mirrored.
  - Eleven alternating leaves per branch, 5.0 mm long at the base, shrinking towards the tip. Each leaf is a filled blade with a vein groove up to 0.28 mm wide. Small berries (0.84 mm) every third leaf.
  - A sprig of five leaves in each top corner, from (2.60, 13.00) to (14.00, 5.80), mirrored.
  - A small blind-embossed lotus (4.6 mm wide) where the branches meet.
  - Stems 0.30 mm.
  - The garland follows the carved plant panels of Mughal marble. It is an original drawing, generated from curves, and not traced.
- **Relief:** blind (tonal) emboss, **0.05–0.10 mm to investigate**. Quiet under direct light, clear under raking light; the sheet shows both.
- **Gold (measured):** 5.00% of the front, border included. That also covers the emblem, BY SHYGON, and a 0.16 mm rule under the byline (x 11.99–41.99 at y 46.60) broken by a small diamond. AAROH is debossed, not foiled.
- **Edge:** ivory core, gold border on the face. Optional gold edge paint.

### Midnight Titanium — Precision Flow: "Silver Flow"
- **Construction**
  - A brushed base: horizontal streaks, like brushed metal.
  - A fan of 13 lines rises from the left edge (y 44–58) and opens to the right edge (y 1–27), passing under BY SHYGON.
  - An answering fan of 7 lines runs from the right edge (y 71–78) to the bottom edge (x 8–32). Its top line stays at least 2.4 mm below VERSION 01.
  - Every third line is platinum-silver foil (0.22 mm), 6 lines in all. The rest are etched (0.24 mm).
  - Adjacent lines are at least 0.68 mm apart (centre to centre), so they do not merge when etched.
- **Relief:** etched or debossed, **0.02–0.05 mm to investigate**. Lines read as cut into the surface.
- **Silver (measured):** 4.84% of the front, border included. That also covers the emblem, AAROH, BY SHYGON and VERSION 01.
- **Edge:** dark blue or graphite core, silver border on the face. Optional silver edge paint.

## 9. Back faces

Each back carries its edition's texture at about 60% strength, masked away from the QR clear box. The text colours follow §3.

- **Noir:** champagne-gold glyph, instruction and S; `#E2C98E` serial; `#8E8676` company line.
- **Ivory:** gold glyph, instruction and S; `#292720` serial; `#5C574B` company line.
- **Titanium:** platinum glyph, instruction and S; `#E5E8EC` serial; `#8592A5` company line.

## 10. Materials and manufacturing (summary)

Full supplier requirements are in `design-assets/manufacturing-handoff.md`.

| | Signature Noir | Ivory Atelier | Midnight Titanium |
|---|---|---|---|
| Proposed substrate | Black-core PVC or PETG composite | White-core PVC or PETG composite, ivory print | PVC or PETG composite with a brushed-effect print layer |
| Surface | Soft-touch matte overlay, fine grain | Satin overlay, fine tooth | Satin overlay, brushed texture printed or embossed |
| Relief | Tonal emboss or tactile UV varnish (lattice) | Blind emboss (garland); AAROH debossed | Laser etch or tactile varnish (flow lines) |
| Metallic | Champagne hot foil | Champagne hot foil | Platinum foil, or non-conductive metallic ink |
| Border | 0.55 mm gold foil | 0.70 mm gold foil | 0.55 mm silver foil |
| Edge | Black; optional gold paint | Ivory; optional gold paint | Graphite or blue; optional silver paint |
| NFC risk | Medium: foil border (§11) | Medium: foil border (§11) | **Higher**: foil border, and avoid conductive metallised layers |
| Relative cost | Medium | Medium to high (emboss tooling) | Medium to high |

Constructions evaluated (§4 of the handoff):
- PVC;
- PETG or another engineered polymer;
- composites with decorative layers;
- metal or hybrid, **only** with a validated RF design.

Metal cards are not proposed for Version 1: a metal body shields the antenna unless the card is specifically engineered for it. The "brushed metal" of Midnight Titanium is a printed or embossed effect, not metal.

**Do not assume compatibility.** Metal foil, conductive inks, metallised films, embossing over the antenna and metal substrates can all change NFC performance. The finished construction, antenna position and foil layout are approved together, on prototypes.

## 11. NFC and QR quality requirements

Required before production approval. None of these have been run; there are no results yet.

1. **Border foil and the antenna.** A continuous metal ring around the card can act as a shorted turn around the antenna and weaken or block reads. The border must either be broken (a gap of at least 1 mm, placed where the supplier advises) or printed in non-conductive metallic ink. Validate with read tests.
2. NFC read tests through the **finished card** (not a bare inlay) on at least 10 phones: recent and older iPhones (iPhone XS or later for background tag reading) and Android phones from several manufacturers. Record read distance and success rate per phone.
3. QR scans:
   - under ordinary indoor light (about 300–500 lux);
   - in outdoor shade and direct sun;
   - at 20–40 cm;
   - with the native camera apps.
4. Both again after wear: 500 abrasion cycles on the face (method agreed with the supplier), flex testing to ISO/IEC 10373-1, and 7 days of pocket and wallet carry.
5. Quiet zone (≥ 4 modules) and print contrast (symbol grade B or better to ISO/IEC 15415) verified on production samples.
6. No decoration of any kind inside the QR clear box.
7. **Fallback when NFC is unavailable:** the QR code on the back opens the same page. "TAP OR SCAN" states both options.
8. Every issued card's chip URL and QR URL resolve to that card's authorised page. Each one is checked against the issue record before dispatch.

No live URL, production identifier or test result is invented here. The URL scheme for chips and QR codes is an open decision (§14).

## 12. Digital experience pairing

The card opens the same SHYGON digital experience for every edition. Following DEC-2026-036 Q3 ("visual theme only"), an edition may suggest a matching profile theme. Package features stay the same.

| Edition | Closest existing Tap palette | Note |
|---|---|---|
| Signature Noir | `ivory` (near-black ground, ivory accent, gold highlight) | Good match today |
| Ivory Atelier | none | Every current palette is dark. A light "atelier" palette would be a renderer change, plus an entitlement decision |
| Midnight Titanium | `midnight` (blue ground) or `graphite` (silver accent) | A "titanium" palette (midnight ground, platinum accent) would match better |

## 13. Deliverables

| File | What it is |
|---|---|
| `DESIGN.md` | This specification |
| `design-assets/texture-directions.md` | Nine texture concepts, comparison and selection |
| `design-assets/manufacturing-handoff.md` | Supplier-facing requirements, questions and validation checklist |
| `design-assets/aaroh-design-sheet.html` | Self-contained presentation: hero composition, fronts and backs, close-ups, edges and corners, material comparison, layouts, emblem |
| `design-assets/concepts/*-concept.svg` | Front and back of each edition, vector, in millimetres |
| `design-assets/textures/*.svg` | The nine texture concept swatches (selected ones marked) |
| `design-assets/layout/*.svg` | Front and back layouts with coordinates and safe zones, the emblem sheet, proposed cross-section |
| `design-assets/renders/*.png` | PNG previews of everything above |
| `design-assets/measurements.json`, `coverage.json` | The numbers this document quotes, as generated |
| `public/assets/aaroh/*.webp` | Web images of the concept faces, for the store (960 × 1522 and 480 × 761) |
| `design-assets/src/*.mjs` | The generators: build, sheet, render |

The visual deliverables are concept renders, not photography. Relief, foil and metal are simulated with SVG lighting filters, and the 3D composition in the presentation sheet approximates three-quarter product views. Photoreal renders and photographs require real prototypes.

## 14. Open decisions and supplier validations

**Owner decisions**
1. Approve the three editions, their textures and ornaments, and AAROH as set. Or name changes.
2. **Emblem:** approve the proposed AAROH lotus as a brand asset (chosen as the direction on 2026-10-12), after a trademark clearance search. Until then it stays a proposal.
3. **Orientation:** decided. Portrait, on 2026-10-12 (round 1 followed the brief's landscape).
4. **Serial format:** `AR01-000001` is an example only. Decide:
   - whether the serial encodes the edition (for example `AR01-SN-000001`);
   - how it relates to the numbered chapters of 100 (migration 017: "Chapter I · Nº 042 of 100").
5. **URL scheme** for chips and QR codes, and how a card is issued and activated (card-release item I-4, DEC-2026-035).
6. **Catalogue and price** for the three editions. None exist in the products table yet (§15).
7. Digital pairing (§12): new `atelier` and `titanium` palettes, and who may use them.
8. Legal name on the back: `SHYGON TECHNOLOGIES` (as briefed) or `SHYGON Technologies Pvt. Ltd.`
9. Back wording: "TAP OR SCAN" (an instruction, specified) or the moodboard's "TAP · CONNECT · EXPLORE".

**Supplier validations** (details in the handoff)
- Construction:
  - thickness 0.84 mm vs ISO 0.76 ± 0.08 mm;
  - layer build-up;
  - antenna position and chip.
- Relief:
  - achievable depth and minimum line width per process;
  - the relief boundary;
  - embossing Ivory's garland without cracking the overlay.
- Foil:
  - foil types and the NFC effect of each foil area;
  - **the border: a gap, or non-conductive ink (§11)**;
  - minimum foil stroke for 4.9 pt text and the 0.16 mm hairlines;
  - foil-and-emboss registration for the emblem.
- Colour: matching to the HEX references under D50.
- Edges: edge paint durability.
- Durability: abrasion, flex and UV resistance.
- QR: print grade on each plate.
- Titanium only: a non-conductive brushed effect.

## 15. Relation to the store (DEC-2026-036)

The store's AAROH editions previously mapped four existing designs (Rose Marble, Obsidian Smoke, Sapphire Night, Aurora Glass). **The owner rejected those designs on 2026-10-11.** These three editions replace them as concepts. Round 2 (this document) replaced round 1's artwork on 2026-10-12; the store shows the new upright renders.

They have no SKUs or prices, so they are presented as "coming soon" and cannot be bought. Card sales also remain closed under DEC-2026-035. Adding catalogue rows and prices needs the owner's approval (§14, item 6).
