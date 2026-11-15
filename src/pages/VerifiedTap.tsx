import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { BadgeCheck, Clock, ShieldAlert, WifiOff } from 'lucide-react';
import PublicTap, { TapLoading, TapNotFound, TapStatePage } from './PublicTap';
import { VERIFY_CODE, VerifyError, sunFrom, verifyTap, type Edition, type Verdict, type VerifyAnswer } from '../lib/publicVerifyClient';
import type { PageMeta } from '../seo/meta';
import { usePageMeta } from '../seo/usePageMeta';
import { TapToActivate } from '../components/TapToActivate';
import './verified-tap.css';

/**
 * A verified tap, `/d/<code>?e=…&c=…` (AAROH-API v0.11 §10d, DEC-2026-043):
 * the address an AAROH card's secure chip writes on every tap.
 *
 * - The check runs in the browser, after the page has loaded and is on
 *   screen, never while it is prerendered or previewed: a check is consumed
 *   once, and a link preview must not use it up.
 * - `e` and `c` leave the address bar at once (`replaceState`), so a share, a
 *   bookmark or a copied address never carries them. The hosts also send this
 *   page with no referrer and no caching (netlify.toml, vercel.json).
 * - Then the Tap's normal page (Business, Info or Lost, from P-6) under the
 *   verdict line. A Tap in Lost mode shows its Lost page and no verdict.
 *
 * - v0.15 (DEC-2026-047): a card issued to an owner but not active yet answers
 *   with no Tap. Its page shows "This card isn't active yet", never the
 *   owner's Tap, and a genuine tap lets its signed-in owner activate it
 *   (TapToActivate). A card reported stolen answers 404: "Tap not found".
 *
 * While SHYGON has VERIFIED_TAP off, every check answers 404, so the visitor
 * gets the neutral "Tap not found". The verdict words are DRAFT (DEC-2026-043
 * Q4); the owner approves them at the frontend gate.
 */

const VERDICT_COPY: Record<Exclude<Verdict, 'not_verified'>, { text: string; tone: 'ok' | 'caution' }> = {
  genuine: { text: "Verified tap. This card's secure tap was accepted.", tone: 'ok' },
  already_checked: { text: "We couldn't confirm this tap as new. Please tap the card again.", tone: 'caution' },
  not_confirmed: { text: "We couldn't verify this tap. Please tap the card again or contact SHYGON support.", tone: 'caution' },
  needs_service: { text: 'This card needs service. Please contact SHYGON.', tone: 'caution' },
  unavailable: { text: "Verification is temporarily unavailable. This tap hasn't been marked as verified.", tone: 'caution' },
};

/** "No. 037 of 100": the number padded to the edition size's digits. */
const editionLine = (edition: Edition) =>
  `No. ${String(edition.number).padStart(String(edition.of).length, '0')} of ${edition.of}`;

/** What a link preview or a search result shows: nothing of the card or its owner. */
const GENERIC_META: PageMeta = {
  title: 'SHYGON Tap',
  description: 'A SHYGON Tap card.',
  path: '/shygontap',
  noindex: true,
};

/**
 * One check per read. React may mount the page twice in development, and a
 * re-render must not ask again: a second check of the same read would answer
 * "already checked". A failed check is forgotten, so "Try again" asks again.
 */
const checks = new Map<string, Promise<VerifyAnswer>>();
function checkOnce(code: string, sun: { e: string; c: string } | null): Promise<VerifyAnswer> {
  const key = `${code}|${sun?.e ?? ''}|${sun?.c ?? ''}`;
  let check = checks.get(key);
  if (!check) {
    check = verifyTap(code, sun);
    checks.set(key, check);
    check.catch(() => checks.delete(key));
  }
  return check;
}

/** Runs `then` once the page has loaded and is on screen (not prerendered, not a hidden tab). Returns a cancel. */
function whenShown(then: () => void): () => void {
  let cancelled = false;
  const go = () => {
    if (!cancelled) then();
  };
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    go();
  };
  const onLoad = () => {
    if (document.visibilityState === 'visible') go();
    else document.addEventListener('visibilitychange', onVisible);
  };
  if (document.readyState === 'complete') onLoad();
  else window.addEventListener('load', onLoad, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener('load', onLoad);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

type Check = { kind: 'checking' } | { kind: 'done'; answer: VerifyAnswer } | { kind: 'failed'; error: VerifyError };

export default function VerifiedTap() {
  const { code = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Read once, on arrival: the address loses them in the effect below.
  const [sun] = useState(() => sunFrom(location.search));
  const valid = VERIFY_CODE.test(code);
  const [check, setCheck] = useState<Check>(() =>
    valid ? { kind: 'checking' } : { kind: 'failed', error: new VerifyError('Not found.', 404, 'unavailable') },
  );
  const [attempt, setAttempt] = useState(0);

  // The Tap's page sets its own; anything else, a card that is not active included, says nothing of the card.
  usePageMeta(check.kind === 'done' && check.answer.slug ? null : GENERIC_META);

  // e and c out of the address bar, keeping anything else it carries.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has('e') && !params.has('c')) return;
    params.delete('e');
    params.delete('c');
    const rest = params.toString();
    navigate({ pathname: location.pathname, search: rest ? `?${rest}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [location, navigate]);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    const cancel = whenShown(() => {
      checkOnce(code, sun).then(
        (answer) => live && setCheck({ kind: 'done', answer }),
        (failure: unknown) =>
          live && setCheck({ kind: 'failed', error: failure instanceof VerifyError ? failure : new VerifyError('Something went wrong.', 0, 'unknown') }),
      );
    });
    return () => {
      live = false;
      cancel();
    };
  }, [code, sun, valid, attempt]);

  const retry = () => {
    setCheck({ kind: 'checking' });
    setAttempt((n) => n + 1);
  };

  if (check.kind === 'checking') return <TapLoading />;
  if (check.kind === 'failed') return <CheckFailed error={check.error} retry={retry} />;

  const { answer } = check;
  if (answer.slug === null) return <TapToActivate verdict={answer.verdict} possession={answer.possession} />;
  return (
    <>
      {answer.verdict && answer.verdict !== 'not_verified' && <VerdictLine verdict={answer.verdict} edition={answer.edition} />}
      <PublicTap slug={answer.slug} />
    </>
  );
}

function VerdictLine({ verdict, edition }: { verdict: Exclude<Verdict, 'not_verified'>; edition: Edition | null }) {
  const copy = VERDICT_COPY[verdict];
  const Icon = copy.tone === 'ok' ? BadgeCheck : ShieldAlert;
  return (
    <div className={`vt-verdict vt-${copy.tone}`} role="status" data-testid="vt-verdict" data-verdict={verdict}>
      <Icon size={18} aria-hidden="true" />
      <p>
        <span>{copy.text}</span>
        {verdict === 'genuine' && edition && <span className="vt-edition">{editionLine(edition)}</span>}
      </p>
    </div>
  );
}

/** A check that got no verdict. Never a positive word: an unknown card reads like any missing Tap. */
function CheckFailed({ error, retry }: { error: VerifyError; retry: () => void }) {
  switch (error.code) {
    case 'rate_limited': {
      const minutes = Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60));
      return (
        <TapStatePage
          icon={<Clock size={24} />}
          title="Please try again later"
          message={`This card has been checked many times in a short while. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`}
        />
      );
    }
    case 'temporarily_unavailable':
      return (
        <TapStatePage
          icon={<ShieldAlert size={24} />}
          title="Verification is temporarily unavailable"
          message="This tap hasn't been marked as verified. Please try again in a moment."
          onRetry={retry}
        />
      );
    case 'network':
      return navigator.onLine === false ? (
        <TapStatePage
          icon={<WifiOff size={24} />}
          title="You're offline"
          message="We couldn't check this card because your device has no connection. Reconnect and try again."
          onRetry={retry}
        />
      ) : (
        <TapStatePage icon={<WifiOff size={24} />} title="We couldn't check this card" message="Please try again in a moment." onRetry={retry} />
      );
    case 'unavailable':
    case 'invalid_request':
    case 'unknown_op':
    case 'invalid_answer':
      return <TapNotFound />;
    default:
      return (
        <TapStatePage
          icon={<WifiOff size={24} />}
          title="We couldn't check this card"
          message="Something went wrong on our side. Please try again in a moment."
          onRetry={retry}
        />
      );
  }
}
