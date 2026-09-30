// Text as outlines. Card art is served as SVG images, which cannot load web
// fonts, so every word is converted to a path from the same self-hosted fonts
// the site uses (plus Playfair Display for the serif lines).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');

const FONT_FILES = {
  inter400: '@fontsource/inter/files/inter-latin-400-normal.woff',
  inter500: '@fontsource/inter/files/inter-latin-500-normal.woff',
  inter600: '@fontsource/inter/files/inter-latin-600-normal.woff',
  geist500: '@fontsource/geist/files/geist-latin-500-normal.woff',
  geist600: '@fontsource/geist/files/geist-latin-600-normal.woff',
  serif400: '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff',
  serif500: '@fontsource/playfair-display/files/playfair-display-latin-500-normal.woff',
};

const cache = new Map();
function font(key) {
  if (!cache.has(key)) {
    const file = require.resolve(FONT_FILES[key]);
    const buf = fs.readFileSync(file);
    cache.set(key, opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
  }
  return cache.get(key);
}

/**
 * Outlines `text` and returns { d, width }.
 * size: font size in user units. tracking: extra space per letter, in em.
 * anchor: where x sits — 'start', 'middle' or 'end'.
 */
export function text(str, { font: key = 'inter500', size = 20, tracking = 0, x = 0, y = 0, anchor = 'start' } = {}) {
  const f = font(key);
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(str);
  const advances = glyphs.map((g, i) => {
    let adv = g.advanceWidth * scale;
    if (i < glyphs.length - 1) adv += f.getKerningValue(g, glyphs[i + 1]) * scale;
    return adv + (i < glyphs.length - 1 ? tracking * size : 0);
  });
  const width = advances.reduce((a, b) => a + b, 0);
  let cx = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
  const parts = [];
  glyphs.forEach((g, i) => {
    const d = g.getPath(cx, y, size).toPathData(1);
    if (d) parts.push(d);
    cx += advances[i];
  });
  return { d: parts.join(''), width };
}

export const fontFileFor = (key) => path.basename(FONT_FILES[key]);
