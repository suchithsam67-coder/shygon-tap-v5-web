import { useCallback, useEffect, useRef, useState } from 'react';
import BrandMark from '../brand/BrandMark';
import './opening.css';

/**
 * The SHYGON opening: the SHYGON mark lit by a passing light, the product
 * name, then the curtain lifts to the page underneath.
 *
 * On the public Tap it is also the loading state: it paints from the first
 * frame, before the profile has arrived, so the visitor never watches a
 * spinner and then an animation. It lifts when the content is `ready` and
 * the reveal has run for `minMs`; a tap, a click or any key cuts the reveal
 * short (it still waits for the content, which is never long: the page shows
 * its own error after 12 seconds).
 *
 * It is a curtain over a page that is rendered and reachable the whole time:
 * the overlay is aria-hidden, so a screen reader or keyboard user is never
 * held by it. A tap on it is swallowed rather than passed through, so nobody
 * calls a number by accident while the light is still moving. If the
 * stylesheet fails, the timers still remove it. Callers do not mount it under
 * reduced motion.
 */

/** How long the reveal plays before the curtain may lift. */
export const OPENING_MS = 1800;
/** The lift itself. */
const LEAVE_MS = 420;
/** Once the content is ready, the page is never covered for longer than this. */
const FAILSAFE_MS = OPENING_MS + LEAVE_MS + 600;

export function TapOpening({
  product = 'AAROH',
  caption,
  ready = true,
  minMs = OPENING_MS,
  onDone,
}: {
  /** The line under SHYGON: AAROH on a card, OS for the owner. */
  product?: string;
  caption?: string;
  /** False while the page underneath is still loading. */
  ready?: boolean;
  /** How long the reveal plays at least; 0 lifts it as soon as `ready`. */
  minMs?: number;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<'playing' | 'leaving'>('playing');
  const [played, setPlayed] = useState(minMs <= 0);
  const [skipped, setSkipped] = useState(false);
  const done = useRef(false);
  const leaving = useRef(false);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onDone();
  }, [onDone]);

  // The reveal's own clock, from the moment it first painted.
  useEffect(() => {
    if (played) return;
    const timer = window.setTimeout(() => setPlayed(true), minMs);
    return () => window.clearTimeout(timer);
  }, [played, minMs]);

  // A tap, a click or a key: the visitor has seen enough.
  useEffect(() => {
    const onKey = () => setSkipped(true);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shouldLeave = ready && (played || skipped || minMs <= 0);
  useEffect(() => {
    if (!shouldLeave || leaving.current) return;
    leaving.current = true;
    setPhase('leaving');
    const timer = window.setTimeout(finish, LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [shouldLeave, finish]);

  // Belt and braces: whatever happens to the animation or a timer above,
  // content that is ready is never covered for long.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(finish, FAILSAFE_MS);
    return () => window.clearTimeout(timer);
  }, [ready, finish]);

  return (
    <div
      className={`tap-opening is-${phase}`}
      aria-hidden="true"
      data-testid="tap-opening"
      onPointerDown={(event) => {
        event.preventDefault();
        setSkipped(true);
      }}
    >
      <span className="tap-opening-light" />
      <span className="tap-opening-lockup">
        <span className="tap-opening-mark">
          <BrandMark />
          <span className="tap-opening-glint" />
        </span>
        <span className="tap-opening-word">SHYGON</span>
        <span className="tap-opening-product">{product}</span>
      </span>
      {caption && <span className="tap-opening-caption">{caption}</span>}
    </div>
  );
}
