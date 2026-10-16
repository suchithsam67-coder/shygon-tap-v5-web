import { cloneElement, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Loader2 } from 'lucide-react';
import { useAuth } from '../../lib/auth-context';
import { createTicket } from '../../services/support';
import { AAROH_BULK_MINIMUM, AAROH_EDITIONS, AAROH_FINISHES, AAROH_PRODUCT_PATH } from '../../data/aaroh';
import { BULK_ORDER } from '../../data/aarohProduct';

/**
 * The bulk-order enquiry for AAROH (DEC-2026-037): an organisation ordering the
 * same card for its team, for example as employee ID cards.
 *
 * It uses the existing support backend: a signed-in customer opens a support
 * ticket (category "order"), which the team answers from the admin app and the
 * customer follows under Support. No new table, endpoint or product. Success is
 * shown only once the ticket and its message exist on the server.
 */

const MAX_QUANTITY = 100_000;
/** support_tickets.subject is 3–160 characters; support_messages.body at most 4000. */
const SUBJECT_MAX = 160;
const BODY_MAX = 4000;

interface Form {
  organisation: string;
  contactName: string;
  phone: string;
  email: string;
  quantity: string;
  edition: string;
  finish: string;
  customisation: string;
  notes: string;
}

type Errors = Partial<Record<keyof Form, string>>;

const ANY = 'any';

export default function BulkEnquiry({ id = 'teams' }: { id?: string }) {
  const { user, loading } = useAuth();
  const [form, setForm] = useState<Form>(() => ({
    organisation: '',
    contactName: '',
    phone: '',
    email: '',
    quantity: String(AAROH_BULK_MINIMUM),
    edition: ANY,
    finish: ANY,
    customisation: '',
    notes: '',
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [reference, setReference] = useState<string | null>(null);

  const set = (field: keyof Form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  function validate(): Errors {
    const next: Errors = {};
    const email = (form.email || user?.email || '').trim();
    if (!form.organisation.trim()) next.organisation = 'Enter your organisation’s name.';
    else if (form.organisation.trim().length > 120) next.organisation = 'Keep the name under 120 characters.';
    if (!form.contactName.trim()) next.contactName = 'Enter a contact person.';
    if (form.phone.replace(/\D/g, '').length < 10) next.phone = 'Enter a phone number with at least 10 digits.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Enter a valid email address.';
    const quantity = Number(form.quantity);
    if (!Number.isInteger(quantity) || quantity < AAROH_BULK_MINIMUM) next.quantity = `Bulk orders start at ${AAROH_BULK_MINIMUM} cards.`;
    else if (quantity > MAX_QUANTITY) next.quantity = 'For more than 100,000 cards, write to us directly.';
    if (form.customisation.length > 1500) next.customisation = 'Keep this under 1,500 characters.';
    if (form.notes.length > 1000) next.notes = 'Keep this under 1,000 characters.';
    return next;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || status === 'sending') return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const quantity = Number(form.quantity);
    const edition = AAROH_EDITIONS.find((item) => item.id === form.edition)?.title ?? 'Any edition';
    const finish = AAROH_FINISHES.find((item) => item.id === form.finish)?.title ?? 'Any finish';
    const subject = `Bulk order enquiry: ${form.organisation.trim()} (${quantity} AAROH cards)`.slice(0, SUBJECT_MAX);
    const message = [
      'AAROH bulk-order enquiry',
      '',
      `Organisation: ${form.organisation.trim()}`,
      `Contact person: ${form.contactName.trim()}`,
      `Phone: ${form.phone.trim()}`,
      `Email: ${(form.email || user.email || '').trim()}`,
      `Quantity: ${quantity}`,
      `Preferred edition: ${edition}`,
      `Preferred finish: ${finish}`,
      '',
      'Employee customisation:',
      form.customisation.trim() || '(none given)',
      '',
      'Other notes:',
      form.notes.trim() || '(none)',
    ]
      .join('\n')
      .slice(0, BODY_MAX);

    setStatus('sending');
    try {
      const ticket = await createTicket({ userId: user.id, subject, category: 'order', message });
      setReference(ticket.reference);
      setStatus('sent');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <section id={id} className="aaroh-section aaroh-bulk" aria-labelledby={`${id}-title`}>
      <header className="aaroh-section-head">
        <p className="aaroh-kicker">For organisations</p>
        <h2 id={`${id}-title`}>{BULK_ORDER.title}</h2>
        <p>{BULK_ORDER.lede}</p>
      </header>

      <div className="aaroh-bulk-grid">
        <div className="aaroh-bulk-info">
          <ul className="aaroh-ticks">
            {BULK_ORDER.points.map((point) => <li key={point}>{point}</li>)}
          </ul>
          <p className="aaroh-muted">{BULK_ORDER.limits}</p>
        </div>

        <div className="aaroh-bulk-panel">
          {status === 'sent' ? (
            <div className="aaroh-bulk-done" role="status">
              <Check size={22} aria-hidden="true" />
              <h3>Enquiry received</h3>
              <p>
                Your reference is <strong>{reference}</strong>. We reply in your support ticket and by email; you can
                follow it under Support in your account.
              </p>
              <Link to="/shygontap/support" className="btn btn-ghost">
                Open Support <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : loading ? (
            <p className="aaroh-muted">Loading…</p>
          ) : !user ? (
            <div className="aaroh-bulk-signin">
              <p>
                Sign in or create a free SHYGON account to send an enquiry. It opens a support ticket, so you can follow
                our reply.
              </p>
              <Link to="/shygontap/auth" state={{ from: `${AAROH_PRODUCT_PATH}#${id}` }} className="btn btn-blue">
                Sign in to send an enquiry <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <form className="aaroh-bulk-form" onSubmit={submit} noValidate>
              <Field id="bulk-organisation" label="Organisation" error={errors.organisation}>
                <input id="bulk-organisation" value={form.organisation} onChange={set('organisation')} autoComplete="organization" maxLength={120} required />
              </Field>
              <div className="aaroh-bulk-row">
                <Field id="bulk-contact" label="Contact person" error={errors.contactName}>
                  <input id="bulk-contact" value={form.contactName} onChange={set('contactName')} autoComplete="name" maxLength={120} required />
                </Field>
                <Field id="bulk-phone" label="Phone" error={errors.phone}>
                  <input id="bulk-phone" type="tel" value={form.phone} onChange={set('phone')} autoComplete="tel" maxLength={20} required />
                </Field>
              </div>
              <div className="aaroh-bulk-row">
                <Field id="bulk-email" label="Email" error={errors.email}>
                  <input
                    id="bulk-email"
                    type="email"
                    value={form.email}
                    placeholder={user.email ?? ''}
                    onChange={set('email')}
                    autoComplete="email"
                    maxLength={160}
                  />
                </Field>
                <Field id="bulk-quantity" label={`Number of cards (${AAROH_BULK_MINIMUM} or more)`} error={errors.quantity}>
                  <input id="bulk-quantity" type="number" inputMode="numeric" min={AAROH_BULK_MINIMUM} max={MAX_QUANTITY} step={1} value={form.quantity} onChange={set('quantity')} required />
                </Field>
              </div>
              <div className="aaroh-bulk-row">
                <Field id="bulk-edition" label="Preferred edition">
                  <select id="bulk-edition" value={form.edition} onChange={set('edition')}>
                    <option value={ANY}>Any edition, or a mix</option>
                    {AAROH_EDITIONS.map((edition) => <option key={edition.id} value={edition.id}>{edition.title}</option>)}
                  </select>
                </Field>
                <Field id="bulk-finish" label="Preferred finish">
                  <select id="bulk-finish" value={form.finish} onChange={set('finish')}>
                    <option value={ANY}>Not sure yet</option>
                    {AAROH_FINISHES.map((finish) => <option key={finish.id} value={finish.id}>{finish.title}</option>)}
                  </select>
                </Field>
              </div>
              <Field
                id="bulk-customisation"
                label="Employee customisation"
                hint="What should each employee’s profile show, for example name, photo, role, department and approved contact details?"
                error={errors.customisation}
              >
                <textarea id="bulk-customisation" rows={3} value={form.customisation} onChange={set('customisation')} maxLength={1500} />
              </Field>
              <Field id="bulk-notes" label="Anything else (optional)" error={errors.notes}>
                <textarea id="bulk-notes" rows={2} value={form.notes} onChange={set('notes')} maxLength={1000} />
              </Field>

              {status === 'failed' && (
                <p className="aaroh-bulk-error" role="alert">
                  Your enquiry was not sent. Check your connection and try again, or write to us from Support.
                </p>
              )}
              <button type="submit" className="btn btn-blue" disabled={status === 'sending'}>
                {status === 'sending' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
                {status === 'sending' ? 'Sending…' : 'Send enquiry'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactElement;
}) {
  return (
    <div className="aaroh-field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="aaroh-field-hint" id={`${id}-hint`}>{hint}</p>}
      {withA11y(children, { id, error, hint })}
      {error && (
        <p className="aaroh-field-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Ties a control to its hint and error, and marks it invalid when there is an error. */
function withA11y(control: React.ReactElement, { id, error, hint }: { id: string; error?: string; hint?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return cloneElement(control as React.ReactElement<Record<string, unknown>>, {
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  });
}
