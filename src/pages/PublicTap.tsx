import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CreditCard, Loader2, PauseCircle, SearchX, WifiOff } from 'lucide-react';
import { TapExperience } from '../components/tap/TapExperience';
import { loadCardOpening } from '../components/tap/cardOpeningLoader';
import {
  fetchPublicCard,
  fetchPublicPageCard,
  fetchPublicProfile,
  fetchPublicTapState,
  recordCardTap,
  recordTapEvent,
  resolveTapAlias,
} from '../lib/publicTapClient';
import type { CardLook, PublicCard, PublicProfile, PublicTapState } from '../lib/database.types';
// Type-only: the builders in seo/meta carry the product catalogue, which the
// public Tap bundle must not include.
import type { PageMeta } from '../seo/meta';
import { usePageMeta } from '../seo/usePageMeta';

/**
 * The public Tap page — what a visitor sees after an NFC tap or a QR scan.
 *
 * All of it comes from `get_public_profile()`, a SECURITY DEFINER function that
 * returns whitelisted fields for an active Tap only, already clamped to what
 * the customer actually owns. This component never queries `tap_profiles`
 * directly, so there is no query here that could be broadened into leaking
 * `user_id`, an order, or any other private record — and no entitlement logic
 * of its own, so it cannot upgrade itself.
 *
 * When a Tap does not resolve, `get_public_tap_state()` says why in terms that
 * are safe to show a stranger: a paused Tap reads as temporarily unavailable,
 * while a draft, archived, suspended or non-existent one is simply unavailable.
 */

/** Search-result length; longer text is cut at a word boundary. */
function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 80 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

/** The tab title and share preview for a customer's Tap. */
function tapMeta(data: PublicProfile): PageMeta {
  const name = data.displayName?.trim() || 'SHYGON Tap profile';
  const role = [data.designation, data.company].filter(Boolean).join(' at ');
  return {
    title: `${name} | SHYGON Tap`,
    description: clip(data.headline || data.bio || role || `Connect with ${name} on SHYGON Tap.`),
    path: `/shygontap/${data.slug}`,
    type: 'profile',
    image: data.avatarUrl ?? undefined,
    imageAlt: name,
  };
}

type Outcome =
  | { kind: 'loading' }
  | { kind: 'tap'; data: PublicProfile; card: CardLook | null }
  | { kind: 'state'; state: PublicTapState }
  | { kind: 'card'; state: Exclude<PublicCard['state'], 'active' | 'paused' | 'unavailable'> }
  | { kind: 'moved'; slug: string }
  | { kind: 'offline' }
  | { kind: 'error' };

export default function PublicTap({ slug: slugProp }: { slug?: string } = {}) {
  // /t/<slug> (a page's address, what the QR encodes) or /c/<Card ID> (one
  // card's own link, what a new card's NFC chip encodes — migration 022).
  const params = useParams();
  // /shygontap/<name> is matched in App.tsx and passes the name in.
  const slug = slugProp ?? params.username;
  const code = slugProp ? undefined : params.code;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [outcome, setOutcome] = useState<Outcome>(() =>
    slug || code ? { kind: 'loading' } : { kind: 'state', state: 'unavailable' },
  );
  const [attempt, setAttempt] = useState(0);
  const viewLogged = useRef(false);

  usePageMeta(
    useMemo<PageMeta | null>(() => {
      if (outcome.kind === 'tap') return tapMeta(outcome.data);
      if (outcome.kind === 'loading') return null;
      // Paused, missing or failed to load: nothing here should be indexed.
      return {
        title: outcome.kind === 'state' && outcome.state === 'paused' ? 'Temporarily unavailable | SHYGON Tap' : 'Tap unavailable | SHYGON Tap',
        description: 'This SHYGON Tap profile is not available right now.',
        path: code ? `/c/${code}` : `/shygontap/${slug ?? ''}`,
        noindex: true,
      };
    }, [outcome, slug, code]),
  );

  /**
   * Resolves what this slug should render. Returns the outcome rather than
   * setting it, so the effect below owns the single write — which is also what
   * makes cancellation correct: a slow answer for a slug the visitor has
   * already navigated away from is discarded instead of overwriting the new one.
   */
  const resolve = useCallback(async (): Promise<Outcome> => {
    if (!slug && !code) return { kind: 'state', state: 'unavailable' };

    // Opened from a card: fetch the opening's chunk while the data loads.
    if (code || searchParams.get('src') === 'nfc') void loadCardOpening().catch(() => undefined);

    try {
      if (code) {
        // A card: ask what it opens, then read that page exactly as /t/ does,
        // through get_public_profile() and all of its clamps.
        const card = await fetchPublicCard(code);
        if (card.state === 'paused') return { kind: 'state', state: 'paused' };
        if (card.state === 'not_activated' || card.state === 'inactive') return { kind: 'card', state: card.state };
        if (card.state !== 'active' || !card.slug) return { kind: 'state', state: 'unavailable' };
        const result = await fetchPublicProfile(card.slug);
        if (result) {
          return {
            kind: 'tap',
            data: result,
            card: card.design ? { design: card.design, material: card.material, finish: card.finish } : null,
          };
        }
        try {
          return { kind: 'state', state: await fetchPublicTapState(card.slug) };
        } catch {
          return { kind: 'state', state: 'unavailable' };
        }
      }

      const page = slug!;
      // A chip written before Card IDs opens /t/<slug>?src=nfc: it still gets
      // its card's opening, looked up alongside the page.
      const [result, look] = await Promise.all([
        fetchPublicProfile(page),
        searchParams.get('src') === 'nfc' ? fetchPublicPageCard(page).catch(() => null) : Promise.resolve(null),
      ]);
      if (result) return { kind: 'tap', data: result, card: look };

      // An address the page used to have still works: send the visitor on.
      const current = await resolveTapAlias(page).catch(() => null);
      if (current && current.toLowerCase() !== page.toLowerCase()) return { kind: 'moved', slug: current };

      // Not live. Ask why, so a paused Tap does not read as a dead link.
      try {
        return { kind: 'state', state: await fetchPublicTapState(page) };
      } catch {
        return { kind: 'state', state: 'unavailable' };
      }
    } catch {
      // A failed round trip is a connection problem, not a missing Tap, and
      // saying "this Tap does not exist" to someone holding the card would be
      // both wrong and alarming.
      return { kind: navigator.onLine === false ? 'offline' : 'error' };
    }
    // searchParams is read once per landing; re-resolving on every change of
    // the query string would replay the opening for nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, code]);

  // An old address: replace it in the history with the page's current one.
  useEffect(() => {
    if (outcome.kind !== 'moved') return;
    navigate(`/shygontap/${outcome.slug}${location.search}`, { replace: true });
  }, [outcome, navigate, location.search]);

  useEffect(() => {
    viewLogged.current = false;
    let cancelled = false;
    const load = () => {
      void resolve().then((next) => {
        if (!cancelled) setOutcome(next);
      });
    };
    load();
    const timer = window.setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [resolve, attempt]);

  /** Retry is a click, so resetting to the loading state here is fine. */
  const retry = useCallback(() => {
    setOutcome({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  // Exactly one 'view' per landing, plus an 'nfc'/'qr' event when the physical
  // card or a QR scan added the matching query parameter.
  useEffect(() => {
    if (outcome.kind !== 'tap' || viewLogged.current) return;
    viewLogged.current = true;

    // Opened by a card: the view and the tap are counted against that card.
    if (code) {
      void recordCardTap(code, 'view');
      void recordCardTap(code, 'nfc');
      return;
    }
    if (!slug) return;
    void recordTapEvent(slug, 'view');
    const source = searchParams.get('src');
    if (source === 'nfc') void recordTapEvent(slug, 'nfc');
    else if (source === 'qr') void recordTapEvent(slug, 'qr');
  }, [slug, code, outcome.kind, searchParams]);

  if (outcome.kind === 'loading' || outcome.kind === 'moved') {
    return (
      <div className="tap-state-page">
        <div>
          <div className="tap-state-icon">
            <Loader2 size={24} className="spin" />
          </div>
          <p style={{ letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 12 }}>
            Loading Tap…
          </p>
        </div>
      </div>
    );
  }

  if (outcome.kind === 'offline') {
    return (
      <TapStatePage
        icon={<WifiOff size={24} />}
        title="You're offline"
        message="We couldn't load this Tap because your device has no connection. Reconnect and try again."
        onRetry={retry}
      />
    );
  }

  if (outcome.kind === 'error') {
    return (
      <TapStatePage
        icon={<WifiOff size={24} />}
        title="We couldn't load this Tap"
        message="Something went wrong on our side. Please try again in a moment."
        onRetry={retry}
      />
    );
  }

  if (outcome.kind === 'card') {
    return outcome.state === 'not_activated' ? (
      <TapStatePage
        icon={<CreditCard size={24} />}
        title="This card isn't active yet"
        message="Its owner hasn't activated it. Once they do, tapping it opens their SHYGON Tap."
      />
    ) : (
      <TapStatePage
        icon={<CreditCard size={24} />}
        title="This card is no longer active"
        message="The owner has switched this card off. Ask them for their current link."
      />
    );
  }

  if (outcome.kind === 'state') {
    return outcome.state === 'paused' ? (
      <TapStatePage
        icon={<PauseCircle size={24} />}
        title="Temporarily unavailable"
        message="The owner has paused this Tap. It should be back shortly."
      />
    ) : (
      <TapStatePage
        icon={<SearchX size={24} />}
        title="Tap not found"
        message="This Tap is not available. Check the link on your card, or ask the owner to share it again."
      />
    );
  }

  const tap = outcome.data;
  const openedFrom = outcome.card;

  async function share() {
    // Share the page's own address, not the card link: a card can be switched
    // off, the page's address stays.
    const url = code ? new URL(`/shygontap/${tap.slug}`, window.location.origin).href : window.location.href;
    const title = tap.displayName ?? 'SHYGON Tap';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* share sheet dismissed — fall through to the clipboard */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* clipboard blocked; the address bar still has the link */
    }
  }

  return (
    <TapExperience
      data={tap}
      card={openedFrom}
      onShare={() => void share()}
      onLinkClick={(key) => {
        if (code) void recordCardTap(code, 'link_click', key);
        else if (slug) void recordTapEvent(slug, 'link_click', key);
      }}
    />
  );
}

function TapStatePage({
  icon,
  title,
  message,
  onRetry,
}: {
  icon: React.ReactNode;
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="tap-state-page">
      <div>
        <div className="tap-state-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{message}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            style={{
              marginTop: 24,
              padding: '12px 22px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,.2)',
              background: 'rgba(255,255,255,.1)',
              color: '#fff',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        ) : (
          <a href="/shygontap">What is SHYGON Tap?</a>
        )}
      </div>
    </div>
  );
}
