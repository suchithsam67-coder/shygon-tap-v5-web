import type { PublicProfile } from '../../lib/database.types';

/**
 * The AAROH modes: what a card can open, and whether each one really works.
 *
 * One registry for the public Tap's showroom, the demo showroom and the owner's
 * dashboard, so the three cannot disagree about what is available.
 *
 * Two vocabularies, kept apart on purpose:
 *   - `availability` is customer copy, in the owner's words (frontend gate
 *     decisions, 2026-10-20 §3): Available, Setup required, Coming soon,
 *     Unavailable, plus Demo for a labelled simulation. Nothing is called
 *     "Live": nothing V6 runs on production yet (AAROH-API §12).
 *   - Names and descriptions of Emergency Profile, Return to Owner and SHYGON
 *     Connect are the owner's approved wording (same decisions, §1); each stays
 *     "Coming soon" until it passes its own backend and end-to-end checks.
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

export type Availability = 'available' | 'setup' | 'coming-soon' | 'unsupported' | 'demo';

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available',
  setup: 'Setup required',
  'coming-soon': 'Coming soon',
  unsupported: 'Unavailable',
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
    name: 'Emergency Profile',
    tagline: 'Keep the emergency information you choose ready when it matters. You control what is stored and what may be shared.',
    // "Coming soon" until the backend flow, permissions, contact handling and
    // notification delivery are verified (owner, 2026-10-20).
    availability: 'coming-soon',
    backend: 'blocked',
    note: 'Not available yet. SHYGON never contacts emergency services: in an emergency, call 112.',
    demoWalkthrough: true,
  },
  return: {
    id: 'return',
    name: 'Return to Owner',
    tagline: 'Lost something with SHYGON? Let the finder contact you through a privacy-conscious relay, without automatically exposing your personal contact details.',
    // "Coming soon" until the real relay, owner notifications, abuse controls
    // and failure handling are verified (owner, 2026-10-20).
    availability: 'coming-soon',
    backend: 'blocked',
    note: 'Not available yet.',
  },
  connect: {
    id: 'connect',
    name: 'SHYGON Connect',
    tagline: 'Build meaningful connections and exchange the information you choose to share.',
    // "Coming soon" until the connection and consent workflows are verified (owner, 2026-10-20).
    availability: 'coming-soon',
    backend: 'blocked',
    note: 'Not available yet. Nothing is collected.',
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
 * The Privé demo, on, in the demo showroom only (owner, Q-F 2026-10-23: the
 * wording as drafted). Privé is demo-only (DEC-2026-038 Q6 → A, DEC-2026-040):
 * a sample hotel, never connected to a real hotel, booking, room or door, and
 * never on a real Tap, where only "available" modes appear (`liveModesFor`).
 */
export const PRIVE_DEMO = true;

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

/** The server-backed features that are switched on one at a time. */
export type ServerFeature = 'emergency' | 'return' | 'connect';

/**
 * Whether each server-backed feature is offered to customers: its owner page
 * linked from the account menu and from "Your AAROH experience". While a
 * feature is not released, customers see it as "Coming soon" (owner,
 * 2026-10-20 §1). Each is switched on separately, only once it has passed its
 * own backend and end-to-end checks. On a public Tap the server decides
 * independently (`public.status`, off everywhere today).
 */
export const RELEASED: Record<ServerFeature, boolean> = {
  emergency: false,
  return: false,
  connect: false,
};

/**
 * Whether this build keeps the owner pages of unreleased features reachable by
 * their address (owner, Q-C 2026-10-23). A production build does not: those
 * addresses redirect to "Your AAROH experience" until the feature is released.
 * A test or preview build does when it is built with
 * `VITE_AAROH_PREVIEW_PAGES=on`, and so does the dev server. The flag only
 * opens pages; every operation behind them is still the server's to allow.
 */
export const PREVIEW_PAGES: boolean = import.meta.env.VITE_AAROH_PREVIEW_PAGES === 'on' || import.meta.env.DEV;

export const OWNER_PAGE: Record<ServerFeature, string> = {
  emergency: '/shygontap/emergency',
  return: '/shygontap/return-to-owner',
  connect: '/shygontap/connections',
};

/** The id of a showroom card's open button, so focus can return to it. */
export function openButtonId(id: ModeId): string {
  return `sr-open-${id}`;
}
