import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IndianRupee, ReceiptText, TicketPercent, Truck } from 'lucide-react';
import { AppShell } from '../components/app/AppShell';
import { EmptyState, ErrorState, SkeletonRows } from '../components/app/States';
import EBill from '../components/app/EBill';
import { useAuth } from '../lib/auth-context';
import { useAsync } from '../hooks/useAsync';
import { describeError } from '../lib/supabase';
import { fetchOrders, orderTotalPaise, type OrderWithItems } from '../services/orders';
import { rupees } from '../services/catalog';

/**
 * Billing: every payment the customer has made, with its e-bill.
 *
 * Read from the same `orders` rows as the Orders page — the amounts are what
 * the server charged, never what a cart showed — so a receipt here always
 * matches the one emailed after payment.
 */

const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export default function Billing() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [openBill, setOpenBill] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(
    () => (user ? fetchOrders(user.id) : Promise.resolve([] as OrderWithItems[])),
    { enabled: Boolean(user), deps: [user?.id], onError: (err) => describeError(err) },
  );

  const receipts = (data ?? []).filter((order) => order.payment_status === 'paid' || order.payment_status === 'refunded');
  const paid = receipts.filter((order) => order.payment_status === 'paid');
  const totalPaid = paid.reduce((sum, order) => sum + orderTotalPaise(order), 0);
  const totalSaved = receipts.reduce((sum, order) => sum + (order.discount_in_paise ?? 0), 0);
  const totalDelivery = paid.reduce((sum, order) => sum + (order.delivery_fee_in_paise ?? 0), 0);
  const refunded = receipts.reduce(
    (sum, order) => sum + (order.payment_status === 'refunded' ? order.refund_amount_in_paise ?? orderTotalPaise(order) : 0),
    0,
  );

  return (
    <AppShell
      eyebrow="Account"
      title="Billing"
      description="Every payment on your account, with its e-bill. The same e-bill is emailed to you when a payment goes through."
    >
      {loading ? (
        <div className="panel">
          <SkeletonRows rows={3} />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : receipts.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<ReceiptText size={22} />}
            title="No payments yet"
            description="Your e-bills appear here once a payment goes through."
            action={
              <button className="btn btn-blue" onClick={() => navigate('/shygontap')}>
                Browse the store
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <small>
                <IndianRupee size={13} /> Total paid
              </small>
              <strong style={{ fontSize: 18 }}>{rupees(totalPaid)}</strong>
              <span>
                {paid.length} payment{paid.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="stat">
              <small>
                <TicketPercent size={13} /> Saved with promo codes
              </small>
              <strong style={{ fontSize: 18 }}>{rupees(totalSaved)}</strong>
              <span>Across all your orders</span>
            </div>
            <div className="stat">
              <small>
                <Truck size={13} /> Delivery
              </small>
              <strong style={{ fontSize: 18 }}>{rupees(totalDelivery)}</strong>
              <span>Included in the total</span>
            </div>
            <div className="stat">
              <small>
                <ReceiptText size={13} /> Refunded
              </small>
              <strong style={{ fontSize: 18 }}>{rupees(refunded)}</strong>
              <span>Back to your payment method</span>
            </div>
          </div>

          <section className="panel" style={{ marginTop: 18 }}>
            <div className="panel-head">
              <div>
                <p className="mini-label">Receipts</p>
                <h2>Your e-bills</h2>
              </div>
            </div>
            <div className="panel-body-flush">
              {receipts.map((order, i) => (
                <div key={order.id} style={{ borderTop: i === 0 ? undefined : '1px solid var(--line)' }}>
                  <div className="panel-row">
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
                      <ReceiptText size={17} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{order.product_name ?? 'SHYGON Tap'}</strong>
                      <p style={{ margin: '3px 0 0', color: 'var(--muted)', fontSize: 12 }}>
                        {order.order_id} · {date(order.created_at)}
                        {order.promo_code ? ` · ${order.promo_code} −${rupees(order.discount_in_paise ?? 0)}` : ''}
                        {order.razorpay_payment_id ? ` · ${order.razorpay_payment_id}` : ''}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{rupees(orderTotalPaise(order))}</strong>
                      <p style={{ margin: '3px 0 0', fontSize: 12 }}>
                        <span className={`pill ${order.payment_status === 'paid' ? 'pill-green' : 'pill-amber'}`}>
                          {order.payment_status === 'paid' ? 'Paid' : 'Refunded'}
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setOpenBill((current) => (current === order.id ? null : order.id))}
                      aria-expanded={openBill === order.id}
                    >
                      {openBill === order.id ? 'Hide' : 'E-bill'}
                    </button>
                  </div>
                  {openBill === order.id && (
                    <div style={{ padding: '0 18px 18px' }}>
                      <EBill
                        orderId={order.order_id}
                        paymentId={order.razorpay_payment_id ?? undefined}
                        email={user?.email ?? undefined}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
