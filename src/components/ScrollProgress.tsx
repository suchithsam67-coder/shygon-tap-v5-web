import { useEffect, useRef } from 'react';

/**
 * The gold reading-progress bar across the top of the page.
 *
 * Written against the raw scroll position rather than framer-motion. The
 * library was this component's only use anywhere in the routed app, and because
 * the bar mounts on every route it was pulling the whole animation runtime into
 * the bundle that a visitor downloads after tapping an NFC card — for a bar the
 * public Tap page does not even show.
 *
 * The width is driven by a CSS custom property written from a rAF-throttled
 * scroll listener, so the browser composites it and React never re-renders.
 */
export default function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const element = bar.current;
      if (!element) return;

      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      // A page shorter than the viewport has nothing to progress through.
      const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
      element.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
    };

    const onScroll = () => {
      // Coalesce bursts of scroll events into one write per frame.
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div
      ref={bar}
      aria-hidden="true"
      style={{ transform: 'scaleX(0)' }}
      className="fixed top-0 left-0 right-0 h-1 origin-left z-[9999] will-change-transform
      bg-gradient-to-r from-yellow-300 via-yellow-500 to-yellow-300
      shadow-[0_0_20px_rgba(234,179,8,0.8)]"
    />
  );
}
