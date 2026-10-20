import type { PublicProfile } from '../../lib/database.types';

/**
 * Small readers over the published profile, shared by the showroom cards and
 * the mode views. They only reformat what `get_public_profile()` returned;
 * nothing here can add a field the server did not send.
 */

export function hrefOf(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

export function subtitleOf(data: PublicProfile): string | null {
  return [data.designation, data.company].filter(Boolean).join(' · ') || data.headline || null;
}

/** Digits only, as wa.me wants them; null when there is no WhatsApp number. */
export function whatsappNumber(data: PublicProfile): string | null {
  const digits = data.whatsapp?.replace(/\D/g, '');
  return digits ? digits : null;
}

export function directionsHref(location: string | null | undefined): string | undefined {
  return location ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}` : undefined;
}

export interface ProfileLink {
  /** The analytics key, the same ones TapExperience records. */
  key: string;
  label: string;
  href: string | undefined;
}

/** Website, social profiles and custom links, in the order the profile card shows them. */
export function linkList(data: PublicProfile): ProfileLink[] {
  const links: (ProfileLink | false | null | '' | undefined)[] = [
    data.website && { key: 'website', label: 'Website', href: hrefOf(data.website) },
    data.instagram && { key: 'instagram', label: 'Instagram', href: hrefOf(data.instagram) },
    data.linkedin && { key: 'linkedin', label: 'LinkedIn', href: hrefOf(data.linkedin) },
    data.youtube && { key: 'youtube', label: 'YouTube', href: hrefOf(data.youtube) },
    // Keyed by the position in the owner's list, as TapExperience keys them.
    ...data.customLinks.map((link, i) => link.url?.trim() && { key: `link-${i}`, label: link.label || 'Link', href: hrefOf(link.url) }),
  ];
  return links.filter(Boolean) as ProfileLink[];
}
