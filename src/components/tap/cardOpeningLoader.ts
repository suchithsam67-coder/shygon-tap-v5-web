/**
 * The card opening's own chunk. Only a page opened from a physical card plays
 * it, so it stays out of the public Tap's entry bundle (the M0.1 budget gate);
 * PublicTap starts this download as soon as it knows a card opened the page,
 * alongside the data requests, so the opening is ready when the page is.
 */
export const loadCardOpening = () => import('./CardOpening');
