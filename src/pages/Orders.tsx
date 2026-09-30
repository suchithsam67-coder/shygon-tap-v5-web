import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Clock3, Package, ReceiptText, Repeat2, RotateCw, Sparkles, Truck, XCircle } from 'lucide-react';
import { useToast } from '../components/app/toast-context';
import EBill from '../components/app/EBill';
import { AppShell } from '../components/app/AppShell';
import { useAuth } from '../lib/auth-context';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import { describeError, isMissingSchema } from '../lib/supabase';
import {
  canRequestCancellation,
  fetchOrders,
  HISTORY_LABELS,
  requestCancellation,
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
  // One e-bill open at a time, so "Download PDF" prints just that one.
  const [openBill, setOpenBill] = useState<string | null>(null);

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
            <OrderCard
              key={order.id}
              order={order}
              index={i}
              email={user?.email ?? undefined}
              billOpen={openBill === order.id}
              onToggleBill={() => setOpenBill((current) => (current === order.id ? null : order.id))}
              onChanged={refresh}
            />
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

/** A public tracking page for the carriers SHYGON ships with; null when unknown. */
function trackingUrl(carrier: string | null | undefined, number: string | null | undefined): string | null {
  if (!number) return null;
  const n = encodeURIComponent(number.trim());
  const c = (carrier ?? '').toLowerCase();
  if (c.includes('delhivery')) return `https://www.delhivery.com/track/package/${n}`;
  if (c.includes('blue dart') || c.includes('bluedart')) return `https://www.bluedart.com/tracking?trackFor=0&trackNo=${n}`;
  if (c.includes('dtdc')) return `https://www.dtdc.in/tracking.asp?strCnno=${n}`;
  if (c.includes('shiprocket')) return `https://shiprocket.co/tracking/${n}`;
  if (c.includes('xpressbees')) return `https://www.xpressbees.com/shipment/tracking?awbNo=${n}`;
  if (c.includes('ekart')) return `https://ekartlogistics.com/shipmenttrack/${n}`;
  if (c.includes('india post') || c.includes('speed post')) return 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx';
  return null;
}

const noteStyle = { margin: '0 0 16px', fontSize: 13, color: 'var(--muted)' } as const;
const strongStyle = { color: 'var(--ink)' } as const;

function OrderCard({
  order,
  index,
  email,
  billOpen,
  onToggleBill,
  onChanged,
}: {
  order: OrderWithItems;
  index: number;
  email?: string;
  billOpen: boolean;
  onToggleBill: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  // The card this order bought, to order the same again (same design, material, finish).
  const reorderSku = order.items.map((i) => /^card-(.+)-(standard|premium)-(pvc|metal|transparent)$/.exec(i.sku ?? '')).find(Boolean);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);

  async function submitCancellation() {
    setCancelBusy(true);
    try {
      await requestCancellation(order.id, cancelReason.trim());
      toast.success('Cancellation requested', 'We will confirm it and refund you to the original payment method.');
      setCancelOpen(false);
      onChanged();
    } catch (err) {
      toast.error('Could not request cancellation', describeError(err));
    } finally {
      setCancelBusy(false);
    }
  }

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
            {(order.tax_in_paise ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>
                  GST {Number(order.tax_rate_percent ?? 0)}%{order.tax_inclusive ? ' (included)' : ''}
                  {order.tax_split === 'cgst_sgst' ? ' · CGST + SGST' : order.tax_split === 'igst' ? ' · IGST' : ''}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{rupees(order.tax_in_paise ?? 0)}</span>
              </div>
            )}
            {(order.discount_in_paise ?? 0) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                <span style={{ color: 'var(--muted)' }}>Promo {order.promo_code}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--ds-color-state-success)' }}>
                  −{rupees(order.discount_in_paise ?? 0)}
                </span>
              </div>
            )}
          </div>
        )}

        {order.replaces_card_id && (
          <p style={noteStyle}>Replacement card — it opens the same page as the card it replaces.</p>
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
            {trackingUrl(order.shipping_carrier, order.tracking_number) && (
              <>
                {' · '}
                <a href={trackingUrl(order.shipping_carrier, order.tracking_number)!} target="_blank" rel="noopener noreferrer">
                  Track package
                </a>
              </>
            )}
          </p>
        )}

        {physical && (shippedOn || deliveredOn) && (
          <p style={noteStyle}>
            {shippedOn && <>Shipped {shippedOn}</>}
            {shippedOn && deliveredOn && ' · '}
            {deliveredOn && <>Delivered {deliveredOn}</>}
          </p>
        )}

        {order.history.length > 0 && (
          <div style={{ margin: '0 0 16px', display: 'grid', gap: 6 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Timeline
            </p>
            {order.history.map((event, i) => (
              <div key={`${event.kind}-${event.status}-${i}`} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
                <Clock3 size={12} style={{ color: 'var(--muted)', flexShrink: 0 }} />
                <span style={{ fontWeight: 650 }}>{HISTORY_LABELS[`${event.kind}:${event.status}`] ?? event.status.replace(/_/g, ' ')}</span>
                <span style={{ color: 'var(--muted)' }}>
                  {new Date(event.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  {event.note ? ` · ${event.note}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {order.cancellation_requested_at && !cancelled && (
          <p style={noteStyle}>
            <strong style={strongStyle}>Cancellation requested</strong> on {formatDate(order.cancellation_requested_at)}. We will
            confirm it and refund you to the payment method you used.
          </p>
        )}

        {physical && order.shipping_address && (
          <div style={{ background: 'var(--ds-surface-raised)', border: '1px solid var(--line)', borderRadius: 13, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
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

        {order.billing_address && order.billing_same_as_shipping === false && (
          <div style={{ marginTop: 10, background: 'var(--ds-surface-raised)', border: '1px solid var(--line)', borderRadius: 13, padding: 14 }}>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Billing details
            </p>
            <p style={{ margin: '6px 0 0', fontWeight: 650, fontSize: 13 }}>
              {order.billing_name}
              {order.billing_company ? ` · ${order.billing_company}` : ''}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>
              {[order.billing_address, order.billing_address_line2, order.billing_locality, order.billing_city, order.billing_state]
                .filter(Boolean)
                .join(', ')}
              {order.billing_pincode ? ` – ${order.billing_pincode}` : ''}
            </p>
            {order.customer_gstin && (
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--muted)' }}>GSTIN {order.customer_gstin}</p>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            <RotateCw size={11} style={{ display: 'inline', marginRight: 4 }} />
            Placed {formatDate(order.created_at)}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {physical && canRequestCancellation(order) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelOpen((v) => !v)} aria-expanded={cancelOpen}>
                <XCircle size={14} /> Cancel order
              </button>
            )}
            {paid && reorderSku && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => navigate(`/shygontap/store/${reorderSku[1]}?material=${reorderSku[3]}&finish=${reorderSku[2]}`)}
              >
                <Repeat2 size={14} /> Buy again
              </button>
            )}
            {paid && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleBill} aria-expanded={billOpen}>
                <ReceiptText size={14} /> {billOpen ? 'Hide e-bill' : 'View e-bill'}
              </button>
            )}
          </div>
        </div>
        {cancelOpen && (
          <form
            style={{ marginTop: 12, display: 'grid', gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              void submitCancellation();
            }}
          >
            <label className="field" style={{ margin: 0 }}>
              <span>Why do you want to cancel?</span>
              <textarea
                className="textarea"
                rows={2}
                maxLength={500}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ordered the wrong card, changed my mind…"
              />
            </label>
            <p className="field-hint" style={{ margin: 0 }}>
              Possible until the order ships. Once confirmed, the full amount goes back to your payment method.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-danger btn-sm" disabled={cancelBusy || cancelReason.trim().length < 3}>
                {cancelBusy ? 'Sending…' : 'Request cancellation'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
                Keep my order
              </button>
            </div>
          </form>
        )}
        {paid && billOpen && <EBill orderId={order.order_id} paymentId={order.razorpay_payment_id ?? undefined} email={email} />}
      </div>
    </section>
  );
}
