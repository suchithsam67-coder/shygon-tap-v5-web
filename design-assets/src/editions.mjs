// SHYGON AAROH Version 1: the ten editions as landscape ID-1 cards
// (DEC-2026-037), drawn for print.
//
// Source: the AAROH design system ("SHYGON AAROH Design System" canvas,
// project/Card.dc.html sha256 51f266476e7d8d45…, project/Spec.dc.html,
// project/PrintTemplate.dc.html, project/Manufacturing.dc.html). Kept from it:
//   - every edition's materials (D: base, metals, grain, relief), verbatim;
//   - every edition's motif, line weights and colours (ART), re-laid for a
//     landscape card: patterns keep their pitch and run to the bleed, and the
//     edition ornament sits in the right half at 0.9 of its upright size, on
//     the same foot line (VERSION 01, plinths, arches and the sun keep their
//     distance from the bottom edge);
//   - the CMYK starting values (SPEC) and the print rules: 3 mm bleed, 4 mm
//     safe area, corner 3.18, one spot plate per finish, lighting only in
//     mockups, text as outlines, relief 1 mm inside the die line.
// Changed on the owner's instruction (2026-10-14): landscape, not upright, and
// the official SHYGON logo (scripts/brand/logo.mjs) in place of the proposed
// lotus. Tier B shows only the finishes the manufacturing sheet lists for each
// edition, so a mockup never promises a process the printer will not run.
//
// Tier B is the Premium Finish (₹1,499); Tier A the Standard print (₹999).
// Concept renders, not photographs. PROPOSED — REQUIRES VALIDATION: printer
// proofs, the inlay maker's coil drawing and the NFC read tests come first.
//
//   node design-assets/src/editions.mjs     writes design-assets/editions/*.svg
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { text as outline } from '../../scripts/brand/type.mjs';
import { LOCKUP, MARK, WORDMARK } from '../../scripts/brand/logo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'editions');
const text = (str, opts) => outline(str, { decimals: 3, ...opts });

/** ID-1 (ISO/IEC 7810) landscape, in millimetres. */
export const CARD = { width: 85.6, height: 53.98, radius: 3.18, bleed: 3, safe: 4, reliefInset: 1 };
const W = CARD.width;
const H = CARD.height;

// The design system's upright card: centre line and height.
const DCX = 26.99;
const DH = 85.6;
/** Ornament axis, identity axis and the ornament scale on the landscape card. */
const OX = 62;
const IX = 22.5;
const S = 0.9;
const tx = (x) => OX + S * (x - DCX);
const ty = (y) => H + S * (y - DH);
/** The design-system x range that covers the landscape bleed once mapped. */
const DX0 = (-CARD.bleed - OX) / S + DCX;
const DX1 = (W + CARD.bleed - OX) / S + DCX;

// ------------------------------------------- helpers, verbatim from the canvas
function n(v) { return Math.round(v * 100) / 100; }
function pt(p) { return n(p[0]) + ' ' + n(p[1]); }
function rng(seed) { let s = seed >>> 0; return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function L(o) { return Object.assign({ d: '', fill: 'none', stroke: 'none', sw: 0, op: 1, flt: 'none' }, o || {}); }
function smooth(pts, cont) {
  let d = (cont ? 'L' : 'M') + pt(pts[0]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += 'C' + n(p1[0] + (p2[0] - p0[0]) / 6) + ' ' + n(p1[1] + (p2[1] - p0[1]) / 6) + ' ' + n(p2[0] - (p3[0] - p1[0]) / 6) + ' ' + n(p2[1] - (p3[1] - p1[1]) / 6) + ' ' + pt(p2);
  }
  return d;
}
function sample(fn, a, b, step, dy) { const pts = []; for (let t = a; t <= b + 0.001; t += step) pts.push([t, fn(t) + (dy || 0)]); return pts; }
function circ(cx, cy, r) { return 'M' + n(cx - r) + ' ' + n(cy) + 'a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(2 * r) + ' 0a' + n(r) + ' ' + n(r) + ' 0 1 0 ' + n(-2 * r) + ' 0'; }
/** A design-system curve, mapped onto the landscape ornament zone. */
const mapped = (pts) => pts.map((p) => [tx(p[0]), ty(p[1])]);

/*
 * The edition motifs, landscape. Each returns up to eight layers; a layer's
 * `flt` is REL, DEB or FOIL, the role it has on a Tier B card (P maps the role
 * to a filter for mockups, and print.mjs maps it to a spot plate).
 */
const ART = {
  obsidian(r, P) {
    const p = 7.2, A = p / 2, py = 13;
    let lat = '', buds = '';
    for (let k = -10; k <= 5; k++) {
      const x0 = OX + k * p;
      lat += smooth(sample((y) => x0 + A * Math.sin(2 * Math.PI * y / py), -4, 58, 1.1).map((q) => [q[1], q[0]]));
      lat += smooth(sample((y) => x0 - A * Math.sin(2 * Math.PI * y / py), -4, 58, 1.1).map((q) => [q[1], q[0]]));
      for (let m = -1; m < 10; m++) { const y = (m + 0.5) * py / 2; buds += circ(x0, y, 0.45); }
    }
    let arch = '', outer = '';
    for (let k = 0; k < 5; k++) {
      const w = (46 - k * 7.4) * S, h = (31 - k * 4.6) * S, base = ty(80), xl = OX - w / 2, xr = OX + w / 2, top = base - h;
      const d = 'M' + n(xl) + ' ' + n(base) + 'C' + n(xl - w * 0.1) + ' ' + n(base - h * 0.5) + ' ' + n(OX - w * 0.06) + ' ' + n(base - h * 0.74) + ' ' + n(OX) + ' ' + n(top) + 'C' + n(OX + w * 0.06) + ' ' + n(base - h * 0.74) + ' ' + n(xr + w * 0.1) + ' ' + n(base - h * 0.5) + ' ' + n(xr) + ' ' + n(base);
      if (k === 0) outer += d + circ(OX, top - 1.3 * S, 0.5 * S); else arch += d;
    }
    return {
      l0: { d: lat, stroke: '#1F1F24', sw: 0.38, flt: P.REL },
      l1: { d: buds, fill: '#1F1F24', flt: P.REL },
      l2: { d: arch, stroke: P.M, sw: 0.2, flt: P.FOIL },
      l3: { d: outer, stroke: P.M, sw: 0.32, flt: P.FOIL },
      l4: { d: 'M' + n(tx(6)) + ' ' + n(ty(80)) + 'H' + n(tx(47.98)), stroke: P.M, sw: 0.22, flt: P.FOIL }
    };
  },

  aureate(r, P) {
    const cx = OX, cy = ty(98); let ring = '', heavy = '', rays = '', sun = '';
    for (let k = 0; k < 34; k++) { const c = circ(cx, cy, 16 + k * 2.6); if (k % 6 === 5) heavy += c; else ring += c; }
    for (let k = 0; k <= 32; k++) {
      const a = Math.PI * (1.18 + 0.64 * k / 32), r0 = 22, r1 = k % 4 === 0 ? 96 : 62;
      rays += 'M' + n(cx + r0 * Math.cos(a)) + ' ' + n(cy + r0 * Math.sin(a)) + 'L' + n(cx + r1 * Math.cos(a)) + ' ' + n(cy + r1 * Math.sin(a));
    }
    for (let k = 1; k <= 6; k++) sun += circ(cx, ty(87), k * 1.15 * S);
    return {
      l0: { d: ring, stroke: '#E2D4B8', sw: 0.34, flt: P.REL },
      l1: { d: rays, stroke: P.M, sw: 0.09, op: 0.8 },
      l2: { d: heavy, stroke: P.M, sw: 0.24, flt: P.FOIL },
      l3: { d: sun, stroke: P.M, sw: 0.18, flt: P.FOIL }
    };
  },

  monolith(r, P) {
    const step = 2.5 * S;
    let grid = '';
    for (let x = tx(4.49) - 20 * step; x <= W + 3; x += step) if (x >= -3) grid += 'M' + n(x) + ' -3V' + n(H + 3);
    for (let y = ty(0.5); y <= H + 3; y += step) if (y >= -3) grid += 'M-3 ' + n(y) + 'H' + n(W + 3);
    const slabs = [[4.5, 5, 58], [9.5, 7.5, 50], [17, 5, 55], [22, 10, 46], [32, 5, 53], [37, 7.5, 49], [44.5, 5, 57]];
    const plinth = 70; let sa = '', sb = '', holes = '';
    slabs.forEach((s, i) => {
      const x = s[0], w = s[1], t = s[2];
      const d = 'M' + n(tx(x)) + ' ' + n(ty(t)) + 'H' + n(tx(x + w)) + 'V' + n(ty(plinth)) + 'H' + n(tx(x)) + 'Z';
      if (i % 2) sa += d; else sb += d;
      for (let yy = t + 2.5; yy < plinth - 1; yy += 5) for (let xx = x + 1.25; xx < x + w - 1.2; xx += 2.5) holes += circ(tx(xx), ty(yy), 0.24 * S);
    });
    return {
      l0: { d: grid, stroke: '#4C4E52', sw: 0.05, op: 0.4 },
      l1: { d: sb, fill: '#404145', flt: P.REL },
      l2: { d: sa, fill: '#2D2E31', flt: P.REL },
      l3: { d: holes, fill: '#1C1D1F', flt: P.DEB },
      l4: { d: 'M' + n(tx(4.5)) + ' ' + n(ty(70)) + 'H' + n(tx(49.48)), stroke: P.M, sw: 0.22, flt: P.FOIL }
    };
  },

  ivoryveil(r, P) {
    const yAt = (k, x) => -4 + k * 2.6 + 2.4 * Math.sin(x * 0.11 + k * 0.33) + 1.3 * Math.sin(x * 0.23 - k * 0.21 + 1.1) + 0.7 * Math.sin(x * 0.41 + k * 0.5);
    let lines = '';
    for (let k = 0; k < 25; k++) lines += smooth(sample((x) => yAt(k, x), -4, 90, 2.5));
    return {
      l0: { d: lines, stroke: '#F2ECE1', sw: 0.6, flt: P.REL }
    };
  },

  cobalt(r, P) {
    let d1 = '', d2 = '', d3 = '', ticks = '', cross = '';
    const sy = (x) => 63 - 7 * Math.sin(x * 0.12 + 0.6);
    const pitch = 1.1;
    for (let y = 44; y < 85.6 + 3.4; y += pitch) for (let x = pitch / 2 + Math.floor(DX0 / pitch) * pitch; x < DX1; x += pitch) {
      const v = Math.max(0, 1 - Math.abs(y - sy(x)) / 11) * (0.35 + 0.65 * Math.min(1, (x + 5) / 50));
      if (v < 0.12) continue;
      const s = 'M' + n(tx(x)) + ' ' + n(ty(y)) + 'h0';
      if (v < 0.38) d1 += s; else if (v < 0.66) d2 += s; else d3 += s;
    }
    for (let t = 0; t <= 40; t++) { const len = (t % 10 === 0 ? 1.6 : t % 5 === 0 ? 1.0 : 0.55) * S; ticks += 'M' + n(tx(49.6)) + ' ' + n(7 + t) + 'h' + n(-len); }
    [14, 40].forEach((x) => { const X = tx(x), Y = ty(sy(x)), a = 1.7 * S; cross += circ(X, Y, 0.9 * S) + 'M' + n(X - a) + ' ' + n(Y) + 'h' + n(2 * a) + 'M' + n(X) + ' ' + n(Y - a) + 'v' + n(2 * a); });
    return {
      l0: { d: d1, stroke: '#2B57D0', sw: 0.17 },
      l1: { d: d2, stroke: '#3F73FA', sw: 0.3 },
      l2: { d: d3, stroke: '#7AA6FF', sw: 0.44, flt: P.REL },
      l3: { d: smooth(mapped(sample(sy, DX0, DX1, 2))), stroke: '#B4CEFF', sw: 0.08, op: 0.9 },
      l4: { d: ticks, stroke: '#9DBDFF', sw: 0.07, op: 0.8 },
      // 0.15 mm: the foil minimum (the canvas drew 0.10, below what foil holds).
      l5: { d: cross, stroke: P.M, sw: 0.15, flt: P.FOIL }
    };
  },

  emerald(r, P) {
    const s = 3, h = 1.5, cols = 31, rows = 21, ox = -3.4, oy = -3.01;
    const o = [];
    for (let j = 0; j < rows; j++) { o.push([]); for (let i = 0; i < cols; i++) o[j].push(r() < 0.5 ? 0 : 1); }
    const mid = (i, j, e) => { const x = ox + i * s, y = oy + j * s; return e === 'top' ? [x + h, y] : e === 'bottom' ? [x + h, y + s] : e === 'left' ? [x, y + h] : [x + s, y + h]; };
    const corner = (i, j, a, b) => { const x = ox + i * s, y = oy + j * s; const t = a === 'top' || b === 'top', l = a === 'left' || b === 'left'; return [l ? x : x + s, t ? y : y + s]; };
    const arc = (c, p, q) => { const cr = (p[0] - c[0]) * (q[1] - c[1]) - (p[1] - c[1]) * (q[0] - c[0]); return 'M' + pt(p) + 'A' + h + ' ' + h + ' 0 0 ' + (cr > 0 ? 1 : 0) + ' ' + pt(q); };
    const X0 = { top: 'left', left: 'top', bottom: 'right', right: 'bottom' }, X1 = { top: 'right', right: 'top', bottom: 'left', left: 'bottom' };
    const OPP = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }, MV = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
    let all = '', chk = '';
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = ox + i * s, y = oy + j * s, X = o[j][i] === 0 ? X0 : X1;
      if ((i + j) % 2) chk += 'M' + pt([x, y]) + 'h3v3h-3Z';
      ['top', 'bottom'].forEach((e) => { all += arc(corner(i, j, e, X[e]), mid(i, j, e), mid(i, j, X[e])); });
    }
    /* The cipher thread: follow the tile connections from the right or bottom edge and keep the longest run. */
    const trace = (i, j, e) => {
      let d = '', len = 0; const seen = {};
      while (i >= 0 && j >= 0 && i < cols && j < rows && len < 300) {
        const key = i + ',' + j + ',' + e; if (seen[key]) break; seen[key] = 1;
        const x = (o[j][i] === 0 ? X0 : X1)[e];
        d += arc(corner(i, j, e, x), mid(i, j, e), mid(i, j, x)); len++;
        i += MV[x][0]; j += MV[x][1]; e = OPP[x];
      }
      return { d, len };
    };
    let best = { d: '', len: 0 };
    for (let j = 0; j < rows; j++) { const t = trace(cols - 1, j, 'right'); if (t.len > best.len) best = t; }
    for (let i = 14; i < cols; i++) { const t = trace(i, rows - 1, 'bottom'); if (t.len > best.len) best = t; }
    return {
      l0: { d: chk, fill: '#123226', op: 0.8 },
      l1: { d: all, stroke: '#1D4636', sw: 0.36, flt: P.REL },
      l2: { d: best.d, stroke: '#08190F', sw: 0.95, op: 0.6 },
      l3: { d: best.d, stroke: P.M, sw: 0.36, flt: P.FOIL }
    };
  },

  prism(r, P) {
    // The canvas's diagonal: (-2, 52) to (56, 22), extended left so it runs to the bleed.
    const yA = (x) => 52 + (x + 2) * (22 - 52) / 58;
    const yB = (x) => 64 + (x + 2) * (36 - 64) / 58;
    const band = (f) => 'M' + pt(mapped([[DX0, f(DX0)]])[0]) + 'L' + pt(mapped([[DX1, f(DX1)]])[0]) + 'L' + n(W + 3) + ' ' + n(H + 3) + 'L-3 ' + n(H + 3) + 'Z';
    let lines = '';
    for (let k = 0; ; k++) {
      const dy = k * 0.7, a = mapped([[DX0, yA(DX0) + dy], [DX1, yA(DX1) + dy]]);
      if (a[1][1] > H + 3) break;
      lines += 'M' + pt(a[0]) + 'L' + pt(a[1]);
    }
    const edge = mapped([[DX0, yA(DX0)], [DX1, yA(DX1)], [DX0, yA(DX0) - 1.6], [DX1, yA(DX1) - 1.6]]);
    return {
      l0: { d: band(yA), fill: P.A, op: 0.95 },
      l1: { d: band(yB), fill: P.B, op: 0.55 },
      l2: { d: lines, stroke: '#FFFFFF', sw: 0.16, op: P.tierB ? 0.6 : 0.35, flt: P.REL },
      l3: { d: 'M' + pt(edge[0]) + 'L' + pt(edge[1]) + 'M' + pt(edge[2]) + 'L' + pt(edge[3]), stroke: '#2C2B33', sw: 0.08, op: 0.5 }
    };
  },

  carbon(r, P) {
    const c = 1.5; let hz = '', vt = '';
    for (let j = -2; j * c < H + 3; j++) for (let i = -2; i * c < W + 3; i++) {
      const d = 'M' + n(i * c + 0.07) + ' ' + n(j * c + 0.07) + 'h1.36v1.36h-1.36Z';
      if ((((i + j) % 4) + 4) % 4 < 2) hz += d; else vt += d;
    }
    // The vermilion line keeps its distance from the right edge (5.38 and 4.23 mm).
    return {
      l0: { d: hz, fill: P.A },
      l1: { d: vt, fill: P.B },
      l2: { d: 'M' + n(W - 5.38) + ' -3V' + n(H + 3), stroke: '#E5482F', sw: 0.55 },
      l3: { d: 'M' + n(W - 4.23) + ' -3V' + n(H + 3), stroke: '#E5482F', sw: 0.18 }
    };
  },

  heritage(r, P) {
    // The canvas lattice turned with the card: columns at -0.4 + 7.2i, rows at -1.81 + 7.2j.
    const p = 7.2, a = p / (1 + Math.SQRT2), R = a / (2 * Math.sin(Math.PI / 8)), q = a / Math.SQRT2;
    let oct = '', oct2 = '', ros = '', sq = '', dots = '';
    for (let j = -1; j <= 8; j++) for (let i = -1; i <= 13; i++) {
      const cx = i * p - 0.4, cy = j * p - 1.81;
      let d = '', d2 = '';
      for (let k = 0; k < 8; k++) {
        const t = Math.PI / 8 + k * Math.PI / 4;
        d += (k ? 'L' : 'M') + n(cx + R * Math.cos(t)) + ' ' + n(cy + R * Math.sin(t));
        d2 += (k ? 'L' : 'M') + n(cx + 0.78 * R * Math.cos(t)) + ' ' + n(cy + 0.78 * R * Math.sin(t));
      }
      oct += d + 'Z'; oct2 += d2 + 'Z';
      for (let k = 0; k < 8; k++) {
        const t = k * Math.PI / 4, tx2 = cx + 2.35 * Math.cos(t), ty2 = cy + 2.35 * Math.sin(t);
        ros += 'M' + n(cx) + ' ' + n(cy) + 'A1.45 1.45 0 0 1 ' + n(tx2) + ' ' + n(ty2) + 'A1.45 1.45 0 0 1 ' + n(cx) + ' ' + n(cy);
      }
      const sx = cx + p / 2, sy = cy + p / 2, e = 0.45;
      sq += 'M' + n(sx - q) + ' ' + n(sy) + 'L' + n(sx) + ' ' + n(sy - q) + 'L' + n(sx + q) + ' ' + n(sy) + 'L' + n(sx) + ' ' + n(sy + q) + 'Z';
      dots += 'M' + n(sx - e) + ' ' + n(sy) + 'L' + n(sx) + ' ' + n(sy - e) + 'L' + n(sx + e) + ' ' + n(sy) + 'L' + n(sx) + ' ' + n(sy + e) + 'Z';
    }
    return {
      l0: { d: sq, fill: '#5C2417', op: 0.95, flt: P.DEB },
      l1: { d: oct, stroke: '#64291B', sw: 0.55, flt: P.DEB },
      l2: { d: oct, stroke: '#EAD8B8', sw: 0.13, op: 0.6 },
      l3: { d: oct2, stroke: '#EAD8B8', sw: 0.06, op: 0.35 },
      l4: { d: ros, stroke: '#EAD8B8', sw: 0.09, op: 0.5 },
      l5: { d: dots, fill: P.M, flt: P.FOIL }
    };
  },

  liquid(r, P) {
    const bands = [
      { b: 50, s: 0.36, A: 2.6, f: 0.11, p: 0.3, B2: 1.2, g: 0.21, q: 1.2 },
      { b: 59, s: 0.37, A: 2.4, f: 0.1, p: 1.4, B2: 1.1, g: 0.23, q: 2.3 },
      { b: 68, s: 0.38, A: 2.6, f: 0.09, p: 2.6, B2: 1.0, g: 0.2, q: 0.4 },
      { b: 77, s: 0.39, A: 2.2, f: 0.12, p: 3.7, B2: 1.2, g: 0.22, q: 3.1 }
    ];
    const fills = [], cont = []; let edges = '';
    bands.forEach((k) => {
      const f = (x) => k.b - k.s * x + k.A * Math.sin(k.f * x + k.p) + k.B2 * Math.sin(k.g * x + k.q);
      const top = smooth(mapped(sample(f, DX0, DX1 + 2.5, 2.5)));
      fills.push(top + 'L' + n(W + 6) + ' ' + n(H + 6) + 'L-6 ' + n(H + 6) + 'Z');
      edges += top;
      let c = ''; [0.9, 1.8, 2.7].forEach((o) => { c += smooth(mapped(sample(f, DX0, DX1 + 2.5, 2.5, o))); }); cont.push(c);
    });
    return {
      l0: { d: fills[0], fill: P.B, flt: P.REL },
      l1: { d: cont[0], stroke: '#7A4A8A', sw: 0.07, op: 0.55 },
      l2: { d: fills[1], fill: P.A, flt: P.REL },
      l3: { d: cont[1], stroke: '#7A4A8A', sw: 0.07, op: 0.55 },
      l4: { d: fills[2], fill: P.B, flt: P.REL },
      l5: { d: cont[2], stroke: '#7A4A8A', sw: 0.07, op: 0.55 },
      l6: { d: fills[3], fill: P.A, flt: P.REL },
      l7: { d: edges, stroke: P.M, sw: 0.18, flt: P.FOIL }
    };
  }
};

/* Edition records, verbatim from the canvas. tex: material tooth (baseFrequency, octaves, surface scale, light elevation, strength).
   rel: relief bevel (blur, offset, highlight colour/opacity, shadow colour/opacity, cast shadow). */
const D = {
  obsidian: { no: '01', name: 'Obsidian', code: 'OB', seed: 11, b: ['#1A1A1E', '#0E0E10', '#060607'], m: ['#7A5C2C', '#E9D29B', '#A8864C', '#F6E6BC', '#8C6C38'], flat: '#B8975A',
    tex: ['2.4', 3, 1.4, 55, 0.9], rel: [0.1, 0.1, '#ffffff', 0.16, '#000000', 0.85, 0.4], light: 0.12, vig: 0.5, sheen: 0.05, edge: 'rgba(255,255,255,0.1)', backOp: 0.45, plate: '#EFE6D3', qr: '#101010', bInk: '#D9CCAE', bMuted: '#9C927E' },
  aureate: { no: '02', name: 'Aureate', code: 'AU', seed: 23, b: ['#FAF4E8', '#F1E8D6', '#E2D5BB'], m: ['#8E6C32', '#EBD7A4', '#B39255', '#F8EBC7', '#9C7A3E'], flat: '#B08C4E',
    tex: ['1.7', 3, 0.9, 60, 0.7], rel: [0.14, 0.13, '#ffffff', 0.95, '#A8946E', 0.55, 0.12], light: 0.25, vig: 0.22, sheen: 0.12, edge: 'rgba(58,46,31,0.2)', backOp: 0.55, plate: '#FBF7EF', qr: '#2E2418', bInk: '#4A3B27', bMuted: '#7A6A52' },
  monolith: { no: '03', name: 'Monolith', code: 'MO', seed: 37, b: ['#424346', '#36373A', '#29292C'], m: ['#B5B0A7', '#F4F1EB', '#CFCAC1', '#FFFFFF', '#BDB8AF'], flat: '#E7E3DB',
    tex: ['0.9', 4, 3.2, 50, 1], rel: [0.08, 0.12, '#ffffff', 0.2, '#000000', 0.7, 0.45], light: 0.1, vig: 0.42, sheen: 0.03, edge: 'rgba(255,255,255,0.1)', backOp: 0.4, plate: '#E7E3DB', qr: '#252628', bInk: '#E7E3DB', bMuted: '#A7A39C' },
  ivoryveil: { no: '04', name: 'Ivory Veil', code: 'IV', seed: 41, b: ['#FDFBF7', '#F6F1E8', '#E9E1D2'], m: ['#8C7650', '#E9DAB6', '#AE9564', '#F5EAD0', '#97805A'], flat: '#A89068',
    tex: ['1.9', 3, 0.7, 60, 0.6], rel: [0.2, 0.16, '#ffffff', 1, '#B3A385', 0.6, 0.1], light: 0.25, vig: 0.2, sheen: 0.1, edge: 'rgba(60,50,40,0.16)', backOp: 0.6, plate: '#FFFFFF', qr: '#2A2621', bInk: '#4A433A', bMuted: '#7A7167' },
  cobalt: { no: '05', name: 'Cobalt', code: 'CB', seed: 53, b: ['#16306A', '#0C1E4A', '#061230'], m: ['#7F8DA6', '#F2F5FA', '#A3B0C4', '#E6ECF4', '#8995AC'], flat: '#D3DCEB',
    tex: ['0.012 2.2', 2, 2, 50, 0.9], rel: [0.05, 0.07, '#ffffff', 0.5, '#000000', 0.6, 0.3], light: 0.14, vig: 0.45, sheen: 0.07, edge: 'rgba(160,190,255,0.16)', backOp: 0.45, plate: '#E5E9F0', qr: '#0A1A3D', bInk: '#E6EEFB', bMuted: '#9DB1D6' },
  emerald: { no: '06', name: 'Emerald Cipher', code: 'EC', seed: 67, b: ['#173B2D', '#0F2A21', '#091C15'], m: ['#7E6838', '#E6D29A', '#A88E57', '#F0E0AE', '#8A7442'], flat: '#B59B62',
    tex: ['2.1', 3, 1.2, 55, 0.8], rel: [0.08, 0.09, '#ffffff', 0.14, '#000000', 0.7, 0.35], light: 0.12, vig: 0.45, sheen: 0.05, edge: 'rgba(228,216,184,0.14)', backOp: 0.42, plate: '#EFE8D6', qr: '#0F2A21', bInk: '#E4D8B8', bMuted: '#A9AE98' },
  prism: { no: '07', name: 'Prism', code: 'PR', seed: 79, b: ['#F7F6FA', '#ECEBF1', '#DEDDE6'], m: ['#2C2B33', '#6B6878', '#2C2B33', '#55535F', '#2C2B33'], flat: '#2C2B33',
    tex: ['2.6', 2, 0.4, 65, 0.35], rel: [0.04, 0.05, '#ffffff', 0.8, '#7A6FA8', 0.25, 0.05], light: 0.3, vig: 0.18, sheen: 0.16, edge: 'rgba(44,43,51,0.14)', backOp: 0.6, plate: '#FFFFFF', qr: '#1E1D24', bInk: '#2C2B33', bMuted: '#64626E',
    A: { s: ['#CBB8FF', '#A6E1F5', '#C2F0D6', '#FFD2B5'] }, B: { x1: 1, y1: 0, x2: 0, y2: 1, s: ['#FFCDB8', '#F6C1E6', '#C7BCFF', '#B5E8F7'] } },
  carbon: { no: '08', name: 'Carbon Weave', code: 'CW', seed: 83, b: ['#1B1C1E', '#141516', '#0D0E0F'], m: ['#7D8085', '#EEF0F2', '#9A9DA2', '#DADCDF', '#868A8F'], flat: '#C9CBCE', calm: [19, 20],
    tex: ['2.6', 2, 0.5, 60, 0.3], rel: [0.05, 0.06, '#ffffff', 0.3, '#000000', 0.5, 0.3], light: 0.16, vig: 0.4, sheen: 0.14, edge: 'rgba(255,255,255,0.1)', backOp: 0.4, plate: '#E9EAEC', qr: '#111213', bInk: '#D7D9DC', bMuted: '#8E9196',
    A: { u: 'userSpaceOnUse', sp: 'repeat', x1: 0, y1: 0, x2: 0, y2: 1.5, s: ['#0C0D0E', '#2C2E31', '#1E2022', '#0C0D0E'] }, B: { u: 'userSpaceOnUse', sp: 'repeat', x1: 0, y1: 0, x2: 1.5, y2: 0, s: ['#0B0C0D', '#212326', '#2A2C2F', '#0B0C0D'] } },
  heritage: { no: '09', name: 'Heritage Geometry', code: 'HG', seed: 97, b: ['#8E402C', '#7A3323', '#5C2518'], m: ['#94702F', '#EED6A0', '#B8924F', '#F4E2B2', '#A07A3A'], flat: '#C9A35E',
    tex: ['1.2', 4, 2, 50, 0.85], rel: [0.1, 0.12, '#FFE9CF', 0.35, '#2A0E07', 0.7, 0.3], light: 0.14, vig: 0.4, sheen: 0.05, edge: 'rgba(241,227,200,0.16)', backOp: 0.4, plate: '#F3E7D2', qr: '#4A1D13', bInk: '#F1E3C8', bMuted: '#D9C0A3' },
  liquid: { no: '10', name: 'Liquid Form', code: 'LF', seed: 101, b: ['#331A3C', '#26122D', '#1A0C20'], m: ['#8E5238', '#F2C6A9', '#B9785B', '#F8DCC8', '#9C5E43'], flat: '#D49A7A',
    tex: ['2.3', 3, 0.8, 60, 0.6], rel: [0.35, 0.25, '#ffffff', 0.12, '#000000', 0.55, 0.5], light: 0.14, vig: 0.45, sheen: 0.08, edge: 'rgba(243,228,238,0.12)', backOp: 0.45, plate: '#F3E8EE', qr: '#24112B', bInk: '#F3E4EE', bMuted: '#B79BB3',
    A: { x1: 0, y1: 0, x2: 0, y2: 1, s: ['#5E3474', '#46255D', '#30183D', '#22102A'] }, B: { x1: 0, y1: 0, x2: 0, y2: 1, s: ['#724486', '#552F6A', '#3C2049', '#2A1533'] } }
};

/**
 * The CMYK starting values from the colour & typography sheet (Spec), per
 * edition: [role, hex, C, M, Y, K]. A printer hard proof confirms them.
 */
export const SPEC = {
  obsidian: [['Base · rich black', '#0E0E10', 60, 50, 40, 100], ['Lattice tone', '#1F1F24', 40, 30, 25, 90], ['Champagne gold', '#B8975A', 25, 38, 72, 8], ['Highlight gold', '#E9D29B', 6, 14, 45, 0], ['QR plate', '#EFE6D3', 5, 8, 17, 0]],
  aureate: [['Base · warm ivory', '#F2EADA', 3, 6, 15, 0], ['Linen', '#D9CBAF', 10, 16, 32, 0], ['Champagne', '#B8975A', 25, 38, 72, 8], ['Umber ink', '#3A2E1F', 45, 58, 78, 62], ['Muted ink', '#6B5C45', 40, 45, 62, 35]],
  monolith: [['Base · charcoal', '#333437', 30, 20, 20, 82], ['Slab light', '#424347', 30, 20, 18, 72], ['Slab dark', '#2B2C2F', 40, 30, 28, 88], ['Grid', '#4C4E52', 25, 18, 15, 68], ['Bone', '#E7E3DB', 6, 6, 10, 0]],
  ivoryveil: [['Base · porcelain', '#F7F3EC', 2, 3, 7, 0], ['Fold', '#EFE9DE', 4, 5, 11, 0], ['Veil shadow', '#D6CCBA', 12, 15, 26, 0], ['Taupe ink', '#6C6357', 40, 42, 52, 30], ['Text', '#3F3933', 55, 55, 62, 55]],
  cobalt: [['Base · midnight', '#0B1C45', 100, 85, 30, 45], ['Electric blue', '#3B6EF5', 78, 55, 0, 0], ['Signal light', '#6F9DFF', 55, 30, 0, 0], ['Halftone deep', '#2753C9', 88, 68, 0, 0], ['Ice white', '#E6EEFB', 8, 3, 0, 0]],
  emerald: [['Base · forest', '#0F2A21', 85, 45, 75, 65], ['Tonal maze', '#1E4A3A', 80, 40, 65, 40], ['Checker', '#123226', 85, 45, 72, 58], ['Brass', '#B59B62', 25, 32, 68, 10], ['Pale brass ink', '#E4D8B8', 8, 10, 28, 0]],
  prism: [['Base · pearl', '#ECEBF1', 5, 5, 0, 3], ['Lilac', '#CBB8FF', 20, 28, 0, 0], ['Ice', '#A6E1F5', 32, 0, 4, 0], ['Peach', '#FFD2B5', 0, 20, 28, 0], ['Graphite ink', '#2C2B33', 70, 65, 50, 60]],
  carbon: [['Base · carbon', '#141516', 70, 60, 55, 85], ['Tow light', '#2A2C2F', 60, 50, 45, 75], ['Tow dark', '#0C0D0E', 70, 60, 60, 95], ['Vermilion', '#E5482F', 0, 85, 85, 0], ['Silver ink', '#C9CBCE', 8, 5, 5, 22]],
  heritage: [['Base · laterite', '#7A3323', 25, 85, 95, 30], ['Deep laterite', '#5C2417', 30, 85, 95, 50], ['Lime plaster', '#EAD8B8', 6, 14, 30, 0], ['Gold', '#C9A35E', 20, 35, 70, 5], ['Plaster muted', '#D9C0A3', 12, 24, 36, 0]],
  liquid: [['Base · plum', '#26122D', 70, 90, 45, 60], ['Layer', '#43245A', 70, 90, 30, 30], ['Layer light', '#6E4183', 60, 80, 15, 5], ['Copper', '#D49A7A', 12, 42, 50, 0], ['Rose ink', '#F3E4EE', 3, 10, 0, 0]]
};

/**
 * Tier B finishes per edition, from the manufacturing sheet. `foil`: the foil
 * plate (null: the metal prints as ink); `rel` / `deb`: the plate for relief
 * and deboss layers (null: printed only); `idFoil`: whether the logo, AAROH
 * and VERSION 01 are foiled. Monolith's plinth is raised UV, not foil.
 */
export const FINISH_B = {
  obsidian: { foil: 'FOIL_CHAMPAGNE', rel: 'RAISED_UV', deb: null, idFoil: true, laminate: 'Soft-touch (velvet) matte laminate', edge: 'Champagne edge paint, after an abrasion test' },
  aureate: { foil: 'FOIL_CHAMPAGNE', rel: 'EMBOSS', deb: null, idFoil: true, laminate: 'Satin laminate', edge: null },
  monolith: { foil: null, foilAs: 'RAISED_UV', rel: 'RAISED_UV', deb: null, idFoil: false, laminate: 'Matte laminate', edge: null },
  ivoryveil: { foil: null, rel: 'EMBOSS', relNoInk: true, deb: null, idFoil: false, laminate: 'Pearl-satin laminate', edge: null },
  cobalt: { foil: 'FOIL_SILVER', rel: 'RAISED_UV', deb: null, idFoil: true, laminate: 'Satin laminate', edge: 'Silver edge paint, after an abrasion test' },
  emerald: { foil: 'FOIL_BRASS', rel: null, deb: null, idFoil: true, laminate: 'Matte laminate', edge: null },
  prism: { foil: null, rel: 'SPOT_UV', deb: null, idFoil: false, laminate: 'Gloss laminate', edge: null },
  carbon: { foil: null, rel: null, deb: null, field: 'TACTILE_VARNISH', idFoil: false, laminate: 'Matte laminate', edge: null },
  heritage: { foil: 'FOIL_GOLD', rel: null, deb: 'DEBOSS', idFoil: true, laminate: 'Matte laminate', edge: null },
  liquid: { foil: 'FOIL_COPPER', rel: null, deb: null, idFoil: true, laminate: 'Soft-touch matte laminate', edge: null }
};

/** The store's edition ids, E01–E10, and their design-system keys. */
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
export const editionRecord = (storeId) => {
  const key = CANVAS_KEY[storeId];
  if (!key) throw new Error(`Unknown edition: ${storeId}`);
  return { key, ...D[key], spec: SPEC[key], finishB: FINISH_B[key] };
};

// ------------------------------------------------------------ the layout ---
/** Front: the official logo, AAROH and BY SHYGON on the identity axis; VERSION 01 on the ornament axis. */
const FRONT = {
  mark: { h: 10, top: 15 },
  aaroh: { size: 6.21, tracking: 1.86 / 6.21, y: 34.6 },
  by: { size: 1.72, tracking: 1.07 / 1.72, y: 39.05 },
  version: { size: 1.79, tracking: 0.32 / 1.79, y: n(ty(74.6)) },
  calm: { cx: IX, cy: 27 },
};
/** Back: the QR plate on the right, the official lockup and the card data on the left. */
const BACK = {
  plate: { x: 56.5, y: 9.5, size: 22.97 },
  qr: 18,
  // 21.6 mm tall, so the wordmark under the mark keeps the 1.20 mm type minimum.
  lockup: { x: 8, y: 5.2, h: 21.6 },
  left: 8,
  serial: { size: 2.34, tracking: 0.33 / 2.34, y: 32.2 },
  chapter: { size: 1.65, tracking: 0.26 / 1.65, y: 36.1 },
  legal: { size: 1.65, tracking: 0.33 / 1.65, y: 43.6 },
  edition: { size: 1.5, tracking: 0.3 / 1.5, y: 47.3 },
  tap: { size: 2.06, tracking: 0.62 / 2.06, y: 41.15 },
};
const PLATE_CX = BACK.plate.x + BACK.plate.size / 2;
const PLATE_CY = BACK.plate.y + BACK.plate.size / 2;
const QR_X = PLATE_CX - BACK.qr / 2;
const QR_Y = PLATE_CY - BACK.qr / 2;

const FINDERS = (() => {
  const m = 18 / 29;
  const sq = (x, y, s) => 'M' + n(x) + ' ' + n(y) + 'h' + n(s) + 'v' + n(s) + 'h' + n(-s) + 'Z';
  const fp = (x, y) => sq(x, y, 7 * m) + sq(x + m, y + m, 5 * m) + sq(x + 2 * m, y + 2 * m, 3 * m);
  return fp(QR_X, QR_Y) + fp(QR_X + 18 - 7 * m, QR_Y) + fp(QR_X, QR_Y + 18 - 7 * m);
})();

/** Tap glyph: a point and three arcs, deliberately not the licensed NFC or contactless marks. */
const tapGlyph = (cx, cy) => {
  let arcs = '';
  for (const r of [1.1, 1.9, 2.7]) {
    const a = 0.9;
    arcs += 'M' + n(cx + r * Math.cos(-a)) + ' ' + n(cy + r * Math.sin(-a)) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(cx + r * Math.cos(a)) + ' ' + n(cy + r * Math.sin(a));
  }
  return { arcs, dot: circ(cx, cy, 0.38) };
};

/** A rounded rectangle as a path (for clips, dies and plates). */
export const roundRect = (x, y, w, h, r) =>
  'M' + n(x + r) + ' ' + n(y) + 'H' + n(x + w - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + w) + ' ' + n(y + r) + 'V' + n(y + h - r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + w - r) + ' ' + n(y + h) + 'H' + n(x + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x) + ' ' + n(y + h - r) + 'V' + n(y + r) + 'A' + r + ' ' + r + ' 0 0 1 ' + n(x + r) + ' ' + n(y) + 'Z';
/** An ellipse as a path. */
export const ellipse = (cx, cy, rx, ry) =>
  'M' + n(cx - rx) + ' ' + n(cy) + 'A' + n(rx) + ' ' + n(ry) + ' 0 1 0 ' + n(cx + rx) + ' ' + n(cy) + 'A' + n(rx) + ' ' + n(ry) + ' 0 1 0 ' + n(cx - rx) + ' ' + n(cy) + 'Z';

/**
 * The fixed vector elements of one face: the official logo, the words, the tap
 * glyph and the QR plate. Each item: { d, fill?, stroke?, sw?, rule?, role }
 * where role is 'brand' (foiled on Tier B where the edition foils its
 * identity), 'ink' (always printed) or 'variable' (per card: a placeholder).
 */
export function faceElements(storeId, side) {
  const c = editionRecord(storeId);
  const items = [];
  if (side === 'front') {
    const s = FRONT.mark.h / MARK.height;
    const mx = IX - (MARK.width * s) / 2;
    items.push({ d: MARK.d, transform: [s, mx, FRONT.mark.top], rule: 'evenodd', role: 'brand' });
    items.push({ d: text('AAROH', { font: 'serif400', size: FRONT.aaroh.size, tracking: FRONT.aaroh.tracking, x: IX, y: FRONT.aaroh.y, anchor: 'middle' }).d, role: 'brand' });
    items.push({ d: text('BY', { font: 'inter500', size: FRONT.by.size, tracking: FRONT.by.tracking, x: IX - 11.44, y: FRONT.by.y }).d, role: 'brand' });
    items.push({ d: WORDMARK.d, transform: [0.0284, IX - 6.03, FRONT.by.y - 1.31], rule: 'evenodd', role: 'brand' });
    items.push({ d: text('VERSION 01', { font: 'inter500', size: FRONT.version.size, tracking: FRONT.version.tracking, x: OX, y: FRONT.version.y, anchor: 'middle' }).d, role: 'brand' });
    return items;
  }
  const p = BACK.plate;
  items.push({ d: roundRect(p.x - 0.9, p.y - 0.9, p.size + 1.8, p.size + 1.8, 0.6), stroke: 'metal', sw: 0.16, role: 'ink' });
  items.push({ d: roundRect(p.x, p.y, p.size, p.size, 0.3), fill: c.plate, role: 'ink' });
  const ls = BACK.lockup.h / LOCKUP.height;
  items.push({ d: LOCKUP.mark + LOCKUP.word, transform: [ls, BACK.lockup.x, BACK.lockup.y], rule: 'evenodd', role: 'brand' });
  const tapText = text('TAP OR SCAN', { font: 'inter500', size: BACK.tap.size, tracking: BACK.tap.tracking, x: 0, y: 0 });
  const groupW = 3.1 + 1.3 + tapText.width;
  const gx = PLATE_CX - groupW / 2;
  const glyph = tapGlyph(gx + 0.38, BACK.tap.y - 0.75);
  items.push({ d: glyph.arcs, stroke: 'metal', sw: 0.3, role: 'brand' });
  items.push({ d: glyph.dot, role: 'brand' });
  items.push({ d: text('TAP OR SCAN', { font: 'inter500', size: BACK.tap.size, tracking: BACK.tap.tracking, x: gx + 4.4, y: BACK.tap.y }).d, role: 'brand' });
  const L0 = BACK.left;
  items.push({ d: text('SHYGON TECHNOLOGIES PVT. LTD.', { size: BACK.legal.size, tracking: BACK.legal.tracking, x: L0, y: BACK.legal.y }).d, fill: c.bInk, role: 'ink' });
  items.push({ d: text('EDITION ' + c.no + ' · ' + c.name.toUpperCase(), { size: BACK.edition.size, tracking: BACK.edition.tracking, x: L0, y: BACK.edition.y }).d, fill: c.bMuted, role: 'ink' });
  // Per card, from the data file: serial, chapter and the QR. These are examples.
  items.push({ d: text('AR1-' + c.code + '-000042', { size: BACK.serial.size, tracking: BACK.serial.tracking, x: L0, y: BACK.serial.y }).d, fill: 'metal', role: 'variable' });
  items.push({ d: text('CHAPTER I · Nº 042 / 100', { size: BACK.chapter.size, tracking: BACK.chapter.tracking, x: L0, y: BACK.chapter.y }).d, fill: c.bMuted, role: 'variable' });
  items.push({ d: FINDERS, fill: c.qr, rule: 'evenodd', role: 'variable' });
  return items;
}

/** Where the variable data goes, for the printer's data merge (trim coordinates, mm). */
export const VARIABLE_FIELDS = {
  serial: { x: BACK.left, baseline: BACK.serial.y, font: 'Inter 500', size: BACK.serial.size, tracking: n(BACK.serial.tracking), example: 'AR1-OB-000042', format: 'AR1-<edition code>-<six-digit serial>' },
  chapter: { x: BACK.left, baseline: BACK.chapter.y, font: 'Inter 500', size: BACK.chapter.size, tracking: n(BACK.chapter.tracking), example: 'CHAPTER I · Nº 042 / 100', format: 'CHAPTER <roman> · Nº <three digits> / 100' },
  qr: { x: n(QR_X), y: n(QR_Y), size: BACK.qr, quietZone: '4 modules (inside the plate)', content: 'the card’s verified https URL', note: 'never foil' },
};

/** The calm zones: art fades out behind the identity (front) and the data (back). */
export const CALM = {
  front: (storeId) => { const c = editionRecord(storeId); const cm = c.calm || [23, 21]; return { cx: FRONT.calm.cx, cy: FRONT.calm.cy, rx: cm[0], ry: cm[1] }; },
  back: { cx: 20, cy: 27, rx: 19, ry: 27 },
  qr: { x: BACK.plate.x - 1.9, y: BACK.plate.y - 1.9, w: BACK.plate.size + 3.8, h: BACK.plate.size + 3.8, r: 1.2 },
};

/**
 * The edition's art layers with their Tier B role: 'rel', 'deb', 'foil' or
 * null. `metal` is what a foil-role layer is drawn in.
 */
export function artLayers(storeId, { tierB, metal, artA, artB, filters = {} }) {
  const c = editionRecord(storeId);
  const ROLE = { REL: '@rel', DEB: '@deb', FOIL: '@foil' };
  const P = { M: metal, A: artA, B: artB, tierB, REL: ROLE.REL, DEB: ROLE.DEB, FOIL: ROLE.FOIL };
  const raw = ART[c.key](rng(c.seed), P);
  const layers = [];
  for (let i = 0; i < 8; i++) {
    const l = L(raw['l' + i]);
    const role = l.flt === ROLE.REL ? 'rel' : l.flt === ROLE.DEB ? 'deb' : l.flt === ROLE.FOIL ? 'foil' : null;
    l.role = role;
    l.flt = (role && filters[role]) || 'none';
    layers.push(l);
  }
  return layers;
}

const layerSvg = (o) =>
  o.d
    ? `<path d="${o.d}" fill="${o.fill}" stroke="${o.stroke}" stroke-width="${o.sw}" opacity="${o.op}"${o.flt !== 'none' ? ` filter="${o.flt}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`
    : '';
const stops4 = (g) => `<stop offset="0" stop-color="${g.s[0]}"/><stop offset="0.35" stop-color="${g.s[1]}"/><stop offset="0.7" stop-color="${g.s[2]}"/><stop offset="1" stop-color="${g.s[3]}"/>`;
const elementSvg = (e, fill, stroke) => {
  const t = e.transform ? ` transform="translate(${n(e.transform[1] * 1000) / 1000} ${n(e.transform[2] * 1000) / 1000}) scale(${e.transform[0]})"` : '';
  if (e.stroke) return `<path d="${e.d}" fill="none" stroke="${stroke}" stroke-width="${e.sw}" stroke-linecap="round"${t}/>`;
  return `<path d="${e.d}" fill="${fill}"${e.rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${t}/>`;
};

/**
 * One face of one edition as a standalone SVG.
 *   mode 'mockup' (default): the store render, with the design system's
 *     lighting, grain and relief, clipped to the die (85.60 × 53.98, r 3.18);
 *   mode 'print': the printed CMYK artwork only, to the 3 mm bleed, with no
 *     lighting, no relief and none of the logo, words or variable data (those
 *     are vector in the print PDF, see print.mjs). Tier B leaves out what
 *     its foil plate carries.
 * @param {string} storeId  an id from STORE_EDITIONS
 * @param {{side?: 'front'|'back', finish?: 'standard'|'premium', px?: number, mode?: 'mockup'|'print'}} options
 */
export function cardSvg(storeId, { side = 'front', finish = 'premium', px = 16, mode = 'mockup' } = {}) {
  const c = editionRecord(storeId);
  const id = c.key;
  const back = side === 'back';
  const B = finish !== 'standard';
  const print = mode === 'print';
  const fin = c.finishB;
  const key = id + (back ? '-b' : '-f') + (B ? 'p' : 's') + (print ? 'x' : '');
  const ids = {};
  const u = {};
  for (const k of ['clip', 'base', 'metal', 'metalId', 'artA', 'artB', 'light', 'vig', 'sheen', 'calm', 'tex', 'rel', 'deb', 'foil', 'mask']) {
    ids[k] = 'aa-' + k + '-' + key;
    u[k] = 'url(#' + ids[k] + ')';
  }
  // Tier B mockups show metal only where the edition is foiled; ink stays ink.
  // Finishes are front-only: the back's art is a 40-60% tint, and foil or
  // relief cannot be a tint, so the back prints its art as ink.
  const finished = B && !back;
  const foiled = finished && !print && Boolean(fin.foil);
  const metal = foiled ? u.metal : c.flat;
  const filters = finished && !print ? { rel: fin.rel || fin.foilAs ? u.rel : null, deb: fin.deb ? u.deb : null, foil: fin.foil ? u.foil : fin.foilAs ? u.rel : null } : {};
  let layers = artLayers(storeId, { tierB: B, metal, artA: u.artA, artB: u.artB, filters });
  if (print && finished) {
    // Foil goes on its own plate; an emboss-only relief has no ink.
    layers = layers.filter((l) => !(l.role === 'foil' && fin.foil) && !(l.role === 'rel' && fin.relNoInk));
  }
  const dg = { u: 'objectBoundingBox', sp: 'pad', x1: 0, y1: 0, x2: 1, y2: 1, s: [c.b[0], c.b[1], c.b[1], c.b[2]] };
  const grad = (g) => Object.assign({}, dg, g || {});
  const A = grad(c.A);
  const Bg = grad(c.B);
  const t = c.tex;
  const g = 2.2;
  const v0 = Math.sin((t[3] * Math.PI) / 180);
  const off = n(0.5 - g * v0);
  const tx2 = { f: t[0], o: t[1], ss: t[2], el: t[3], k: n(t[4] * (B ? 1 : 0.6)), m: g + ' 0 0 0 ' + off + ' 0 ' + g + ' 0 0 ' + off + ' 0 0 ' + g + ' 0 ' + off + ' 0 0 0 0 1' };
  const rp = c.rel;
  const rl = { b: rp[0], o: rp[1], no: -rp[1], hc: rp[2], ho: rp[3], sc: rp[4], so: rp[5], co: rp[6] };
  const light = id === 'aureate' || id === 'ivoryveil' || id === 'prism';
  const fl = { b: 0.05, o: 0.06, no: -0.06, ho: light ? 0.75 : 0.55, sc: light ? '#5A4524' : '#000000', so: light ? 0.35 : 0.5, co: light ? 0.18 : 0.4 };
  const calm = CALM.front(storeId);
  // The drawing area: the die for mockups, the bleed for print.
  const X0 = print ? -CARD.bleed : 0;
  const Y0 = print ? -CARD.bleed : 0;
  const VW = print ? W + 2 * CARD.bleed : W;
  const VH = print ? H + 2 * CARD.bleed : H;
  const area = `x="${X0}" y="${Y0}" width="${n(VW)}" height="${n(VH)}"`;

  const maskBody = back
    ? `<ellipse cx="${CALM.back.cx}" cy="${CALM.back.cy}" rx="${CALM.back.rx}" ry="${CALM.back.ry}" fill="${u.calm}"/><rect x="${n(CALM.qr.x)}" y="${n(CALM.qr.y)}" width="${n(CALM.qr.w)}" height="${n(CALM.qr.h)}" rx="${CALM.qr.r}" fill="#000000"/>`
    : `<ellipse cx="${calm.cx}" cy="${calm.cy}" rx="${calm.rx}" ry="${calm.ry}" fill="${u.calm}"/>`;

  const defs =
    `<clipPath id="${ids.clip}"><path d="${roundRect(0, 0, W, H, CARD.radius)}"/></clipPath>` +
    `<linearGradient id="${ids.base}" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="${c.b[0]}"/><stop offset="0.55" stop-color="${c.b[1]}"/><stop offset="1" stop-color="${c.b[2]}"/></linearGradient>` +
    `<linearGradient id="${ids.metal}" gradientUnits="userSpaceOnUse" x1="-20" y1="-12.6" x2="${W}" y2="${H}"><stop offset="0" stop-color="${c.m[0]}"/><stop offset="0.22" stop-color="${c.m[1]}"/><stop offset="0.42" stop-color="${c.m[2]}"/><stop offset="0.6" stop-color="${c.m[3]}"/><stop offset="0.8" stop-color="${c.m[2]}"/><stop offset="1" stop-color="${c.m[4]}"/></linearGradient>` +
    // The foiled words and logo catch the light as a whole, mostly in the mid metal, so they read on light grounds too.
    `<linearGradient id="${ids.metalId}" gradientUnits="userSpaceOnUse" x1="${back ? 0 : IX - 16}" y1="${back ? 0 : 12}" x2="${back ? W : IX + 16}" y2="${back ? H : 42}"><stop offset="0" stop-color="${c.m[0]}"/><stop offset="0.35" stop-color="${c.m[2]}"/><stop offset="0.5" stop-color="${c.m[1]}"/><stop offset="0.65" stop-color="${c.m[2]}"/><stop offset="1" stop-color="${c.m[4]}"/></linearGradient>` +
    `<linearGradient id="${ids.artA}" gradientUnits="${A.u}" spreadMethod="${A.sp}" x1="${A.x1}" y1="${A.y1}" x2="${A.x2}" y2="${A.y2}">${stops4(A)}</linearGradient>` +
    `<linearGradient id="${ids.artB}" gradientUnits="${Bg.u}" spreadMethod="${Bg.sp}" x1="${Bg.x1}" y1="${Bg.y1}" x2="${Bg.x2}" y2="${Bg.y2}">${stops4(Bg)}</linearGradient>` +
    `<radialGradient id="${ids.light}" cx="0.16" cy="0.06" r="0.95"><stop offset="0" stop-color="#ffffff" stop-opacity="${c.light}"/><stop offset="0.7" stop-color="#ffffff" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${ids.vig}" cx="0.5" cy="0.42" r="0.8"><stop offset="0.5" stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity="${c.vig}"/></radialGradient>` +
    `<linearGradient id="${ids.sheen}" x1="0" y1="0" x2="1" y2="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.42" stop-color="#ffffff" stop-opacity="${c.sheen}"/><stop offset="0.52" stop-color="#ffffff" stop-opacity="${n(c.sheen * 0.35)}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="${ids.calm}"><stop offset="0" stop-color="#000000"/><stop offset="0.5" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></radialGradient>` +
    `<filter id="${ids.tex}" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="${tx2.f}" numOctaves="${tx2.o}" seed="${c.seed}" result="noise"/><feDiffuseLighting in="noise" surfaceScale="${tx2.ss}" diffuseConstant="1" lighting-color="#ffffff" result="lit"><feDistantLight azimuth="225" elevation="${tx2.el}"/></feDiffuseLighting><feColorMatrix in="lit" type="matrix" values="${tx2.m}"/></filter>` +
    `<filter id="${ids.rel}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="${rl.b}" result="a"/><feOffset in="a" dx="${rl.o}" dy="${rl.o}" result="dn"/><feOffset in="a" dx="${rl.no}" dy="${rl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feComposite in="dn" in2="a" operator="out" result="cs"/><feFlood flood-color="${rl.hc}" flood-opacity="${rl.ho}" result="hf"/><feComposite in="hf" in2="hl" operator="in" result="hc"/><feFlood flood-color="${rl.sc}" flood-opacity="${rl.so}" result="sf"/><feComposite in="sf" in2="sh" operator="in" result="sc"/><feFlood flood-color="#000000" flood-opacity="${rl.co}" result="cf"/><feComposite in="cf" in2="cs" operator="in" result="cc"/><feMerge><feMergeNode in="cc"/><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>` +
    `<filter id="${ids.deb}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur in="SourceAlpha" stdDeviation="${rl.b}" result="a"/><feOffset in="a" dx="${rl.o}" dy="${rl.o}" result="dn"/><feOffset in="a" dx="${rl.no}" dy="${rl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feFlood flood-color="${rl.sc}" flood-opacity="${rl.so}" result="sf"/><feComposite in="sf" in2="hl" operator="in" result="sc"/><feFlood flood-color="${rl.hc}" flood-opacity="${rl.ho}" result="hf"/><feComposite in="hf" in2="sh" operator="in" result="hc"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>` +
    `<filter id="${ids.foil}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur in="SourceAlpha" stdDeviation="${fl.b}" result="a"/><feOffset in="a" dx="${fl.o}" dy="${fl.o}" result="dn"/><feOffset in="a" dx="${fl.no}" dy="${fl.no}" result="up"/><feComposite in="a" in2="dn" operator="out" result="hl"/><feComposite in="a" in2="up" operator="out" result="sh"/><feComposite in="dn" in2="a" operator="out" result="cs"/><feFlood flood-color="#ffffff" flood-opacity="${fl.ho}" result="hf"/><feComposite in="hf" in2="hl" operator="in" result="hc"/><feFlood flood-color="${fl.sc}" flood-opacity="${fl.so}" result="sf"/><feComposite in="sf" in2="sh" operator="in" result="sc"/><feFlood flood-color="#000000" flood-opacity="${fl.co}" result="cf"/><feComposite in="cf" in2="cs" operator="in" result="cc"/><feMerge><feMergeNode in="cc"/><feMergeNode in="SourceGraphic"/><feMergeNode in="sc"/><feMergeNode in="hc"/></feMerge></filter>` +
    `<mask id="${ids.mask}" maskUnits="userSpaceOnUse" ${area}><rect ${area} fill="#ffffff"/>${maskBody}</mask>`;

  // The words and logo: foil (with its relief) on foiled Tier B, ink otherwise.
  let identity = '';
  if (!print) {
    const idMetal = B && fin.idFoil ? u.metalId : c.flat;
    const brandFilter = B && fin.idFoil ? u.foil : 'none';
    const els = faceElements(storeId, side);
    const brand = els.filter((e) => e.role === 'brand');
    const rest = els.filter((e) => e.role !== 'brand');
    const colour = (v) => (v === 'metal' ? idMetal : v);
    identity =
      rest.map((e) => elementSvg(e, colour(e.fill ?? idMetal), colour(e.stroke))).join('') +
      (back
        ? `<rect x="${n(QR_X)}" y="${n(QR_Y)}" width="18" height="18" fill="none" stroke="${c.qr}" stroke-width="0.08" stroke-dasharray="0.5 0.5" opacity="0.45"/>` +
          `<path d="${text('QR ZONE', { font: 'inter600', size: 1.3, tracking: 0.2 / 1.3, x: PLATE_CX, y: PLATE_CY + 0.4, anchor: 'middle' }).d}" fill="${c.qr}" opacity="0.7"/>` +
          `<path d="${text('18 mm · per card', { size: 1, x: PLATE_CX, y: PLATE_CY + 2.4, anchor: 'middle' }).d}" fill="${c.qr}" opacity="0.55"/>`
        : '') +
      `<g${brandFilter !== 'none' ? ` filter="${brandFilter}"` : ''}>` +
      brand.map((e) => elementSvg(e, idMetal, idMetal)).join('') +
      `</g>`;
  }

  const label = 'SHYGON AAROH ' + c.name + ' card, ' + (back ? 'back' : 'front') + ', ' + (B ? 'Premium Finish (Tier B)' : 'Standard (Tier A)');
  const desc = print
    ? 'Printed CMYK artwork for the AAROH ' + c.name + ' ' + (back ? 'back' : 'front') + ', ' + (B ? 'Tier B' : 'Tier A') + ', to the 3 mm bleed. No lighting; the logo, words, variable data and spot plates are vector layers in the print PDF.'
    : 'Concept render from the AAROH design system, landscape. PROPOSED — REQUIRES VALIDATION. Not a photograph. The QR is a placeholder; the serial and chapter are examples.';
  const edgeFinish = B && fin.edge;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${X0} ${Y0} ${n(VW)} ${n(VH)}" width="${n(VW * px)}" height="${n(VH * px)}" role="img" aria-label="${label}">` +
    `<title>${label}</title><desc>${desc}</desc>` +
    `<defs>${defs}</defs>` +
    `<g${print ? '' : ` clip-path="${u.clip}"`}>` +
    `<rect ${area} fill="${u.base}"/>` +
    `<rect ${area} fill="#808080" filter="${u.tex}" opacity="${tx2.k}" style="mix-blend-mode: soft-light"/>` +
    `<g mask="${u.mask}" opacity="${back ? c.backOp : 1}">${layers.map(layerSvg).join('')}</g>` +
    (print ? '' : `<rect width="${W}" height="${H}" fill="${u.light}"/><rect width="${W}" height="${H}" fill="${u.sheen}"/><rect width="${W}" height="${H}" fill="${u.vig}"/>`) +
    identity +
    `</g>` +
    (print
      ? ''
      : (edgeFinish ? `<path d="${roundRect(0.22, 0.22, W - 0.44, H - 0.44, 2.98)}" fill="none" stroke="${u.metal}" stroke-width="0.44"/>` : '') +
        `<path d="${roundRect(0.05, 0.05, W - 0.1, H - 0.1, 3.13)}" fill="none" stroke="${c.edge}" stroke-width="0.1"/>`) +
    `</svg>`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  let count = 0;
  for (const [storeId] of STORE_EDITIONS) {
    for (const finish of Object.keys(FINISHES)) {
      for (const side of ['front', 'back']) {
        fs.writeFileSync(path.join(OUT, `${storeId}-${finish}-${side}.svg`), cardSvg(storeId, { side, finish }));
        count++;
      }
    }
  }
  console.log(`wrote ${count} edition SVGs to design-assets/editions/`);
}
