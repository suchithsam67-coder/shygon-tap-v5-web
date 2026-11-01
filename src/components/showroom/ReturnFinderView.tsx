import { useEffect, useRef, useState } from 'react';
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
 * The Lost page's words (AAROH-API v0.10 §6; the coordinator's checked table,
 * GPT-6, 2026-10-30). DRAFT: the owner approves the exact strings at the
 * frontend gate. The Business page keeps the words above, unchanged.
 */
const LOST = {
  lead: 'This card is in Lost mode. This page only lets you send a private message to its owner.',
  placeholder: 'Write a message (1–500 characters)',
  notes: ['The owner sees only what you write here. Do not include personal or sensitive details.', 'Links are removed automatically from messages.'],
  send: 'Send message',
  status: {
    open: 'Your message has been sent.',
    owner_replied: 'There is a reply.',
    // The finder cannot tell whether the owner closed it or it went quiet for 30 days.
    closed: 'This conversation is closed.',
  } satisfies Record<FinderThread['status'], string>,
  saved: 'Save this private link to return and check for replies. Your access ends 14 days after the last activity.',
  awaiting: 'You have sent 3 messages without a reply. You cannot send another right now. Check this link for a reply.',
  expired: 'Your access to this conversation has expired. This link can no longer be used.',
  missing: 'This conversation is not available.',
} as const;

function lostErrorCopy(error: RescueError): string {
  switch (error.code) {
    case 'awaiting_owner':
      return LOST.awaiting;
    case 'thread_closed':
      return LOST.status.closed;
    case 'rate_limited':
      return 'You have sent too many messages. Please try again later.';
    case 'unavailable':
      return 'This service is not available right now. Please try again later.';
    // 1–500 characters after cleaning: the box stops at 500, so this is a message left empty once links were removed.
    case 'invalid_message':
      return 'Enter a message before sending.';
    case 'thread_expired':
      return LOST.expired;
    case 'thread_not_found':
    case 'invalid_token':
      return LOST.missing;
    default:
      return error.message;
  }
}

/** An earlier conversation that can no longer be opened: expired (410), or gone, blocked or reported (404). */
const GONE = new Set(['thread_not_found', 'thread_expired', 'invalid_token']);

/**
 * Return to owner, for the person who found the card (AAROH-API v0.2 §10a).
 *
 * Shown only when the server's `public.status` said the relay is on for this
 * Tap (the owner opted in and SHYGON's host switch is on: off everywhere
 * today). The finder writes; SHYGON relays it; the owner replies through
 * SHYGON. The finder never sees the owner's number, email or account, and the
 * server removes links from every message. Each send is one intent with one
 * key, so a retry after a network failure cannot send twice.
 *
 * Two places use it: the Business page's Return to Owner mode (`business`,
 * with the name the profile already shows), and the Lost page (`lost`, v0.10),
 * which shows no owner detail at all and has its own words.
 */
export function ReturnFinderView({
  slug,
  ownerName,
  hint,
  variant = 'business',
}: {
  slug: string;
  ownerName: string | null;
  hint: string | null;
  variant?: 'business' | 'lost';
}) {
  const lost = variant === 'lost';
  const [token, setToken] = useState<string | null>(null);
  const [thread, setThread] = useState<FinderThread | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why an earlier conversation could not be opened (its error code), or null. */
  const [gone, setGone] = useState<string | null>(null);
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
      (failure: unknown) => {
        if (!live) return;
        forgetToken(slug);
        setGone(failure instanceof RescueError ? failure.code : 'unknown');
      },
    );
    return () => {
      live = false;
    };
  }, [slug]);

  const describe = lost ? lostErrorCopy : errorCopy;

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
        setGone(known.code);
      }
      // On the Lost page the note about the earlier conversation already says it.
      setError(lost && GONE.has(known.code) ? null : describe(known));
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
      setError(failure instanceof RescueError ? describe(failure) : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const canWrite = !thread || thread.canWrite;
  const goneNote = lost
    ? gone === 'thread_expired'
      ? LOST.expired
      : LOST.missing
    : 'That earlier conversation is no longer available. You can start a new one.';

  return (
    <>
      <p className="sr-view-lead">
        {lost
          ? LOST.lead
          : `Found this card? Send a message to ${ownerName?.trim() || 'its owner'} through SHYGON. You will not see their number or email, and they see only what you write.`}
      </p>
      {hint && !thread && <p className="sr-note sr-hint-box">The owner’s note: “{hint}”</p>}
      {gone && !thread && <p className="sr-note">{goneNote}</p>}

      {thread && (
        <div className="sr-form" aria-live="polite">
          <h2 className="sr-step-title" ref={resultHeading} tabIndex={-1}>
            {(lost ? LOST.status : STATUS_COPY)[thread.status]}
          </h2>
          <ol className="sr-thread">
            {thread.messages.map((m, i) => (
              <li key={i} className={`sr-msg sr-msg-${m.from}`}>
                <small>{m.from === 'finder' ? 'You' : m.from === 'owner' ? 'Owner' : 'SHYGON'}</small>
                <span>{m.body}</span>
              </li>
            ))}
          </ol>
          {/* Three in a row without a reply: the server stops the finder writing until the owner answers. */}
          {lost && !thread.canWrite && thread.status !== 'closed' && !error && <p className="sr-note">{LOST.awaiting}</p>}
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
          {token &&
            (lost ? (
              <p className="sr-fine">
                {LOST.saved} Anyone with the link can read this conversation.
              </p>
            ) : (
              <p className="sr-fine">Anyone with that link can read this conversation. It stops working 14 days after the last message.</p>
            ))}
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
              placeholder={lost ? LOST.placeholder : undefined}
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
          {lost ? (
            <div id="rt-note">
              {LOST.notes.map((note) => (
                <p key={note} className="sr-fine" style={{ margin: 0 }}>
                  {note}
                </p>
              ))}
            </div>
          ) : (
            <p id="rt-note" className="sr-fine" style={{ margin: 0 }}>
              Links are removed. Share your own number or email only if you want the owner to have it.
            </p>
          )}
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <div className="sr-actions">
            <button type="submit" className="sr-action sr-action-primary" disabled={busy || !message.trim()}>
              {busy ? 'Sending…' : lost ? LOST.send : 'Send to the owner'}
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
