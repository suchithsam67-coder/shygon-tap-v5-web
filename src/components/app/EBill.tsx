import { useEffect, useState } from 'react';
import { formatEdition, type CardEdition } from '../../lib/editions';
import BrandMark from '../brand/BrandMark';
import { Download, Printer, ReceiptText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LEGAL, LEGAL_LOCATION } from '../../data/legal';

/**
 * E-bill (payment receipt) for a confirmed order.
 *
 * Built from the order and its line items as stored by the server after the
 * payment was verified — not from the cart — so it shows exactly what was
 * charged. "Download" opens the browser's print dialog, where "Save as PDF"
 * produces the file; the print stylesheet prints only the bill.
 */

interface OrderRecord {
  id: string;
  order_id: string;
  created_at: string;
  amount_in_paise: number | null;
  amount: number | null;
  payment_status: string | null;
  razorpay_payment_id: string | null;
  product_name: string | null;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_pincode: string | null;
  // Migration 020: cart value before the promo, the discount, the code.
  subtotal_in_paise?: number | null;
  discount_in_paise?: number | null;
  promo_code?: string | null;
  // Migration 023: the GST used at purchase time, and the billing address.
  tax_in_paise?: number | null;
  taxable_value_in_paise?: number | null;
  tax_rate_percent?: number | null;
  tax_inclusive?: boolean | null;
  tax_split?: string | null;
  customer_gstin?: string | null;
  billing_name?: string | null;
  billing_company?: string | null;
  billing_phone?: string | null;
  billing_email?: string | null;
  billing_address?: string | null;
  billing_address_line2?: string | null;
  billing_locality?: string | null;
  billing_city?: string | null;
  billing_state?: string | null;
  billing_pincode?: string | null;
  shipping_address_line2?: string | null;
  shipping_locality?: string | null;
}

interface Seller {
  gstin: string | null;
  legal_name: string | null;
  registered_address: string | null;
  hsn_code: string | null;
}

const BILL_COLUMNS =
  'id, order_id, created_at, amount_in_paise, amount, payment_status, razorpay_payment_id, product_name, shipping_name, shipping_phone, shipping_address, shipping_city, shipping_state, shipping_pincode';
const BILL_MONEY_COLUMNS = ', subtotal_in_paise, discount_in_paise, promo_code';
const BILL_TAX_COLUMNS =
  ', tax_in_paise, taxable_value_in_paise, tax_rate_percent, tax_inclusive, tax_split, customer_gstin, billing_name, billing_company, billing_phone, billing_email, billing_address, billing_address_line2, billing_locality, billing_city, billing_state, billing_pincode, shipping_address_line2, shipping_locality';

interface ItemRecord {
  name: string | null;
  sku: string | null;
  quantity: number | null;
  unit_price_in_paise: number | null;
  line_total_in_paise: number | null;
}

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Minimum time the generation animation plays, so it reads as a moment, not a flicker. */
const MIN_GENERATE_MS = 1600;

export default function EBill({ orderId, paymentId, email }: { orderId?: string; paymentId?: string; email?: string }) {
  const [order, setOrder] = useState<OrderRecord | null>(null);
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [editions, setEditions] = useState<Map<string, string>>(new Map());
  const [phase, setPhase] = useState<'generating' | 'ready' | 'error'>('generating');
  const [seller, setSeller] = useState<Seller | null>(null);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    const started = Date.now();
    (async () => {
      try {
        const read = (columns: string) =>
          supabase.from('orders').select(columns).eq('order_id', orderId).maybeSingle();
        let { data: orderRow, error } = await read(BILL_COLUMNS + BILL_MONEY_COLUMNS + BILL_TAX_COLUMNS);
        // Databases without migration 023 / 020 have fewer columns.
        if (error?.code === '42703') ({ data: orderRow, error } = await read(BILL_COLUMNS + BILL_MONEY_COLUMNS));
        if (error?.code === '42703') ({ data: orderRow, error } = await read(BILL_COLUMNS));
        const { data: sellerRow } = await supabase
          .from('tax_settings')
          .select('gstin, legal_name, registered_address, hsn_code')
          .limit(1)
          .maybeSingle();
        if (error || !orderRow) throw error ?? new Error('Order not found');
        const bill = orderRow as unknown as OrderRecord;
        const { data: itemRows } = await supabase
          .from('order_items')
          .select('name, sku, quantity, unit_price_in_paise, line_total_in_paise')
          .eq('order_id', bill.id);
        // Limited-edition numbers of the cards this order issued (migration 017).
        const { data: cardRows } = await supabase
          .from('cards')
          .select('*')
          .eq('order_id', bill.id);
        const numbers = new Map<string, string>();
        for (const card of (cardRows ?? []) as (CardEdition & { sku: string | null })[]) {
          const text = formatEdition(card);
          if (card.sku && text) numbers.set(card.sku, text);
        }
        const wait = Math.max(0, MIN_GENERATE_MS - (Date.now() - started));
        window.setTimeout(() => {
          if (cancelled) return;
          setOrder(bill);
          setSeller((sellerRow as Seller | null) ?? null);
          setItems((itemRows ?? []) as ItemRecord[]);
          setEditions(numbers);
          setPhase('ready');
        }, wait);
      } catch {
        if (!cancelled) setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (phase === 'generating' && orderId) {
    return (
      <div className="ebill-generating" role="status" aria-live="polite">
        <div className="ebill-printer" aria-hidden="true">
          <span className="ebill-slot" />
          <span className="ebill-paper">
            <i />
            <i />
            <i />
            <i />
          </span>
        </div>
        <p>Generating your e-bill…</p>
      </div>
    );
  }

  if (phase === 'error' || !order) {
    return (
      <p className="ebill-unavailable">
        Your e-bill will be available under Orders shortly. Payment reference: {paymentId ?? '—'}
      </p>
    );
  }

  const totalPaise = order.amount_in_paise ?? Math.round((order.amount ?? 0) * 100);
  const lines: ItemRecord[] = items.length
    ? items
    : [{ name: order.product_name ?? 'SHYGON Tap', sku: null, quantity: 1, unit_price_in_paise: totalPaise, line_total_in_paise: totalPaise }];
  const taxPaise = order.tax_in_paise ?? 0;
  const taxRate = Number(order.tax_rate_percent ?? 0);
  const sellerGstin = seller?.gstin ?? LEGAL.gstin ?? null;
  const billTo = order.billing_address
    ? [order.billing_address, order.billing_address_line2, order.billing_locality, order.billing_city, order.billing_state, order.billing_pincode]
        .filter(Boolean)
        .join(', ')
    : '';
  const shipTo = [order.shipping_address, order.shipping_address_line2, order.shipping_locality, order.shipping_city, order.shipping_state, order.shipping_pincode]
    .filter(Boolean)
    .join(', ');
  const issued = new Date(order.created_at).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <section className="ebill-wrap" aria-labelledby="ebill-title">
      <article className="ebill" id="ebill">
        <header className="ebill-head">
          <div>
            <p className="ebill-brand">
              <BrandMark className="ebill-mark" />
              SHYGON <b>TAP</b>
            </p>
            <p className="ebill-issuer">
              {seller?.legal_name ?? LEGAL.legalName}
              <br />
              {seller?.registered_address ?? LEGAL.registeredAddress ?? LEGAL_LOCATION}
              {sellerGstin && (
                <>
                  <br />
                  GSTIN {sellerGstin}
                </>
              )}
            </p>
          </div>
          <div className="ebill-meta">
            <h2 id="ebill-title">
              <ReceiptText size={16} aria-hidden="true" /> E-bill
            </h2>
            <p>{sellerGstin && taxPaise > 0 ? 'Tax invoice · payment receipt' : 'Payment receipt'}</p>
            <dl>
              <div>
                <dt>Receipt no.</dt>
                <dd>{order.order_id}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{issued}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd className="ebill-paid">{order.payment_status === 'paid' ? 'Paid' : order.payment_status ?? 'Paid'}</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="ebill-parties">
          <div>
            <h3>Billed to</h3>
            <p>
              {order.billing_name ?? order.shipping_name ?? 'Customer'}
              {order.billing_company && (
                <>
                  <br />
                  {order.billing_company}
                </>
              )}
              {billTo && (
                <>
                  <br />
                  {billTo}
                </>
              )}
              {order.customer_gstin && (
                <>
                  <br />
                  GSTIN {order.customer_gstin}
                </>
              )}
              {(order.billing_email ?? email) && (
                <>
                  <br />
                  {order.billing_email ?? email}
                </>
              )}
              {(order.billing_phone ?? order.shipping_phone) && (
                <>
                  <br />
                  {order.billing_phone ?? order.shipping_phone}
                </>
              )}
            </p>
          </div>
          {shipTo && (
            <div>
              <h3>Ship to</h3>
              <p>{shipTo}</p>
            </div>
          )}
        </div>

        <table className="ebill-items">
          <caption className="sr-only">Items in this order</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const qty = line.quantity ?? 1;
              const total = line.line_total_in_paise ?? (line.unit_price_in_paise ?? 0) * qty;
              return (
                <tr key={`${line.sku ?? line.name}-${index}`}>
                  <td>
                    {line.name ?? line.sku ?? 'Item'}
                    {line.sku && editions.get(line.sku) && (
                      <span className="ebill-edition">Limited edition · {editions.get(line.sku)}</span>
                    )}
                  </td>
                  <td>{qty}</td>
                  <td>{rupees(line.unit_price_in_paise ?? total / qty)}</td>
                  <td>{rupees(total)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(order.discount_in_paise ?? 0) > 0 && (
              <>
                {typeof order.subtotal_in_paise === 'number' && (
                  <tr>
                    <th scope="row" colSpan={3}>
                      Cart value
                    </th>
                    <td>{rupees(order.subtotal_in_paise)}</td>
                  </tr>
                )}
                <tr>
                  <th scope="row" colSpan={3}>
                    Promo code {order.promo_code}
                  </th>
                  <td>−{rupees(order.discount_in_paise ?? 0)}</td>
                </tr>
              </>
            )}
            {taxPaise > 0 && (
              <>
                <tr>
                  <th scope="row" colSpan={3}>
                    Taxable value{seller?.hsn_code ? ` (HSN ${seller.hsn_code})` : ''}
                  </th>
                  <td>{rupees(order.taxable_value_in_paise ?? totalPaise - taxPaise)}</td>
                </tr>
                {order.tax_split === 'cgst_sgst' ? (
                  <>
                    <tr>
                      <th scope="row" colSpan={3}>
                        CGST {taxRate / 2}%
                      </th>
                      <td>{rupees(Math.floor(taxPaise / 2))}</td>
                    </tr>
                    <tr>
                      <th scope="row" colSpan={3}>
                        SGST {taxRate / 2}%
                      </th>
                      <td>{rupees(taxPaise - Math.floor(taxPaise / 2))}</td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <th scope="row" colSpan={3}>
                      IGST {taxRate}%
                    </th>
                    <td>{rupees(taxPaise)}</td>
                  </tr>
                )}
              </>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                Total paid (INR{shipTo ? ', delivery included' : ''}{taxPaise > 0 && order.tax_inclusive ? ', GST included' : ''})
              </th>
              <td>{rupees(totalPaise)}</td>
            </tr>
          </tfoot>
        </table>

        <footer className="ebill-foot">
          <p>
            Paid online via Razorpay · Payment reference {order.razorpay_payment_id ?? paymentId ?? '—'}
          </p>
          <p>
            Questions? {LEGAL.email} · {LEGAL.phone} · {LEGAL.website}
          </p>
        </footer>
      </article>

      <div className="ebill-actions">
        <button type="button" className="btn btn-blue" onClick={() => window.print()}>
          <Download size={16} aria-hidden="true" /> Download PDF
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </button>
      </div>
      <p className="ebill-hint">“Download PDF” opens your browser’s print window — choose “Save as PDF”.</p>
    </section>
  );
}
