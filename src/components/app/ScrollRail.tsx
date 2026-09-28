import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Hovering this close to an edge scrolls the rail, faster nearer the edge. */
const EDGE = 84;
const MAX_SPEED = 13;

/**
 * A horizontal link rail that is easy to scroll with a mouse, not only by
 * swiping:
 *
 *  - arrow buttons at either end, shown only when there is more that way;
 *  - the mouse wheel scrolls it sideways (until an end, then the page scrolls);
 *  - resting the pointer near an edge glides it automatically;
 *  - press and drag to pull it along.
 *
 * The current page's link is brought into view on arrival, and edges fade out
 * where content continues. When the rail is a vertical sidebar (wide screens)
 * none of this engages and it behaves as a normal list.
 */
export default function ScrollRail({ className, label, children }: { className: string; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const speed = useRef(0);
  const frame = useRef(0);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const horizontal = () => {
    const el = ref.current;
    return !!el && el.scrollWidth > el.clientWidth + 1;
  };

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollWidth > el.clientWidth + 1;
    const next = {
      left: overflow && el.scrollLeft > 2,
      right: overflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    measure();
    const current = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (current && el.scrollWidth > el.clientWidth + 1) {
      el.scrollLeft = current.offsetLeft - (el.clientWidth - current.offsetWidth) / 2;
    }

    const resize = new ResizeObserver(measure);
    resize.observe(el);
    el.addEventListener('scroll', measure, { passive: true });

    // A vertical wheel moves the rail sideways; at either end the page takes over.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return; // trackpad: already sideways
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? el.clientWidth : 1;
      const max = el.scrollWidth - el.clientWidth;
      const target = Math.max(0, Math.min(max, el.scrollLeft + event.deltaY * unit));
      if (Math.abs(target - el.scrollLeft) < 0.5) return;
      event.preventDefault();
      el.scrollLeft = target;
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(frame.current);
    };
  }, [measure]);

  const glide = () => {
    const el = ref.current;
    if (!el || speed.current === 0) {
      frame.current = 0;
      return;
    }
    el.scrollLeft += speed.current;
    frame.current = requestAnimationFrame(glide);
  };

  const stopGlide = () => {
    speed.current = 0;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || event.pointerType !== 'mouse' || !horizontal()) return;

    if (drag.current) {
      const dx = event.clientX - drag.current.x;
      if (Math.abs(dx) > 5) drag.current.moved = true;
      if (drag.current.moved) el.scrollLeft = drag.current.left - dx;
      stopGlide();
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = el.getBoundingClientRect();
    const fromLeft = event.clientX - box.left;
    const fromRight = box.right - event.clientX;
    const pull = (d: number) => Math.max(1.2, MAX_SPEED * ((EDGE - d) / EDGE) ** 1.6);
    speed.current = fromLeft < EDGE ? -pull(fromLeft) : fromRight < EDGE ? pull(fromRight) : 0;
    if (speed.current !== 0 && !frame.current) frame.current = requestAnimationFrame(glide);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !horizontal()) return;
    drag.current = { x: event.clientX, left: ref.current?.scrollLeft ?? 0, moved: false };
  };

  const endDrag = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };

  const nudge = (direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.65), behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <div className="scroll-rail" data-more-left={edges.left || undefined} data-more-right={edges.right || undefined}>
      <button type="button" className="scroll-rail-arrow is-left" tabIndex={-1} aria-label={`Scroll ${label} left`} hidden={!edges.left} onClick={() => nudge(-1)}>
        <ChevronLeft size={17} />
      </button>
      <div
        ref={ref}
        className={className}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          stopGlide();
          endDrag();
        }}
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onClickCapture={(event) => {
          // A drag that ends over a link is not a click on it.
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onDragStart={(event) => event.preventDefault()}
      >
        {children}
      </div>
      <button type="button" className="scroll-rail-arrow is-right" tabIndex={-1} aria-label={`Scroll ${label} right`} hidden={!edges.right} onClick={() => nudge(1)}>
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
