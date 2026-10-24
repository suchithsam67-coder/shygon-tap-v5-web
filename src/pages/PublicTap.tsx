import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { matchPath, useParams, useSearchParams } from 'react-router-dom';
import { Loader2, PauseCircle, SearchX, WifiOff } from 'lucide-react';
import { fetchPublicProfile, fetchPublicTapState, recordTapEvent } from '../lib/publicTapClient';
import type { PublicProfile, PublicTapState } from '../lib/database.types';
// Type-only: the builders in seo/meta carry the product catalogue, which the
// public Tap bundle must not include.
import type { PageMeta } from '../seo/meta';
import { usePageMeta } from '../seo/usePageMeta';
import { OPENING_MS, TapOpening } from '../components/showroom/TapOpening';

/**
 * The AAROH experience (opening, showroom, modes, the profile card) is its own
 * chunk, kept out of the entry bundle (DEC-2026-019 budget). Its download
 * starts ahead of the profile request, so by the time the profile arrives the
 * chunk usually has too: as the entry bundle runs when the page was opened at
 * a Tap address, otherwise on this page's first render. Never for any other
 * page: this module is in the entry bundle, and the landing page, among
 * others, would download the experience and its icons for nothing.
 */
const loadExperience = () => import('../components/showroom/PublicExperience');
let experienceChunk: ReturnType<typeof loadExperience> | undefined;
/** Starts the download once; every later call shares it. */
function startExperience() {
  if (!experienceChunk) {
    experienceChunk = loadExperience();
    // A failed early download is retried once when the page needs the chunk.
    experienceChunk.catch(() => undefined);
  }
  return experienceChunk;
}
const PublicExperience = lazy(() => startExperience().catch(loadExperience));
// Opened at a Tap address (the card, a QR scan): start now rather than wait
// for React's first render. These are the paths App.tsx routes here; one
// missing from this list only loses the head start.
if (['/t/:username', '/tap/:username'].some((path) => matchPath(path, window.location.pathname))) {
  startExperience();
}

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
    path: `/t/${data.slug}`,
    type: 'profile',
    image: data.avatarUrl ?? undefined,
    imageAlt: name,
  };
}

type Outcome =
  | { kind: 'loading' }
  | { kind: 'tap'; data: PublicProfile }
  | { kind: 'state'; state: PublicTapState }
  | { kind: 'offline' }
  | { kind: 'error' };

export default function PublicTap() {
  // When the address check above did not start it, as after an in-app
  // navigation here. In render, not an effect: the download is under way
  // before the profile request this render's effect sends.
  startExperience();
  const { username: slug } = useParams();
  const [searchParams] = useSearchParams();

  const [outcome, setOutcome] = useState<Outcome>(() =>
    slug ? { kind: 'loading' } : { kind: 'state', state: 'unavailable' },
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
        path: `/t/${slug ?? ''}`,
        noindex: true,
      };
    }, [outcome, slug]),
  );

  /**
   * Resolves what this slug should render. Returns the outcome rather than
   * setting it, so the effect below owns the single write — which is also what
   * makes cancellation correct: a slow answer for a slug the visitor has
   * already navigated away from is discarded instead of overwriting the new one.
   */
  const resolve = useCallback(async (): Promise<Outcome> => {
    if (!slug) return { kind: 'state', state: 'unavailable' };

    try {
      const result = await fetchPublicProfile(slug);
      if (result) return { kind: 'tap', data: result };

      // Not live. Ask why, so a paused Tap does not read as a dead link.
      try {
        return { kind: 'state', state: await fetchPublicTapState(slug) };
      } catch {
        return { kind: 'state', state: 'unavailable' };
      }
    } catch {
      // A failed round trip is a connection problem, not a missing Tap, and
      // saying "this Tap does not exist" to someone holding the card would be
      // both wrong and alarming.
      return { kind: navigator.onLine === false ? 'offline' : 'error' };
    }
  }, [slug]);

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
    if (!slug || outcome.kind !== 'tap' || viewLogged.current) return;
    viewLogged.current = true;

    void recordTapEvent(slug, 'view');
    const source = searchParams.get('src');
    if (source === 'nfc') void recordTapEvent(slug, 'nfc');
    else if (source === 'qr') void recordTapEvent(slug, 'qr');
  }, [slug, outcome.kind, searchParams]);

  // The SHYGON opening is also the loading state (FE-D1): it paints from the
  // first frame, plays while the profile and the experience chunk arrive, and
  // lifts once both are ready and the reveal has played. An owner who turned
  // their opening off, a link to a mode, a state page or a failure lifts it as
  // soon as there is something to show. Never under reduced motion.
  const [curtain, setCurtain] = useState(
    () => !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  const [chunkReady, setChunkReady] = useState(false);
  useEffect(() => {
    let live = true;
    // Ready either way: a failed chunk is retried by the lazy loader below.
    const done = () => live && setChunkReady(true);
    startExperience().then(done, done);
    return () => {
      live = false;
    };
  }, []);
  const ready = outcome.kind !== 'loading' && (outcome.kind !== 'tap' || chunkReady);
  const minMs = outcome.kind === 'tap' && outcome.data.theme.animation !== 'none' && !searchParams.get('mode') ? OPENING_MS : 0;

  return (
    <>
      <TapOutcome outcome={outcome} slug={slug} retry={retry} />
      {curtain && <TapOpening ready={ready} minMs={minMs} caption="One card. Many possibilities." onDone={() => setCurtain(false)} />}
    </>
  );
}

function TapOutcome({ outcome, slug, retry }: { outcome: Outcome; slug: string | undefined; retry: () => void }) {
  if (outcome.kind === 'loading') return <TapLoading />;

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

  async function share() {
    const url = window.location.href;
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
    <Suspense fallback={<TapLoading />}>
      <PublicExperience
        data={tap}
        opening={false}
        onShare={() => void share()}
        onLinkClick={(key) => {
          if (slug) void recordTapEvent(slug, 'link_click', key);
        }}
      />
    </Suspense>
  );
}

function TapLoading() {
  return (
    <main className="tap-state-page">
      <div>
        <div className="tap-state-icon">
          <Loader2 size={24} className="spin" />
        </div>
        <p style={{ letterSpacing: '0.2em', textTransform: 'uppercase', fontSize: 12 }}>Loading Tap…</p>
      </div>
    </main>
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
    <main className="tap-state-page">
      <div>
        <div className="tap-state-icon">{icon}</div>
        <h1>{title}</h1>
        <p>{message}</p>
        {onRetry ? (
          <button type="button" className="tap-state-button" onClick={onRetry}>
            Try again
          </button>
        ) : (
          <a href="/shygontap">What is SHYGON Tap?</a>
        )}
      </div>
    </main>
  );
}
