import { digitalPlans, faqsFor, products } from '../data/shygonTapData';
import { AAROH, AAROH_BULK_MINIMUM, AAROH_EDITIONS, AAROH_FINISHES, AAROH_PRODUCT_PATH, AAROH_STORE_PATH } from '../data/aaroh';
import {
  aarohProductMeta,
  BRAND,
  COMPANY,
  DEFAULT_SHARE_IMAGE,
  homeMeta,
  LEGAL_PAGES,
  legalMeta,
  lowestPrice,
  type LegalPageId,
  notFoundMeta,
  productMeta,
  productPath,
  storeMeta,
  type PageMeta,
  type SalesOptions,
} from './meta';

/**
 * Build-time only (imported by vite.config.ts): the static HTML head for each
 * public route, plus sitemap.xml, robots.txt and llms.txt. Everything is
 * derived from the same data the pages render, so the three can't drift.
 */

export interface PrerenderedPage {
  /** Output file relative to the build folder. */
  file: string;
  meta: PageMeta;
}

export function prerenderedPages(site: string, sales: SalesOptions = {}): PrerenderedPage[] {
  return [
    { file: 'shygontap.html', meta: homeMeta(site, sales) },
    { file: `${AAROH_STORE_PATH.slice(1)}.html`, meta: storeMeta(site, sales) },
    // Both card families (DEC-2026-037): the AAROH page and every SHYGON TAP V5 card page.
    { file: `${AAROH_PRODUCT_PATH.slice(1)}.html`, meta: aarohProductMeta(site, sales) },
    ...products.map((product) => ({ file: `shygontap/store/${product.id}.html`, meta: productMeta(site, product, sales) })),
    ...(Object.keys(LEGAL_PAGES) as LegalPageId[]).map((id) => ({
      file: `${LEGAL_PAGES[id].path.slice(1)}.html`,
      meta: legalMeta(site, id),
    })),
    { file: '404.html', meta: notFoundMeta() },
  ];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const abs = (site: string, path: string) => (/^https?:/.test(path) ? path : `${site}${path}`);

/**
 * The shell served for every route that has no prerendered page of its own —
 * customer Taps and the signed-in pages. It claims no canonical URL: the page
 * sets its own once it renders.
 */
export function shellMeta(site: string, sales: SalesOptions = {}): PageMeta {
  return { ...homeMeta(site, sales), jsonLd: undefined };
}

/** The tags `usePageMeta` manages, as static HTML. */
export function renderHead(site: string, meta: PageMeta, opts: { canonical?: boolean } = {}): string {
  const url = abs(site, meta.path);
  const image = abs(site, meta.image ?? DEFAULT_SHARE_IMAGE);
  const withCanonical = !meta.noindex && opts.canonical !== false;
  const lines = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<meta name="robots" content="${meta.noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}" />`,
    ...(withCanonical ? [`<link rel="canonical" href="${esc(url)}" />`] : []),
    `<meta property="og:type" content="${meta.type === 'product' ? 'product' : 'website'}" />`,
    `<meta property="og:site_name" content="${BRAND}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    ...(withCanonical ? [`<meta property="og:url" content="${esc(url)}" />`] : []),
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(meta.imageAlt ?? meta.title)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (meta.jsonLd?.length) {
    // `<` escaped so a value can never close the script element.
    const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': meta.jsonLd }).replace(/</g, '\\u003c');
    lines.push(`<script id="page-jsonld" type="application/ld+json">${json}</script>`);
  }
  return lines.map((l) => `    ${l}`).join('\n');
}

/** Replaces the block between the seo markers in the built index.html. */
export function injectHead(template: string, head: string): string {
  const start = '<!-- seo:start -->';
  const end = '<!-- seo:end -->';
  const a = template.indexOf(start);
  const b = template.indexOf(end);
  if (a < 0 || b < a) throw new Error('index.html is missing the <!-- seo:start --> / <!-- seo:end --> markers');
  return `${template.slice(0, a + start.length)}\n${head}\n    ${template.slice(b)}`;
}

export function sitemapXml(site: string, lastmod: string): string {
  const urls = [
    ['/shygontap', '1.0'],
    [AAROH_STORE_PATH, '0.9'],
    [AAROH_PRODUCT_PATH, '0.9'],
    ...products.map((p) => [productPath(p), '0.8']),
    ...Object.values(LEGAL_PAGES).map((p) => [p.path, '0.3']),
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!--',
    '  Generated at build (src/seo/build.ts). Company pages only: customer Taps',
    '  (/t/:slug) belong to customers and come and go, so they are not listed.',
    '-->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map(([path, priority]) =>
      `  <url><loc>${site}${path}</loc><lastmod>${lastmod}</lastmod><priority>${priority}</priority></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

const PRIVATE_PATHS = [
  '/shygontap/auth', '/shygontap/account', '/shygontap/tap', '/shygontap/tiers', '/shygontap/customize',
  '/shygontap/qr', '/shygontap/cards', '/shygontap/customizations', '/shygontap/checkout', '/shygontap/orders',
  '/shygontap/notifications', '/shygontap/analytics', '/shygontap/support', '/shygontap/settings', '/api/',
];

export function robotsTxt(site: string): string {
  return [
    `# ${site.replace(/^https?:\/\//, '')}`,
    '',
    'User-agent: *',
    'Allow: /',
    '',
    '# Sign-in, checkout and the signed-in account. Client-rendered and private:',
    '# a crawler would only ever index an empty shell.',
    ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
    '',
    `Sitemap: ${site}/sitemap.xml`,
    '',
  ].join('\n');
}

/** https://llmstxt.org — a plain-language map of the site for language models. */
export function llmsTxt(site: string, { cardSales = false }: SalesOptions = {}): string {
  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  return [
    `# ${BRAND}`,
    '',
    cardSales
      ? `> ${BRAND}, from ${COMPANY}, Bengaluru, India, is a digital profile that opens in the browser in one tap, with no app required, and the NFC cards that open it: SHYGON TAP V5, the simple card, and ${AAROH.name}, the premium card. Cards are delivered across India.`
      : `> ${BRAND}, from ${COMPANY}, Bengaluru, India, is a digital profile that opens in the browser in one tap, with no app required. Its NFC cards, SHYGON TAP V5 and ${AAROH.name}, are coming soon; the digital profile is available today.`,
    '',
    '## Pages',
    '',
    `- [Home](${site}/shygontap): how a SHYGON profile works, its experiences, live demos and answers to common questions.`,
    `- [Store](${site}${AAROH_STORE_PATH}): both cards, SHYGON TAP V5 and AAROH, compared, with every V5 design.`,
    `- [AAROH](${site}${AAROH_PRODUCT_PATH}): what the card and its software do, who sees what, what each purchase includes, orders for teams, and answers to common questions.`,
    '',
    `## Card: ${AAROH.name}`,
    '',
    `${AAROH.lede} One product in ten editions and two finishes (${AAROH_FINISHES.map((f) => `${f.title}${cardSales ? `, ${rupees(f.price)}` : ''}`).join('; ')}). Organisations can order ${AAROH_BULK_MINIMUM} or more through a bulk enquiry, priced by quotation.`,
    '',
    ...AAROH_EDITIONS.map((e) => `- AAROH ${e.title}: ${e.description}${cardSales ? '' : ' Coming soon.'}`),
    '',
    '## Cards: SHYGON TAP V5',
    '',
    ...products.map((p) => `- [${p.name}](${site}${productPath(p)}): ${p.description} ${cardSales ? `From ${rupees(lowestPrice(p))}.` : 'Coming soon.'}`),
    '',
    '## Digital experiences',
    '',
    // Essential comes with a card, so it is not offered while cards are not sold.
    ...digitalPlans
      .filter((plan) => cardSales || plan.price > 0)
      .map((plan) => `- ${plan.name} (${plan.price === 0 ? 'included with every card' : `${rupees(plan.price)}${plan.priceSuffix ?? ''}`}): ${plan.description}`),
    '',
    '## Questions',
    '',
    ...faqsFor(cardSales).map(([q, a]) => `- **${q}** ${a}`),
    '',
    '## Policies',
    '',
    ...Object.values(LEGAL_PAGES).map((p) => `- [${p.name}](${site}${p.path}): ${p.description}`),
    '',
    '## Contact',
    '',
    `- Email: contact@${site.replace(/^https?:\/\//, '')}`,
    '- Location: Bengaluru, India',
    '',
  ].join('\n');
}
