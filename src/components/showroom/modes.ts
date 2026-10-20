import type { PublicProfile } from '../../lib/database.types';

/**
 * The AAROH modes: what a card can open, and whether each one really works.
 *
 * One registry for the public Tap's showroom, the demo showroom and the owner's
 * dashboard, so the three cannot disagree about what is available.
 *
 * Two vocabularies, kept apart on purpose:
 *   - `availability` is customer copy, the owner-approved words (master brief
 *     2026-10-19 §10): Available, Available after setup, Plan-gated, Coming
 *     soon, Unsupported, plus Demo for a labelled simulation. Nothing is
 *     called "Live": nothing V6 runs on production yet (AAROH-API v0.1 §12).
 *   - `backend` is the engineering status from Session A's contract, for the
 *     integration map and the reports only, never shown to a visitor.
 *
 * There is no per-mode table in the backend (contract §6). A mode therefore
 * appears on a real Tap exactly when the owner has published the fields it
 * shows. The server already clamps those fields to what the owner chose and
 * owns (`get_public_profile`), so nothing here decides visibility on its own
 * (FE-D8). Emergency and Return to owner are the exceptions: each appears only
 * when its server's `public.status` says it is available for this Tap.
 */

export type Availability = 'available' | 'setup' | 'plan' | 'coming-soon' | 'unsupported' | 'demo';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available',
  setup: 'Available after setup',
  plan: 'Plan-gated',
  'coming-soon': 'Coming soon',
  unsupported: 'Unsupported',
  demo: 'Demo',
};

/** Session A's engineering labels (contract §12). Reports only. */
export type BackendStatus = 'live-local' | 'blocked' | 'not-implemented' | 'none';

export type ModeId =
  | 'identity'
  | 'business'
  | 'contact'
  | 'links'
  | 'owner'
  | 'emergency'
  | 'return'
  | 'connect'
  | 'student'
  | 'events'
  | 'places'
  | 'cloud'
  | 'prive'
  | 'verify'
  | 'access';

export interface ModeDefinition {
  id: ModeId;
  name: string;
  /** One line under the name on the card. */
  tagline: string;
  /** What a customer is told, today. */
  availability: Availability;
  backend: BackendStatus;
  /** For anything not available: what is missing, in words a visitor can read. */
  note?: string;
  /** What the owner does to make an available mode appear on their Tap. */
  ownerHint?: string;
  /** The demo showroom has a labelled walkthrough for it, which sends nothing. */
  demoWalkthrough?: boolean;
}

export const MODES: Record<ModeId, ModeDefinition> = {
  identity: {
    id: 'identity',
    name: 'Profile',
    tagline: 'Who they are, in their own words.',
    availability: 'available',
    backend: 'live-local',
    ownerHint: 'Always shown while your Tap is published.',
  },
  business: {
    id: 'business',
    name: 'Business',
    tagline: 'Role, company and where to find them.',
    availability: 'available',
    backend: 'live-local',
    ownerHint: 'Shown when you publish your role or company.',
  },
  contact: {
    id: 'contact',
    name: 'Contact',
    tagline: 'Call, message or email in one tap.',
    availability: 'available',
    backend: 'live-local',
    ownerHint: 'Shown when you switch on your phone, WhatsApp or email.',
  },
  links: {
    id: 'links',
    name: 'Links',
    tagline: 'Website, social profiles and more.',
    availability: 'available',
    backend: 'live-local',
    ownerHint: 'Shown when you publish a website, a social profile or a custom link.',
  },
  owner: {
    id: 'owner',
    name: 'Owner access',
    tagline: 'Only the owner can change this card.',
    availability: 'available',
    backend: 'live-local',
    ownerHint: 'Always shown. It leads to the normal sign-in, never past it.',
  },
  emergency: {
    id: 'emergency',
    name: 'Emergency',
    tagline: 'Alert the owner’s emergency contacts.',
    // Customer copy stays "Coming soon" until the owner decides DEC-2026-038 Q10.
    availability: 'coming-soon',
    backend: 'blocked',
    note: 'Not available on cards yet. SHYGON never contacts emergency services: in an emergency, call 112.',
    demoWalkthrough: true,
  },
  return: {
    id: 'return',
    name: 'Return to owner',
    tagline: 'Help a finder give a lost card back.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available yet and not included with a card. Its privacy rules will be published before any launch.',
  },
  connect: {
    id: 'connect',
    name: 'Connect',
    tagline: 'Share your details back, with consent.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available on cards yet. Nothing is collected.',
  },
  student: {
    id: 'student',
    name: 'Student Passport',
    tagline: 'Projects, skills and achievements.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available yet. It needs a student privacy review first.',
  },
  events: {
    id: 'events',
    name: 'Events',
    tagline: 'A profile for one event.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available yet. Ticketing and check-in are not part of AAROH.',
  },
  places: {
    id: 'places',
    name: 'Places and objects',
    tagline: 'Information attached to a place or a thing.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available yet.',
  },
  cloud: {
    id: 'cloud',
    name: 'Cloud storage',
    tagline: 'Private files, shared by choice.',
    availability: 'coming-soon',
    backend: 'not-implemented',
    note: 'Not available yet. Nothing is uploaded or stored.',
  },
  prive: {
    id: 'prive',
    name: 'SHYGON Privé',
    tagline: 'A hotel stay, opened by a card.',
    availability: 'demo',
    backend: 'none',
    note: 'A demonstration with a sample hotel. It is not connected to any real hotel, booking or room.',
    demoWalkthrough: true,
  },
  verify: {
    id: 'verify',
    name: 'Verify',
    tagline: 'Credentials checked at their source.',
    availability: 'unsupported',
    backend: 'not-implemented',
    note: 'An AAROH card is not a credential, and a tap does not prove who someone is.',
  },
  access: {
    id: 'access',
    name: 'Access',
    tagline: 'Doors, gates and entry.',
    availability: 'unsupported',
    backend: 'not-implemented',
    note: 'An AAROH card is not an access or attendance card.',
  },
};

/**
 * The Privé demo, off. Two owner instructions conflict (FE-D5): the master
 * brief of 2026-10-19 asks for a "demo-only Privé", while DEC-2026-038 Q6, as
 * recorded on 2026-10-19, keeps Privé out of the launch with no demo (the
 * 2026-10-16 decision). The demo is built and tested; turning this on shows it
 * in the demo showroom only, never on a real Tap. It stays off until the owner
 * says which instruction stands.
 */
export const PRIVE_DEMO = false;

/**
 * Showroom order: what works first, then what is coming, then what the demo
 * can only simulate, then what AAROH does not do.
 */
const ALL_MODES: readonly ModeId[] = [
  'identity',
  'business',
  'contact',
  'links',
  'owner',
  'emergency',
  'return',
  'connect',
  'student',
  'events',
  'places',
  'cloud',
  'prive',
  'verify',
  'access',
];

export const MODE_ORDER: readonly ModeId[] = ALL_MODES.filter((id) => id !== 'prive' || PRIVE_DEMO);

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

export function hasBusiness(profile: PublicProfile): boolean {
  return filled(profile.designation) || filled(profile.company);
}

export function hasContact(profile: PublicProfile): boolean {
  return filled(profile.phone) || filled(profile.whatsapp) || filled(profile.email);
}

export function hasLinks(profile: PublicProfile): boolean {
  return (
    filled(profile.website) ||
    filled(profile.instagram) ||
    filled(profile.linkedin) ||
    filled(profile.youtube) ||
    profile.customLinks.some((link) => filled(link.url))
  );
}

/** Whether an available mode has anything to show for this published profile. */
export function modeHasContent(id: ModeId, profile: PublicProfile): boolean {
  switch (id) {
    case 'identity':
    case 'owner':
      return true;
    case 'business':
      return hasBusiness(profile);
    case 'contact':
      return hasContact(profile);
    case 'links':
      return hasLinks(profile);
    default:
      return false;
  }
}

/**
 * The modes a real Tap shows: available ones with something published, plus
 * Emergency when the server says visitor alerts are available for this Tap.
 * Nothing coming, unsupported or simulated appears on a person's card (FE-D4).
 */
export function liveModesFor(profile: PublicProfile, extras: { emergency?: boolean; rescue?: boolean; connect?: boolean } = {}): ModeId[] {
  const modes = MODE_ORDER.filter((id) => MODES[id].availability === 'available' && modeHasContent(id, profile));
  // Server-switched modes go just before Owner access, in showroom order.
  if (extras.emergency) modes.splice(modes.indexOf('owner'), 0, 'emergency');
  if (extras.rescue) modes.splice(modes.indexOf('owner'), 0, 'return');
  if (extras.connect) modes.splice(modes.indexOf('owner'), 0, 'connect');
  return modes;
}

export function isModeId(value: string | null | undefined): value is ModeId {
  return Boolean(value && Object.prototype.hasOwnProperty.call(MODES, value));
}

/** The id of a showroom card's open button, so focus can return to it. */
export function openButtonId(id: ModeId): string {
  return `sr-open-${id}`;
}
