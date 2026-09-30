import type { ThemePalette } from '../../lib/database.types';

/**
 * The twelve Tap palettes.
 *
 * Which of these a customer may actually choose is decided by the database
 * (`theme_options()`), not here: it is an entitlement question. This file only
 * says what each one looks like.
 *
 * All twelve are dark-first, because a Tap is opened on a stranger's phone,
 * usually held up in a room, and a dark card reads as the premium object the
 * physical card is. `ink` is the deepest ground, `haze` the mid tone the
 * gradient falls to, `accent` the brand colour and `spark` the highlight used
 * for edges, glows and the opening animation.
 */

export interface Palette {
  label: string;
  ink: string;
  haze: string;
  accent: string;
  spark: string;
  /** Text colour that meets contrast on `accent` when it is used as a fill. */
  onAccent: string;
}

export const PALETTES: Record<ThemePalette, Palette> = {
  // --- Included with every Tap ---------------------------------------------
  midnight: {
    label: 'Midnight',
    ink: '#04070f',
    haze: '#0d1a33',
    accent: '#d4af37',
    spark: '#7fd7ff',
    onAccent: '#0a0a0a',
  },
  graphite: {
    label: 'Graphite',
    ink: '#050505',
    haze: '#1c1f24',
    accent: '#c8ccd4',
    spark: '#8ea3bd',
    onAccent: '#0a0a0a',
  },
  royal: {
    label: 'Royal',
    ink: '#05041a',
    haze: '#1e1b52',
    accent: '#8f7bff',
    spark: '#5ad2ff',
    onAccent: '#08061c',
  },
  forest: {
    label: 'Forest',
    ink: '#020a08',
    haze: '#0d2b22',
    accent: '#4fd6a5',
    spark: '#b9f27c',
    onAccent: '#04140f',
  },

  // --- Business adds one ----------------------------------------------------
  sunset: {
    label: 'Sunset',
    ink: '#100407',
    haze: '#40151f',
    accent: '#ff8a5c',
    spark: '#ffd166',
    onAccent: '#1a0603',
  },

  // --- Premium adds three ---------------------------------------------------
  aurora: {
    label: 'Aurora',
    ink: '#02080f',
    haze: '#0b3040',
    accent: '#5ad2ff',
    spark: '#9cffd9',
    onAccent: '#02141c',
  },
  crimson: {
    label: 'Crimson',
    ink: '#0d0204',
    haze: '#3d0a17',
    accent: '#ff5470',
    spark: '#ffb3c1',
    onAccent: '#1a0308',
  },
  ivory: {
    label: 'Ivory',
    ink: '#0b0a08',
    haze: '#2b2721',
    accent: '#efe6d2',
    spark: '#d4af37',
    onAccent: '#141210',
  },

  // --- GOAT (and the Pass) unlock the rest ---------------------------------
  neon: {
    label: 'Neon',
    ink: '#03040a',
    haze: '#131044',
    accent: '#c04bff',
    spark: '#00f0ff',
    onAccent: '#0b0320',
  },
  molten: {
    label: 'Molten',
    ink: '#0a0402',
    haze: '#3a1405',
    accent: '#ff9f1c',
    spark: '#ff4d2d',
    onAccent: '#160702',
  },
  abyss: {
    label: 'Abyss',
    ink: '#000205',
    haze: '#04202e',
    accent: '#00d4c8',
    spark: '#7cf5ff',
    onAccent: '#001417',
  },
  prism: {
    label: 'Prism',
    ink: '#06040d',
    haze: '#241a4d',
    accent: '#ffd166',
    spark: '#ff6fb5',
    onAccent: '#140d05',
  },
};

export function paletteOf(id: string | null | undefined): Palette {
  return PALETTES[(id ?? 'midnight') as ThemePalette] ?? PALETTES.midnight;
}
