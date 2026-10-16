# AAROH Version 1 — manufacturing handoff (supplier-facing)

> For card manufacturers quoting and prototyping SHYGON Version 1 — AAROH. Everything below is **PROPOSED — REQUIRES VALIDATION**. Nothing has been manufactured or tested yet, and nothing here is an approval. The authoritative design is `DESIGN.md` in the repository root (round 2, 2026-10-12). Artwork is supplied as vector SVG in millimetres, card upright, with all text outlined.

## 1. What we are making

| Item | Value |
|---|---|
| Product | SHYGON Version 1 — AAROH smart card, three editions |
| Editions | 01 Signature Noir (matte black, champagne gold) · 02 Ivory Atelier (ivory satin, embossed garland, champagne gold) · 03 Midnight Titanium (brushed midnight blue, platinum silver) |
| Format | ID-1, corner radius 3.18 mm, designed **portrait**: 53.98 mm wide × 85.60 mm tall |
| Target thickness | 0.84 mm nominal. Please confirm against ISO/IEC 7810 (0.76 ± 0.08 mm) and your inlay |
| Faces | Both faces printed |
| Chip | NFC Forum Type 2 or Type 4 tag holding one URL (NDEF). Exact chip to be proposed by the supplier: NTAG 213/215/216 class, or equivalent with an originality signature, preferred |
| Personalisation | Per card: unique NDEF URL, unique QR code, unique printed serial. All three must match the issue record |
| Quantities | Prototype run first. Production volumes to be confirmed |

## 2. Files we supply

| File | Content |
|---|---|
| `design-assets/concepts/aaroh-<edition>-front-concept.svg` and `-back-concept.svg` | Design intent per face (concepts; production separations to follow your template) |
| `design-assets/layout/aaroh-front-layout.svg`, `aaroh-back-layout.svg` | Positions, sizes, safe zones and the QR clear box |
| `design-assets/layout/aaroh-emblem.svg` | The AAROH lotus emblem: construction, size and clear space |
| `design-assets/layout/aaroh-cross-section.svg` | Proposed 0.84 mm build-up (starting point only) |
| `design-assets/textures/*-selected.svg` | The three textures in isolation, for relief tooling |
| `design-assets/aaroh-design-sheet.html` | Overview: colours, finishes, close-ups, edges |

The concept files simulate relief, foil and brushing with lighting filters. Production files will separate them into plain vector layers. We need your separation template (die line, bleed, layer naming) before we prepare production files. We will deliver one layer each for:
- the colour print;
- relief or varnish;
- foil;
- the QR/serial variable-data area.

## 3. Layout essentials

- **Safe margin:** 4.0 mm for every printed element, except the border band. Relief stops 1.0 mm inside the die line.
- **Border:** a foil band on the face at the die line, 0.55 mm (Noir, Titanium) or 0.70 mm (Ivory). It must not form a closed loop (§4, NFC).
- **Front:** everything centred on x = 26.99 mm.
  - lotus emblem 14.00 × 13.30 mm, top at 12.00 mm;
  - AAROH (cap 4.40 mm) at top 33.00 mm; BY SHYGON (cap 1.25 mm) at top 40.60 mm; VERSION 01 baseline 74.60 mm;
  - the edition ornament in the lower half: Noir's gold temple skyline, Ivory's embossed garland, Titanium's flow lines.
  - Nothing variable on the front.
- **Back:**
  - tap glyph centred at (26.99, 14.00); TAP OR SCAN at y 22.00;
  - QR symbol 18.00 × 18.00 mm at (17.99, 28.00), with a 4-module quiet zone (2.48 mm for version 3) and clear box (15.51, 25.52) 22.97 mm square;
  - serial at y 57.00; SHYGON mark 4.00 × 7.46 mm at top 61.20; SHYGON TECHNOLOGIES at y 72.00.
- **QR clear box:** no relief, foil, texture varnish or text inside it, ever. Every edition prints a smooth light plate under the QR that fills the box, framed by a 0.16 mm foil hairline 0.9 mm outside it.

## 4. Process per edition (proposals to confirm)

| | Signature Noir | Ivory Atelier | Midnight Titanium |
|---|---|---|---|
| Substrate | Black-core PVC or PETG composite | White-core PVC or PETG composite | PVC or PETG composite |
| Print | Black base `#101010`, graphite `#252525` | Warm ivory `#F0E8D9`, stone `#D9CCB6`; AAROH `#5E5546` | Midnight `#101D32`, navy `#192A45`, graphite blue `#26354A`, brushed-effect pattern |
| Surface | Soft-touch matte overlay or coating with a fine grain | Satin overlay with a fine tooth | Satin overlay; brushed texture printed or embossed |
| Relief | Tonal emboss, or tactile (raised) UV varnish, on the ogee lattice: 0.03–0.08 mm | Blind emboss of the garland (raised leaves, vein grooves), 0.05–0.10 mm; AAROH debossed | Laser etch, or tactile varnish, on the flow lines: 0.02–0.05 mm |
| Metallic | Champagne-gold hot foil: emblem, AAROH, byline, temple skyline, border. Measured 6.6% of the face, border included | Champagne-gold hot foil: emblem, byline, rule, border. 5.0% | Platinum-silver foil, or **non-conductive** metallic ink: emblem, AAROH, byline, VERSION 01, 6 flow lines, border. 4.8% |
| Edge | Black core; optional gold edge paint | Ivory core; optional gold edge paint | Graphite or blue core; optional silver edge paint |
| Emblem | Foil, with a slight raised bevel if foil-and-emboss registration allows | Same | Foil, or laser engraving |
| Relative cost | Medium | Medium to high (emboss tooling) | Medium to high |
| NFC risk | Medium: the foil border | Medium: the foil border | **Higher**: the foil border, and a metallised brushed layer can detune the antenna |

**NFC and the border.** A continuous metal ring around the card can behave as a shorted turn around the antenna and weaken or block reads. Please propose either a gap in the border (at least 1 mm, placed where your antenna layout allows) or a non-conductive metallic ink, and prove it with read tests (§6, test 1).

Constructions to evaluate and quote:
1. Premium PVC.
2. PETG or another engineered polymer (preferred for durability and lower chlorine content, if available).
3. Composite with decorative surface layers.
4. Metal or hybrid: **only** with a validated RF design. We do not propose metal for Version 1. The "brushed metal" of Midnight Titanium is a printed or embossed effect.

**Colour.** Match the HEX references on physical drawdowns under D50 (ISO 3664); also check under D65 and 3000 K. The target is ΔE00 ≤ 2.0 against the master we approve. The approved master card becomes the reference.

## 5. Questions for the supplier

1. Can you hold 0.84 mm with your inlay and overlays? What is your tolerance? Would you recommend 0.76 mm instead?
2. Which chip and antenna size do you propose, where does the antenna sit, and which areas must foil and conductive inks avoid?
3. **The border:** where can a gap sit, how wide must it be, and is a non-conductive metallic ink a better choice? What is the measured effect on read range either way?
4. For each edition's foil layout, what is the measured effect on read range?
5. What is the minimum line width and spacing you can hold for each process?
   - emboss (Ivory's garland: leaves 2.8–5.0 mm, vein grooves up to 0.28 mm, stems 0.30 mm)
   - tactile UV varnish
   - laser etch (Titanium's flow lines: 0.24 mm, at least 0.68 mm apart)
   - hot foil (hairlines 0.16 mm; emblem strokes 0.35 mm)
   - fine text (our smallest is 4.9 pt uppercase, 1.25 mm cap height)
6. What relief depth can you achieve without cracking the overlay or affecting the inlay? Can a multi-level emboss die give the leaves a rounded profile?
7. Can soft-touch coating and hot foil be combined on the same face? In what order? Can foil and emboss be registered on the emblem?
8. For Titanium: how can a brushed metallic look be made non-conductive (metallic ink vs metallised film)?
9. How durable is edge paint (abrasion, chipping)? What is the cost per card?
10. How do you personalise variable data, and how do you verify that the NDEF URL, QR and serial match per card?
11. What are the lead times and minimum quantities for prototypes and for production, and the unit cost per edition?
12. Which certifications or test reports can you provide (ISO/IEC 7810, 10373-1, RoHS, REACH)?

## 6. Prototype tests (to run on finished cards)

None has been run yet. Record results per edition.

| # | Test | Pass criterion (proposed) |
|---|---|---|
| 1 | NFC read through the finished card, at least 10 phones (iPhone XS or later; Android from at least 4 makers), with the border as built | Opens the correct URL on every phone at 0–2 cm, at least 19 of 20 attempts each |
| 2 | QR scan with native camera apps: indoor 300–500 lux, outdoor shade, direct sun, 20–40 cm | First-attempt success of at least 95% |
| 3 | QR print grade (ISO/IEC 15415) | Grade B or better |
| 4 | Quiet zone and clear box measured | At least 4 modules; no decoration inside the box |
| 5 | Abrasion, 500 cycles (method agreed), then tests 1–2 again | Still passes 1–2; foil and relief legible |
| 6 | Flex and torsion (ISO/IEC 10373-1), then test 1 again | Passes 1; no delamination or cracking, including at the embossed garland |
| 7 | 7-day pocket and wallet carry, then tests 1–2 again | Passes 1–2 |
| 8 | UV and light fastness (agreed exposure) | No visible change to the approved master |
| 9 | Colour vs master, D50 | ΔE00 ≤ 2.0 |
| 10 | Thickness and dimensions, 20 cards | Within the agreed tolerance |
| 11 | Edge paint (if used): abrasion and chip | No exposed core after the agreed test |
| 12 | Per-card data check | Chip URL = QR URL = issue record, for every card |

## 7. What we will not accept

- Any decoration inside the QR clear box.
- A closed metal border, or foil or conductive ink over the antenna, without a passing read test.
- Changes to the SHYGON mark or wordmark (proportion, outline, effects other than one foil colour).
- Changes to the AAROH lotus emblem's construction once approved.
- Real customer data, live URLs or production serials on prototypes. Use the test URLs and serials we provide.

## 8. Open items on our side

- Approval of the AAROH lotus emblem as a brand asset, after a trademark clearance search (`DESIGN.md` §14).
- The production URL scheme for chips and QR codes, and the issue and activation flow (card release, DEC-2026-035 I-4).
- The serial format and its link to numbered chapters of 100 per edition.
- Final approval of the three editions and AAROH as set (`DESIGN.md` §14).
