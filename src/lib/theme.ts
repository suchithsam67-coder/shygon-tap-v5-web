/**
 * Light / dark theme for the storefront and account area.
 *
 * The choice lives on <html data-theme="…"> so CSS can resolve the whole token
 * set from one attribute (src/styles/theme-light.css). index.html applies the
 * saved choice before the first paint, so a light-theme visitor never sees a
 * dark flash. Dark is the default: it is the brand's original design.
 *
 * Stored in localStorage as a per-viewer convenience (see the Cookie Policy).
 */

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'shygon_theme';
export const THEME_EVENT = 'shygon-theme-change';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', theme === 'light' ? '#f6f3ec' : '#090a0c');
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or storage blocked: the theme still applies for this visit.
  }
  window.dispatchEvent(new CustomEvent<Theme>(THEME_EVENT, { detail: theme }));
}

/** How long the reveal takes, and its curve: a gentle start and a soft landing. */
const REVEAL_MS = 820;
const REVEAL_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)';
let switching = false;

/**
 * Switches theme with a soft-edged circular reveal that grows from the button
 * the visitor pressed (View Transitions API). The edge is a feathered radial
 * mask rather than a hard clip, the old page dims slightly as it is covered,
 * and presses during a running switch are ignored instead of restarting it.
 * Falls back to a colour cross-fade where view transitions are missing, and
 * to an instant switch for reduced motion.
 */
export function switchTheme(next: Theme, origin?: { x: number; y: number }) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };

  if (reduce) {
    apply(next);
    return;
  }
  if (switching) return;

  const root = document.documentElement;
  if (!doc.startViewTransition) {
    switching = true;
    root.classList.add('theme-fading');
    apply(next);
    window.setTimeout(() => {
      root.classList.remove('theme-fading');
      switching = false;
    }, 620);
    return;
  }

  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? 0;
  // Far enough that the feathered edge has left the screen at the end.
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y)) * 1.25;
  switching = true;
  root.classList.add('theme-switching');
  const transition = doc.startViewTransition(() => apply(next));
  void transition.ready
    .then(() => {
      const timing = { duration: REVEAL_MS, easing: REVEAL_EASING, fill: 'both' as const };
      root.animate(
        {
          maskSize: ['0px 0px', `${radius * 2}px ${radius * 2}px`],
          webkitMaskSize: ['0px 0px', `${radius * 2}px ${radius * 2}px`],
          maskPosition: [`${x}px ${y}px`, `${x - radius}px ${y - radius}px`],
          webkitMaskPosition: [`${x}px ${y}px`, `${x - radius}px ${y - radius}px`],
        } as PropertyIndexedKeyframes,
        { ...timing, pseudoElement: '::view-transition-new(root)' },
      );
      root.animate(
        { filter: ['brightness(1)', 'brightness(0.86)'], transform: ['scale(1)', 'scale(0.992)'] },
        { ...timing, pseudoElement: '::view-transition-old(root)' },
      );
    })
    .catch(() => undefined);
  void transition.finished.finally(() => {
    root.classList.remove('theme-switching');
    switching = false;
  });
}
