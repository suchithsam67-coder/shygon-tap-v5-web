// SEO gate for the built site (DEC-2026-034, phase C5).
//
// Checks what search engines and link previews actually receive: the static
// files `vite build` writes (src/seo/build.ts via the shygon-seo-pages plugin),
// not the source. Fails on anything a crawler would treat as an error:
//
//   sitemap.xml   every <loc> is on the canonical origin, unique, served by a
//                 prerendered page that is indexable, and not blocked by
//                 robots.txt;
//   robots.txt    names the sitemap and blocks the private, client-only paths;
//   each page     one title and description within search-result limits, the
//                 right robots directive, a canonical (and og:url) equal to its
//                 own address, Open Graph / Twitter tags whose images exist in
//                 the build, and JSON-LD that parses, uses schema.org, and whose
//                 Product, Offer, BreadcrumbList, Organization and FAQPage
//                 nodes carry the fields Google requires.
//
//   npm run test:seo                     (after `vite build`)
//   node scripts/ci/check-seo.mjs [distDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));

const failures = [];
let checks = 0;
const check = (ok, message) => {
  checks += 1;
  if (!ok) failures.push(message);
};
// A UTF-8 byte-order mark is valid for crawlers; don't let it fail a check.
const read = (rel) => fs.readFileSync(path.join(DIST, rel), 'utf8').replace(/^﻿/, '');
const exists = (rel) => fs.existsSync(path.join(DIST, rel));

if (!exists('index.html')) {
  console.error(`FAIL  ${path.relative(ROOT, DIST)}/index.html not found. Run \`vite build\` first.`);
  process.exit(1);
}

// ------------------------------------------------------------- robots.txt --
check(exists('robots.txt'), 'robots.txt is missing');
const robots = exists('robots.txt') ? read('robots.txt') : '';
const sitemapLine = robots.match(/^Sitemap:\s*(\S+)\s*$/m)?.[1];
check(Boolean(sitemapLine), 'robots.txt does not name a sitemap');
const ORIGIN = sitemapLine ? new URL(sitemapLine).origin : '';
check(sitemapLine === `${ORIGIN}/sitemap.xml`, `robots.txt sitemap is not <origin>/sitemap.xml: ${sitemapLine}`);
check(/^https:\/\//.test(ORIGIN), `the canonical origin is not https: ${ORIGIN}`);
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm)].map((m) => m[1]);
for (const p of ['/shygontap/checkout', '/shygontap/account', '/shygontap/auth', '/api/']) {
  check(disallowed.includes(p), `robots.txt does not block the private path ${p}`);
}
const blocked = (pathname) => disallowed.some((rule) => pathname.startsWith(rule));

// ------------------------------------------------------------ sitemap.xml --
check(exists('sitemap.xml'), 'sitemap.xml is missing');
const sitemap = exists('sitemap.xml') ? read('sitemap.xml') : '';
check(sitemap.startsWith('<?xml') && sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'sitemap.xml is not a sitemaps.org urlset');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(locs.length > 0, 'sitemap.xml lists no URLs');
check(new Set(locs).size === locs.length, 'sitemap.xml lists a URL twice');

/** The prerendered file that answers a path, as vercel.json / netlify.toml serve it. */
const fileFor = (pathname) => (pathname === '/' ? 'index.html' : `${pathname.slice(1)}.html`);

const pages = new Map(); // pathname -> file
for (const loc of locs) {
  const url = new URL(loc);
  check(url.origin === ORIGIN, `sitemap URL is not on ${ORIGIN}: ${loc}`);
  check(!url.search && !url.hash, `sitemap URL has a query or fragment: ${loc}`);
  check(!blocked(url.pathname), `sitemap URL is blocked by robots.txt: ${loc}`);
  const file = fileFor(url.pathname);
  check(exists(file), `sitemap URL has no prerendered page (${file}): ${loc}`);
  if (exists(file)) pages.set(url.pathname, file);
}

// --------------------------------------------------------------- per page --
const attr = (html, selector) => {
  // selector: ['meta', 'name', 'description'] -> content; ['link', 'rel', 'canonical'] -> href
  const [tag, key, value] = selector;
  const re = new RegExp(`<${tag}\\b[^>]*\\b${key}="${value}"[^>]*>`, 'gi');
  const found = [...html.matchAll(re)].map((m) => m[0]);
  const pick = tag === 'link' ? 'href' : 'content';
  return found.map((t) => t.match(new RegExp(`\\b${pick}="([^"]*)"`, 'i'))?.[1] ?? '');
};
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** A same-origin URL whose file must exist in the build. */
const assetExists = (url) => {
  try {
    const u = new URL(url);
    return u.origin === ORIGIN && exists(decodeURIComponent(u.pathname).replace(/^\//, ''));
  } catch {
    return false;
  }
};

function checkJsonLd(where, html, pathname) {
  const blocks = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  check(blocks.length <= 1, `${where}: more than one JSON-LD block`);
  if (!blocks.length) return 0;
  let doc;
  try {
    doc = JSON.parse(blocks[0][1]);
  } catch (error) {
    check(false, `${where}: JSON-LD does not parse (${error.message})`);
    return 0;
  }
  check(doc['@context'] === 'https://schema.org', `${where}: JSON-LD @context is not https://schema.org`);
  const nodes = Array.isArray(doc['@graph']) ? doc['@graph'] : [doc];
  for (const node of nodes) {
    const type = node['@type'];
    check(typeof type === 'string' && type.length > 0, `${where}: a JSON-LD node has no @type`);
    if (type === 'Product') {
      check(Boolean(node.name), `${where}: Product has no name`);
      const images = [].concat(node.image ?? []);
      check(images.length > 0, `${where}: Product has no image`);
      for (const img of images) check(assetExists(img), `${where}: Product image is not in the build: ${img}`);
      const offer = node.offers;
      check(Boolean(offer), `${where}: Product has no offers`);
      if (offer) {
        check(offer.priceCurrency === 'INR', `${where}: offer currency is not INR`);
        if (offer['@type'] === 'AggregateOffer') {
          check(Number(offer.lowPrice) > 0, `${where}: AggregateOffer lowPrice is not a positive number`);
          check(Number(offer.highPrice) >= Number(offer.lowPrice), `${where}: AggregateOffer highPrice < lowPrice`);
          check(Number.isInteger(offer.offerCount) && offer.offerCount > 0, `${where}: AggregateOffer offerCount missing`);
        } else {
          check(Number(offer.price) > 0, `${where}: Offer price is not a positive number`);
        }
        if (offer.availability !== undefined) {
          check(/^https:\/\/schema\.org\/\w+$/.test(offer.availability), `${where}: offer availability is not a schema.org URL`);
        }
        check(offer.url === `${ORIGIN}${pathname}`, `${where}: offer url is not the page's own address`);
      }
    }
    if (type === 'BreadcrumbList') {
      const items = node.itemListElement ?? [];
      check(items.length >= 2, `${where}: BreadcrumbList has fewer than 2 items`);
      items.forEach((item, i) => {
        check(item.position === i + 1, `${where}: breadcrumb positions are not 1..n`);
        check(Boolean(item.name), `${where}: breadcrumb ${i + 1} has no name`);
        const target = item.item ? new URL(item.item) : null;
        check(target?.origin === ORIGIN && locs.includes(item.item), `${where}: breadcrumb ${i + 1} does not point at a sitemap URL: ${item.item}`);
      });
      check(items.at(-1)?.item === `${ORIGIN}${pathname}`, `${where}: the last breadcrumb is not the page itself`);
    }
    if (type === 'Organization' || type === 'Store') {
      check(Boolean(node.name) && Boolean(node.url), `${where}: ${type} has no name or url`);
      if (node.logo) check(assetExists(node.logo), `${where}: ${type} logo is not in the build: ${node.logo}`);
      if (node.image) check(assetExists(node.image), `${where}: ${type} image is not in the build: ${node.image}`);
    }
    if (type === 'FAQPage') {
      const q = node.mainEntity ?? [];
      check(q.length > 0, `${where}: FAQPage has no questions`);
      check(q.every((x) => x.name && x.acceptedAnswer?.text), `${where}: an FAQ entry has no question or answer`);
    }
    if (type === 'ItemList') {
      for (const item of node.itemListElement ?? []) check(locs.includes(item.url), `${where}: ItemList entry is not a sitemap URL: ${item.url}`);
    }
  }
  return nodes.length;
}

function checkPage(file, pathname, { indexable }) {
  const html = read(file);
  const where = file;
  const titles = [...html.matchAll(/<title>([^<]*)<\/title>/gi)].map((m) => decode(m[1]));
  check(titles.length === 1, `${where}: expected one <title>, found ${titles.length}`);
  const title = titles[0] ?? '';
  check(title.length >= 10 && title.length <= 70, `${where}: title is ${title.length} characters (10–70): "${title}"`);

  const descriptions = attr(html, ['meta', 'name', 'description']).map(decode);
  check(descriptions.length === 1, `${where}: expected one meta description, found ${descriptions.length}`);
  const description = descriptions[0] ?? '';
  // 160: where search results cut a description (DESCRIPTION_MAX in src/seo/meta.ts).
  check(description.length >= 50 && description.length <= 160, `${where}: description is ${description.length} characters (50–160)`);

  const robotsMeta = attr(html, ['meta', 'name', 'robots'])[0] ?? '';
  const canonical = attr(html, ['link', 'rel', 'canonical']);
  const ogUrl = attr(html, ['meta', 'property', 'og:url']);
  if (indexable) {
    check(/\bindex\b/.test(robotsMeta) && !/noindex/.test(robotsMeta), `${where}: indexable page has robots "${robotsMeta}"`);
    check(canonical.length === 1 && canonical[0] === `${ORIGIN}${pathname}`, `${where}: canonical is ${JSON.stringify(canonical)}, expected ${ORIGIN}${pathname}`);
    check(ogUrl[0] === `${ORIGIN}${pathname}`, `${where}: og:url is not the canonical address`);
  } else {
    check(/noindex/.test(robotsMeta), `${where}: non-indexable page is missing noindex`);
    check(canonical.length === 0, `${where}: a noindex page must not claim a canonical URL`);
  }

  for (const key of ['og:title', 'og:description', 'og:image', 'og:type', 'og:site_name']) {
    check(attr(html, ['meta', 'property', key]).length === 1, `${where}: expected one ${key}`);
  }
  const ogImage = attr(html, ['meta', 'property', 'og:image'])[0] ?? '';
  check(assetExists(ogImage), `${where}: og:image is not in the build: ${ogImage}`);
  check(attr(html, ['meta', 'name', 'twitter:card'])[0] === 'summary_large_image', `${where}: twitter:card is not summary_large_image`);
  check(attr(html, ['meta', 'name', 'twitter:image'])[0] === ogImage, `${where}: twitter:image differs from og:image`);

  return checkJsonLd(where, html, pathname);
}

let ldNodes = 0;
for (const [pathname, file] of pages) ldNodes += checkPage(file, pathname, { indexable: true });
if (exists('404.html')) checkPage('404.html', '/404', { indexable: false });
else check(false, '404.html is missing');

// The product pages are what rich results care about: every one must be listed.
const productPages = [...pages.keys()].filter((p) => p.startsWith('/shygontap/store/'));
check(productPages.length > 0, 'the sitemap lists no product pages');

console.log(`\nSEO gate (${path.relative(ROOT, DIST) || '.'}, origin ${ORIGIN})`);
console.log(`  sitemap URLs ${locs.length} · prerendered pages checked ${pages.size + 1} · product pages ${productPages.length} · JSON-LD nodes ${ldNodes}`);
if (failures.length) {
  for (const f of failures) console.error(`  FAIL  ${f}`);
  console.error(`\n${checks - failures.length} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`\nPASS  ${checks} checks`);
