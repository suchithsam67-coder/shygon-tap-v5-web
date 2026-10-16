// Renders the AAROH concept SVGs to PNG previews and measures how much of each
// front is foil or silver, with the browser the e2e suite already uses (Edge by
// default; E2E_BROWSER_CHANNEL=chrome to change). Offline: only local files.
//
//   node design-assets/src/build.mjs && node design-assets/src/render.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { cardSvg, FINISHES, STORE_EDITIONS } from './editions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..');
const RENDERS = path.join(OUT, 'renders');
// Start clean, so renders of removed artwork do not linger.
fs.rmSync(RENDERS, { recursive: true, force: true });
fs.mkdirSync(RENDERS, { recursive: true });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge' });
const page = await browser.newPage({ deviceScaleFactor: 2 });

// Pages render from file:// only; refuse anything else.
await page.route('**/*', (route) => (route.request().url().startsWith('file:') ? route.continue() : route.abort()));

const svgs = ['concepts', 'textures', 'layout', 'editions'].flatMap((dir) =>
  fs.readdirSync(path.join(OUT, dir)).filter((f) => f.endsWith('.svg')).map((f) => path.join(dir, f)),
);
for (const rel of svgs) {
  const file = path.join(OUT, rel);
  await page.goto(pathToFileURL(file).href);
  const svg = page.locator('svg').first();
  await svg.screenshot({ path: path.join(RENDERS, path.basename(rel, '.svg') + '.png'), omitBackground: true });
}

// The presentation sheet, if built.
const sheet = path.join(OUT, 'aaroh-design-sheet.html');
if (fs.existsSync(sheet)) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(sheet).href);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(RENDERS, 'aaroh-design-sheet.png'), fullPage: true });
  for (const id of ['hero', 'editions', 'macro', 'edges', 'materials', 'layouts']) {
    const section = page.locator(`#${id}`);
    if (await section.count()) await section.screenshot({ path: path.join(RENDERS, `sheet-${id}.png`) });
  }
}

// Foil / silver coverage of each front, at 10 px per mm, inside the card shape
// (the card is upright: 53.98 wide, 85.60 tall).
const classify = {
  'signature-noir': 'gold-on-dark',
  'ivory-atelier': 'gold-on-light',
  'midnight-titanium': 'silver-on-dark',
};
const coverage = {};
for (const [id, kind] of Object.entries(classify)) {
  const svgText = fs.readFileSync(path.join(OUT, 'concepts', `aaroh-${id}-front-concept.svg`), 'utf8');
  await page.goto('about:blank');
  coverage[id] = await page.evaluate(
    async ({ svgText, kind }) => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 540;
      c.height = 856;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, 540, 856);
      const { data } = g.getImageData(0, 0, 540, 856);
      let card = 0;
      let accent = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, gg, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;
        card++;
        const lum = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        const hit =
          kind === 'gold-on-dark' ? r > 110 && r - b > 35 :
          kind === 'gold-on-light' ? r - b > 52 && lum < 225 :
          lum > 140;
        if (hit) accent++;
      }
      return { cardPixels: card, accentPixels: accent, percent: +((100 * accent) / card).toFixed(2) };
    },
    { svgText, kind },
  );
}
fs.writeFileSync(path.join(OUT, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n');

// Web images for the store: the ten AAROH editions (editions.mjs), each finish,
// both faces, landscape (85.60 × 53.98 mm), at two widths.
const PUBLIC = path.join(OUT, '..', 'public', 'assets', 'aaroh');
fs.rmSync(PUBLIC, { recursive: true, force: true });
fs.mkdirSync(PUBLIC, { recursive: true });
for (const [id] of STORE_EDITIONS) {
  for (const finish of Object.keys(FINISHES)) {
    for (const side of ['front', 'back']) {
      const svgText = cardSvg(id, { side, finish });
      for (const width of [1200, 600]) {
        await page.goto('about:blank');
        const dataUrl = await page.evaluate(
          async ({ svgText, width }) => {
            const img = new Image();
            img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)));
            await img.decode();
            const c = document.createElement('canvas');
            c.width = width;
            c.height = Math.round((width * 53.98) / 85.6);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            return c.toDataURL('image/webp', 0.86);
          },
          { svgText, width },
        );
        const out = path.join(PUBLIC, `${id}-${finish}-${side}${width === 600 ? '-600' : ''}.webp`);
        fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
      }
    }
  }
}
console.log('wrote store images to public/assets/aaroh/');
console.log('accent coverage (% of the front):', Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, v.percent])));
console.log(`rendered ${svgs.length} SVGs to design-assets/renders/`);
await browser.close();
