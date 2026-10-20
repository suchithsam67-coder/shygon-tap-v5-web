import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env, twilioSignature } from '../lib/sms.mjs';
import { config, rpc } from '../lib/emergency.mjs';

/**
 * POST /api/sms-status: delivery receipts for emergency alerts (migration 029,
 * emergency_provider_status). Only a receipt that says delivered marks a
 * message delivered; a receipt never moves a message backwards.
 *
 * Twilio (default): Twilio calls the StatusCallback URL the dispatcher gave it,
 * with MessageSid, MessageStatus and ErrorCode, signed with X-Twilio-Signature.
 * The signature is checked against SMS_STATUS_CALLBACK_URL exactly as
 * configured and TWILIO_AUTH_TOKEN. "delivered" or "read" = delivered;
 * "undelivered" or "failed" = not delivered.
 *
 * MSG91 (?provider=msg91): the "Report Received" webhook (SMS > Webhook (New)),
 * one JSON report per recipient: { requestId, status, failureReason, ... }.
 * MSG91 does not sign webhooks, so the webhook is configured with a custom
 * header x-shygon-dlr-secret carrying MSG91_DLR_SECRET; anything without the
 * exact value is refused. Status codes (MSG91 help, 2026-10-19): 1 delivered;
 * 2 failed, 9 NDNC, 16 and 25 rejected, 17 blocked number, 20 country blocked
 * = not delivered; 0 sent = no change. The request id matched is the one the
 * Flow API returned when the message was sent (INFERRED from MSG91's docs; the
 * operator smoke test confirms it).
 *
 * Anything unsigned, mis-signed or without the secret is refused (403) and
 * logged as a security event.
 */

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function same(a, b) {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return Boolean(a) && crypto.timingSafeEqual(x, y);
}

/** MSG91 status code → the receipt vocabulary emergency_provider_status understands, plus a fixed error code. */
const MSG91 = {
  1: ['delivered', null],
  2: ['undelivered', 'failed'],
  9: ['undelivered', 'ndnc'],
  16: ['undelivered', 'rejected'],
  25: ['undelivered', 'rejected'],
  17: ['undelivered', 'blocked_number'],
  20: ['undelivered', 'country_blocked'],
  0: ['sent', null],
};

async function twilio(request, cfg, log) {
  const token = env('TWILIO_AUTH_TOKEN');
  const url = env('SMS_STATUS_CALLBACK_URL');
  if (!token || !url) {
    log.error('sms-status.misconfigured', { provider: 'twilio', hasToken: Boolean(token), hasUrl: Boolean(url) });
    return json({ error: { code: 'not_configured', message: 'Delivery receipts are not configured.' } }, 503);
  }
  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  const given = request.headers.get('x-twilio-signature');
  const expected = twilioSignature(token, url, params);
  if (!given || Buffer.byteLength(given) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
    log.warn('security.sms-status-rejected', { provider: 'twilio', reason: 'bad-signature' });
    return json({ error: { code: 'forbidden', message: 'Signature check failed.' } }, 403);
  }
  const sid = params.MessageSid ?? params.SmsSid;
  const status = params.MessageStatus ?? params.SmsStatus;
  if (!sid || !status) return json({ error: { code: 'invalid_request', message: 'MessageSid and MessageStatus are required.' } }, 400);
  const result = await rpc(cfg, 'emergency_provider_status', {
    p_provider: 'twilio', p_provider_message_id: sid, p_status: status, p_error_code: params.ErrorCode ?? null,
  });
  log.info('sms-status.received', { provider: 'twilio', status, matched: result?.matched === true });
  return json({ matched: result?.matched === true });
}

async function msg91(request, cfg, log) {
  const secret = env('MSG91_DLR_SECRET');
  if (!secret) {
    log.error('sms-status.misconfigured', { provider: 'msg91', hasSecret: false });
    return json({ error: { code: 'not_configured', message: 'Delivery receipts are not configured.' } }, 503);
  }
  if (!same(request.headers.get('x-shygon-dlr-secret'), secret)) {
    log.warn('security.sms-status-rejected', { provider: 'msg91', reason: 'bad-secret' });
    return json({ error: { code: 'forbidden', message: 'Not allowed.' } }, 403);
  }
  const body = await request.json().catch(() => null);
  const reports = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  if (!reports.length || reports.length > 100) return json({ error: { code: 'invalid_request', message: 'Send one or more reports.' } }, 400);
  let matched = 0;
  for (const report of reports) {
    const requestId = typeof report?.requestId === 'string' ? report.requestId.trim() : '';
    const mapped = MSG91[Number.parseInt(String(report?.status ?? ''), 10)];
    if (!requestId || requestId.length > 128 || !mapped) continue;
    const result = await rpc(cfg, 'emergency_provider_status', {
      p_provider: 'msg91', p_provider_message_id: requestId, p_status: mapped[0], p_error_code: mapped[1],
    });
    if (result?.matched) matched += 1;
  }
  log.info('sms-status.received', { provider: 'msg91', reports: reports.length, matched });
  return json({ matched });
}

async function handle(request, log) {
  if (request.method !== 'POST') return json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } }, 405);
  const cfg = config();
  if (!cfg) {
    log.error('sms-status.misconfigured', { hasDb: false });
    return json({ error: { code: 'not_configured', message: 'Delivery receipts are not configured.' } }, 503);
  }
  try {
    const provider = new URL(request.url).searchParams.get('provider');
    return provider === 'msg91' ? await msg91(request, cfg, log) : await twilio(request, cfg, log);
  } catch (error) {
    // A 5xx makes the provider retry the report later.
    log.error('sms-status.db-error', { error });
    return json({ error: { code: 'internal', message: 'Could not record the receipt.' } }, 500);
  }
}

export default async (request) => {
  const log = requestLog('sms-status', request);
  return log.respond(await handle(request, log));
};
