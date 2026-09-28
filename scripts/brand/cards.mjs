// SHYGON Tap card art, after the design sheet "Shygon Tap Cards.pdf".
//
// Four designs, one per product, each drawn in three materials (PVC, metal,
// transparent acrylic) and two finishes (standard, premium), front and back:
//
//   business       Obsidian Feather   brushed black, gold peacock quill
//   restaurant     Copper Lotus       warm copper, lotus line art
//   event          Emerald Arch       brushed emerald, gold arch
//   google-review  Ivory Bloom        ivory, double rule, stars and bloom
//
// Premium adds the Privé ornament from the sheet: a gold guilloché pattern,
// a double gold rule with art-deco corners, and a gold PREMIUM pill.
//
// The sheet's payment-card details (EMV chip, card number, expiry, CVV,
// network logo, signature strip) are deliberately left out: a SHYGON Tap is
// an NFC card, not a bank card, and must not look like one.
import { createRequire } from 'node:module';
import { LOCKUP, MARK } from './logo.mjs';
import { text } from './type.mjs';

const require = createRequire(import.meta.url);
const qrcode = require('qrcode-generator');

export const W = 1000;
export const H = 630;
const R = 38;
/** Cards per numbered chapter (migration 017's card_editions.chapter_size). */
const EDITION_CHAPTER = 100;

const f1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------- shapes

function lockup(x, y, height, fill) {
  const s = height / LOCKUP.height;
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(5)})" fill="${fill}"><path fill-rule="evenodd" d="${LOCKUP.mark}"/><path d="${LOCKUP.word}"/></g>`;
}

function mark(x, y, height, fill) {
  const s = height / MARK.height;
  return `<g transform="translate(${f1(x)} ${f1(y)}) scale(${s.toFixed(5)})" fill="${fill}"><path fill-rule="evenodd" d="${MARK.d}"/></g>`;
}

/** The contactless symbol: three arcs opening to the right. */
function waves(cx, cy, stroke, size = 1) {
  return [11, 19, 27]
    .map((r) => {
      const rr = r * size;
      const a = Math.PI / 4;
      return `<path d="M${f1(cx + rr * Math.cos(-a))} ${f1(cy + rr * Math.sin(-a))}A${f1(rr)} ${f1(rr)} 0 0 1 ${f1(cx + rr * Math.cos(a))} ${f1(cy + rr * Math.sin(a))}"/>`;
    })
    .join('')
    .replace(/^/, `<g fill="none" stroke="${stroke}" stroke-width="${f1(3.2 * size)}" stroke-linecap="round">`)
    .concat('</g>');
}

function type(str, opts, fill) {
  const { d } = text(str, opts);
  return `<path fill="${fill}" d="${d}"/>`;
}

function star(cx, cy, r, fill) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.44;
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    pts.push(`${f1(cx + rad * Math.cos(a))} ${f1(cy + rad * Math.sin(a))}`);
  }
  return `<path fill="${fill}" d="M${pts.join('L')}Z"/>`;
}

/** A lens-shaped petal from (x, y) along `deg`, `len` long, `w` half-wide. */
function lens(x, y, deg, len, w) {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const tx = x + ux * len, ty = y + uy * len;
  const p = (px, py) => `${f1(px)} ${f1(py)}`;
  return `M${p(x, y)}C${p(x + ux * len * 0.3 + nx * w, y + uy * len * 0.3 + ny * w)} ${p(tx - ux * len * 0.3 + nx * w, ty - uy * len * 0.3 + ny * w)} ${p(tx, ty)}C${p(tx - ux * len * 0.3 - nx * w, ty - uy * len * 0.3 - ny * w)} ${p(x + ux * len * 0.3 - nx * w, y + uy * len * 0.3 - ny * w)} ${p(x, y)}Z`;
}

/** A kite-shaped petal, as in the copper lotus. */
function kite(x, y, deg, len, w) {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const m = 0.58;
  const p = (px, py) => `${f1(px)} ${f1(py)}`;
  return `M${p(x, y)}L${p(x + ux * len * m + nx * w, y + uy * len * m + ny * w)}L${p(x + ux * len, y + uy * len)}L${p(x + ux * len * m - nx * w, y + uy * len * m - ny * w)}Z`;
}

function lotus(x, y, stroke, scale = 1) {
  const petals = [
    [-90, 171, 28],
    [-129.7, 138, 22],
    [-50.3, 138, 22],
    [-163, 131, 15],
    [-17, 132, 15],
  ];
  return `<g fill="none" stroke="${stroke}" stroke-width="${f1(1.8 / scale)}" stroke-linejoin="round" transform="translate(${x} ${y}) scale(${scale})">${petals
    .map(([deg, len, w]) => `<path d="${kite(0, 0, deg, len, w)}"/>`)
    .join('')}</g>`;
}

function bloom(cx, cy, radius, stroke, width, petals = 12) {
  let d = '';
  for (let k = 0; k < petals; k++) d += lens(cx, cy, (360 / petals) * k - 90, radius, radius * 0.19);
  return `<path fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" d="${d}"/>`;
}

/** The peacock quill: an eye of three nested lenses, rays and a barbed stem. */
function feather(stroke, { dx = 0, dy = 0 } = {}) {
  const eye = (cy, hh, hw) => `M820 ${cy - hh}C${820 + hw * 1.32} ${cy - hh * 0.55} ${820 + hw * 1.32} ${cy + hh * 0.55} 820 ${cy + hh}C${820 - hw * 1.32} ${cy + hh * 0.55} ${820 - hw * 1.32} ${cy - hh * 0.55} 820 ${cy - hh}Z`;
  const rays = [
    [820, 58, 820, 108],
    [740, 94, 782, 136],
    [900, 94, 858, 136],
    [700, 196, 760, 209],
    [940, 196, 880, 209],
    [715, 317, 772, 286],
    [925, 317, 868, 286],
  ];
  const stem = (t) => {
    const u = 1 - t;
    const P = [[820, 328], [828, 420], [852, 520], [897, 640]];
    const bx = u * u * u * P[0][0] + 3 * u * u * t * P[1][0] + 3 * u * t * t * P[2][0] + t * t * t * P[3][0];
    const by = u * u * u * P[0][1] + 3 * u * u * t * P[1][1] + 3 * u * t * t * P[2][1] + t * t * t * P[3][1];
    return [bx, by];
  };
  let barbs = '';
  for (let k = 0; k < 7; k++) {
    const [bx, by] = stem(0.1 + k * 0.13);
    barbs += `M${f1(bx - 58 - 5 * k)} ${f1(by - 30 + 3 * k)}L${f1(bx)} ${f1(by)}L${f1(bx + 60 + 6 * k)} ${f1(by - 36 + 3 * k)}`;
  }
  return `<g fill="none" stroke="${stroke}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${dx} ${dy})">
<path stroke-width="2.4" d="${eye(218, 110, 50)}"/><path stroke-width="1.8" d="${eye(226, 72, 30)}"/><path stroke-width="1.6" d="${eye(236, 36, 14)}"/>
<path stroke-width="1.4" d="${rays.map(([a, b, c, e]) => `M${a} ${b}L${c} ${e}`).join('')}"/>
<path stroke-width="1.8" d="M820 328C828 420 852 520 897 640"/><path stroke-width="1.1" d="${barbs}"/></g>`;
}

/** The onion arch of the emerald design, centred on `cx`. */
function arch(cx, stroke, mirror = false) {
  const s = mirror ? -1 : 1;
  const x = (dx) => f1(cx + s * dx);
  const side = (apex, sx, shoulder, c1) =>
    `M${x(0)} ${apex}C${x(c1)} ${apex + 55} ${x(sx)} ${shoulder - 90} ${x(sx)} ${shoulder}L${x(sx)} 640M${x(0)} ${apex}C${x(-c1)} ${apex + 55} ${x(-sx)} ${shoulder - 90} ${x(-sx)} ${shoulder}L${x(-sx)} 640`;
  return `<g fill="none" stroke="${stroke}" stroke-linecap="round">
<circle cx="${x(0)}" cy="79" r="6" stroke-width="1.8"/><path stroke-width="1.8" d="M${x(0)} 85L${x(0)} 120"/>
<path stroke-width="2.4" d="${side(120, 150, 335, 20)}"/><path stroke-width="1.1" d="${side(150, 136, 345, 18)}"/><path stroke-width="1.1" d="${side(182, 122, 352, 16)}"/>
<path stroke-width="1.1" d="M${x(122)} 336L${x(150)} 328"/></g>`;
}

function zigzag(x0, x1, y, h, step, stroke) {
  let d = `M${x0} ${y}`;
  for (let x = x0, k = 0; x < x1; x += step / 2, k++) d += `L${f1(Math.min(x1, x + step / 2))} ${k % 2 === 0 ? y + h : y}`;
  return `<path fill="none" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round" d="${d}"/>`;
}

function qr(url, x, y, size, { panel, ink }) {
  const code = qrcode(0, 'M');
  code.addData(url);
  code.make();
  const n = code.getModuleCount();
  const quiet = 3;
  const m = size / (n + quiet * 2);
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!code.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && code.isDark(r, c + run)) run++;
      d += `M${f1(x + (c + quiet) * m)} ${f1(y + (r + quiet) * m)}h${f1(run * m + 0.35)}v${f1(m + 0.35)}h${f1(-(run * m + 0.35))}z`;
      c += run - 1;
    }
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="18" fill="${panel}"/><path fill="${ink}" d="${d}"/>`;
}

function pill(label, x, y, { premium, ink, line }) {
  const w = label === 'PREMIUM' ? 138 : 146;
  const t = text(label, { font: 'inter600', size: 13.5, tracking: 0.3, x: x + w / 2 + 2, y: y + 23, anchor: 'middle' });
  return premium
    ? `<rect x="${x}" y="${y}" width="${w}" height="34" rx="17" fill="url(#goldPill)"/><path fill="#2a2110" d="${t.d}"/>`
    : `<rect x="${x + 0.6}" y="${y + 0.6}" width="${w - 1.2}" height="32.8" rx="16.4" fill="none" stroke="${line}" stroke-width="1.2"/><path fill="${ink}" d="${t.d}"/>`;
}

/** Art-deco corner: stepped lines and two quarter arcs, for the top-left. */
function decoCorner(stroke) {
  return `<g fill="none" stroke="${stroke}" stroke-width="1.2"><path d="M22 110A88 88 0 0 1 110 22M22 80L62 80M50 22L50 62M80 22L80 44M22 50L44 50"/><path d="M34 110A76 76 0 0 1 110 34" stroke-width="0.8"/></g>`;
}

// ---------------------------------------------------------------- designs

/**
 * Surface and inks for each design in each material. `gold` is the paint id
 * used for gold print; `light` means the surface is pale (dark inks).
 */
const DESIGNS = {
  obsidian: {
    name: 'Obsidian Feather',
    surface: {
      pvc: { from: '#18181a', to: '#0a0a0b', texture: 'waves', textureOpacity: 0.55 },
      metal: { from: '#232326', to: '#0b0b0c', texture: 'brushed', textureOpacity: 0.7 },
      transparent: { tint: '12,12,14', alpha: 0.5 },
    },
    ink: { primary: '#c8c4bc', muted: '#8f8a82' },
  },
  copper: {
    name: 'Copper Lotus',
    surface: {
      pvc: { from: '#b9693f', to: '#8c3d22', texture: 'clouds', textureOpacity: 0.35 },
      metal: { from: '#c07448', to: '#7f361c', texture: 'brushed', textureOpacity: 0.55 },
      transparent: { tint: '150,74,40', alpha: 0.38 },
    },
    ink: { primary: '#f8e6d8', muted: '#ecc4aa' },
    lotus: '#5a2310',
  },
  emerald: {
    name: 'Emerald Arch',
    surface: {
      pvc: { from: '#12543d', to: '#0a3326', texture: 'brushed', textureOpacity: 0.35 },
      metal: { from: '#16604a', to: '#082b20', texture: 'brushed', textureOpacity: 0.65 },
      transparent: { tint: '14,84,60', alpha: 0.36 },
    },
    ink: { primary: '#d2e4d9', muted: '#9fbfae' },
  },
  ivory: {
    name: 'Ivory Bloom',
    light: true,
    surface: {
      pvc: { from: '#f6f1e8', to: '#ece4d6', texture: 'hatch', textureOpacity: 1 },
      metal: { from: '#e3d7bf', to: '#bfae8c', texture: 'brushed', textureOpacity: 0.5 },
      transparent: { tint: '244,239,230', alpha: 0.14 },
    },
    ink: { primary: '#231f1a', muted: '#6d6458', bronze: '#9a7437' },
  },
};

export const PRODUCT_DESIGN = {
  business: 'obsidian',
  restaurant: 'copper',
  event: 'emerald',
  'google-review': 'ivory',
};

const CONTENT = {
  business: {
    name: 'ARJUN MEHTA',
    label: 'SHYGON TAP · BUSINESS',
    backTitle: 'One tap. Every detail.',
    backLine: 'Contact, work and socials. No app needed.',
  },
  restaurant: {
    name: 'SAFFRON & CO.',
    label: 'SHYGON TAP · RESTAURANT',
    backTitle: 'Menu, table and reviews.',
    backLine: 'Tap or scan for the menu and reservations.',
  },
  event: {
    name: 'AARAV & MEERA',
    label: 'SHYGON TAP · EVENT',
    backTitle: 'The whole celebration.',
    backLine: 'Tap for the invite, the venue and your RSVP.',
  },
  'google-review': {
    name: 'Café Aurora',
    label: 'TAP TO LEAVE A REVIEW',
    backTitle: 'Review us in seconds.',
    backLine: 'Opens our review page. No app needed.',
  },
};

// ---------------------------------------------------------------- render

function defs(design, material, id) {
  const s = DESIGNS[design].surface[material];
  const light = DESIGNS[design].light && material !== 'transparent';
  const noise = (fid, freq, octaves, type, matrix, seed = 4) =>
    `<filter id="${fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="${type}" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}"/><feColorMatrix type="matrix" values="${matrix}"/></filter>`;
  const white = (a, b) => `0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${a} 0 0 0 ${b}`;
  const black = (a, b) => `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${a} 0 0 0 ${b}`;
  return `<defs>
<clipPath id="${id}c"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>
<linearGradient id="${id}base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${s.from ?? '#000'}"/><stop offset="1" stop-color="${s.to ?? '#000'}"/></linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d9a0"/><stop offset=".45" stop-color="#d4ab66"/><stop offset=".78" stop-color="#a98140"/><stop offset="1" stop-color="#e6c586"/></linearGradient>
<linearGradient id="goldFlat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2bf7c"/><stop offset="1" stop-color="#c69c57"/></linearGradient>
<linearGradient id="goldPill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e2ae"/><stop offset=".55" stop-color="#d8b06a"/><stop offset="1" stop-color="#b8904c"/></linearGradient>
<linearGradient id="lotusInk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5a2310"/><stop offset=".55" stop-color="#e3a47a"/><stop offset="1" stop-color="#5a2310"/></linearGradient>
<linearGradient id="${id}sheen" x1="0" y1="0" x2="1" y2="0.62"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity="${light ? 0.35 : 0.13}"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".45" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
<radialGradient id="${id}glow" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#fff" stop-opacity="${light ? 0.25 : 0.08}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
${noise(`${id}brushL`, '0.0022 0.5', 3, 'fractalNoise', white(1.7, -0.78))}
${noise(`${id}brushD`, '0.0022 0.5', 3, 'fractalNoise', black(-1.7, 0.72), 9)}
${noise(`${id}waves`, '0.003 0.055', 4, 'turbulence', white(2.2, -0.9), 3)}
${noise(`${id}clouds`, '0.0032', 4, 'fractalNoise', black(-1.6, 0.9), 5)}
${noise(`${id}grain`, '0.85', 2, 'fractalNoise', white(1.2, -0.5), 2)}
<pattern id="${id}hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><path d="M0 0L0 9" stroke="#d9cfbd" stroke-width="0.8" opacity=".55"/></pattern>
<pattern id="${id}guilloche" width="48" height="48" patternUnits="userSpaceOnUse"><g fill="none" stroke-width=".9"><circle cx="24" cy="24" r="24"/><circle cx="0" cy="0" r="24"/><circle cx="48" cy="0" r="24"/><circle cx="0" cy="48" r="24"/><circle cx="48" cy="48" r="24"/><circle cx="24" cy="24" r="9"/></g></pattern>
</defs>`;
}

function surface(design, material, id) {
  const s = DESIGNS[design].surface[material];
  const light = DESIGNS[design].light;
  if (material === 'transparent') {
    // Clear acrylic: a tinted, frosted sheet you can see the stage through,
    // with the NFC antenna coil visible inside it.
    const coil = [0, 9, 18]
      .map((k) => `<rect x="${590 + k}" y="${150 + k}" width="${330 - 2 * k}" height="${330 - 2 * k}" rx="${26 - k}"/>`)
      .join('');
    return `<rect width="${W}" height="${H}" fill="rgba(${s.tint},${s.alpha})"/>
<rect width="${W}" height="${H}" fill="url(#${id}glass)"/>
<rect width="${W}" height="${H}" filter="url(#${id}grain)" opacity=".18"/>
<g fill="none" stroke="#fff" stroke-opacity=".13" stroke-width=".9">${coil}</g>
<rect x="752" y="312" width="12" height="8" rx="1.5" fill="#fff" fill-opacity=".22"/>
<path d="M-40 520L520 -40L610 -40L50 520Z" fill="#fff" opacity=".05"/>`;
  }
  let layers = `<rect width="${W}" height="${H}" fill="url(#${id}base)"/>`;
  if (s.texture === 'brushed') {
    layers += `<rect width="${W}" height="${H}" filter="url(#${id}brushL)" opacity="${s.textureOpacity * (light ? 0.9 : 0.5)}"/>`;
    layers += `<rect width="${W}" height="${H}" filter="url(#${id}brushD)" opacity="${s.textureOpacity * 0.45}"/>`;
  } else if (s.texture === 'waves') {
    layers += `<rect width="${W}" height="${H}" filter="url(#${id}waves)" opacity="${s.textureOpacity * 0.16}"/>`;
  } else if (s.texture === 'clouds') {
    layers += `<rect width="${W}" height="${H}" filter="url(#${id}clouds)" opacity="${s.textureOpacity}"/>`;
    layers += `<rect width="${W}" height="${H}" fill="url(#${id}glow)"/>`;
  } else if (s.texture === 'hatch') {
    layers += `<rect width="${W}" height="${H}" fill="url(#${id}hatch)"/>`;
  }
  if (material === 'metal') layers += `<rect width="${W}" height="${H}" fill="url(#${id}sheen)"/>`;
  if (material === 'pvc') layers += `<rect width="${W}" height="${H}" filter="url(#${id}grain)" opacity=".05"/>`;
  return layers;
}

function inks(design, material) {
  const d = DESIGNS[design];
  const glass = material === 'transparent';
  if (d.light && !glass) {
    return {
      primary: d.ink.primary,
      muted: d.ink.muted,
      accent: material === 'metal' ? '#6f5220' : d.ink.bronze,
      gold: material === 'metal' ? '#7a5a22' : d.ink.bronze,
      line: '#c29d5f',
      qr: { panel: '#fffdf8', ink: '#1d1a15' },
    };
  }
  return {
    primary: glass ? '#f6f2ea' : d.ink.primary,
    muted: glass ? '#ddd6ca' : d.ink.muted,
    accent: material === 'metal' ? 'url(#gold)' : 'url(#goldFlat)',
    gold: material === 'metal' ? 'url(#gold)' : 'url(#goldFlat)',
    line: '#d4ab66',
    qr: { panel: glass ? 'rgba(255,255,255,.94)' : '#f7f2e8', ink: '#15130f' },
  };
}

/** The Privé ornament: guilloché field, double gold rule, deco corners. */
function premiumOrnament(design, material, id) {
  const light = DESIGNS[design].light && material !== 'transparent';
  const stroke = light ? '#b08a4e' : '#d4ab66';
  const opacity = light ? 0.22 : material === 'transparent' ? 0.16 : 0.13;
  return [
    `<rect width="${W}" height="${H}" fill="url(#${id}guilloche)" opacity="${opacity}"/>`,
    `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="28" fill="none" stroke="${stroke}" stroke-opacity=".85" stroke-width="1.1"/>`,
    `<rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="23" fill="none" stroke="${stroke}" stroke-opacity=".5" stroke-width=".6"/>`,
    decoCorner(stroke),
    `<g transform="rotate(180 ${W / 2} ${H / 2})">${decoCorner(stroke)}</g>`,
  ].join('');
}

function front(product, design, material, finish, ink) {
  const c = CONTENT[product];
  const premium = finish === 'premium';
  const badge = (x, y) => pill(premium ? 'PREMIUM' : 'STANDARD', x, y, { premium, ink: ink.primary, line: ink.line });
  const nameBlock = (x, yName) =>
    type(c.name, { font: 'inter500', size: 34, tracking: 0.09, x, y: yName }, ink.primary) +
    type(c.label, { font: 'inter600', size: 13, tracking: 0.28, x, y: yName + 34 }, ink.accent);

  if (design === 'obsidian') {
    return [
      lockup(60, 46, 96, ink.gold),
      type('LIMITED EDITION', { font: 'inter600', size: 11.5, tracking: 0.32, x: 60, y: 172, anchor: 'start' }, ink.accent),
      waves(78, 300, ink.line),
      feather(ink.gold === 'url(#gold)' ? 'url(#gold)' : ink.line),
      nameBlock(60, 530),
    ].join('');
  }
  if (design === 'copper') {
    return [
      lockup(60, 46, 96, material === 'transparent' ? 'url(#goldFlat)' : '#f1c98c'),
      type('LIMITED EDITION', { font: 'inter600', size: 11.5, tracking: 0.32, x: 60, y: 172, anchor: 'start' }, ink.accent),
      lotus(815, 543, material === 'transparent' ? '#e9b48d' : 'url(#lotusInk)'),
      badge(W - 60 - 138, 52),
      nameBlock(60, 530),
    ].join('');
  }
  if (design === 'emerald') {
    return [
      arch(70, ink.line),
      waves(400, 300, ink.line),
      lockup(W - 60 - 70, 42, 100, ink.gold),
      type('LIMITED EDITION', { font: 'inter600', size: 11.5, tracking: 0.32, x: W - 60, y: 172, anchor: 'end' }, ink.accent),
      type(c.name, { font: 'inter500', size: 34, tracking: 0.09, x: 292, y: 520 }, ink.primary),
      type(c.label, { font: 'inter600', size: 13, tracking: 0.28, x: 292, y: 554 }, ink.accent),
      badge(W - 60 - 146, H - 60 - 34),
    ].join('');
  }
  // ivory
  const stars = [0, 1, 2, 3, 4].map((k) => star(98 + k * 36, 268, 14, ink.gold)).join('');
  return [
    `<rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="28" fill="none" stroke="${ink.line}" stroke-width="1.2"/>`,
    `<rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="23" fill="none" stroke="${ink.line}" stroke-width=".6"/>`,
    lockup(84, 58, 84, ink.gold),
    type('LIMITED EDITION', { font: 'inter600', size: 11.5, tracking: 0.32, x: 86, y: 174, anchor: 'start' }, ink.accent),
    type('TAP', { font: 'inter500', size: 17, tracking: 0.6, x: 160, y: 96 }, ink.accent),
    stars,
    type('Loved your visit?', { font: 'serif400', size: 46, x: 84, y: 346 }, ink.primary),
    type(c.label, { font: 'inter600', size: 13, tracking: 0.3, x: 86, y: 384 }, ink.accent),
    type('YOUR BUSINESS', { font: 'inter500', size: 12, tracking: 0.3, x: 86, y: 488 }, ink.accent),
    type(c.name, { font: 'serif400', size: 36, x: 84, y: 530 }, ink.primary),
    zigzag(84, 760, 548, 16, 34, ink.line),
    waves(912, 300, ink.primary === '#231f1a' ? '#3a332a' : ink.primary, 0.9),
    badge(W - 84 - (premium ? 138 : 146), 530),
  ].join('');
}

function back(product, design, material, finish, ink, site, company) {
  const c = CONTENT[product];
  const premium = finish === 'premium';
  const url = `${site}/shygontap`;
  const domain = site.replace(/^https?:\/\//, '');
  const block = (x, y) =>
    type('TAP OR SCAN', { font: 'inter600', size: 13, tracking: 0.3, x, y }, ink.accent) +
    type(c.backTitle, { font: design === 'ivory' ? 'serif400' : 'inter500', size: design === 'ivory' ? 34 : 30, x, y: y + 44 }, ink.primary) +
    type(c.backLine, { font: 'inter400', size: 17, x, y: y + 78 }, ink.muted);
  const footer = (x) =>
    type(`LIMITED EDITION · CHAPTER ___ · Nº ____ / ${EDITION_CHAPTER}`, { font: 'inter600', size: 12, tracking: 0.26, x, y: 508 }, ink.accent) +
    type(domain, { font: 'inter400', size: 16, x, y: 548 }, ink.muted) +
    type(company, { font: 'inter400', size: 14, tracking: 0.04, x, y: 574 }, ink.muted);
  const badge = (x, y) => pill(premium ? 'PREMIUM' : 'STANDARD', x, y, { premium, ink: ink.primary, line: ink.line });

  if (design === 'obsidian') {
    return [
      feather(ink.gold === 'url(#gold)' ? 'url(#gold)' : ink.line, { dx: -790, dy: 100 }),
      waves(244, 206, ink.line, 0.8),
      block(230, 250),
      `<path d="M230 372L700 372" stroke="${ink.line}" stroke-width="1" stroke-opacity=".7"/>`,
      qr(url, 760, 196, 176, ink.qr),
      badge(W - 60 - (premium ? 138 : 146), 52),
      footer(230),
      mark(W - 60 - 32, 520, 60, ink.gold),
    ].join('');
  }
  if (design === 'copper') {
    return [
      waves(78, 90, material === 'transparent' ? '#f6f2ea' : '#f5dccb'),
      block(60, 250),
      `<path d="M60 372L640 372" stroke="#f0c9ae" stroke-width="1" stroke-opacity=".6"/>`,
      qr(url, 760, 196, 176, ink.qr),
      badge(W - 60 - (premium ? 138 : 146), 52),
      footer(60),
      mark(W - 60 - 32, 520, 60, material === 'transparent' ? 'url(#goldFlat)' : '#f1c98c'),
    ].join('');
  }
  if (design === 'emerald') {
    return [
      arch(930, ink.line, true),
      lockup(60, 42, 96, ink.gold),
      block(60, 250),
      `<path d="M60 372L520 372" stroke="${ink.line}" stroke-width="1" stroke-opacity=".7"/>`,
      qr(url, 566, 196, 176, ink.qr),
      badge(566 + 176 - (premium ? 138 : 146), 52),
      footer(60),
    ].join('');
  }
  return [
    `<rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="28" fill="none" stroke="${ink.line}" stroke-width="1.2"/>`,
    `<rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="23" fill="none" stroke="${ink.line}" stroke-width=".6"/>`,
    bloom(760, 315, 165, material === 'transparent' ? 'rgba(255,255,255,.35)' : DESIGNS.ivory.light && material === 'pvc' ? '#e4d8c3' : '#c9b48e', 3),
    lockup(84, 58, 84, ink.gold),
    badge(W - 84 - (premium ? 138 : 146), 60),
    qr(url, 84, 196, 176, ink.qr),
    type('TAP OR SCAN', { font: 'inter600', size: 13, tracking: 0.3, x: 296, y: 250 }, ink.accent),
    type(c.backTitle, { font: 'serif400', size: 32, x: 294, y: 292 }, ink.primary),
    type('Opens our review page.', { font: 'inter400', size: 17, x: 296, y: 326 }, ink.muted),
    type('No app needed.', { font: 'inter400', size: 17, x: 296, y: 350 }, ink.muted),
    footer(86),
  ].join('');
}

/**
 * One card face as a standalone SVG document.
 * product: business | restaurant | event | google-review
 * material: pvc | metal | transparent · finish: standard | premium · face: front | back
 */
export function renderCard({ product, material, finish = 'standard', face = 'front', site, company }) {
  const design = PRODUCT_DESIGN[product];
  const id = `${product.slice(0, 3)}${material.slice(0, 2)}${finish[0]}${face[0]}`;
  const ink = inks(design, material);
  const body = face === 'front' ? front(product, design, material, finish, ink) : back(product, design, material, finish, ink, site, company);
  const edge =
    material === 'transparent'
      ? `<rect x=".9" y=".9" width="${W - 1.8}" height="${H - 1.8}" rx="${R - 1}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.8"/><rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="${R - 4}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="1"/>`
      : material === 'metal'
        ? `<rect x=".8" y=".8" width="${W - 1.6}" height="${H - 1.6}" rx="${R - 1}" fill="none" stroke="#fff" stroke-opacity="${DESIGNS[design].light ? 0.55 : 0.28}" stroke-width="1.6"/>`
        : `<rect x=".6" y=".6" width="${W - 1.2}" height="${H - 1.2}" rx="${R - 1}" fill="none" stroke="#000" stroke-opacity=".12" stroke-width="1.2"/>`;
  const title = `SHYGON Tap ${product.replace('-', ' ')} card, ${DESIGNS[design].name} design, ${material}, ${finish}, ${face}`;
  const ornament = finish === 'premium' ? premiumOrnament(design, material, id) : '';
  const guillocheStroke = DESIGNS[design].light && material !== 'transparent' ? '#b08a4e' : '#d4ab66';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>${defs(design, material, id).replace(
    `<pattern id="${id}guilloche" width="48" height="48" patternUnits="userSpaceOnUse"><g fill="none" stroke-width=".9">`,
    `<pattern id="${id}guilloche" width="48" height="48" patternUnits="userSpaceOnUse"><g fill="none" stroke="${guillocheStroke}" stroke-width=".9">`,
  )}<g clip-path="url(#${id}c)">${surface(design, material, id)}${ornament}${body}</g>${edge}</svg>\n`;
}

export const DESIGN_NAMES = Object.fromEntries(Object.entries(PRODUCT_DESIGN).map(([p, d]) => [p, DESIGNS[d].name]));

// Shared with the concept designs (scripts/brand/concepts.mjs).
export { decoCorner, mark, pill, qr, type, waves };
