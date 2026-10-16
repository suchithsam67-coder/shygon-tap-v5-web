import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import {
  AAROH,
  AAROH_BULK_MINIMUM,
  AAROH_EDITIONS,
  aarohThemeStyle,
  type AarohEdition,
  type AarohFinish,
} from '../../data/aaroh';
import {
  AAROH_CONSTELLATION,
  OWNER_STEPS,
  PRIVACY_POINTS,
  STATUS_LABEL,
} from '../../data/aarohProduct';
import { aarohPrice, aarohVariant, inStock, type Catalog } from '../../services/catalog';
import { CARD_SALES_OPEN } from '../../lib/commerce';
import CardsComingSoon from '../CardsComingSoon';
import AarohCard from './AarohCard';
import FeatureShowcase from './FeatureShowcase';
import { SHOWCASE_ICONS } from './showcaseIcons';
import FinishPicker from './FinishPicker';

/** The welcome's three scenes; scene 3 is the settled overview. */
const SCENES = ['Arrival', 'The card', 'One card, many experiences'] as const;
type Scene = 0 | 1 | 2 | 3;
/** How long each scene holds when it plays by itself, ms. */
const HOLD = [3600, 6600, 6000] as const;
/** Scene 1's turn: to the back, then to the front again, ms into the scene. */
const TURN_AT = [1500, 4300] as const;
const INTRO_KEY = 'shygon_aaroh_intro_seen';
const MAX_RETAIL_QUANTITY = AAROH_BULK_MINIMUM - 1;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function introSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}
function markIntroSeen() {
  try {
    localStorage.setItem(INTRO_KEY, '1');
  } catch {
    /* private mode: the welcome simply plays again next time */
  }
}

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setReduced(list.matches);
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, []);
  return Boolean(reduced);
}

/**
 * The AAROH edition overview: one shared, edition-driven experience.
 *
 * A full-screen modal dialog over the collection, themed by the edition's
 * design-system tokens (aarohThemeStyle); switching edition re-themes it in
 * place. It opens on a short welcome (arrival, the card's turn, "one card,
 * many experiences") that plays by itself, can be paused, stepped, skipped and
 * replayed, and is skipped on later visits (this browser only). Below it: the
 * feature showcase, what the cardholder controls, the privacy promise, the
 * edition's story, and the selection, which hands off to the existing
 * checkout through the page's `onBuy`.
 *
 * The store only explains: nothing here writes a mode, a setting or a card.
 * With reduced motion nothing plays by itself, the card cross-fades instead of
 * turning, and every scene is one press away.
 */
export default function AarohOverview({
  edition,
  finish,
  catalog,
  onClose,
  onEdition,
  onFinish,
  onBuy,
}: {
  edition: AarohEdition;
  finish: AarohFinish;
  catalog: Catalog | null;
  onClose: (target?: string) => void;
  onEdition: (edition: AarohEdition) => void;
  onFinish: (finish: AarohFinish) => void;
  onBuy: (quantity: number) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const [scene, setScene] = useState<Scene>(() => (introSeen() ? 3 : 0));
  const [playing, setPlaying] = useState(true);
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [quantity, setQuantity] = useState(1);
  const index = AAROH_EDITIONS.findIndex((item) => item.id === edition.id);
  const previous = AAROH_EDITIONS[(index - 1 + AAROH_EDITIONS.length) % AAROH_EDITIONS.length]!;
  const next = AAROH_EDITIONS[(index + 1) % AAROH_EDITIONS.length]!;
  const variant = aarohVariant(catalog, edition.id, finish.id);
  const buyable = CARD_SALES_OPEN && inStock(variant);
  const unitPrice = aarohPrice(catalog, edition.id, finish);
  const autoplay = playing && !reduced && scene < 3;

  // A modal dialog: the page behind it is inert, Escape closes it. Opened once
  // per mount; switching edition re-renders it in place.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    dialog.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onCancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  const finishIntro = useCallback(() => {
    markIntroSeen();
    setSide('front');
    setScene(3);
  }, []);

  // The welcome plays by itself unless paused or reduced motion is on.
  useEffect(() => {
    if (!autoplay) return;
    const timer = window.setTimeout(() => {
      if (scene === 2) finishIntro();
      else setScene((scene + 1) as Scene);
    }, HOLD[scene as 0 | 1 | 2]);
    return () => window.clearTimeout(timer);
  }, [autoplay, scene, finishIntro]);

  // Scene 1 turns the card to its back and home again.
  useEffect(() => {
    if (scene !== 1 || !autoplay) return;
    const toBack = window.setTimeout(() => setSide('back'), TURN_AT[0]);
    const toFront = window.setTimeout(() => setSide('front'), TURN_AT[1]);
    return () => {
      window.clearTimeout(toBack);
      window.clearTimeout(toFront);
    };
  }, [scene, autoplay]);

  const go = (target: Scene) => {
    if (target === 3) return finishIntro();
    setSide('front');
    setScene(target);
  };
  const replay = () => {
    setPlaying(true);
    setSide('front');
    setScene(0);
    scrollRef.current?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };
  const scrollTo = (id: string) => {
    const target = dialogRef.current?.querySelector<HTMLElement>(`#${id}`);
    target?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    target?.focus({ preventScroll: true });
  };

  const style = {
    ...aarohThemeStyle(edition),
    '--ed-glow-mix': `${Math.round(edition.ambient.strength * 100)}%`,
    '--ao-hold': `${scene < 3 ? HOLD[scene as 0 | 1 | 2] : 0}ms`,
  } as React.CSSProperties;

  const ownerSteps = OWNER_STEPS.map((step, i) => (i === 0 && CARD_SALES_OPEN ? { ...step, status: 'available' as const } : step));

  return (
    <dialog
      ref={dialogRef}
      className="ao"
      style={style}
      data-edition={edition.id}
      data-light={edition.theme.light || undefined}
      data-motion={reduced ? 'reduced' : 'full'}
      aria-labelledby="ao-title"
      tabIndex={-1}
    >
      <div className="ao-atmosphere" aria-hidden="true" />
      <header className="ao-bar">
        <button type="button" className="ao-back" onClick={() => onClose()}>
          <ArrowLeft size={16} aria-hidden="true" /> All editions
        </button>
        <p className="ao-bar-title">
          AAROH <span>Edition {edition.number} of {AAROH_EDITIONS.length}</span>
        </p>
        <div className="ao-switch">
          <button type="button" onClick={() => onEdition(previous)} aria-label={`Previous edition: ${previous.title}`}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <span className="ao-switch-name" aria-hidden="true">{edition.title}</span>
          <button type="button" onClick={() => onEdition(next)} aria-label={`Next edition: ${next.title}`}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="ao-x" onClick={() => onClose()} aria-label="Close the overview">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="ao-scroll" ref={scrollRef}>
        {/* ---------------------------------------------------- welcome */}
        <section className="ao-stage" data-scene={scene} aria-labelledby="ao-title">
          <h2 id="ao-title" className="sr-only">
            AAROH {edition.title}, edition {edition.number}: overview
          </h2>
          <div className="ao-stage-copy" aria-live={autoplay ? 'off' : 'polite'}>
            {scene === 0 && (
              <div key={`a-${edition.id}`} className="ao-scene">
                <p className="ao-kicker">AAROH · Edition {edition.number} · {edition.title}</p>
                <p className="ao-display">Meet AAROH.</p>
                <p className="ao-display ao-display-soft">One card. Many possibilities.</p>
                <p className="ao-lede">More than a card. Your entry point to the SHYGON OS experience.</p>
              </div>
            )}
            {scene === 1 && (
              <div key={`b-${edition.id}`} className="ao-scene">
                <p className="ao-kicker">Edition {edition.number} of {AAROH_EDITIONS.length}</p>
                <p className="ao-display">{edition.title}</p>
                <p className="ao-lede">{edition.character}</p>
              </div>
            )}
            {scene === 2 && (
              <div key={`c-${edition.id}`} className="ao-scene">
                <p className="ao-caps">One physical card. Multiple digital experiences.</p>
                <p className="ao-lede">Your physical card stays the same. Your digital experience can evolve with you.</p>
              </div>
            )}
            {scene === 3 && (
              <div key={`d-${edition.id}`} className="ao-scene">
                <p className="ao-kicker">AAROH · {AAROH.version} · Edition {edition.number}</p>
                <p className="ao-display">{edition.title}</p>
                <p className="ao-lede">{edition.description}</p>
                <div className="ao-actions">
                  <button type="button" className="ao-button ao-button-primary" onClick={() => scrollTo('ao-choose')}>
                    Choose {edition.title}
                  </button>
                  <button type="button" className="ao-button" onClick={() => scrollTo('ao-features')}>
                    Explore the features
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="ao-object">
            <AarohCard
              edition={edition}
              finish={finish.id}
              side={side}
              sweepKey={`${edition.id}-${finish.id}-${scene}`}
              priority
              sizes="(max-width: 720px) 88vw, (max-width: 1200px) 52vw, 640px"
            />
            {scene === 2 && (
              <ul className="ao-orbit" aria-label="What one AAROH card brings together">
                {AAROH_CONSTELLATION.map((feature, i) => {
                  const Icon = SHOWCASE_ICONS[feature.icon];
                  return (
                    <li key={feature.id} style={{ '--i': i } as React.CSSProperties}>
                      <Icon size={16} aria-hidden="true" /> {feature.name}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {scene === 3 && (
            <div className="ao-sides" role="group" aria-label="Card side">
              {(['front', 'back'] as const).map((value) => (
                <button key={value} type="button" aria-pressed={side === value} onClick={() => setSide(value)}>
                  {value === 'front' ? 'Front' : 'Back'}
                </button>
              ))}
            </div>
          )}

          <div className="ao-controls">
            {scene < 3 ? (
              <>
                <button type="button" className="ao-icon" onClick={() => go((scene - 1) as Scene)} disabled={scene === 0} aria-label="Previous scene">
                  <ChevronLeft size={18} aria-hidden="true" />
                </button>
                <ol className="ao-progress" aria-label="Welcome">
                  {SCENES.map((label, i) => (
                    <li key={label}>
                      <button
                        type="button"
                        aria-current={i === scene ? 'step' : undefined}
                        aria-label={`Scene ${i + 1} of ${SCENES.length}: ${label}`}
                        data-done={i < scene || undefined}
                        data-playing={(i === scene && autoplay) || undefined}
                        onClick={() => go(i as Scene)}
                      >
                        <span />
                      </button>
                    </li>
                  ))}
                </ol>
                <button type="button" className="ao-button ao-button-small" onClick={() => go((scene + 1) as Scene)}>
                  {scene === 2 ? 'Explore' : 'Continue'} <ChevronRight size={16} aria-hidden="true" />
                </button>
                {!reduced && (
                  <button type="button" className="ao-icon" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause the welcome' : 'Play the welcome'}>
                    {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                  </button>
                )}
                <button type="button" className="ao-skip" onClick={finishIntro}>
                  Skip intro
                </button>
              </>
            ) : (
              <button type="button" className="ao-skip" onClick={replay}>
                <RotateCcw size={14} aria-hidden="true" /> Replay intro
              </button>
            )}
          </div>
        </section>

        {/* ------------------------------------------------- features */}
        <section id="ao-features" className="ao-section" aria-labelledby="ao-features-title" tabIndex={-1}>
          <header className="ao-head">
            <p className="ao-kicker">SHYGON OS</p>
            <h2 id="ao-features-title">One card. A world of possibilities.</h2>
            <p className="ao-lede">Explore the experiences AAROH can bring together through SHYGON OS.</p>
          </header>
          <FeatureShowcase edition={edition} finish={finish.id} />
        </section>

        {/* ---------------------------------------------- owner control */}
        <section id="ao-owner" className="ao-section" aria-labelledby="ao-owner-title">
          <header className="ao-head">
            <p className="ao-kicker">Ownership</p>
            <h2 id="ao-owner-title">Your card. Your settings. Your choice.</h2>
            <p className="ao-lede">
              The edition is the card in your hand, chosen here. What it opens and who sees what, you manage in your SHYGON
              account. Looking around the store changes neither.
            </p>
          </header>
          <ol className="ao-flow">
            {ownerSteps.map((step, i) => (
              <li key={step.title} style={{ '--i': i } as React.CSSProperties}>
                <span className="ao-flow-number" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <span className={`fs-status fs-status-${step.status}`}>{STATUS_LABEL[step.status]}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------------------------------------------------- privacy */}
        <section id="ao-privacy" className="ao-section ao-privacy" aria-labelledby="ao-privacy-title">
          <header className="ao-head">
            <p className="ao-kicker">Privacy</p>
            <h2 id="ao-privacy-title">One tap does not mean unlimited access.</h2>
          </header>
          <ul className="ao-privacy-list">
            {PRIVACY_POINTS.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>

        {/* --------------------------------------------- edition story */}
        <section id="ao-story" className="ao-section" aria-labelledby="ao-story-title">
          <header className="ao-head">
            <p className="ao-kicker">Edition {edition.number} · {edition.finishLine}</p>
            <h2 id="ao-story-title">{edition.title}</h2>
            <p className="ao-lede">{edition.description}</p>
          </header>
          <div className="ao-story">
            <AarohCard edition={edition} finish={finish.id} side="back" sizes="(max-width: 720px) 88vw, 460px" className="ac-still" />
            <dl className="ao-facts">
              <div><dt>Printed texture</dt><dd>{edition.printed}</dd></div>
              <div><dt>Premium Finish</dt><dd>{edition.physical}</dd></div>
              <div><dt>Standard</dt><dd>{edition.simplify}</dd></div>
              <div><dt>Surface</dt><dd>{edition.surface}</dd></div>
              <div><dt>Edge</dt><dd>{edition.edge}</dd></div>
              <div>
                <dt>Colours</dt>
                <dd>
                  <span className="ec-swatches" aria-hidden="true">
                    {edition.colours.map((hex) => <i key={hex} style={{ background: hex }} />)}
                  </span>
                  {' '}{edition.colours.join(', ')}
                </dd>
              </div>
            </dl>
          </div>
          <p className="ao-note">
            Concept renders of the card as it will be printed, in landscape with the official SHYGON logo. On the back, the
            QR code is a placeholder and the serial and chapter are examples. Materials, finishes and the NFC construction
            are being validated with our card manufacturer.
          </p>
        </section>

        {/* -------------------------------------------------- selection */}
        <section id="ao-choose" className="ao-section ao-choose" aria-labelledby="ao-choose-title" tabIndex={-1}>
          <header className="ao-head">
            <p className="ao-kicker">Your edition</p>
            <h2 id="ao-choose-title">Choose AAROH {edition.title}</h2>
          </header>
          <div className="ao-choose-grid">
            <AarohCard edition={edition} finish={finish.id} side="front" sizes="(max-width: 720px) 88vw, 420px" className="ac-still" />
            <div className="ao-choose-panel">
              <h3 className="ao-label" id="ao-finish-label">Finish</h3>
              <FinishPicker
                selected={finish}
                onSelect={onFinish}
                labelledBy="ao-finish-label"
                priceFor={(item) => inr(aarohPrice(catalog, edition.id, item))}
              />
              <p className="ao-finish-note">{finish.description}</p>
              <div className="ao-price">
                <span>AAROH {edition.title}, {finish.title}</span>
                <strong>{inr(unitPrice)}</strong>
                <small>Per card, paid once. Your digital experience is a separate choice.</small>
              </div>
              {buyable ? (
                <div className="ao-purchase">
                  <div className="aaroh-quantity" role="group" aria-label="Number of cards">
                    <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="One card fewer">
                      <Minus size={16} aria-hidden="true" />
                    </button>
                    <output aria-live="polite">{quantity}</output>
                    <button type="button" onClick={() => setQuantity((q) => Math.min(MAX_RETAIL_QUANTITY, q + 1))} disabled={quantity >= MAX_RETAIL_QUANTITY} aria-label="One card more">
                      <Plus size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <button type="button" className="ao-button ao-button-primary" onClick={() => onBuy(quantity)}>
                    Choose {edition.title}
                  </button>
                </div>
              ) : CARD_SALES_OPEN ? (
                <p className="ao-note" role="status">This option is not in stock yet. Choose another finish or edition, or check back soon.</p>
              ) : (
                <>
                  <CardsComingSoon className="ao-soon" />
                  <p className="ao-note">Delivery and tax terms are published before card sales open.</p>
                </>
              )}
              <button type="button" className="ao-button" onClick={() => onClose()}>
                Explore all editions
              </button>
              <p className="ao-note">
                You choose your digital experience and what people see after you activate your card, in your SHYGON account.
                Ordering {AAROH_BULK_MINIMUM} or more?{' '}
                <button type="button" className="ao-inline" onClick={() => onClose('teams')}>
                  Request a quotation
                </button>
              </p>
            </div>
          </div>
        </section>
      </div>
    </dialog>
  );
}
