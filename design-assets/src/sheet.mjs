// The AAROH presentation sheet: one self-contained HTML page (every image is
// an inline data URI) with the hero composition, both faces of each edition,
// macro crops, edges, the material comparison and the layouts.
//
//   node design-assets/src/sheet.mjs     (after build.mjs)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITIONS, TEXTURE_CONCEPTS, front, back, swatch, frontLayout, backLayout, emblemSheet, crossSection } from './build.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..');
const coverage = fs.existsSync(path.join(OUT, 'coverage.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'coverage.json'), 'utf8'))
  : {};

const uri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const img = (svg, alt, cls = '') => `<img class="${cls}" src="${uri(svg)}" alt="${alt}">`;

const BORDER_NFC = 'The foil border must not form a closed metal loop around the antenna: break it (a gap of at least 1 mm) or print it in non-conductive metallic ink';
const MATERIALS = {
  'signature-noir': {
    substrate: 'Black-core PVC or PETG composite; printed black overlay (PROPOSED)',
    finish: 'Soft-touch matte overlay with a fine grain',
    relief: 'Tonal emboss or tactile varnish of the ogee lattice, 0.03–0.08 mm',
    accent: 'Champagne-gold hot foil: emblem, AAROH, byline, temple skyline and a 0.55 mm border',
    edge: 'Black core; optional gold edge paint (durability test required)',
    nfc: `Medium. ${BORDER_NFC}`,
    cost: 'Medium',
  },
  'ivory-atelier': {
    substrate: 'White-core PVC or PETG composite, warm ivory print (PROPOSED)',
    finish: 'Satin overlay with a fine tooth',
    relief: 'Blind emboss of the botanical garland, 0.05–0.10 mm; AAROH debossed',
    accent: 'Champagne-gold hot foil: emblem, byline, rule and a 0.70 mm border',
    edge: 'Ivory core; optional gold edge paint',
    nfc: `Medium. ${BORDER_NFC}`,
    cost: 'Medium to high (emboss tooling)',
  },
  'midnight-titanium': {
    substrate: 'PVC or PETG composite with a brushed-effect print layer (PROPOSED)',
    finish: 'Satin overlay; brushed texture printed or embossed',
    relief: 'Laser-etched or tactile varnish flow lines, 0.02–0.05 mm',
    accent: 'Platinum-silver foil: emblem, AAROH, byline, every third flow line and a 0.55 mm border',
    edge: 'Dark blue or graphite core; optional silver edge paint',
    nfc: `HIGHER. Any conductive metallised layer can detune the antenna; use non-conductive metallic ink for the brushed effect. ${BORDER_NFC}`,
    cost: 'Medium to high',
  },
};

/** Macro crops per edition, in card millimetres [x, y, width, height], all 3:2. */
const EMBLEM_CROP = ['The lotus emblem', [14.5, 9.4, 25, 16.67]];
const GARLAND_CROP = [1, 60, 18, 12];
const CROPS = {
  'signature-noir': [EMBLEM_CROP, ['Ogee lattice', [1.5, 1.5, 15, 10]], ['Temple skyline', [3, 46.4, 48, 32]]],
  'ivory-atelier': [EMBLEM_CROP, ['Garland', GARLAND_CROP], ['Garland base', [17.5, 72.2, 19, 12.67]]],
  'midnight-titanium': [EMBLEM_CROP, ['Silver flow', [27, 2, 26, 17.33]], ['Brushed metal', [1, 44, 18, 12]]],
};

function hero() {
  const cards = EDITIONS.map((e, i) => `<div class="hero-card hero-card-${i + 1}">${img(front(e, { uid: `hero${i}-` }), `AAROH ${e.name}, front, concept`)}</div>`).join('');
  const backs = EDITIONS.map((e, i) => `<div class="hero-back">${img(back(e, { uid: `heroB${i}-` }), `AAROH ${e.name}, back, concept`)}</div>`).join('');
  return `<section id="hero" class="stage">
  <div class="hero-copy">
    <p class="kicker">SHYGON · VERSION 01</p>
    <h1>AAROH</h1>
    <p class="lede">One card, three editions: Signature Noir, Ivory Atelier and Midnight Titanium. A lotus emblem, Indian architecture and botany in relief, foil you can feel.</p>
    <p class="note">Concept renders drawn from the specification (vector, with lighting filters), not photographs. The AAROH lotus emblem is a proposal awaiting approval. PROPOSED — REQUIRES VALIDATION.</p>
  </div>
  <div class="hero-fan">${cards}</div>
  <div class="hero-backs">${backs}</div>
</section>`;
}

function editions() {
  return `<section id="editions"><h2>The editions</h2>${EDITIONS.map((e) => {
    const chips = e.colours.map(([n, hex]) => `<li><i style="background:${hex}"></i><span>${n}</span><code>${hex}</code></li>`).join('');
    const sel = TEXTURE_CONCEPTS[e.id].find((c) => c.selected);
    const cov = coverage[e.id]?.percent;
    return `<article class="edition">
  <figure>${img(front(e, { uid: `ed-${e.id}-f-` }), `${e.name} front, concept`)}<figcaption>Front</figcaption></figure>
  <figure>${img(back(e, { uid: `ed-${e.id}-b-` }), `${e.name} back, concept`)}<figcaption>Back: the QR is a labelled placeholder; the serial is a format example</figcaption></figure>
  <div class="facts"><header><p class="kicker">Edition ${e.number}</p><h3>${e.name}</h3><p>${e.finish}.</p></header>
  <ul class="chips">${chips}</ul>
  <dl><div><dt>Texture</dt><dd>${e.texture}: ${sel.name}</dd></div>
  <div><dt>Metallic coverage (measured)</dt><dd>${cov !== undefined ? `${cov}% of the front, border included` : 'run render.mjs'}</dd></div></dl></div>
</article>`;
  }).join('')}</section>`;
}

function macro() {
  const crops = EDITIONS.map((e) => {
    const raking = e.id === 'ivory-atelier'
      ? `<figure>${img(front(e, { uid: `mr-${e.id}-`, view: GARLAND_CROP, px: 40, raking: true }), `${e.name} garland under raking light`)}<figcaption>Garland under raking light</figcaption></figure>`
      : '';
    return `<div class="macro-row"><h3>${e.name}</h3>${CROPS[e.id]
      .map(([label, view], k) => `<figure>${img(front(e, { uid: `m${k}-${e.id}-`, view, px: 40 }), `${e.name}: ${label}`)}<figcaption>${label}</figcaption></figure>`)
      .join('')}${raking}</div>`;
  }).join('');
  const concepts = EDITIONS.map((e) => `<div class="concepts"><h3>${e.name}: three texture concepts</h3>${TEXTURE_CONCEPTS[e.id]
    .map((c) => `<figure class="${c.selected ? 'selected' : ''}">${img(swatch(e, c, { uid: `sw-${e.id}-${c.key}-` }), `${e.name} texture ${c.key}`)}<figcaption>${c.key}. ${c.name}${c.selected ? ' (selected)' : ''}</figcaption></figure>`)
    .join('')}</div>`).join('');
  return `<section id="macro"><h2>Close-ups</h2><p class="note">Vector crops of the concept faces. Real relief depth depends on the process the supplier validates.</p>${crops}${concepts}</section>`;
}

function edges() {
  const corners = EDITIONS.map((e) => `<figure>${img(front(e, { uid: `c-${e.id}-`, view: [0, 0, 12, 9], px: 40 }), `${e.name} corner`)}<figcaption>${e.name}: corner r 3.18 mm and the metal border</figcaption></figure>`).join('');
  const slabs = [
    ['Signature Noir', '#101010', '#C6A567', 'black core, optional gold edge paint'],
    ['Ivory Atelier', '#F0E8D9', '#B59A64', 'ivory core, optional gold edge paint'],
    ['Midnight Titanium', '#101D32', '#C7CDD4', 'blue-graphite core, optional silver edge paint'],
  ].map(([n, core, edge, txt]) => `<figure class="slab"><div class="slab-body" style="--core:${core};--edge:${edge}"><span></span></div><figcaption>${n}: ${txt}</figcaption></figure>`).join('');
  return `<section id="edges"><h2>Edges and corners</h2><div class="row">${corners}</div><div class="row">${slabs}</div>
  <figure class="wide">${img(crossSection(), 'Proposed 0.84 mm construction')}</figure></section>`;
}

function materials() {
  const rows = ['substrate', 'finish', 'relief', 'accent', 'edge', 'nfc', 'cost'];
  const label = { substrate: 'Substrate', finish: 'Surface finish', relief: 'Relief process', accent: 'Metallic accent', edge: 'Edge', nfc: 'NFC risk', cost: 'Relative cost' };
  return `<section id="materials"><h2>Material and finish comparison</h2><p class="note">All PROPOSED — REQUIRES VALIDATION with the selected supplier.</p>
<div class="table-scroll"><table><thead><tr><th></th>${EDITIONS.map((e) => `<th>${e.name}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr><th>${label[r]}</th>${EDITIONS.map((e) => `<td>${MATERIALS[e.id][r]}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div></section>`;
}

function layouts() {
  return `<section id="layouts"><h2>Manufacturing layouts</h2>
<div class="layout-pair"><figure>${img(frontLayout(), 'Front layout with measurements')}</figure>
<figure>${img(backLayout(), 'Back layout with measurements')}</figure></div>
<figure class="wide">${img(emblemSheet(), 'The AAROH lotus emblem (proposal), its clear space, and the SHYGON marks')}</figure></section>`;
}

const css = `
:root{--ink:#16140f;--paper:#f6f1e7;--muted:#6b665c;--line:#e2d9c8;--gold:#b08d4f;--stage:radial-gradient(120% 90% at 30% 20%,#2a2621 0%,#0d0c0a 60%,#060505 100%)}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 Inter,"Helvetica Neue",Arial,sans-serif}
h1,h2,h3{font-family:"Playfair Display",Georgia,serif;font-weight:400;margin:0}h2{font-size:30px;margin:0 0 8px}h3{font-size:21px}
section{padding:56px clamp(16px,5vw,72px);border-bottom:1px solid var(--line)}
.kicker{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:var(--gold);margin:0 0 6px}
.note{color:var(--muted);font-size:13px;margin:4px 0 20px}
.stage{background:var(--stage);color:#f3ede1;display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);gap:32px 48px;align-items:center}
.hero-copy{container-type:inline-size;position:relative;z-index:4}
.stage h1{font-size:clamp(44px,16cqi,112px);letter-spacing:.32em;line-height:1}.stage .lede{font-size:18px;max-width:34ch;color:#d9cfbd}.stage .note{color:#9a907f}
.hero-fan{position:relative;height:clamp(380px,46vw,620px);perspective:1800px}
.hero-card{position:absolute;left:50%;top:50%;width:34%}
.hero-card img,.hero-back img{width:100%;display:block;border-radius:5.9%/3.7%;box-shadow:0 40px 60px rgba(0,0,0,.55),0 8px 16px rgba(0,0,0,.4)}
.hero-card-1{transform:translate(-138%,-46%) rotateY(16deg) rotateZ(-7deg)}
.hero-card-2{transform:translate(-50%,-54%);z-index:2}
.hero-card-3{transform:translate(38%,-46%) rotateY(-16deg) rotateZ(7deg);z-index:3}
.hero-backs{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,minmax(0,200px));justify-content:center;gap:32px}
.edition{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr);gap:24px;padding:28px 0;border-top:1px solid var(--line);align-items:start}
.edition figure img,.macro-row img,.concepts img,.row img{width:100%;display:block;box-shadow:0 18px 30px rgba(40,30,10,.18)}
.edition figure img{border-radius:5.9%/3.7%}.macro-row img,.concepts img,.row img{border-radius:10px}
figure{margin:0}figcaption{font-size:12px;color:var(--muted);margin-top:8px}
.facts{display:grid;gap:18px}.facts header p{margin:6px 0 0}
.chips{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.chips li{display:grid;grid-template-columns:28px 1fr;grid-template-rows:auto auto;column-gap:10px;font-size:13px}
.chips i{grid-row:span 2;width:28px;height:28px;border-radius:50%;border:1px solid rgba(0,0,0,.12)}.chips code{color:var(--muted)}
dl{margin:0}dl div{display:grid;grid-template-columns:minmax(0,11rem) minmax(0,1fr);gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}dt{color:var(--muted)}dd{margin:0}
.macro-row,.concepts,.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:18px 0}
.macro-row:has(figure:nth-of-type(4)){grid-template-columns:repeat(4,minmax(0,1fr))}
.macro-row h3,.concepts h3{grid-column:1/-1}
.concepts .selected img{outline:2px solid var(--gold);outline-offset:4px}
.slab-body{height:120px;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.25),transparent 30%),var(--core);position:relative;overflow:hidden;box-shadow:0 18px 30px rgba(40,30,10,.18)}
.slab-body span{position:absolute;left:0;right:0;bottom:0;height:16px;background:linear-gradient(90deg,var(--edge),color-mix(in srgb,var(--edge),#fff 35%) 50%,var(--edge))}
.table-scroll{overflow-x:auto}
table{width:100%;min-width:640px;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}thead th{font-family:"Playfair Display",Georgia,serif;font-size:16px;font-weight:400}
tbody th{color:var(--muted);font-weight:500;width:12rem}
.layout-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
.layout-pair img,.wide img{width:100%;display:block;border:1px solid var(--line);border-radius:8px;background:#fff}.wide{margin:20px 0}
@media (max-width:1080px){.edition{grid-template-columns:repeat(2,minmax(0,1fr))}.facts{grid-column:1/-1}}
@media (max-width:860px){.stage{grid-template-columns:1fr}.macro-row,.macro-row:has(figure:nth-of-type(4)),.concepts,.row,.layout-pair{grid-template-columns:1fr}.hero-fan{height:clamp(300px,88vw,520px)}.hero-backs{gap:12px}}
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AAROH physical collection</title><style>${css}</style></head><body>
${hero()}${editions()}${macro()}${edges()}${materials()}${layouts()}
<section><p class="note">SHYGON Version 1 — AAROH. Concept design sheet generated by design-assets/src/sheet.mjs from DESIGN.md. Nothing here is production artwork or a manufacturing approval.</p></section>
</body></html>`;

fs.writeFileSync(path.join(OUT, 'aaroh-design-sheet.html'), html);
console.log(`wrote design-assets/aaroh-design-sheet.html (${(html.length / 1024 / 1024).toFixed(1)} MB)`);
