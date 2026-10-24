import crypto from 'node:crypto';
import { env, sendText, SmsError, smsConfigured, smsProvider } from './sms.mjs';
import { clientAddress } from './client-address.mjs';

/**
 * The emergency module's server side (migration 029): database calls, the
 * messages, and the dispatcher that sends alerts and records what the provider
 * said.
 *
 * Every database step is a SECURITY DEFINER function that only service_role may
 * execute; the browser can reach none of them, nor any emergency table. Callers
 * pass the user id they verified from the access token.
 *
 * Nothing here logs a phone number, a name or a message body.
 */

export const PROVIDER_TIMEOUT_MS = 6000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

export function config() {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/+$/, ''), serviceKey, secret: env('OTP_SECRET') ?? serviceKey };
}

/** A refusal from the database ("emergency:<code>", "rescue:<code>", "connect:<code>", "prive:<code>") or a failed request. */
export class DbError extends Error {
  constructor(status, body) {
    super(body?.message ?? `Database request failed (${status})`);
    this.status = status;
    this.code = body?.code ?? null;
    this.details = body?.details ?? null;
    const match = /^(emergency|rescue|connect|prive|modes):([a-z_]+)$/.exec(this.message);
    this.appCode = match ? match[2] : null;
    this.emergencyCode = match?.[1] === 'emergency' ? match[2] : null;
  }
}

/** Service-role call to a database function. */
export async function rpc(cfg, fn, args = {}) {
  const response = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: cfg.serviceKey,
      authorization: `Bearer ${cfg.serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new DbError(response.status, data);
  return data;
}

/** The caller, from their own access token (verified by Supabase Auth). */
export async function currentUser(cfg, request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.serviceKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

export const hmac = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex');

/** The verification code's stored form: never the code itself. */
export const codeHash = (secret, contactId, code) => hmac(secret, `emergency-verify:${contactId}:${code}`);

/**
 * A visitor, for rate limiting only: an HMAC of the client address the HOST
 * reports (clientAddress: only the header TRUSTED_CLIENT_IP_HEADER names) and
 * the UTC day, so it cannot be reversed or linked across days. Returns null if
 * the host gave no address or the trusted header is not configured; the
 * caller then refuses.
 */
export function visitorDigest(secret, request, day = new Date().toISOString().slice(0, 10)) {
  const ip = clientAddress(request);
  if (!ip) return null;
  return hmac(secret, `emergency-visitor|${day}|${ip}`);
}

// ---------------------------------------------------------------------------
// Messages. MSG91 (India, DLT) sends only pre-approved templates, so each text
// has its template and variables; Twilio takes the text as written.
// ---------------------------------------------------------------------------

const IST = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
});
export const istTime = (when) => IST.format(new Date(when));

export function verificationMessage(ownerName, code) {
  return {
    text: `SHYGON: ${ownerName} wants to add you as an emergency contact. If you agree, give them this code: ${code}. It expires in 10 minutes. If you do not know them, ignore this message.`,
    msg91: {
      templateId: env('MSG91_EMERGENCY_VERIFY_TEMPLATE_ID'),
      vars: { [env('MSG91_EMERGENCY_NAME_VAR') ?? 'name']: ownerName, [env('MSG91_OTP_VAR') ?? 'otp']: code },
    },
  };
}

export function alertMessage(initiator, ownerName, createdAt) {
  const when = istTime(createdAt);
  const text =
    initiator === 'public'
      ? `SHYGON emergency alert: someone using ${ownerName}'s SHYGON profile reported an emergency at ${when} IST. SHYGON cannot confirm it. Try to reach ${ownerName} directly. If they may be in danger, call 112.`
      : `SHYGON emergency alert: ${ownerName} has asked for help and wants you to contact them now (sent ${when} IST). SHYGON does not contact emergency services. If they are in danger, call 112.`;
  return {
    text,
    msg91: {
      templateId: env(initiator === 'public' ? 'MSG91_EMERGENCY_PUBLIC_TEMPLATE_ID' : 'MSG91_EMERGENCY_OWNER_TEMPLATE_ID'),
      vars: { [env('MSG91_EMERGENCY_NAME_VAR') ?? 'name']: ownerName, [env('MSG91_EMERGENCY_TIME_VAR') ?? 'time']: when },
    },
  };
}

/** Twilio delivery receipts reach this URL; without it messages stay "accepted". */
export const statusCallbackUrl = () => (smsProvider() === 'twilio' ? env('SMS_STATUS_CALLBACK_URL') : null);

/** What the owner's status page can say about receipts with the current settings. */
export function deliveryReceipts() {
  if (smsProvider() === 'twilio' && env('SMS_STATUS_CALLBACK_URL')) return 'supported';
  if (smsProvider() === 'msg91' && env('MSG91_DLR_SECRET')) return 'supported';
  return 'not_supported';
}

/** Whether alerts can be sent at all right now (no network call). */
export function alertsConfigured() {
  if (smsProvider() === 'msg91') {
    return smsConfigured({ msg91TemplateId: env('MSG91_EMERGENCY_OWNER_TEMPLATE_ID') }) && Boolean(env('MSG91_EMERGENCY_PUBLIC_TEMPLATE_ID'));
  }
  return smsConfigured();
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Sends one claimed recipient's message and records the provider's answer. */
async function deliverOne(cfg, claim, log) {
  const message = alertMessage(claim.initiator, claim.owner_name, claim.event_created_at);
  let outcome;
  let provider = smsProvider() || null;
  let providerMessageId = null;
  let providerStatus = null;
  let httpStatus = null;
  let errorCode = null;
  try {
    const sent = await sendText({
      to: claim.phone_e164,
      text: message.text,
      msg91: message.msg91,
      timeoutMs: PROVIDER_TIMEOUT_MS,
      statusCallback: statusCallbackUrl() ?? undefined,
    });
    outcome = 'accepted';
    provider = sent.provider;
    providerMessageId = sent.providerMessageId;
    providerStatus = sent.providerStatus;
  } catch (error) {
    if (!(error instanceof SmsError)) throw error;
    outcome = error.kind;
    httpStatus = error.httpStatus;
    errorCode = error.providerCode ?? error.kind;
  }
  const recorded = await rpc(cfg, 'emergency_attempt_finish', {
    p_recipient_id: claim.recipient_id,
    p_attempt_no: claim.attempt_no,
    p_outcome: outcome,
    p_provider: provider,
    p_provider_message_id: providerMessageId,
    p_provider_status: providerStatus,
    p_http_status: httpStatus,
    p_error_code: errorCode,
  });
  log?.info?.('emergency.attempt', {
    eventId: claim.event_id, recipientId: claim.recipient_id, attemptNo: claim.attempt_no, outcome,
    provider, httpStatus, errorCode, recorded: recorded?.ok === true,
  });
  return { outcome, recorded: recorded?.ok === true };
}

/**
 * Claims every due recipient (of one event, or all) and sends them in
 * parallel. A claim carries a lease and an attempt number, so two dispatchers
 * never send the same attempt twice.
 */
export async function dispatchDue(cfg, { eventId = null, limit = 50, log } = {}) {
  const claims = await rpc(cfg, 'emergency_claim_due', { p_event_id: eventId, p_limit: limit });
  const results = await Promise.all(
    (claims ?? []).map((claim) =>
      deliverOne(cfg, claim, log).catch((error) => {
        // The database could not record the answer. The lease expires and the
        // next sweep closes the attempt as lease_expired: never reported sent.
        log?.error?.('emergency.attempt-unrecorded', { eventId: claim.event_id, recipientId: claim.recipient_id, error });
        return { outcome: 'unrecorded', recorded: false };
      }),
    ),
  );
  const summary = { claimed: results.length };
  for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
  return summary;
}
