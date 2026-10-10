// SEO of the built site (V6 Stage 6): what search engines and link previews
// read is complete and consistent.
//
//   node scripts/ci/check-seo.mjs [dist-dir]
//
//   - robots.txt names the sitemap and keeps every signed-in route out;
//   - sitemap.xml lists only canonical, built, crawlable pages, once each;
//   - every listed page has a unique title, a description of a sensible
//     length, a canonical equal to its own address, Open Graph and Twitter
//     tags whose image exists, and JSON-LD that parses; while card sales are
//     closed (D-10), no structured data offers a card for sale;
//   - the 404 page and the app shell are never indexed under another address;
//   - llms.txt links only to pages that exist.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] ?? 'dist');
const cardSales = process.env.VITE_CARD_SALES_ENABLED === 'true';
const problems = [];
const fail = (message) => problems.push(message);
const read = (file) => fs.readFileSync(path.join(DIST, file), 'utf8');

const robots = read('robots.txt');
const site = /^Sitemap:\s*(https:\/\/[^/\s]+)\/sitemap\.xml\s*$/m.exec(robots)?.[1];
if (!site) fail('robots.txt: no "Sitemap: https://…/sitemap.xml" line');
if (!/^Allow:\s*\/\s*$/m.test(robots)) fail('robots.txt: the site is not allowed');
const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);

// Every signed-in route of the account app must be kept out.
const accountApp = fs.readFileSync(path.join(process.cwd(), 'src', 'AccountApp.tsx'), 'utf8');
for (const [, route] of accountApp.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Protected/g)) {
  if (!disallowed.some((prefix) => route.startsWith(prefix))) fail(`robots.txt: the signed-in route ${route} is not disallowed`);
}

// The sitemap.
const sitemap = read('sitemap.xml');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length === 0) fail('sitemap.xml: no <loc>');
if (new Set(locs).size !== locs.length) fail('sitemap.xml: a page is listed twice');
for (const [, lastmod] of sitemap.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) fail(`sitemap.xml: lastmod ${lastmod} is not a date`);
}

const tag = (html, re) => re.exec(html)?.[1];
const meta = (html, attr, key) =>
  tag(html, new RegExp(`<meta\\s+${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s+content="([^"]*)"`, 'i'));
const titles = new Map();

for (const loc of locs) {
  if (site && !loc.startsWith(`${site}/`) && loc !== site) { fail(`sitemap.xml: ${loc} is not on ${site}`); continue; }
  const route = loc.slice(site.length) || '/';
  if (disallowed.some((prefix) => route.startsWith(prefix))) fail(`sitemap.xml: ${route} is disallowed by robots.txt`);
  const file = `${route.replace(/^\//, '') || 'index'}.html`;
  if (!fs.existsSync(path.join(DIST, file))) { fail(`${route}: listed but not built (${file})`); continue; }
  const html = read(file);

  const titleTags = [...html.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1].trim());
  if (titleTags.length !== 1 || !titleTags[0]) fail(`${route}: ${titleTags.length} title tags`);
  else if (titles.has(titleTags[0])) fail(`${route}: same title as ${titles.get(titleTags[0])}`);
  else titles.set(titleTags[0], route);

  const description = meta(html, 'name', 'description') ?? '';
  if (description.length < 50 || description.length > 170) fail(`${route}: description is ${description.length} characters`);
  const canonical = tag(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  if (canonical !== loc) fail(`${route}: canonical ${canonical ?? '(none)'} is not ${loc}`);
  if (/noindex/i.test(meta(html, 'name', 'robots') ?? '')) fail(`${route}: listed in the sitemap but noindex`);

  for (const key of ['og:title', 'og:description', 'og:type', 'og:url', 'og:image']) {
    if (!meta(html, 'property', key)) fail(`${route}: no ${key}`);
  }
  if (meta(html, 'property', 'og:url') !== loc) fail(`${route}: og:url is not ${loc}`);
  const image = meta(html, 'property', 'og:image') ?? '';
  if (!image.startsWith(`${site}/`)) fail(`${route}: og:image ${image} is not an absolute address on ${site}`);
  else if (!fs.existsSync(path.join(DIST, decodeURIComponent(image.slice(site.length + 1))))) fail(`${route}: og:image ${image} does not exist in the build`);
  if (!meta(html, 'name', 'twitter:card')) fail(`${route}: no twitter:card`);

  const blocks = [...html.matchAll(/<script\b[^>]*\btype="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  if (blocks.length === 0) fail(`${route}: no JSON-LD`);
  for (const json of blocks) {
    let data;
    try {
      data = JSON.parse(json);
    } catch (error) {
      fail(`${route}: JSON-LD does not parse (${error.message})`);
      continue;
    }
    if (data['@context'] !== 'https://schema.org') fail(`${route}: JSON-LD @context is ${data['@context']}`);
    if (!cardSales && /"offers"/.test(json)) fail(`${route}: JSON-LD offers a card for sale while card sales are closed`);
  }
}

// Pages that must never be indexed under another address.
const notFound = read('404.html');
if (!/noindex/i.test(meta(notFound, 'name', 'robots') ?? '')) fail('404.html: not noindex');
if (/<link\s+rel="canonical"/i.test(notFound)) fail('404.html: has a canonical');
if (/<link\s+rel="canonical"/i.test(read('index.html'))) fail('index.html (the app shell, served for Taps and signed-in pages): has a canonical');

// llms.txt
const llms = read('llms.txt');
if (!llms.startsWith('# ')) fail('llms.txt: does not start with a "# " title');
for (const [, url] of llms.matchAll(/\]\((https?:\/\/[^)]+)\)/g)) {
  if (site && url.startsWith(site) && !locs.includes(url) && !fs.existsSync(path.join(DIST, `${url.slice(site.length + 1)}.html`))) {
    fail(`llms.txt: links to ${url}, which is not built`);
  }
}

if (problems.length) {
  for (const problem of problems) console.log(`FAIL  ${problem}`);
  process.exit(1);
}
console.log(`PASS  ${locs.length} sitemap pages: titles unique, descriptions, canonicals, Open Graph, JSON-LD; robots, 404, shell and llms.txt consistent (card sales ${cardSales ? 'open' : 'closed: no offers'})`);
