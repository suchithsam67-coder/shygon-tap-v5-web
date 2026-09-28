// A small, dependency-free rasteriser for the logo paths: enough to draw the
// favicons and app icons straight from the vector outlines, anti-aliased, and
// write them as PNG (and ICO). Paths use only M, L, C and Z, absolute.
import fs from 'node:fs';
import zlib from 'node:zlib';

/** Path data -> list of closed polylines (beziers flattened). */
export function flatten(d, { scale = 1, dx = 0, dy = 0, tolerance = 0.2 } = {}) {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const polys = [];
  let poly = null;
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const pt = (px, py) => poly.push([px * scale + dx, py * scale + dy]);
  let cmd = '';
  while (i < tokens.length) {
    if (/[MLCZ]/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === 'M') {
      poly = [];
      polys.push(poly);
      x = num();
      y = num();
      pt(x, y);
      cmd = 'L';
    } else if (cmd === 'L') {
      x = num();
      y = num();
      pt(x, y);
    } else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x3 = num(), y3 = num();
      const len = Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
      const steps = Math.max(2, Math.ceil((len * scale) / (tolerance * 8)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, u = 1 - t;
        pt(
          u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
          u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        );
      }
      x = x3;
      y = y3;
    } else if (cmd === 'Z') {
      cmd = '';
    } else {
      i++;
    }
  }
  return polys;
}

/**
 * Coverage (0..1) of each pixel in a w x h grid by the polygons, even-odd,
 * with `ss` x `ss` supersampling.
 */
export function coverage(polys, w, h, ss = 8) {
  const cov = new Float32Array(w * h);
  const edges = [];
  for (const p of polys) {
    for (let k = 0; k < p.length; k++) {
      const a = p[k], b = p[(k + 1) % p.length];
      if (a[1] !== b[1]) edges.push(a[1] < b[1] ? [a[0], a[1], b[0], b[1]] : [b[0], b[1], a[0], a[1]]);
    }
  }
  const weight = 1 / (ss * ss);
  const xs = [];
  for (let sy = 0; sy < h * ss; sy++) {
    const y = (sy + 0.5) / ss;
    xs.length = 0;
    for (const [x0, y0, x1, y1] of edges) {
      if (y >= y0 && y < y1) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (xs.length < 2) continue;
    xs.sort((m, n) => m - n);
    const row = Math.floor(sy / ss) * w;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.round(xs[k] * ss));
      const to = Math.min(w * ss, Math.round(xs[k + 1] * ss));
      for (let sx = from; sx < to; sx++) cov[row + Math.floor(sx / ss)] += weight;
    }
  }
  for (let k = 0; k < cov.length; k++) cov[k] = Math.min(1, cov[k]);
  return cov;
}

const hex = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
const lin = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const srgb = (l) => Math.round(255 * Math.max(0, Math.min(1, l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055)));

/** An RGBA image, `background` a hex colour or null for transparent. */
export function canvas(w, h, background) {
  const data = Buffer.alloc(w * h * 4);
  if (background) {
    const [r, g, b] = hex(background);
    for (let k = 0; k < w * h; k++) data.set([r, g, b, 255], k * 4);
  }
  return { width: w, height: h, data };
}

/** Composites `colour` over the image through a coverage mask (linear light). */
export function fill(img, cov, colour, opacity = 1) {
  const [r, g, b] = hex(colour).map(lin);
  const { data } = img;
  for (let k = 0; k < cov.length; k++) {
    const a = cov[k] * opacity;
    if (a <= 0) continue;
    const o = k * 4;
    const da = data[o + 3] / 255;
    const oa = a + da * (1 - a);
    const mix = (src, dst) => (src * a + lin(dst) * da * (1 - a)) / oa;
    data[o] = srgb(mix(r, data[o]));
    data[o + 1] = srgb(mix(g, data[o + 1]));
    data[o + 2] = srgb(mix(b, data[o + 2]));
    data[o + 3] = Math.round(oa * 255);
  }
  return img;
}

/** Rounded-rectangle coverage, for app-icon tiles. */
export function roundRect(w, h, x, y, rw, rh, r) {
  const polys = [[]];
  const p = polys[0];
  const arc = (cx, cy, a0) => {
    for (let s = 0; s <= 16; s++) {
      const a = a0 + (s / 16) * (Math.PI / 2);
      p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(x + rw - r, y + r, -Math.PI / 2);
  arc(x + rw - r, y + rh - r, 0);
  arc(x + r, y + rh - r, Math.PI / 2);
  arc(x + r, y + r, Math.PI);
  return coverage(polys, w, h);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG bytes for an RGBA image. */
export function encodePng({ width, height, data }) {
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const writePng = (file, img) => fs.writeFileSync(file, encodePng(img));

/** favicon.ico holding PNG-encoded images. */
export function writeIco(file, images) {
  const pngs = images.map(encodePng);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map((img, k) => {
    const e = Buffer.alloc(16);
    e[0] = img.width >= 256 ? 0 : img.width;
    e[1] = img.height >= 256 ? 0 : img.height;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(pngs[k].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[k].length;
    return e;
  });
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...pngs]));
}
