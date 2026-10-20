import { useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { TapOpening } from './TapOpening';

/**
 * The owner's opening: SHYGON, then SHYGON OS, over the dashboard, once per
 * browser session. Whether it already played is a per-viewer convenience, so
 * it lives in sessionStorage; if storage is unavailable it simply plays.
 * Never under reduced motion, and a tap or key ends it.
 */
const KEY = 'shygon.os.opening.seen';

function seen(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    /* storage blocked: it plays again next time, which is harmless */
  }
}

export default function OwnerOpening() {
  const reduced = useReducedMotion();
  const [show, setShow] = useState(() => !seen());
  if (!show || reduced) return null;
  return (
    <TapOpening
      product="OS"
      caption="Your card, your controls."
      onDone={() => {
        markSeen();
        setShow(false);
      }}
    />
  );
}
