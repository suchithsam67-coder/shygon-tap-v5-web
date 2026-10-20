import { useEffect, useRef, useState } from 'react';
import type { PublicProfile } from '../../lib/database.types';
import {
  RescueError,
  forgetToken,
  postToThread,
  recallToken,
  rememberToken,
  savedLink,
  startThread,
  viewThread,
  type FinderThread,
} from '../../lib/publicRescueClient';

const MAX = 500;

const STATUS_COPY: Record<FinderThread['status'], string> = {
  open: 'Sent to the owner. Waiting for a reply.',
  owner_replied: 'The owner replied.',
  closed: 'The owner closed this conversation.',
};

function errorCopy(error: RescueError): string {
  switch (error.code) {
    case 'awaiting_owner':
      return 'Wait for the owner to reply before writing again.';
    case 'thread_closed':
      return 'The owner closed this conversation.';
    case 'rate_limited':
      return `Too many messages for now. Try again in about ${Math.max(1, Math.ceil((error.retryAfter ?? 60) / 60))} minutes.`;
    case 'unavailable':
      return 'The owner is not receiving messages through this card right now.';
    default:
      return error.message;
  }
}

/**
 * Return to owner, for the person who found the card (AAROH-API v0.2 §10a).
 *
 * Shown only when the server's `public.status` said the relay is on for this
 * Tap (the owner opted in and SHYGON's host switch is on: off everywhere
 * today). The finder writes; SHYGON relays it; the owner replies through
 * SHYGON. The finder never sees the owner's number, email or account, and the
 * server removes links from every message. Each send is one intent with one
 * key, so a retry after a network failure cannot send twice.
 */
export function ReturnFinderView({ data, hint }: { data: PublicProfile; hint: string | null }) {
  const slug = data.slug;
  const [token, setToken] = useState<string | null>(null);
  const [thread, setThread] = useState<FinderThread | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [copied, setCopied] = useState(false);
  const intent = useRef<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const hasThread = Boolean(thread);
  useEffect(() => {
    if (hasThread) resultHeading.current?.focus({ preventScroll: true });
  }, [hasThread]);

  // A conversation already started in this tab, or from a saved link. A token
  // that arrived in the fragment moves into this tab's storage and leaves the
  // address bar, so a Share or a copied address can never carry it.
  useEffect(() => {
    const known = recallToken(slug);
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
    if (!known) return;
    rememberToken(slug, known);
    let live = true;
    viewThread(known).then(
      ({ thread: found }) => {
        if (!live) return;
        setToken(known);
        setThread(found);
      },
      () => {
        if (!live) return;
        forgetToken(slug);
        setGone(true);
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);

  const send = async () => {
    const text = message.trim();
    if (busy || !text) return;
    intent.current ??= crypto.randomUUID();
    setBusy(true);
    setError(null);
    try {
      if (!token) {
        const started = await startThread(slug, intent.current, text);
        rememberToken(slug, started.finderToken);
        setToken(started.finderToken);
        setThread(started.thread);
      } else {
        setThread((await postToThread(token, intent.current, text)).thread);
      }
      intent.current = null;
      setMessage('');
    } catch (failure) {
      const known = failure instanceof RescueError ? failure : new RescueError('Something went wrong.', 0, 'unknown');
      // Keep the key only for a network failure: that retry is the same message.
      if (known.code !== 'network') intent.current = null;
      if (known.code === 'thread_not_found' || known.code === 'thread_expired') {
        forgetToken(slug);
        setToken(null);
        setThread(null);
        setGone(true);
      }
      setError(errorCopy(known));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setThread((await viewThread(token)).thread);
    } catch (failure) {
      setError(failure instanceof RescueError ? errorCopy(failure) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const canWrite = !thread || thread.canWrite;

  return (
    <>
      <p className="sr-view-lead">
        Found this card? Send a message to {data.displayName?.trim() || 'its owner'} through SHYGON. You will not see their
        number or email, and they see only what you write.
      </p>
      {hint && !thread && <p className="sr-note sr-hint-box">The owner’s note: “{hint}”</p>}
      {gone && !thread && <p className="sr-note">That earlier conversation is no longer available. You can start a new one.</p>}

      {thread && (
        <div className="sr-form" aria-live="polite">
          <h2 className="sr-step-title" ref={resultHeading} tabIndex={-1}>
            {STATUS_COPY[thread.status]}
          </h2>
          <ol className="sr-thread">
            {thread.messages.map((m, i) => (
              <li key={i} className={`sr-msg sr-msg-${m.from}`}>
                <small>{m.from === 'finder' ? 'You' : m.from === 'owner' ? 'Owner' : 'SHYGON'}</small>
                <span>{m.body}</span>
              </li>
            ))}
          </ol>
          <div className="sr-actions">
            <button type="button" className="sr-action" onClick={() => void refresh()} disabled={busy}>
              Check for a reply
            </button>
            {token && (
              <button
                type="button"
                className="sr-action"
                onClick={() => {
                  void navigator.clipboard?.writeText(savedLink(slug, token)).then(() => setCopied(true), () => setCopied(false));
                }}
              >
                {copied ? 'Link copied' : 'Copy a link to this conversation'}
              </button>
            )}
          </div>
          {token && <p className="sr-fine">Anyone with that link can read this conversation. It stops working 14 days after the last message.</p>}
        </div>
      )}

      {canWrite && (
        <form
          className="sr-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label className="sr-field">
            <span>{thread ? 'Write again' : 'Your message'}</span>
            <textarea
              value={message}
              maxLength={MAX}
              rows={4}
              disabled={busy}
              onChange={(event) => {
                setMessage(event.target.value);
                intent.current = null;
              }}
              aria-describedby="rt-count rt-note"
            />
          </label>
          <p id="rt-count" className="sr-fine" style={{ margin: 0 }}>
            {message.length} / {MAX}
          </p>
          <p id="rt-note" className="sr-fine" style={{ margin: 0 }}>
            Links are removed. Share your own number or email only if you want the owner to have it.
          </p>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <div className="sr-actions">
            <button type="submit" className="sr-action sr-action-primary" disabled={busy || !message.trim()}>
              {busy ? 'Sending…' : 'Send to the owner'}
            </button>
          </div>
        </form>
      )}
      {!canWrite && error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
