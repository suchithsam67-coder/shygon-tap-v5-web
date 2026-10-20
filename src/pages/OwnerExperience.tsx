import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, CircleDashed, ExternalLink, Eye, Handshake, Layers, Nfc, PencilLine, ShieldAlert, Undo2 } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { ErrorState, Skeleton } from '../components/app/States';
import { useAccount } from '../lib/account-context';
import { useAuth } from '../lib/auth-context';
import type { CardRow } from '../lib/database.types';
import { cardStatusOf, fetchMyCards } from '../services/cards';
import { fetchPublicProfile } from '../lib/publicTapClient';
import type { PublicProfile } from '../lib/database.types';
import { AVAILABILITY_LABEL, liveModesFor, MODE_ORDER, MODES, type ModeId } from '../components/showroom/modes';
import { TAP_STATUS_HINTS, TAP_STATUS_LABELS } from '../services/tap';

/**
 * The owner's view of their AAROH experience: what a tap on their card opens,
 * mode by mode, and where to change each part.
 *
 * "What visitors see" is read from the very function the public page calls
 * (`get_public_profile`), and the modes are derived from it by the same code
 * the showroom uses (modes.ts). So this page cannot claim a mode is showing
 * when it is not: there is no second copy of the rules here. There are no
 * per-mode switches, because the backend has no mode model yet (FE-D8); a mode
 * appears when its details are published in the Tap editor, which the server
 * enforces.
 */

type Preview =
  | { kind: 'loading' }
  | { kind: 'shown'; data: PublicProfile }
  | { kind: 'not-live' }
  | { kind: 'error' };

const LIVE_MODES = MODE_ORDER.filter((id) => MODES[id].availability === 'available');
// Emergency has its own section; Privé is a demo; Verify and Access are not part of AAROH.
const LATER_MODES = MODE_ORDER.filter((id) => MODES[id].availability === 'coming-soon' && !['emergency', 'return', 'connect'].includes(id));

type Cards = { kind: 'loading' } | { kind: 'ready'; cards: CardRow[] } | { kind: 'error' };

export default function OwnerExperience() {
  const { tap, loading, setupRequired } = useAccount();
  const { user } = useAuth();
  const [cards, setCards] = useState<Cards>({ kind: 'loading' });
  const [cardsAttempt, setCardsAttempt] = useState(0);
  const [preview, setPreview] = useState<Preview>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const slug = tap?.slug ?? null;
  const live = tap?.status === 'active' && Boolean(slug);

  useEffect(() => {
    if (!slug || !live) return;
    let cancelled = false;
    fetchPublicProfile(slug)
      .then((data) => !cancelled && setPreview(data ? { kind: 'shown', data } : { kind: 'not-live' }))
      .catch(() => !cancelled && setPreview({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [slug, live, attempt]);

  // The owner's cards, as the server records them (RLS: own rows only).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMyCards(user.id)
      .then((rows) => !cancelled && setCards({ kind: 'ready', cards: rows }))
      .catch(() => !cancelled && setCards({ kind: 'error' }));
    return () => {
      cancelled = true;
    };
  }, [user, cardsAttempt]);

  const shown: ModeId[] = preview.kind === 'shown' ? liveModesFor(preview.data) : [];

  return (
    <AppShell
      eyebrow="SHYGON OS"
      title="Your AAROH experience"
      description="What a tap on your card opens, mode by mode, and where to change each part."
    >
      {loading ? (
        <div className="panel" style={{ padding: 24 }}>
          <Skeleton height={160} radius={18} />
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState title="Almost ready" message="We're finishing your SHYGON Tap setup. Please try again shortly." />
        </div>
      ) : !tap ? (
        <div className="panel">
          <ErrorState
            title="You don't have a Tap yet"
            message="Your AAROH experience is built from your Tap profile. Choose a digital experience to create one."
          />
          <div className="panel-body">
            <Link className="btn btn-blue btn-sm" to="/shygontap/tiers">
              Choose your Tap experience
            </Link>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 18, maxWidth: 760 }}>
          <section className="panel" aria-labelledby="ox-status">
            <div className="panel-head">
              <Eye size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-status">What visitors see</h2>
              </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={tap.status === 'active' ? 'pill pill-green' : 'pill pill-amber'}>
                  <span className="pill-dot" />
                  {TAP_STATUS_LABELS[tap.status]}
                </span>
                <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1, minWidth: 220 }}>{TAP_STATUS_HINTS[tap.status]}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {live && slug ? (
                  // Same-origin, so a preview on a staging or local host opens there too.
                  <a className="btn btn-blue btn-sm" href={`/t/${slug}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                    <ExternalLink size={14} aria-hidden="true" /> Preview your public experience
                  </a>
                ) : (
                  <button type="button" className="btn btn-blue btn-sm" disabled aria-describedby="ox-preview-why">
                    <ExternalLink size={14} aria-hidden="true" /> Preview your public experience
                  </button>
                )}
                <Link className="btn btn-ghost btn-sm" to="/shygontap/tap">
                  <PencilLine size={14} aria-hidden="true" /> Edit your Tap profile
                </Link>
              </div>
              {!live && (
                <p id="ox-preview-why" style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
                  Publish your Tap to preview it as visitors see it. Until then a tap on your card shows{' '}
                  {tap.status === 'paused' ? '“Temporarily unavailable”' : '“Tap not found”'}.
                </p>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-modes">
            <div className="panel-head">
              <Layers size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-modes">Modes on your card</h2>
                <p>Each mode appears when you publish the details it shows. Nothing here is switched on separately.</p>
              </div>
            </div>
            <div className="panel-body">
              {!live ? (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>
                  Publish your Tap to see which modes visitors get. The list is read from your live public page, so it is
                  only shown once there is one.
                </p>
              ) : preview.kind === 'loading' ? (
                <Skeleton height={120} radius={14} />
              ) : preview.kind === 'error' ? (
                <ErrorState title="We couldn't read your public page" message="Check your connection and try again." onRetry={() => setAttempt((n) => n + 1)} />
              ) : preview.kind === 'not-live' ? (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>Your public page is not live right now.</p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                  {LIVE_MODES.map((id) => {
                    const on = shown.includes(id);
                    return (
                      <li
                        key={id}
                        style={{
                          display: 'flex',
                          gap: 12,
                          alignItems: 'flex-start',
                          padding: '12px 14px',
                          borderRadius: 14,
                          border: '1px solid var(--line)',
                          background: 'var(--ds-surface-raised)',
                        }}
                      >
                        {on ? (
                          <CheckCircle2 size={18} aria-hidden="true" style={{ color: 'var(--ds-color-state-success, #16a34a)', marginTop: 2 }} />
                        ) : (
                          <CircleDashed size={18} aria-hidden="true" style={{ color: 'var(--muted)', marginTop: 2 }} />
                        )}
                        <span style={{ display: 'grid', gap: 3, flex: 1 }}>
                          <strong style={{ fontSize: 14.5 }}>
                            {MODES[id].name} <span style={{ fontWeight: 500, color: 'var(--muted)' }}>· {on ? 'Shown' : 'Not shown'}</span>
                          </strong>
                          <span style={{ fontSize: 13, color: 'var(--muted)' }}>{MODES[id].ownerHint}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-cards">
            <div className="panel-head">
              <Nfc size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-cards">Your cards</h2>
                <p>Each card’s state as SHYGON records it. AAROH card activation arrives with the card release.</p>
              </div>
            </div>
            <div className="panel-body">
              {cards.kind === 'loading' ? (
                <Skeleton height={56} radius={14} />
              ) : cards.kind === 'error' ? (
                <ErrorState title="We couldn't load your cards" message="Check your connection and try again." onRetry={() => setCardsAttempt((n) => n + 1)} />
              ) : cards.cards.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  No physical card is linked to your account. Your Tap works from its link and QR code; cards are coming soon.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {cards.cards.map((card) => {
                    const state = cardStatusOf(card);
                    return (
                      <li key={card.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13.5 }}>
                        <strong>{card.card_uid ? `Card ${card.card_uid}` : `Card ${card.id.slice(0, 8).toUpperCase()}`}</strong>
                        <span className={state.tone === 'ok' ? 'pill pill-green' : 'pill pill-amber'}>
                          <span className="pill-dot" />
                          {state.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div style={{ marginTop: 12 }}>
                <Link className="btn btn-ghost btn-sm" to="/shygontap/cards">
                  Manage your cards
                </Link>
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-emergency">
            <div className="panel-head">
              <ShieldAlert size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-emergency">Emergency contacts and alerts</h2>
                <p>Kept on SHYGON’s server. The emergency page shows whether text messages can be sent right now.</p>
              </div>
            </div>
            <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
              <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                Add emergency contacts, send them an alert, and see each contact’s status as the text-message provider reports
                it. SHYGON never contacts emergency services.
              </p>
              <div>
                <Link className="btn btn-ghost btn-sm" to="/shygontap/emergency">
                  Open emergency settings
                </Link>
              </div>
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-return">
            <div className="panel-head">
              <Undo2 size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-return">Return to owner</h2>
                <p>Off unless you turn it on, and not yet switched on by SHYGON. Not shown on your card until both are on.</p>
              </div>
            </div>
            <div className="panel-body">
              <Link className="btn btn-ghost btn-sm" to="/shygontap/return-to-owner">
                Open Return to owner
              </Link>
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-connect">
            <div className="panel-head">
              <Handshake size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-connect">Connect</h2>
                <p>Off unless you turn it on. Signed-in SHYGON accounts can then ask to connect from your card, and you choose what to share back.</p>
              </div>
            </div>
            <div className="panel-body">
              <Link className="btn btn-ghost btn-sm" to="/shygontap/connections">
                Open Connections
              </Link>
            </div>
          </section>

          <section className="panel" aria-labelledby="ox-later">
            <div className="panel-head">
              <CircleDashed size={19} aria-hidden="true" />
              <div>
                <h2 id="ox-later">Still to come</h2>
                <p>Not available yet, not included with a card, and no release date. None of these appear on your card.</p>
              </div>
            </div>
            <div className="panel-body">
              <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8, fontSize: 13.5 }}>
                {LATER_MODES.map((id) => (
                  <li key={id}>
                    <strong>{MODES[id].name}</strong> · {AVAILABILITY_LABEL[MODES[id].availability]}
                    {MODES[id].note && <span style={{ color: 'var(--muted)' }}> · {MODES[id].note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
