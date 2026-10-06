/**
 * What the storefront sells (DEC-2026-035; decision D-10, 2026-10-06).
 *
 * The V6 release candidate is digital-first. A new customer's first purchase is
 * a Business, Premium or GOAT experience, and their Tap page is created as a
 * draft the moment the payment is confirmed. Physical SHYGON cards stay on show
 * but are not sold until the card release: a paid card order cannot yet become
 * a card the customer can activate.
 *
 * This flag only decides what the pages offer. The server refuses a card order
 * by itself (create-order, CARD_SALES_ENABLED), so a stale page or a hand-made
 * request still cannot buy one. The card release turns both on together.
 */
export const CARD_SALES_OPEN = import.meta.env.VITE_CARD_SALES_ENABLED === 'true';

/** Where a customer goes to buy their Tap experience. */
export const TIERS_PATH = '/shygontap/tiers';

export const CARDS_COMING_SOON = {
  title: 'SHYGON cards are coming soon',
  body: "You can't order a physical card yet. Your digital Tap is available today: choose its experience, and your Tap page is ready to publish once your payment is confirmed.",
  action: 'Choose your Tap experience',
} as const;

const PENDING_KEY = 'shygon_pending_order';

/** A card selection saved in this browser before card sales closed, if any. */
export function hasPendingCardOrder(): boolean {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as { orderType?: string })?.orderType === 'physical' : false;
  } catch {
    return false;
  }
}

/** Forgets a saved card selection that can no longer be checked out. */
export function clearPendingCardOrder(): void {
  try {
    if (hasPendingCardOrder()) localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event('shygon-cart-updated'));
}
