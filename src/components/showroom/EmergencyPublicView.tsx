import { useEffect, useRef, useState } from 'react';
import { Phone, ShieldAlert } from 'lucide-react';
import type { PublicProfile } from '../../lib/database.types';
import { PublicAlertError, sendPublicAlert, type PublicAlertOutcome } from '../../lib/publicEmergencyClient';

const OUTCOME_COPY: Record<PublicAlertOutcome, { title: string; body: string }> = {
  sent: {
    title: 'Alert handed to the text-message provider',
    body: 'The provider accepted it. SHYGON cannot confirm it has been delivered or read.',
  },
  sending: {
    title: 'Still sending',
    body: 'SHYGON is still handing the alert to the provider and will keep trying for a short while.',
  },
  failed: { title: 'The alert could not be sent', body: 'The text-message provider did not take it.' },
  not_sent: { title: 'Nothing was sent', body: 'Text messages are not set up for SHYGON yet, so no one was alerted.' },
};

const minutes = (seconds?: number) => (seconds ? Math.max(1, Math.ceil(seconds / 60)) : null);

/**
 * A visitor's emergency alert on a real Tap (AAROH-API v0.1 §10.3).
 *
 * Shown only when the server's `public.status` said yes for this Tap: the
 * owner opted in, has a verified contact, and the host switch is on (off
 * everywhere today, DEC-2026-038 Q2). Relay only: the visitor never sees a
 * name, a number or a count.
 *
 * Intent first (a confirmation the visitor must tick); one press per intent
 * (the button is disabled while sending and gone once there is a result);
 * one idempotency key per intent, reused only to retry the same intent after a
 * network failure; and the server's own outcome and safety line, shown as
 * they are. It never says emergency services were contacted.
 */
export function EmergencyPublicView({ data }: { data: PublicProfile }) {
  const name = data.displayName?.trim() || 'the owner';
  const [understood, setUnderstood] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ outcome: PublicAlertOutcome; safety: string } | null>(null);
  const [error, setError] = useState<PublicAlertError | null>(null);
  const intent = useRef<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (result) resultHeading.current?.focus({ preventScroll: true });
  }, [result]);

  const send = async () => {
    if (sending || result || !understood) return;
    intent.current ??= crypto.randomUUID();
    setSending(true);
    setError(null);
    try {
      setResult(await sendPublicAlert(data.slug, intent.current));
    } catch (failure) {
      setError(failure instanceof PublicAlertError ? failure : new PublicAlertError('Something went wrong.', 0, 'unknown'));
    } finally {
      setSending(false);
    }
  };

  const copy = result ? OUTCOME_COPY[result.outcome] : null;

  return (
    <>
      <div className="sr-callout sr-callout-danger">
        <ShieldAlert size={20} aria-hidden="true" />
        <div>
          <strong>Is someone in danger right now? Call 112.</strong>
          <p>SHYGON never contacts the police, an ambulance or the fire service.</p>
          <a className="sr-action sr-action-danger" href="tel:112">
            <Phone size={17} aria-hidden="true" /> Call 112
          </a>
        </div>
      </div>

      {result ? (
        <div className="sr-form" aria-live="polite">
          <h2 className="sr-step-title" ref={resultHeading} tabIndex={-1}>
            {copy?.title ?? 'Status unknown'}
          </h2>
          <p className="sr-view-lead">{copy?.body ?? 'SHYGON did not say what happened, so it is not shown as sent.'}</p>
          {result.safety && (
            <p className="sr-fine" data-testid="alert-safety">
              {result.safety}
            </p>
          )}
        </div>
      ) : (
        <form
          className="sr-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <p className="sr-view-lead">
            This sends a text message to the emergency contacts {name} chose. You will not see who they are. They are told
            that SHYGON cannot confirm the emergency.
          </p>
          <label className="sr-check">
            <input type="checkbox" checked={understood} disabled={sending} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>I understand this alerts {name}’s emergency contacts, and that it does not call emergency services.</span>
          </label>
          {error && (
            <p className="sr-error" role="alert">
              {error.code === 'alert_rate_limited'
                ? `An alert was sent from this card recently. Try again in about ${minutes(error.retryAfter) ?? 'a few'} minutes, or call 112.`
                : error.code === 'unavailable'
                  ? 'Alerts are not available for this card any more.'
                  : error.code === 'service_busy'
                    ? 'SHYGON is busy. Try again in a moment, or call 112.'
                    : error.message}
            </p>
          )}
          <div className="sr-actions">
            <button
              type="submit"
              className="sr-action sr-action-primary"
              disabled={!understood || sending || error?.code === 'unavailable'}
            >
              {sending ? 'Sending…' : error?.code === 'network' ? 'Try again' : 'Send the alert'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
