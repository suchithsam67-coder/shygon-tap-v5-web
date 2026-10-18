# SHYGON AAROH Version 01: printer-ready artwork

`node design-assets/src/print.mjs [--qr-back]` writes the print package to
`design-assets/print/` (generated, about 170 MB, not committed). One folder per
edition, `AAROH-V01-E01-Obsidian` to `AAROH-V01-E10-LiquidForm`, each with:

| File | What it is |
|---|---|
| `AAROH-E01-front-A.pdf`, `-back-A.pdf` | Tier A, Standard print: CMYK only |
| `AAROH-E01-front-B.pdf`, `-back-B.pdf` | Tier B, Premium Finish: CMYK plus one named spot plate per finish |
| `masks/AAROH-E01-front-B-<PLATE>.pdf` | each Tier B plate alone, in 100% black |
| `JOB-SHEET.md` | format, plates, laminate, edge, CMYK swatches, variable data, quality control |
| `alt-qr-back/` | only with `--qr-back`: the alternative QR back, Tier A and B, with its masks |

`manifest.json` lists every file with its size and plates.

## How the files are built

The rules are the AAROH design system's own (PrintTemplate, Spec and Manufacturing artboards):
- **Size.** 1:1 in millimetres, landscape. Trim 85.60 × 53.98, corner 3.18, 3 mm bleed (page 91.60 × 59.98), 4 mm safe area. TrimBox and BleedBox are set.
- **Printed artwork, CMYK.** Base, printed grain and tone-on-tone art are a 600 ppi CMYK image. The official SHYGON logo, AAROH and every word are vector, with text as outlines.
- **Colour.** CMYK uses the design system's starting values for each edition's colours, and a conversion anchored on them for everything else. Total ink is held at 300%.
- **Finishes.** One spot plate per finish (`FOIL_CHAMPAGNE`, `FOIL_SILVER`, `FOIL_BRASS`, `FOIL_GOLD`, `FOIL_COPPER`, `RAISED_UV`, `SPOT_UV`, `EMBOSS`, `DEBOSS`, `TACTILE_VARNISH`):
  - 100% tint and overprint, never mixed into CMYK;
  - relief and foil stop 1 mm inside the die line, and the art's plates stay off the logo's calm zone;
  - widened to the minimums (0.15 mm foil, 0.20 mm relief).
- **Lighting.** None. Highlights, sheen and shadow are mockup-only.
- **Back: clean, no QR** (owner, 2026-10-18). The official lockup and the card data on the left, the edition's art on the right, and a quiet TAP TO OPEN cue on the last line. NFC is the experience; a tap opens the card's `/d/<card_code>`. The art is a tint, so it carries no finish; on Tier B only the logo is foiled.
- **Alternative: the QR back.** `node design-assets/src/print.mjs --qr-back` also writes it to `alt-qr-back/`, for use only if testing shows customers need a QR. Its QR sits on a smooth light plate and encodes the card's own permanent `https://shygontech.com/d/<card_code>`, the link the chip opens: never a temporary URL, never anything about the owner. The back then reads TAP OR SCAN, and the logo, tap glyph and TAP OR SCAN are foiled on Tier B.
- **Non-printing layers.** The die line (`DIELINE` spot) and, on the back, the variable-data guide (`VDP_GUIDE` spot) sit on layers marked not to print.
- **Overprint preview.** Foil overprints, so it looks dark over black in a composite preview. Check the plates in the separations, or in `masks/`.

**Not claimed:**
- PDF/X-4 compliance: no ICC output intent is embedded, so the printer's profile applies;
- the coil and chip positions: take them from the inlay maker's drawing.

The PDFs were checked in Microsoft Edge's built-in Acrobat viewer. Before any run, they still need the printer's preflight, a hard proof, a coil-drawing check and NFC read tests.

## Serial numbers and the card registry (owner decision, 2026-10-16)

Cards are made as pre-numbered stock and tracked in a registry. Each physical card has four separate values:

| Field | Purpose |
|---|---|
| `serial_number` | the human-readable number printed on the card: reference only, never a secret |
| `card_code` | the opaque code on the chip (and in the QR, on the QR back only): `https://shygontech.com/d/<card_code>` |
| `chip_uid` | the chip's identifier, recorded at controlled provisioning, never printed |
| `order_id` | the order the card is assigned to, by the backend only |
| `status` | inventory, reserved, active, suspended or revoked |

The printer's data file has one row per card: `serial_number, chapter, card_code`.

Before dispatch, check three things for every card:
- the printed serial;
- where a tap opens;
- the backend assignment.

On the QR back, also check that the QR opens the same `/d/<card_code>` as a tap.

**Gap: the schema doesn't support this yet** (found 2026-10-16; nothing changed). `public.cards` (migration 002, plus 017) is customer-owned:
- every row needs a `user_id`;
- there is no `card_code`;
- edition serials are given out when an order is fulfilled.

Pre-numbered stock needs an inventory state, a `card_code`, and a serial fixed at manufacture. That registry has to be designed around the existing card lifecycle and approved before any schema change.
