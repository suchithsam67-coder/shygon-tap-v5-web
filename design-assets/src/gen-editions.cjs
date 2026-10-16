// Generates design-assets/src/editions.mjs from the design canvas's Card component
// (design-assets/canvas/Card.dc.html, copied from the AAROH design system artifact):
// the helpers, ART and D blocks are copied verbatim; the wrapper renders them offline.
//   node design-assets/src/gen-editions.cjs   (from the repository root)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..', '..');
const cardFile = path.join(root, 'design-assets', 'canvas', 'Card.dc.html');
const html = fs.readFileSync(cardFile, 'utf8').replace(/\r\n/g, '\n');
const sha = crypto.createHash('sha256').update(fs.readFileSync(cardFile)).digest('hex');
const start = html.indexOf('/* The proposed AAROH lotus');
const end = html.indexOf('const FINDERS');
if (start < 0 || end < 0) throw new Error('canvas markers not found');
const verbatim = html.slice(start, end).trimEnd();

const out = `// SHYGON AAROH store editions (DEC-2026-037): the ten editions of the AAROH
// design system, each in two finishes.
//
// GENERATED from the AAROH design canvas ("SHYGON AAROH Design System",
// project/Card.dc.html, sha256 ${sha.slice(0, 16)}…). The block marked VERBATIM
// below is the canvas's own code: the geometry (ART) and the edition records
// (D) are copied, not redrawn. Tier B is the Premium Finish mockup (relief,
// foil, metal rim); Tier A is the Standard print (the same artwork, metals as
// ink, texture printed, not felt).
//
// Differences from the canvas, both for an offline, reproducible build:
//   - text is outlined from the self-hosted fonts (scripts/brand/type.mjs)
//     instead of being set in web fonts;
//   - the SHYGON wordmark and mark are the project's own outlines
//     (scripts/brand/logo.mjs), at the canvas's sizes.
// The lotus emblem is the proposal in DESIGN.md (owner approval and a
// trademark search pending). Concept renders: not photographs, not production
// artwork. PROPOSED — REQUIRES VALIDATION.
//
//   node design-assets/src/editions.mjs     writes design-assets/editions/*.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { text as outline } from '../../scripts/brand/type.mjs';
import { MARK, WORDMARK } from '../../scripts/brand/logo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'editions');
const text = (str, opts) => outline(str, { decimals: 3, ...opts });

// ---------------------------------------------------------------- VERBATIM ---
${verbatim}
// ------------------------------------------------------------ END VERBATIM ---

/** The store's edition ids, in the canvas order (E01–E10), and their canvas keys. */
export const STORE_EDITIONS = [
  ['obsidian', 'obsidian'],
  ['aureate', 'aureate'],
  ['monolith', 'monolith'],
  ['ivory-veil', 'ivoryveil'],
  ['cobalt', 'cobalt'],
  ['emerald-cipher', 'emerald'],
  ['prism', 'prism'],
  ['carbon-weave', 'carbon'],
  ['heritage-geometry', 'heritage'],
  ['liquid-form', 'liquid'],
];
export const FINISHES = { standard: 'A', premium: 'B' };
const CANVAS_KEY = Object.fromEntries(STORE_EDITIONS);

const FINDERS = (() => {
  const m = 18 / 29;
  const sq = (x, y, s) => 'M' + n(x) + ' ' + n(y) + 'h' + n(s) + 'v' + n(s) + 'h' + n(-s) + 'Z';
  const fp = (x, y) => sq(x, y, 7 * m) + sq(x + m, y + m, 5 * m) + sq(x + 2 * m, y + 2 * m, 3 * m);
  return fp(17.99, 28) + fp(17.99 + 18 - 7 * m, 28) + fp(17.99, 28 + 18 - 7 * m);
})();
/** Tap glyph: a point and three arcs, deliberately not the licensed NFC or contactless marks. */
const TAP = (() => {
  const cx = 25.85;
  const cy = 14;
  let arcs = '';
  for (const r of [1.1, 1.9, 2.7]) {
    const a = 0.9;
    arcs += 'M' + n(cx + r * Math.cos(-a)) + ' ' + n(cy + r * Math.sin(-a)) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(cx + r * Math.cos(a)) + ' ' + n(cy + r * Math.sin(a));
  }
  return { arcs, dot: circ(cx, cy, 0.38) };
})();

const layerSvg = (o) =>
  o.d
    ? \`<path d="\${o.d}" fill="\${o.fill}" stroke="\${o.stroke}" stroke-width="\${o.sw}" opacity="\${o.op}"\${o.flt !== 'none' ? \` filter="\${o.flt}"\` : ''} stroke-linecap="round" stroke-linejoin="round"/>\`
    : '';

/** Centred text as an outline: tracking in em, centred on x 26.99. */
const centred = (str, { font = 'inter500', size, tracking, y, fill, opacity }) =>
  \`<path d="\${text(str, { font, size, tracking, x: CX, y, anchor: 'middle' }).d}" fill="\${fill}"\${opacity !== undefined ? \` opacity="\${opacity}"\` : ''}/>\`;

const stops4 = (g) => \`<stop offset="0" stop-color="\${g.s[0]}"/><stop offset="0.35" stop-color="\${g.s[1]}"/><stop offset="0.7" stop-color="\${g.s[2]}"/><stop offset="1" stop-color="\${g.s[3]}"/>\`;

/**
 * One face of one edition as a standalone SVG: the canvas component's
 * renderVals and template, as one function.
 * @param {string} storeId  an id from STORE_EDITIONS
 * @param {{side?: 'front'|'back', finish?: 'standard'|'premium', px?: number}} options
 */
export function cardSvg(storeId, { side = 'front', finish = 'premium', px = 16 } = {}) {
  const id = CANVAS_KEY[storeId];
  const c = D[id];
  if (!c) throw new Error(\`Unknown edition: \${storeId}\`);
  const back = side === 'back';
  const B = finish !== 'standard';
  const key = id + (back ? '-b' : '-f') + (B ? 'p' : 's');
  const ids = {};
  const u = {};
  for (const k of ['clip', 'base', 'metal', 'artA', 'artB', 'light', 'vig', 'sheen', 'calm', 'tex', 'rel', 'deb', 'foil', 'mask', 'bmask']) {
    ids[k] = 'aa-' + k + '-' + key;
    u[k] = 'url(#' + ids[k] + ')';
  }
  const M = B ? u.metal : c.flat;
  const P = { M, A: u.artA, B: u.artB, tierB: B, REL: B ? u.rel : 'none', DEB: B ? u.deb : 'none', FOIL: B ? u.foil : 'none' };
  const raw = ART[id](rng(c.seed), P);
  const layers = [];
  for (let i = 0; i < 8; i++) layers.push(L(raw['l' + i]));
  const dg = { u: 'objectBoundingBox', sp: 'pad', x1: 0, y1: 0, x2: 1, y2: 1, s: [c.b[0], c.b[1], c.b[1], c.b[2]] };
  const grad = (g) => Object.assign({}, dg, g || {});
  const A = grad(c.A);
  const Bg = grad(c.B);
  const t = c.tex;
  const g = 2.2;
  const v0 = Math.sin((t[3] * Math.PI) / 180);
  const off = n(0.5 - g * v0);
  const tx = { f: t[0], o: t[1], ss: t[2], el: t[3], k: n(t[4] * (B ? 1 : 0.6)), m: g + ' 0 0 0 ' + off + ' 0 ' + g + ' 0 0 ' + off + ' 0 0 ' + g + ' 0 ' + off + ' 0 0 0 0 1' };
  const rp = c.rel;
  const rl = { b: rp[0], o: rp[1], no: -rp[1], hc: rp[2], ho: rp[3], sc: rp[4], so: rp[5], co: rp[6] };
  const light = id === 'aureate' || id === 'ivoryveil' || id === 'prism';
  const fl = { b: 0.05, o: 0.06, no: -0.06, ho: light ? 0.75 : 0.55, sc: light ? '#5A4524' : '#000000', so: light ? 0.35 : 0.5, co: light ? 0.18 : 0.4 };
  const cm = c.calm || [23, 21];

  const defs =
    \`<clipPath id="\${ids.clip}"><rect width="53.98" height="85.6" rx="3.18"/></clipPath>\` +
    \`<linearGradient id="\${ids.base}" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="\${c.b[0]}"/><stop offset="0.55" stop-color="\${c.b[1]}"/><stop offset="1" stop-color="\${c.b[2]}"/></linearGradient>\` +
    \`<linearGradient id="\${ids.metal}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="53.98" y2="85.6"><stop offset="0" stop-color="\${c.m[0]}"/><stop offset="0.22" stop-color="\${c.m[1]}"/><stop offset="0.42" stop-color="\${c.m[2]}"/><stop offset="0.6" stop-color="\${c.m[3]}"/><stop offset="0.8" stop-color="\${c.m[2]}"/><stop offset="1" stop-color="\${c.m[4]}"/></linearGradient>\` +
    \`<linearGradient id="\${ids.artA}" gradientUnits="\${A.u}" spreadMethod="\${A.sp}" x1="\${A.x1}" y1="\${A.y1}" x2="\${A.x2}" y2="\${A.y2}">\${stops4(A)}</linearGradient>\` +
    \`<linearGradient id="\${ids.artB}" gradientUnits="\${Bg.u}" spreadMethod="\${Bg.sp}" x1="\${Bg.x1}" y1="\${Bg.y1}" x2="\${Bg.x2}" y2="\${Bg.y2}">\${stops4(Bg)}</linearGradient>\` +
    \`<radialGradient id="\${ids.light}" cx="0.16" cy="0.06" r="0.95"><stop offset="0" stop-color="#ffffff" stop-opacity="\${c.light}"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/></radialGradient>\` +
    \`<radialGradient id="\${ids.vig}" cx="0.5" cy="0.42" r="0.8"><stop offset="0.5" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="\${c.vig}"/></radialGradient>\` +
    \`<linearGradient id="\${ids.sheen}" x1="0" y1="0" x2="1" y2="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.42" stop-color="#ffffff" stop-opacity="\${c.sheen}"/><stop offset="0.52" stop-color="#ffffff" stop-opacity="\${n(c.sheen * 0.35)}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>\` +
    \`<radialGradient id="\${ids.calm}"><stop offset="0" stop-color="#000000"/><stop offset="0.5" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></radialGradient>\` +
    \`<filter id="\${ids.tex}" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="\${tx.f}" numOctaves="\${tx.o}" seed="\${c.seed}" result="noise"/><feDiffuseLighting in="noise" surfaceScale="\${tx.ss}" diffuseConstant="1" lighting-color="#ffffff" result="lit"><feDistantLight azimuth="225" elevation="\${tx.el}"/></feDiffuseLighting><feColorMatrix in="lit" type="matrix" values="\${tx.m}"/></filter>\` +
    \`<filter id="\${ids.rel}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="\${rl.b}" result="a"/><feOffset in="a" dx="\${rl.o}" dy="\${rl.o}" result="dn"/><feOffset in="a" dx="\${rl.no}" dy="\${rl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feComposite in="dn" in2="a" operator="out" result="cs"/><feFlood flood-color="\${rl.hc}" flood-opacity="\${rl.ho}" result="hf"/><feComposite in="hf" in2="hl" operator="in" result="hc"/><feFlood flood-color="\${rl.sc}" flood-opacity="\${rl.so}" result="sf"/><feComposite in="sf" in2="sh" operator="in" result="sc"/><feFlood flood-color="#000000" flood-opacity="\${rl.co}" result="cf"/><feComposite in="cf" in2="cs" operator="in" result="cc"/><feMerge><feMergeNode in="cc"/><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>\` +
    \`<filter id="\${ids.deb}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="\${rl.b}" result="a"/><feOffset in="a" dx="\${rl.o}" dy="\${rl.o}" result="dn"/><feOffset in="a" dx="\${rl.no}" dy="\${rl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feFlood flood-color="\${rl.sc}" flood-opacity="\${rl.so}" result="sf"/><feComposite in="sf" in2="hl" operator="in" result="sc"/><feFlood flood-color="\${rl.hc}" flood-opacity="\${rl.ho}" result="hf"/><feComposite in="hf" in2="sh" operator="in" result="hc"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>\` +
    \`<filter id="\${ids.foil}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="\${fl.b}" result="a"/><feOffset in="a" dx="\${fl.o}" dy="\${fl.o}" result="dn"/><feOffset in="a" dx="\${fl.no}" dy="\${fl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feComposite in="dn" in2="a" operator="out" result="cs"/><feFlood flood-color="#ffffff" flood-opacity="\${fl.ho}" result="hf"/><feComposite in="hf" in2="hl" operator="in" result="hc"/><feFlood flood-color="\${fl.sc}" flood-opacity="\${fl.so}" result="sf"/><feComposite in="sf" in2="sh" operator="in" result="sc"/><feFlood flood-color="#000000" flood-opacity="\${fl.co}" result="cf"/><feComposite in="cf" in2="cs" operator="in" result="cc"/><feMerge><feMergeNode in="cc"/><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>\` +
    \`<mask id="\${ids.mask}" maskUnits="userSpaceOnUse" x="0" y="0" width="53.98" height="85.6"><rect width="53.98" height="85.6" fill="#ffffff"/><ellipse cx="26.99" cy="29.5" rx="\${cm[0]}" ry="\${cm[1]}" fill="\${u.calm}"/></mask>\` +
    \`<mask id="\${ids.bmask}" maskUnits="userSpaceOnUse" x="0" y="0" width="53.98" height="85.6"><rect width="53.98" height="85.6" fill="#ffffff"/><ellipse cx="26.99" cy="44" rx="21" ry="40" fill="\${u.calm}"/><rect x="14.51" y="24.52" width="24.97" height="24.97" rx="1.2" fill="#000000"/></mask>\`;

  let identity;
  if (!back) {
    const by = text('BY', { font: 'inter500', size: 1.72, tracking: 1.07 / 1.72, x: 15.55, y: 41.85 });
    identity =
      \`<g filter="\${P.FOIL}">\` +
      \`<g transform="translate(19.99 12) scale(0.7)"><path d="\${LOTUS}" fill="none" stroke="\${M}" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="10" cy="0.7" r="0.62" fill="\${M}"/></g>\` +
      centred('AAROH', { font: 'serif400', size: 6.21, tracking: 1.86 / 6.21, y: 37.4, fill: M }) +
      \`<path d="\${by.d}" fill="\${M}"/>\` +
      \`<path d="\${WORDMARK.d}" transform="translate(20.96 40.54) scale(0.0284)" fill="\${M}" fill-rule="evenodd"/>\` +
      centred('VERSION 01', { size: 1.79, tracking: 0.32 / 1.79, y: 74.6, fill: M }) +
      \`</g>\`;
  } else {
    identity =
      \`<rect x="14.61" y="24.62" width="24.77" height="24.77" rx="0.6" fill="none" stroke="\${M}" stroke-width="0.16"/>\` +
      \`<rect x="15.51" y="25.52" width="22.97" height="22.97" rx="0.3" fill="\${c.plate}"/>\` +
      \`<path d="\${FINDERS}" fill="\${c.qr}" fill-rule="evenodd"/>\` +
      \`<rect x="17.99" y="28" width="18" height="18" fill="none" stroke="\${c.qr}" stroke-width="0.08" stroke-dasharray="0.5 0.5" opacity="0.45"/>\` +
      centred('QR ZONE', { font: 'inter600', size: 1.3, tracking: 0.2 / 1.3, y: 37.4, fill: c.qr, opacity: 0.7 }) +
      centred('18 mm · per card', { size: 1, tracking: 0, y: 39.4, fill: c.qr, opacity: 0.55 }) +
      \`<g filter="\${P.FOIL}">\` +
      \`<path d="\${TAP.arcs}" fill="none" stroke="\${M}" stroke-width="0.3" stroke-linecap="round"/><path d="\${TAP.dot}" fill="\${M}"/>\` +
      centred('TAP OR SCAN', { size: 2.06, tracking: 0.62 / 2.06, y: 22.75, fill: M }) +
      centred('AR1-' + c.code + '-000042', { size: 2.34, tracking: 0.33 / 2.34, y: 57.85, fill: M }) +
      \`<path d="\${MARK.d}" transform="translate(24.99 61.2) scale(0.009346)" fill="\${M}" fill-rule="evenodd"/>\` +
      \`</g>\` +
      centred('CHAPTER I · Nº 042 / 100', { size: 1.65, tracking: 0.26 / 1.65, y: 53.6, fill: c.bMuted }) +
      centred('SHYGON TECHNOLOGIES PVT. LTD.', { size: 1.65, tracking: 0.33 / 1.65, y: 72.63, fill: c.bInk }) +
      centred('EDITION ' + c.no + ' · ' + c.name.toUpperCase(), { size: 1.5, tracking: 0.3 / 1.5, y: 77.2, fill: c.bMuted });
  }

  const label = 'SHYGON AAROH ' + c.name + ' card, ' + (back ? 'back' : 'front') + ', ' + (B ? 'Tier B premium finish' : 'Tier A standard print');
  return (
    \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53.98 85.6" width="\${n(53.98 * px)}" height="\${n(85.6 * px)}" role="img" aria-label="\${label}">\` +
    \`<title>\${label}</title><desc>Concept artwork from the AAROH design canvas (Card component). PROPOSED — REQUIRES VALIDATION. Not production artwork. The QR is a placeholder; the serial and chapter are examples.</desc>\` +
    \`<defs>\${defs}</defs>\` +
    \`<g clip-path="\${u.clip}">\` +
    \`<rect width="53.98" height="85.6" fill="\${u.base}"/>\` +
    \`<rect width="53.98" height="85.6" fill="#808080" filter="\${u.tex}" opacity="\${tx.k}" style="mix-blend-mode: soft-light"/>\` +
    \`<g mask="\${back ? u.bmask : u.mask}" opacity="\${back ? c.backOp : 1}">\${layers.map(layerSvg).join('')}</g>\` +
    \`<rect width="53.98" height="85.6" fill="\${u.light}"/><rect width="53.98" height="85.6" fill="\${u.sheen}"/><rect width="53.98" height="85.6" fill="\${u.vig}"/>\` +
    identity +
    \`</g>\` +
    \`<rect x="0.22" y="0.22" width="53.54" height="85.16" rx="2.98" fill="none" stroke="\${B ? u.metal : 'none'}" stroke-width="0.44"/>\` +
    \`<rect x="0.05" y="0.05" width="53.88" height="85.5" rx="3.13" fill="none" stroke="\${c.edge}" stroke-width="0.1"/>\` +
    \`</svg>\`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let count = 0;
  for (const [storeId] of STORE_EDITIONS) {
    for (const finish of Object.keys(FINISHES)) {
      for (const side of ['front', 'back']) {
        fs.writeFileSync(path.join(OUT, \`\${storeId}-\${finish}-\${side}.svg\`), cardSvg(storeId, { side, finish }));
        count++;
      }
    }
  }
  console.log(\`wrote \${count} edition SVGs to design-assets/editions/\`);
}
`;
fs.writeFileSync(path.join(root, 'design-assets', 'src', 'editions.mjs'), out);
console.log(`editions.mjs generated (${verbatim.length} chars verbatim, canvas sha256 ${sha.slice(0, 16)})`);
