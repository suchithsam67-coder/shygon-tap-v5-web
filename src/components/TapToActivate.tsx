import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, Loader2, Nfc, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { CardsError, activateCardByTap, listOwnerCards, pairable } from '../services/cards';
import { cardsMessageOf } from '../lib/cardWords';
import type { Verdict } from '../lib/publicVerifyClient';

/**
 * "Tap to activate" (V01 T-08; AAROH-API v0.15 §10d and §7 C-7; DEC-2026-047).
 *
 * An AAROH card that is the owner's but not active yet answers /d/<code> with
 * no Tap. Its page never shows the owner's Tap. A genuine tap brings a
 * possession proof, and only the card's owner, signed in, can spend it: the
 * card in hand and the session together. A stolen session without the card,
 * or the card without the session, activates nothing.
 *
 * The page knows the tap's proof but not which of the owner's cards it is (the
 * list never carries the chip's code), so it tries the owner's cards that can
 * still be paired, in turn. A wrong card is refused (proof_mismatch) without
 * using the proof; the right one activates. The proof stays in memory only.
 * Customer wording is DRAFT for the owner's gate.
 */

type Step =
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; candidates: string[] }
  | { kind: 'activating'; candidates: string[] }
  | { kind: 'not-yours' }
  | { kind: 'done' }
  | { kind: 'problem'; text: string }
  | { kind: 'list-failed'; text: string };

/** Why a tap that is not genuine cannot activate, in our words. */
const NOT_GENUINE: Record<Exclude<Verdict, 'genuine'>, string> = {
  not_verified: 'To activate it, sign in to SHYGON on your phone, then tap the card on the phone.',
  already_checked: "We couldn't confirm this tap as new. Tap the card again to activate it.",
  not_confirmed: "We couldn't verify this tap. Tap the card again, or contact SHYGON support.",
  needs_service: 'This card needs service. Please contact SHYGON.',
  unavailable: "Verification is temporarily unavailable, so the card can't be activated right now. Please try again in a moment.",
};

const SIGN_IN = { pathname: '/shygontap/auth' } as const;

export function TapToActivate({ verdict, possession }: { verdict: Verdict | null; possession: string | null }) {
  const canActivate = verdict === 'genuine' && Boolean(possession);
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [attempt, setAttempt] = useState(0);

  // Who is signed in on this phone, and which of their cards can still be paired.
  useEffect(() => {
    if (!canActivate) return;
    let live = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return { kind: 'signed-out' } as Step;
      const { cards } = await listOwnerCards();
      const candidates = cards.filter(pairable).map((card) => card.id);
      return (candidates.length ? { kind: 'ready', candidates } : { kind: 'not-yours' }) as Step;
    })().then(
      (next) => live && setStep(next),
      (failure: unknown) => live && setStep({ kind: 'list-failed', text: cardsMessageOf(failure) }),
    );
    return () => {
      live = false;
    };
  }, [canActivate, attempt]);

  async function activate(candidates: string[]) {
    if (!possession) return;
    setStep({ kind: 'activating', candidates });
    for (const id of candidates) {
      try {
        await activateCardByTap(id, possession);
        setStep({ kind: 'done' });
        return;
      } catch (failure) {
        // Not this card: the proof is unused, so try the next one.
        if (failure instanceof CardsError && (failure.code === 'proof_mismatch' || failure.code === 'card_not_found')) continue;
        setStep({ kind: 'problem', text: cardsMessageOf(failure) });
        return;
      }
    }
    setStep({ kind: 'not-yours' });
  }

  if (canActivate && step.kind === 'done') {
    return (
      <main className="tap-state-page vt-pairing" data-testid="vt-pairing" data-state="done">
        <div>
          <div className="tap-state-icon vt-pair-ok">
            <BadgeCheck size={24} />
          </div>
          <h1>Card activated</h1>
          <p role="status">Tap it again to open your Tap.</p>
          <Link className="tap-state-button" to="/shygontap/cards">
            Your cards
          </Link>
        </div>
      </main>
    );
  }

  const state = canActivate ? step.kind : 'not-genuine';
  return (
    <main className="tap-state-page vt-pairing" data-testid="vt-pairing" data-state={state}>
      <div>
        <div className="tap-state-icon">{canActivate ? <Nfc size={24} /> : <ShieldAlert size={24} />}</div>
        <h1>This card isn&apos;t active yet</h1>
        {!canActivate && <p>{NOT_GENUINE[(verdict ?? 'unavailable') as Exclude<Verdict, 'genuine'>] ?? NOT_GENUINE.unavailable}</p>}

        {canActivate && step.kind === 'checking' && (
          <p className="vt-pair-wait" role="status">
            <Loader2 size={16} className="spin" aria-hidden="true" /> Checking your account…
          </p>
        )}

        {canActivate && step.kind === 'signed-out' && (
          <>
            <p>If it&apos;s your card, sign in to SHYGON on this phone, then tap the card again to activate it.</p>
            <Link className="tap-state-button" to={SIGN_IN} state={{ from: '/shygontap/cards' }}>
              Sign in
            </Link>
          </>
        )}

        {canActivate && (step.kind === 'ready' || step.kind === 'activating') && (
          <>
            <p>This card is on your account. Activate it to make it open your Tap.</p>
            <button
              type="button"
              className="tap-state-button"
              onClick={() => void activate(step.candidates)}
              disabled={step.kind === 'activating'}
            >
              {step.kind === 'activating' ? 'Activating…' : 'Activate this card'}
            </button>
          </>
        )}

        {canActivate && step.kind === 'not-yours' && (
          <p role="alert">
            This card is not on the account you are signed in with. Sign in with the account that ordered it, then tap
            the card again.
          </p>
        )}

        {canActivate && step.kind === 'problem' && (
          <>
            <p role="alert">{step.text}</p>
            <Link className="tap-state-button" to="/shygontap/cards">
              Your cards
            </Link>
          </>
        )}

        {canActivate && step.kind === 'list-failed' && (
          <>
            <p role="alert">{step.text}</p>
            <button type="button" className="tap-state-button" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
