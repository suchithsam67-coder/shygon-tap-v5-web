import { useEffect, useRef, useState } from 'react';
import { Loader2, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { AccountError, confirmAge, getAgeStatus } from '../../services/account';
import { LEGAL } from '../../data/legal';
import { ageConfirmedHere, rememberAgeConfirmed } from '../../lib/ageConfirmation';

/**
 * The one-time "I am 18 or older" prompt (V01 T-13; AAROH-API v0.17 §4c;
 * DEC-2026-048; founder decision F-26, "Option A: 18+ now").
 *
 * New accounts confirm at sign-up, and the database records it then. Accounts
 * made before that have no record, so the first signed-in page asks once, and
 * the server records the answer with its own time. Nothing else is asked: no
 * date of birth. The account cannot be used until it is confirmed, but the
 * owner can always sign out.
 *
 * A failed status read shows nothing and tries again on the next page: this is
 * a prompt, not the record, and the server keeps the record either way.
 * Customer wording is DRAFT for the owner's gate.
 */

function messageOf(error: unknown): string {
  if (error instanceof AccountError) {
    if (error.code === 'unauthenticated') return 'Your session has expired. Sign in again.';
    if (error.code === 'network') return error.message;
  }
  return 'We could not save your confirmation. Please try again.';
}

export function AgeConfirmation() {
  const { user, passwordRecovery, signOut } = useAuth();
  const userId = user?.id ?? null;
  const [askFor, setAskFor] = useState<string | null>(null);
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLInputElement>(null);

  // Ask the server once per account per tab. A reset-password visit is left
  // alone: that session is for the new password only.
  useEffect(() => {
    if (!userId || passwordRecovery || ageConfirmedHere(userId)) return;
    let live = true;
    getAgeStatus()
      .then((status) => {
        if (!live) return;
        if (status.confirmed) rememberAgeConfirmed(userId);
        else setAskFor(userId);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [userId, passwordRecovery]);

  const open = askFor !== null && askFor === userId;

  // While open: the page behind cannot scroll, focus starts on the box and stays in the dialog.
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    boxRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('input, button, a[href]')].filter(
        (el) => !el.hasAttribute('disabled'),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      restoreTo?.focus();
    };
  }, [open]);

  if (!open || !userId) return null;

  async function confirm() {
    if (!ticked || busy || !userId) return;
    setBusy(true);
    setProblem(null);
    try {
      await confirmAge(LEGAL.lastUpdated);
      rememberAgeConfirmed(userId);
      setAskFor(null);
    } catch (failure) {
      // Confirmed already (another tab, or just now): the record exists, so close.
      if (failure instanceof AccountError && failure.code === 'already_confirmed') {
        rememberAgeConfirmed(userId);
        setAskFor(null);
        return;
      }
      setProblem(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" data-testid="age-confirmation">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="age-title"
        aria-describedby="age-description"
      >
        <div className="state-icon">
          <ShieldCheck size={20} aria-hidden="true" />
        </div>
        <h2 id="age-title">Confirm your age</h2>
        <p id="age-description">
          SHYGON Tap is for adults only. Before you continue, please confirm that you are 18 or older. We record
          your answer once, with the date.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label className="age-box">
            <input
              ref={boxRef}
              type="checkbox"
              checked={ticked}
              onChange={(event) => setTicked(event.target.checked)}
              disabled={busy}
            />
            <span>I am 18 or older.</span>
          </label>
          <p className="age-note">
            If you are under 18, please do not use SHYGON Tap. Sign out, and write to{' '}
            <a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a> to close your account.
          </p>
          {problem && (
            <p className="field-error" role="alert" style={{ margin: '10px 0 0' }}>
              {problem}
            </p>
          )}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={() => void signOut()} disabled={busy}>
              <LogOut size={15} aria-hidden="true" /> Sign out
            </button>
            <button type="submit" className="btn btn-blue" disabled={!ticked || busy}>
              {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
