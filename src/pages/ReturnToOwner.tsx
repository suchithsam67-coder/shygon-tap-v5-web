import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Inbox, MessageSquare, Undo2 } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, Skeleton } from '../components/app/States';
import {
  RescueOwnerError,
  THREAD_STATUS_LABEL,
  blockThread,
  closeThread,
  getRescueSettings,
  getThread,
  listThreads,
  replyToThread,
  reportThread,
  setRescueSettings,
  type OwnerThread,
  type RescueSettings,
  type ThreadSummary,
} from '../services/rescue';

/**
 * Return to owner, the owner's side (AAROH-API v0.2 §10a): the opt-in, an
 * optional note for finders, and the conversations. `/shygontap/return-to-owner`
 * is where the server's `rescue` notification points.
 *
 * Everything shown is what the server returned; a reply appears once the
 * server has it. The finder never sees the owner's details, and the owner sees
 * only what finders write (links removed by the server).
 */

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

const messageOf = (error: unknown) => (error instanceof RescueOwnerError ? error.message : 'Something went wrong. Please try again.');

type Load = { kind: 'loading' } | { kind: 'ready'; settings: RescueSettings; threads: ThreadSummary[] } | { kind: 'error'; message: string };

export default function ReturnToOwner() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const read = useCallback(
    () =>
      Promise.all([getRescueSettings(), listThreads()]).then(
        ([{ settings }, { threads }]): Load => ({ kind: 'ready', settings, threads }),
        (error): Load => ({ kind: 'error', message: messageOf(error) }),
      ),
    [],
  );
  const refresh = useCallback(async () => setLoad(await read()), [read]);

  useEffect(() => {
    let live = true;
    void read().then((next) => live && setLoad(next));
    return () => {
      live = false;
    };
  }, [read, attempt]);

  return (
    <AppShell
      eyebrow="SHYGON OS"
      title="Return to Owner"
      description="Lost something with SHYGON? Let the finder contact you through a privacy-conscious relay, without automatically exposing your personal contact details."
    >
      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        {load.kind === 'loading' ? (
          <div className="panel" style={{ padding: 24 }}>
            <Skeleton height={140} radius={18} />
          </div>
        ) : load.kind === 'error' ? (
          <div className="panel">
            <ErrorState title="We couldn't load your messages" message={load.message} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        ) : (
          <>
            <SettingsPanel settings={load.settings} onChanged={refresh} />
            <section className="panel" aria-labelledby="rt-inbox">
              <div className="panel-head">
                <Inbox size={19} aria-hidden="true" />
                <div>
                  <h2 id="rt-inbox">Messages from finders</h2>
                  <p>
                    {load.settings.openThreads} open · {load.settings.unread} unread. Conversations are deleted 90 days after they close.
                  </p>
                </div>
              </div>
              <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
                {load.threads.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>No messages.</p>
                ) : (
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                    {load.threads.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ width: '100%', justifyContent: 'space-between', textAlign: 'left', gap: 10, flexWrap: 'wrap' }}
                          aria-expanded={openId === t.id}
                          onClick={() => setOpenId((id) => (id === t.id ? null : t.id))}
                        >
                          <span style={{ display: 'grid', gap: 2 }}>
                            <strong style={{ fontSize: 13.5 }}>
                              {t.unread ? '● ' : ''}
                              {THREAD_STATUS_LABEL[t.status] ?? t.status}
                            </strong>
                            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>“{t.preview}”</span>
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{when(t.lastActivityAt)}</span>
                        </button>
                        {openId === t.id && <ThreadPanel threadId={t.id} onChanged={refresh} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          <Link to="/shygontap/experience">Back to your AAROH experience</Link>
        </p>
      </div>
    </AppShell>
  );
}

function SettingsPanel({ settings, onChanged }: { settings: RescueSettings; onChanged: () => Promise<void> }) {
  const [hint, setHint] = useState(settings.publicHint ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const save = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const { settings: next } = await setRescueSettings(enabled, hint.trim() || null);
      setHint(next.publicHint ?? '');
      setSaved(next.enabled ? 'Saved. Finders can message you once SHYGON enables the relay.' : 'Saved. Finders cannot message you.');
      await onChanged();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel" aria-labelledby="rt-settings">
      <div className="panel-head">
        <Undo2 size={19} aria-hidden="true" />
        <div>
          <h2 id="rt-settings">Let finders message you</h2>
          <p>
            {settings.enabled ? 'On.' : 'Off.'}{' '}
            {settings.relayAllowed
              ? 'A “Return to Owner” option appears on your published Tap while this is on.'
              : 'SHYGON has not switched the relay on yet, so finders cannot write even while this is on.'}
          </p>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
        <label className="field" style={{ margin: 0 }}>
          <span>A note for finders (optional)</span>
          <input className="input" maxLength={140} value={hint} onChange={(e) => setHint(e.target.value)} placeholder="For example: a reward is offered" />
          <p className="field-hint">Shown to anyone who opens your Tap. Links are removed. Do not include private details.</p>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => void save(!settings.enabled)}>
            {settings.enabled ? 'Turn off' : 'Turn on'}
          </button>
          {settings.enabled && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save(true)}>
              Save the note
            </button>
          )}
        </div>
        {saved && (
          <p role="status" style={{ margin: 0, fontSize: 13 }}>
            {saved}
          </p>
        )}
        {error && (
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function ThreadPanel({ threadId, onChanged }: { threadId: string; onChanged: () => Promise<void> }) {
  const [thread, setThread] = useState<OwnerThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'block' | 'report' | null>(null);
  const intent = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    getThread(threadId).then(
      ({ thread: found }) => live && setThread(found),
      (failure) => live && setError(messageOf(failure)),
    );
    return () => {
      live = false;
    };
  }, [threadId]);

  /** Runs an owner action; true only once the server confirmed it. */
  const act = async (action: () => Promise<{ thread: OwnerThread }>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      setThread((await action()).thread);
      await onChanged();
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!thread) return error ? <p className="field-error">{error}</p> : <Skeleton height={80} radius={14} />;

  const writable = thread.status === 'open' || thread.status === 'owner_replied';

  return (
    <div style={{ padding: 12, display: 'grid', gap: 10, borderRadius: 14, border: '1px solid var(--line)', marginTop: 6 }}>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }} aria-label="Conversation">
        {thread.messages.map((m) => (
          <li key={m.id} style={{ fontSize: 13.5, lineHeight: 1.5 }}>
            <strong>{m.from === 'owner' ? 'You' : m.from === 'finder' ? 'Finder' : 'SHYGON'}</strong>{' '}
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>{when(m.at)}</span>
            <div style={{ overflowWrap: 'anywhere' }}>{m.body}</div>
          </li>
        ))}
      </ol>
      {writable && (
        <form
          style={{ display: 'grid', gap: 8 }}
          onSubmit={(event) => {
            event.preventDefault();
            const text = reply.trim();
            if (!text) return;
            intent.current ??= crypto.randomUUID();
            const key = intent.current;
            void act(() => replyToThread(thread.id, key, text)).then((ok) => {
              // Cleared only once the server has the reply; on failure it stays to retry.
              if (!ok) return;
              intent.current = null;
              setReply('');
            });
          }}
        >
          <label className="field" style={{ margin: 0 }}>
            <span>Your reply</span>
            <textarea
              className="input"
              rows={3}
              maxLength={500}
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                intent.current = null;
              }}
            />
            <p className="field-hint">The finder sees only what you write. Links are removed.</p>
          </label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-blue btn-sm" disabled={busy || !reply.trim()}>
              <MessageSquare size={14} aria-hidden="true" /> Send reply
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void act(() => closeThread(thread.id))}>
              Close
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking('block')}>
              Block
            </button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setAsking('report')}>
              Report
            </button>
          </div>
        </form>
      )}
      {!writable && <p className="field-hint">{THREAD_STATUS_LABEL[thread.status]}. No more messages can be sent here.</p>}
      {error && (
        <p className="field-error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      )}
      <ConfirmDialog
        open={asking !== null}
        tone="danger"
        title={asking === 'report' ? 'Report this conversation?' : 'Block this finder?'}
        description={
          asking === 'report'
            ? 'SHYGON is told, the finder loses access, and they cannot message you again for 90 days.'
            : 'The finder loses access and cannot message you again for 90 days.'
        }
        confirmLabel={asking === 'report' ? 'Report' : 'Block'}
        busy={busy}
        onConfirm={() => {
          const which = asking;
          setAsking(null);
          void act(() => (which === 'report' ? reportThread(thread.id) : blockThread(thread.id)));
        }}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
