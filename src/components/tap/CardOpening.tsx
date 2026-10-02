import { useEffect, useRef, useState } from 'react';
import type { CardLook, Experience } from '../../lib/database.types';
import { CARD_OPENING_MS, cardArtUrl, openingFor, type CardMotif } from './card-openings';

/**
 * The opening a tapped card plays: the visitor's own card arrives on screen,
 * an NFC pulse leaves it, the card's design does its one signature move, and
 * the page is revealed underneath. Which move is decided in card-openings.ts.
 *
 * Like ExperienceIntro it never blocks the page: a tap anywhere skips it, the
 * reduced-motion setting skips it entirely, and it unmounts itself when done.
 */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function CardOpening({
  card,
  tier = 'premium',
  onDone,
}: {
  card: CardLook;
  /** The page's experience: the higher it is, the richer the opening. */
  tier?: Experience;
  onDone: () => void;
}) {
  const [gone, setGone] = useState(false);
  const finished = useRef(false);
  const reduced = prefersReducedMotion();
  const opening = openingFor(card);

  useEffect(() => {
    if (finished.current) return;
    const finish = () => {
      if (finished.current) return;
      finished.current = true;
      setGone(true);
      onDone();
    };
    if (reduced) {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, CARD_OPENING_MS[tier]);
    window.addEventListener('pointerdown', finish, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', finish);
    };
  }, [reduced, onDone, tier]);

  if (gone || reduced) return null;

  return (
    <div
      className={`card-opening card-opening-${opening.motif} card-opening-tier-${tier}`}
      aria-hidden="true"
      style={{
        ['--co-t' as string]: `${CARD_OPENING_MS[tier]}ms`,
        ['--co-bg' as string]: opening.bg,
        ['--co-accent' as string]: opening.accent,
        ['--co-glow' as string]: opening.glow,
      }}
    >
      <span className="card-opening-bg" />
      {tier !== 'essential' && <Motif motif={opening.motif} />}
      {tier === 'goat' && (
        <span className="card-opening-goat">
          <b />
          <b />
          <b />
          {Array.from({ length: 8 }, (_, i) => (
            <i key={i} style={{ ['--i' as string]: i }} />
          ))}
        </span>
      )}
      <span className="card-opening-stage">
        <span className="card-opening-ripple">
          <i />
          <i />
          <i />
        </span>
        <img className="card-opening-card" src={cardArtUrl(card)} alt="" decoding="async" />
        <span className="card-opening-shine" />
        {opening.motif === 'canvas' && (
          <span className="card-opening-crops">
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </span>
    </div>
  );
}

/** The one move each design makes. Pure decoration, drawn with CSS. */
function Motif({ motif }: { motif: CardMotif }) {
  const count: Partial<Record<CardMotif, number>> = {
    lotus: 8,
    bloom: 5,
    smoke: 4,
    constellation: 7,
    aurora: 3,
  };
  const n = count[motif] ?? 1;
  return (
    <span className="card-opening-motif">
      {motif === 'arch' ? (
        <>
          <i className="card-opening-door card-opening-door-left" />
          <i className="card-opening-door card-opening-door-right" />
        </>
      ) : motif === 'canvas' ? null : (
        Array.from({ length: n }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)
      )}
    </span>
  );
}
