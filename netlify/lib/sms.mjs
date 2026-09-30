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

export class SmsError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * Sends one message.
 *   to      E.164 number
 *   text    the message, for providers that take free text (Twilio)
 *   msg91   { templateId, vars } for MSG91's DLT Flow template
 * Resolves { sent: true, provider }; rejects with SmsError (503 = not set up,
 * 502 = the provider refused).
 */
export async function sendText({ to, text, msg91 }) {
  const provider = smsProvider();

  if (provider === 'msg91') {
    const authKey = env('MSG91_AUTH_KEY');
    if (!authKey || !msg91?.templateId) throw new SmsError('SMS is not configured.', 503);
    const response = await fetch('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: msg91.templateId,
        short_url: '0',
        recipients: [{ mobiles: to.replace(/^\+/, ''), ...(msg91.vars ?? {}) }],
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.type === 'error') throw new SmsError('The SMS provider refused the message.', 502);
    return { sent: true, provider };
  }

  if (provider === 'twilio') {
    const sid = env('TWILIO_ACCOUNT_SID');
    const token = env('TWILIO_AUTH_TOKEN');
    const from = env('TWILIO_FROM');
    const service = env('TWILIO_MESSAGING_SERVICE_SID');
    if (!sid || !token || (!from && !service)) throw new SmsError('SMS is not configured.', 503);
    const form = new URLSearchParams({ To: to, Body: text });
    if (service) form.set('MessagingServiceSid', service);
    else form.set('From', from);
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    if (!response.ok) throw new SmsError('The SMS provider refused the message.', 502);
    return { sent: true, provider };
  }

  throw new SmsError('SMS is not configured.', 503);
}
