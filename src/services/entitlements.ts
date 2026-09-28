import { supabase } from '../lib/supabase';
import {
  EXPERIENCE_ORDER,
  experienceRank,
  toExperience,
  type EntitlementRow,
  type Experience,
} from '../lib/database.types';

/**
 * What the customer actually owns, according to the database.
 *
 * This replaces `localStorage['shygon_customer_card_settings']`, whose
 * `lifetime` and `ownedPlans` fields previously decided whether paid
 * experiences were unlocked. Anyone could edit that in devtools. Nothing here
 * is writable from the browser: `entitlements` has a SELECT policy and no
 * INSERT or UPDATE policy at all, so rows can only be granted by the server
 * after a verified payment.
 *
 * The vocabulary note: since migration 004 a digital_plan entitlement's `key`
 * IS the experience id, so there is no plan-id-to-experience lookup table to
 * keep in sync any more.
 */

export interface Entitlements {
  /** Highest experience the customer may render. Always at least 'essential'. */
  maxExperience: Experience;
  /** Experiences they can select right now, always including 'essential'. */
  owned: Experience[];
  /** Customization keys they own, e.g. 'whatsapp', 'instagram'. */
  customizations: string[];
  /**
   * True when the ₹999 Customization Pass has been purchased.
   *
   * The Pass unlocks unlimited editing and every colour palette. It does NOT
   * grant Business, Premium or GOAT — those are bought separately, and a single
   * ₹999 payment must not give away the whole experience catalogue.
   */
  pass: boolean;
  /** Entitlement keys for physical cards they own. */
  cards: string[];
  raw: EntitlementRow[];
}

export const EMPTY_ENTITLEMENTS: Entitlements = {
  maxExperience: 'essential',
  owned: ['essential'],
  customizations: [],
  pass: false,
  cards: [],
  raw: [],
};

export function summarise(rows: EntitlementRow[]): Entitlements {
  const active = rows.filter((row) => row.is_active);

  // Essential ships with every Tap, so it is owned before anything is bought.
  const owned = new Set<Experience>(['essential']);
  const customizations = new Set<string>();
  const cards: string[] = [];
  let pass = false;

  for (const row of active) {
    switch (row.type) {
      case 'digital_plan':
        owned.add(toExperience(row.key));
        break;
      case 'customization':
        customizations.add(row.key);
        break;
      case 'card':
        cards.push(row.key);
        break;
      // The entitlement type is still called `lifetime` so every existing
      // grant, policy and admin RPC keeps working. What it buys changed.
      case 'lifetime':
        pass = true;
        break;
      default:
        break;
    }
  }

  // Deliberately NOT unlocking every experience here: the Pass buys editing
  // freedom and palettes, not the experience catalogue.

  let maxExperience: Experience = 'essential';
  for (const experience of owned) {
    if (experienceRank(experience) > experienceRank(maxExperience)) maxExperience = experience;
  }

  return {
    maxExperience,
    owned: EXPERIENCE_ORDER.filter((experience) => owned.has(experience)),
    customizations: [...customizations],
    pass,
    cards,
    raw: active,
  };
}

export async function fetchEntitlements(userId: string): Promise<Entitlements> {
  const { data, error } = await supabase
    .from('entitlements')
    .select('id, user_id, type, key, source_order_id, is_active, granted_at')
    .eq('user_id', userId);

  if (error) throw error;
  return summarise((data ?? []) as unknown as EntitlementRow[]);
}

export function ownsExperience(entitlements: Entitlements, experience: Experience): boolean {
  return experienceRank(entitlements.maxExperience) >= experienceRank(experience);
}

/**
 * How an experience should read on a card. Answers the question a customer
 * asks when a tile is greyed out: "why can't I pick this?"
 */
export type EntitlementState = 'included' | 'active' | 'purchased' | 'available' | 'locked';

export function entitlementState(
  entitlements: Entitlements,
  experience: Experience,
  selected: Experience | null | undefined,
): EntitlementState {
  const owns = ownsExperience(entitlements, experience);
  if (owns && toExperience(selected) === experience) return 'active';
  if (owns) return experience === 'essential' ? 'included' : 'purchased';
  // Not owned. "Available" reads better than "locked" for the next step up —
  // it is one purchase away, not gated behind something unobtainable.
  return experienceRank(experience) === experienceRank(entitlements.maxExperience) + 1
    ? 'available'
    : 'locked';
}

export const ENTITLEMENT_STATE_LABELS: Record<EntitlementState, string> = {
  active: 'Active now',
  included: 'Included',
  purchased: 'Purchased',
  available: 'Available',
  locked: 'Locked',
};
