import type { Experience, ThemeAnimation } from '../../lib/database.types';

/**
 * Which experiences get an opening animation, and which one.
 *
 *   Essential   none — it is the fast, minimal experience
 *   Business    a professional wipe: the card arrives, nothing showy
 *   Premium     a cinematic light sweep with depth
 *   GOAT        a signature opening that reacts to the time of day
 *
 * This is the single place that decision is made, so the editor's preview and
 * the real public Tap cannot disagree about it.
 *
 * Kept in its own module (no components) so `ExperienceIntro.tsx` exports
 * nothing but a component and React Fast Refresh can hot-update it.
 */

export type IntroKind = 'none' | 'business' | 'premium' | 'goat';

/**
 * `animation` is the customer's own override from the customizer: `auto` keeps
 * the experience's default, `none` turns the opening off entirely (offered on
 * every tier — a customer who finds their own opening tiresome can always skip
 * it), and the named styles are only offered to tiers that unlock them.
 */
export function resolveIntro(
  experience: Experience,
  animation: ThemeAnimation = 'auto',
): IntroKind {
  if (animation === 'none') return 'none';
  if (animation === 'signature') return experience === 'goat' ? 'goat' : 'premium';
  if (animation === 'dynamic') return 'goat';

  switch (experience) {
    case 'essential':
      return 'none';
    case 'business':
      return 'business';
    case 'premium':
      return 'premium';
    case 'goat':
      return 'goat';
    default:
      return 'none';
  }
}

export function hasOpeningAnimation(
  experience: Experience,
  animation: ThemeAnimation = 'auto',
): boolean {
  return resolveIntro(experience, animation) !== 'none';
}

/** How long each opening runs before the card is revealed, in milliseconds. */
export const INTRO_DURATIONS: Record<Exclude<IntroKind, 'none'>, number> = {
  business: 1100,
  premium: 1650,
  goat: 2000,
};
