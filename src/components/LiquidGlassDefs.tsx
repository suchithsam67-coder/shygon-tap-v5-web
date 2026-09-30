/**
 * The SVG filter behind SHYGON's liquid-glass material (`.liquid-glass` in
 * index.css). One feTurbulence + feDisplacementMap pair, referenced by id from
 * CSS (`filter: url(#shygon-liquid-refract)`) wherever a glass surface needs a
 * soft, organic refraction rather than a flat blur — the difference between
 * "premium glass" and a plain glassmorphism card.
 *
 * Rendered once at the app root; nothing here is visible on its own (0×0,
 * aria-hidden) — it only exists to be referenced.
 */
export default function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <filter id="shygon-liquid-refract" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
