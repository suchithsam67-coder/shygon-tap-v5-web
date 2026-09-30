import { Link, useNavigate } from 'react-router-dom';
import { Check, Package, RotateCw, Sparkles, Truck } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import {
  fetchOrders,
  ORDER_STAGES,
  ORDER_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  digitalOrderState,
  isAbandonedCheckout,
  isCancelled,
  isPhysicalOrder,
  orderTotalPaise,
  paymentTone,
  stageIndex,
  type OrderWithItems,
} from '../services/orders';
import { rupees } from '../services/catalog';
import { useAsync } from '../hooks/useAsync';
import { useOrderUpdates } from '../hooks/useOrderUpdates';

/**
 * Order history and tracking, read straight from `orders` / `order_items`.
 *
 * Every state shown here is one the database is in — there is no client-side
 * simulation of progress. Physical orders advance only when the SHYGON admin
 * moves them; digital orders are finished when fulfilment grants them. Changes
 * made in the admin app arrive without a reload (see useOrderUpdates).
 */
export default function Orders() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // "The migration has not run" is a state, not a failure, so the loader
  // resolves with it rather than throwing.
  const {
    data,
    loading,
    error,
    reload: load,
    refresh,
  } = useAsync(
    async () => {
      if (!user) return { orders: [] as OrderWithItems[], setupRequired: false };
      try {
        return { orders: await fetchOrders(user.id), setupRequired: false };
      } catch (err) {
        if (isMissingSchema(err)) return { orders: [] as OrderWithItems[], setupRequired: true };
        throw err;
      }
    },
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );

  useOrderUpdates(user?.id, Boolean(user), refresh);

  const orders = data?.orders ?? [];
  const setupRequired = data?.setupRequired ?? false;

  return (
    <AppShell eyebrow="Order history" title="Your orders" description="Track every SHYGON Tap purchase and upgrade.">
      {loading ? (
        <div className="panel">
          <SkeletonRows rows={3} />
        </div>
      ) : setupRequired ? (
        <div className="panel">
          <ErrorState
            title="Your orders are temporarily unavailable"
            message="We're having trouble loading your order history right now. Please try again shortly."
          />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={load} />
        </div>
      ) : orders.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<Package size={22} />}
            title="No orders yet"
            description="Your SHYGON Tap purchases will appear here."
            action={
              <button className="btn btn-blue" onClick={() => navigate('/shygontap')}>
                Browse the store
              </button>
            }
          />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {orders.map((order, i) => (
            <OrderCard key={order.id} order={order} index={i} />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const noteStyle = { margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' } as const;
const strongStyle = { color: 'var(--ink)' } as const;

function OrderCard({ order, index }: { order: OrderWithItems; index: number }) {
  const cancelled = isCancelled(order);
  const paid = order.payment_status === 'paid';
  const physical = isPhysicalOrder(order);
  const abandoned = isAbandonedCheckout(order);
  const current = stageIndex(order.order_status);
  const tone = paymentTone(order);

  const paymentLabel = abandoned
    ? 'Not completed'
    : PAYMENT_STATUS_LABELS[order.payment_status ?? ''] ?? order.payment_status ?? 'Pending';

  const shippedOn = formatDate(order.shipped_at);
  const deliveredOn = formatDate(order.delivered_at);
  const cancelledOn = formatDate(order.cancelled_at);
  const refundedOn = formatDate(order.refunded_at);

  return (
    <section className="panel reveal" style={{ ['--i' as string]: index }}>
      <div className="panel-head">
        <div>
          <p className="mini-label">{order.order_id}</p>
          <h2>{order.product_name ?? 'SHYGON Tap'}</h2>
        </div>
        <div className="panel-head-actions">
          <span className={`pill pill-${tone}`}>{paymentLabel}</span>
          <strong style={{ fontSize: 17 }}>{rupees(orderTotalPaise(order))}</strong>
        </div>
      </div>

      <div className="panel-body">
        {order.items.length > 0 && (
          <div style={{ display: 'grid', gap: 6, marginBottom: 18 }}>
            {order.items.map((item) => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>
                  {item.name}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ''}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rupees(item.line_total_in_paise)}</span>
              </div>
            ))}
          </div>
        )}

        {/* A checkout the customer left: say plainly that no money moved. */}
        {abandoned && !cancelled && (
          <p style={noteStyle}>Checkout wasn&rsquo;t completed, so you were not charged for this order.</p>
        )}

        {/* Physical: the shipping tracker, advanced only by the admin. */}
        {physical && paid && !cancelled && (
          <div className="tracker" style={{ marginBottom: 20 }}>
            {ORDER_STAGES.map((stage, i) => (
              <div key={stage} className={`tracker-step ${i <= current ? 'done' : ''} ${i === current ? 'current' : ''}`}>
                <span className="tracker-dot">
                  {i < current ? <Check size={12} /> : i === current ? <Truck size={12} /> : null}
                </span>
                <span>{ORDER_STATUS_LABELS[stage]}</span>
              </div>
            ))}
          </div>
        )}

        {/* Digital: nothing to post. Finished when fulfilment grants it. */}
        {!physical && paid && !cancelled && (
          digitalOrderState(order) === 'unlocked' ? (
            <p style={{ ...noteStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} style={{ color: 'var(--green)', flexShrink: 0 }} />
              <span>
                <strong style={strongStyle}>Unlocked on your account.</strong>
                {formatDate(order.fulfilled_at) ? ` Active since ${formatDate(order.fulfilled_at)}.` : ''}
              </span>
            </p>
          ) : (
            <p style={noteStyle}>
              <strong style={strongStyle}>Payment received — activating on your account.</strong> This usually takes a
              moment; this page updates on its own.
            </p>
          )
        )}

        {cancelled && (
          <div style={{ marginBottom: 16 }}>
            <span className="pill pill-red">Order cancelled{cancelledOn ? ` · ${cancelledOn}` : ''}</span>
            {order.cancellation_reason && (
              <p style={{ ...noteStyle, margin: '10px 0 0' }}>
                Reason: <strong style={strongStyle}>{order.cancellation_reason}</strong>
              </p>
            )}
            {/* Cancelling does not refund; say what the record shows, no more. */}
            {paid && (
              <p style={{ ...noteStyle, margin: '10px 0 0' }}>
                No refund has been recorded for this payment yet.{' '}
                <Link to="/shygontap/support" style={{ color: 'var(--blue)', fontWeight: 650 }}>
                  Contact support
                </Link>{' '}
                if you have questions about it.
              </p>
            )}
          </div>
        )}

        {order.payment_status === 'refunded' && (
          <p style={noteStyle}>
            <strong style={strongStyle}>
              Refunded
              {typeof order.refund_amount_in_paise === 'number' ? ` ${rupees(order.refund_amount_in_paise)}` : ''}
            </strong>
            {refundedOn ? ` on ${refundedOn}` : ''}. The refund goes back to the payment method you used.
          </p>
        )}

        {physical && order.tracking_number && (
          <p style={noteStyle}>
            {order.shipping_carrier ? (
              <>
                Shipped with <strong style={strongStyle}>{order.shipping_carrier}</strong> · tracking number{' '}
              </>
            ) : (
              'Tracking number: '
            )}
            <strong style={{ ...strongStyle, fontVariantNumeric: 'tabular-nums' }}>{order.tracking_number}</strong>
          </p>
        )}

        {physical && (shippedOn || deliveredOn) && (
          <p style={noteStyle}>
            {shippedOn && <>Shipped {shippedOn}</>}
            {shippedOn && deliveredOn && ' · '}
            {deliveredOn && <>Delivered {deliveredOn}</>}
          </p>
        )}

        {physical && order.shipping_address && (
          <div style={{ background: '#f7f9fb', border: '1px solid var(--line)', borderRadius: 13, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Delivery details
            </p>
            <p style={{ margin: '6px 0 0', fontWeight: 650, fontSize: 13 }}>{order.shipping_name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>{order.shipping_phone}</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              {order.shipping_address}
              {order.shipping_city ? `, ${order.shipping_city}` : ''}
              {order.shipping_state ? `, ${order.shipping_state}` : ''}
              {order.shipping_pincode ? ` – ${order.shipping_pincode}` : ''}
            </p>
          </div>
        )}

        <p style={{ margin: '16px 0 0', fontSize: 11.5, color: 'var(--muted)' }}>
          <RotateCw size={11} style={{ display: 'inline', marginRight: 4 }} />
          Placed {formatDate(order.created_at)}
        </p>
      </div>
    </section>
  );
}
