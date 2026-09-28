/**
 * The one place the product's own address is written down.
 *
 * SHYGON Tap lives at shygontech.com. Several things need that string and none
 * of them can safely derive it from the browser:
 *
 *  - `tapUrl()` produces the address printed on a physical card and baked into
 *    a QR that a customer may send to a printer. Deriving it from
 *    `window.location.origin` meant a QR generated on a Netlify deploy preview
 *    (or on localhost) encoded a host that will not exist tomorrow — and a card
 *    is not reprintable once it is in someone's wallet.
 *  - Open Graph needs absolute URLs; a relative `og:image` is dropped by most
 *    scrapers.
 *
 * `VITE_SITE_URL` overrides it, which is what a staging deploy or a developer
 * pointing at a local server should set. Anything that is genuinely about the
 * current origin — Supabase auth `redirectTo`, for one — must keep using
 * `window.location.origin`, or signing in on localhost would bounce to
 * production.
 */

function normalise(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Canonical origin, no trailing slash. e.g. `https://shygontech.com`. */
// `import.meta.env` is optional-chained because the build also loads this
// module from vite.config.ts (to prerender page metadata), where Vite has not
// injected it; the build passes its own resolved origin in there.
export const SITE_URL = normalise(import.meta.env?.VITE_SITE_URL || 'https://shygontech.com');

/** Host only, for display. e.g. `shygontech.com`. */
export const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, '');

/** Legal name of the company behind the product. */
export const COMPANY_NAME = 'SHYGON Technologies Pvt. Ltd.';

/**
 * The published mailbox. Every customer-facing link points here rather than at
 * a per-purpose address (support@, sales@, hello@) that nobody has created yet
 * — a contact link that bounces is worse than no contact link. The addresses
 * this replaced were on shygon.com, a different domain entirely.
 */
export const CONTACT_EMAIL = `contact@${SITE_DOMAIN}`;

/** Absolute URL for a file in `public/`. Open Graph and Razorpay need these. */
export function siteAsset(path: string): string {
  return `${SITE_URL}/${path.replace(/^\/+/, '')}`;
}
