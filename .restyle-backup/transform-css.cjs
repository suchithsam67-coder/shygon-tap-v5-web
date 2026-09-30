// Rule-aware migration of a storefront stylesheet onto the --ds-* design tokens.
// Usage: node transform-css.cjs <css file> <log json> [--dry]
const fs = require('fs');
const [, , FILE, LOG, DRY] = process.argv;
const src = fs.readFileSync(FILE, 'utf8');

// ---- legacy variables, resolved so they can be classified by value ---------
const LEGACY = {
  '--ink': '#101722', '--muted': '#687386', '--line': '#dfe5ec', '--paper': '#f7f9fb',
  '--white': '#ffffff', '--blue': '#1f66d1', '--blue-dark': '#103b83', '--blue-soft': '#e9f2ff',
  '--green': '#168c5d', '--aura-blue': '#175cd3', '--aura-ink': '#101828', '--aura-line': '#e4e7ec',
  '--color-bg-primary': '#f8fafc', '--color-bg-secondary': '#ffffff', '--color-bg-tertiary': '#f1f5f9',
  '--color-text-primary': '#111827', '--color-text-secondary': '#6b7280', '--color-text-muted': '#9ca3af',
  '--color-accent-blue': '#2563eb', '--color-accent-cyan': '#06b6d4', '--color-glass': '#ffffff',
  '--color-glass-border': '#e5e7eb',
};

// ---- what is NOT interface -------------------------------------------------
// Miniature product renders and material swatches depict the product, and
// .tap-button is shared with the real TapExperience. They keep their colours.
const PRODUCT = /(^|[\s.>~+,(])\.?(phone-|profile-|avatar\b|cinema-|nfc-|tap-path|tap-button|plan-(essential|business|pro|custom|3d|preview|rail)|material-(dots|backdrop|pvc|metal|transparent)|\.pvc\b|\.metal\b|\.clear\b|demo-(stage|gallery|depth-card|info-grid|about|section-title)|manifesto-orb|card-shine)/;
const KEYFRAME = /^\s*(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*\s*$/;
// Element-only selectors (no class/id/attribute) are global: they would reach
// the public Tap. tokens.css themes those inside the storefront scope instead.
const ELEMENT_ONLY = (sel) => sel.split(',').every((p) => !/[.#\[]/.test(p.replace(/::?[a-z-]+(\([^)]*\))?/gi, '')));

const CONTROL = /(input|textarea|select\b|\.field|choice-button|search|round-button|nav-search)/i;
const SECTION = /(footer|site-header|nav-shell|header\b|section|hero|modal|drawer|overlay|dock|summary-bar|mobile-summary|popover|panel|glass|menu\b|app-|mobile-nav\b|tier-deck-card|lifetime-customization-card|lifetime-option\b|cart-drawer|product-card|order-summary|config-block|faq)/i;
const PILL = /(pill|badge|chip|tag\b|kicker|lifetime-badge|cart-badge)/i;
// A filled control. The keyword must END a class name ("cart-checkout",
// "tier-deck-select") — so "checkout-body", the checkout PAGE, and
// "desktop-selection-dock" do not count — unless the class is a button-* or
// btn-* variant ("button-secondary", "btn-blue").
const BTN_END = /(^|[\s.:>-])(button|btn|cta|checkout|choose|submit|select)(?=$|[\s.:>,\[)])/i;
const BTN_VARIANT = /\.(button|btn)(-[a-z]+)?(?=$|[\s.:>,\[)])/i;
const BTN = { test: (s) => BTN_END.test(s) || BTN_VARIANT.test(s) };
const PSEUDO_MARK = /::?(before|after)\b/;
const STATEFUL = /(:hover|\.active|\.selected|\.is-active|\[aria-(pressed|current|checked)|:checked)/i;

// ---- colour maths -------------------------------------------------------------
const NAMED = { white: [255, 255, 255, 1], black: [0, 0, 0, 1], transparent: [0, 0, 0, 0] };
function parseColor(str) {
  str = str.trim().toLowerCase();
  if (NAMED[str]) return NAMED[str];
  let m = str.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1);
  }
  m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
    return [parts[0], parts[1], parts[2], parts[3] === undefined ? 1 : m[1].includes('%') && parts[3] > 1 ? parts[3] / 255 : parts[3]];
  }
  return null;
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
function hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function classify(c) {
  if (!c || c[3] < 0.06) return 'transparent';
  const L = luminance(c), [h, s, l] = hsl(c);
  // Low-alpha white is a light wash; low-alpha dark is a shadow or scrim.
  if (c[3] < 0.5) return L > 0.5 ? 'wash-light' : 'wash-dark';
  if (s > 0.35 && l > 0.12 && l < 0.92) {
    if (h >= 340 || h < 20) return 'red';
    if (h >= 20 && h < 62) return 'amber';
    if (h >= 62 && h < 175) return 'green';
    return 'accent'; // blue, cyan, indigo, purple, pink
  }
  if (L >= 0.55) return s > 0.25 ? 'tint' : 'light';
  if (L < 0.06) return 'dark';
  return 'mid';
}
const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\bvar\(--[a-z0-9-]+\)|\b(white|black)\b/g;
function colorOf(token) {
  const v = token.match(/^var\((--[a-z0-9-]+)\)$/);
  if (v) return LEGACY[v[1]] ? parseColor(LEGACY[v[1]]) : undefined; // undefined = unknown var, leave
  return parseColor(token);
}

// ---- role mapping -------------------------------------------------------------
function bgRole(cls, sel, ruleText, color) {
  if (cls === 'transparent') return null;
  const stateful = STATEFUL.test(sel);
  // Pseudo-element fills are marks — dots, underlines, indicators — not
  // surfaces. As surfaces they would turn black on a black page.
  if (PSEUDO_MARK.test(sel) && cls !== 'wash-dark') {
    return cls === 'light' || cls === 'mid' || cls === 'tint' || cls === 'wash-light' ? 'mark-subtle' : 'mark';
  }
  if (cls === 'wash-dark') return 'scrim';
  // Tinted alert boxes (error / success / warning) keep a fill so they still read as boxes.
  if (cls === 'tint' && color) {
    const h = hsl(color)[0];
    if (h >= 340 || h < 175) return 'raised';
  }
  if (cls === 'light' || cls === 'wash-light' || cls === 'tint') return stateful || PILL.test(sel) ? 'raised' : 'surface';
  if (cls === 'mid') return 'raised';
  // Dark or saturated fill. Only a filled control or badge inverts to white;
  // everything else becomes a surface — which can never yield white-on-white.
  if (BTN.test(sel) || PILL.test(sel)) return 'action';
  return 'surface';
}
const BG_TOKEN = {
  surface: 'var(--ds-surface)', raised: 'var(--ds-surface-raised)', action: 'var(--ds-action-bg)',
  scrim: 'rgba(0, 0, 0, .72)', mark: 'var(--ds-text)', 'mark-subtle': 'var(--ds-text-tertiary)',
};

function textToken(cls, role, alpha) {
  if (cls === 'red') return 'var(--ds-color-state-error)';
  if (cls === 'green') return 'var(--ds-color-state-success)';
  if (cls === 'amber') return 'var(--ds-color-state-warning)';
  if (role === 'action') return 'var(--ds-action-fg)';
  if (role === 'raised') return cls === 'mid' || cls === 'wash-light' ? 'var(--ds-text-secondary)' : 'var(--ds-text)';
  if (cls === 'mid') return 'var(--ds-text-tertiary)';
  if (cls === 'wash-light') return alpha >= 0.7 ? 'var(--ds-text-secondary)' : 'var(--ds-text-tertiary)';
  return 'var(--ds-text)'; // dark, light, tint, accent
}
function borderToken(cls, sel) {
  if (cls === 'transparent') return null;
  if (cls === 'dark' || cls === 'accent') return 'var(--ds-border-selected)';
  if (cls === 'red') return 'var(--ds-color-state-error)';
  if (cls === 'green') return 'var(--ds-color-state-success)';
  if (cls === 'amber') return 'var(--ds-color-state-warning)';
  // A control's edge must meet 3:1 (WCAG 1.4.11); a decorative divider need not.
  return CONTROL.test(sel) || BTN.test(sel) ? 'var(--ds-border-control)' : 'var(--ds-border)';
}

// ---- typography / radius / motion -----------------------------------------------
const SIZE_TOKENS = [[12, 'xs'], [13, 'sm'], [14, 'md'], [15, 'lg'], [16, 'xl'], [20, '2xl'], [26, '3xl'], [40, '4xl']];
function sizeToken(px) {
  if (px < 12.5) return 'var(--ds-font-size-xs)';
  if (px <= 13.25) return 'var(--ds-font-size-sm)';
  if (px <= 14.25) return 'var(--ds-font-size-md)';
  if (px <= 15.25) return 'var(--ds-font-size-lg)';
  if (px <= 17.5) return 'var(--ds-font-size-xl)';
  if (px <= 23) return 'var(--ds-font-size-2xl)';
  if (px <= 33) return 'var(--ds-font-size-3xl)';
  return 'var(--ds-font-size-4xl)';
}
function radiusToken(v) {
  return v.replace(/(\d+(\.\d+)?)px/g, (_, n) => {
    n = Number(n);
    if (n === 0) return '0';
    if (n <= 5) return 'var(--ds-radius-xs)';
    if (n >= 99) return 'var(--ds-radius-full)';
    return 'var(--ds-radius-sm)';
  });
}
function motion(v) {
  return v.replace(/(\d*\.?\d+)(ms|s)\b/g, (m, n, unit) => {
    const s = unit === 'ms' ? Number(n) / 1000 : Number(n);
    if (s === 0) return m;
    return s <= 0.25 ? 'var(--ds-motion-duration-instant)' : 'var(--ds-motion-duration-fast)';
  });
}

// ---- the pass ----------------------------------------------------------------------
const log = { changed: [], review: [], skipped: { product: 0, keyframe: 0, element: [], root: 0 } };
let changes = 0;

const out = src.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selRaw, body) => {
  const sel = selRaw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!sel || sel.startsWith('@')) return whole;
  if (/^:root\b/.test(sel) || sel.startsWith('@theme')) { log.skipped.root++; return whole; }
  if (KEYFRAME.test(sel)) { if (COLOR_RE.test(body)) log.skipped.keyframe++; COLOR_RE.lastIndex = 0; return whole; }
  const parts = sel.split(',').map((p) => p.trim());
  const productParts = parts.filter((p) => PRODUCT.test(p));
  if (productParts.length === parts.length) { log.skipped.product++; return whole; }
  if (productParts.length) log.review.push({ sel, why: 'mixed product/interface selector list — themed as interface' });
  if (ELEMENT_ONLY(sel)) {
    if (/#[0-9a-f]{3,8}|rgba?\(|font-size|font-family/i.test(body)) log.skipped.element.push(sel);
    return whole;
  }

  // Background role first: the text colour depends on it.
  const bgMatch = body.match(/(^|;)\s*(background(-color)?)\s*:\s*([^;]+)/);
  let role = null;
  if (bgMatch) {
    const val = bgMatch[4];
    if (/gradient\(/.test(val)) {
      const cs = (val.match(COLOR_RE) || []).map(colorOf).filter(Boolean);
      const opaque = cs.filter((c) => c[3] >= 0.5);
      const decorative = /radial-gradient/.test(val) && cs.some((c) => c[3] < 0.2);
      // A gradient on a pseudo-element is an overlay or sheen, never a mark.
      if (decorative || opaque.length === 0 || PSEUDO_MARK.test(sel)) role = 'none';
      else {
        const avgL = opaque.reduce((a, c) => a + luminance(c), 0) / opaque.length;
        const anySat = opaque.some((c) => hsl(c)[1] > 0.35 && hsl(c)[2] > 0.12);
        role = avgL >= 0.55 ? 'surface' : SECTION.test(sel) && !/button|btn|cta/i.test(sel) ? 'raised' : anySat || avgL < 0.06 ? bgRole('dark', sel, body) : 'raised';
      }
    } else {
      const first = (val.match(COLOR_RE) || [])[0];
      const c = first ? colorOf(first) : undefined;
      if (c) role = bgRole(classify(c), sel, body, c);
    }
  }
  // Gradient-filled TEXT (background-clip: text) is text, not a surface.
  const gradientText = /background-clip\s*:\s*text/i.test(body);
  if (gradientText) role = 'gradtext';

  const newBody = body.replace(/(^|;)(\s*)([-a-z]+)(\s*:\s*)([^;]+)/g, (m, lead, ws, prop, colon, valRaw) => {
    if (prop.startsWith('--')) return m;
    const imp = /!important/.test(valRaw) ? ' !important' : '';
    let val = valRaw.replace(/\s*!important\s*/, '').trim();
    const before = val;

    if (role === 'gradtext' && /^(-webkit-)?background-clip$/.test(prop)) {
      val = 'border-box';
    } else if (role === 'gradtext' && (prop === '-webkit-text-fill-color' || (prop === 'color' && /transparent/.test(val)))) {
      val = prop === 'color' ? 'var(--ds-text)' : 'currentColor';
    } else if (role === 'gradtext' && /^background(-image)?$/.test(prop)) {
      val = 'none';
    } else if (prop === 'background' || prop === 'background-color' || prop === 'background-image') {
      if (/url\(/.test(val)) return m; // product photography
      if (role === 'none') val = prop === 'background-color' ? 'transparent' : 'none';
      else if (role && BG_TOKEN[role]) {
        if (/gradient\(/.test(val) || prop !== 'background-image') val = BG_TOKEN[role];
      }
    } else if (prop === 'color' || prop === 'fill' || prop === 'stroke' || prop === 'caret-color' || prop === '-webkit-text-fill-color') {
      if (val === 'transparent' || /currentcolor|inherit/i.test(val)) return m;
      val = val.replace(COLOR_RE, (tok) => { const c = colorOf(tok); return c ? textToken(classify(c), role, c[3]) : tok; });
    } else if (/^border(-(top|right|bottom|left))?(-color)?$/.test(prop) || prop === 'outline' || prop === 'outline-color' || prop === 'text-decoration-color') {
      val = val.replace(COLOR_RE, (tok) => { const c = colorOf(tok); if (!c) return tok; const t = borderToken(classify(c), sel); return t || tok; });
    } else if (prop === 'box-shadow') {
      if (val === 'none') return m;
      const inset = val.match(/inset\s+0(px)?\s+0(px)?\s+0(px)?\s+(\d+(\.\d+)?px)\s+(#[0-9a-f]{3,8}|rgba?\([^)]*\)|var\([^)]*\))/i);
      if (/:focus/.test(sel)) val = '0 0 0 2px var(--ds-color-focus)';
      else if (inset && !/,/.test(val.replace(/\([^)]*\)/g, ''))) { const c = colorOf(inset[6]); val = `inset 0 0 0 ${inset[4]} ${borderToken(classify(c), sel) || 'var(--ds-border)'}`; }
      else val = 'none';
    } else if (prop === 'text-shadow') {
      val = 'none';
    } else if (prop === 'filter' && /drop-shadow/.test(val)) {
      val = val.replace(/drop-shadow\([^()]*(\([^)]*\)[^()]*)*\)/g, '').trim() || 'none';
    } else if (prop === 'font-family') {
      if (/monospace|mono/i.test(val)) return m;
      val = 'var(--ds-font-family-stack)';
    } else if (prop === 'font-size') {
      const px = val.match(/^(\d+(\.\d+)?)px$/);
      const clamp = val.match(/^clamp\(\s*[\d.]+px\s*,[^,]+,\s*(\d+(\.\d+)?)px\s*\)$/);
      if (px) val = sizeToken(Number(px[1]));
      else if (clamp) val = sizeToken(Number(clamp[1]));
    } else if (prop === 'font-weight') {
      const w = Number(val);
      if (!Number.isNaN(w)) val = w >= 500 ? 'var(--ds-font-weight-strong)' : 'var(--ds-font-weight-base)';
    } else if (/^border(-[a-z]+)*-radius$/.test(prop)) {
      val = radiusToken(val);
    } else if (prop === 'transition' || prop === 'transition-duration') {
      val = motion(val);
    } else if (prop === 'backdrop-filter' || prop === '-webkit-backdrop-filter') {
      return m; // blur is fine on black
    } else {
      return m;
    }

    if (val === before) return m;
    changes++;
    log.changed.push({ sel: sel.slice(0, 90), prop, from: before.slice(0, 80), to: val.slice(0, 80) });
    return `${lead}${ws}${prop}${colon}${val}${imp}`;
  });

  // A light-filled button inverts to black on a black page and loses its edge.
  // Give it a control-contrast outline (6:1). Inset shadow, not border: no layout shift.
  let finalBody = newBody;
  if (role === 'surface' && BTN.test(sel) && !/:hover|:active|:focus/.test(sel)
      && !/(^|;)\s*border(-(top|right|bottom|left))?(-color)?\s*:/.test(finalBody) && !/(^|;)\s*box-shadow\s*:\s*inset/.test(finalBody)) {
    finalBody = finalBody.replace(/(^|;)\s*box-shadow\s*:\s*none(\s*!important)?\s*(?=;|$)/, '$1').replace(/;?\s*$/, '');
    finalBody += ';box-shadow:inset 0 0 0 1px var(--ds-border-control)';
    changes++;
    log.changed.push({ sel: sel.slice(0, 90), prop: 'box-shadow', from: '(none)', to: 'inset 0 0 0 1px var(--ds-border-control)' });
  }

  // Flag the one pattern an inverted theme gets wrong: light text alone in an
  // interactive rule, whose background is set elsewhere and may now be white.
  if (!bgMatch && /(^|;)\s*color\s*:\s*(#f|#e|white|rgba\(255)/i.test(body) && /button|btn|cta|select|checkout/i.test(sel)) {
    log.review.push({ sel: sel.slice(0, 90), why: 'light text with no background in this rule — check it is not on a now-white button' });
  }
  return `${selRaw}{${finalBody}}`;
});

fs.writeFileSync(LOG, JSON.stringify(log, null, 1));
if (!DRY) fs.writeFileSync(FILE, out);
console.log(`${FILE}: ${changes} declarations changed${DRY ? ' (dry run)' : ''}`);
console.log(`  skipped — product renders: ${log.skipped.product}, keyframes with colour: ${log.skipped.keyframe}, :root/@theme: ${log.skipped.root}, global element rules with colour/type: ${log.skipped.element.length}`);
console.log(`  flagged for review: ${log.review.length}`);
