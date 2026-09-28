import { digitalPlans, faqs, products } from '../data/shygonTapData';
import {
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

export function prerenderedPages(site: string): PrerenderedPage[] {
  return [
    { file: 'shygontap.html', meta: homeMeta(site) },
    { file: 'shygontap/store.html', meta: storeMeta(site) },
    ...products.map((product) => ({ file: `shygontap/store/${product.id}.html`, meta: productMeta(site, product) })),
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
export function shellMeta(site: string): PageMeta {
  return { ...homeMeta(site), jsonLd: undefined };
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
    ['/shygontap/store', '0.9'],
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
export function llmsTxt(site: string): string {
  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  return [
    `# ${BRAND}`,
    '',
    `> ${BRAND} is a premium NFC business card from ${COMPANY}, Bengaluru, India. Tapping the card on a phone opens the owner's digital profile in the browser — no app required. Cards come in PVC, metal and transparent finishes and are delivered across India.`,
    '',
    '## Pages',
    '',
    `- [Home](${site}/shygontap): how the card and its digital experience work, the configurator and answers to common questions.`,
    `- [Store](${site}/shygontap/store): every card, with filters for card type, material, finish and price.`,
    '',
    '## Cards',
    '',
    ...products.map((p) => `- [${p.name}](${site}${productPath(p)}): ${p.description} From ${rupees(lowestPrice(p))}.`),
    '',
    '## Digital experiences',
    '',
    ...digitalPlans.map((plan) => `- ${plan.name} (${plan.price === 0 ? 'included with every card' : `${rupees(plan.price)}${plan.priceSuffix ?? ''}`}): ${plan.description}`),
    '',
    '## Questions',
    '',
    ...faqs.map(([q, a]) => `- **${q}** ${a}`),
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
