import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Nfc, PhoneCall, ShieldCheck, ShieldOff } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../lib/supabase';
import type { CardRow } from '../lib/database.types';
import { formatEdition } from '../lib/editions';
import { CARD_SALES_OPEN, CARDS_COMING_SOON } from '../lib/commerce';
import { cardArt, cardDesignNames, materialLabels, products, type MaterialId, type TierId } from '../data/shygonTapData';
import {
  CardOtpError,
  cardStatusOf,
  fetchMyCards,
  requestCardOtp,
  verifyCardOtp,
  type CardAction,
  type OtpChallenge,
} from '../services/cards';

/**
 * The customer's NFC cards: status, and activation / deactivation confirmed by
 * a one-time password sent to the mobile number on the account. The change
 * itself is made on the server (card-otp function, migration 015), which also
 * alerts the SHYGON admin panel.
 */

const date = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const statusOf = cardStatusOf;

const cardName = (card: CardRow) =>
  card.card_uid ? `Card ${card.card_uid}` : `Card ${card.id.slice(0, 8).toUpperCase()}`;

/** The card's design from its SKU (card-<product>-<finish>-<material>), when it is one of ours. */
function designOf(card: CardRow) {
  const match = /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(card.sku ?? '');
  const product = match ? products.find((item) => item.id === match[1]) : undefined;
  if (!match || !product) return null;
  const tier = match[2] as TierId;
  const material = match[3] as MaterialId;
  return { src: cardArt(product, material, tier), label: `${cardDesignNames[product.id]} · ${materialLabels[material]}` };
}

export default function Cards() {
  const { user } = useAuth();
  const { profile } = useAccount();
  const toast = useToast();

  const { data, loading, error, reload, refresh } = useAsync(
    () => (user ? fetchMyCards(user.id) : Promise.resolve([] as CardRow[])),
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );
  const cards = data ?? [];
  // While card sales are closed (D-10) a customer without a card has nothing
  // to activate here, so the OTP set-up advice would be a dead end.
  const cardsExpected = CARD_SALES_OPEN || cards.length > 0;
  const [pending, setPending] = useState<{ card: CardRow; action: CardAction } | null>(null);

  const done = useCallback(
    (action: CardAction) => {
      setPending(null);
      toast.success(action === 'activate' ? 'Card activated' : 'Card deactivated', 'Confirmed by the code sent to your phone.');
      refresh();
    },
    [refresh, toast],
  );

  return (
    <AppShell
      eyebrow="Your SHYGON Tap"
      title="Your cards"
      description="Activate or deactivate your NFC card. Every change is confirmed with a one-time code sent to your registered mobile number."
    >
      {!profile?.phone && cardsExpected && (
        <section className="panel card-otp-phone-note" role="note">
          <PhoneCall size={18} aria-hidden="true" />
          <p>
            Add your mobile number in <Link to="/shygontap/settings">Settings</Link> first. We send the one-time code
            to that number.
          </p>
        </section>
      )}

      <section className="panel">
        {loading ? (
          <SkeletonRows rows={2} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : cards.length === 0 && !CARD_SALES_OPEN ? (
          <EmptyState
            icon={<Nfc size={22} />}
            title={CARDS_COMING_SOON.title}
            description="You can't order a physical card yet. Your digital Tap works without one: share its link or its QR code."
            action={
              <Link to="/shygontap/qr" className="btn btn-ghost btn-sm">
                Get your QR code
              </Link>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<Nfc size={22} />}
            title="No cards yet"
            description="Your card appears here once your order is prepared. You can then activate it with a one-time code."
            action={
              <Link to="/shygontap/orders" className="btn btn-ghost btn-sm">
                View orders
              </Link>
            }
          />
        ) : (
          <ul className="card-list">
            {cards.map((card) => {
              const status = statusOf(card);
              const design = designOf(card);
              return (
                <li key={card.id} className="card-list-row reveal-on-scroll">
                  {design ? (
                    <span className={`card-list-art card-list-art-${status.tone}`} aria-hidden="true">
                      <img src={design.src} alt="" loading="lazy" />
                    </span>
                  ) : (
                    <span className={`card-chip card-chip-${status.tone}`} aria-hidden="true">
                      <Nfc size={18} />
                    </span>
                  )}
                  <div className="card-list-main">
                    <strong>{cardName(card)}</strong>
                    {design && <span className="card-list-design">{design.label}</span>}
                    {formatEdition(card) && (
                      <span className="card-edition">Limited edition · {formatEdition(card)}</span>
                    )}
                    <span className={`card-status card-status-${status.tone}`}>{status.label}</span>
                    <small>
                      {card.status === 'active' && card.activation_expires_at
                        ? `Active until ${date(card.activation_expires_at)}`
                        : card.status === 'suspended' && card.deactivated_at
                          ? `Deactivated on ${date(card.deactivated_at)}`
                          : card.activated_at
                            ? `Last activated ${date(card.activated_at)}`
                            : 'Activate it to make your Tap open when the card is tapped.'}
                    </small>
                  </div>
                  <div className="card-list-actions">
                    {card.status !== 'replaced' && (
                      <button
                        type="button"
                        className="btn btn-blue btn-sm"
                        onClick={() => setPending({ card, action: 'activate' })}
                      >
                        <ShieldCheck size={15} aria-hidden="true" />
                        {card.status === 'active' ? 'Renew activation' : 'Activate'}
                      </button>
                    )}
                    {card.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setPending({ card, action: 'deactivate' })}
                      >
                        <ShieldOff size={15} aria-hidden="true" /> Deactivate
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {cardsExpected && (
        <p className="card-otp-footnote">
          Lost your card? Deactivate it here straight away — tapping it will stop opening your Tap. An activation
          lasts 14 days; renew it any time.
        </p>
      )}

      {pending && (
        <OtpDialog
          card={pending.card}
          action={pending.action}
          onCancel={() => setPending(null)}
          onDone={() => done(pending.action)}
        />
      )}
    </AppShell>
  );
}

type Phase = 'sending' | 'entering' | 'verifying' | 'success' | 'blocked';

function OtpDialog({
  card,
  action,
  onCancel,
  onDone,
}: {
  card: CardRow;
  action: CardAction;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('sending');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('');
  const [needsPhone, setNeedsPhone] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const verb = action === 'activate' ? 'Activate' : 'Deactivate';

  const send = useCallback(async () => {
    setPhase('sending');
    setMessage('');
    setCode('');
    try {
      const next = await requestCardOtp(card.id, action);
      setChallenge(next);
      setResendIn(next.resendAfter);
      setPhase('entering');
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (error) {
      const err = error as CardOtpError;
      setMessage(err.message);
      setNeedsPhone(Boolean(err.details?.needsPhone));
      if (err.details?.retryAfter) setResendIn(err.details.retryAfter);
      setPhase(challenge ? 'entering' : 'blocked');
    }
  }, [action, card.id, challenge]);

  // Send the first code as the dialog opens.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, [send]);

  // Resend countdown.
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendIn]);

  // Focus, Escape and scroll lock, like ConfirmDialog.
  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
      restoreTo.current?.focus();
    };
  }, [onCancel]);

  async function verify(value = code) {
    if (!challenge || value.length !== 6 || phase === 'verifying') return;
    setPhase('verifying');
    setMessage('');
    try {
      await verifyCardOtp(challenge.challengeId, value);
      setPhase('success');
      window.setTimeout(onDone, 1400);
    } catch (error) {
      setMessage((error as CardOtpError).message);
      setCode('');
      setPhase('entering');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  return (
    <div
      className="modal-scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && phase !== 'verifying') onCancel();
      }}
    >
      <div className="modal otp-modal" role="dialog" aria-modal="true" aria-labelledby="otp-title">
        {phase === 'success' ? (
          <div className="otp-success" role="status">
            <CheckCircle2 size={44} aria-hidden="true" />
            <h2 id="otp-title">{action === 'activate' ? 'Card activated' : 'Card deactivated'}</h2>
            <p>{cardName(card)} is {action === 'activate' ? 'active' : 'deactivated'}.</p>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void verify();
            }}
          >
            <div className={`state-icon ${action === 'deactivate' ? 'state-icon-warn' : ''}`}>
              {action === 'activate' ? <ShieldCheck size={20} /> : <ShieldOff size={20} />}
            </div>
            <h2 id="otp-title">
              {verb} {cardName(card)}
            </h2>

            {phase === 'sending' && (
              <p className="otp-hint" role="status">
                <Loader2 size={15} className="spin" aria-hidden="true" /> Sending a code to your registered number…
              </p>
            )}

            {challenge && phase !== 'sending' && (
              <p className="otp-hint">
                Enter the 6-digit code we texted to <strong>{challenge.phone}</strong>. It expires in 10 minutes.
              </p>
            )}

            {challenge?.devCode && (
              <p className="otp-dev" role="note">
                {challenge.devNote} Code: <code>{challenge.devCode}</code>
              </p>
            )}

            {challenge && phase !== 'blocked' && (
              <label className="otp-field">
                <span className="sr-only">One-time code</span>
                <input
                  ref={inputRef}
                  value={code}
                  onChange={(event) => {
                    const next = event.target.value.replace(/\D/g, '').slice(0, 6);
                    setCode(next);
                    if (next.length === 6) void verify(next);
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="••••••"
                  aria-invalid={Boolean(message)}
                  aria-describedby={message ? 'otp-error' : undefined}
                  disabled={phase === 'verifying'}
                  required
                />
              </label>
            )}

            {message && (
              <p id="otp-error" className="otp-error" role="alert">
                {message}{' '}
                {needsPhone && <Link to="/shygontap/settings">Open Settings</Link>}
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={phase === 'verifying'}>
                Cancel
              </button>
              {challenge && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void send()}
                  disabled={resendIn > 0 || phase === 'sending' || phase === 'verifying'}
                >
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
                </button>
              )}
              {challenge && phase !== 'blocked' && (
                <button
                  type="submit"
                  className={`btn ${action === 'deactivate' ? 'btn-danger' : 'btn-blue'}`}
                  disabled={code.length !== 6 || phase === 'verifying'}
                >
                  {phase === 'verifying' ? (
                    <>
                      <Loader2 size={15} className="spin" aria-hidden="true" /> Checking…
                    </>
                  ) : (
                    `${verb} card`
                  )}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
