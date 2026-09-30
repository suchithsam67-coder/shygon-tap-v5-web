import type { CardLook, Experience } from '../../lib/database.types';

/**
 * Which opening a tapped card plays — one per card design, so the card in
 * the visitor's hand is what opens the page: Obsidian Feather sweeps a feather
 * of light across, Copper Lotus blooms, Emerald Arch opens its doors, Ivory
 * Bloom scatters review stars, and so on.
 *
 * The design comes from the card itself (get_public_card, migration 019), so
 * it is decided by the physical card and not by anything the page owner or a
 * visitor can change. The customer's own "no opening animation" setting and
 * the visitor's reduced-motion setting both still switch it off.
 *
 * Kept free of components so CardOpening.tsx exports only a component and
 * React Fast Refresh can hot-update it.
 */

export type CardMotif =
  | 'feather'
  | 'lotus'
  | 'arch'
  | 'bloom'
  | 'smoke'
  | 'marble'
  | 'pinstripe'
  | 'jaali'
  | 'constellation'
  | 'aurora'
  | 'canvas';

interface Opening {
  motif: CardMotif;
  /** Backdrop, accent and glow for the opening, taken from the card's own art. */
  bg: string;
  accent: string;
  glow: string;
}

const OPENINGS: Record<string, Opening> = {
  business: { motif: 'feather', bg: '#0b0b0c', accent: '#d4ab66', glow: '#f3d9a0' },
  restaurant: { motif: 'lotus', bg: '#3a160a', accent: '#e3a47a', glow: '#f8e6d8' },
  event: { motif: 'arch', bg: '#062219', accent: '#d4ab66', glow: '#9fdcc0' },
  'google-review': { motif: 'bloom', bg: '#f3ede2', accent: '#9a7437', glow: '#f6c945' },
  'obsidian-smoke': { motif: 'smoke', bg: '#060607', accent: '#e5c37e', glow: '#9d978d' },
  'rose-marble': { motif: 'marble', bg: '#2c2426', accent: '#e2aeb0', glow: '#f6d3d2' },
  'carbon-aurum': { motif: 'pinstripe', bg: '#09090b', accent: '#e5c37e', glow: '#fff1c9' },
  'sandstone-jaali': { motif: 'jaali', bg: '#5a3a18', accent: '#f3d99b', glow: '#fff4e0' },
  'sapphire-night': { motif: 'constellation', bg: '#050b1e', accent: '#e5c37e', glow: '#cfe0ff' },
  'aurora-glass': { motif: 'aurora', bg: '#05060c', accent: '#9ff0e6', glow: '#b3a4ff' },
  custom: { motif: 'canvas', bg: '#0c0c0e', accent: '#e5c37e', glow: '#ffffff' },
};

const FALLBACK: Opening = OPENINGS.business!;

export function openingFor(look: CardLook): Opening {
  return OPENINGS[look.design] ?? FALLBACK;
}

/**
 * The experience decides how rich the opening is — the price of the digital
 * UI buys the quality of the moment:
 *
 *   Essential  a quick, clean arrival of the card and one NFC pulse
 *   Business   + the card design's signature move
 *   Premium    + a light sweep across the card and a deeper glow
 *   GOAT       + a full 3D turn of the card, halo rings and sparks
 */
export const CARD_OPENING_MS: Record<Experience, number> = {
  essential: 1100,
  business: 1500,
  premium: 1800,
  goat: 2300,
};

/** The card's own art, the same file the store shows. */
export function cardArtUrl(look: CardLook): string {
  const material = look.material === 'metal' || look.material === 'transparent' ? look.material : 'pvc';
  return `/assets/cards/${look.design}-${material}${look.finish === 'premium' ? '-premium' : ''}.svg`;
}

/** card-<design>-<finish>-<material> -> its look, or null for anything else. */
export function cardLookOf(sku: string | null | undefined): CardLook | null {
  const match = /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(sku ?? '');
  return match ? { design: match[1]!, finish: match[2]!, material: match[3]! } : null;
}
