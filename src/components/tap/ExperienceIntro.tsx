import { useEffect, useRef, useState } from 'react';
import type { Experience, ThemeAnimation } from '../../lib/database.types';
import { INTRO_DURATIONS, resolveIntro } from './intro-rules';

/**
 * The opening animation itself. Which experiences get one, and which one they
 * get, is decided in `intro-rules.ts` — this module exports only components so
 * React Fast Refresh can hot-update it.
 */

/** Honours the OS "reduce motion" setting; a premium opening is not worth a migraine. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function ExperienceIntro({
  experience,
  animation = 'auto',
  onDone,
}: {
  experience: Experience;
  animation?: ThemeAnimation;
  onDone: () => void;
}) {
  const [gone, setGone] = useState(false);
  const finished = useRef(false);

  const kind = resolveIntro(experience, animation);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (finished.current) return;

    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      setGone(true);
      onDone();
    };

    if (kind === 'none' || reduced) {
      finish();
      return;
    }

    const timer = window.setTimeout(finish, INTRO_DURATIONS[kind]);
    // A visitor who taps the screen has decided they have seen enough.
    window.addEventListener('pointerdown', finish, { once: true });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', finish);
    };
  }, [kind, reduced, onDone]);

  if (gone || kind === 'none' || reduced) return null;

  return (
    <div className={`tap-intro tap-intro-${kind}`} aria-hidden="true">
      {kind === 'business' && <BusinessIntro />}
      {kind === 'premium' && <PremiumIntro />}
      {kind === 'goat' && <GoatIntro />}
    </div>
  );
}

/**
 * Business — a single clean wipe across the card and a thin accent rule that
 * draws itself. Professional, over in about a second, nothing that would look
 * out of place in front of a client.
 */
function BusinessIntro() {
  return (
    <>
      <span className="tap-intro-veil" />
      <span className="tap-intro-wipe" />
      <span className="tap-intro-rule" />
    </>
  );
}

/**
 * Premium — a light sweep with depth: the veil lifts, a broad specular band
 * crosses on a diagonal, and two soft flares trail it.
 */
function PremiumIntro() {
  return (
    <>
      <span className="tap-intro-veil tap-intro-veil-deep" />
      <span className="tap-intro-sweep" />
      <span className="tap-intro-glow tap-intro-glow-1" />
      <span className="tap-intro-glow tap-intro-glow-2" />
      <span className="tap-intro-rule" />
    </>
  );
}

/**
 * GOAT — the signature opening. Concentric rings rush the viewer, a monogram
 * ignites, and the whole thing is tinted by the time of day (see
 * `useDynamicAccent` in TapExperience), so the same profile genuinely does not
 * open the same way at 9am and 9pm.
 */
function GoatIntro() {
  return (
    <>
      <span className="tap-intro-veil tap-intro-veil-deep" />
      <span className="tap-goat-rings">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="tap-goat-spark" />
      <span className="tap-intro-sweep tap-intro-sweep-fast" />
    </>
  );
}
