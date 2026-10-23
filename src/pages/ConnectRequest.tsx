import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Handshake } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ErrorState, Skeleton } from '../components/app/States';
import { fetchConnectAvailable } from '../lib/publicConnectClient';
import { fetchPublicProfile } from '../lib/publicTapClient';
import {
  ALL_FIELDS,
  ConnectError,
  FIELD_LABEL,
  REVOCATION_NOTE,
  createRequest,
  getConnectSettings,
  type Connection,
  type ShareField,
} from '../services/connect';

/**
 * Asking to connect with the owner of a Tap (AAROH-API v0.7.1 §10b
 * `requests.create`). The requester is signed in; they choose exactly which of
 * their own account details to share, and nothing is shared until they press
 * Send. The owner decides what, if anything, to share back.
 *
 * The form is offered only when `public.status` says the owner can be asked:
 * reached by its address while Connect is off (SHYGON's switch or the owner's),
 * the page says the owner is not accepting requests, the same answer whatever
 * the reason. The server refuses a request either way.
 */

function refusal(error: ConnectError, name: string): string {
  switch (error.code) {
    case 'unavailable':
      return `${name} is not accepting connection requests right now.`;
    case 'already_connected':
      return `You are already connected with ${name}, or a request is waiting.`;
    case 'target_busy':
      return `${name} has too many requests waiting. Try again later.`;
    case 'recently_declined':
      return `${name} declined a recent request. You can ask again after ${Math.max(1, Math.ceil((error.retryAfter ?? 86400) / 86400))} days.`;
    case 'self':
      return 'This is your own card.';
    default:
      return error.message;
  }
}

export default function ConnectRequest() {
  const { slug = '' } = useParams();
  const [name, setName] = useState<string | null>(null);
  const [mine, setMine] = useState<ShareField[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [share, setShare] = useState<ShareField[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Connection | null>(null);
  const intent = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([fetchPublicProfile(slug), getConnectSettings(), fetchConnectAvailable(slug)]).then(
      ([profile, { settings }, available]) => {
        if (!live) return;
        if (!profile) {
          setLoadError('This Tap is not available.');
          return;
        }
        setName(profile.displayName?.trim() || 'the owner');
        setClosed(!available);
        setMine(settings.shareableFields ?? []);
      },
      (failure) => live && setLoadError(failure instanceof ConnectError ? failure.message : 'We could not load this page.'),
    );
    return () => {
      live = false;
    };
  }, [slug]);

  const toggle = (field: ShareField) => {
    intent.current = null;
    setShare((current) => (current.includes(field) ? current.filter((f) => f !== field) : [...current, field]));
  };

  const send = async () => {
    if (busy) return;
    intent.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      setSent((await createRequest(slug, intent.current, share, note.trim() || null)).connection);
    } catch (failure) {
      const known = failure instanceof ConnectError ? failure : new ConnectError('Something went wrong.', 0, 'unknown');
      if (known.code !== 'network') intent.current = null;
      setError(refusal(known, name ?? 'The owner'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell eyebrow="SHYGON Connect" title={name ? `Connect with ${name}` : 'Connect'} description="Share your details with consent. You choose exactly what they see.">
      <div style={{ display: 'grid', gap: 18, maxWidth: 640 }}>
        {loadError ? (
          <div className="panel">
            <ErrorState title="We couldn't open this request" message={loadError} />
          </div>
        ) : !mine ? (
          <div className="panel" style={{ padding: 24 }}>
            <Skeleton height={140} radius={18} />
          </div>
        ) : closed ? (
          <section className="panel" aria-live="polite">
            <div className="panel-head">
              <Handshake size={19} aria-hidden="true" />
              <div>
                <h2>Not accepting requests</h2>
                <p>{name} is not accepting connection requests right now. Nothing was sent.</p>
              </div>
            </div>
            <div className="panel-body">
              <Link className="btn btn-ghost btn-sm" to={`/t/${slug}`}>
                Back to {name}’s Tap
              </Link>
            </div>
          </section>
        ) : sent ? (
          <section className="panel" aria-live="polite">
            <div className="panel-head">
              <Handshake size={19} aria-hidden="true" />
              <div>
                <h2>Request sent</h2>
                <p>
                  {name} decides whether to connect and what to share back.{' '}
                  {sent.iShare.length > 0
                    ? `Until then they can see only what you chose: ${sent.iShare.map((f) => FIELD_LABEL[f]).join(', ')}.`
                    : 'You are sharing nothing yet.'}
                </p>
              </div>
            </div>
            <div className="panel-body">
              <Link className="btn btn-ghost btn-sm" to="/shygontap/connections">
                See your connections
              </Link>
            </div>
          </section>
        ) : (
          <section className="panel">
            <form
              className="panel-body"
              style={{ display: 'grid', gap: 14 }}
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                <legend style={{ fontWeight: 700, marginBottom: 6 }}>What {name} may see, from your account</legend>
                {ALL_FIELDS.filter((field) => mine.includes(field)).map((field) => (
                  <label key={field} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14 }}>
                    <input type="checkbox" checked={share.includes(field)} disabled={busy} onChange={() => toggle(field)} />
                    <span>{FIELD_LABEL[field]}</span>
                  </label>
                ))}
                <p className="field-hint" style={{ margin: 0 }}>
                  They see the current value from your account, marked as self-reported; a detail your account does not have
                  shows as nothing. Change them in Settings.
                </p>
              </fieldset>
              <label className="field" style={{ margin: 0 }}>
                <span>A note (optional)</span>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={200}
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    intent.current = null;
                  }}
                />
                <p className="field-hint">Shown with your request. Links are removed.</p>
              </label>
              <p className="field-hint" style={{ margin: 0 }}>
                You can stop sharing at any time. {REVOCATION_NOTE}
              </p>
              {error && (
                <p className="field-error" role="alert" style={{ margin: 0 }}>
                  {error}
                </p>
              )}
              <div>
                <button type="submit" className="btn btn-blue" disabled={busy}>
                  {busy ? 'Sending…' : share.length === 0 ? 'Send request, sharing nothing yet' : 'Send request'}
                </button>
              </div>
            </form>
          </section>
        )}
      </div>
    </AppShell>
  );
}
