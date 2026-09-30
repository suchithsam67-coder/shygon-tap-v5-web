import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Infinity as InfinityIcon, Loader2, Lock, Palette, Sparkles } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { describeError } from '../lib/supabase';
import { experiencePrice, fetchCatalog, priceLabel, rupees, type Catalog } from '../services/catalog';
import { CheckoutError, startCheckout } from '../services/payments';
import { ENTITLEMENT_STATE_LABELS, entitlementState, ownsExperience } from '../services/entitlements';
import { EXPERIENCE_LABELS, saveTap } from '../services/tap';
import { EXPERIENCE_ORDER, type Experience } from '../lib/database.types';
import { useAsync } from '../hooks/useAsync';

/**
 * Digital experiences.
 *
 * An experience unlocks the instant the server has fulfilled the order — there
 * is no client-side flag anywhere in this page. What the customer owns is read
 * fresh from the database after every purchase, and the selected experience is
 * separately clamped down to it server-side in `get_public_profile()`, so even
 * a tampered selection cannot render above what was paid for.
 *
 * The ₹999 Customization Pass is sold here too, and is deliberately NOT an
 * experience: it buys unlimited editing and every colour palette, not the
 * catalogue.
 */

const EXPERIENCE_COPY: Record<Experience, { blurb: string; features: string[] }> = {
  essential: {
    blurb: 'Clean, simple and fast. Included with every SHYGON Tap.',
    features: ['Name, photo and bio', 'Call, WhatsApp and email', 'Opens instantly — no animation'],
  },
  business: {
    blurb: 'A professional profile built around your role and company.',
    features: ['Everything in Essential', 'Role and company block', 'Professional opening animation'],
  },
  premium: {
    blurb: 'Premium presentation with a cinematic opening and a wider palette.',
    features: ['Everything in Business', 'Cinematic opening + depth', '8 palettes, 3 layouts'],
  },
  goat: {
    blurb: 'Greatest of all time. Maximum customization and a UI that adapts to you.',
    features: ['Everything in Premium', 'Signature opening animation', 'All 12 palettes · adaptive UI'],
  },
};

export default function Tiers() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tap, entitlements, loading: accountLoading, setupRequired, refresh, setTap } = useAccount();
  const toast = useToast();

  const [busy, setBusy] = useState<Experience | 'pass' | null>(null);

  const {
    data: catalog,
    loading,
    error: loadError,
    reload: load,
  } = useAsync<Catalog>(fetchCatalog, {
    onError: (err) => describeError(err, 'We could not load the digital experiences.'),
  });

  /** Selecting an experience the customer already owns only changes which renders. */
  async function applyOwned(experience: Experience) {
    if (!user || !tap) return;
    setBusy(experience);
    try {
      setTap(await saveTap(user.id, { selected_ui_tier: experience }));
      toast.success('Experience updated', `Your Tap now opens in ${EXPERIENCE_LABELS[experience]}.`);
    } catch (err) {
      toast.error('Could not switch experience', describeError(err));
    } finally {
      setBusy(null);
    }
  }

  async function purchase(experience: Experience) {
    const product = experiencePrice(catalog, experience);
    if (!product) {
      toast.error(
        'Experience unavailable',
        "This experience isn't currently available for your Tap. Please contact support.",
      );
      return;
    }

    setBusy(experience);
    try {
      // The wire still says `planId` because that is the field the order API and
      // every historical order row use. Since migration 004 the plan id and the
      // experience id are the same string.
      await startCheckout({ orderType: 'digitalUpgrade', planId: experience });
      await refresh();
      if (user) setTap(await saveTap(user.id, { selected_ui_tier: experience }));
      toast.success('Upgrade complete', `Your Tap now opens in ${EXPERIENCE_LABELS[experience]}.`);
    } catch (err) {
      handleError(err, 'Upgrade');
    } finally {
      setBusy(null);
    }
  }

  async function buyPass() {
    if (!catalog?.pass) {
      toast.error('Unavailable', 'The Customization Pass is not available right now.');
      return;
    }
    setBusy('pass');
    try {
      await startCheckout({ orderType: 'lifetimeCustomization' });
      await refresh();
      toast.success(
        'Customization Pass active',
        'Edit your Tap whenever you like, and every colour palette is unlocked.',
      );
    } catch (err) {
      handleError(err, 'Purchase');
    } finally {
      setBusy(null);
    }
  }

  function handleError(err: unknown, what: string) {
    if (err instanceof CheckoutError) {
      // A dismissed Razorpay modal is not a failure worth an error toast.
      if (err.kind === 'cancelled') {
        toast.info('Payment cancelled', "You haven't been charged.");
        return;
      }
      toast.error(`${what} failed`, err.message);
      return;
    }
    toast.error(`${what} failed`, describeError(err));
  }

  const passPrice = catalog?.pass?.priceInPaise ?? null;

  return (
    <AppShell
      eyebrow="Digital experience"
      title="Choose how your Tap opens"
      description="Four experiences, one physical card. Upgrading changes the presentation of your Tap — you never buy another card. What your public Tap renders is decided by the server, not by this page."
    >
      {loading || accountLoading ? (
        <div className="tier-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="panel" style={{ padding: 20 }}>
              <Skeleton height={92} radius={15} />
              <div style={{ height: 14 }} />
              <Skeleton height={16} width="60%" />
            </div>
          ))}
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Digital experiences are almost ready"
            message="We're finishing your SHYGON Tap setup. Your account is safe — please try again shortly."
          />
        </div>
      ) : loadError || !catalog ? (
        <div className="panel">
          <ErrorState message={loadError ?? undefined} onRetry={load} />
        </div>
      ) : (
        <>
          <div className="tier-grid">
            {EXPERIENCE_ORDER.map((experience, i) => {
              const owns = ownsExperience(entitlements, experience);
              const state = entitlementState(entitlements, experience, tap?.selected_ui_tier);
              const product = experiencePrice(catalog, experience);
              const copy = EXPERIENCE_COPY[experience];
              const working = busy === experience;

              return (
                <button
                  key={experience}
                  type="button"
                  className="tier-card reveal"
                  style={{ ['--i' as string]: i }}
                  aria-pressed={state === 'active'}
                  disabled={busy !== null}
                  onClick={() => {
                    if (!tap) {
                      toast.error(
                        'No Tap profile yet',
                        'Purchase a SHYGON Tap to get your profile, then choose an experience.',
                      );
                      return;
                    }
                    if (owns) void applyOwned(experience);
                    else void purchase(experience);
                  }}
                >
                  <div className={`tier-swatch tier-swatch-${experience}`}>
                    {EXPERIENCE_LABELS[experience]}
                  </div>
                  <h3>{EXPERIENCE_LABELS[experience]}</h3>
                  <p>{copy.blurb}</p>

                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
                    {copy.features.map((feature) => (
                      <li
                        key={feature}
                        style={{
                          display: 'flex',
                          gap: 7,
                          alignItems: 'flex-start',
                          fontSize: 12,
                          color: 'var(--muted)',
                        }}
                      >
                        <Check size={13} style={{ marginTop: 2, flexShrink: 0, color: 'var(--blue)' }} />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <div className="tier-price">
                    {owns ? (
                      <span className={state === 'active' ? 'pill pill-blue' : 'pill pill-green'}>
                        <Check size={12} /> {ENTITLEMENT_STATE_LABELS[state]}
                      </span>
                    ) : product ? (
                      <>
                        <strong>{priceLabel(product.priceInPaise)}</strong>
                        <span className={state === 'available' ? 'pill pill-amber' : 'pill'}>
                          {state === 'available' ? null : <Lock size={11} />}
                          {ENTITLEMENT_STATE_LABELS[state]}
                        </span>
                      </>
                    ) : (
                      <span className="pill">Not available</span>
                    )}
                  </div>

                  {working && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(255,255,255,.7)',
                        display: 'grid',
                        placeItems: 'center',
                        borderRadius: 'inherit',
                      }}
                    >
                      <Loader2 size={22} className="spin" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ------------------------------------------- ₹999 Customization Pass */}
          <section
            className={entitlements.pass ? 'panel panel-success' : 'panel panel-accent'}
            style={{ marginTop: 20 }}
          >
            <div className="panel-body">
              <div
                style={{
                  display: 'flex',
                  gap: 18,
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                  <span className="pill pill-blue" style={{ marginBottom: 10 }}>
                    <InfinityIcon size={12} /> ONE-TIME PURCHASE
                  </span>
                  <h2 style={{ margin: '0 0 6px', fontSize: 22, letterSpacing: '-.02em' }}>
                    Customization Pass
                    {passPrice !== null && (
                      <>
                        {' — '}
                        <strong style={{ fontWeight: 800 }}>{rupees(passPrice)}</strong>
                      </>
                    )}
                  </h2>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.65 }}>
                    Without the Pass you can change your Tap once every 14 days. With it, edit as
                    often as you like and every colour palette is unlocked on whichever experience
                    you are on. One payment, no subscription, verified on our server before anything
                    unlocks.
                  </p>

                  <ul
                    style={{
                      listStyle: 'none',
                      display: 'grid',
                      gap: 8,
                      margin: '16px 0 0',
                      padding: 0,
                    }}
                  >
                    <li style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <Check size={15} color="var(--ds-color-state-success)" /> Unlimited profile edits
                    </li>
                    <li style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                      <Palette size={15} color="var(--ds-color-state-success)" /> All 12 colour palettes
                    </li>
                  </ul>

                  <p style={{ margin: '14px 0 0', color: 'var(--muted)', fontSize: 12 }}>
                    The Pass does not include Business, Premium or GOAT — those are separate
                    upgrades above.
                  </p>
                </div>

                <div style={{ flex: '0 0 auto' }}>
                  {entitlements.pass ? (
                    <span className="pill pill-green" style={{ fontSize: 12, padding: '10px 14px' }}>
                      <Check size={14} /> Active on your account
                    </span>
                  ) : (
                    <button
                      className="btn btn-blue"
                      onClick={() => void buyPass()}
                      disabled={busy !== null || !catalog.pass}
                    >
                      {busy === 'pass' ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                      {busy === 'pass'
                        ? 'Opening Razorpay…'
                        : passPrice !== null
                          ? `Get the Pass · ${rupees(passPrice)}`
                          : 'Get the Pass'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
            <div
              className="panel-body"
              style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Palette size={19} color="var(--blue)" />
              <p style={{ margin: 0, flex: 1, minWidth: 220, color: 'var(--muted)', fontSize: 13 }}>
                Colours, layout, buttons and fonts are set in the customizer.
              </p>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/customize')}>
                Open customizer
              </button>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
