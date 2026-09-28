import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Eye,
  LifeBuoy,
  Package,
  QrCode as QrCodeIcon,
  Share2,
  Sparkles,
  TrendingUp,
  UserRound,
} from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { useAccount } from '../lib/account-context';
import { useToast } from '../components/app/toast-context';
import { ErrorState, Skeleton } from '../components/app/States';
import { QrCodeCanvas } from '../components/app/QrCode';
import {
  fetchOrders,
  isAbandonedCheckout,
  orderTotalPaise,
  paymentTone,
  PAYMENT_STATUS_LABELS,
  type OrderWithItems,
} from '../services/orders';
import { EXPERIENCE_LABELS, TAP_STATUS_HINTS, TAP_STATUS_LABELS, tapUrl } from '../services/tap';
import { cardArt, digitalPlans, products, materialLabels, tierLabels, CUSTOMIZATION_PASS_PRICE, type MaterialId, type TierId } from '../data/shygonTapData';
import { rupees } from '../services/catalog';
import { toExperience } from '../lib/database.types';

const PENDING_KEY = 'shygon_pending_order';

/**
 * The customer dashboard.
 *
 * Deliberately action-first rather than a wall of statistics: the Tap, its
 * status and the four things a customer actually does with it come before any
 * numbers. Every value here comes from the account context or a direct query —
 * nothing is a placeholder, and there is no button whose handler is empty.
 */
export default function Account() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, tap, entitlements, editState, loading, setupRequired, error, refresh } =
    useAccount();
  const toast = useToast();

  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // Read once, in the initialiser: an effect would render the banner-less
  // state first and then flip it in.
  const [pendingOrder] = useState<null | { orderType?: string; productId?: string; material?: string; tier?: string; planId?: string; total?: number }>(() => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  });
  const hasPending = Boolean(pendingOrder);
  const [showQr, setShowQr] = useState(false);
  const pendingProduct = pendingOrder?.productId ? products.find((item) => item.id === pendingOrder.productId) : null;
  const pendingPlan = pendingOrder?.planId ? digitalPlans.find((item) => item.id === pendingOrder.planId) : null;
  const pendingIsPass = pendingOrder?.orderType === 'lifetimeCustomization';
  const pendingTotal = typeof pendingOrder?.total === 'number' && Number.isFinite(pendingOrder.total)
    ? pendingOrder.total
    : pendingIsPass ? CUSTOMIZATION_PASS_PRICE : null;


  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function load() {
      setOrdersLoading(true);
      setOrdersError(null);
      try {
        const result = await fetchOrders(user!.id, 5);
        if (!cancelled) setOrders(result);
      } catch {
        if (!cancelled) {
          setOrdersError(
            navigator.onLine === false
              ? "You're offline, so we couldn't load your recent orders."
              : 'We could not load your recent orders. Please try again shortly.',
          );
        }
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const firstName = profile?.full_name?.split(' ')[0] || 'there';
  const status = tap?.status ?? 'draft';
  const experience = toExperience(tap?.selected_ui_tier);

  function copyLink() {
    if (!tap?.slug) return;
    void navigator.clipboard.writeText(tapUrl(tap.slug));
    toast.success('Link copied');
  }

  async function share() {
    if (!tap?.slug) return;
    const url = tapUrl(tap.slug);
    if (navigator.share) {
      try {
        await navigator.share({ title: tap.display_name || 'My SHYGON Tap', url });
        return;
      } catch {
        /* share sheet dismissed */
      }
    }
    copyLink();
  }

  /**
   * Getting from "purchased" to "live" — the only onboarding there is. Each
   * step is derived from real state, so it disappears on its own as the
   * customer completes it rather than needing to be dismissed.
   */
  const steps = tap
    ? [
        { label: 'Complete your profile', done: Boolean(tap.display_name), to: '/shygontap/tap' },
        { label: 'Claim your Tap address', done: Boolean(tap.slug), to: '/shygontap/tap' },
        { label: 'Choose your experience', done: experience !== 'essential' || entitlements.owned.length > 1, to: '/shygontap/tiers' },
        { label: 'Preview and publish', done: status === 'active', to: '/shygontap/tap' },
      ]
    : [];
  const onboardingDone = steps.every((step) => step.done);

  return (
    <AppShell
      eyebrow="Your account"
      title={`Hello, ${firstName}`}
      description="Your Tap, your experience and everything behind it."
    >
      {hasPending && (
        <section className="panel panel-warning" style={{ marginBottom: 18 }}>
          <div
            className="panel-body"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ minWidth: 0, flex: '1 1 420px' }}>
              <p className="pill pill-amber" style={{ marginBottom: 8 }}>Action required</p>
              <strong style={{ fontSize: 15 }}>You have an unfinished purchase</strong>
              <p style={{ margin: '4px 0 10px', color: 'var(--muted)', fontSize: 13 }}>
                Your selection is saved and nothing has been charged. Review it below and continue when you're ready.
              </p>
              <div style={{ display: 'grid', gap: 5, fontSize: 13 }}>
                {pendingProduct && <span><strong>Card:</strong> {pendingProduct.name}</span>}
                {pendingOrder?.material && <span><strong>Material:</strong> {materialLabels[pendingOrder.material as keyof typeof materialLabels] ?? pendingOrder.material}</span>}
                {pendingOrder?.tier && <span><strong>Finish:</strong> {tierLabels[pendingOrder.tier as keyof typeof tierLabels] ?? pendingOrder.tier}</span>}
                {pendingPlan && <span><strong>Digital UI:</strong> {pendingPlan.name}</span>}
                {pendingIsPass && <span><strong>Upgrade:</strong> Customization Pass</span>}
                {pendingTotal !== null && <span><strong>Saved total:</strong> ₹{pendingTotal.toLocaleString('en-IN')}</span>}
              </div>
            </div>
            {pendingProduct && pendingOrder?.material && (
              <div style={{ width: 96, height: 72, borderRadius: 14, background: 'var(--ds-surface-raised)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: '0 0 auto' }}>
                <img src={cardArt(pendingProduct, pendingOrder.material as MaterialId, (pendingOrder.tier as TierId) || 'standard')} alt="" style={{ maxWidth: '92%', maxHeight: '92%', objectFit: 'contain' }} />
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-blue" onClick={() => navigate('/shygontap/checkout')}>
                Continue to checkout <ArrowRight size={15} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  try { localStorage.removeItem(PENDING_KEY); } catch { /* private mode */ }
                  window.dispatchEvent(new Event('shygon-cart-updated'));
                  navigate('/shygontap#builder');
                }}
              >
                Change selection
              </button>
            </div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="panel" style={{ padding: 22 }}>
          <Skeleton height={18} width="35%" />
          <div style={{ height: 16 }} />
          <Skeleton height={70} radius={16} />
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Your Shygon Tap is almost ready"
            message="We're finishing your Tap setup. Your account is safe — please try again shortly. Contact support if the problem continues."
          />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={refresh} />
        </div>
      ) : (
        <>
          {/* ------------------------------------------------ YOUR TAP, first */}
          <section className="panel" style={{ marginBottom: 18 }}>
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
                <div style={{ minWidth: 0, flex: '1 1 260px' }}>
                  <p className="mini-label">Your Tap</p>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      margin: '6px 0 8px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <h2 style={{ margin: 0, fontSize: 22, letterSpacing: '-.02em' }}>
                      {tap?.display_name || 'Your SHYGON Tap'}
                    </h2>
                    <span className={status === 'active' ? 'pill pill-green' : 'pill'}>
                      <span className="pill-dot" />
                      {TAP_STATUS_LABELS[status]}
                    </span>
                    <span className="pill pill-blue">
                      <Sparkles size={11} /> {EXPERIENCE_LABELS[experience]}
                    </span>
                  </div>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.6 }}>
                    {tap ? TAP_STATUS_HINTS[status] : 'Your Tap profile is created the moment your first purchase is paid for.'}
                  </p>
                  {tap?.slug && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'var(--ds-surface-raised)',
                        border: '1px solid var(--line)',
                        fontSize: 13,
                        fontWeight: 650,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {tapUrl(tap.slug).replace(/^https?:\/\//, '')}
                    </div>
                  )}
                </div>
              </div>

              {/* ------------------------------------------------ quick actions */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
                  gap: 10,
                  marginTop: 18,
                }}
              >
                <button className="btn btn-blue" onClick={() => navigate('/shygontap/tap')}>
                  <UserRound size={15} /> Edit Tap
                </button>
                <button className="btn btn-ghost" onClick={() => navigate('/shygontap/tap')}>
                  <Eye size={15} /> Preview
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => void share()}
                  disabled={!tap?.slug}
                >
                  <Share2 size={15} /> Share
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setShowQr(true)}
                  disabled={!tap?.slug}
                >
                  <QrCodeIcon size={15} /> QR code
                </button>
              </div>

              {tap?.slug && status === 'active' && (
                <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={copyLink}>
                    <Copy size={13} /> Copy link
                  </button>
                  <a
                    className="btn btn-ghost btn-sm"
                    href={tapUrl(tap.slug)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ textDecoration: 'none' }}
                  >
                    <ExternalLink size={13} /> Open public Tap
                  </a>
                </div>
              )}
            </div>
          </section>

          {/* ------------------------------------------- first-run activation */}
          {tap && !onboardingDone && (
            <section className="panel panel-accent" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <Sparkles size={18} color="var(--blue)" />
                <div>
                  <h2>Your SHYGON Tap is ready</h2>
                  <p>Four short steps from here to live.</p>
                </div>
              </div>
              <div className="panel-body" style={{ display: 'grid', gap: 8 }}>
                {steps.map((step, index) => (
                  <button
                    key={step.label}
                    type="button"
                    onClick={() => navigate(step.to)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 14,
                      border: '1px solid var(--line)',
                      background: 'var(--ds-surface-raised)',
                      color: 'var(--ds-text)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        flex: '0 0 auto',
                        borderRadius: 999,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 12,
                        fontWeight: 800,
                        background: step.done ? 'var(--ds-color-state-success)' : 'var(--ds-surface)',
                        color: step.done ? 'var(--ds-action-fg)' : 'var(--ds-text-tertiary)',
                      }}
                    >
                      {step.done ? <Check size={14} /> : index + 1}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 650 }}>
                      {step.label}
                    </span>
                    {!step.done && <ArrowRight size={15} color="var(--muted)" />}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* ------------------------------------------------- what you own */}
          <div className="stat-grid">
            <div className="stat">
              <small><Sparkles size={13} /> Digital experience</small>
              <strong style={{ fontSize: 18 }}>{EXPERIENCE_LABELS[experience]}</strong>
              <span>
                {`Up to ${EXPERIENCE_LABELS[entitlements.maxExperience]} unlocked`}
                {entitlements.pass ? ' · Pass active' : ''}
              </span>
            </div>
            <div className="stat">
              <small><CreditCard size={13} /> Cards owned</small>
              <strong style={{ fontSize: 18 }}>{entitlements.cards.length}</strong>
              <span>{entitlements.cards.length === 0 ? 'No cards yet' : 'Physical SHYGON Tap cards'}</span>
            </div>
            <div className="stat">
              <small><Package size={13} /> Add-ons</small>
              <strong style={{ fontSize: 18 }}>{entitlements.customizations.length}</strong>
              <span>Unlocked customizations</span>
            </div>
            <div className="stat">
              <small><UserRound size={13} /> Editing</small>
              <strong style={{ fontSize: 18 }}>
                {editState?.has_pass
                  ? 'Unlimited'
                  : editState?.can_edit
                    ? 'Available'
                    : `${editState?.days_remaining ?? 0} day${editState?.days_remaining === 1 ? '' : 's'}`}
              </strong>
              <span>
                {editState?.has_pass
                  ? 'Customization Pass active'
                  : editState?.can_edit
                    ? 'You can make a change now'
                    : 'Until your next change'}
              </span>
            </div>
          </div>

          {/* -------------------------------------------------- everything else */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
              gap: 14,
              marginTop: 18,
            }}
          >
            <QuickAction
              icon={<Package size={19} />}
              title="Orders"
              description="Track payment, packing and delivery."
              onClick={() => navigate('/shygontap/orders')}
            />
            <QuickAction
              icon={<TrendingUp size={19} />}
              title="Analytics"
              description="See how people find and use your Tap."
              onClick={() => navigate('/shygontap/analytics')}
            />
            <QuickAction
              icon={<Bell size={19} />}
              title="Notifications"
              description="Order, payment and delivery updates."
              onClick={() => navigate('/shygontap/notifications')}
            />
            <QuickAction
              icon={<LifeBuoy size={19} />}
              title="Support"
              description="Questions about your card, delivery or an upgrade."
              onClick={() => navigate('/shygontap/support')}
            />
          </div>

          <section className="panel" style={{ marginTop: 20 }}>
            <div className="panel-head">
              <div>
                <p className="mini-label">Recent activity</p>
                <h2>Your orders</h2>
              </div>
              <div className="panel-head-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/shygontap/orders')}>
                  View all
                </button>
              </div>
            </div>

            {ordersLoading ? (
              <div className="panel-body">
                <Skeleton height={16} />
                <div style={{ height: 12 }} />
                <Skeleton height={16} width="70%" />
              </div>
            ) : ordersError ? (
              <div className="panel-body">
                <p style={{ margin: 0, color: 'var(--ds-color-state-error)', fontSize: 13 }}>{ordersError}</p>
              </div>
            ) : orders.length === 0 ? (
              <div className="state" style={{ padding: '36px 20px' }}>
                <div className="state-icon">
                  <Package size={22} />
                </div>
                <h3>No orders yet</h3>
                <p>Your SHYGON Tap purchases will show up here.</p>
                <button className="btn btn-blue" onClick={() => navigate('/shygontap')}>
                  Browse the store
                </button>
              </div>
            ) : (
              <div className="panel-body-flush">
                {orders.map((order, i) => (
                  <div
                    key={order.id}
                    className="panel-row reveal"
                    style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)' }}
                  >
                    <span
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        display: 'grid',
                        placeItems: 'center',
                        background: 'var(--ds-surface-raised)',
                        flex: '0 0 auto',
                      }}
                    >
                      <Package size={17} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{order.product_name ?? 'SHYGON Tap'}</strong>
                      <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12 }}>
                        {order.order_id} · {new Date(order.created_at).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {rupees(orderTotalPaise(order))}
                      </strong>
                      <p style={{ margin: '3px 0 0', fontSize: 12 }}>
                        <span className={`pill pill-${paymentTone(order)}`}>
                          {isAbandonedCheckout(order)
                            ? 'Not completed'
                            : PAYMENT_STATUS_LABELS[order.payment_status ?? ''] ?? order.payment_status}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {tap?.slug && showQr && (
        <div className="modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && setShowQr(false)}>
          <div className="modal" style={{ textAlign: 'center' }}>
            <h2>Your Tap QR code</h2>
            <p>Scanning this opens your public Tap profile.</p>
            <div style={{ display: 'grid', placeItems: 'center', margin: '18px 0' }}>
              <QrCodeCanvas value={tapUrl(tap.slug)} size={220} />
            </div>
            <div className="modal-actions" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => setShowQr(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="panel"
      style={{
        padding: 20,
        textAlign: 'left',
        cursor: 'pointer',
        display: 'grid',
        gap: 10,
        border: '1px solid var(--line)',
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--blue-soft)',
          color: 'var(--blue)',
        }}
      >
        {icon}
      </span>
      <div>
        <strong style={{ fontSize: 14.5 }}>{title}</strong>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12.5, lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--blue)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        Open <ArrowRight size={13} />
      </span>
    </button>
  );
}
