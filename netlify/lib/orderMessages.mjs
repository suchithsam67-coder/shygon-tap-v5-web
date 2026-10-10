import { requestLog } from './log.mjs';
import { env, sendText, SmsError, toE164 } from './sms.mjs';

/**
 * The order confirmation text, sent once a paid order is fulfilled, to the
 * mobile number the customer gave at checkout (or, for an order with no
 * delivery address, the one on their account).
 *
 * Exactly once: the order row is claimed by setting confirmation_sms_at where
 * it is still empty (migration 019), so the browser path and the webhook can
 * both finish an order without the customer getting two texts. The outcome is
 * kept in confirmation_sms_status for the admin panel.
 *
 * Never throws: a text that cannot be sent must not undo a paid order.
 *
 * MSG91 (India, DLT) needs its own approved template for this message,
 * MSG91_ORDER_TEMPLATE_ID, with two variables (names configurable):
 *   ##order##   the order number, e.g. ST-MULI1JP5-8412
 *   ##amount##  the amount paid in rupees, e.g. 899
 */

const site = () => (env('SITE_URL') ?? env('VITE_SITE_URL') ?? 'https://shygontech.com').replace(/\/+$/, '');

export async function sendOrderConfirmation(admin, orderId, log = requestLog('order-sms', null)) {
  try {
    const { data: claimed, error: claimError } = await admin
      .from('orders')
      .update({ confirmation_sms_at: new Date().toISOString(), confirmation_sms_status: 'sending' })
      .eq('id', orderId)
      .is('confirmation_sms_at', null)
      .select('id, order_id, user_id, amount, amount_in_paise, shipping_phone');

    if (claimError) {
      // Before migration 019 the columns do not exist: skip quietly.
      log.warn('order-sms.unavailable', { orderId, code: claimError.code ?? claimError.message });
      return { sent: false, reason: 'unavailable' };
    }
    const order = claimed?.[0];
    if (!order) return { sent: false, reason: 'already-sent' };

    let phone = order.shipping_phone;
    if (!phone && order.user_id) {
      const { data: profile } = await admin.from('profiles').select('phone').eq('id', order.user_id).maybeSingle();
      phone = profile?.phone ?? null;
    }
    const to = toE164(phone);

    const record = (status) =>
      admin.from('orders').update({ confirmation_sms_status: status }).eq('id', order.id);

    if (!to) {
      await record('no_phone');
      return { sent: false, reason: 'no-phone' };
    }

    const rupees = Math.round((order.amount_in_paise ?? Math.round((order.amount ?? 0) * 100)) / 100);
    const text = `SHYGON Tap: your order ${order.order_id} is confirmed. Rs ${rupees} paid. We will text you when it ships. Track it at ${site()}/shygontap/orders`;

    try {
      await sendText({
        to,
        text,
        msg91: {
          templateId: env('MSG91_ORDER_TEMPLATE_ID'),
          vars: {
            [env('MSG91_ORDER_VAR') ?? 'order']: order.order_id,
            [env('MSG91_AMOUNT_VAR') ?? 'amount']: String(rupees),
          },
        },
      });
      await record('sent');
      return { sent: true };
    } catch (error) {
      const status = error instanceof SmsError && error.status === 503 ? 'not_configured' : 'failed';
      log.warn('order-sms.not-sent', { orderId: order.order_id, status });
      await record(status);
      return { sent: false, reason: status };
    }
  } catch (error) {
    log.error('order-sms.error', { orderId, error });
    return { sent: false, reason: 'error' };
  }
}
