import {
  faqsFor,
  materialLabels,
  products,
  siteContent,
  WHATSAPP_NUMBER,
  type MaterialId,
  type Product,
} from '../data/shygonTapData';

/**
 * Page metadata for every public page: title, description, canonical path,
 * share image and structured data.
 *
 * One source for two consumers. The browser applies it with `usePageMeta`;
 * the build (vite.config.ts) writes it into a static HTML file per public
 * route, so search engines and link previews (WhatsApp, LinkedIn, X), which
 * do not run JavaScript, see the same tags.
 *
 * Every builder takes the site origin rather than reading SITE_URL, because
 * the build resolves it from the .env files itself. Nothing here states a
 * fact the site does not already publish.
 */

export const BRAND = 'SHYGON Tap';
export const COMPANY = 'SHYGON Technologies Pvt. Ltd.';
/** 1200x630, generated from the product photography. */
export const DEFAULT_SHARE_IMAGE = '/og/shygon-tap.jpg';

export type JsonLd = Record<string, unknown>;

export interface PageMeta {
  /** Full document title, already including the brand. */
  title: string;
  /** 150–160 characters: what a search result shows under the title. */
  description: string;
  /** Path on the canonical origin, e.g. `/shygontap/store`. */
  path: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'product' | 'profile';
  /** Account, checkout and error pages: kept out of search results. */
  noindex?: boolean;
  jsonLd?: JsonLd[];
}

const MATERIALS: MaterialId[] = ['pvc', 'metal', 'transparent'];

export function lowestPrice(product: Product): number {
  return Math.min(...Object.values(product.pricing).flatMap((tier) => Object.values(tier)));
}

export function highestPrice(product: Product): number {
  return Math.max(...Object.values(product.pricing).flatMap((tier) => Object.values(tier)));
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const abs = (site: string, path: string) => (/^https?:/.test(path) ? path : `${site}${path.startsWith('/') ? '' : '/'}${path}`);
const socials = () => [siteContent.contact.instagram, siteContent.contact.linkedin].filter((url) => url && url.trim());
const contactEmail = (site: string) => `contact@${site.replace(/^https?:\/\//, '')}`;

export const productPath = (product: Product) => `/shygontap/store/${product.id}`;
/** "Shygon Tap Business" -> "Business", so titles don't repeat the brand. */
const shortName = (product: Product) => product.name.replace(/^shygon tap\s+/i, '');
export const productShareImage = (product: Product) => `/og/${product.id}.jpg`;

// --------------------------------------------------------------- JSON-LD ---

function organization(site: string): JsonLd {
  const sameAs = socials();
  return {
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: COMPANY,
    brand: BRAND,
    url: `${site}/shygontap`,
    logo: abs(site, '/icons/icon-512.png'),
    email: contactEmail(site),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function website(site: string): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': `${site}/#website`,
    name: BRAND,
    url: `${site}/shygontap`,
    publisher: { '@id': `${site}/#organization` },
    inLanguage: 'en-IN',
  };
}

/**
 * The business as a local listing. Only what the site already states: the
 * city, the published mailbox and the WhatsApp ordering number. No street
 * address or opening hours, because none are published.
 */
function localBusiness(site: string): JsonLd {
  const all = products.flatMap((p) => [lowestPrice(p), highestPrice(p)]);
  return {
    '@type': 'Store',
    '@id': `${site}/#store`,
    name: BRAND,
    description:
      'Premium NFC business cards in PVC, metal and transparent finishes, with a digital profile that opens in one tap.',
    url: `${site}/shygontap`,
    image: abs(site, DEFAULT_SHARE_IMAGE),
    logo: abs(site, '/icons/icon-512.png'),
    email: contactEmail(site),
    telephone: `+${WHATSAPP_NUMBER}`,
    priceRange: `${rupees(Math.min(...all))} – ${rupees(Math.max(...all))}`,
    currenciesAccepted: 'INR',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Bengaluru',
      addressRegion: 'Karnataka',
      addressCountry: 'IN',
    },
    areaServed: { '@type': 'Country', name: 'India' },
    parentOrganization: { '@id': `${site}/#organization` },
  };
}

/** The same questions the home page shows for this sales state (D-10, V6-089). */
function faqPage(cardSales: boolean): JsonLd {
  return {
    '@type': 'FAQPage',
    mainEntity: faqsFor(cardSales).map(([question, answer]) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

export function breadcrumbList(site: string, trail: Array<[name: string, path: string]>): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: trail.map(([name, path], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: abs(site, path),
    })),
  };
}

/**
 * Whether physical cards are on sale (D-10). Pages and the build pass it in
 * explicitly: this module also runs in the Node build, where import.meta.env
 * does not exist. Closed unless a caller says otherwise, as in the V6 RC.
 */
export interface SalesOptions {
  cardSales?: boolean;
}

function productLd(site: string, product: Product, cardSales: boolean): JsonLd {
  // No offer is claimed for a card that cannot be bought: structured data that
  // advertises an unavailable offer misleads search engines.
  return {
    '@type': 'Product',
    '@id': `${site}${productPath(product)}#product`,
    name: product.name,
    description: product.description,
    category: 'NFC business card',
    brand: { '@type': 'Brand', name: BRAND },
    image: [abs(site, productShareImage(product)), ...MATERIALS.map((m) => abs(site, product.images[m]))],
    material: MATERIALS.map((m) => materialLabels[m]).join(', '),
    ...(cardSales
      ? {
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'INR',
            lowPrice: lowestPrice(product),
            highPrice: highestPrice(product),
            offerCount: Object.values(product.pricing).length * MATERIALS.length,
            url: abs(site, productPath(product)),
            seller: { '@id': `${site}/#organization` },
          },
        }
      : {}),
  };
}

function itemList(site: string): JsonLd {
  return {
    '@type': 'ItemList',
    name: `${BRAND} NFC cards`,
    itemListElement: products.map((product, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: product.name,
      url: abs(site, productPath(product)),
    })),
  };
}

// ----------------------------------------------------------------- pages ---

export function homeMeta(site: string, { cardSales = false }: SalesOptions = {}): PageMeta {
  return {
    title: `${BRAND} — Premium NFC Business Cards & Digital Profiles`,
    description: cardSales
      ? 'Premium NFC business cards in PVC, metal and transparent finishes, with a digital profile that opens in one tap — no app needed. Delivered across India.'
      : 'A digital profile that opens in one tap, no app needed. Premium NFC cards in PVC, metal and transparent finishes are coming soon.',
    path: '/shygontap',
    image: DEFAULT_SHARE_IMAGE,
    imageAlt: 'A SHYGON Tap NFC card beside the words One tap. One identity.',
    jsonLd: [organization(site), website(site), localBusiness(site), faqPage(cardSales)],
  };
}

export function storeMeta(site: string, { cardSales = false }: SalesOptions = {}): PageMeta {
  const from = Math.min(...products.map(lowestPrice));
  return {
    title: `Shop NFC Cards | ${BRAND}`,
    description: cardSales
      ? `Compare ${BRAND} NFC cards for business, restaurants, events and Google reviews. Available in PVC, metal and transparent, from ${rupees(from)}.`
      : `${BRAND} NFC cards for business, restaurants, events and Google reviews, in PVC, metal and transparent. Coming soon; your digital Tap is available today.`,
    path: '/shygontap/store',
    image: DEFAULT_SHARE_IMAGE,
    imageAlt: `${BRAND} NFC cards`,
    jsonLd: [
      breadcrumbList(site, [[BRAND, '/shygontap'], ['Store', '/shygontap/store']]),
      itemList(site),
    ],
  };
}

export function productMeta(site: string, product: Product, { cardSales = false }: SalesOptions = {}): PageMeta {
  return {
    title: `${shortName(product)} NFC Card | ${BRAND}`,
    description: cardSales
      ? `${product.description} In PVC, metal or transparent, from ${rupees(lowestPrice(product))}. Delivered across India.`
      : `${product.description} Coming soon in PVC, metal or transparent.`,
    path: productPath(product),
    image: productShareImage(product),
    imageAlt: `${BRAND} ${shortName(product)} NFC card`,
    type: 'product',
    jsonLd: [
      breadcrumbList(site, [[BRAND, '/shygontap'], ['Store', '/shygontap/store'], [product.name, productPath(product)]]),
      productLd(site, product, cardSales),
    ],
  };
}

export type LegalPageId = 'privacy' | 'terms' | 'cookies' | 'refunds' | 'shipping';

/** The policy pages: one list for routes, footers, the sitemap and prerendering. */
export const LEGAL_PAGES: Record<LegalPageId, { name: string; path: string; description: string }> = {
  privacy: {
    name: 'Privacy Policy',
    path: '/shygontap/privacy-policy',
    description:
      'What personal data SHYGON Tap collects, why, who processes it, how long it is kept, and your rights under Indian law, including how to reach our Grievance Officer.',
  },
  terms: {
    name: 'Terms and Conditions',
    path: '/shygontap/terms',
    description:
      'The terms for buying SHYGON Tap NFC cards and digital experiences, using your account and publishing a public Tap profile.',
  },
  cookies: {
    name: 'Cookie Policy',
    path: '/shygontap/cookie-policy',
    description:
      'SHYGON Tap sets no cookies and uses no tracking or advertising tools. This page lists the few things we keep in your browser and why.',
  },
  refunds: {
    name: 'Cancellation and Refund Policy',
    path: '/shygontap/refund-policy',
    description:
      'How to cancel a SHYGON Tap order, what to do if a card arrives damaged, and how and when refunds are paid.',
  },
  shipping: {
    name: 'Shipping and Delivery Policy',
    path: '/shygontap/shipping-policy',
    description:
      'Where SHYGON Tap delivers, how delivery estimates work, tracking, and what to do if a delivery goes wrong.',
  },
};

export function legalMeta(site: string, page: LegalPageId): PageMeta {
  const info = LEGAL_PAGES[page];
  return {
    title: `${info.name} | ${BRAND}`,
    description: info.description,
    path: info.path,
    jsonLd: [breadcrumbList(site, [[BRAND, '/shygontap'], [info.name, info.path]])],
  };
}

export function notFoundMeta(): PageMeta {
  return {
    title: `Page not found | ${BRAND}`,
    description: 'This page does not exist. Browse SHYGON Tap NFC cards or return to the home page.',
    path: '/404',
    noindex: true,
  };
}

/** Sign-in, checkout and the signed-in account pages. */
export function privateMeta(title: string, path: string): PageMeta {
  return {
    title: `${title} | ${BRAND}`,
    description: 'Your SHYGON Tap account.',
    path,
    noindex: true,
  };
}
