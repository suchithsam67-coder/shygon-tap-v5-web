/**
 * The Card details step (Buy Now → Card details → Delivery → Payment).
 *
 * What the customer types here rides along in the pending order
 * (`shygon_pending_order.profile`), is sent to create-order with the purchase,
 * kept on the order (orders.profile_details, migration 024) and copied into
 * the card's new page once the payment is verified. Plain contact details
 * only — never anything to do with payment.
 */
export interface CardProfileDetails {
  /** The name printed on the card and shown at the top of the page. */
  displayName: string;
  designation?: string;
  company?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  instagram?: string;
  linkedin?: string;
  website?: string;
  location?: string;
  youtube?: string;
}

export const PENDING_KEY = 'shygon_pending_order';
export const CARD_NAME_MAX = 26;

export interface PendingPhysical {
  orderType?: string;
  productId?: string;
  material?: string;
  tier?: string;
  planId?: string;
  replacesCardId?: string;
  profile?: CardProfileDetails;
  [key: string]: unknown;
}

export function readPendingOrder(): PendingPhysical | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingPhysical) : null;
  } catch {
    return null;
  }
}

export function savePendingProfile(profile: CardProfileDetails): void {
  const pending = readPendingOrder();
  if (!pending) return;
  localStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, profile }));
}

/** A physical, first-time card needs the details step; replacements reuse their page. */
export function needsCardDetails(pending: { orderType?: string; replacesCardId?: string } | null): boolean {
  return Boolean(pending && (pending.orderType ?? 'physical') === 'physical' && !pending.replacesCardId);
}

/** Where Buy Now goes: sign-in first when needed, then the Card details step. */
export function buyNowDestination(signedIn: boolean): { to: string; state?: { from: string } } {
  return signedIn
    ? { to: '/shygontap/card-details' }
    : { to: '/shygontap/auth', state: { from: '/shygontap/card-details' } };
}
