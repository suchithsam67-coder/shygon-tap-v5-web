import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env, twilioSignature } from '../lib/sms.mjs';
import { config, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/sms-status: Twilio's delivery receipts for emergency alerts
 * (migration 029, emergency_provider_status).
 *
 * Twilio calls the StatusCallback URL the dispatcher gave it, with
 * MessageSid, MessageStatus and ErrorCode, signed with X-Twilio-Signature. The
 * signature is checked against SMS_STATUS_CALLBACK_URL exactly as configured
 * (the URL Twilio was given) and TWILIO_AUTH_TOKEN; anything unsigned or
 * mis-signed is refused and logged as a security event. Only "delivered" or
 * "read" marks a message delivered; "undelivered" and "failed" mark it not
 * delivered. A receipt never moves a message backwards.
 *
 * MSG91 delivery reports are NOT handled: with MSG91, messages stay
 * "accepted" (the provider took them; delivery unconfirmed).
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function sameSignature(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function handle(request, log) {
  if (request.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  const cfg = config();
  const token = env('TWILIO_AUTH_TOKEN');
  const url = env('SMS_STATUS_CALLBACK_URL');
  if (!cfg || !token || !url) {
    log.error('sms-status.misconfigured', { hasDb: Boolean(cfg), hasToken: Boolean(token), hasUrl: Boolean(url) });
    return json({ error: { code: 'not_configured', message: 'Delivery receipts are not configured.' } }, 503);
  }

  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!sameSignature(request.headers.get('x-twilio-signature'), twilioSignature(token, url, params))) {
    log.warn('security.sms-status-rejected', { reason: 'bad-signature' });
    return json({ error: { code: 'forbidden', message: 'Signature check failed.' } }, 403);
  }

  const sid = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;
  if (!sid || !status) return json({ error: { code: 'invalid_request', message: 'MessageSid and MessageStatus are required.' } }, 400);

  try {
    const result = await rpc(cfg, 'emergency_provider_status', {
      p_provider: 'twilio', p_provider_message_id: sid, p_status: status, p_error_code: params.ErrorCode ?? null,
    });
    log.info('sms-status.received', { status, matched: result?.matched === true });
    return json({ matched: result?.matched === true });
  } catch (error) {
    // A 5xx makes Twilio retry the callback later.
    log.error('sms-status.db-error', { error });
    return json({ error: { code: 'internal', message: 'Could not record the receipt.' } }, 500);
  }
}

export default async (request) => {
  const log = requestLog('sms-status', request);
  return log.respond(await handle(request, log));
};
