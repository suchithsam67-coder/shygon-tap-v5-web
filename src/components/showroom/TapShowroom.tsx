import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  DoorClosed,
  GraduationCap,
  Handshake,
  KeyRound,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Share2,
  ShieldAlert,
  Undo2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import BrandMark from '../brand/BrandMark';
import type { PublicProfile } from '../../lib/database.types';
import { AVAILABILITY_LABEL, MODES, openButtonId, type Availability, type ModeId } from './modes';
import { linkList, subtitleOf, whatsappNumber } from './profileParts';

/**
 * The AAROH showroom: one card per mode, in a row that scrolls sideways and
 * snaps, so a visitor browses what this card can do like a small collection.
 *
 * Every card is honest about itself. A live card shows real data and real
 * actions (a Call button calls). A planned card says it is planned and has no
 * button. Only the demo showroom ever shows anything but live cards; a real
 * person's Tap lists only what they have published (see modes.ts).
 *
 * Touch: swipe; the rail snaps. Mouse: the arrows or the dots. Keyboard: Tab
 * into a card, then Left/Right (or Home/End) moves between cards.
 */

const ICONS: Record<ModeId, LucideIcon> = {
  identity: UserRound,
  business: Briefcase,
  contact: Phone,
  links: Link2,
  owner: KeyRound,
  emergency: ShieldAlert,
  cloud: Cloud,
  prive: Building2,
  verify: BadgeCheck,
  access: DoorClosed,
  return: Undo2,
  connect: Handshake,
  student: GraduationCap,
  events: CalendarDays,
  places: MapPin,
};

/** Beyond this many cards the dots would wrap on a phone; a count replaces them. */
const MAX_DOTS = 7;

const OPEN_LABEL: Partial<Record<ModeId, string>> = {
  identity: 'Open profile',
  business: 'Business details',
  contact: 'All contact options',
  links: 'Open links',
  owner: 'Owner access',
  emergency: 'Alert their contacts',
  return: 'Message the owner',
  prive: 'Try the demo',
};

export function TapShowroom({
  data,
  modes,
  demo = false,
  canOpen,
  returnTo,
  entering = false,
  onOpen,
  onLinkClick,
  onShare,
}: {
  data: PublicProfile;
  modes: readonly ModeId[];
  demo?: boolean;
  /** Whether a mode has a view to open here. */
  canOpen: (id: ModeId) => boolean;
  /** The card to bring back into view and focus: the one just closed. */
  returnTo?: ModeId | null;
  /** Cards rise in one after another, as the opening lifts. */
  entering?: boolean;
  onOpen: (id: ModeId) => void;
  onLinkClick?: (key: string) => void;
  onShare?: () => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, returnTo ? modes.indexOf(returnTo) : 0));
  const frame = useRef(0);

  const cardAt = (index: number) => railRef.current?.children[index] as HTMLElement | undefined;

  const scrollToCard = useCallback((index: number, smooth: boolean) => {
    const rail = railRef.current;
    const card = rail?.children[index] as HTMLElement | undefined;
    if (!rail || !card) return;
    const left = card.offsetLeft - (rail.clientWidth - card.clientWidth) / 2;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof rail.scrollTo === 'function') {
      rail.scrollTo({ left, behavior: smooth && !reduced ? 'smooth' : 'auto' });
    } else {
      rail.scrollLeft = left;
    }
  }, []);

  const go = (index: number) => {
    const next = Math.min(modes.length - 1, Math.max(0, index));
    setActive(next);
    scrollToCard(next, true);
    cardAt(next)?.focus({ preventScroll: true });
  };

  // Back from a mode: the card that was opened is centred and its button focused.
  useEffect(() => {
    if (!returnTo) return;
    const index = modes.indexOf(returnTo);
    if (index < 0) return;
    scrollToCard(index, false);
    document.getElementById(openButtonId(returnTo))?.focus({ preventScroll: true });
    // Only on mount: the card to return to is fixed for this visit to the showroom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which card is centred, from the scroll position (cheap; one read per frame).
  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rail = railRef.current;
      if (!rail) return;
      const centre = rail.scrollLeft + rail.clientWidth / 2;
      let best = 0;
      let distance = Infinity;
      Array.from(rail.children).forEach((child, index) => {
        const el = child as HTMLElement;
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - centre);
        if (d < distance) {
          distance = d;
          best = index;
        }
      });
      setActive(best);
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowRight: active + 1,
      ArrowLeft: active - 1,
      Home: 0,
      End: modes.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    go(keys[event.key]!);
  };

  const subtitle = subtitleOf(data);
  const count = modes.length;

  return (
    <div className={`sr ${entering ? 'is-entering' : ''}`.trim()}>
      <header className="sr-head">
        <span className="sr-brand">
          <BrandMark className="sr-brand-mark" />
          <span>
            SHYGON <b>AAROH</b>
          </span>
        </span>
        {onShare && (
          <button type="button" className="sr-icon" onClick={onShare} aria-label="Share this Tap">
            <Share2 size={18} aria-hidden="true" />
          </button>
        )}
      </header>

      <div className="sr-intro">
        <h1 className="sr-name">{data.displayName || 'SHYGON Tap'}</h1>
        {subtitle && <p className="sr-sub">{subtitle}</p>}
        <p className="sr-hint" id="sr-hint">
          {demo
            ? 'Every AAROH mode, with what works today and what is still to come.'
            : `${count} ${count === 1 ? 'experience' : 'experiences'} on this card. Swipe to explore.`}
        </p>
      </div>

      <section className="sr-stage" aria-roledescription="carousel" aria-label="AAROH showroom" aria-describedby="sr-hint">
        <div className="sr-rail" ref={railRef} onScroll={onScroll} onKeyDown={onKeyDown}>
          {modes.map((id, index) => (
            <ShowroomCard
              key={id}
              id={id}
              index={index}
              total={modes.length}
              active={index === active}
              data={data}
              demo={demo}
              openable={canOpen(id)}
              onOpen={() => onOpen(id)}
              onLinkClick={onLinkClick}
            />
          ))}
        </div>

        <div className="sr-nav">
          <button type="button" className="sr-arrow" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Previous card">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          {modes.length <= MAX_DOTS ? (
            <div className="sr-dots" role="group" aria-label="Choose a card">
              {modes.map((id, index) => (
                <button
                  key={id}
                  type="button"
                  className="sr-dot"
                  aria-label={`Show ${MODES[id].name}`}
                  aria-current={index === active ? 'true' : undefined}
                  onClick={() => go(index)}
                />
              ))}
            </div>
          ) : (
            // Too many cards for dots on a phone: a count instead. Each card
            // already announces "n of total" to assistive technology.
            <span className="sr-count" aria-hidden="true">
              {active + 1} / {modes.length}
            </span>
          )}
          <button
            type="button"
            className="sr-arrow"
            onClick={() => go(active + 1)}
            disabled={active === modes.length - 1}
            aria-label="Next card"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}

function ShowroomCard({
  id,
  index,
  total,
  active,
  data,
  demo,
  openable,
  onOpen,
  onLinkClick,
}: {
  id: ModeId;
  index: number;
  total: number;
  active: boolean;
  data: PublicProfile;
  demo: boolean;
  openable: boolean;
  onOpen: () => void;
  onLinkClick?: (key: string) => void;
}) {
  const mode = MODES[id];
  const Icon = ICONS[id];
  const titleId = `sr-title-${id}`;
  const track = (key: string) => () => onLinkClick?.(key);
  const whatsapp = whatsappNumber(data);
  // On a real Tap every card shown is available (modes.ts decides which are shown,
  // and Emergency only when the server says so). The demo keeps each mode's
  // customer status, with sample data for the available ones.
  const status: Availability = demo ? mode.availability : 'available';
  const walkthrough = demo && mode.demoWalkthrough;

  return (
    <div
      className={`sr-card ${active ? 'is-active' : ''}`.trim()}
      data-mode={id}
      data-status={status}
      style={{ '--i': index } as React.CSSProperties}
      tabIndex={-1}
      role="group"
      aria-roledescription="slide"
      aria-label={`${mode.name}, ${index + 1} of ${total}`}
    >
      <span className="sr-card-art" aria-hidden="true">
        <Icon size={120} strokeWidth={1} />
      </span>
      <div className="sr-card-top">
        <span className="sr-card-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className={`sr-status sr-status-${status}`}>{AVAILABILITY_LABEL[status]}</span>
      </div>
      <h2 className="sr-card-title" id={titleId}>
        {mode.name}
      </h2>
      <p className="sr-card-tagline">{mode.tagline}</p>

      <div className="sr-card-body">
        {id === 'identity' && (
          <div className="sr-identity">
            <span className="sr-avatar" aria-hidden="true">
              {data.avatarUrl ? <img src={data.avatarUrl} alt="" /> : (data.displayName ?? 'S').slice(0, 1).toUpperCase()}
            </span>
            <span className="sr-identity-text">
              <strong>{data.displayName || 'SHYGON Tap'}</strong>
              {data.headline && <span>{data.headline}</span>}
            </span>
          </div>
        )}

        {(id === 'identity' || id === 'contact') && (
          <div className="sr-quick">
            {data.phone && (
              <a className="sr-quick-btn" href={`tel:${data.phone}`} onClick={track('phone')}>
                <Phone size={15} aria-hidden="true" /> Call
              </a>
            )}
            {whatsapp && (
              <a className="sr-quick-btn" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" onClick={track('whatsapp')}>
                <MessageCircle size={15} aria-hidden="true" /> WhatsApp
              </a>
            )}
            {id === 'contact' && data.email && (
              <a className="sr-quick-btn" href={`mailto:${data.email}`} onClick={track('email')}>
                <Mail size={15} aria-hidden="true" /> Email
              </a>
            )}
          </div>
        )}

        {id === 'business' && (
          <dl className="sr-facts">
            {data.designation && (
              <div>
                <dt>Role</dt>
                <dd>{data.designation}</dd>
              </div>
            )}
            {data.company && (
              <div>
                <dt>Company</dt>
                <dd>{data.company}</dd>
              </div>
            )}
            {data.location && (
              <div>
                <dt>Based in</dt>
                <dd>{data.location}</dd>
              </div>
            )}
          </dl>
        )}

        {id === 'links' && (
          <ul className="sr-chips">
            {linkList(data)
              .slice(0, 4)
              .map((link) => (
                <li key={link.key}>{link.label}</li>
              ))}
          </ul>
        )}

        {id === 'owner' && (
          <p className="sr-note">
            Only {data.displayName ? data.displayName.split(/\s+/)[0] : 'the owner'} can change this card, from their own signed-in
            SHYGON account. A tap never signs anyone in.
          </p>
        )}

        {status !== 'available' && mode.note && <p className="sr-note">{mode.note}</p>}
        {!demo && id === 'connect' && (
          <p className="sr-note">Share your details with {data.displayName?.trim() || 'the owner'}, with consent. You need a SHYGON account.</p>
        )}
        {!demo && id === 'return' && (
          <p className="sr-note">Found this card? Message the owner through SHYGON. You will not see their details.</p>
        )}
        {!demo && id === 'emergency' && (
          <p className="sr-note">You will not see who they are. SHYGON never contacts emergency services.</p>
        )}
        {walkthrough && (
          <p className="sr-demo-chip">
            <span>Demo</span> A walkthrough that sends nothing.
          </p>
        )}
      </div>

      {!demo && id === 'connect' && (
        // Asking needs a signed-in account: the normal sign-in, then the request page.
        <Link className="sr-open" to={`/shygontap/connect/${data.slug}`}>
          Ask to connect <ArrowRight size={15} aria-hidden="true" />
        </Link>
      )}
      {openable && (
        <button type="button" className="sr-open" id={openButtonId(id)} onClick={onOpen}>
          {walkthrough ? 'Try the demo' : (OPEN_LABEL[id] ?? 'Open')} <ArrowRight size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
