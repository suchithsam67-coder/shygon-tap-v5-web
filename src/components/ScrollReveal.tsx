import { useEffect } from 'react';

/**
 * Scroll animation for the storefront and account pages: section-level blocks
 * fade and rise into place as they enter the viewport, with a small stagger
 * between siblings.
 *
 * Content is never hidden unless this has run and motion is allowed: the
 * hiding CSS applies only under html.sr-on, which is set here and not for
 * visitors who ask for reduced motion (or when printing). New content from a
 * route change is picked up by a MutationObserver. Renders nothing.
 */

const TARGETS = [
  '[data-reveal]',
  '.reveal-on-scroll',
  // Home page: the blocks inside each section, not the hero.
  '.section > .container > *',
  '.store-benefits-grid > div',
  '.manifesto .container > *',
  // Catalog, product, 404, legal.
  '.store-product-card',
  '.product-related li',
  '.not-found-cards li',
  '.legal-body > section',
  // Account area.
  '.app-main > .panel',
  '.app-main > section',
].join(', ');

export default function ScrollReveal() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reduce.matches || !('IntersectionObserver' in window)) return;

    const root = document.documentElement;
    root.classList.add('sr-on');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('sr-in');
          observer.unobserve(entry.target);
        }
      },
      // Any part entering counts: a ratio threshold never trips for blocks
      // taller than the screen (the card grid on a phone is ~4 screens tall),
      // which left them invisible while their top was already in view.
      { rootMargin: '0px 0px -6% 0px', threshold: 0 },
    );

    const scan = () => {
      // Nobody is watching a background tab, and browsers pause intersection
      // checks there: show everything rather than leave sections hidden.
      const hidden = document.visibilityState === 'hidden';
      document.querySelectorAll<HTMLElement>(TARGETS).forEach((el) => {
        if (el.classList.contains('sr-item') || el.closest('.hero, .pay-overlay, .modal-scrim')) return;
        // Already on screen (or scrolled past): show at once, never "pop" it.
        if (hidden || el.getBoundingClientRect().top < window.innerHeight * 0.92) {
          el.classList.add('sr-item', 'sr-in');
          return;
        }
        el.classList.add('sr-item');
        const index = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        el.style.setProperty('--sr-delay', `${Math.min(index, 4) * 70}ms`);
        observer.observe(el);
      });
    };

    scan();
    let frame = 0;
    const mutations = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(scan);
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // If motion is turned off mid-visit, show everything at once.
    const onChange = () => {
      if (reduce.matches) root.classList.remove('sr-on');
    };
    reduce.addEventListener('change', onChange);

    // Hidden while waiting (the tab went to the background): reveal the rest.
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      document.querySelectorAll('.sr-item:not(.sr-in)').forEach((el) => {
        el.classList.add('sr-in');
        observer.unobserve(el);
      });
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
      reduce.removeEventListener('change', onChange);
      document.removeEventListener('visibilitychange', onVisibility);
      root.classList.remove('sr-on');
    };
  }, []);

  return null;
}
