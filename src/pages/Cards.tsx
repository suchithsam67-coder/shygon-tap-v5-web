import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MapPinOff,
  Nfc,
  PencilLine,
  PhoneCall,
  RefreshCcw,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../lib/supabase';
import type { CardRow } from '../lib/database.types';
import { formatEdition } from '../lib/editions';
import { cardArt, cardDesignNames, materialLabels, products, type MaterialId, type TierId } from '../data/shygonTapData';
import {
  CardOtpError,
  cardStatusOf,
  fetchMyCards,
  reportCardLost,
  requestCardOtp,
  setCardNickname,
  verifyCardOtp,
  type CardAction,
  type OtpChallenge,
} from '../services/cards';
import { cardUrl, formatCardCode, tapLabel } from '../services/tap';

/**
 * The customer's NFC cards.
 *
 * Every card has a permanent Card ID (migration 019): its chip opens
 * /c/<Card ID>, which opens the card's own page and counts the tap against
 * the card. From here a customer names a card, activates or deactivates it
 * (confirmed by a one-time code — card-otp, migration 015), reports it lost,
 * and orders a replacement that opens the same page.
 */

const date = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const cardName = (card: CardRow) =>
  card.nickname
    ? card.nickname
    : card.card_code
      ? `Card ${formatCardCode(card.card_code)}`
      : card.card_uid
        ? `Card ${card.card_uid}`
        : `Card ${card.id.slice(0, 8).toUpperCase()}`;

/** The card's design from its SKU (card-<product>-<finish>-<material>), when it is one of ours. */
function designOf(card: CardRow) {
  const match = /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(card.sku ?? '');
  const product = match ? products.find((item) => item.id === match[1]) : undefined;
  if (!match || !product) return null;
  const tier = match[2] as TierId;
  const material = match[3] as MaterialId;
  return {
    product,
    tier,
    material,
    src: cardArt(product, material, tier),
    label: `${cardDesignNames[product.id]} · ${materialLabels[material]}`,
  };
}

const PENDING_KEY = 'shygon_pending_order';

export default function Cards() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, taps, selectTap } = useAccount();
  const toast = useToast();

  const { data, loading, error, reload, refresh } = useAsync(
    () => (user ? fetchMyCards(user.id) : Promise.resolve([] as CardRow[])),
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );
  const cards = data ?? [];
  const [pending, setPending] = useState<{ card: CardRow; action: CardAction } | null>(null);
  const [losing, setLosing] = useState<CardRow | null>(null);
  const [lostBusy, setLostBusy] = useState(false);
  const [naming, setNaming] = useState<{ id: string; value: string } | null>(null);
  const [nameBusy, setNameBusy] = useState(false);

  const done = useCallback(
    (action: CardAction) => {
      setPending(null);
      toast.success(action === 'activate' ? 'Card activated' : 'Card deactivated', 'Confirmed by your one-time code.');
      refresh();
    },
    [refresh, toast],
  );

  async function saveName() {
    if (!naming) return;
    setNameBusy(true);
    try {
      await setCardNickname(naming.id, naming.value);
      setNaming(null);
      refresh();
      toast.success('Card renamed');
    } catch (err) {
      toast.error('Could not rename the card', describeError(err));
    } finally {
      setNameBusy(false);
    }
  }

  async function confirmLost() {
    if (!losing) return;
    setLostBusy(true);
    try {
      await reportCardLost(losing.id);
      toast.success('Card reported lost', 'It is switched off. You can order a replacement for the same page.');
      setLosing(null);
      refresh();
    } catch (err) {
      toast.error('Could not report the card', describeError(err));
    } finally {
      setLostBusy(false);
    }
  }

  /** A replacement is a normal card order for the same design, linked to the old card. */
  function orderReplacement(card: CardRow) {
    const design = designOf(card);
    if (!design) {
      toast.error('Contact support to replace this card', 'It was made before online replacements.');
      return;
    }
    try {
      localStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
          orderType: 'physical',
          productId: design.product.id,
          material: design.material,
          tier: design.tier,
          planId: 'essential',
          replacesCardId: card.id,
          replacesCardCode: card.card_code ?? null,
        }),
      );
      window.dispatchEvent(new Event('shygon-cart-updated'));
    } catch {
      /* storage unavailable: checkout will send them back */
    }
    navigate('/shygontap/checkout');
  }

  function copyCardLink(card: CardRow) {
    if (!card.card_code) return;
    void navigator.clipboard.writeText(cardUrl(card.card_code));
    toast.success('Card link copied', 'This is the address written to the card’s NFC chip.');
  }

  return (
    <AppShell
      eyebrow="Your SHYGON Tap"
      title="My cards"
      description="Every card has its own Card ID and its own page. Name them, see when they were last tapped, switch them on or off, and replace a lost one without changing its page."
    >
      {!profile?.phone && (
        <section className="panel card-otp-phone-note" role="note">
          <PhoneCall size={18} aria-hidden="true" />
          <p>
            Add your mobile number in <Link to="/shygontap/settings">Settings</Link> to get your one-time codes by text
            message.
          </p>
        </section>
      )}

      <section className="panel">
        {loading ? (
          <SkeletonRows rows={2} />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : cards.length === 0 ? (
          <EmptyState
            icon={<Nfc size={22} />}
            title="No cards yet"
            description="Your card appears here once your order is paid. You can then activate it with a one-time code."
            action={
              <Link to="/shygontap/orders" className="btn btn-ghost btn-sm">
                View orders
              </Link>
            }
          />
        ) : (
          <ul className="card-list">
            {cards.map((card) => {
              const status = cardStatusOf(card);
              const design = designOf(card);
              const page = taps.find((tap) => tap.id === card.tap_profile_id);
              const replaced = card.status === 'replaced';
              const lost = Boolean(card.lost_at);
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
                    {naming?.id === card.id ? (
                      <form
                        className="card-name-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveName();
                        }}
                      >
                        <input
                          className="input"
                          value={naming.value}
                          maxLength={40}
                          autoFocus
                          aria-label="Card name"
                          placeholder="e.g. Front desk"
                          onChange={(event) => setNaming({ id: card.id, value: event.target.value })}
                        />
                        <button type="submit" className="btn btn-blue btn-sm" disabled={nameBusy}>
                          {nameBusy ? <Loader2 size={14} className="spin" /> : 'Save'}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(null)} disabled={nameBusy}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <strong className="card-name-row">
                        {cardName(card)}
                        {!replaced && (
                          <button
                            type="button"
                            className="card-name-edit"
                            aria-label={`Rename ${cardName(card)}`}
                            onClick={() => setNaming({ id: card.id, value: card.nickname ?? '' })}
                          >
                            <PencilLine size={13} />
                          </button>
                        )}
                      </strong>
                    )}
                    {design && <span className="card-list-design">{design.label}</span>}
                    {card.card_code && (
                      <span className="card-list-design">
                        Card ID <b className="card-code">{formatCardCode(card.card_code)}</b>
                        {page && (
                          <>
                            {' · opens '}
                            <button
                              type="button"
                              className="card-page-link"
                              title="Edit this page"
                              onClick={() => {
                                selectTap(page.id);
                                navigate('/shygontap/tap');
                              }}
                            >
                              {tapLabel(page)}
                            </button>
                          </>
                        )}
                      </span>
                    )}
                    {formatEdition(card) && (
                      <span className="card-edition">Limited edition · {formatEdition(card)}</span>
                    )}
                    <span className={`card-status card-status-${status.tone}`}>{status.label}</span>
                    <small>
                      {replaced
                        ? `Replaced${card.replaced_at ? ` on ${date(card.replaced_at)}` : ''}. Its replacement opens the same page.`
                        : lost
                          ? `Reported lost on ${date(card.lost_at)}. It no longer opens your page.`
                          : card.status === 'active' && card.activation_expires_at
                            ? `Active until ${date(card.activation_expires_at)}`
                            : card.status === 'suspended' && card.deactivated_at
                              ? `Deactivated on ${date(card.deactivated_at)}`
                              : card.activated_at
                                ? `Last activated ${date(card.activated_at)}`
                                : 'Activate it to make your page open when the card is tapped.'}
                    </small>
                    {typeof card.tap_count === 'number' && (
                      <small>
                        {card.tap_count === 0
                          ? 'Not tapped yet'
                          : `Tapped ${card.tap_count.toLocaleString('en-IN')} time${card.tap_count === 1 ? '' : 's'}`}
                        {card.last_tapped_at ? ` · last tapped ${date(card.last_tapped_at)}` : ''}
                      </small>
                    )}
                  </div>
                  <div className="card-list-actions">
                    {!replaced && (
                      <button
                        type="button"
                        className="btn btn-blue btn-sm"
                        onClick={() => setPending({ card, action: 'activate' })}
                      >
                        <ShieldCheck size={15} aria-hidden="true" />
                        {card.status === 'active' ? 'Renew activation' : lost ? 'Found it — activate' : 'Activate'}
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
                    {!replaced && !lost && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLosing(card)}>
                        <MapPinOff size={15} aria-hidden="true" /> Report lost
                      </button>
                    )}
                    {!replaced && (lost || card.status === 'suspended') && design && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => orderReplacement(card)}>
                        <RefreshCcw size={15} aria-hidden="true" /> Order replacement
                      </button>
                    )}
                    {card.card_code && !replaced && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyCardLink(card)}>
                          <Copy size={15} aria-hidden="true" /> Card link
                        </button>
                        {card.status === 'active' && !lost && (
                          <a
                            className="btn btn-ghost btn-sm"
                            href={cardUrl(card.card_code)}
                            target="_blank"
                            rel="noreferrer"
                            style={{ textDecoration: 'none' }}
                          >
                            <ExternalLink size={15} aria-hidden="true" /> Test tap
                          </a>
                        )}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="card-otp-footnote">
        Lost a card? Report it lost here straight away — tapping it stops opening your page at once — then order a
        replacement: the new card opens the same page, with the same address and analytics. An activation lasts 14
        days; renew it any time.
      </p>

      {pending && (
        <OtpDialog
          card={pending.card}
          action={pending.action}
          onCancel={() => setPending(null)}
          onDone={() => done(pending.action)}
        />
      )}

      <ConfirmDialog
        open={Boolean(losing)}
        title={`Report ${losing ? cardName(losing) : 'this card'} lost?`}
        description="The card is switched off immediately: tapping it will no longer open your page. Your page, its address and your QR code keep working. If you find the card, you can activate it again with a one-time code."
        confirmLabel="Report lost"
        tone="danger"
        icon={<MapPinOff size={20} />}
        busy={lostBusy}
        onConfirm={() => void confirmLost()}
        onCancel={() => setLosing(null)}
      />
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

  const byEmail = challenge?.channel === 'email';

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
                <Loader2 size={15} className="spin" aria-hidden="true" /> Sending your one-time code…
              </p>
            )}

            {challenge && phase !== 'sending' && (
              <p className="otp-hint">
                Enter the 6-digit code we {byEmail ? 'emailed' : 'texted'} to{' '}
                <strong>{challenge.destination ?? challenge.phone}</strong>. It expires in 10 minutes.
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
