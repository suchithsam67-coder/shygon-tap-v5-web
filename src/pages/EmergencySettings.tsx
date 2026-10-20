import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, History, Phone, ShieldAlert, Trash2, UserPlus, Users } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { ErrorState, Skeleton } from '../components/app/States';
import {
  EmergencyError,
  RECIPIENT_LABEL,
  cancelAlert,
  confirmVerification,
  createAlert,
  eventHeadline,
  getAlert,
  inFlight,
  listAlerts,
  listContacts,
  newIdempotencyKey,
  removeContact,
  reportAlert,
  requestVerification,
  retryAlert,
  saveContact,
  setPublicAlerts,
  type EmergencyContact,
  type EmergencyEvent,
  type EmergencySettings as Settings,
  type EventSummary,
} from '../services/emergency';

/**
 * Emergency contacts and alerts, for the signed-in owner (AAROH-API v0.1 §10).
 *
 * Everything here is read from and written to the server: `/api/emergency`,
 * which checks the session on every call. The page shows only what the server
 * confirmed: a contact appears once saved, "verified" only after the server
 * says so, and an alert's state is the server's, per contact, in words that
 * never upgrade it ("sent" is accepted by the provider, never "delivered").
 * Numbers only ever arrive masked; nothing is kept in the browser.
 *
 * Today no text-message provider is configured, so codes and alerts report
 * "nothing was sent" (contract §10.7); the page says so up front.
 */

const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';

/** A moment `seconds` from now, as a timestamp (kept out of render). */
const secondsFromNow = (seconds: number) => Date.now() + seconds * 1000;

const SAFETY_FALLBACK = 'SHYGON does not contact emergency services. If someone is in danger, call 112.';

function messageOf(error: unknown): string {
  if (error instanceof EmergencyError) {
    if (error.code === 'provider_not_configured') return 'Text messages are not set up for SHYGON yet, so nothing can be sent.';
    const wait = error.details.retryAfter;
    if (wait) return `${error.message} Try again in ${Math.max(1, Math.ceil(wait / 60))} min.`;
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

type Load = { kind: 'loading' } | { kind: 'ready'; contacts: EmergencyContact[]; settings: Settings } | { kind: 'error'; message: string };

export default function EmergencySettings() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  const read = useCallback(
    () =>
      listContacts().then(
        ({ contacts, settings }): Load => ({ kind: 'ready', contacts, settings }),
        (error): Load => ({ kind: 'error', message: messageOf(error) }),
      ),
    [],
  );
  /** After a change: re-read, so the page shows what the server now holds. */
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
      title="Emergency contacts and alerts"
      description="Add the people to alert in an emergency, send them an alert, and see what actually happened to it."
    >
      <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
        <section className="panel" aria-labelledby="em-112">
          <div className="panel-head">
            <Phone size={19} aria-hidden="true" />
            <div>
              <h2 id="em-112">In an emergency, call 112</h2>
              <p>SHYGON never contacts the police, an ambulance or the fire service. Alerts go only to the contacts you add here.</p>
            </div>
          </div>
          <div className="panel-body">
            <a className="btn btn-blue btn-sm" href="tel:112" style={{ textDecoration: 'none' }}>
              <Phone size={14} aria-hidden="true" /> Call 112
            </a>
          </div>
        </section>

        {load.kind === 'loading' ? (
          <div className="panel" style={{ padding: 24 }}>
            <Skeleton height={140} radius={18} />
          </div>
        ) : load.kind === 'error' ? (
          <div className="panel">
            <ErrorState title="We couldn't load your emergency settings" message={load.message} onRetry={() => setAttempt((n) => n + 1)} />
          </div>
        ) : (
          <>
            {!load.settings.providerConfigured && (
              <section className="panel panel-warning" role="status" aria-labelledby="em-provider">
                <div className="panel-head">
                  <ShieldAlert size={19} aria-hidden="true" />
                  <div>
                    <h2 id="em-provider">Text messages are not set up yet</h2>
                    <p>
                      You can add contacts now, but SHYGON cannot send verification codes or alerts until a text-message
                      provider is connected. Anything you send shows “Nothing was sent”.
                    </p>
                  </div>
                </div>
              </section>
            )}
            <AlertPanel settings={load.settings} onChanged={refresh} />
            <ContactsPanel contacts={load.contacts} settings={load.settings} onChanged={refresh} />
            <VisitorAlertsPanel settings={load.settings} onChanged={refresh} />
          </>
        )}

        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          <Link to="/shygontap/experience">Back to your AAROH experience</Link>
        </p>
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------
   Sending an alert, and what happened to it
   ------------------------------------------------------------------------- */

function AlertPanel({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A confirmed send that failed on the network: "Try again" resends that same intent.
  const [retryable, setRetryable] = useState(false);
  const [event, setEvent] = useState<EmergencyEvent | null>(null);
  const [safety, setSafety] = useState<string | null>(null);
  const [history, setHistory] = useState<EventSummary[] | null>(null);
  // One key per intent: made when the owner opens the confirmation, reused if
  // that same send has to be retried after a network failure, then dropped.
  const intent = useRef<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistory(await listAlerts(10).then((r) => r.events, () => null));
  }, []);

  useEffect(() => {
    let live = true;
    void listAlerts(10).then(
      (r) => live && setHistory(r.events),
      () => live && setHistory(null),
    );
    return () => {
      live = false;
    };
  }, []);

  // While an alert is still moving, re-read it from the server.
  useEffect(() => {
    if (!event || !inFlight(event.status)) return;
    const timer = window.setTimeout(async () => {
      try {
        setEvent((await getAlert(event.id)).event);
      } catch {
        /* the next tick, or Refresh, tries again */
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [event]);

  const send = async () => {
    if (busy) return;
    intent.current ??= newIdempotencyKey();
    setBusy(true);
    setError(null);
    setRetryable(false);
    try {
      const result = await createAlert(intent.current);
      setEvent(result.event);
      setSafety(result.safety);
      intent.current = null;
      setConfirming(false);
      void loadHistory();
    } catch (failure) {
      if (failure instanceof EmergencyError && failure.code === 'alert_in_progress' && failure.details.eventId) {
        // One is already under way: show that one instead of starting another.
        intent.current = null;
        setConfirming(false);
        try {
          setEvent((await getAlert(failure.details.eventId)).event);
        } catch {
          /* shown below */
        }
      } else if (failure instanceof EmergencyError && failure.code === 'network') {
        // Same intent, same key: whether or not the first request arrived, a
        // retry cannot send a second alert.
        setRetryable(true);
      } else {
        intent.current = null;
      }
      // Close the confirmation so the outcome is visible, not hidden behind it.
      setConfirming(false);
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: () => Promise<{ event: EmergencyEvent }>) => {
    setBusy(true);
    setError(null);
    try {
      setEvent((await action()).event);
      void loadHistory();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  const noContacts = settings.verifiedContacts === 0;

  return (
    <section className="panel" aria-labelledby="em-alert">
      <div className="panel-head">
        <BellRing size={19} aria-hidden="true" />
        <div>
          <h2 id="em-alert">Alert your contacts</h2>
          <p>Sends a text to every verified contact saying you have asked for help.</p>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        <div>
          <button
            type="button"
            className="btn btn-danger"
            disabled={noContacts || busy}
            aria-describedby={noContacts ? 'em-alert-why' : undefined}
            onClick={() => {
              intent.current = null;
              setError(null);
              setRetryable(false);
              setConfirming(true);
            }}
          >
            <BellRing size={15} aria-hidden="true" /> Alert my emergency contacts
          </button>
          {noContacts && (
            <p id="em-alert-why" className="field-hint">
              Add a contact and verify their number first. Only verified contacts are ever alerted.
            </p>
          )}
        </div>

        {error && (
          <div role="alert" style={{ display: 'grid', gap: 8 }}>
            <p className="field-error" style={{ margin: 0 }}>
              {error}
            </p>
            {retryable && (
              <div>
                <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void send()}>
                  Try again
                </button>
              </div>
            )}
          </div>
        )}

        {event && (
          <EventCard
            event={event}
            safety={safety}
            busy={busy}
            onRefresh={() => act(() => getAlert(event.id))}
            onRetry={() => act(() => retryAlert(event.id))}
            onStop={() => act(() => cancelAlert(event.id))}
            onReport={async () => {
              setBusy(true);
              try {
                await reportAlert(event.id);
                setEvent((await getAlert(event.id)).event);
                await onChanged();
              } catch (failure) {
                setError(messageOf(failure));
              } finally {
                setBusy(false);
              }
            }}
          />
        )}

        {history && history.length > 0 && (
          <div>
            <h3 style={{ margin: '4px 0 8px', fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
              <History size={15} aria-hidden="true" /> Recent alerts
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {history.map((item) => (
                <li key={item.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
                  <span>{when(item.createdAt)}</span>
                  <span style={{ color: 'var(--muted)' }}>· {item.initiator === 'public' ? 'from a visitor' : 'by you'} ·</span>
                  <span>{eventHeadline(item.status, item.counts.total)}</span>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => getAlert(item.id))}>
                    Details
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        tone="danger"
        icon={<BellRing size={22} />}
        title="Alert your emergency contacts?"
        description={`Your ${settings.verifiedContacts} verified ${settings.verifiedContacts === 1 ? 'contact gets' : 'contacts get'} a text saying you have asked for help and want them to contact you now. SHYGON does not contact emergency services: if you are in danger, call 112.`}
        confirmLabel={busy ? 'Sending…' : 'Send the alert'}
        busy={busy}
        onConfirm={() => void send()}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
      />
    </section>
  );
}

function EventCard({
  event,
  safety,
  busy,
  onRefresh,
  onRetry,
  onStop,
  onReport,
}: {
  event: EmergencyEvent;
  safety: string | null;
  busy: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onStop: () => void;
  onReport: () => void;
}) {
  // alerts.retry re-sends only what never left SHYGON for lack of a provider
  // (contract §10.4; emergency_requeue_not_sent). A provider's refusal is final.
  const canRetry = event.recipients.some((r) => r.status === 'not_sent');
  const refused = event.recipients.some((r) => r.status === 'failed' || r.status === 'undelivered');
  return (
    <div
      aria-live="polite"
      data-testid="emergency-event"
      style={{ padding: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--ds-surface-raised)', display: 'grid', gap: 10 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 15 }}>{eventHeadline(event.status, event.recipients.length)}</strong>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {event.initiator === 'public' ? 'From a visitor' : 'Sent by you'} · {when(event.createdAt)}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {event.recipients.map((r) => (
          <li key={r.id} style={{ fontSize: 13, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <strong>{r.name}</strong>
            <span style={{ color: 'var(--muted)' }}>{r.phone}</span>
            <span>· {RECIPIENT_LABEL[r.status] ?? 'Status unknown'}</span>
            {r.status === 'retry_wait' && r.nextAttemptAt && <span style={{ color: 'var(--muted)' }}>· next try {when(r.nextAttemptAt)}</span>}
            {r.lastError && r.status !== 'delivered' && <span style={{ color: 'var(--muted)' }}>· {r.lastError}</span>}
          </li>
        ))}
      </ul>
      {refused && (
        <p className="field-hint" style={{ margin: 0 }}>
          A message the provider refused or could not deliver is not sent again automatically. Check that contact’s number, and
          call them directly if you need to.
        </p>
      )}
      {event.deliveryReceipts === 'not_supported' && event.status === 'sent' && (
        <p className="field-hint" style={{ margin: 0 }}>
          This provider does not send delivery receipts, so “Sent” is the last status you will see.
        </p>
      )}
      <p className="field-hint" style={{ margin: 0 }}>
        {safety ?? SAFETY_FALLBACK}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRefresh}>
          Refresh
        </button>
        {canRetry && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onRetry}>
            Try sending again
          </button>
        )}
        {inFlight(event.status) && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onStop} aria-describedby={`stop-${event.id}`}>
            Stop
          </button>
        )}
        {event.initiator === 'public' && !event.reportedAt && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onReport}>
            Report as unwanted
          </button>
        )}
      </div>
      {inFlight(event.status) && (
        <p id={`stop-${event.id}`} className="field-hint" style={{ margin: 0 }}>
          Stop holds back messages not yet sent. A text the provider already accepted cannot be recalled.
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------
   Contacts
   ------------------------------------------------------------------------- */

const EMPTY = { name: '', relationship: '', phone: '' };

function ContactsPanel({ contacts, settings, onChanged }: { contacts: EmergencyContact[]; settings: Settings; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<{ field: 'name' | 'relationship' | 'phone' | null; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<EmergencyContact | null>(null);
  const [verifying, setVerifying] = useState<{ contactId: string; phone: string; expiresAt: string; resendAt: number } | null>(null);
  const [code, setCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!verifying) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [verifying]);

  const full = !editing && contacts.length >= settings.maxContacts;

  const submit = async () => {
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const result = await saveContact({
        contactId: editing ?? undefined,
        name: form.name.trim(),
        relationship: form.relationship.trim() || null,
        phone: form.phone.trim(),
      });
      setForm(EMPTY);
      setEditing(null);
      setNotice(
        result.publicAlertsDisabled
          ? `${result.contact.name} was saved. Visitor alerts were switched off, because no verified contact is left.`
          : `${result.contact.name} was saved${result.contact.verified ? '' : '. Verify the number before they can be alerted'}.`,
      );
      await onChanged();
    } catch (failure) {
      const fieldOf = (code: string) =>
        code === 'invalid_name' ? 'name' : code === 'invalid_relationship' ? 'relationship' : code === 'invalid_phone' || code === 'duplicate_contact' ? 'phone' : null;
      setFormError({ field: failure instanceof EmergencyError ? fieldOf(failure.code) : null, message: messageOf(failure) });
    } finally {
      setSaving(false);
    }
  };

  const startVerify = async (contactId: string) => {
    setVerifyError(null);
    setCode('');
    try {
      const challenge = await requestVerification(contactId);
      setVerifying({ contactId, phone: challenge.phone, expiresAt: challenge.expiresAt, resendAt: secondsFromNow(challenge.resendAfter) });
    } catch (failure) {
      setVerifying(null);
      setVerifyError(messageOf(failure));
    }
  };

  const finishVerify = async () => {
    if (!verifying) return;
    setVerifyError(null);
    try {
      await confirmVerification(verifying.contactId, code.trim());
      setVerifying(null);
      setCode('');
      setNotice('Number verified. This contact can now be alerted.');
      await onChanged();
    } catch (failure) {
      const left = failure instanceof EmergencyError ? failure.details.attemptsLeft : undefined;
      setVerifyError(`${messageOf(failure)}${left !== undefined ? ` ${left} ${left === 1 ? 'try' : 'tries'} left.` : ''}`);
    }
  };

  const fieldProps = (field: 'name' | 'relationship' | 'phone') => ({
    'aria-invalid': formError?.field === field ? true : undefined,
    'aria-describedby': formError?.field === field ? 'em-form-error' : undefined,
  });

  return (
    <section className="panel" aria-labelledby="em-contacts">
      <div className="panel-head">
        <Users size={19} aria-hidden="true" />
        <div>
          <h2 id="em-contacts">Your emergency contacts</h2>
          <p>
            Up to {settings.maxContacts}. {settings.verifiedContacts} of {settings.contacts} verified. Numbers are shown masked; SHYGON
            keeps the full number on its server only.
          </p>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
        {notice && (
          <p role="status" style={{ margin: 0, fontSize: 13.5 }}>
            <CheckCircle2 size={14} aria-hidden="true" style={{ verticalAlign: -2 }} /> {notice}
          </p>
        )}

        {contacts.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>No contacts yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
            {contacts.map((contact) => (
              <li
                key={contact.id}
                style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--ds-surface-raised)', display: 'grid', gap: 8 }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{contact.name}</strong>
                  {contact.relationship && <span style={{ color: 'var(--muted)', fontSize: 13 }}>· {contact.relationship}</span>}
                  <span style={{ fontSize: 13 }}>{contact.phone}</span>
                  <span className={contact.verified ? 'pill pill-green' : 'pill pill-amber'}>
                    <span className="pill-dot" />
                    {contact.verified ? 'Verified' : 'Not verified'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!contact.verified && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void startVerify(contact.id)}>
                      Verify number
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditing(contact.id);
                      // The number is never sent to the browser in full, so editing asks for it again.
                      setForm({ name: contact.name, relationship: contact.relationship ?? '', phone: '' });
                      setFormError(null);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoving(contact)}>
                    <Trash2 size={13} aria-hidden="true" /> Remove
                  </button>
                </div>
                {verifying?.contactId === contact.id && (
                  <form
                    style={{ display: 'grid', gap: 8 }}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void finishVerify();
                    }}
                  >
                    <label className="field" style={{ margin: 0 }}>
                      <span>Code sent to {verifying.phone}</span>
                      <input
                        className="input"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      />
                      <p className="field-hint">Ask {contact.name} for the 6-digit code. It expires at {when(verifying.expiresAt)}.</p>
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button type="submit" className="btn btn-blue btn-sm" disabled={code.length !== 6}>
                        Confirm code
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={now < verifying.resendAt}
                        onClick={() => void startVerify(contact.id)}
                      >
                        {now < verifying.resendAt ? `Send again in ${Math.ceil((verifying.resendAt - now) / 1000)} s` : 'Send the code again'}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

        {verifyError && (
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {verifyError}
          </p>
        )}

        {full ? (
          <p className="field-hint" style={{ margin: 0 }}>
            You have the maximum of {settings.maxContacts} contacts. Remove one to add another.
          </p>
        ) : (
          <form
            style={{ display: 'grid', gap: 4 }}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h3 style={{ margin: '4px 0 8px', fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
              <UserPlus size={15} aria-hidden="true" /> {editing ? 'Edit contact' : 'Add a contact'}
            </h3>
            <label className="field">
              <span>Name</span>
              <input className="input" required maxLength={80} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} {...fieldProps('name')} />
            </label>
            <label className="field">
              <span>Relationship (optional)</span>
              <input
                className="input"
                maxLength={40}
                value={form.relationship}
                onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
                {...fieldProps('relationship')}
              />
            </label>
            <label className="field">
              <span>Mobile number</span>
              <input
                className="input"
                required
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="+91 98765 43210"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                {...fieldProps('phone')}
              />
              <p className="field-hint">An Indian mobile number, or any number in +country format. Changing it clears its verification.</p>
            </label>
            {formError && (
              <p id="em-form-error" className="field-error" role="alert" style={{ margin: '0 0 8px' }}>
                {formError.message}
              </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-blue btn-sm" disabled={saving}>
                {saving ? 'Saving…' : editing ? 'Save changes' : 'Add contact'}
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY);
                    setFormError(null);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        tone="danger"
        title={`Remove ${removing?.name ?? 'this contact'}?`}
        description="They will no longer be alerted. If they are your last verified contact, visitor alerts switch off too."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removing) return;
          const target = removing;
          setRemoving(null);
          setNotice(null);
          try {
            const result = await removeContact(target.id);
            setNotice(result.publicAlertsDisabled ? `${target.name} was removed. Visitor alerts were switched off.` : `${target.name} was removed.`);
            await onChanged();
          } catch (failure) {
            setFormError({ field: null, message: messageOf(failure) });
          }
        }}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

/* -------------------------------------------------------------------------
   Visitor alerts (owner opt-in, default off)
   ------------------------------------------------------------------------- */

function VisitorAlertsPanel({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turningOn = !settings.publicAlertsEnabled;

  return (
    <section className="panel" aria-labelledby="em-visitors">
      <div className="panel-head">
        <ShieldAlert size={19} aria-hidden="true" />
        <div>
          <h2 id="em-visitors">Alerts from people who tap your card</h2>
          <p>
            {settings.publicAlertsEnabled ? 'On.' : 'Off.'} When on, someone holding your card could alert your verified contacts
            without ever seeing who they are. Even when on, it works only once SHYGON enables visitor alerts, which it has not yet.
          </p>
        </div>
      </div>
      <div className="panel-body" style={{ display: 'grid', gap: 10 }}>
        <div>
          <button
            type="button"
            className={turningOn ? 'btn btn-blue btn-sm' : 'btn btn-ghost btn-sm'}
            disabled={busy || (turningOn && settings.verifiedContacts === 0)}
            onClick={() => {
              setError(null);
              setAsking(true);
            }}
          >
            {turningOn ? 'Turn visitor alerts on' : 'Turn visitor alerts off'}
          </button>
          {turningOn && settings.verifiedContacts === 0 && <p className="field-hint">Verify at least one contact first.</p>}
        </div>
        {error && (
          <p className="field-error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
      </div>
      <ConfirmDialog
        open={asking}
        tone={turningOn ? 'danger' : 'default'}
        title={turningOn ? 'Turn visitor alerts on?' : 'Turn visitor alerts off?'}
        description={
          turningOn
            ? 'Anyone who opens your SHYGON profile could alert your verified contacts; SHYGON cannot confirm emergencies; limited to 3 per day.'
            : 'Visitors will no longer be able to alert your contacts.'
        }
        confirmLabel={turningOn ? 'Turn on' : 'Turn off'}
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          setError(null);
          try {
            await setPublicAlerts(turningOn);
            setAsking(false);
            await onChanged();
          } catch (failure) {
            setAsking(false);
            setError(messageOf(failure));
          } finally {
            setBusy(false);
          }
        }}
        onCancel={() => {
          if (!busy) setAsking(false);
        }}
      />
    </section>
  );
}
