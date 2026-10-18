import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Pause, Play } from 'lucide-react';
import { AAROH_DEFAULT_FINISH, AAROH_EDITIONS, type AarohEdition } from '../../data/aaroh';
import { AAROH_CONSTELLATION } from '../../data/aarohProduct';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import AarohCard from './AarohCard';
import { SHOWCASE_ICONS } from './showcaseIcons';

/** The intro, as beats: "Meet AAROH", then each edition turning, then "one card, many experiences". */
type Beat = { kind: 'meet' } | { kind: 'edition'; index: number } | { kind: 'meaning' };
const BEATS: readonly Beat[] = [
  { kind: 'meet' },
  ...AAROH_EDITIONS.map((_, index) => ({ kind: 'edition' as const, index })),
  { kind: 'meaning' },
];
const HOLD = { meet: 4000, edition: 5600, meaning: 6400 } as const;
/** Each edition's turn: to the back, then home again, ms into its beat. */
const TURN = [1700, 3900] as const;

/**
 * The AAROH hero card: one large card, the cinematic intro playing around it.
 *
 * It opens on "Meet AAROH.", turns each of the ten editions to show its back,
 * then gathers what one card brings together, and loops. A visitor can pause
 * it, pick an edition (which pauses it there), or open that edition's
 * overview. It stops while it is off screen or the tab is hidden, and with
 * reduced motion it never moves by itself: the card shows one face and every
 * edition is a press away. `compact` is the store's version: the card, the
 * edition's name and the pause button, no captions.
 */
export default function AarohHero({
  onOpen,
  compact = false,
  headingId,
}: {
  onOpen: (edition: AarohEdition) => void;
  compact?: boolean;
  headingId?: string;
}) {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const [beat, setBeat] = useState(compact ? 1 : 0);
  const [shown, setShown] = useState(0);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [playing, setPlaying] = useState(true);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => typeof document === 'undefined' || !document.hidden);
  const current = BEATS[beat]!;
  const edition = AAROH_EDITIONS[shown]!;
  const running = playing && !reduced && onScreen && tabVisible;

  // Pause while off screen or in a background tab.
  useEffect(() => {
    const node = stageRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0.2 });
    observer.observe(node);
    const onVisibility = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // The next beat. The store's compact card skips the captions' first and last beats.
  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => {
      let next = (beat + 1) % BEATS.length;
      if (compact) while (BEATS[next]!.kind !== 'edition') next = (next + 1) % BEATS.length;
      const target = BEATS[next]!;
      setSide('front');
      if (target.kind === 'edition') setShown(target.index);
      if (target.kind === 'meet') setShown(0);
      setBeat(next);
    }, HOLD[current.kind]);
    return () => window.clearTimeout(timer);
  }, [running, beat, current.kind, compact]);

  // An edition beat turns the card to its back and home again.
  useEffect(() => {
    if (!running || current.kind !== 'edition') return;
    const toBack = window.setTimeout(() => setSide('back'), TURN[0]);
    const toFront = window.setTimeout(() => setSide('front'), TURN[1]);
    return () => {
      window.clearTimeout(toBack);
      window.clearTimeout(toFront);
    };
  }, [running, beat, current.kind]);

  const pick = (index: number) => {
    setPlaying(false);
    setSide('front');
    setShown(index);
    setBeat(1 + index);
  };

  const style = { '--ah-glow': edition.ambient.glow, '--ah-accent': edition.theme.accent } as React.CSSProperties;

  return (
    <div className={`ah ${compact ? 'ah-compact' : ''}`.trim()} style={style} data-beat={current.kind} data-motion={reduced ? 'reduced' : 'full'}>
      <div className="ah-stage" ref={stageRef}>
        {!compact && (
          <div className="ah-caption" aria-live={running ? 'off' : 'polite'}>
            {current.kind === 'meet' && (
              <div key="meet" className="ah-lines">
                <p className="ah-big">Meet AAROH.</p>
                <p className="ah-soft">One card. Many possibilities.</p>
                <p className="ah-note">More than a card. Your entry point to the SHYGON OS experience.</p>
              </div>
            )}
            {current.kind === 'edition' && (
              <div key={`edition-${edition.id}`} className="ah-lines">
                <p className="ah-kicker">Edition {edition.number} of {AAROH_EDITIONS.length}</p>
                <p className="ah-big">{edition.title}</p>
                <p className="ah-note">{edition.character}</p>
              </div>
            )}
            {current.kind === 'meaning' && (
              <div key="meaning" className="ah-lines">
                <p className="ah-caps">One physical card. Multiple digital experiences.</p>
                <p className="ah-note">Your physical card stays the same. Your digital experience can evolve with you.</p>
              </div>
            )}
          </div>
        )}

        <div className="ah-object-wrap">
          <button
            type="button"
            className="ah-object"
            onClick={() => onOpen(edition)}
            aria-label={`Open the AAROH ${edition.title} overview`}
            aria-describedby={headingId}
          >
            <AarohCard
              edition={edition}
              finish={AAROH_DEFAULT_FINISH}
              side={reduced ? 'front' : side}
              sweepKey={`${edition.id}-${beat}`}
              priority
              sizes={compact ? '(max-width: 640px) 66vw, 420px' : '(max-width: 660px) calc(100vw - 60px), 600px'}
            />
          </button>
          {!compact && current.kind === 'meaning' && (
            <ul className="ah-orbit" aria-label="What one AAROH card brings together">
              {AAROH_CONSTELLATION.map((feature, i) => {
                const Icon = SHOWCASE_ICONS[feature.icon];
                return (
                  <li key={feature.id} style={{ '--i': i } as React.CSSProperties}>
                    <Icon size={15} aria-hidden="true" /> {feature.name}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="ah-controls">
          {!reduced && (
            <button type="button" className="ah-icon" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause the intro' : 'Play the intro'}>
              {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
          )}
          {compact ? (
            <span className="ah-name">
              Edition {edition.number} · {edition.title}
            </span>
          ) : (
            <div className="ah-editions" role="group" aria-label="Show an edition">
              {AAROH_EDITIONS.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className="ah-swatch"
                  aria-label={`Show ${item.title}`}
                  aria-pressed={index === shown && current.kind === 'edition'}
                  style={{ '--sw': item.colours[0], '--sw2': item.colours[2] } as React.CSSProperties}
                  onClick={() => pick(index)}
                />
              ))}
            </div>
          )}
          {!compact && (
            <button type="button" className="ah-open" onClick={() => onOpen(edition)}>
              Explore {edition.title} <ArrowRight size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
