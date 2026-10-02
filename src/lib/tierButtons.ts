import { EXPERIENCE_ORDER, experienceRank, toExperience, type Experience } from './database.types';

/**
 * Which contact buttons each digital experience includes — the single source
 * of truth on the website. The database has the same table in
 * public.tier_buttons() (migration 027), which is what actually decides what a
 * visitor sees; this copy only drives the editor, the store and checkout.
 *
 * Each tier includes everything below it. A button a tier does not include can
 * still be bought on its own as an add-on (Customizations).
 */
export const BUTTONS_ADDED_BY_TIER: Record<Experience, readonly string[]> = {
  essential: ['phone', 'email', 'whatsapp'],
  business: ['instagram', 'linkedin', 'website'],
  premium: ['location', 'youtube', 'links'],
  goat: ['gallery'],
};

export const BUTTON_LABELS: Record<string, string> = {
  phone: 'Call',
  email: 'Email',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  website: 'Website',
  location: 'Location & directions',
  youtube: 'YouTube',
  links: 'Custom links',
  gallery: 'Photo gallery',
};

export const TIER_LABELS: Record<Experience, string> = {
  essential: 'Essential',
  business: 'Business',
  premium: 'Premium',
  goat: 'GOAT',
};

/** Every button the tier includes (cumulative). */
export function buttonsFor(tier: string | null | undefined): string[] {
  const rank = experienceRank(tier);
  return EXPERIENCE_ORDER.filter((_, i) => i <= rank).flatMap((t) => [...BUTTONS_ADDED_BY_TIER[t]]);
}

/** The lowest tier that includes this button, or null if none does. */
export function tierIncluding(button: string): Experience | null {
  return EXPERIENCE_ORDER.find((t) => BUTTONS_ADDED_BY_TIER[t].includes(button)) ?? null;
}

/** Buttons usable on a page: what its tier includes plus add-ons bought separately. */
export function unlockedButtons(tier: string | null | undefined, ownedAddons: readonly string[]): Set<string> {
  return new Set([...buttonsFor(toExperience(tier)), ...ownedAddons]);
}

/** "WhatsApp, Instagram and LinkedIn". */
export function listButtons(keys: readonly string[]): string {
  const names = keys.map((k) => BUTTON_LABELS[k] ?? k);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
