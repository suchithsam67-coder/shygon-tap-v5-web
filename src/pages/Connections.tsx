import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Handshake, Inbox, ScrollText, Users } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, Skeleton } from '../components/app/States';
import {
  ALL_FIELDS,
  ConnectError,
  FIELD_LABEL,
  REVOCATION_NOTE,
  STATUS_LABEL,
  UNSHARE_NOTE,
  acceptRequest,
  blockRequest,
  changeShare,
  declineRequest,
  getConnectSettings,
  listConnections,
  listConsents,
  removeConnection,
  setConnectEnabled,
  type Connection,
  type ConnectSettings,
  type Consent,
  type ShareField,
} from '../services/connect';

/**
 * SHYGON Connect for the signed-in owner (AAROH-API v0.4 §10b): the opt-in,
 * requests to answer, the people connected and what each side shares, and the
 * consent record. `/shygontap/connections` is where `connect` notifications
 * point. Every list is the server's; nothing changes on screen until the
 * server confirms it. Shared details are always marked self-reported.
 */

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const messageOf = (error: unknown) => (error instanceof ConnectError ? error.message : 'Something went wrong. Please try again.');

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; settings: ConnectSettings; connections: Connection[]; consents: Consent[] }
  | { kind: 'error'; message: string };

export default function Connections() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'block' | 'remove'; connection: Connection } | null>(null);

  const read = useCallback(
    () =>
      Promise.all([getConnectSettings(), listConnections(), listConsents()]).then(
        ([{ settings }, { connections }, { consents }]): Load => ({ kind: 'ready', settings, connections, consents }),
        (failure): Load => ({ kind: 'error', message: messageOf(failure) }),
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

  /** Runs an action and re-reads; true only when the server confirmed it. */
  const act = async (action: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (failure) {
      setError(messageOf(failure));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (load.kind !== 'ready') {
    return (
      <AppShell eyebrow="Connections" title="SHYGON Connect" description="Build meaningful connections and exchange the information you choose to share.">
        {load.kind === 'loading' ? (
          <div className="panel" style={{ padding: 24 }}>
            <Skeleton height={140} radius={18} />
          </div>
        ) : (
          <div className="panel">
            <ErrorState title="We couldn't load your connections" message={load.message} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        )}
      </AppShell>
    );
  }

  const { settings, connections, consents } = load;
  const incoming = connections.filter((c) => c.direction === 'incoming' && c.status === 'requested');
  const outgoing = connections.filter((c) => c.direction === 'outgoing' && c.status === 'requested');
  const connected = connections.filter((c) => c.status === 'accepted');
  const ended = connections.filter((c) => !['requested', 'accepted'].includes(c.status));

  return (
    <AppShell eyebrow="Connections" title="SHYGON Connect" description="Build meaningful connections and exchange the information you choose to share.">
      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        {error && (
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        <section className="panel" aria-labelledby="cx-settings">
          <div className="panel-head">
            <Handshake size={19} aria-hidden="true" />
            <div>
              <h2 id="cx-settings">Let people who tap your card ask to connect</h2>
              <p>
                {settings.enabled ? 'On.' : 'Off.'} Only signed-in SHYGON accounts can ask, and each request says what they share. You
                choose what to share back, if anything.
                {!settings.publicTapPublished && ' Your Tap is not published, so nobody can ask yet.'}
              </p>
            </div>
          </div>
          <div className="panel-body">
            <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => void act(() => setConnectEnabled(!settings.enabled))}>
              {settings.enabled ? 'Turn off' : 'Turn on'}
            </button>
          </div>
        </section>

        <section className="panel" aria-labelledby="cx-incoming">
          <div className="panel-head">
            <Inbox size={19} aria-hidden="true" />
            <div>
              <h2 id="cx-incoming">Requests to answer</h2>
              <p>Requests expire after 30 days unanswered.</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            {incoming.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>No requests.</p>
            ) : (
              incoming.map((c) => (
                <IncomingRequest
                  key={c.id}
                  connection={c}
                  busy={busy}
                  onAccept={(share) => act(() => acceptRequest(c.id, share))}
                  onDecline={() => act(() => declineRequest(c.id))}
                  onBlock={() => setConfirm({ kind: 'block', connection: c })}
                />
              ))
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="cx-connected">
          <div className="panel-head">
            <Users size={19} aria-hidden="true" />
            <div>
              <h2 id="cx-connected">Connected</h2>
              <p>What they share is what they entered in their own account. SHYGON does not verify it.</p>
            </div>
          </div>
          <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
            {connected.length === 0 && outgoing.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>No connections yet.</p>
            ) : (
              <>
                {connected.map((c) => (
                  <ConnectedCard
                    key={c.id}
                    connection={c}
                    busy={busy}
                    onShare={(share) => act(() => changeShare(c.id, share))}
                    onRemove={() => setConfirm({ kind: 'remove', connection: c })}
                  />
                ))}
                {outgoing.map((c) => (
                  <div key={c.id} style={{ padding: 12, borderRadius: 14, border: '1px solid var(--line)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <strong>{c.other.name}</strong>
                    <span className="pill pill-amber">
                      <span className="pill-dot" />
                      {STATUS_LABEL.requested}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      You share: {c.iShare.length ? c.iShare.map((f) => FIELD_LABEL[f]).join(', ') : 'nothing yet'}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirm({ kind: 'remove', connection: c })}>
                      Withdraw
                    </button>
                  </div>
                ))}
              </>
            )}
            {ended.length > 0 && (
              <details>
                <summary style={{ fontSize: 13, cursor: 'pointer' }}>Ended ({ended.length})</summary>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                  {ended.map((c) => (
                    <li key={c.id}>
                      {c.other.name} · {STATUS_LABEL[c.status]} {c.endedAt ? `· ${when(c.endedAt)}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </section>

        <section className="panel" aria-labelledby="cx-consents">
          <div className="panel-head">
            <ScrollText size={19} aria-hidden="true" />
            <div>
              <h2 id="cx-consents">Consent record</h2>
              <p>Every permission given or received, including the ones since revoked. SHYGON keeps this record.</p>
            </div>
          </div>
          <div className="panel-body">
            {consents.length === 0 ? (
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>Nothing recorded yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, fontSize: 13 }}>
                {consents.map((g) => (
                  <li key={g.id}>
                    <strong>{g.direction === 'given' ? 'You gave' : 'You received'}</strong>{' '}
                    {g.scope.map((f) => FIELD_LABEL[f]).join(', ') || 'nothing'} · {typeof g.other === 'string' ? g.other : g.other.name} ·
                    from {when(g.grantedAt)}
                    {g.revokedAt ? ` · revoked ${when(g.revokedAt)}` : ' · active'}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          <Link to="/shygontap/experience">Back to your AAROH experience</Link>
        </p>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        tone="danger"
        title={
          confirm?.kind === 'block'
            ? `Block ${confirm.connection.other.name}?`
            : confirm?.connection.status === 'requested'
              ? 'Withdraw this request?'
              : `Remove ${confirm?.connection.other.name ?? 'this connection'}?`
        }
        description={
          confirm?.kind === 'block'
            ? 'They will see your answer as declined, and cannot ask you again.'
            : REVOCATION_NOTE
        }
        confirmLabel={confirm?.kind === 'block' ? 'Block' : confirm?.connection.status === 'requested' ? 'Withdraw' : 'Remove'}
        busy={busy}
        onConfirm={() => {
          const target = confirm;
          setConfirm(null);
          if (!target) return;
          void act(() => (target.kind === 'block' ? blockRequest(target.connection.id) : removeConnection(target.connection.id)));
        }}
        onCancel={() => setConfirm(null)}
      />
    </AppShell>
  );
}

function SharedByThem({ connection }: { connection: Connection }) {
  const entries = Object.entries(connection.theyShare) as [ShareField, { value: string }][];
  if (entries.length === 0) return <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>They share nothing with you.</p>;
  return (
    <dl style={{ margin: 0, display: 'grid', gap: 4, fontSize: 13.5 }}>
      {entries.map(([field, shared]) => (
        <div key={field} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <dt style={{ color: 'var(--muted)', minWidth: 110 }}>{FIELD_LABEL[field]}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>
            {shared.value} <span className="pill pill-blue" style={{ marginLeft: 4 }}>Self-reported</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ShareChooser({ value, onChange, disabled }: { value: ShareField[]; onChange: (next: ShareField[]) => void; disabled: boolean }) {
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      <legend style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 4 }}>You share, from your account</legend>
      {ALL_FIELDS.map((field) => (
        <label key={field} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13.5 }}>
          <input
            type="checkbox"
            checked={value.includes(field)}
            disabled={disabled}
            onChange={() => onChange(value.includes(field) ? value.filter((f) => f !== field) : [...value, field])}
          />
          {FIELD_LABEL[field]}
        </label>
      ))}
    </fieldset>
  );
}

function IncomingRequest({
  connection,
  busy,
  onAccept,
  onDecline,
  onBlock,
}: {
  connection: Connection;
  busy: boolean;
  onAccept: (share: ShareField[]) => Promise<boolean>;
  onDecline: () => void;
  onBlock: () => void;
}) {
  const [share, setShare] = useState<ShareField[]>([]);
  return (
    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <strong>{connection.other.name}</strong>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>asked on {when(connection.createdAt)}</span>
      </div>
      {connection.note && <p style={{ margin: 0, fontSize: 13.5, fontStyle: 'italic', overflowWrap: 'anywhere' }}>“{connection.note}”</p>}
      <SharedByThem connection={connection} />
      <ShareChooser value={share} onChange={setShare} disabled={busy} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => void onAccept(share)}>
          {share.length ? 'Accept and share' : 'Accept, sharing nothing'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onDecline}>
          Decline
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onBlock}>
          Block
        </button>
      </div>
    </div>
  );
}

function ConnectedCard({
  connection,
  busy,
  onShare,
  onRemove,
}: {
  connection: Connection;
  busy: boolean;
  onShare: (share: ShareField[]) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [share, setShare] = useState<ShareField[]>(connection.iShare);
  const changed = share.length !== connection.iShare.length || share.some((f) => !connection.iShare.includes(f));
  return (
    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <strong>{connection.other.name}</strong>
        <span className="pill pill-green">
          <span className="pill-dot" />
          {STATUS_LABEL.accepted}
        </span>
        {connection.other.tapSlug && (
          <a href={`/t/${connection.other.tapSlug}`} style={{ fontSize: 12.5 }}>
            Their Tap
          </a>
        )}
      </div>
      <SharedByThem connection={connection} />
      <ShareChooser value={share} onChange={setShare} disabled={busy} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {changed && (
          <button type="button" className="btn btn-blue btn-sm" disabled={busy} onClick={() => void onShare(share)}>
            Save what you share
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
      {changed && <p className="field-hint" style={{ margin: 0 }}>Removing a detail stops them seeing it from now on. {UNSHARE_NOTE}</p>}
    </div>
  );
}
