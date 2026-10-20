/**
 * Text messages to Indian mobile numbers, shared by the card one-time codes
 * (card-otp) and the order confirmation (fulfilment).
 *
 * SMS_PROVIDER picks the provider:
 *   msg91   India, DLT. Every message is a DLT-approved Flow template; the
 *           caller names the template and its variables.
 *   twilio  Free text. TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID.
 *
 * Nothing here logs a phone number or a message body.
 */
import crypto from 'node:crypto';

export function env(name) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : null;
}

/** Indian mobile numbers to E.164; anything else already in +… form passes through. */
export function toE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91') && /^[6-9]/.test(digits.slice(2))) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) return `+91${digits.slice(1)}`;
  return null;
}

export const smsProvider = () => (env('SMS_PROVIDER') ?? '').toLowerCase();

/**
 * status: 503 = not set up, 502 = not sent (kept for the existing callers).
 * kind, for callers that retry (the emergency dispatcher):
 *   not_configured  no provider, or one without its settings
 *   rejected        the provider refused this message for good (bad number,
 *                   opted out, template refused): retrying cannot help
 *   transient       the provider was unavailable (5xx, 429) or unreachable
 *   timeout         no answer in time: the message may or may not have gone
 */
export class SmsError extends Error {
  constructor(message, status, { kind = status === 503 ? 'not_configured' : 'rejected', httpStatus = null, providerCode = null } = {}) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
  }
}

const notConfigured = () => new SmsError('SMS is not configured.', 503);
const refused = (kind, httpStatus, providerCode) =>
  new SmsError('The SMS provider refused the message.', 502, { kind, httpStatus, providerCode: providerCode == null ? null : String(providerCode) });
const kindOf = (httpStatus) => (httpStatus === 429 || httpStatus >= 500 ? 'transient' : 'rejected');

/** fetch with an optional deadline; a network failure or the deadline is an SmsError. */
async function post(url, init, timeoutMs) {
  const signal = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  try {
    return await fetch(url, signal ? { ...init, signal } : init);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw refused('timeout', null, null);
    throw refused('transient', null, null);
  }
}

/** Whether the configured provider has every setting it needs (no network). */
export function smsConfigured({ msg91TemplateId } = {}) {
  const provider = smsProvider();
  if (provider === 'msg91') return Boolean(env('MSG91_AUTH_KEY') && msg91TemplateId);
  if (provider === 'twilio') {
    return Boolean(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && (env('TWILIO_FROM') || env('TWILIO_MESSAGING_SERVICE_SID')));
  }
  return false;
}

/**
 * Sends one message.
 *   to              E.164 number
 *   text            the message, for providers that take free text (Twilio)
 *   msg91           { templateId, vars } for MSG91's DLT Flow template
 *   timeoutMs       optional deadline for the provider call
 *   statusCallback  optional URL for Twilio delivery receipts
 * Resolves { sent: true, provider, providerMessageId, providerStatus }: the
 * provider ACCEPTED the message, which is not proof it was delivered. Rejects
 * with SmsError (see above).
 */
export async function sendText({ to, text, msg91, timeoutMs, statusCallback }) {
  const provider = smsProvider();

  if (provider === 'msg91') {
    const authKey = env('MSG91_AUTH_KEY');
    if (!authKey || !msg91?.templateId) throw notConfigured();
    const response = await post('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: msg91.templateId,
        short_url: '0',
        recipients: [{ mobiles: to.replace(/^\+/, ''), ...(msg91.vars ?? {}) }],
      }),
    }, timeoutMs);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw refused(kindOf(response.status), response.status, result?.code ?? null);
    if (result?.type === 'error') throw refused('rejected', response.status, result?.code ?? null);
    // MSG91 answers {"type":"success","message":"<request id>"}.
    return { sent: true, provider, providerMessageId: typeof result?.message === 'string' ? result.message : null, providerStatus: 'accepted' };
  }

  if (provider === 'twilio') {
    const sid = env('TWILIO_ACCOUNT_SID');
    const token = env('TWILIO_AUTH_TOKEN');
    const from = env('TWILIO_FROM');
    const service = env('TWILIO_MESSAGING_SERVICE_SID');
    if (!sid || !token || (!from && !service)) throw notConfigured();
    const form = new URLSearchParams({ To: to, Body: text });
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', from);
    if (statusCallback) form.set('StatusCallback', statusCallback);
    const response = await post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    }, timeoutMs);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw refused(kindOf(response.status), response.status, result?.code ?? null);
    return { sent: true, provider, providerMessageId: typeof result?.sid === 'string' ? result.sid : null, providerStatus: result?.status ?? 'accepted' };
  }

  throw notConfigured();
}

/**
 * Twilio's request signature (X-Twilio-Signature): base64 HMAC-SHA1, keyed with
 * the auth token, of the exact callback URL followed by every POST parameter
 * name and value, sorted by name.
 */
export function twilioSignature(authToken, url, params) {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}
