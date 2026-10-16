// SHYGON Version 1 — AAROH: concept artwork for DESIGN.md (round 2, portrait).
//
// Every face is drawn here, in millimetres, on the ID-1 card held upright
// (53.98 wide × 85.60 tall, r 3.18), and rendered as material rather than as
// flat lines: lighting filters raise the relief, bevel the foil and light the
// metal edge. The SHYGON wordmark and mark are the project's own outlines
// (scripts/brand/logo.mjs), scaled uniformly and never redrawn. The AAROH lotus
// emblem is an original construction proposed here (it needs the owner's
// approval as a brand asset). Text is outlined from the self-hosted fonts.
// Nothing here is production artwork: these are CONCEPTS, PROPOSED — REQUIRES
// VALIDATION with the card manufacturer.
//
//   node design-assets/src/build.mjs        writes design-assets/**
//   node design-assets/src/sheet.mjs        the presentation sheet
//   node design-assets/src/render.mjs       PNG previews, store images, coverage
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { text as outline } from '../../scripts/brand/type.mjs';
import { MARK, WORDMARK } from '../../scripts/brand/logo.mjs';

const require = createRequire(import.meta.url);
const opentype = require('opentype.js');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..');

// ---------------------------------------------------------------- geometry ---

export const W = 53.98;
export const H = 85.6;
export const R = 3.18;
export const CX = W / 2;
export const SAFE = 4.0;
/** Relief and bleed print stop this far inside the die line. */
export const RELIEF_INSET = 1.0;

const f = (n) => +n.toFixed(3);
/** Outlined text at millimetre precision. */
const text = (str, opts) => outline(str, { decimals: 3, ...opts });

const FONTS = {
  inter400: '@fontsource/inter/files/inter-latin-400-normal.woff',
  inter500: '@fontsource/inter/files/inter-latin-500-normal.woff',
  serif400: '@fontsource/playfair-display/files/playfair-display-latin-400-normal.woff',
};
const capCache = new Map();
function capRatio(key) {
  if (!capCache.has(key)) {
    const buf = fs.readFileSync(require.resolve(FONTS[key]));
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    capCache.set(key, font.tables.os2.sCapHeight / font.unitsPerEm);
  }
  return capCache.get(key);
}

// The SHYGON wordmark's letters stand 44.2 of its 49 units.
const WORDMARK_CAP_UNITS = 44.2;

// ------------------------------------------------------------ the emblem ---

/**
 * The AAROH lotus emblem (proposal). An original construction in a 20 × 19
 * box: a pointed central petal with an inner vein petal, two pairs of petals
 * opening outwards, a bindu above and two water lines below. Drawn as strokes
 * so it reads as engraved foil, not as a filled icon.
 */
export const LOTUS = {
  width: 20,
  height: 19,
  strokes: [
    'M10 15.6C5.4 16 1.4 13.8 0.6 10.2C3.8 10.2 7.2 12.2 10 15.6',
    'M10 15.6C14.6 16 18.6 13.8 19.4 10.2C16.2 10.2 12.8 12.2 10 15.6',
    'M10 15.6C6.2 14.8 3.8 11.2 4.1 6.6C6.9 8 8.8 11 10 15.6',
    'M10 15.6C13.8 14.8 16.2 11.2 15.9 6.6C13.1 8 11.2 11 10 15.6',
    'M10 15.6C6.9 12.2 7.3 6.2 10 2.2C12.7 6.2 13.1 12.2 10 15.6',
    'M10 13.4C8.7 11.2 8.9 7.8 10 5.2C11.1 7.8 11.3 11.2 10 13.4',
    'M3.2 16.9C7.1 18.5 12.9 18.5 16.8 16.9',
    'M6.4 18.3C8.8 18.9 11.2 18.9 13.6 18.3',
  ],
  bindu: { x: 10, y: 0.7, r: 0.62 },
  stroke: 0.5,
};

/** Scales and moves an absolute M/L/C/Z path. */
function placePath(d, s, tx, ty) {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+/g);
  let out = '';
  let axis = 0;
  for (const t of tokens) {
    if (/[MLCZ]/.test(t)) {
      out += t;
      axis = 0;
    } else {
      const v = parseFloat(t) * s + (axis === 0 ? tx : ty);
      out += (out.endsWith(' ') || /[MLCZ]$/.test(out) ? '' : ' ') + f(v);
      axis = 1 - axis;
    }
  }
  return out;
}

/** The lotus emblem centred on x = cx, top at y, `width` mm wide. */
export function lotus(cx, top, width, paint) {
  const s = width / LOTUS.width;
  const tx = cx - (LOTUS.width * s) / 2;
  const d = LOTUS.strokes.map((p) => placePath(p, s, tx, top)).join('');
  const b = LOTUS.bindu;
  return (
    `<path d="${d}" fill="none" stroke="${paint}" stroke-width="${f(LOTUS.stroke * s)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="${f(tx + b.x * s)}" cy="${f(top + b.y * s)}" r="${f(b.r * s)}" fill="${paint}"/>`
  );
}

// ------------------------------------------------------------------ layout ---

const EMBLEM_WIDTH = 14.0;
/** Front layout (origin: top-left of the front face; card upright). */
export const FRONT = {
  emblem: { cx: CX, top: 12.0, width: EMBLEM_WIDTH, height: (EMBLEM_WIDTH * LOTUS.height) / LOTUS.width },
  wordmark: { text: 'AAROH', font: 'serif400', cap: 4.4, top: 33.0, tracking: 0.3 },
  byline: { by: 'BY', font: 'inter500', cap: 1.25, top: 40.6, tracking: 0.62, gap: 2.1 },
  version: { text: 'VERSION 01', font: 'inter500', cap: 1.3, baseline: 74.6, tracking: 0.18 },
};

/** Back layout (origin: top-left of the back face; card upright). */
const QR_MODULES = 29; // version 3; the final version follows the real URL length
export const BACK = {
  nfc: { cx: CX, cy: 14.0 },
  instruction: { text: 'TAP OR SCAN', font: 'inter500', cap: 1.5, centre: 22.0, tracking: 0.3 },
  qr: { x: CX - 9, y: 28.0, size: 18.0, modules: QR_MODULES, quiet: 4 },
  serial: { text: 'AR01-000001', font: 'inter500', cap: 1.7, centre: 57.0, tracking: 0.14 },
  // 7.46 mm tall is 4.0 mm wide: the mark's minimum size (DESIGN.md §7).
  mark: { top: 61.2, height: 7.46 },
  company: { text: 'SHYGON TECHNOLOGIES', font: 'inter500', cap: 1.25, centre: 72.0, tracking: 0.3 },
};
const QR_MODULE = BACK.qr.size / BACK.qr.modules;
const QR_QUIET = BACK.qr.quiet * QR_MODULE;
export const QR_CLEAR = {
  x: BACK.qr.x - QR_QUIET,
  y: BACK.qr.y - QR_QUIET,
  size: BACK.qr.size + 2 * QR_QUIET,
  module: QR_MODULE,
};

function typeset(spec, x = CX, anchor = 'middle') {
  const size = spec.cap / capRatio(spec.font);
  const baseline = spec.baseline ?? (spec.top !== undefined ? spec.top + spec.cap : spec.centre + spec.cap / 2);
  const t = text(spec.text, { font: spec.font, size, tracking: spec.tracking, x, y: baseline, anchor });
  return { d: t.d, width: t.width, size, baseline, left: anchor === 'middle' ? x - t.width / 2 : x };
}

/** The real SHYGON mark, scaled uniformly, top at y, h mm tall, centred on cx. */
function markPath(cx, y, h, fill) {
  const s = h / MARK.height;
  const x = cx - (MARK.width * s) / 2;
  return `<path fill="${fill}" fill-rule="evenodd" transform="translate(${f(x)} ${f(y)}) scale(${+s.toFixed(6)})" d="${MARK.d}"/>`;
}

/** "BY" + the real SHYGON wordmark, centred, at the byline's position. */
function byline(fill) {
  const b = FRONT.byline;
  const size = b.cap / capRatio(b.font);
  const by = text('BY', { font: b.font, size, tracking: b.tracking, x: 0, y: 0 });
  const s = b.cap / WORDMARK_CAP_UNITS;
  const wmWidth = WORDMARK.width * s;
  const total = by.width + b.gap + wmWidth;
  const left = CX - total / 2;
  const baseline = b.top + b.cap;
  const t = text('BY', { font: b.font, size, tracking: b.tracking, x: left, y: baseline });
  const wx = left + by.width + b.gap;
  const wy = baseline - b.cap - 2 * s;
  return {
    svg: `<path fill="${fill}" d="${t.d}"/><path fill="${fill}" transform="translate(${f(wx)} ${f(wy)}) scale(${+s.toFixed(6)})" d="${WORDMARK.d}"/>`,
    left,
    width: total,
    baseline,
  };
}

// ------------------------------------------------------------- the editions ---

export const EDITIONS = [
  {
    id: 'signature-noir',
    number: '01',
    name: 'Signature Noir',
    texture: 'Architectural Relief',
    finish: 'Soft-touch matte black, champagne-gold foil and a gold edge',
    colours: [
      ['Primary black', '#101010'],
      ['Secondary graphite', '#252525'],
      ['Champagne gold', '#C6A567'],
      ['Highlight gold', '#E2C98E'],
      ['Shadow detail', '#080808'],
    ],
    dark: true,
    base: ['#1c1c1c', '#121212', '#070707'],
    foil: [['#F4E2B4', 0], ['#E2C98E', 0.18], ['#C6A567', 0.4], ['#8E7240', 0.6], ['#D9BE84', 0.8], ['#B79656', 1]],
    edge: [['#E9D29A', 0], ['#B28D4E', 0.5], ['#E2C98E', 1]],
    spec: '#FFF1CF',
    ink: { word: 'foil', by: 'foil', version: '#C6A567', back: 'foil', serial: '#E2C98E', company: '#8E8676', mark: 'foil' },
    qrPlate: { fill: '#EFE6D3', module: '#101010', frame: true },
  },
  {
    id: 'ivory-atelier',
    number: '02',
    name: 'Ivory Atelier',
    texture: 'Crafted Stone',
    finish: 'Warm ivory satin, blind-embossed botanical relief, champagne-gold foil and a gold edge',
    colours: [
      ['Primary ivory', '#F0E8D9'],
      ['Warm stone', '#D9CCB6'],
      ['Champagne gold', '#B59A64'],
      ['Shadow beige', '#C7B79E'],
      ['Typography', '#292720'],
    ],
    dark: false,
    base: ['#F7F1E5', '#EFE6D5', '#E3D7C1'],
    foil: [['#D8BF86', 0], ['#B59A64', 0.25], ['#93783F', 0.48], ['#6F5A30', 0.66], ['#B0935C', 0.86], ['#8E7546', 1]],
    edge: [['#E7D3A0', 0], ['#A88A52', 0.5], ['#DCC28A', 1]],
    spec: '#FFF6DE',
    ink: { word: '#5E5546', by: 'foil', version: '#6B6252', back: 'foil', serial: '#292720', company: '#5C574B', mark: 'foil' },
    qrPlate: { fill: '#F8F3E9', module: '#292720', frame: true },
  },
  {
    id: 'midnight-titanium',
    number: '03',
    name: 'Midnight Titanium',
    texture: 'Precision Flow',
    finish: 'Brushed deep blue, flowing platinum-silver lines and a silver edge',
    colours: [
      ['Primary midnight blue', '#101D32'],
      ['Secondary navy', '#192A45'],
      ['Graphite blue', '#26354A'],
      ['Platinum silver', '#C7CDD4'],
      ['Highlight silver', '#E5E8EC'],
    ],
    dark: true,
    base: ['#1d3150', '#132340', '#0a1528'],
    foil: [['#FFFFFF', 0], ['#E5E8EC', 0.18], ['#C7CDD4', 0.42], ['#7F8996', 0.62], ['#DCE0E5', 0.82], ['#AEB5BF', 1]],
    edge: [['#EEF0F3', 0], ['#8F98A4', 0.5], ['#D7DCE2', 1]],
    spec: '#FFFFFF',
    ink: { word: 'foil', by: 'foil', version: '#C7CDD4', back: 'foil', serial: '#E5E8EC', company: '#8592A5', mark: 'foil' },
    qrPlate: { fill: '#E5E8EC', module: '#101D32', frame: true },
  },
];

// ---------------------------------------------------------------- patterns ---
// Each returns { d: stroked lines, fill?: filled shapes, accent?: foil lines }
// in card millimetres. They are drawn as height for the relief filter, so the
// paint never shows: only the light and shadow they cast.

const poly = (pts, close = false) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + (close ? 'Z' : '');

/** Noir A (selected): a Mughal ogee lattice — mirrored sine waves meeting in
 *  onion-shaped cells, each holding a four-petal rosette. Cells 9 × 14 mm. */
export function ogeeLattice({ d = 9, lambda = 14, y0 = 1.5 } = {}) {
  const a = d / 2;
  const lines = [];
  for (let j = -4; j <= 4; j++) {
    const x0 = CX + j * d;
    for (const sign of [1, -1]) {
      const pts = [];
      for (let y = -2; y <= H + 2; y += 0.35) pts.push([x0 + sign * a * Math.sin((2 * Math.PI * (y - y0)) / lambda), y]);
      lines.push(poly(pts));
    }
  }
  const rosettes = [];
  const petal = (cx, cy, rot) => {
    const rad = (rot * Math.PI) / 180;
    const p = (x, y) => [cx + x * Math.cos(rad) - y * Math.sin(rad), cy + x * Math.sin(rad) + y * Math.cos(rad)];
    const [a1, a2, a3, a4] = [p(0, 0), p(-0.7, -0.7), p(0, -1.55), p(0.7, -0.7)];
    return `M${f(a1[0])} ${f(a1[1])}Q${f(a2[0])} ${f(a2[1])} ${f(a3[0])} ${f(a3[1])}Q${f(a4[0])} ${f(a4[1])} ${f(a1[0])} ${f(a1[1])}Z`;
  };
  for (let j = -4; j <= 4; j++) {
    for (let m = -1; m <= Math.ceil(H / lambda) + 1; m++) {
      for (const [dx, dy] of [[0, lambda / 4], [d / 2, (3 * lambda) / 4]]) {
        const cx = CX + j * d + dx;
        const cy = y0 + m * lambda + dy;
        if (cx < -3 || cx > W + 3 || cy < -3 || cy > H + 3) continue;
        for (const rot of [0, 90, 180, 270]) rosettes.push(petal(cx, cy, rot));
      }
    }
  }
  return { d: lines.join(''), fill: rosettes.join(''), stroke: 0.3 };
}

/** One onion (ogee) dome on centre cx, from a base half-width, spring height and apex. */
function dome(cx, halfW, spring, apex, base = H - SAFE) {
  const CX = cx;
  const l = CX - halfW;
  const r = CX + halfW;
  const neck = (spring - apex) * 0.42;
  return (
    `M${f(l)} ${f(base)}V${f(spring)}` +
    `C${f(l)} ${f(spring - neck * 1.3)} ${f(CX - halfW * 0.38)} ${f(apex + neck * 0.95)} ${f(CX - halfW * 0.16)} ${f(apex + neck * 0.42)}` +
    `C${f(CX - halfW * 0.06)} ${f(apex + neck * 0.2)} ${f(CX - 0.18)} ${f(apex + 0.5)} ${f(CX)} ${f(apex)}` +
    `C${f(CX + 0.18)} ${f(apex + 0.5)} ${f(CX + halfW * 0.06)} ${f(apex + neck * 0.2)} ${f(CX + halfW * 0.16)} ${f(apex + neck * 0.42)}` +
    `C${f(CX + halfW * 0.38)} ${f(apex + neck * 0.95)} ${f(r)} ${f(spring - neck * 1.3)} ${f(r)} ${f(spring)}V${f(base)}`
  );
}

/** Noir: a temple skyline in gold — a tall onion dome holding VERSION 01, two
 *  chhatris either side, and a plinth line on the safe margin. */
const SIDE_DOME_X = 18.4;
function templeDome() {
  const base = H - SAFE;
  const domes = [dome(CX, 13, 66, 50.2, base), dome(CX, 11.8, 66.6, 52, base), dome(CX, 10.6, 67.2, 53.8, base)];
  const chhatris = [-1, 1].flatMap((s) => [
    dome(CX + s * SIDE_DOME_X, 4, 72.8, 64.8, base),
    dome(CX + s * SIDE_DOME_X, 3, 73.4, 66.8, base),
  ]);
  const finials =
    `M${f(CX)} ${f(50.2)}V${f(48.4)}` +
    [-1, 1].map((s) => `M${f(CX + s * SIDE_DOME_X)} ${f(64.8)}V${f(63.6)}`).join('');
  const plinth = `M${f(SAFE)} ${f(base)}H${f(W - SAFE)}`;
  return { domes, chhatris, finials, plinth };
}

/** Noir C: temple-arch rays — rows of concentric ogee arches. */
export function templeArches() {
  const lines = [];
  for (let y = 12; y < H + 12; y += 11) {
    for (let x = (Math.round(y / 11) % 2 ? 0 : 6); x < W + 12; x += 12) {
      for (let k = 0; k < 4; k++) {
        const hw = 5.4 - k * 1.1;
        const l = x - hw;
        const r = x + hw;
        const apex = y - 9 + k * 1.4;
        const spring = y - 3.5;
        lines.push(
          `M${f(l)} ${f(y)}V${f(spring)}C${f(l)} ${f(spring - 2.6)} ${f(x - 1)} ${f(apex + 1.4)} ${f(x)} ${f(apex)}` +
            `C${f(x + 1)} ${f(apex + 1.4)} ${f(r)} ${f(spring - 2.6)} ${f(r)} ${f(spring)}V${f(y)}`,
        );
      }
    }
  }
  return { d: lines.join(''), stroke: 0.3 };
}

/** Noir B (round 1): the octagram jaali. */
export function jaaliOctagram({ P = 5.4 } = {}) {
  const r = P / 2;
  const a = r / Math.SQRT2;
  const k = 0.56;
  const lines = [];
  for (let i = -6; i <= 6; i++) {
    for (let j = -9; j <= 9; j++) {
      const cx = CX + i * P;
      const cy = H / 2 + j * P;
      if (cx < -P || cx > W + P || cy < -P || cy > H + P) continue;
      lines.push(poly([[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], true));
      lines.push(poly([[cx - a, cy - a], [cx + a, cy - a], [cx + a, cy + a], [cx - a, cy + a]], true));
      lines.push(poly([[cx, cy - r * k], [cx + r * k, cy], [cx, cy + r * k], [cx - r * k, cy]], true));
    }
  }
  return { d: lines.join(''), stroke: 0.3 };
}

/** A small seeded random generator, so the art is the same on every build. */
function seeded(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Point and tangent on a cubic Bézier. */
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const pt = [0, 1].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i]);
  const tan = [0, 1].map((i) => 3 * u * u * (p1[i] - p0[i]) + 6 * u * t * (p2[i] - p1[i]) + 3 * t * t * (p3[i] - p2[i]));
  return { pt, tan };
}

/** A leaf from its base, pointing along `angle`, `len` long, with its vein cut
 *  out (even-odd), so it embosses as a raised blade with a groove. */
function leaf(x, y, angle, len) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const p = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const w = len * 0.34;
  const pts = (...list) => list.map(([a, b]) => `${f(a)} ${f(b)}`).join(' ');
  const blade = `M${pts(p(0, 0))}C${pts(p(len * 0.22, -w), p(len * 0.72, -w * 0.8), p(len, 0))}C${pts(p(len * 0.72, w * 0.8), p(len * 0.22, w), p(0, 0))}Z`;
  const vw = Math.min(0.14, len * 0.03);
  const vein = `M${pts(p(len * 0.12, 0))}Q${pts(p(len * 0.45, -vw), p(len * 0.8, 0))}Q${pts(p(len * 0.45, vw), p(len * 0.12, 0))}Z`;
  return blade + vein;
}

/** A tendril: a curl that tightens as it goes. */
function tendril(x, y, heading, dir, len = 3.4, turns = 1.5) {
  const pts = [[x, y]];
  const n = 48;
  const total = turns * 2 * Math.PI;
  let a = heading;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    a += dir * (total / n) * (0.4 + 1.2 * t);
    const step = (len / n) * (1 - 0.6 * t);
    x += step * Math.cos(a);
    y += step * Math.sin(a);
    pts.push([x, y]);
  }
  return poly(pts);
}

/** A branch along a cubic Bézier, with alternating leaves, berries and a tendril. */
function branch(curve, { leaves, len, dir, rnd }) {
  const [p0, p1, p2, p3] = curve;
  const stem = `M${f(p0[0])} ${f(p0[1])}C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`;
  const blades = [];
  const berries = [];
  let side = 1;
  for (let i = 0; i < leaves; i++) {
    const t = 0.06 + (0.86 * i) / (leaves - 1);
    const { pt, tan } = bezier(p0, p1, p2, p3, t);
    const ang = Math.atan2(tan[1], tan[0]) + side * (0.62 + rnd() * 0.2);
    blades.push(leaf(pt[0], pt[1], ang, len * (1 - t * 0.45) * (0.9 + rnd() * 0.18)));
    if (i % 3 === 1) {
      const b = Math.atan2(tan[1], tan[0]) - side * 1.25;
      berries.push([pt[0] + 1.3 * Math.cos(b), pt[1] + 1.3 * Math.sin(b)]);
    }
    side = -side;
  }
  const end = bezier(p0, p1, p2, p3, 1);
  const curl = tendril(end.pt[0], end.pt[1], Math.atan2(end.tan[1], end.tan[0]), dir);
  return { stem: stem + curl, blades, berries };
}

/** Ivory A (selected): a botanical garland in blind emboss — two leafy branches
 *  rising from the bottom centre around VERSION 01, and a sprig in each top corner. */
export function botanicalVine() {
  const rnd = seeded(29);
  const mirror = (curve) => curve.map(([x, y]) => [W - x, y]);
  const garland = [[CX - 1.2, H - 3.4], [CX - 18, H - 2.4], [3.2, H - 15], [5.8, 47.5]];
  const sprig = [[2.6, 13], [3.4, 7], [7.6, 4.8], [14, 5.8]];
  const parts = [
    branch(garland, { leaves: 11, len: 5.0, dir: 1, rnd }),
    branch(mirror(garland), { leaves: 11, len: 5.0, dir: -1, rnd }),
    branch(sprig, { leaves: 5, len: 3.4, dir: 1, rnd }),
    branch(mirror(sprig), { leaves: 5, len: 3.4, dir: -1, rnd }),
  ];
  const berries = parts.flatMap((p) => p.berries).map(([x, y]) => `M${f(x + 0.42)} ${f(y)}a0.42 0.42 0 1 0 -0.84 0a0.42 0.42 0 1 0 0.84 0`);
  return {
    d: parts.map((p) => p.stem).join(''),
    shapes: parts.flatMap((p) => p.blades),
    fill: berries.join(''),
    extra: lotus(CX, H - 7.6, 4.6, '#000'),
    stroke: 0.3,
  };
}

/** Ivory C: a lotus petal field — rows of overlapping petal arcs. */
export function petalField() {
  const lines = [];
  for (let y = 0; y < H + 6; y += 3.6) {
    for (let x = (Math.round(y / 3.6) % 2 ? 0 : 2.6); x < W + 6; x += 5.2) {
      lines.push(`M${f(x - 2.6)} ${f(y)}C${f(x - 2.4)} ${f(y - 2.6)} ${f(x - 0.6)} ${f(y - 3.6)} ${f(x)} ${f(y - 4.2)}C${f(x + 0.6)} ${f(y - 3.6)} ${f(x + 2.4)} ${f(y - 2.6)} ${f(x + 2.6)} ${f(y)}`);
    }
  }
  return { d: lines.join(''), stroke: 0.26 };
}

/** Ivory B (round 1): stepwell diamonds. */
export function stepwell({ r = 6.4 } = {}) {
  const stepped = (cx, cy, rr, n) => {
    const s = rr / n;
    const quarter = [];
    let x = rr;
    let y = 0;
    quarter.push([x, y]);
    for (let i = 0; i < n; i++) {
      y += s;
      quarter.push([x, y]);
      x -= s;
      quarter.push([x, y]);
    }
    const pts = [];
    for (let q = 0; q < 4; q++) {
      for (const [px, py] of quarter.slice(0, -1)) {
        let qx = px;
        let qy = py;
        for (let t = 0; t < q; t++) [qx, qy] = [-qy, qx];
        pts.push([cx + qx, cy + qy]);
      }
    }
    return poly(pts, true);
  };
  const lines = [];
  for (let j = -8; j <= 8; j++) {
    for (let i = -4; i <= 4; i++) {
      const cx = CX + i * 2 * r + (Math.abs(j) % 2 ? r : 0);
      const cy = H / 2 + j * r;
      if (cx < -r || cx > W + r || cy < -r || cy > H + r) continue;
      lines.push(stepped(cx, cy, r, 4), stepped(cx, cy, r - 1.6, 3));
    }
  }
  return { d: lines.join(''), stroke: 0.28 };
}

/** Midnight A (selected): a silver flow — a fan of lines rising from the left
 *  edge and opening towards the top right, with a smaller answering fan below
 *  that keeps clear of VERSION 01. Every third line is platinum; the rest are
 *  etched. Adjacent lines stay at least 0.68 mm apart, so they never merge. */
export function silverFlow() {
  const etched = [];
  const silver = [];
  const fan = (n, at) => {
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const d = at(u);
      (i % 3 === 1 ? silver : etched).push(d);
    }
  };
  fan(13, (u) => {
    const p0 = [RELIEF_INSET, 44 + u * 14];
    const p1 = [15 + u * 3, 47 + u * 13];
    const p2 = [27 + u * 7, 34 - u * 6];
    const p3 = [W - RELIEF_INSET, 1 + u * 26];
    return `M${f(p0[0])} ${f(p0[1])}C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`;
  });
  fan(7, (u) => {
    const p0 = [W - RELIEF_INSET, 71 + u * 7];
    const p1 = [W - 12, 74 + u * 6];
    const p2 = [31 + u, 79.5 + u * 2.5];
    const p3 = [8 + u * 24, H - RELIEF_INSET];
    return `M${f(p0[0])} ${f(p0[1])}C${f(p1[0])} ${f(p1[1])} ${f(p2[0])} ${f(p2[1])} ${f(p3[0])} ${f(p3[1])}`;
  });
  return { d: etched.join(''), accent: silver.join(''), stroke: 0.24 };
}

/** Midnight B (round 1): mirrored contours of a computed landform. */
export function mirroredContours() {
  const field = (x, y) => {
    const g = (x0, y0, sx, sy, a) => a * Math.exp(-(((x - x0) / sx) ** 2 + ((y - y0) / sy) ** 2));
    const half = (xx) => {
      const gx = (x0, y0, sx, sy, a) => a * Math.exp(-(((xx - x0) / sx) ** 2 + ((y - y0) / sy) ** 2));
      return gx(8, 70, 14, 18, 1.0) + gx(2, 12, 11, 14, 0.6);
    };
    return half(x) + half(W - x) - g(CX, 34, 14, 16, 0.55) + 0.004 * y;
  };
  const step = 0.25;
  const nx = Math.ceil(W / step) + 1;
  const ny = Math.ceil(H / step) + 1;
  const v = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) v[j * nx + i] = field(i * step, j * step);
  const segs = [];
  for (let k = 0; k < 34; k++) {
    const level = -0.4 + k * 0.045;
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const x0 = i * step, y0 = j * step, x1 = x0 + step, y1 = y0 + step;
        const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
        const lerp = (p, q, vp, vq) => p + ((level - vp) / (vq - vp)) * (q - p);
        const pts = [];
        if ((a > level) !== (b > level)) pts.push([lerp(x0, x1, a, b), y0]);
        if ((b > level) !== (c > level)) pts.push([x1, lerp(y0, y1, b, c)]);
        if ((d > level) !== (c > level)) pts.push([lerp(x0, x1, d, c), y1]);
        if ((a > level) !== (d > level)) pts.push([x0, lerp(y0, y1, a, d)]);
        if (pts.length >= 2) segs.push(`M${f(pts[0][0])} ${f(pts[0][1])}L${f(pts[1][0])} ${f(pts[1][1])}`);
      }
    }
  }
  return { d: segs.join(''), stroke: 0.22 };
}

/** Midnight C (round 1): a machined guilloché. */
export function guilloche() {
  const lines = [];
  for (const [ox, oy] of [[CX, H * 0.72]]) {
    for (let k = 1; k <= 30; k++) {
      const pts = [];
      for (let s = 0; s <= 200; s++) {
        const t = (s / 200) * Math.PI * 2;
        const rr = k * 1.15 + 0.35 * Math.sin(12 * t + k * 0.4);
        pts.push([ox + rr * Math.cos(t), oy + rr * Math.sin(t)]);
      }
      lines.push(poly(pts, true));
    }
  }
  return { d: lines.join(''), stroke: 0.22 };
}

export const TEXTURE_CONCEPTS = {
  'signature-noir': [
    { key: 'A', name: 'Mughal Ogee Lattice', build: ogeeLattice, selected: true },
    { key: 'B', name: 'Octagram Jaali', build: jaaliOctagram },
    { key: 'C', name: 'Temple Arch Rays', build: templeArches },
  ],
  'ivory-atelier': [
    { key: 'A', name: 'Botanical Vine', build: botanicalVine, selected: true },
    { key: 'B', name: 'Stepwell Diamonds', build: stepwell },
    { key: 'C', name: 'Lotus Petal Field', build: petalField },
  ],
  'midnight-titanium': [
    { key: 'A', name: 'Silver Flow', build: silverFlow, selected: true },
    { key: 'B', name: 'Mirrored Contours', build: mirroredContours },
    { key: 'C', name: 'Machined Guilloché', build: guilloche },
  ],
};

// --------------------------------------------------------------- materials ---

const stops = (list, opacity = 1) => list.map(([c, o]) => `<stop offset="${o}" stop-color="${c}"${opacity < 1 ? ` stop-opacity="${opacity}"` : ''}/>`).join('');

/** Splits a diffuse-lit height map into a white highlight layer and a tinted shadow layer. */
function lightSplit({ elev, kHi, kLo, shadow, prefix }) {
  const flat = Math.sin((elev * Math.PI) / 180);
  const [r, g, b] = shadow;
  return (
    `<feColorMatrix in="${prefix}d" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  ${kHi} 0 0 0 ${f(-kHi * flat)}" result="${prefix}hi"/>` +
    `<feColorMatrix in="${prefix}d" type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${-kLo} 0 0 0 ${f(kLo * flat)}" result="${prefix}lo"/>` +
    `<feMerge><feMergeNode in="${prefix}lo"/><feMergeNode in="${prefix}hi"/></feMerge>`
  );
}

const MATERIAL = {
  'signature-noir': {
    grain: { freq: '3.1', octaves: 3, scale: 0.75, elev: 56, kHi: 0.55, kLo: 0.95, shadow: [0, 0, 0] },
    relief: { blur: 0.14, scale: 3.0, elev: 34, kHi: 0.34, kLo: 0.85, shadow: [0, 0, 0], raised: true },
  },
  'ivory-atelier': {
    grain: { freq: '3.4', octaves: 2, scale: 0.35, elev: 60, kHi: 0.4, kLo: 0.3, shadow: [0.45, 0.38, 0.27] },
    relief: { blur: 0.18, scale: 3.4, elev: 32, kHi: 1.3, kLo: 0.58, shadow: [0.42, 0.34, 0.22], raised: true },
  },
  'midnight-titanium': {
    grain: { freq: '0.035 3.4', octaves: 2, scale: 1.6, elev: 48, kHi: 0.55, kLo: 0.7, shadow: [0.02, 0.04, 0.09] },
    relief: { blur: 0.1, scale: -2.6, elev: 34, kHi: 0.8, kLo: 1.1, shadow: [0.01, 0.03, 0.08], raised: false },
  },
};

function defs(e, uid, { raking = false } = {}) {
  const m = MATERIAL[e.id];
  const [light, mid, deep] = e.base;
  const g = m.grain;
  const rl = { ...m.relief, elev: raking ? 16 : m.relief.elev, kHi: m.relief.kHi * (raking ? 1.4 : 1), kLo: m.relief.kLo * (raking ? 1.5 : 1) };
  return (
    `<linearGradient id="${uid}foil" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H * 0.62}">${stops(e.foil)}</linearGradient>` +
    `<linearGradient id="${uid}foilBox" x1="0" y1="0" x2="1" y2="1">${stops(e.foil)}</linearGradient>` +
    `<linearGradient id="${uid}edge" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}">${stops(e.edge)}</linearGradient>` +
    `<radialGradient id="${uid}base" gradientUnits="userSpaceOnUse" cx="${f(W * 0.3)}" cy="${f(H * 0.18)}" r="${f(H * 1.05)}">${stops([[light, 0], [mid, 0.5], [deep, 1]])}</radialGradient>` +
    // A soft window reflection across the face, and a darker lower corner.
    `<linearGradient id="${uid}sheen" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="${H}">` +
    `<stop offset="0.18" stop-color="#fff" stop-opacity="0"/><stop offset="0.34" stop-color="#fff" stop-opacity="${e.dark ? 0.09 : 0.28}"/>` +
    `<stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="0.8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${e.dark ? 0.35 : 0.1}"/></linearGradient>` +
    `<filter id="${uid}grain" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">` +
    `<feTurbulence type="fractalNoise" baseFrequency="${g.freq}" numOctaves="${g.octaves}" seed="7" result="${uid}n"/>` +
    `<feColorMatrix in="${uid}n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  1 0 0 0 0" result="${uid}na"/>` +
    `<feDiffuseLighting in="${uid}na" surfaceScale="${g.scale}" diffuseConstant="1" lighting-color="#fff" result="${uid}gd"><feDistantLight azimuth="225" elevation="${g.elev}"/></feDiffuseLighting>` +
    lightSplit({ ...g, prefix: `${uid}g` }) +
    `</filter>` +
    `<filter id="${uid}relief" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="${rl.blur}" result="${uid}h"/>` +
    `<feDiffuseLighting in="${uid}h" surfaceScale="${rl.scale}" diffuseConstant="1" lighting-color="#fff" result="${uid}rd"><feDistantLight azimuth="225" elevation="${rl.elev}"/></feDiffuseLighting>` +
    lightSplit({ ...rl, prefix: `${uid}r` }) +
    `</filter>` +
    `<filter id="${uid}foilFx" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="0.06" result="${uid}fa"/>` +
    `<feSpecularLighting in="${uid}fa" surfaceScale="2.6" specularConstant="1.15" specularExponent="16" lighting-color="${e.spec}" result="${uid}fs"><feDistantLight azimuth="225" elevation="40"/></feSpecularLighting>` +
    `<feComposite in="${uid}fs" in2="SourceAlpha" operator="in" result="${uid}fsi"/>` +
    `<feComposite in="SourceGraphic" in2="${uid}fsi" operator="arithmetic" k1="0" k2="1" k3="0.7" k4="0" result="${uid}flit"/>` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="0.07" result="${uid}fb"/>` +
    `<feOffset in="${uid}fb" dx="0.05" dy="0.1" result="${uid}fo"/>` +
    `<feFlood flood-color="${e.dark ? '#000' : '#5f4f33'}" flood-opacity="${e.dark ? 0.85 : 0.4}" result="${uid}ff"/>` +
    `<feComposite in="${uid}ff" in2="${uid}fo" operator="in" result="${uid}fsh"/>` +
    `<feMerge><feMergeNode in="${uid}fsh"/><feMergeNode in="${uid}flit"/></feMerge></filter>` +
    // Debossed type (Ivory's AAROH): an inner shadow at the top left.
    `<filter id="${uid}deboss" x="-10%" y="-20%" width="120%" height="140%" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceAlpha" stdDeviation="0.07" result="${uid}db"/>` +
    `<feOffset in="${uid}db" dx="0.07" dy="0.1" result="${uid}do"/>` +
    `<feComposite in="SourceAlpha" in2="${uid}do" operator="out" result="${uid}dinner"/>` +
    `<feFlood flood-color="#2b2418" flood-opacity="0.55"/><feComposite in2="${uid}dinner" operator="in" result="${uid}dshadow"/>` +
    `<feOffset in="SourceAlpha" dx="-0.05" dy="-0.07" result="${uid}dup"/><feComposite in="SourceAlpha" in2="${uid}dup" operator="out" result="${uid}dlip"/>` +
    `<feFlood flood-color="#fff" flood-opacity="0.7"/><feComposite in2="${uid}dlip" operator="in" result="${uid}dlight"/>` +
    `<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="${uid}dshadow"/><feMergeNode in="${uid}dlight"/></feMerge></filter>` +
    // The calm zone behind the identity, and the QR clear box on the back.
    `<radialGradient id="${uid}calmFade" cx="0.5" cy="0.5" r="0.5">${stops([['#000', 0], ['#000', 0.55], ['#fff', 1]])}</radialGradient>` +
    `<mask id="${uid}calm" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
    `<ellipse cx="${CX}" cy="29.5" rx="23" ry="21" fill="url(#${uid}calmFade)"/>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${R - 0.5}" fill="none" stroke="#000" stroke-width="${RELIEF_INSET * 2 - 1}"/></mask>` +
    `<mask id="${uid}back" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>` +
    `<rect x="${f(QR_CLEAR.x - 1)}" y="${f(QR_CLEAR.y - 1)}" width="${f(QR_CLEAR.size + 2)}" height="${f(QR_CLEAR.size + 2)}" rx="1" fill="#000"/>` +
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${R - 0.5}" fill="none" stroke="#000" stroke-width="${RELIEF_INSET * 2 - 1}"/></mask>`
  );
}

/** The card's material: base colour, grain or brushing, and the light across it. */
function surface(uid) {
  return (
    `<rect width="${W}" height="${H}" fill="url(#${uid}base)"/>` +
    `<rect width="${W}" height="${H}" filter="url(#${uid}grain)"/>`
  );
}

function lightAndEdge(e, uid) {
  const edgeW = e.id === 'ivory-atelier' ? 0.7 : 0.55;
  return (
    `<rect width="${W}" height="${H}" fill="url(#${uid}sheen)"/>` +
    `<rect x="${f(edgeW / 2)}" y="${f(edgeW / 2)}" width="${f(W - edgeW)}" height="${f(H - edgeW)}" rx="${f(R - edgeW / 2)}" fill="none" stroke="url(#${uid}edge)" stroke-width="${edgeW}"/>` +
    `<rect x="${f(edgeW)}" y="${f(edgeW)}" width="${f(W - 2 * edgeW)}" height="${f(H - 2 * edgeW)}" rx="${f(R - edgeW)}" fill="none" stroke="#000" stroke-opacity="${e.dark ? 0.6 : 0.18}" stroke-width="0.08"/>`
  );
}

/** A pattern drawn as height, lit by the relief filter. */
function relief(uid, tex, mask) {
  const lines = tex.d ? `<path d="${tex.d}" fill="none" stroke="#000" stroke-width="${tex.stroke ?? 0.3}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const fills = tex.fill ? `<path d="${tex.fill}" fill="#000"/>` : '';
  const shapes = (tex.shapes ?? []).map((d) => `<path d="${d}" fill="#000" fill-rule="evenodd"/>`).join('');
  return `<g${mask ? ` mask="url(#${mask})"` : ''}><g filter="url(#${uid}relief)">${lines}${fills}${shapes}${tex.extra ?? ''}</g></g>`;
}

// ------------------------------------------------------------------- faces ---

function svgDoc({ body, defsMarkup, uid, title, view = [0, 0, W, H], px = 16, clip = true }) {
  const [vx, vy, vw, vh] = view;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${f(vw * px)}" height="${f(vh * px)}">` +
    `<title>${title}</title><desc>CONCEPT artwork for SHYGON Version 1 — AAROH (DESIGN.md). PROPOSED — REQUIRES VALIDATION. Not production artwork. Units: millimetres; card upright, 53.98 × 85.60.</desc>` +
    `<defs><clipPath id="${uid}card"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>${defsMarkup}</defs>` +
    (clip ? `<g clip-path="url(#${uid}card)">${body}</g>` : body) +
    `</svg>`
  );
}

const paintOf = (e, uid, key) => (e.ink[key] === 'foil' ? `url(#${uid}foil)` : e.ink[key]);
const foiled = (uid, inner) => `<g filter="url(#${uid}foilFx)">${inner}</g>`;

/** The edition's own front ornament, in foil. */
function frontOrnament(e, uid, tex) {
  const foil = `url(#${uid}foil)`;
  if (e.id === 'signature-noir') {
    const { domes, chhatris, finials, plinth } = templeDome();
    const diamond = (x, y, r) => `M${f(x)} ${f(y - r * 1.4)}l${r} ${f(r * 1.4)}l${-r} ${f(r * 1.4)}l${-r} ${f(-r * 1.4)}Z`;
    return foiled(
      uid,
      `<g fill="none" stroke="${foil}" stroke-linecap="round" stroke-linejoin="round">` +
        `<path d="${domes[0]}" stroke-width="0.42"/><path d="${domes[1]}${domes[2]}" stroke-width="0.2"/>` +
        `<path d="${chhatris.filter((_, i) => i % 2 === 0).join('')}" stroke-width="0.32"/><path d="${chhatris.filter((_, i) => i % 2).join('')}" stroke-width="0.16"/>` +
        `<path d="${finials}" stroke-width="0.26"/><path d="${plinth}" stroke-width="0.24"/></g>` +
        `<path d="${diamond(CX, 47.65, 0.75)}${diamond(CX - SIDE_DOME_X, 62.9, 0.42)}${diamond(CX + SIDE_DOME_X, 62.9, 0.42)}" fill="${foil}"/>`,
    );
  }
  if (e.id === 'ivory-atelier') {
    // A fine gold rule under the byline, broken by a diamond.
    return foiled(
      uid,
      `<path d="M${f(CX - 15)} ${f(46.6)}H${f(CX - 1.6)}M${f(CX + 1.6)} ${f(46.6)}H${f(CX + 15)}" stroke="${foil}" stroke-width="0.16" fill="none"/>` +
        `<path d="M${f(CX)} ${f(45.75)}l0.6 0.85l-0.6 0.85l-0.6 -0.85Z" fill="${foil}"/>`,
    );
  }
  // Midnight Titanium: the platinum lines of the flow.
  return `<g mask="url(#${uid}calm)">${foiled(uid, `<path d="${tex.accent}" fill="none" stroke="${foil}" stroke-width="0.22" stroke-linecap="round"/>`)}</g>`;
}

export function front(e, { uid = `${e.id}-f-`, view, px, raking = false, tex = null } = {}) {
  const texture = tex ?? TEXTURE_CONCEPTS[e.id].find((c) => c.selected).build();
  const word = typeset(FRONT.wordmark);
  const ver = typeset(FRONT.version);
  const by = byline(paintOf(e, uid, 'by'));
  const foil = `url(#${uid}foil)`;
  const wordmark =
    e.ink.word === 'foil'
      ? foiled(uid, `<path fill="${foil}" d="${word.d}"/>`)
      : `<g filter="url(#${uid}deboss)"><path fill="${e.ink.word}" d="${word.d}"/></g>`;
  const body =
    surface(uid) +
    relief(uid, texture, `${uid}calm`) +
    frontOrnament(e, uid, texture) +
    foiled(uid, lotus(FRONT.emblem.cx, FRONT.emblem.top, FRONT.emblem.width, foil)) +
    wordmark +
    foiled(uid, by.svg) +
    `<path fill="${paintOf(e, uid, 'version')}" d="${ver.d}" opacity="${e.dark ? 0.95 : 0.85}"/>` +
    lightAndEdge(e, uid);
  return svgDoc({ body, defsMarkup: defs(e, uid, { raking }), uid, title: `AAROH ${e.name} — front (concept)`, view, px });
}

/** A custom tap glyph: a point and three arcs. Not the NFC Forum N-Mark or the
 *  EMVCo Contactless Indicator, both of which are licensed marks. */
function tapGlyph(cx, cy, paint) {
  const o = cx - 1.375;
  const arcs = [1.4, 2.3, 3.2]
    .map((r) => {
      const a = (50 * Math.PI) / 180;
      return `M${f(o + r * Math.cos(-a))} ${f(cy + r * Math.sin(-a))}A${r} ${r} 0 0 1 ${f(o + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
    })
    .join('');
  return `<circle cx="${f(o)}" cy="${cy}" r="0.45" fill="${paint}"/><path d="${arcs}" fill="none" stroke="${paint}" stroke-width="0.32" stroke-linecap="round"/>`;
}

/** A clearly labelled QR placeholder: finder patterns only, no data modules. */
function qrPlaceholder(e, uid) {
  const { x, y, size } = BACK.qr;
  const m = QR_MODULE;
  const ink = e.qrPlate.module;
  const finder = (fx, fy) =>
    `<path fill="${ink}" fill-rule="evenodd" d="M${f(fx)} ${f(fy)}h${f(7 * m)}v${f(7 * m)}h${f(-7 * m)}ZM${f(fx + m)} ${f(fy + m)}v${f(5 * m)}h${f(5 * m)}v${f(-5 * m)}Z"/>` +
    `<rect fill="${ink}" x="${f(fx + 2 * m)}" y="${f(fy + 2 * m)}" width="${f(3 * m)}" height="${f(3 * m)}"/>`;
  const plate = e.qrPlate.fill
    ? `<rect x="${f(QR_CLEAR.x)}" y="${f(QR_CLEAR.y)}" width="${f(QR_CLEAR.size)}" height="${f(QR_CLEAR.size)}" rx="0.7" fill="${e.qrPlate.fill}"/>`
    : '';
  const frame = e.qrPlate.frame
    ? foiled(uid, `<rect x="${f(QR_CLEAR.x - 0.9)}" y="${f(QR_CLEAR.y - 0.9)}" width="${f(QR_CLEAR.size + 1.8)}" height="${f(QR_CLEAR.size + 1.8)}" rx="1.2" fill="none" stroke="url(#${uid}foil)" stroke-width="0.16"/>`)
    : '';
  const label1 = text('QR PLACEHOLDER', { font: 'inter500', size: 1.05, tracking: 0.08, x: x + size / 2, y: y + size / 2 + 0.2, anchor: 'middle' });
  const label2 = text('NOT A REAL CODE', { font: 'inter400', size: 0.88, tracking: 0.08, x: x + size / 2, y: y + size / 2 + 1.75, anchor: 'middle' });
  return (
    frame +
    plate +
    `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="none" stroke="${ink}" stroke-width="0.08" stroke-dasharray="0.4 0.4" opacity="0.55"/>` +
    finder(x, y) + finder(x + size - 7 * m, y) + finder(x, y + size - 7 * m) +
    `<path fill="${ink}" d="${label1.d}"/><path fill="${ink}" d="${label2.d}" opacity="0.75"/>`
  );
}

export function back(e, { uid = `${e.id}-b-`, view, px } = {}) {
  const texture = TEXTURE_CONCEPTS[e.id].find((c) => c.selected).build();
  const instruction = typeset(BACK.instruction);
  const serial = typeset(BACK.serial);
  const company = typeset(BACK.company);
  const foil = `url(#${uid}foil)`;
  const body =
    surface(uid) +
    `<g opacity="0.6">${relief(uid, { ...texture, accent: undefined }, `${uid}back`)}</g>` +
    foiled(uid, tapGlyph(BACK.nfc.cx, BACK.nfc.cy, paintOf(e, uid, 'back')) + `<path fill="${paintOf(e, uid, 'back')}" d="${instruction.d}"/>`) +
    qrPlaceholder(e, uid) +
    `<path fill="${e.ink.serial}" d="${serial.d}"/>` +
    foiled(uid, markPath(CX, BACK.mark.top, BACK.mark.height, e.ink.mark === 'foil' ? `url(#${uid}foilBox)` : e.ink.mark)) +
    `<path fill="${e.ink.company}" d="${company.d}"/>` +
    lightAndEdge(e, uid);
  return svgDoc({ body, defsMarkup: defs(e, uid), uid, title: `AAROH ${e.name} — back (concept)`, view, px });
}

/** Where each edition's swatches are cropped, so the selected motif shows (3:2, card millimetres). */
const SWATCH_VIEW = {
  'signature-noir': [1, 26, 52, 34.67],
  'ivory-atelier': [0, 50.9, 52, 34.67],
  'midnight-titanium': [0, 24, 52, 34.67],
};

/** A texture concept on its own, as a swatch: the whole pattern, no identity or calm zone. */
export function swatch(e, concept, { uid = `${e.id}-${concept.key}-s-`, raking = false, view = SWATCH_VIEW[e.id] } = {}) {
  const tex = concept.build();
  const accent = tex.accent
    ? foiled(uid, `<path d="${tex.accent}" fill="none" stroke="url(#${uid}foil)" stroke-width="0.22" stroke-linecap="round"/>`)
    : '';
  const body = surface(uid) + relief(uid, tex) + accent + lightAndEdge(e, uid);
  return svgDoc({ body, defsMarkup: defs(e, uid, { raking }), uid, title: `${e.name} — texture ${concept.key}: ${concept.name} (concept)`, view, px: 14, clip: true });
}

// -------------------------------------------------------- technical sheets ---

function label(str, x, y, { size = 1.5, anchor = 'start', colour = '#3B3A36', weight = 'inter500' } = {}) {
  const t = text(str, { font: weight, size, tracking: 0.02, x, y, anchor });
  return `<path fill="${colour}" d="${t.d}"/>`;
}

function dimH(x1, x2, y, str) {
  return (
    `<path d="M${f(x1)} ${f(y)}H${f(x2)}M${f(x1)} ${f(y - 1)}V${f(y + 1)}M${f(x2)} ${f(y - 1)}V${f(y + 1)}" stroke="#8C3B2E" stroke-width="0.12" fill="none"/>` +
    label(str, (x1 + x2) / 2, y - 0.8, { anchor: 'middle', colour: '#8C3B2E', size: 1.4 })
  );
}

function dimV(y1, y2, x, str) {
  const t = text(str, { font: 'inter500', size: 1.4, tracking: 0.02, x: 0, y: 0, anchor: 'middle' });
  return (
    `<path d="M${f(x)} ${f(y1)}V${f(y2)}M${f(x - 1)} ${f(y1)}H${f(x + 1)}M${f(x - 1)} ${f(y2)}H${f(x + 1)}" stroke="#8C3B2E" stroke-width="0.12" fill="none"/>` +
    `<path fill="#8C3B2E" transform="translate(${f(x - 0.8)} ${f((y1 + y2) / 2)}) rotate(-90)" d="${t.d}"/>`
  );
}

function box(x, y, w, h, colour = '#2F6DB5') {
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${colour}" fill-opacity="0.08" stroke="${colour}" stroke-width="0.1"/>`;
}

function sheetFrame(title, inner, notes) {
  const view = [-14, -12, W + 92, H + 26];
  return svgDoc({
    uid: 'sheet-',
    title,
    view,
    px: 9,
    clip: false,
    defsMarkup: '',
    body:
      `<rect x="${view[0]}" y="${view[1]}" width="${view[2]}" height="${view[3]}" fill="#FBFAF7"/>` +
      `<rect width="${W}" height="${H}" rx="${R}" fill="#FFFFFF" stroke="#1F1F1F" stroke-width="0.16"/>` +
      `<rect x="${SAFE}" y="${SAFE}" width="${f(W - 2 * SAFE)}" height="${f(H - 2 * SAFE)}" fill="none" stroke="#3E8E5A" stroke-width="0.1" stroke-dasharray="0.8 0.5"/>` +
      `<rect x="${RELIEF_INSET}" y="${RELIEF_INSET}" width="${f(W - 2 * RELIEF_INSET)}" height="${f(H - 2 * RELIEF_INSET)}" rx="${R - RELIEF_INSET}" fill="none" stroke="#B07A1F" stroke-width="0.08" stroke-dasharray="0.4 0.4"/>` +
      inner +
      `<path d="M${CX} -2V${H + 2}" stroke="#2F6DB5" stroke-width="0.08" stroke-dasharray="0.5 0.5"/>` +
      dimH(0, W, -5, '53.98 mm') +
      dimV(0, H, -5, '85.60 mm') +
      label('r 3.18', 1.0, -1.1, { size: 1.3, colour: '#8C3B2E' }) +
      notes.map((n, i) => label(n, W + 4, 4 + i * 3.4, { size: 1.4 })).join('') +
      label(title, 0, H + 6.5, { size: 2.1, colour: '#1F1F1F' }) +
      label('PROPOSED — REQUIRES VALIDATION. Green dashed: 4.0 mm safe margin. Amber dotted: relief and bleed print stop (1.0 mm).', 0, H + 10, { size: 1.25, colour: '#5C5A55', weight: 'inter400' }),
  });
}

export function frontLayout() {
  const word = typeset(FRONT.wordmark);
  const ver = typeset(FRONT.version);
  const by = byline('#1F1F1F');
  const em = FRONT.emblem;
  const u = em.width / 4;
  const notes = [
    'Card upright (portrait). Everything centred on x = 26.99.',
    `AAROH lotus emblem: top ${em.top.toFixed(2)}, ${em.width.toFixed(2)} × ${em.height.toFixed(2)}`,
    `Emblem clear space: 1 u = ${u.toFixed(2)} mm all round`,
    `AAROH: top ${FRONT.wordmark.top.toFixed(2)}, cap ${FRONT.wordmark.cap.toFixed(2)}, baseline ${word.baseline.toFixed(2)}, w ${word.width.toFixed(2)}`,
    `BY SHYGON: top ${FRONT.byline.top.toFixed(2)}, cap ${FRONT.byline.cap.toFixed(2)}, w ${by.width.toFixed(2)}`,
    'Noir skyline: dome apex y 50.20, chhatris at x ± 18.40, plinth on the 4.0 line',
    `VERSION 01: baseline ${FRONT.version.baseline.toFixed(2)}, cap ${FRONT.version.cap.toFixed(2)}, w ${ver.width.toFixed(2)}`,
    'Calm zone: ellipse (26.99, 29.50), 46.0 × 42.0, texture faded',
    'Edge band: 0.55 mm (Noir, Titanium), 0.70 mm (Ivory)',
  ];
  const inner =
    `<ellipse cx="${CX}" cy="29.5" rx="23" ry="21" fill="none" stroke="#B07A1F" stroke-width="0.1" stroke-dasharray="0.6 0.4"/>` +
    box(em.cx - em.width / 2 - u, em.top - u, em.width + 2 * u, em.height + 2 * u, '#B07A1F') +
    lotus(em.cx, em.top, em.width, '#1F1F1F') +
    box(em.cx - em.width / 2, em.top, em.width, em.height) +
    `<path fill="#1F1F1F" d="${word.d}"/>` + box(CX - word.width / 2, FRONT.wordmark.top, word.width, FRONT.wordmark.cap) +
    by.svg + box(by.left, FRONT.byline.top, by.width, FRONT.byline.cap) +
    `<path d="${templeDome().domes[0]}${templeDome().chhatris.filter((_, i) => i % 2 === 0).join('')}" fill="none" stroke="#9A8A6A" stroke-width="0.2"/>` +
    `<path fill="#1F1F1F" d="${ver.d}"/>` + box(CX - ver.width / 2, FRONT.version.baseline - FRONT.version.cap, ver.width, FRONT.version.cap);
  return sheetFrame('AAROH front — layout and safe zones', inner, notes);
}

export function backLayout() {
  const instruction = typeset(BACK.instruction);
  const serial = typeset(BACK.serial);
  const company = typeset(BACK.company);
  const { x, y, size } = BACK.qr;
  const markW = (BACK.mark.height * MARK.width) / MARK.height;
  const notes = [
    `Tap glyph: centre (${BACK.nfc.cx.toFixed(2)}, ${BACK.nfc.cy.toFixed(2)}), 3.65 × 4.90`,
    `TAP OR SCAN: centre y ${BACK.instruction.centre.toFixed(2)}, cap ${BACK.instruction.cap.toFixed(2)}, w ${instruction.width.toFixed(2)}`,
    `QR symbol: (${x.toFixed(2)}, ${y.toFixed(2)}), ${size.toFixed(2)} × ${size.toFixed(2)}`,
    `QR module ${QR_MODULE.toFixed(3)} mm (version 3); quiet zone ${QR_QUIET.toFixed(2)} mm`,
    `QR clear box: (${QR_CLEAR.x.toFixed(2)}, ${QR_CLEAR.y.toFixed(2)}), ${QR_CLEAR.size.toFixed(2)} square`,
    `Serial: centre y ${BACK.serial.centre.toFixed(2)}, cap ${BACK.serial.cap.toFixed(2)}, w ${serial.width.toFixed(2)}`,
    `SHYGON mark: top ${BACK.mark.top.toFixed(2)}, ${markW.toFixed(2)} × ${BACK.mark.height.toFixed(2)}`,
    `SHYGON TECHNOLOGIES: centre y ${BACK.company.centre.toFixed(2)}, cap ${BACK.company.cap.toFixed(2)}, w ${company.width.toFixed(2)}`,
    'Keep relief, foil and text out of the clear box',
    'Serial shown is a FORMAT EXAMPLE, not an issued identifier',
  ];
  const inner =
    `<rect x="${f(QR_CLEAR.x)}" y="${f(QR_CLEAR.y)}" width="${f(QR_CLEAR.size)}" height="${f(QR_CLEAR.size)}" fill="#C0392B" fill-opacity="0.06" stroke="#C0392B" stroke-width="0.1" stroke-dasharray="0.5 0.4"/>` +
    qrPlaceholder({ qrPlate: { fill: null, module: '#1F1F1F', frame: false } }, 'sheet-') +
    box(x, y, size, size) +
    tapGlyph(BACK.nfc.cx, BACK.nfc.cy, '#1F1F1F') + box(BACK.nfc.cx - 1.83, BACK.nfc.cy - 2.45, 3.65, 4.9) +
    `<path fill="#1F1F1F" d="${instruction.d}"/>` + box(CX - instruction.width / 2, BACK.instruction.centre - BACK.instruction.cap / 2, instruction.width, BACK.instruction.cap) +
    `<path fill="#1F1F1F" d="${serial.d}"/>` + box(CX - serial.width / 2, BACK.serial.centre - BACK.serial.cap / 2, serial.width, BACK.serial.cap) +
    markPath(CX, BACK.mark.top, BACK.mark.height, '#1F1F1F') + box(CX - markW / 2, BACK.mark.top, markW, BACK.mark.height) +
    `<path fill="#1F1F1F" d="${company.d}"/>` + box(company.left, BACK.company.centre - BACK.company.cap / 2, company.width, BACK.company.cap);
  return sheetFrame('AAROH back — layout, QR quiet zone and safe zones', inner, notes);
}

/** The emblem sheet: the proposed AAROH lotus, its construction grid and clear space, and the SHYGON marks it sits with. */
export function emblemSheet() {
  const s = 3.2; // drawn 3.2× card size
  const ew = EMBLEM_WIDTH * s;
  const eh = (ew * LOTUS.height) / LOTUS.width;
  const u = ew / 4;
  const ox = 4 + u;
  const oy = 4 + u;
  const grid = [];
  for (let gx = ox - u; gx <= ox + ew + u + 0.01; gx += u / 2) grid.push(`M${f(gx)} ${f(oy - u)}V${f(oy + eh + u)}`);
  for (let gy = oy - u; gy <= oy + eh + u + 0.01; gy += u / 2) grid.push(`M${f(ox - u)} ${f(gy)}H${f(ox + ew + u)}`);
  const tx = ox + ew + u + 8;
  const note = (str, y, opts = {}) => label(str, tx, y, { size: 1.5, weight: 'inter400', ...opts });
  const wmS = 3.0 / WORDMARK_CAP_UNITS;
  const height = oy + eh + u + 4;
  return svgDoc({
    uid: 'emb-',
    title: 'AAROH lotus emblem (proposal) and the SHYGON marks',
    view: [0, 0, 170, height],
    px: 8,
    clip: false,
    defsMarkup: '',
    body:
      `<rect width="170" height="${f(height)}" fill="#FBFAF7"/>` +
      `<path d="${grid.join('')}" stroke="#B07A1F" stroke-width="0.06" opacity="0.5"/>` +
      `<rect x="${f(ox - u)}" y="${f(oy - u)}" width="${f(ew + 2 * u)}" height="${f(eh + 2 * u)}" fill="none" stroke="#B07A1F" stroke-width="0.2" stroke-dasharray="1 0.6"/>` +
      lotus(ox + ew / 2, oy, ew, '#1F1F1F') +
      note('AAROH LOTUS EMBLEM: PROPOSAL', 12, { size: 2, weight: 'inter500' }) +
      note('An original construction. It needs the owner’s approval as a brand asset.', 16.5) +
      note(`On the card: ${EMBLEM_WIDTH.toFixed(2)} × ${FRONT.emblem.height.toFixed(2)} mm, top at ${FRONT.emblem.top.toFixed(2)} mm. Drawn here at 3.2×.`, 21) +
      note(`Grid: half units. Unit u = a quarter of the emblem width = ${(EMBLEM_WIDTH / 4).toFixed(2)} mm.`, 25.5) +
      note('Clear space: at least 1 u on every side (dashed).', 30) +
      note(`Stroke ${((LOTUS.stroke * EMBLEM_WIDTH) / LOTUS.width).toFixed(2)} mm on the card. Smallest use: 8.0 mm wide (stroke 0.20 mm).`, 34.5) +
      note('Construction: a central petal with an inner petal, two petal pairs opening', 39) +
      note('outwards, a bindu above and two water lines below.', 42.5) +
      note('The SHYGON logo is unchanged: the wordmark in BY SHYGON (front)', 50, { weight: 'inter500' }) +
      note('and the ribbon S (back).', 53.5, { weight: 'inter500' }) +
      `<path fill="#1F1F1F" transform="translate(${f(tx)} ${f(57.5)}) scale(${+wmS.toFixed(6)})" d="${WORDMARK.d}"/>` +
      markPath(tx + 50, 56.5, 7, '#1F1F1F') +
      note('PROPOSED — REQUIRES VALIDATION', 69, { colour: '#8C3B2E', weight: 'inter500' }),
  });
}

/** Cross-section of the proposed 0.84 mm composite, exaggerated vertically. */
export function crossSection() {
  const layers = [
    ['Overlay, front: matte or soft-touch protective film', 0.06, '#E7E2D8'],
    ['Printed core, front: colour, tonal relief, foil', 0.15, '#CFC6B4'],
    ['Inlay: NFC chip and copper or aluminium antenna', 0.42, '#B9A27A'],
    ['Printed core, back: colour, QR, serial', 0.15, '#CFC6B4'],
    ['Overlay, back: protective film', 0.06, '#E7E2D8'],
  ];
  const scale = 40;
  let y = 10;
  const rows = layers
    .map(([name, t, c]) => {
      const h = t * scale;
      const row =
        `<rect x="10" y="${f(y)}" width="60" height="${f(h)}" fill="${c}" stroke="#6F6A60" stroke-width="0.1"/>` +
        label(`${t.toFixed(2)} mm`, 72, y + h / 2 + 0.6, { size: 1.6 }) +
        label(name, 86, y + h / 2 + 0.6, { size: 1.6, weight: 'inter400' });
      y += h;
      return row;
    })
    .join('');
  return svgDoc({
    uid: 'xs-',
    title: 'AAROH card — proposed 0.84 mm construction (cross-section, not to scale)',
    view: [0, 0, 170, 54],
    px: 7,
    clip: false,
    defsMarkup: '',
    body:
      `<rect width="170" height="54" fill="#FBFAF7"/>` +
      rows +
      label('Total 0.84 mm nominal (ID-1 allows 0.76 mm ± 0.08 mm). Layer split is a starting point for the supplier, not a specification.', 10, y + 6, { size: 1.6 }) +
      label('Thickness drawn 40× exaggerated. Edge bands are edge paint on the cut edge. PROPOSED — REQUIRES VALIDATION.', 10, y + 9.5, { size: 1.6, colour: '#8C3B2E' }),
  });
}

// ------------------------------------------------------------------ output ---

function write(rel, content) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return rel;
}

export function buildAll() {
  // Round-1 files have different names or contents; clear the generated folders first.
  for (const dir of ['concepts', 'textures', 'layout']) fs.rmSync(path.join(OUT, dir), { recursive: true, force: true });
  const written = [];
  for (const e of EDITIONS) {
    written.push(write(`concepts/aaroh-${e.id}-front-concept.svg`, front(e)));
    written.push(write(`concepts/aaroh-${e.id}-back-concept.svg`, back(e)));
    for (const c of TEXTURE_CONCEPTS[e.id]) {
      written.push(write(`textures/texture-${e.id}-${c.key}${c.selected ? '-selected' : ''}.svg`, swatch(e, c)));
    }
  }
  written.push(write('layout/aaroh-front-layout.svg', frontLayout()));
  written.push(write('layout/aaroh-back-layout.svg', backLayout()));
  written.push(write('layout/aaroh-emblem.svg', emblemSheet()));
  written.push(write('layout/aaroh-cross-section.svg', crossSection()));
  return written;
}

/** Numbers DESIGN.md quotes, so the document and the art cannot drift. */
export function measurements() {
  const word = typeset(FRONT.wordmark);
  const ver = typeset(FRONT.version);
  const by = byline('#000');
  const instruction = typeset(BACK.instruction);
  const serial = typeset(BACK.serial);
  const company = typeset(BACK.company);
  const pt = (mm) => +(mm / 0.3528).toFixed(2);
  const markW = (BACK.mark.height * MARK.width) / MARK.height;
  return {
    card: { width: W, height: H, radius: R, orientation: 'portrait' },
    emblem: { ...FRONT.emblem, unit: FRONT.emblem.width / 4, stroke: (LOTUS.stroke * EMBLEM_WIDTH) / LOTUS.width },
    wordmark: { ...FRONT.wordmark, size: word.size, sizePt: pt(word.size), baseline: word.baseline, width: word.width },
    byline: { ...FRONT.byline, size: FRONT.byline.cap / capRatio(FRONT.byline.font), sizePt: pt(FRONT.byline.cap / capRatio(FRONT.byline.font)), baseline: by.baseline, width: by.width, left: by.left },
    version: { ...FRONT.version, size: ver.size, sizePt: pt(ver.size), width: ver.width },
    instruction: { ...BACK.instruction, size: instruction.size, sizePt: pt(instruction.size), baseline: instruction.baseline, width: instruction.width },
    serial: { ...BACK.serial, size: serial.size, sizePt: pt(serial.size), baseline: serial.baseline, width: serial.width },
    mark: { ...BACK.mark, width: markW },
    company: { ...BACK.company, size: company.size, sizePt: pt(company.size), baseline: company.baseline, width: company.width },
    qr: { ...BACK.qr, module: QR_MODULE, quietMm: QR_QUIET, clear: QR_CLEAR },
    capRatios: { inter500: capRatio('inter500'), serif400: capRatio('serif400') },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const written = buildAll();
  fs.writeFileSync(path.join(OUT, 'measurements.json'), JSON.stringify(measurements(), null, 2) + '\n');
  console.log(`wrote ${written.length} SVG files and measurements.json to design-assets/`);
}
