// The Design Collection: six more SHYGON Tap cards, sold in the store next to
// the four from the design sheet. Each is a rich material with real depth —
// texture, lighting, an embossed ribbon-S watermark, foil detail — drawn in
// every material (PVC, metal, transparent) and finish (standard, premium),
// front and back. Every card is a numbered limited edition (chapters of 100);
// the back carries the line the number is engraved on.
import { W, H } from './cards.mjs';
import { decoCorner, pill, qr, type, waves } from './cards.mjs';
import { MARK } from './logo.mjs';

const R = 38;
/** Cards per numbered chapter (migration 017's card_editions.chapter_size). */
const EDITION_CHAPTER = 100;

export const CONCEPTS = {
  silk: {
    product: 'obsidian-smoke',
    name: 'Obsidian Smoke',
    from: '#1b1b1f',
    to: '#060607',
    light: '#ffffff',
    ink: '#efe9df',
    muted: '#9d978d',
    foil: 'foilGold',
  },
  marble: {
    product: 'rose-marble',
    name: 'Rose Marble',
    from: '#fbf8f5',
    to: '#e9e1da',
    light: '#ffffff',
    pale: true,
    ink: '#2c2426',
    muted: '#76686b',
    foil: 'foilRose',
  },
  carbon: {
    product: 'carbon-aurum',
    name: 'Carbon Aurum',
    from: '#1f2024',
    to: '#09090b',
    light: '#ffffff',
    ink: '#e7e3dc',
    muted: '#8f8a83',
    foil: 'foilGold',
  },
  sandstone: {
    product: 'sandstone-jaali',
    name: 'Sandstone Jaali',
    from: '#e4c89d',
    to: '#b88a55',
    light: '#fff4e0',
    pale: true,
    ink: '#2d2013',
    muted: '#5d4830',
    foil: 'foilBronze',
  },
  sapphire: {
    product: 'sapphire-night',
    name: 'Sapphire Night',
    from: '#1a3673',
    to: '#050b1e',
    light: '#cfe0ff',
    ink: '#eaf0fb',
    muted: '#a6b5d6',
    foil: 'foilGold',
  },
  aurora: {
    product: 'aurora-glass',
    name: 'Aurora Glass',
    // Glass by nature; in PVC and metal it becomes an aurora on midnight.
    glass: true,
    from: '#161a2e',
    to: '#05060c',
    light: '#dfe8ff',
    ink: '#f7f4ee',
    muted: '#dcd5e8',
    foil: 'foilIris',
  },
};

function defs(id, c) {
  const noise = (fid, freq, octaves, kind, matrix, seed = 4) =>
    `<filter id="${id}${fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="${kind}" baseFrequency="${freq}" numOctaves="${octaves}" seed="${seed}"/><feColorMatrix type="matrix" values="${matrix}"/></filter>`;
  const white = (a, b) => `0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 ${a} 0 0 0 ${b}`;
  const black = (a, b) => `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${a} 0 0 0 ${b}`;
  const stops = (list) => list.map(([o, col]) => `<stop offset="${o}" stop-color="${col}"/>`).join('');
  return `<defs>
<clipPath id="${id}clip"><rect width="${W}" height="${H}" rx="${R}"/></clipPath>
<path id="${id}m" fill-rule="evenodd" clip-rule="evenodd" d="${MARK.d}"/>
<linearGradient id="${id}base" x1="0" y1="0" x2="1" y2="1">${stops([[0, c.from], [1, c.to]])}</linearGradient>
<radialGradient id="${id}lamp" cx=".22" cy=".12" r=".9"><stop offset="0" stop-color="${c.light}" stop-opacity="${c.pale ? 0.55 : 0.16}"/><stop offset=".55" stop-color="${c.light}" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}vignette" cx=".5" cy=".5" r=".75"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${c.pale ? 0.14 : 0.45}"/></radialGradient>
<linearGradient id="${id}sweep" x1="0" y1="0" x2="1" y2=".7"><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".46" stop-color="#fff" stop-opacity="${c.pale ? 0.32 : 0.11}"/><stop offset=".5" stop-color="#fff" stop-opacity="${c.pale ? 0.12 : 0.04}"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}bevel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
<linearGradient id="foilGold" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#fff1c9'], [0.22, '#e5c37e'], [0.45, '#b88c43'], [0.62, '#f3d99b'], [0.82, '#a47a36'], [1, '#e9c987']])}</linearGradient>
<linearGradient id="foilRose" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#f6d3d2'], [0.3, '#c98b8e'], [0.55, '#9e5c63'], [0.75, '#e2aeb0'], [1, '#b0707a']])}</linearGradient>
<linearGradient id="foilBronze" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#8a5d24'], [0.4, '#5a3a12'], [0.7, '#9a6b2c'], [1, '#4d3110']])}</linearGradient>
<linearGradient id="foilIris" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#9ff0e6'], [0.3, '#b3a4ff'], [0.6, '#ffc6e2'], [1, '#ffe2a4']])}</linearGradient>
<linearGradient id="goldPill" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#f6e2ae'], [0.55, '#d8b06a'], [1, '#b8904c']])}</linearGradient>
<linearGradient id="${id}iris" x1="0" y1="0" x2="1" y2="1">${stops([[0, '#6fe0d4'], [0.35, '#9a86f2'], [0.7, '#f0a9cf'], [1, '#f2d38f']])}</linearGradient>
<radialGradient id="${id}teal" cx=".2" cy=".15" r=".65"><stop offset="0" stop-color="#4fd1c2" stop-opacity=".55"/><stop offset="1" stop-color="#4fd1c2" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}violet" cx=".85" cy=".9" r=".7"><stop offset="0" stop-color="#8f6ff0" stop-opacity=".5"/><stop offset="1" stop-color="#8f6ff0" stop-opacity="0"/></radialGradient>
<radialGradient id="${id}rose" cx=".7" cy=".1" r=".45"><stop offset="0" stop-color="#f19cc4" stop-opacity=".35"/><stop offset="1" stop-color="#f19cc4" stop-opacity="0"/></radialGradient>
${noise('silk', '0.0032 0.0021', 3, 'fractalNoise', white(3.2, -1.55), 7)}
${noise('silkD', '0.0032 0.0021', 3, 'fractalNoise', black(-3.2, 1.62), 7)}
${noise('brushL', '0.0022 0.5', 3, 'fractalNoise', white(1.7, -0.78))}
${noise('brushD', '0.0022 0.5', 3, 'fractalNoise', black(-1.7, 0.72), 9)}
${noise('grainL', '0.9', 2, 'fractalNoise', white(1.3, -0.52), 2)}
${noise('grainD', '0.65', 3, 'fractalNoise', black(-1.5, 0.78), 6)}
${noise('speck', '0.35', 1, 'fractalNoise', black(-6, 3.9), 12)}
<filter id="${id}veins" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0.0038 0.0085" numOctaves="6" seed="21"/><feColorMatrix type="matrix" values="0 0 0 0 0.36 0 0 0 0 0.33 0 0 0 0 0.35 -3.4 0 0 0 1.12"/><feGaussianBlur stdDeviation=".35"/></filter>
<filter id="${id}veinsFine" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0.011 0.02" numOctaves="4" seed="5"/><feColorMatrix type="matrix" values="0 0 0 0 0.55 0 0 0 0 0.5 0 0 0 0 0.52 -4 0 0 0 1.18"/></filter>
<filter id="${id}soft"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="${id}lift" x="-5%" y="-20%" width="110%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1" flood-color="#000" flood-opacity="${c.pale ? 0.18 : 0.55}"/></filter>
<pattern id="${id}twill" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="12" fill="#2b2c31"/><rect x="6" width="6" height="12" fill="#151518"/><rect width="6" height="6" fill="#fff" opacity=".04"/><rect x="6" y="6" width="6" height="6" fill="#fff" opacity=".03"/></pattern>
${['L', 'D'].map((k) => `<pattern id="${id}jaali${k}" width="72" height="72" patternUnits="userSpaceOnUse"><g fill="none" stroke="${k === 'L' ? '#fff6e4' : '#6b4518'}" stroke-width="1.6" stroke-linejoin="round"><rect x="18" y="18" width="36" height="36"/><rect x="18" y="18" width="36" height="36" transform="rotate(45 36 36)"/><circle cx="36" cy="36" r="7"/><path d="M0 36H10M62 36H72M36 0V10M36 62V72"/></g></pattern>`).join('')}
<pattern id="${id}guilloche" width="48" height="48" patternUnits="userSpaceOnUse"><g fill="none" stroke="#d4ab66" stroke-width=".9"><circle cx="24" cy="24" r="24"/><circle cx="0" cy="0" r="24"/><circle cx="48" cy="0" r="24"/><circle cx="0" cy="48" r="24"/><circle cx="48" cy="48" r="24"/><circle cx="24" cy="24" r="9"/></g></pattern>
<linearGradient id="${id}fadeR" x1="0" y1="0" x2="1" y2="0"><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".7" stop-color="#fff" stop-opacity="1"/></linearGradient>
<mask id="${id}right"><rect width="${W}" height="${H}" fill="url(#${id}fadeR)"/></mask>
</defs>`;
}

const full = (attrs) => `<rect width="${W}" height="${H}" ${attrs}/>`;

/** The design's own texture, without base colour or lighting. */
function texture(key, id) {
  if (key === 'silk') {
    return (
      `<g filter="url(#${id}soft)">${full(`filter="url(#${id}silk)" opacity=".42"`)}</g>` +
      `<g filter="url(#${id}soft)">${full(`filter="url(#${id}silkD)" opacity=".75"`)}</g>`
    );
  }
  if (key === 'marble') return full(`filter="url(#${id}veins)" opacity=".42"`) + full(`filter="url(#${id}veinsFine)" opacity=".22"`);
  if (key === 'carbon') return full(`fill="url(#${id}twill)"`) + full(`filter="url(#${id}grainL)" opacity=".05"`);
  if (key === 'sandstone') {
    return (
      full(`filter="url(#${id}grainD)" opacity=".22"`) +
      full(`filter="url(#${id}grainL)" opacity=".16"`) +
      full(`filter="url(#${id}speck)" opacity=".18"`) +
      // Carved lattice: a lit edge and a shadowed edge, fading in from the right.
      `<g mask="url(#${id}right)"><rect width="${W}" height="${H}" fill="url(#${id}jaaliL)" opacity=".55" transform="translate(-1.2 -1.2)"/><rect width="${W}" height="${H}" fill="url(#${id}jaaliD)" opacity=".42" transform="translate(1 1)"/></g>`
    );
  }
  if (key === 'sapphire') return full(`filter="url(#${id}brushL)" opacity=".28"`) + full(`filter="url(#${id}brushD)" opacity=".32"`);
  // aurora
  return full(`fill="url(#${id}teal)"`) + full(`fill="url(#${id}violet)"`) + full(`fill="url(#${id}rose)"`);
}

/** The whole material: PVC prints the design, metal brushes it, transparent is clear acrylic. */
function surface(key, id, c, material) {
  if (material === 'transparent') {
    const coil = [0, 9, 18].map((k) => `<rect x="${600 + k}" y="${160 + k}" width="${320 - 2 * k}" height="${320 - 2 * k}" rx="${26 - k}"/>`).join('');
    return [
      c.glass ? full('fill="rgba(255,255,255,.06)"') : full(`fill="url(#${id}base)" opacity="${c.pale ? 0.32 : 0.5}"`),
      `<g opacity="${c.glass ? 1 : 0.55}">${texture(key, id)}</g>`,
      full(`filter="url(#${id}grainL)" opacity=".18"`),
      `<g fill="none" stroke="#fff" stroke-opacity=".12" stroke-width=".9">${coil}</g>`,
      `<path d="M-60 560L560 -60L660 -60L40 560Z" fill="#fff" opacity=".07"/>`,
    ].join('');
  }
  const layers = [full(`fill="url(#${id}base)"`), texture(key, id)];
  if (material === 'metal') {
    layers.push(full(`filter="url(#${id}brushL)" opacity="${c.pale ? 0.45 : 0.22}"`));
    layers.push(full(`filter="url(#${id}brushD)" opacity="${c.pale ? 0.2 : 0.3}"`));
    layers.push(full(`fill="url(#${id}sweep)"`));
  }
  layers.push(full(`fill="url(#${id}lamp)"`), full(`fill="url(#${id}sweep)"`), full(`fill="url(#${id}vignette)"`));
  return layers.join('');
}

const useMark = (id, x, y, height, fill, opacity = 1) =>
  `<use href="#${id}m" transform="translate(${x} ${y}) scale(${(height / MARK.height).toFixed(5)})" fill="${fill}"${opacity === 1 ? '' : ` opacity="${opacity}"`}/>`;

/**
 * A large ribbon S pressed into the material. The material itself continues
 * through the S (it is redrawn inside a clip of the mark), so only the lit
 * top edge and the shadowed lower edge show: an emboss, not a printed shape.
 */
function watermark(id, c, material, markup) {
  const h = 470;
  const x = 650;
  const y = 80;
  const clear = material === 'transparent';
  if (clear) return useMark(id, x, y, h, '#ffffff', 0.09) + useMark(id, x + 1.5, y + 1.5, h, '#000000', 0.1);
  return (
    `<defs><clipPath id="${id}wm"><use href="#${id}m" transform="translate(${x} ${y}) scale(${(h / MARK.height).toFixed(5)})"/></clipPath></defs>` +
    useMark(id, x - 1.8, y - 1.8, h, '#ffffff', c.pale ? 0.85 : 0.14) +
    useMark(id, x + 2, y + 2.2, h, '#000000', c.pale ? 0.16 : 0.6) +
    `<g clip-path="url(#${id}wm)">${markup}${full(`fill="${c.pale ? '#fff' : '#000'}" opacity="${c.pale ? 0.12 : 0.1}"`)}</g>`
  );
}

/** One small signature detail per design, kept light. */
function accent(key, id) {
  if (key === 'sapphire') {
    const stars = [[596, 132], [648, 180], [712, 150], [770, 214]];
    return `<path d="M596 132L648 180L712 150L770 214" fill="none" stroke="url(#foilGold)" stroke-width="1" stroke-opacity=".8"/>${stars
      .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 3 ? 3.4 : 2.2}" fill="url(#foilGold)"/>`)
      .join('')}`;
  }
  if (key === 'carbon') return `<path d="M0 470L1000 404" stroke="url(#foilGold)" stroke-width="2.2"/><path d="M0 482L1000 416" stroke="url(#foilGold)" stroke-width=".7" opacity=".7"/>`;
  if (key === 'marble') return `<path d="M640 640A340 340 0 0 1 1000 330" fill="none" stroke="url(#foilRose)" stroke-width="2"/>`;
  if (key === 'silk') return `<path d="M62 190L200 190" stroke="url(#foilGold)" stroke-width="1.2"/>`;
  if (key === 'aurora') return `<rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="27" fill="none" stroke="url(#${id}iris)" stroke-width="2.4"/>`;
  return '';
}

/** The Privé ornament for the premium finish: guilloché, double rule, deco corners. */
function premium(id, c) {
  const stroke = c.pale ? '#b08a4e' : '#d4ab66';
  return (
    full(`fill="url(#${id}guilloche)" opacity="${c.pale ? 0.2 : 0.12}"`) +
    `<rect x="20" y="20" width="${W - 40}" height="${H - 40}" rx="28" fill="none" stroke="${stroke}" stroke-opacity=".85" stroke-width="1.1"/>` +
    `<rect x="26" y="26" width="${W - 52}" height="${H - 52}" rx="23" fill="none" stroke="${stroke}" stroke-opacity=".5" stroke-width=".6"/>` +
    decoCorner(stroke) +
    `<g transform="rotate(180 ${W / 2} ${H / 2})">${decoCorner(stroke)}</g>`
  );
}

/**
 * One card face of a Design Collection card.
 * key: a CONCEPTS key · material: pvc | metal | transparent
 * finish: standard | premium · face: front | back
 */
export function renderConcept({ key, material = 'pvc', finish = 'standard', face = 'front', site, company }) {
  const base = CONCEPTS[key];
  const clear = material === 'transparent';
  // On clear acrylic the print sits over whatever is behind it: pale designs
  // take light inks there so they stay readable.
  const c = clear && base.pale ? { ...base, ink: '#f7f2ea', muted: '#e2dace', foil: base.foil === 'foilBronze' ? 'foilGold' : base.foil } : base;
  const id = `cc${key.slice(0, 3)}${material[0]}${finish[0]}${face[0]}`;
  const foil = `url(#${c.foil})`;
  const domain = site.replace(/^https?:\/\//, '');
  const markup = surface(key, id, c, material);
  const lifted = (inner) => `<g filter="url(#${id}lift)">${inner}</g>`;
  const isPremium = finish === 'premium';
  const badge = (x, y) => pill(isPremium ? 'PREMIUM' : 'STANDARD', x, y, { premium: isPremium, ink: c.ink, line: c.pale && !clear ? '#b08a4e' : '#d4ab66' });

  const body =
    face === 'front'
      ? watermark(id, c, material, markup) +
        (isPremium ? premium(id, c) : '') +
        accent(key, id) +
        lifted(useMark(id, 62, 52, 72, foil)) +
        type('LIMITED EDITION', { font: 'inter600', size: 11.5, tracking: 0.32, x: 62, y: 172 }, foil) +
        (isPremium ? badge(W - 60 - 138, 40) : '') +
        lifted(type('ARJUN MEHTA', { font: 'inter500', size: 32, tracking: 0.1, x: 62, y: 530 }, c.ink)) +
        type('Founder · Mehta Studio', { font: 'inter400', size: 16, tracking: 0.03, x: 62, y: 562 }, c.muted) +
        waves(922, 548, foil, 0.85)
      : watermark(id, c, material, markup) +
        (isPremium ? premium(id, c) : '') +
        lifted(useMark(id, 62, 52, 64, foil)) +
        badge(W - 60 - (isPremium ? 138 : 146), 52) +
        type('TAP OR SCAN', { font: 'inter600', size: 12.5, tracking: 0.3, x: 62, y: 262 }, foil) +
        lifted(type('One tap. Every detail.', { font: 'serif400', size: 34, x: 60, y: 306 }, c.ink)) +
        type('Contact, work and socials. No app needed.', { font: 'inter400', size: 16.5, x: 62, y: 340 }, c.muted) +
        qr(`${site}/shygontap`, 764, 206, 170, { panel: 'rgba(255,255,255,.95)', ink: '#15130f' }) +
        type(`LIMITED EDITION · CHAPTER ___ · Nº ____ / ${EDITION_CHAPTER}`, { font: 'inter600', size: 11.5, tracking: 0.26, x: 62, y: 508 }, foil) +
        type(domain, { font: 'inter400', size: 15, x: 62, y: 548 }, c.muted) +
        type(company, { font: 'inter400', size: 13, tracking: 0.04, x: 62, y: 572 }, c.muted);

  const edge = clear
    ? `<rect x=".9" y=".9" width="${W - 1.8}" height="${H - 1.8}" rx="${R - 1}" fill="none" stroke="#fff" stroke-opacity=".62" stroke-width="1.8"/>`
    : `<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="${R - 1}" fill="none" stroke="url(#${id}bevel)" stroke-width="${material === 'metal' ? 2.4 : 2}"/>`;
  const title = `SHYGON Tap ${c.name} card, limited edition, ${material}, ${finish}, ${face}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}"><title>${title}</title>${defs(id, c)}<g clip-path="url(#${id}clip)">${markup}${body}</g>${edge}</svg>\n`;
}
