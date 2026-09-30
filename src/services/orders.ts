import { supabase } from '../lib/supabase';
import type { OrderItemRow, OrderRow, OrderStatus } from '../lib/database.types';

/**
 * Orders are read-only from the browser. `orders` has a SELECT policy scoped to
 * the owner and no INSERT or UPDATE policy, and a database trigger additionally
 * refuses any transition into a paid state from a context that has an
 * `auth.uid()`. Orders are created and advanced by the Netlify functions.
 */

const ORDER_COLUMNS =
  'id, order_id, user_id, product_id, product_name, category, material, tier, plan, ' +
  'plan_id, order_type, amount, amount_in_paise, payment_status, order_status, ' +
  'razorpay_order_id, razorpay_payment_id, shipping_name, shipping_phone, ' +
  'shipping_address, shipping_city, shipping_state, shipping_pincode, ' +
  'tracking_number, created_at, updated_at';

/**
 * What the admin records as it works an order (migration 003) and whether the
 * server finished granting it (migration 006).
 *
 * Without these the customer saw a tracking number with no carrier to look it
 * up with, a bare "Cancelled" with no reason, a refund with no amount — and a
 * paid digital upgrade stuck on "Processing" forever, because nothing could tell
 * a finished upgrade from a stalled one.
 *
 * `admin_note` is deliberately NOT here. It is the admin's internal note; see
 * supabase/migrations/011_admin_notes_off_customer_rows.sql.
 */
const ORDER_TRACKING_COLUMNS =
  ', fulfillment_status, fulfilled_at, shipping_carrier, shipped_at, delivered_at, ' +
  'cancelled_at, cancellation_reason, refunded_at, refund_amount_in_paise';

/**
 * The checkout's money (migration 020): cart value, promo discount, delivery,
 * and the card a replacement order replaces.
 */
const ORDER_MONEY_COLUMNS =
  ', subtotal_in_paise, discount_in_paise, delivery_fee_in_paise, promo_code, replaces_card_id';

/** Postgres "undefined column": the database predates the migration that added it. */
const UNDEFINED_COLUMN = '42703';

/**
 * Remembered for the session once seen. A schema does not gain columns while a
 * page is open, and without this every background refresh on an older database
 * would spend a request rediscovering the same error before falling back.
 */
let trackingColumnsUnavailable = false;
let moneyColumnsUnavailable = false;
let taxColumnsUnavailable = false;

/** Migration 023: GST, billing address and a cancellation request. */
const ORDER_TAX_COLUMNS =
  ', tax_in_paise, tax_rate_percent, tax_inclusive, tax_split, customer_gstin, billing_same_as_shipping, ' +
  'billing_name, billing_company, billing_address, billing_address_line2, billing_locality, billing_city, ' +
  'billing_state, billing_pincode, shipping_address_line2, shipping_locality, cancellation_requested_at, ' +
  'cancellation_request_reason';

export interface OrderHistoryRow {
  order_id: string;
  kind: 'order' | 'payment' | 'card' | 'request' | string;
  status: string;
  note: string | null;
  created_at: string;
}

export interface OrderWithItems extends OrderRow {
  items: OrderItemRow[];
  /** Every status the order passed through, oldest first (migration 023). */
  history: OrderHistoryRow[];
}

export async function fetchOrders(userId: string, limit?: number): Promise<OrderWithItems[]> {
  const run = (columns: string) => {
    let query = supabase
      .from('orders')
      .select(columns)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (limit) query = query.limit(limit);
    return query;
  };

  const columns = () =>
    ORDER_COLUMNS +
    (trackingColumnsUnavailable ? '' : ORDER_TRACKING_COLUMNS) +
    (moneyColumnsUnavailable ? '' : ORDER_MONEY_COLUMNS) +
    (taxColumnsUnavailable ? '' : ORDER_TAX_COLUMNS);

  let { data, error } = await run(columns());

  // A database without 020 (or 003/006) still has every base column. Show the
  // orders with less detail rather than refusing to show them at all. Only
  // this one error code falls back — anything else is a real failure.
  if (!taxColumnsUnavailable && error?.code === UNDEFINED_COLUMN) {
    taxColumnsUnavailable = true;
    ({ data, error } = await run(columns()));
  }
  if (!moneyColumnsUnavailable && error?.code === UNDEFINED_COLUMN) {
    moneyColumnsUnavailable = true;
    ({ data, error } = await run(columns()));
  }
  if (!trackingColumnsUnavailable && error?.code === UNDEFINED_COLUMN) {
    trackingColumnsUnavailable = true;
    ({ data, error } = await run(columns()));
  }
  if (error) throw error;

  const orders = (data ?? []) as unknown as OrderRow[];
  if (orders.length === 0) return [];

  // One round trip for every line item rather than one per order.
  const { data: itemRows, error: itemError } = await supabase
    .from('order_items')
    .select('id, order_id, sku, name, product_type, unit_price_in_paise, quantity, line_total_in_paise')
    .in('order_id', orders.map((o) => o.id));

  // Line items are an enhancement; an order still renders without them.
  const items = itemError ? [] : ((itemRows ?? []) as unknown as OrderItemRow[]);
  const byOrder = new Map<string, OrderItemRow[]>();
  for (const item of items) {
    const list = byOrder.get(item.order_id) ?? [];
    list.push(item);
    byOrder.set(item.order_id, list);
  }

  // The timeline is an enhancement too: a database without 023 has none.
  const { data: historyRows } = await supabase
    .from('order_status_history')
    .select('order_id, kind, status, note, created_at')
    .in('order_id', orders.map((o) => o.id))
    .order('created_at', { ascending: true });
  const byOrderHistory = new Map<string, OrderHistoryRow[]>();
  for (const row of (historyRows ?? []) as OrderHistoryRow[]) {
    const list = byOrderHistory.get(row.order_id) ?? [];
    list.push(row);
    byOrderHistory.set(row.order_id, list);
  }

  return orders.map((order) => ({
    ...order,
    items: byOrder.get(order.id) ?? [],
    history: byOrderHistory.get(order.id) ?? [],
  }));
}

/**
 * Asks SHYGON to cancel a paid order that has not shipped. An administrator
 * decides and refunds; the request itself changes nothing that was charged.
 */
export async function requestCancellation(orderId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('customer_request_cancellation', { p_order_id: orderId, p_reason: reason });
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    throw new Error('Online cancellation is not available yet. Please contact support to cancel.');
  }
  if (error) throw error;
}

/** Whether the customer may ask to cancel this order. */
export function canRequestCancellation(order: OrderRow): boolean {
  return (
    // Only offered once the database can take the request (migration 023's columns are present).
    order.cancellation_requested_at !== undefined &&
    order.payment_status === 'paid' &&
    ['placed', 'processing', 'packed'].includes(order.order_status ?? 'placed') &&
    !order.cancellation_requested_at
  );
}

export const HISTORY_LABELS: Record<string, string> = {
  'order:placed': 'Order placed',
  'payment:paid': 'Payment confirmed',
  'payment:failed': 'Payment failed',
  'payment:refunded': 'Refunded',
  'order:processing': 'Preparing your order',
  'card:card_assigned': 'Card assigned',
  'order:packed': 'Packed',
  'order:shipped': 'Shipped',
  'order:out_for_delivery': 'Out for delivery',
  'order:delivered': 'Delivered',
  'order:cancelled': 'Cancelled',
  'request:cancellation_requested': 'Cancellation requested',
};

/** Ordered fulfilment stages, used to draw the tracker. */
export const ORDER_STAGES: readonly OrderStatus[] = [
  'placed',
  'processing',
  'packed',
  'shipped',
  'out_for_delivery',
  'delivered',
];

/**
 * The tracker's six steps. The stored statuses are unchanged (the Admin app
 * writes them); `processing` is what fulfilment sets the moment a payment is
 * verified, so it reads as "Payment confirmed", and `packed` as "Preparing".
 */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  placed: 'Order placed',
  processing: 'Payment confirmed',
  packed: 'Preparing',
  shipped: 'Shipped',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'Payment pending',
  payment_pending: 'Payment pending',
  created: 'Payment pending',
  paid: 'Paid',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export function stageIndex(status: string | null | undefined): number {
  if (!status) return 0;
  const index = ORDER_STAGES.indexOf(status as OrderStatus);
  return index < 0 ? 0 : index;
}

export function isCancelled(order: Pick<OrderRow, 'order_status'>): boolean {
  return order.order_status === 'cancelled';
}

/**
 * Whether anything in this order has to be posted.
 *
 * Only a physical order ever moves through placed → … → delivered, because only
 * an admin shipping a card advances `order_status`. Digital orders (an
 * experience upgrade, the Customization Pass, an add-on) are finished the
 * moment fulfilment grants them, and `order_status` stays wherever fulfilment
 * left it — so drawing a shipping tracker for one shows a false "Processing"
 * indefinitely.
 */
export function isPhysicalOrder(order: Pick<OrderRow, 'order_type'>): boolean {
  return !order.order_type || order.order_type === 'physical';
}

/**
 * How far a digital order has got, from the server's own fulfilment record.
 * `null` fulfillment_status means a database older than migration 006, where
 * a paid order was fulfilled in the same request that marked it paid.
 */
export function digitalOrderState(
  order: Pick<OrderRow, 'payment_status' | 'fulfillment_status'>,
): 'unlocked' | 'activating' | 'awaiting-payment' {
  if (order.payment_status !== 'paid') return 'awaiting-payment';
  if (!order.fulfillment_status || order.fulfillment_status === 'fulfilled') return 'unlocked';
  return 'activating';
}

/**
 * An order still `pending` long after checkout was a checkout the customer left.
 * Razorpay confirms within minutes, so by then nothing is in flight — and
 * "Payment pending" would imply money is moving when none is.
 */
const ABANDONED_AFTER_MS = 30 * 60 * 1000;

export function isAbandonedCheckout(
  order: Pick<OrderRow, 'payment_status' | 'created_at'>,
  now: number = Date.now(),
): boolean {
  const pending = !order.payment_status || ['pending', 'created', 'payment_pending'].includes(order.payment_status);
  return pending && now - new Date(order.created_at).getTime() > ABANDONED_AFTER_MS;
}

/**
 * One place that decides a payment pill's colour, so every page agrees.
 *
 * Paid-and-cancelled is amber, not green: `admin_cancel_order` does not refund —
 * that is a separate admin action — so until `payment_status` becomes
 * 'refunded' the customer's money is still with SHYGON. Green there would say
 * "all good" about the one order where it is not.
 */
export function paymentTone(order: Pick<OrderRow, 'payment_status' | 'order_status'>): 'green' | 'red' | 'amber' {
  if (order.payment_status === 'paid') return order.order_status === 'cancelled' ? 'amber' : 'green';
  if (order.payment_status === 'failed' || order.order_status === 'cancelled') return 'red';
  return 'amber';
}

export function orderTotalPaise(order: OrderRow): number {
  if (typeof order.amount_in_paise === 'number') return order.amount_in_paise;
  return Math.round(Number(order.amount ?? 0) * 100);
}
