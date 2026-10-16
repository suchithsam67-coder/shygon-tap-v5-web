import { products, type ProductId } from './shygonTapData'

/**
 * SHYGON Version 1 — AAROH (DEC-2026-036; DEC-2026-037, 2026-10-13/14).
 *
 * The store sells two products side by side: SHYGON TAP V5, the simple
 * tap-to-open card (src/data/shygonTapData.ts), and AAROH, the premium card
 * family described here.
 *
 * AAROH is one product: a physical NFC card, a QR fallback and the SHYGON
 * digital profile the card opens. It comes in the ten editions of the AAROH
 * design system ("SHYGON AAROH Design System", E01–E10) and two finishes,
 * which are variations of the same card, not separate products: the same
 * chip, QR, layout and platform, a different surface. Individuals buy it; an
 * organisation can order the same card in bulk through an enquiry.
 *
 * Every edition's words are the design system's own: the one-line description,
 * swatches and finish line from the collection moodboard, and the concept,
 * texture and finish notes from its edition sheet (checked by
 * supabase/tests/aaroh-catalog.mjs against the canvas sources), with only the
 * changes in AAROH_TEXT_CHANGES. Each edition's interface theme is the design
 * system's digital profile theme for it (project/Profile.dc.html), and its
 * motion follows the theme's loader. The images are landscape concept renders
 * of the cards as they will be printed (design-assets/src/editions.mjs), with
 * the official SHYGON logo.
 *
 * Catalogue rows come from migration 027: Standard (Tier A) ₹999 and Premium
 * Finish (Tier B) ₹1,499, the owner's proposed launch prices. The prices here
 * are display fallbacks only: the products table wins, and the server prices
 * every order again at checkout.
 */

export type AarohEditionId =
  | 'obsidian'
  | 'aureate'
  | 'monolith'
  | 'ivory-veil'
  | 'cobalt'
  | 'emerald-cipher'
  | 'prism'
  | 'carbon-weave'
  | 'heritage-geometry'
  | 'liquid-form'
export type AarohFinishId = 'standard' | 'premium'

export interface AarohFinish {
  id: AarohFinishId
  title: string
  /** The design system's tier. */
  tier: 'A' | 'B'
  /** A few words: what the finish is. */
  summary: string
  description: string
  /** Display fallback in rupees; products.price_in_paise wins. */
  price: number
}

export interface AarohEdition {
  id: AarohEditionId
  /** The edition number printed on the card ("01" on Obsidian). */
  number: string
  /** The edition code in the serial format (AR1-OB-…). */
  code: string
  title: string
  /** One line, from the collection moodboard. */
  character: string
  /** The edition's concept, from its edition sheet. */
  description: string
  /** The Premium Finish's surfaces, from the collection moodboard. */
  finishLine: string
  /** Edition sheet: the printed texture (artwork). */
  printed: string
  /** Edition sheet: the physical finish (process), which is the Premium Finish. */
  physical: string
  /** Edition sheet: how the Standard print simplifies it. */
  simplify: string
  surface: string
  edge: string
  /** The collection moodboard's swatches. */
  colours: readonly string[]
  /** The design system's digital profile theme for this edition. */
  theme: AarohTheme
  /** Motion: the theme's loader, and the stagger and curve it implies. */
  motion: AarohMotion
  /** The light the card is shown in on the store: colour and strength (0–1). */
  ambient: { glow: string; strength: number }
}

/** A digital theme: one layout, one set of components, these tokens per edition. */
export interface AarohTheme {
  ground: string
  /** The top of the header gradient. */
  ground2: string
  surface: string
  line: string
  text: string
  muted: string
  accent: string
  button: string
  buttonText: string
  /** Corner radius, px. */
  radius: number
  /** A light theme (dark text on a light ground). */
  light: boolean
  /** A header gradient that replaces ground2 → ground (Prism). */
  hero?: string
}

export interface AarohMotion {
  /** The design system's loader description. */
  loader: string
  /** Delay between staggered elements, ms. */
  stagger: number
  /** The easing curve. */
  ease: string
}

/**
 * Where the store's words differ from the design system's, and why. Checked by
 * supabase/tests/aaroh-catalog.mjs, which undoes these before comparing.
 *   - the lotus was a proposal; on 2026-10-14 the owner chose the official
 *     SHYGON logo for every card;
 *   - three counts did not match the drawn artwork.
 */
export const AAROH_TEXT_CHANGES: readonly (readonly [store: string, designSystem: string])[] = [
  ['the SHYGON mark', 'the lotus'],
  ['thirty-four concentric rings', 'forty concentric rings'],
  ['seven concrete slabs', 'nine concrete slabs'],
  ['Drapery ripples cross the card', 'Twenty-seven drapery ripples cross the card'],
]

/** Pixel sizes of the renders: the card in landscape, 85.60 × 53.98 mm. */
export const AAROH_IMAGE_SIZE = { width: 1200, height: 757 } as const
export const AAROH_IMAGE_SIZE_SMALL = { width: 600, height: 378 } as const

export const AAROH = {
  family: 'AAROH',
  version: 'Version 01',
  name: 'SHYGON AAROH, Version 01',
  headline: 'One card. Ten editions.',
  lede:
    'AAROH by SHYGON brings a physical smart card and your SHYGON digital profile together. Someone taps the card with a compatible phone, or scans its QR code, and your profile opens in their browser.',
  /** The collection moodboard's introduction. */
  collection:
    'Landscape, lit like an object on a table: real texture, relief you can feel and one metal per edition. The official SHYGON logo and the wide-set AAROH stay the same on every card.',
} as const

/** The design system's two tiers. Materials and processes are being validated with the manufacturer. */
export const AAROH_FINISHES: readonly AarohFinish[] = [
  {
    id: 'standard',
    title: 'Standard',
    tier: 'A',
    summary: 'Tier A · standard print',
    description: 'Same artwork with no relief, foil or edge paint: metals print as ink and the texture is printed, not felt.',
    price: 999,
  },
  {
    id: 'premium',
    title: 'Premium Finish',
    tier: 'B',
    summary: 'Tier B · relief, foil, edge',
    description:
      'The edition’s physical finish: relief you can feel, its metal in foil and a painted edge, as each edition specifies. The processes are being validated with our card manufacturer.',
    price: 1499,
  },
]

export const AAROH_EDITIONS: readonly AarohEdition[] = [
  {
    id: 'obsidian',
    number: '01',
    code: 'OB',
    title: 'Obsidian',
    character: 'Textured black, a raised ogee lattice, champagne arches.',
    description:
      'The signature edition. Textured black with a raised tone-on-tone ogee lattice — the Mughal onion arch, repeated — and five champagne arches rising from the foot of the card. Luxury by restraint.',
    finishLine: 'Soft-touch · UV · foil',
    printed: 'Leather-like grain, tonal ogee lattice at 0.38 mm with buds, five nested arches and a plinth line.',
    physical: 'Raised clear UV on the lattice over soft-touch matte; champagne hot foil on the SHYGON mark, AAROH and the arches; champagne edge paint.',
    simplify: 'Tier A prints the lattice tone-on-tone and the gold as CMYK ochre. The arches and the SHYGON mark carry the identity without any finish.',
    surface: 'Soft-touch (velvet) matte laminate',
    edge: 'Black core; champagne edge paint (Tier B, after abrasion test)',
    colours: ['#0E0E10', '#1F1F24', '#B8975A', '#E9D29B'],
    theme: { ground: '#0B0B0D', ground2: '#221E17', surface: '#17171B', line: 'rgba(236,236,238,0.12)', text: '#F1ECE2', muted: '#A9A397', accent: '#D9BF85', button: '#C9A863', buttonText: '#0B0B0D', radius: 14, light: false },
    motion: { loader: 'Gold draw, then fade', stagger: 60, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#D9BF85', strength: 0.16 },
  },
  {
    id: 'aureate',
    number: '02',
    code: 'AU',
    title: 'Aureate',
    character: 'Sunrise rings embossed in ivory, struck in champagne.',
    description:
      'Sunrise over warm ivory: thirty-four concentric rings and a fan of rays rise from beyond the bottom-right corner — aaroh, the ascent, drawn as light.',
    finishLine: 'Satin · emboss · foil',
    printed: 'Paper-fine grain, fine rings at 0.34 mm, every sixth ring heavy, 33 rays at 0.09 mm, a ringed sun at the foot.',
    physical: 'Blind emboss on the fine rings; champagne hot foil on the heavy rings, the sun, the SHYGON mark and AAROH; gold edge paint.',
    simplify: 'Tier A prints every line in champagne ink. The sunrise still reads; it loses only the glint.',
    surface: 'Satin laminate',
    edge: 'White core, or gold edge paint',
    colours: ['#F1E8D6', '#E2D4B8', '#B08C4E', '#EBD7A4'],
    theme: { ground: '#F6F1E6', ground2: '#E8DCC2', surface: '#FFFDF8', line: 'rgba(58,46,31,0.14)', text: '#2A2219', muted: '#6B5C45', accent: '#7D5E27', button: '#B8975A', buttonText: '#2A2219', radius: 14, light: true },
    motion: { loader: 'Rise from the corner', stagger: 80, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#FFF1CF', strength: 0.55 },
  },
  {
    id: 'monolith',
    number: '03',
    code: 'MO',
    title: 'Monolith',
    character: 'Concrete slabs standing on a 2.5 mm grid.',
    description:
      'Architecture at card scale: seven concrete slabs of different heights stand on a plinth, measured against a 2.5 mm grid. Industrial calm, no metal at all.',
    finishLine: 'Matte · raised UV',
    printed: 'Concrete grain, 0.05 mm grid, two slab tones, side shadows and form-tie holes.',
    physical: 'Raised tactile UV on the slab tops and the plinth line — you can feel the skyline.',
    simplify: 'Tier A drops the raised UV; slab tops print as lighter lines. Nothing in the identity depends on the finish.',
    surface: 'Matte laminate',
    edge: 'Grey or black core',
    colours: ['#36373A', '#404145', '#2D2E31', '#E7E3DB'],
    theme: { ground: '#1F2022', ground2: '#36373B', surface: '#2A2B2E', line: 'rgba(231,227,219,0.14)', text: '#EDEAE4', muted: '#AAA6A0', accent: '#E7E3DB', button: '#E7E3DB', buttonText: '#1F2022', radius: 4, light: false },
    motion: { loader: 'Step up, linear', stagger: 50, ease: 'linear' },
    ambient: { glow: '#E7E3DB', strength: 0.08 },
  },
  {
    id: 'ivory-veil',
    number: '04',
    code: 'IV',
    title: 'Ivory Veil',
    character: 'Drapery ripples in blind emboss — felt more than seen.',
    description:
      'A veil of warm white. Drapery ripples cross the card — clear under raking light, almost gone head-on. The quietest edition.',
    finishLine: 'Pearl satin · emboss',
    printed: 'Shadow lines at 0.20 mm and tonal folds in porcelain and stone tints.',
    physical: 'Blind emboss of the ripples. The highlight side exists only as real relief — it cannot be printed.',
    simplify: 'Tier A prints the shadow lines only. Still the veil, but flatter — this edition loses most without its finish.',
    surface: 'Pearl-satin laminate',
    edge: 'White core',
    colours: ['#F6F1E8', '#F2ECE1', '#B3A385', '#A89068'],
    theme: { ground: '#FBF9F5', ground2: '#EEE8DD', surface: '#FFFFFF', line: 'rgba(60,50,40,0.12)', text: '#24211C', muted: '#6C6357', accent: '#6C6357', button: '#3F3933', buttonText: '#FBF9F5', radius: 22, light: true },
    motion: { loader: 'Slow ripple', stagger: 120, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#FFFFFF', strength: 0.6 },
  },
  {
    id: 'cobalt',
    number: '05',
    code: 'CB',
    title: 'Cobalt',
    character: 'Brushed midnight, a halftone wave, a silver rule.',
    description:
      'A precision instrument in midnight blue: a halftone wave rides one calibrated line under a ruled scale. Technology shown as measurement, not science fiction.',
    finishLine: 'Satin · UV dots · foil',
    printed: 'A brushed-metal effect across the face; three dot sizes (0.17 / 0.30 / 0.44 mm) riding a calibrated wave; 0.07 mm ruler ticks down the right edge.',
    physical: 'Raised UV on the densest dots; silver foil on the SHYGON mark, AAROH and crosshairs; silver edge paint. The brushing stays printed — no metallised film.',
    simplify: 'Tier A runs the dots in CMYK blue. The wave and ruler carry the identity even when the blue is less electric.',
    surface: 'Satin laminate',
    edge: 'Blue core; silver edge paint (Tier B)',
    colours: ['#0C1E4A', '#3F73FA', '#7AA6FF', '#D3DCEB'],
    theme: { ground: '#08142F', ground2: '#13306F', surface: '#0F1F45', line: 'rgba(160,190,255,0.16)', text: '#E9F0FF', muted: '#9DB1D6', accent: '#7FA9FF', button: '#2A5FE8', buttonText: '#FFFFFF', radius: 10, light: false },
    motion: { loader: 'Resolve along the wave', stagger: 50, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#7FA9FF', strength: 0.2 },
  },
  {
    id: 'emerald-cipher',
    number: '06',
    code: 'EC',
    title: 'Emerald Cipher',
    character: 'A Truchet maze with one brass thread through it.',
    description:
      'A cipher in deep forest green: a Truchet maze of quarter-arcs, and one brass thread you can follow from edge to edge — the message hidden in the pattern.',
    finishLine: 'Matte · raised UV · foil',
    printed: 'Tonal maze at 0.34 mm on a 3.0 mm tile, checker tint, a dark halo under the thread.',
    physical: 'Brass hot foil on the thread and the mark; the maze stays tonal.',
    simplify: 'Tier A prints the thread in brass ink. The thread is a shape, not a shine, so the idea survives whole.',
    surface: 'Matte laminate',
    edge: 'Green or black core',
    colours: ['#0F2A21', '#1D4636', '#B59B62', '#E4D8B8'],
    theme: { ground: '#0C211A', ground2: '#184331', surface: '#143027', line: 'rgba(228,216,184,0.14)', text: '#EEF2EC', muted: '#A9B5AE', accent: '#D2BC84', button: '#C9B37A', buttonText: '#0C211A', radius: 12, light: false },
    motion: { loader: 'Thread draw', stagger: 70, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#D2BC84', strength: 0.14 },
  },
  {
    id: 'prism',
    number: '07',
    code: 'PR',
    title: 'Prism',
    character: 'Controlled iridescence behind a lenticular screen.',
    description:
      'Controlled iridescence: a lilac–ice–mint–peach field behind a fine lenticular screen, cut by one precise diagonal. Colour as light, kept to one side of the card.',
    finishLine: 'Gloss · line UV',
    printed: 'Two overlapping gradient fields, a 0.6 mm white line screen, graphite rules.',
    physical: 'Clear line UV over gloss laminate — a lenticular shift as the card tilts.',
    simplify: 'Tier A is the printed gradient on gloss — already most of the effect.',
    surface: 'Gloss laminate',
    edge: 'White core',
    colours: ['#ECEBF1', '#CBB8FF', '#A6E1F5', '#FFD2B5'],
    theme: { ground: '#F4F3F8', ground2: '#E4DDF6', surface: '#FFFFFF', line: 'rgba(44,43,51,0.12)', text: '#1E1D24', muted: '#5E5C68', accent: '#5B4BC4', button: '#2C2B33', buttonText: '#FFFFFF', radius: 16, light: true, hero: 'linear-gradient(160deg, #E3D8FF 0%, #D3EFF8 45%, #FCE3D6 75%, #F4F3F8 100%)' },
    motion: { loader: 'Gradient pass', stagger: 80, ease: 'cubic-bezier(0.3, 0.7, 0.2, 1)' },
    ambient: { glow: '#CBB8FF', strength: 0.5 },
  },
  {
    id: 'carbon-weave',
    number: '08',
    code: 'CW',
    title: 'Carbon Weave',
    character: '2 × 2 twill in matte black, one vermilion line.',
    description:
      'Performance surface: 2 × 2 twill in matte black and one vermilion line. The look of a composite, made entirely of ink.',
    finishLine: 'Matte · tactile varnish',
    printed: 'Twill tows on a 1.5 mm cell with a repeating sheen; double vermilion rule.',
    physical: 'Fine tactile (sand) varnish over the weave so it feels technical.',
    simplify: 'Tier A is the printed weave. Real carbon fibre is never used — it is conductive and blocks NFC.',
    surface: 'Matte laminate',
    edge: 'Black core; optional red edge paint',
    colours: ['#141516', '#2C2E31', '#E5482F', '#C9CBCE'],
    theme: { ground: '#0F1011', ground2: '#202124', surface: '#1A1B1D', line: 'rgba(255,255,255,0.1)', text: '#F1F2F3', muted: '#A0A3A8', accent: '#FF6A4D', button: '#C93A24', buttonText: '#FFFFFF', radius: 8, light: false },
    motion: { loader: 'Snap', stagger: 40, ease: 'cubic-bezier(0.5, 0, 0, 1)' },
    ambient: { glow: '#FF6A4D', strength: 0.08 },
  },
  {
    id: 'heritage-geometry',
    number: '09',
    code: 'HG',
    title: 'Heritage Geometry',
    character: 'A debossed octagon jaali on laterite, gold at every diamond.',
    description:
      'An original jaali in lime plaster on laterite: octagons and diamonds (the 4.8.8 tiling), each octagon holding an eight-petal rosette, gold at every diamond. Indian architecture as geometry, not ornament.',
    finishLine: 'Matte · deboss · foil',
    printed: 'Octagon lattice 0.15 mm, inner ring 0.07 mm, rosettes 0.10 mm, deep-laterite diamonds.',
    physical: 'Deboss the octagon lattice; gold foil on the 0.9 mm diamonds and the mark.',
    simplify: 'Tier A prints the lattice and the diamonds in ochre ink. The geometry carries the identity.',
    surface: 'Matte laminate',
    edge: 'Terracotta or cream edge paint',
    colours: ['#7A3323', '#5C2417', '#EAD8B8', '#C9A35E'],
    theme: { ground: '#F5EBDD', ground2: '#E2C6A3', surface: '#FFF8EE', line: 'rgba(74,29,19,0.14)', text: '#2B160F', muted: '#6E4A3B', accent: '#8E3B26', button: '#7A3323', buttonText: '#FFF4E4', radius: 12, light: true },
    motion: { loader: 'Baoli steps', stagger: 90, ease: 'cubic-bezier(0.2, 0.75, 0.25, 1)' },
    ambient: { glow: '#F4D9B0', strength: 0.45 },
  },
  {
    id: 'liquid-form',
    number: '10',
    code: 'LF',
    title: 'Liquid Form',
    character: 'Poured layers of plum, edged in copper.',
    description:
      'Sculpture in motion: four poured layers of plum flow diagonally across the card, each edged in copper and traced by fine tonal contours.',
    finishLine: 'Soft-touch · copper foil',
    printed: 'Four gradient layers, 0.07 mm contour lines, copper edges at 0.17 mm.',
    physical: 'Copper (rose-gold) hot foil on the four flow edges, over soft-touch laminate.',
    simplify: 'Tier A prints the edges in copper ink. The layered flow stays intact.',
    surface: 'Soft-touch matte laminate',
    edge: 'Plum or black core',
    colours: ['#26122D', '#46255D', '#724486', '#D49A7A'],
    theme: { ground: '#1C0F22', ground2: '#3D2150', surface: '#2A1730', line: 'rgba(243,228,238,0.12)', text: '#F6ECF4', muted: '#BBA3B8', accent: '#E3A98A', button: '#E3A98A', buttonText: '#1C0F22', radius: 22, light: false },
    motion: { loader: 'Liquid ease-out', stagger: 90, ease: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    ambient: { glow: '#E3A98A', strength: 0.16 },
  },
]

export const AAROH_STORE_PATH = '/shygontap/store'
/** The AAROH product page. */
export const AAROH_PRODUCT_PATH = '/shygontap/store/aaroh'

export const designPath = (edition: AarohEdition) => `${AAROH_PRODUCT_PATH}?design=${edition.id}`

export function editionById(id: string | null | undefined): AarohEdition | undefined {
  return AAROH_EDITIONS.find((edition) => edition.id === id)
}

export function finishById(id: string | null | undefined): AarohFinish | undefined {
  return AAROH_FINISHES.find((finish) => finish.id === id)
}

/** The catalogue SKU of an edition in a finish (migration 027). */
export const aarohSku = (edition: AarohEdition, finish: AarohFinishId) => `card-aaroh-${edition.id}-${finish}`

/** The product id create-order and the pending order use for an AAROH card. */
export const aarohProductId = (edition: AarohEdition) => `aaroh-${edition.id}`

/** Landscape concept renders (design-assets/src/editions.mjs): see AAROH_IMAGE_SIZE. */
export function aarohImages(edition: AarohEdition, finish: AarohFinishId) {
  const base = `/assets/aaroh/${edition.id}-${finish}`
  return {
    front: `${base}-front.webp`,
    back: `${base}-back.webp`,
    frontSmall: `${base}-front-600.webp`,
    backSmall: `${base}-back-600.webp`,
  }
}

/** A responsive srcset for one face. */
export const aarohSrcSet = (large: string, small: string) =>
  `${small} ${AAROH_IMAGE_SIZE_SMALL.width}w, ${large} ${AAROH_IMAGE_SIZE.width}w`

/** The edition's theme as CSS custom properties, for a themed container. */
export function aarohThemeStyle(edition: AarohEdition): Record<string, string> {
  const t = edition.theme
  return {
    '--ed-ground': t.ground,
    '--ed-ground2': t.ground2,
    '--ed-surface': t.surface,
    '--ed-line': t.line,
    '--ed-text': t.text,
    '--ed-muted': t.muted,
    '--ed-accent': t.accent,
    '--ed-button': t.button,
    '--ed-button-text': t.buttonText,
    '--ed-radius': `${t.radius}px`,
    '--ed-glow': edition.ambient.glow,
    '--ed-glow-strength': String(edition.ambient.strength),
    '--ed-ease': edition.motion.ease,
    '--ed-stagger': `${edition.motion.stagger}ms`,
    '--ed-hero': t.hero ?? `linear-gradient(180deg, ${t.ground2} 0%, ${t.ground} 100%)`,
  }
}

/** The finish shown first, in grids and in the design picker: the design system's premium mockup. */
export const AAROH_DEFAULT_FINISH: AarohFinishId = 'premium'

/** How many editions, in words, for copy. */
export const AAROH_EDITION_COUNT = 'ten'

/** Lowest and highest display price across the finishes, in rupees. */
export const AAROH_PRICE_RANGE = {
  from: Math.min(...AAROH_FINISHES.map((finish) => finish.price)),
  to: Math.max(...AAROH_FINISHES.map((finish) => finish.price)),
} as const

/**
 * Team and organisation orders: the same AAROH card, ordered in bulk through
 * an enquiry and priced by quotation. Never a separate product or subscription.
 */
export const AAROH_BULK_MINIMUM = 10

/** True for a SHYGON TAP V5 card id (the existing catalogue). */
export function isV5Card(productId: string | undefined): productId is ProductId {
  return products.some((product) => product.id === (productId as ProductId))
}
