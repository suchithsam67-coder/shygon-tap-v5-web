import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, Nfc, PhoneCall, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ConfirmDialog } from '../components/app/ConfirmDialog';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../lib/supabase';
import type { CardRow } from '../lib/database.types';
import { formatEdition } from '../lib/editions';
import { CARD_SALES_OPEN, CARDS_COMING_SOON } from '../lib/commerce';
import { cardArt, cardDesignNames, materialLabels, products, type MaterialId, type TierId } from '../data/shygonTapData';
import {
  CardOtpError,
  CardsError,
  cardStatusOf,
  fetchMyCards,
  listOwnerCards,
  reportCardStolen,
  requestCardOtp,
  verifyCardOtp,
  type CardAction,
  type OtpChallenge,
  type OwnerCard,
} from '../services/cards';
import { cardsMessageOf } from '../lib/cardWords';
import { LOST_RELEASED, PREVIEW_PAGES } from '../components/showroom/modes';
import { stillWaiting } from '../services/account';
import { usePhoneStatus } from '../hooks/usePhoneStatus';
import { VERIFY_PHONE_PATH, cardPhoneProblem, whenUsable } from '../lib/phoneVerification';

/**
 * The customer's NFC cards: status, and activation / deactivation confirmed by
 * a one-time password sent to the mobile number on the account. The change
 * itself is made on the server (card-otp function, migration 015), which also
 * alerts the SHYGON admin panel. Since v0.13 the code goes only to a verified
 * number, so the page says so before a click, and the dialog explains the two
 * phone refusals (not verified; changed recently) in our words.
 *
 * v0.15 (DEC-2026-047): the server's list (C-6) says which cards have a secure
 * chip. Such a card is activated only by tapping it (the /d/<code> page), so it
 * gets no code buttons here: the database would refuse the change without an
 * error. Any card can be reported stolen (C-8), terminal for the owner. A card
 * without a chip keeps opening the Tap's address after that (F3), and the page
 * says so.
 */

/** A card as this page shows it: the table row, and the server's view of it (chip or not). */
type Row = { card: CardRow; owner: OwnerCard | null; chip: boolean };

/** Lost mode is offered only where it is released (or in a preview build). */
const LOST_MODE_OPEN = LOST_RELEASED || PREVIEW_PAGES;

const date = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const statusOf = cardStatusOf;

const cardName = (card: CardRow) =>
  card.card_uid ? `Card ${card.card_uid}` : `Card ${card.id.slice(0, 8).toUpperCase()}`;

/** What "Report stolen" will do to this card, said before it is done. */
const stolenWarning = (chip: boolean) =>
  chip
    ? 'It is switched off for good: tapping it will open nothing. Only SHYGON support can undo this, with a replacement card.'
    : `It is switched off for good. This card has no secure chip, so tapping it will still open your Tap: to protect your Tap, pause it in Settings${LOST_MODE_OPEN ? ' or switch it to Lost mode' : ''}. Only SHYGON support can undo this.`;

/** The line under a card's status. */
function cardLine({ card, chip }: Row): string {
  if (card.status === 'retired') {
    return chip
      ? `Reported stolen${card.deactivated_at ? ` on ${date(card.deactivated_at)}` : ''}. It opens nothing. Contact SHYGON support for a replacement.`
      : `Reported stolen${card.deactivated_at ? ` on ${date(card.deactivated_at)}` : ''}. It has no secure chip, so tapping it still opens your Tap.`;
  }
  if (chip) {
    if (card.status === 'pending' || card.status === 'shipped' || !card.status) {
      return 'To activate it, sign in to SHYGON on your phone, then tap the card on the phone.';
    }
    if (card.status === 'active') return card.activated_at ? `Active since ${date(card.activated_at)}` : 'Active';
    if (card.status === 'suspended') return 'Switched off. Contact SHYGON support to turn it back on.';
  }
  if (card.status === 'active' && card.activation_expires_at) return `Active until ${date(card.activation_expires_at)}`;
  if (card.status === 'suspended' && card.deactivated_at) return `Deactivated on ${date(card.deactivated_at)}`;
  if (card.activated_at) return `Last activated ${date(card.activated_at)}`;
  return 'Activate it to make your Tap open when the card is tapped.';
}

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

  // The table's rows, and the server's list (C-6) for which have a chip. Both,
  // or neither: without the server's word a chip card would get code buttons
  // that cannot work, so a failed list is an error with a retry.
  const { data, loading, error, reload, refresh } = useAsync(
    async (): Promise<Row[]> => {
      if (!user) return [];
      const [rows, server] = await Promise.all([fetchMyCards(user.id), listOwnerCards()]);
      const byId = new Map(server.cards.map((card) => [card.id, card]));
      return rows.map((card) => {
        const owner = byId.get(card.id) ?? null;
        // Unknown to the server: treated as a chip card, so no code buttons are offered.
        return { card, owner, chip: owner ? owner.verifiedTap.registered : true };
      });
    },
    {
      enabled: Boolean(user),
      deps: [user?.id],
      onError: (err) => (err instanceof CardsError ? cardsMessageOf(err) : describeError(err)),
    },
  );
  const cards = data ?? [];
  // While card sales are closed (D-10) a customer without a card has nothing
  // to activate here, so the OTP set-up advice would be a dead end.
  const cardsExpected = CARD_SALES_OPEN || cards.length > 0;
  // Code activation is only for cards without a chip; the phone notes are for them.
  const codeCards = cards.some((row) => !row.chip);
  const chipCards = cards.some((row) => row.chip);
  const codeExpected = CARD_SALES_OPEN || codeCards;
  // Whether the number can take a card code (v0.13 §4b). A failed read shows
  // nothing here; the dialog still explains a refusal.
  const phone = usePhoneStatus(user?.id, profile?.phone, Boolean(profile?.phone) && codeExpected);
  const [pending, setPending] = useState<{ card: CardRow; action: CardAction } | null>(null);
  const [stolen, setStolen] = useState<Row | null>(null);
  const [retiring, setRetiring] = useState(false);

  async function retire() {
    if (!stolen || retiring) return;
    setRetiring(true);
    try {
      await reportCardStolen(stolen.card.id);
      toast.success(
        'Card switched off',
        stolen.chip ? 'Tapping it now opens nothing.' : 'It still opens your Tap: pause your Tap in Settings to stop that.',
      );
      setStolen(null);
      refresh();
    } catch (failure) {
      // Switched off already (another tab): show it as it is.
      if (failure instanceof CardsError && failure.code === 'card_retired') {
        setStolen(null);
        refresh();
        return;
      }
      toast.error('Could not switch the card off', cardsMessageOf(failure));
    } finally {
      setRetiring(false);
    }
  }

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
      description="Activate your NFC cards, and report one stolen. A card with a secure chip is activated by tapping it; any other card with a one-time code sent to your verified mobile number."
    >
      {!profile?.phone && codeExpected && (
        <section className="panel card-otp-phone-note" role="note">
          <PhoneCall size={18} aria-hidden="true" />
          <p>
            Add your mobile number in <Link to="/shygontap/settings">Settings</Link> first. We send the one-time code
            to that number.
          </p>
        </section>
      )}
      {profile?.phone && codeExpected && phone && phone.phone && !phone.verified && (
        <section className="panel card-otp-phone-note" role="note" data-testid="cards-phone-unverified">
          <PhoneCall size={18} aria-hidden="true" />
          <p>
            Verify your mobile number before you change a card: we send the one-time code only to a verified number.{' '}
            <Link to={VERIFY_PHONE_PATH}>Verify your phone</Link>
          </p>
        </section>
      )}
      {codeExpected && phone?.verified && stillWaiting(phone) && phone.usableFrom && (
        <section className="panel card-otp-phone-note" role="note" data-testid="cards-phone-waiting">
          <Clock size={18} aria-hidden="true" />
          <p>
            Your mobile number changed recently. For your security, it can confirm card changes from{' '}
            {whenUsable(phone.usableFrom)}.
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
            description="Your card appears here once your order is prepared. You can then activate it."
            action={
              <Link to="/shygontap/orders" className="btn btn-ghost btn-sm">
                View orders
              </Link>
            }
          />
        ) : (
          <ul className="card-list">
            {cards.map((row) => {
              const { card, chip } = row;
              const status = statusOf(card);
              const design = designOf(card);
              const over = card.status === 'replaced' || card.status === 'retired';
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
                    {chip && <span className="card-list-design">Secure chip</span>}
                    {formatEdition(card) && (
                      <span className="card-edition">Limited edition · {formatEdition(card)}</span>
                    )}
                    <span className={`card-status card-status-${status.tone}`}>{status.label}</span>
                    <small>{cardLine(row)}</small>
                  </div>
                  <div className="card-list-actions">
                    {!chip && !over && (
                      <button
                        type="button"
                        className="btn btn-blue btn-sm"
                        onClick={() => setPending({ card, action: 'activate' })}
                      >
                        <ShieldCheck size={15} aria-hidden="true" />
                        {card.status === 'active' ? 'Renew activation' : 'Activate'}
                      </button>
                    )}
                    {!chip && card.status === 'active' && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setPending({ card, action: 'deactivate' })}
                      >
                        <ShieldOff size={15} aria-hidden="true" /> Deactivate
                      </button>
                    )}
                    {!over && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setStolen(row)}>
                        <ShieldAlert size={15} aria-hidden="true" /> Report stolen
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
        <p className="card-otp-footnote" data-testid="cards-footnote">
          Stolen? Report it here.{chipCards && ' A card with a secure chip then opens nothing.'}
          {(codeCards || CARD_SALES_OPEN) && (
            <>
              {' '}
              A card without one keeps opening your Tap&apos;s address, so also pause your Tap in{' '}
              <Link to="/shygontap/settings">Settings</Link>.
            </>
          )}
          {LOST_MODE_OPEN && (
            <>
              {' '}
              Lost it, and hoping it comes back? Switch your Tap to <Link to="/shygontap/mode">Lost mode</Link> so a finder can
              return it.
            </>
          )}
          {(codeCards || CARD_SALES_OPEN) && ' An activation with a code lasts 14 days; renew it any time.'}
        </p>
      )}

      <ConfirmDialog
        open={stolen !== null}
        title="Report this card stolen?"
        description={stolen ? stolenWarning(stolen.chip) : undefined}
        confirmLabel="Switch it off for good"
        tone="danger"
        icon={<ShieldAlert size={20} />}
        busy={retiring}
        onConfirm={() => void retire()}
        onCancel={() => setStolen(null)}
      />

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

export function OtpDialog({
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
  const [needsVerify, setNeedsVerify] = useState(false);
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
      // The phone refusals (v0.13) in our words; their retryAfter is hours away,
      // not a resend countdown.
      const phoneProblem = cardPhoneProblem(err.details?.code, err.details?.retryAfter);
      setMessage(phoneProblem?.message ?? err.message);
      setNeedsPhone(Boolean(err.details?.needsPhone));
      setNeedsVerify(phoneProblem?.link === 'verify');
      if (err.details?.retryAfter && !phoneProblem) setResendIn(err.details.retryAfter);
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
                {needsVerify && <Link to={VERIFY_PHONE_PATH}>Verify your phone</Link>}
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
