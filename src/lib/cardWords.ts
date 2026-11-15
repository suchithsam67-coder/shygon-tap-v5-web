import { CardsError } from '../services/cards';

/**
 * The customer's words for `/api/cards` (AAROH-API v0.15 §7 C-6 to C-8;
 * DEC-2026-047): every refusal maps to our own sentence, so the server's
 * wording can change without changing the pages. DRAFT for the owner's gate.
 */
export function cardsMessageOf(error: unknown): string {
  if (!(error instanceof CardsError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'unauthenticated':
      return 'Your session has expired. Sign in again.';
    case 'network':
      return error.message;
    case 'proof_expired':
      return 'That tap has expired. Tap the card again.';
    case 'invalid_proof':
    case 'proof_used':
      return 'Tap the card again to activate it.';
    case 'proof_mismatch':
    case 'card_not_found':
      return 'This card is not on the account you are signed in with. Sign in with the account that ordered it, then tap the card again.';
    case 'already_active':
      return 'This card is already active. Tap it again to open your Tap.';
    case 'card_retired':
      return 'This card has been switched off. Contact SHYGON support.';
    case 'not_pairable':
      return 'This card cannot be activated here. Contact SHYGON support.';
    case 'not_registered':
      return 'This card has no secure chip. Activate it from Your cards with a one-time code.';
    default:
      return 'Something went wrong. Please try again.';
  }
}
