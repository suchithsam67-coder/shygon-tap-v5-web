// SHYGON AAROH Version 01: printer-ready artwork for the ten editions.
//
// For every edition, face (front, back) and tier (A: Standard print, B:
// Premium Finish), one PDF, built to the AAROH design system's print rules
// (PrintTemplate, Spec, Manufacturing):
//   - 1:1 in millimetres, landscape: trim 85.60 x 53.98, corner 3.18, 3 mm
//     bleed (media 91.60 x 59.98), 4 mm safe area; TrimBox and BleedBox set;
//   - the printed artwork in CMYK: the background (base, printed grain,
//     tone-on-tone art) as a 600 ppi CMYK image, and everything that must stay
//     sharp (the official SHYGON logo, AAROH, every word, the QR plate) as
//     vector, with text converted to outlines;
//   - one named spot plate per finish on Tier B (FOIL_<METAL>, RAISED_UV,
//     SPOT_UV, EMBOSS, DEBOSS, TACTILE_VARNISH), 100% tint and overprint,
//     never mixed into CMYK; relief stops 1 mm inside the die line;
//   - the die line as a spot colour DIELINE, and the variable data (serial,
//     chapter, QR) as a non-printing guide: they come from the data file;
//   - no lighting: highlights, sheen and shadows exist only in mockups.
// Every Tier B plate is also written alone, in 100% black, for printers who
// want separate masks. CMYK values: the design system's starting values for
// the edition's own colours (SPEC), and a conversion anchored on them for the
// rest. A hard proof sets the final values; no ICC output intent is embedded,
// so the printer's profile applies (PDF/X-4 compliance is not claimed).
//
//   node design-assets/src/print.mjs [edition-id ...]
//     writes design-assets/print/AAROH-V01-E01-Obsidian/... and a README.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  CARD,
  CALM,
  FINISHES,
  STORE_EDITIONS,
  VARIABLE_FIELDS,
  artLayers,
  cardSvg,
  editionRecord,
  ellipse,
  faceElements,
  roundRect,
} from './editions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'print');
const PPI = 600;
const MM = 72 / 25.4;
const B = CARD.bleed;
const MEDIA = { w: CARD.width + 2 * B, h: CARD.height + 2 * B };
const PX = { w: Math.round((MEDIA.w / 25.4) * PPI), h: Math.round((MEDIA.h / 25.4) * PPI) };
/** The design system's minimums, mm. */
const MIN = { foil: 0.15, relief: 0.2 };
const SITE = 'https://shygontech.com';

// ---------------------------------------------------------------- colour ---

const hexRgb = (hex) => {
  const v = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
};
function naiveCmyk([r, g, b]) {
  const k = 1 - Math.max(r, g, b);
  if (k >= 0.9999) return [0, 0, 0, 1];
  return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
}
/**
 * RGB to CMYK, anchored on the edition's design-system swatches: a plain
 * conversion plus the swatches' corrections, weighted by colour distance, so
 * every SPEC colour comes out exactly as specified and its neighbours follow
 * (the rich blacks stay rich). Total ink is held at 300%.
 */
function converter(spec) {
  const anchors = spec.map(([, hex, c, m, y, k]) => {
    const rgb = hexRgb(hex);
    const plain = naiveCmyk(rgb);
    return { rgb, fix: [c / 100 - plain[0], m / 100 - plain[1], y / 100 - plain[2], k / 100 - plain[3]] };
  });
  return (rgb) => {
    const plain = naiveCmyk(rgb);
    const fix = [0, 0, 0, 0];
    let total = 0;
    for (const a of anchors) {
      const d2 = (rgb[0] - a.rgb[0]) ** 2 + (rgb[1] - a.rgb[1]) ** 2 + (rgb[2] - a.rgb[2]) ** 2;
      if (d2 < 1e-9) return [0, 1, 2, 3].map((i) => plain[i] + a.fix[i]);
      const w = 1 / (d2 * d2);
      total += w;
      for (let i = 0; i < 4; i++) fix[i] += w * a.fix[i];
    }
    const out = plain.map((v, i) => Math.min(1, Math.max(0, v + fix[i] / total)));
    const sum = out[0] + out[1] + out[2] + out[3];
    if (sum > 3) {
      const scale = (3 - out[3]) / (out[0] + out[1] + out[2]);
      for (let i = 0; i < 3; i++) out[i] *= scale;
    }
    return out;
  };
}
const fmt = (v) => (Math.round(v * 1000) / 1000).toString();
const cmykOp = (cmyk, stroke = false) => `${cmyk.map((v) => fmt(v)).join(' ')} ${stroke ? 'K' : 'k'}`;

// ----------------------------------------------------- SVG path to PDF ---

function tokenize(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d))) out.push(m[1] ?? Number(m[2]));
  return out;
}
/** Arc (SVG endpoint form) to cubic Béziers. */
function arcToCubics(x1, y1, rx, ry, phi, large, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const sin = Math.sin((phi * Math.PI) / 180);
  const cos = Math.cos((phi * Math.PI) / 180);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  let t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const segments = Math.ceil(Math.abs(dt) / (Math.PI / 2));
  const delta = dt / segments;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out = [];
  for (let i = 0; i < segments; i++) {
    const a1 = t1 + i * delta, a2 = a1 + delta;
    const p = (a, s) => {
      const ex = Math.cos(a), ey = Math.sin(a);
      const x = rx * ex, y = ry * ey;
      const tx = -rx * ey * s, ty = ry * ex * s;
      return [x, y, tx, ty];
    };
    const [ax, ay, atx, aty] = p(a1, k);
    const [bx, by, btx, bty] = p(a2, k);
    const map = (x, y) => [cos * x - sin * y + cx, sin * x + cos * y + cy];
    const c1 = map(ax + atx, ay + aty);
    const c2 = map(bx - btx, by - bty);
    const end = map(bx, by);
    out.push([...c1, ...c2, ...end]);
  }
  return out;
}
/** An SVG path's data as PDF path operators (absolute, cubic). */
function pathToPdf(d) {
  const t = tokenize(d);
  const ops = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = 0, lcy = 0, lq = null;
  const num = () => t[i++];
  const P = (...v) => v.map(fmt).join(' ');
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++];
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = ox + num(); y = oy + num(); sx = x; sy = y; ops.push(`${P(x, y)} m`); lcx = x; lcy = y; lq = null; break;
      case 'L': x = ox + num(); y = oy + num(); ops.push(`${P(x, y)} l`); lcx = x; lcy = y; lq = null; break;
      case 'H': x = (rel ? x : 0) + num(); ops.push(`${P(x, y)} l`); lcx = x; lcy = y; lq = null; break;
      case 'V': y = (rel ? y : 0) + num(); ops.push(`${P(x, y)} l`); lcx = x; lcy = y; lq = null; break;
      case 'C': {
        const c1x = ox + num(), c1y = oy + num(), c2x = ox + num(), c2y = oy + num();
        x = ox + num(); y = oy + num();
        ops.push(`${P(c1x, c1y, c2x, c2y, x, y)} c`); lcx = c2x; lcy = c2y; lq = null; break;
      }
      case 'S': {
        const c1x = 2 * x - lcx, c1y = 2 * y - lcy, c2x = ox + num(), c2y = oy + num();
        x = ox + num(); y = oy + num();
        ops.push(`${P(c1x, c1y, c2x, c2y, x, y)} c`); lcx = c2x; lcy = c2y; lq = null; break;
      }
      case 'Q': case 'T': {
        let qx, qy;
        if (cmd.toUpperCase() === 'Q') { qx = ox + num(); qy = oy + num(); } else { qx = lq ? 2 * x - lq[0] : x; qy = lq ? 2 * y - lq[1] : y; }
        const ex = ox + num(), ey = oy + num();
        const c1x = x + (2 / 3) * (qx - x), c1y = y + (2 / 3) * (qy - y);
        const c2x = ex + (2 / 3) * (qx - ex), c2y = ey + (2 / 3) * (qy - ey);
        ops.push(`${P(c1x, c1y, c2x, c2y, ex, ey)} c`);
        x = ex; y = ey; lq = [qx, qy]; lcx = x; lcy = y; break;
      }
      case 'A': {
        const rx = num(), ry = num(), phi = num(), large = num(), sweep = num();
        const ex = ox + num(), ey = oy + num();
        for (const c of arcToCubics(x, y, rx, ry, phi, large, sweep, ex, ey)) ops.push(`${P(...c)} c`);
        x = ex; y = ey; lcx = x; lcy = y; lq = null; break;
      }
      case 'Z': ops.push('h'); x = sx; y = sy; lcx = x; lcy = y; lq = null; break;
      default: throw new Error(`Unsupported path command ${cmd}`);
    }
  }
  return ops.join('\n');
}
/** One drawable as PDF operators: an optional transform [scale, tx, ty], a fill or a stroke. */
function drawOps({ d, transform, rule, stroke, sw }, paint) {
  const body = pathToPdf(d);
  const t = transform ? `q ${fmt(transform[0])} 0 0 ${fmt(transform[0])} ${fmt(transform[1])} ${fmt(transform[2])} cm\n` : '';
  const end = transform ? '\nQ' : '';
  if (stroke) return `${t}${paint.stroke}\n${fmt(sw)} w\n${body}\nS${end}`;
  return `${t}${paint.fill}\n${body}\n${rule === 'evenodd' ? 'f*' : 'f'}${end}`;
}

// ------------------------------------------------------------ PDF writer ---

class Pdf {
  constructor() { this.objects = []; }
  reserve() { this.objects.push(null); return this.objects.length; }
  set(id, dict, stream) { this.objects[id - 1] = { dict, stream }; return id; }
  add(dict, stream) { return this.set(this.reserve(), dict, stream); }
  build(rootId, infoId) {
    const parts = [Buffer.from('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = parts[0].length;
    const offsets = [];
    this.objects.forEach((o, index) => {
      offsets.push(offset);
      const head = `${index + 1} 0 obj\n`;
      let chunk;
      if (o.stream) {
        chunk = Buffer.concat([
          Buffer.from(`${head}${o.dict.replace(/>>\s*$/, `/Length ${o.stream.length} >>`)}\nstream\n`, 'latin1'),
          o.stream,
          Buffer.from('\nendstream\nendobj\n', 'latin1'),
        ]);
      } else {
        chunk = Buffer.from(`${head}${o.dict}\nendobj\n`, 'latin1');
      }
      parts.push(chunk);
      offset += chunk.length;
    });
    const id = crypto.createHash('md5').update(Buffer.concat(parts)).digest('hex');
    const xref = [`xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    const trailer = `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R /Info ${infoId} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${offset}\n%%EOF\n`;
    parts.push(Buffer.from(xref + trailer, 'latin1'));
    return Buffer.concat(parts);
  }
}
const pdfString = (s) => `(${s.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** PNG (8-bit RGBA, as Chromium writes it) to raw RGBA. */
function decodePng(buf) {
  let pos = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG'); }
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[x] = v & 255;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * channels];
      out[(y * width + x) * 4 + 1] = line[x * channels + 1];
      out[(y * width + x) * 4 + 2] = line[x * channels + 2];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
  }
  return { width, height, rgba: out };
}

/** RGBA to a Flate-compressed CMYK image stream with the PNG Up predictor. */
function cmykImage({ width, height, rgba }, toCmyk) {
  const cache = new Map();
  const rows = Buffer.alloc(height * (width * 4 + 1));
  const prevRow = Buffer.alloc(width * 4);
  const row = Buffer.alloc(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
      let v = cache.get(key);
      if (!v) {
        const c = toCmyk([rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255]);
        v = c.map((n) => Math.round(n * 255));
        cache.set(key, v);
      }
      row[x * 4] = v[0]; row[x * 4 + 1] = v[1]; row[x * 4 + 2] = v[2]; row[x * 4 + 3] = v[3];
    }
    const base = y * (width * 4 + 1);
    rows[base] = 2;
    for (let x = 0; x < width * 4; x++) rows[base + 1 + x] = (row[x] - prevRow[x]) & 255;
    row.copy(prevRow);
  }
  return zlib.deflateSync(rows, { level: 9 });
}

// ------------------------------------------------------------ the plates ---

/** The finish plates a Tier B face carries: name -> { items, clip, alt } . */
function platesFor(storeId, side) {
  const c = editionRecord(storeId);
  const fin = c.finishB;
  const plates = new Map();
  const plate = (name, alt) => {
    if (!plates.has(name)) plates.set(name, { name, alt, art: [], identity: [] });
    return plates.get(name);
  };
  const metalAlt = converter(c.spec)(hexRgb(c.flat));
  const altOf = (name) => (name.startsWith('FOIL_') ? metalAlt : name === 'DEBOSS' || name === 'EMBOSS' ? [0, 0, 0, 0.35] : [0.45, 0, 0.05, 0]);
  if (side === 'front') {
    for (const l of artLayers(storeId, { tierB: true, metal: 'x', artA: 'x', artB: 'x' })) {
      if (!l.d || !l.role) continue;
      let name = null, min = MIN.relief;
      if (l.role === 'foil') { name = fin.foil ?? fin.foilAs ?? null; min = fin.foil ? MIN.foil : MIN.relief; }
      else if (l.role === 'rel') name = fin.rel;
      else if (l.role === 'deb') name = fin.deb;
      if (!name) continue;
      const stroke = l.stroke !== 'none';
      plate(name, altOf(name)).art.push(stroke ? { d: l.d, stroke: true, sw: Math.max(l.sw, min) } : { d: l.d });
    }
    if (fin.field) plate(fin.field, altOf(fin.field)).art.push({ d: roundRect(-B, -B, MEDIA.w, MEDIA.h, 0) });
  }
  if (fin.idFoil) {
    for (const e of faceElements(storeId, side)) {
      if (e.role !== 'brand') continue;
      plate(fin.foil, altOf(fin.foil)).identity.push(e.stroke ? { ...e, stroke: true, sw: Math.max(e.sw, MIN.foil) } : e);
    }
  }
  return [...plates.values()];
}

/** Relief and foil stay 1 mm inside the die line, and off the identity's calm zone (front art only). */
function plateClip(storeId) {
  const inset = CARD.reliefInset;
  const calm = CALM.front(storeId);
  const box = roundRect(inset, inset, CARD.width - 2 * inset, CARD.height - 2 * inset, CARD.radius - inset);
  return `${pathToPdf(box)}\n${pathToPdf(ellipse(calm.cx, calm.cy, calm.rx * 0.7, calm.ry * 0.7))}\nW* n`;
}

// ------------------------------------------------------------ one face ---

async function renderRaster(page, storeId, side, finish) {
  let svg = cardSvg(storeId, { side, finish, mode: 'print', px: 1 });
  svg = svg.replace(/ width="[\d.]+" height="[\d.]+"/, ` width="${PX.w}" height="${PX.h}" preserveAspectRatio="none"`);
  await page.setViewportSize({ width: PX.w, height: PX.h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
  await page.waitForTimeout(120);
  return decodePng(await page.screenshot({ clip: { x: 0, y: 0, width: PX.w, height: PX.h }, omitBackground: false }));
}

function facePdf({ storeId, side, finish, raster, toCmyk, maskOf }) {
  const c = editionRecord(storeId);
  const tierB = finish === 'premium';
  const fin = c.finishB;
  const pdf = new Pdf();
  const catalogId = pdf.reserve();
  const pagesId = pdf.reserve();
  const pageId = pdf.reserve();
  const W = MEDIA.w * MM, H = MEDIA.h * MM, b = B * MM;
  const ctm = `${fmt(MM)} 0 0 ${fmt(-MM)} ${fmt(b)} ${fmt(H - b)} cm`;

  const ocgs = [];
  const ocg = (name, print = true) => {
    const id = pdf.add(`<< /Type /OCG /Name ${pdfString(name)}${print ? '' : ' /Usage << /Print << /PrintState /OFF >> /View << /ViewState /ON >> >>'} >>`);
    const tag = `L${ocgs.length}`;
    ocgs.push({ id, tag, print });
    return tag;
  };
  const colourSpaces = [];
  const separation = (name, alt) => {
    const id = pdf.add(`[/Separation /${name} /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [${alt.map(fmt).join(' ')}] /N 1 >>]`);
    const tag = `CS${colourSpaces.length}`;
    colourSpaces.push({ id, tag });
    return tag;
  };
  const overprint = pdf.add('<< /Type /ExtGState /OP true /op true /OPM 1 >>');
  const content = [];
  const mask = maskOf ? [] : null;
  let imageId = null;

  if (!maskOf) {
    // The printed artwork: the background image, then the vector words and logo.
    const image = pdf.add(
      `<< /Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceCMYK /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors 4 /BitsPerComponent 8 /Columns ${raster.width} >> >>`,
      cmykImage(raster, toCmyk),
    );
    content.push(`/OC /${ocg('CMYK artwork')} BDC\nq ${fmt(MEDIA.w)} 0 0 ${fmt(-MEDIA.h)} ${fmt(-B)} ${fmt(CARD.height + B)} cm /Im0 Do Q`);
    const ink = [];
    for (const e of faceElements(storeId, side)) {
      if (e.role === 'variable') continue;
      if (e.role === 'brand' && tierB && fin.idFoil) continue;
      const colour = e.stroke ? (e.stroke === 'metal' ? c.flat : e.stroke) : e.fill === undefined || e.fill === 'metal' ? c.flat : e.fill;
      const cmyk = toCmyk(hexRgb(colour));
      ink.push(drawOps(e, { fill: cmykOp(cmyk), stroke: cmykOp(cmyk, true) }));
    }
    content.push(`1 J 1 j\n${ink.join('\n')}\nEMC`);
    imageId = image;
  }

  // The finish plates (Tier B), each a named spot colour, overprinting.
  const plates = tierB ? platesFor(storeId, side) : [];
  for (const p of plates) {
    if (maskOf && p.name !== maskOf) continue;
    const paint = maskOf ? { fill: '0 g', stroke: '0 G' } : (() => { const cs = separation(p.name, p.alt); return { fill: `/${cs} cs 1 scn`, stroke: `/${cs} CS 1 SCN` }; })();
    const parts = [];
    if (p.art.length) parts.push(`q\n${plateClip(storeId)}\n1 J 1 j\n${p.art.map((e) => drawOps(e, paint)).join('\n')}\nQ`);
    if (p.identity.length) parts.push(`q 1 J 1 j\n${p.identity.map((e) => drawOps(e, paint)).join('\n')}\nQ`);
    (maskOf ? mask : content).push(`/OC /${ocg(maskOf ? `${p.name} (mask, print in the finish)` : `Spot: ${p.name}`)} BDC\n${maskOf ? '' : '/GS0 gs\n'}${parts.join('\n')}\nEMC`);
  }

  // The die line and the variable-data guide: shown on screen, never printed.
  const die = separation('DIELINE', [0, 1, 0, 0]);
  const dieOps = `/OC /${ocg('DIELINE (cut path, do not print)', false)} BDC\n/GS0 gs /${die} CS 1 SCN 0.1 w\n${pathToPdf(roundRect(0, 0, CARD.width, CARD.height, CARD.radius))}\nS\nEMC`;
  let vdpOps = '';
  if (side === 'back' && !maskOf) {
    const vdp = separation('VDP_GUIDE', [1, 0, 0, 0]);
    const guide = faceElements(storeId, side).filter((e) => e.role === 'variable');
    const q = VARIABLE_FIELDS.qr;
    vdpOps = `/OC /${ocg('Variable data guide (serial, chapter, QR: from the data file; do not print)', false)} BDC\n/GS0 gs /${vdp} cs 1 scn /${vdp} CS 1 SCN 0.08 w\n` +
      `${guide.map((e) => drawOps(e, { fill: `/${vdp} cs 1 scn`, stroke: `/${vdp} CS 1 SCN` })).join('\n')}\n` +
      `${fmt(q.x)} ${fmt(q.y)} ${fmt(q.size)} ${fmt(q.size)} re S\nEMC`;
  }
  const stream = zlib.deflateSync(Buffer.from(`q\n${ctm}\n${(maskOf ? mask : content).join('\n')}\n${dieOps}\n${vdpOps}\nQ\n`, 'latin1'));
  const contentsId = pdf.add('<< /Filter /FlateDecode >>', stream);

  const resources = [
    imageId ? `/XObject << /Im0 ${imageId} 0 R >>` : '',
    `/ExtGState << /GS0 ${overprint} 0 R >>`,
    colourSpaces.length ? `/ColorSpace << ${colourSpaces.map((s) => `/${s.tag} ${s.id} 0 R`).join(' ')} >>` : '',
    `/Properties << ${ocgs.map((o) => `/${o.tag} ${o.id} 0 R`).join(' ')} >>`,
  ].join(' ');
  pdf.set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(W)} ${fmt(H)}] /BleedBox [0 0 ${fmt(W)} ${fmt(H)}] /TrimBox [${fmt(b)} ${fmt(b)} ${fmt(W - b)} ${fmt(H - b)}] /ArtBox [${fmt(b)} ${fmt(b)} ${fmt(W - b)} ${fmt(H - b)}] /Contents ${contentsId} 0 R /Resources << ${resources} >> >>`);
  pdf.set(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const refs = ocgs.map((o) => `${o.id} 0 R`).join(' ');
  const noPrint = ocgs.filter((o) => !o.print).map((o) => `${o.id} 0 R`).join(' ');
  pdf.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R /OCProperties << /OCGs [${refs}] /D << /Order [${refs}] /ON [${refs}] /AS [<< /Event /Print /OCGs [${noPrint}] /Category [/Print] >>] >> >> >>`);
  const title = `SHYGON AAROH Version 01, E${c.no} ${c.name}, ${side}, ${tierB ? 'Tier B Premium Finish' : 'Tier A Standard'}${maskOf ? `, ${maskOf} mask` : ''}`;
  const infoId = pdf.add(`<< /Title ${pdfString(title)} /Author (SHYGON Technologies Pvt. Ltd.) /Creator (design-assets/src/print.mjs) /Producer (SHYGON print generator) /Trapped /False >>`);
  return { buffer: pdf.build(catalogId, infoId), plates: plates.map((p) => p.name) };
}

// -------------------------------------------------------------- job sheet ---

function jobSheet(storeId, files, plates) {
  const c = editionRecord(storeId);
  const fin = c.finishB;
  const v = VARIABLE_FIELDS;
  const swatches = c.spec.map(([role, hex, cc, m, y, k]) => `| ${role} | ${hex} | C${cc} M${m} Y${y} K${k} |`).join('\n');
  return `# SHYGON AAROH Version 01 · E${c.no} ${c.name} · print job sheet

PROPOSED — REQUIRES VALIDATION. Built from the AAROH design system; a hard
proof, the inlay maker's coil drawing and NFC read tests come before any run.

## Format
- ID-1 card (ISO/IEC 7810), **landscape**: trim 85.60 × 53.98 mm, corner radius 3.18 mm.
- Artwork 91.60 × 59.98 mm (3 mm bleed on every side). Safe area 4 mm inside trim.
- Finished thickness 0.76 ± 0.08 mm after lamination. NFC inlay: ISO/IEC 14443-A; NTAG 424 DNA for new cards.
- Lighting in the mockups is not printed. Relief and foil come only from their plates.

## Files
${files.map((f) => `- \`${f}\``).join('\n')}

Each PDF: TrimBox and BleedBox set; CMYK artwork (600 ppi background image plus vector words and logo, text as outlines); \`DIELINE\` spot (cut path) and, on the back, \`VDP_GUIDE\` spot (variable data positions), both on non-printing layers.

## Tier A — Standard print
- CMYK digital print, both faces. Metals print as ink: ${c.flat} as ${converter(c.spec)(hexRgb(c.flat)).map((v, i) => 'CMYK'[i] + Math.round(v * 100)).join(' ')}. The texture is printed, not felt.
- Laminate: matte or gloss, as the edition's surface suggests (Tier B: ${fin.laminate}).

## Tier B — Premium Finish
- Laminate: ${fin.laminate}.
- Plates on the front: ${plates.front.length ? plates.front.map((p) => `\`${p}\``).join(', ') : 'none'}. On the back: ${plates.back.length ? plates.back.map((p) => `\`${p}\``).join(', ') : 'none'} (the back's art is a tint and has no finish).
- Each plate is a named spot colour at 100%, set to overprint, never mixed into CMYK; also supplied alone in 100% black (\`masks/\`).
- Relief, emboss, deboss and UV stop 1.00 mm inside the die line and stay off the chip (confirm the chip position with the inlay drawing).
- Minimums: line 0.10 mm print, 0.15 mm foil, 0.20 mm relief (plates are widened to these where the art is finer).
- Edge: ${fin.edge ?? 'no edge paint'}.

## Colour (design-system starting values)
| Role | Screen | CMYK |
|---|---|---|
${swatches}

Large blacks: rich black as specified; small black text K100 only. Other colours are converted from screen values anchored on these swatches. Confirm with a hard proof (ΔE agreed with the printer).

## Variable data (from the data file, per card)
| Field | Where (trim mm) | Spec |
|---|---|---|
| serial_number | x ${v.serial.x}, baseline ${v.serial.baseline} | ${v.serial.font} ${v.serial.size} mm, tracking ${v.serial.tracking} em; format ${v.serial.format}; printed, human-readable, **not a secret** |
| chapter | x ${v.chapter.x}, baseline ${v.chapter.baseline} | ${v.chapter.font} ${v.chapter.size} mm; format ${v.chapter.format} |
| QR | x ${v.qr.x}, y ${v.qr.y}, ${v.qr.size} × ${v.qr.size} mm | encodes \`${SITE}/d/<card_code>\`; quiet zone ${v.qr.quietZone}; ${v.qr.note} |

- \`card_code\` is the opaque code in the QR and on the chip (\`/d/<code>\`); it is never printed as text.
- \`chip_uid\` is recorded at controlled provisioning, never printed.
- One row per physical card: \`serial_number, chapter, card_code\`. The serial and the code must be unique, and a card is assigned to an order only by the backend.

## Quality control before dispatch
1. The printed serial matches the card's record.
2. The QR opens \`${SITE}/d/<card_code>\` for that card.
3. A tap opens the same \`/d/<card_code>\`, read on at least ten phones for the first batch.
4. The card is assigned to the right order, and only that order, in the backend.
5. Foil, relief and UV are in register and off the chip; edges are clean; thickness is in tolerance.
`;
}

// ------------------------------------------------------------------- main ---

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const only = process.argv.slice(2);
  const editions = STORE_EDITIONS.map(([id]) => id).filter((id) => !only.length || only.includes(id));
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge' });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.route('**/*', (route) => (route.request().url().startsWith('data:') || route.request().url() === 'about:blank' ? route.continue() : route.abort()));
  const manifest = [];
  for (const id of editions) {
    const c = editionRecord(id);
    const folder = `AAROH-V01-E${c.no}-${c.name.replace(/\s+/g, '')}`;
    const dir = path.join(OUT, folder);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(path.join(dir, 'masks'), { recursive: true });
    const toCmyk = converter(c.spec);
    const files = [];
    const platesBySide = { front: [], back: [] };
    for (const [finish, tier] of Object.entries(FINISHES)) {
      for (const side of ['front', 'back']) {
        const raster = await renderRaster(page, id, side, finish);
        const { buffer, plates } = facePdf({ storeId: id, side, finish, raster, toCmyk });
        const name = `AAROH-E${c.no}-${side}-${tier}.pdf`;
        fs.writeFileSync(path.join(dir, name), buffer);
        files.push(name);
        manifest.push({ edition: id, side, tier, file: `${folder}/${name}`, bytes: buffer.length, plates });
        if (tier === 'B') {
          platesBySide[side] = plates;
          for (const plate of plates) {
            const m = facePdf({ storeId: id, side, finish, raster: null, toCmyk, maskOf: plate });
            const maskName = `masks/AAROH-E${c.no}-${side}-B-${plate}.pdf`;
            fs.writeFileSync(path.join(dir, maskName), m.buffer);
            files.push(maskName);
            manifest.push({ edition: id, side, tier: 'B', file: `${folder}/${maskName}`, bytes: m.buffer.length, plates: [plate], mask: true });
          }
        }
        console.log(`${folder}/${name} ${(buffer.length / 1e6).toFixed(1)} MB ${plates.length ? `plates ${plates.join(', ')}` : ''}`);
      }
    }
    fs.writeFileSync(path.join(dir, 'JOB-SHEET.md'), jobSheet(id, files, platesBySide));
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), media_mm: MEDIA, trim_mm: [CARD.width, CARD.height], bleed_mm: B, ppi: PPI, files: manifest }, null, 2) + '\n');
  console.log(`wrote ${manifest.length} PDFs to design-assets/print/`);
}

export { converter, pathToPdf, decodePng };
