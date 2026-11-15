/**
 * The landing's static first paint (V01 T-14, OC-4).
 *
 * The build renders the landing's real header and hero into `/shygontap`'s
 * HTML, in `#landing-static` beside `#root`, so the page opens already showing
 * them instead of a loading screen (vite.config.ts, src/seo/landingStatic.tsx).
 * While it is there, React's loading screens stay out of the way
 * (BrandLoader), and the live landing removes it in the same frame it renders
 * (ShygonTap.tsx), so the visitor never sees the switch.
 */

const ID = 'landing-static';

/** True while the static copy of the landing is on the page. */
export function staticLandingShown(): boolean {
  return typeof document !== 'undefined' && document.getElementById(ID) !== null;
}

/**
 * Removes the static copy, once, and marks the page so the live hero does not
 * play its entrance again (index.css). Returns whether there was one.
 */
export function takeOverStaticLanding(): boolean {
  if (typeof document === 'undefined') return false;
  const node = document.getElementById(ID);
  if (!node) return false;
  node.remove();
  document.documentElement.dataset.staticLanding = 'taken';
  return true;
}

/** The live landing has gone (another page): its next visit animates as usual. */
export function releaseStaticLanding(): void {
  if (typeof document !== 'undefined') delete document.documentElement.dataset.staticLanding;
}
