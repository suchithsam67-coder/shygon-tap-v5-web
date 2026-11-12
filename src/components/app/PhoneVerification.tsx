import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, PhoneCall, Send } from 'lucide-react';
import {
  AccountError,
  confirmPhoneVerification,
  getPhoneStatus,
  startPhoneVerification,
  stillWaiting,
  type PhoneStatus,
} from '../../services/account';
import {
  NEEDS_NEW_CODE,
  NEEDS_SETTINGS,
  SETTINGS_PATH,
  phoneMessageOf,
  whenUsable,
} from '../../lib/phoneVerification';

/**
 * "Verify your phone" (AAROH-API v0.13 §4b; DEC-2026-045).
 *
 * Codes for card changes go only to a verified number, so this is where the
 * owner proves the number on the account is theirs: send a code, type it in.
 * The number itself is never typed here: the server texts the number in
 * Settings, so changing it is a Settings job. A number that replaces a verified
 * one waits 24 hours before it can confirm card changes, and the page says
 * when. Customer wording is DRAFT for the owner's gate.
 */

type Busy = 'sending' | 'checking' | null;

export function PhoneVerification({ onVerified }: { onVerified?: (status: PhoneStatus) => void }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ text: string; settings: boolean } | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [justVerified, setJustVerified] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    getPhoneStatus()
      .then((next) => {
        if (!live) return;
        setStatus(next);
        setLoadProblem(null);
      })
      .catch((failure) => {
        if (live) setLoadProblem(phoneMessageOf(failure));
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  // The wait before another code may be sent.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  async function send() {
    setBusy('sending');
    setProblem(null);
    setCode('');
    try {
      const sent = await startPhoneVerification();
      setSentTo(sent.phoneMasked);
      setResendIn(sent.resendAfter);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (failure) {
      const reason = failure instanceof AccountError ? failure.code : 'unknown';
      if (reason === 'already_verified') {
        setAttempt((n) => n + 1);
        return;
      }
      if (reason === 'verify_cooldown' && failure instanceof AccountError && failure.retryAfter) setResendIn(failure.retryAfter);
      setProblem({ text: phoneMessageOf(failure), settings: NEEDS_SETTINGS.has(reason) });
    } finally {
      setBusy(null);
    }
  }

  async function confirm(value = code) {
    if (value.length !== 6 || busy) return;
    setBusy('checking');
    setProblem(null);
    try {
      const done = await confirmPhoneVerification(value);
      const next: PhoneStatus = {
        phone: sentTo ?? status?.phone ?? null,
        phoneValid: true,
        verified: true,
        verifiedAt: done.verifiedAt,
        usableFrom: done.usableFrom,
      };
      setStatus(next);
      setSentTo(null);
      setJustVerified(true);
      onVerified?.(next);
    } catch (failure) {
      const reason = failure instanceof AccountError ? failure.code : 'unknown';
      setProblem({ text: phoneMessageOf(failure), settings: NEEDS_SETTINGS.has(reason) });
      setCode('');
      if (NEEDS_NEW_CODE.has(reason) || NEEDS_SETTINGS.has(reason)) setSentTo(null);
      else requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setBusy(null);
    }
  }

  if (loadProblem) {
    return (
      <div style={{ display: 'grid', gap: 10 }}>
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {loadProblem}
        </p>
        <div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return (
      <p className="otp-hint" role="status" style={{ margin: 0 }}>
        <Loader2 size={15} className="spin" aria-hidden="true" /> Checking your number…
      </p>
    );
  }

  if (!status.phoneValid || !status.phone) {
    return (
      <div className="phone-verify" data-testid="phone-verify" data-state="needs-settings">
        <p className="otp-hint" style={{ margin: 0 }}>
          <PhoneCall size={16} aria-hidden="true" />
          {status.phoneValid
            ? 'Add your mobile number in Settings first. We text the code to that number.'
            : 'The number in Settings is not a mobile number we can text. Check it in Settings.'}
        </p>
        <div>
          <Link to={SETTINGS_PATH} className="btn btn-ghost btn-sm">
            Open Settings
          </Link>
        </div>
      </div>
    );
  }

  if (status.verified) {
    const waiting = stillWaiting(status);
    return (
      <div className="phone-verify" data-testid="phone-verify" data-state={waiting ? 'waiting' : 'verified'}>
        <p className="phone-verify-ok" role={justVerified ? 'status' : undefined}>
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>
            {justVerified ? 'Your number is verified: ' : 'Verified: '}
            <strong>{status.phone}</strong>
          </span>
        </p>
        {waiting && status.usableFrom ? (
          <p className="otp-hint" style={{ margin: 0 }}>
            <Clock size={15} aria-hidden="true" />
            <span>
              For your security, a number that replaces a verified one can confirm card changes from{' '}
              <strong>{whenUsable(status.usableFrom)}</strong>.
            </span>
          </p>
        ) : (
          <p className="field-hint" style={{ margin: 0 }}>
            Codes for activating or deactivating your card are sent to this number.
          </p>
        )}
        <p className="field-hint" style={{ margin: 0 }}>
          To use another number, change it in <Link to={SETTINGS_PATH}>Settings</Link>, then verify it here.
        </p>
      </div>
    );
  }

  return (
    <div className="phone-verify" data-testid="phone-verify" data-state={sentTo ? 'entering' : 'unverified'}>
      {sentTo ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <p className="otp-hint" style={{ margin: 0 }}>
            <span>
              Enter the 6-digit code we texted to <strong>{sentTo}</strong>. It expires in 10 minutes.
            </span>
          </p>
          <label className="otp-field">
            <span className="sr-only">Verification code</span>
            <input
              ref={inputRef}
              value={code}
              onChange={(event) => {
                const next = event.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                if (next.length === 6) void confirm(next);
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? 'phone-verify-error' : undefined}
              disabled={busy === 'checking'}
            />
          </label>
          {problem && (
            <p id="phone-verify-error" className="otp-error" role="alert">
              {problem.text}
            </p>
          )}
          <div className="phone-verify-actions">
            <button type="submit" className="btn btn-blue" disabled={code.length !== 6 || busy !== null}>
              {busy === 'checking' ? (
                <>
                  <Loader2 size={15} className="spin" aria-hidden="true" /> Checking…
                </>
              ) : (
                'Verify'
              )}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void send()}
              disabled={resendIn > 0 || busy !== null}
            >
              {resendIn > 0 ? `Send a new code in ${resendIn}s` : 'Send a new code'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="otp-hint" style={{ margin: 0 }}>
            <PhoneCall size={16} aria-hidden="true" />
            <span>
              <strong>{status.phone}</strong> is not verified yet. We text a 6-digit code to this number to check it is
              yours.
            </span>
          </p>
          {problem && (
            <p id="phone-verify-error" className="otp-error" role="alert" style={{ margin: 0 }}>
              {problem.text} {problem.settings && <Link to={SETTINGS_PATH}>Open Settings</Link>}
            </p>
          )}
          <div className="phone-verify-actions">
            <button type="button" className="btn btn-blue" onClick={() => void send()} disabled={busy !== null || resendIn > 0}>
              {busy === 'sending' ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              {resendIn > 0 ? `Send code in ${resendIn}s` : 'Send code'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
