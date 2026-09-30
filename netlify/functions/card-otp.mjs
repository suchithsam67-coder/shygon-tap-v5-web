import crypto from 'node:crypto';
import { sendText, SmsError, smsProvider, toE164 } from '../lib/sms.mjs';

/**
 * POST /api/card-otp — OTP-confirmed card activation and deactivation.
 *
 *   { step: 'request', cardId, action: 'activate' | 'deactivate' }
 *       Texts a 6-digit code to the mobile number on the customer's account.
 *   { step: 'verify', challengeId, code }
 *       Checks the code and, if right, applies the action
 *       (public.card_apply_verified_action, migration 015), which also notifies
 *       the customer and raises an alert in the admin panel.
 *
 * Authorization: Bearer <the customer's Supabase access token>.
 *
 * Security:
 *   - Codes come from crypto.randomInt and are stored only as an HMAC keyed
 *     with OTP_SECRET. The table is unreachable from browsers (RLS, no policies).
 *   - 10-minute expiry, 5 attempts per code, 45 s between sends, 5 sends per
 *     hour per account. A code is single-use (consumed with a conditional update).
 *   - The card must belong to the caller; the number is the one on their account.
 *
 * Talks to Supabase over HTTP (PostgREST / GoTrue) rather than supabase-js, so
 * it also runs on Node 20 in local development.
 *
 * SMS: set SMS_PROVIDER to "msg91" or "twilio" with that provider's variables
 * (see the README section in PRODUCTION.md). Without one, requests fail with a
 * clear 503 — no code is ever pretended to be sent. For local testing only,
 * OTP_DEV_MODE=true returns the code in the response; it is ignored whenever
 * Netlify's CONTEXT is "production".
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 45 * 1000;
const MAX_SENDS_PER_HOUR = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function env(name) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : null;
}

function config() {
  const url = env('SUPABASE_URL') ?? env('VITE_SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return null;
  return { url: url.replace(/\/+$/, ''), serviceKey, secret: env('OTP_SECRET') ?? serviceKey };
}

/** Service-role PostgREST call. */
async function rest(cfg, path, { method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.serviceKey,
      authorization: `Bearer ${cfg.serviceKey}`,
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message ?? `Database request failed (${response.status})`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

/** The caller, from their own access token (verified by Supabase Auth). */
async function currentUser(cfg, request) {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const response = await fetch(`${cfg.url}/auth/v1/user`, {
    headers: { apikey: cfg.serviceKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

/** "+91 ••••• 06633": enough to recognise the number, not enough to reuse it. */
const masked = (e164) => `${e164.slice(0, 3)} ••••• ${e164.slice(-5)}`;

function hashCode(secret, challengeId, code) {
  return crypto.createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const x = Buffer.from(String(a), 'hex');
  const y = Buffer.from(String(b), 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Local testing only: needs OTP_DEV_MODE=true, must not be a Netlify or Vercel
 * production deploy, AND the request must be to localhost — so a stray flag in
 * a deployed site's settings can never turn it on.
 */
function devModeAllowed(request) {
  let host = '';
  try {
    host = new URL(request.url).hostname;
  } catch {
    host = '';
  }
  return (
    env('OTP_DEV_MODE') === 'true' &&
    env('CONTEXT') !== 'production' &&
    env('VERCEL_ENV') !== 'production' &&
    (host === 'localhost' || host === '127.0.0.1')
  );
}

/** Sends the SMS. Returns { sent: true } or throws with a customer-safe message. */
async function sendSms(to, code, action, request) {
  const verb = action === 'activate' ? 'activate' : 'deactivate';
  const text = `${code} is your SHYGON Tap code to ${verb} your card. It expires in 10 minutes. Do not share it with anyone.`;

  if (smsProvider() === 'msg91' || smsProvider() === 'twilio') {
    try {
      // MSG91: a DLT-approved Flow template containing the ##otp## variable.
      return await sendText({
        to,
        text,
        msg91: { templateId: env('MSG91_TEMPLATE_ID'), vars: { [env('MSG91_OTP_VAR') ?? 'otp']: code } },
      });
    } catch (error) {
      if (error instanceof SmsError) {
        throw Object.assign(
          new Error(error.status === 503 ? 'SMS is not configured.' : 'We could not send the SMS. Please try again.'),
          { status: error.status },
        );
      }
      throw error;
    }
  }

  if (devModeAllowed(request)) return { sent: false, dev: true };

  throw Object.assign(
    new Error('Text messages are not set up yet, so we cannot send a code. Please contact support.'),
    { status: 503 },
  );
}

async function requestCode(cfg, user, body, request) {
  const cardId = String(body?.cardId ?? '');
  const action = body?.action;
  if (!UUID.test(cardId)) return json({ error: 'Choose a card.' }, 400);
  if (action !== 'activate' && action !== 'deactivate') return json({ error: 'Unknown action.' }, 400);

  const [card] = await rest(
    cfg,
    `cards?id=eq.${cardId}&user_id=eq.${user.id}&select=id,status,card_uid`,
  );
  if (!card) return json({ error: 'Card not found.' }, 404);
  if (card.status === 'replaced') return json({ error: 'This card has been replaced and cannot be changed.' }, 409);
  if (action === 'deactivate' && card.status !== 'active') {
    return json({ error: 'This card is not active.' }, 409);
  }

  const [profile] = await rest(cfg, `profiles?id=eq.${user.id}&select=phone`);
  const phone = toE164(profile?.phone);
  if (!phone) {
    return json(
      { error: 'Add your mobile number in Settings first. The code is sent to that number.', needsPhone: true },
      422,
    );
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await rest(
    cfg,
    `card_otp_challenges?user_id=eq.${user.id}&created_at=gte.${since}&select=created_at&order=created_at.desc`,
  );
  if (recent.length >= MAX_SENDS_PER_HOUR) {
    return json({ error: 'Too many codes requested. Please try again in an hour.' }, 429);
  }
  const last = recent[0] ? Date.parse(recent[0].created_at) : 0;
  const wait = RESEND_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    return json({ error: 'Please wait before requesting another code.', retryAfter: Math.ceil(wait / 1000) }, 429);
  }

  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await rest(cfg, 'card_otp_challenges', {
    method: 'POST',
    prefer: 'return=minimal',
    body: {
      id: challengeId,
      user_id: user.id,
      card_id: card.id,
      action,
      code_hash: hashCode(cfg.secret, challengeId, code),
      phone_last4: phone.slice(-4),
      expires_at: expiresAt,
    },
  });

  let delivery;
  try {
    delivery = await sendSms(phone, code, action, request);
  } catch (error) {
    // The code never reached the customer: retire it at once.
    await rest(cfg, `card_otp_challenges?id=eq.${challengeId}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { consumed_at: new Date().toISOString() },
    }).catch(() => undefined);
    return json({ error: error.message }, error.status ?? 502);
  }

  return json({
    challengeId,
    expiresAt,
    phone: masked(phone),
    resendAfter: RESEND_COOLDOWN_MS / 1000,
    // Local testing only; never in production (see devModeAllowed).
    ...(delivery.dev ? { devCode: code, devNote: 'Development mode: no SMS was sent.' } : {}),
  });
}

async function verifyCode(cfg, user, body) {
  const challengeId = String(body?.challengeId ?? '');
  const code = String(body?.code ?? '').replace(/\D/g, '');
  if (!UUID.test(challengeId)) return json({ error: 'Request a new code.' }, 400);
  if (!/^\d{6}$/.test(code)) return json({ error: 'Enter the 6-digit code.' }, 400);

  const [challenge] = await rest(
    cfg,
    `card_otp_challenges?id=eq.${challengeId}&user_id=eq.${user.id}&select=id,card_id,action,code_hash,attempts,expires_at,consumed_at`,
  );
  if (!challenge || challenge.consumed_at) return json({ error: 'This code has already been used. Request a new one.' }, 410);
  if (Date.parse(challenge.expires_at) <= Date.now()) return json({ error: 'This code has expired. Request a new one.' }, 410);
  if (challenge.attempts >= MAX_ATTEMPTS) return json({ error: 'Too many wrong attempts. Request a new code.' }, 429);

  if (!sameHash(hashCode(cfg.secret, challenge.id, code), challenge.code_hash)) {
    const attempts = challenge.attempts + 1;
    await rest(cfg, `card_otp_challenges?id=eq.${challenge.id}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { attempts },
    });
    const left = MAX_ATTEMPTS - attempts;
    return json(
      { error: left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong attempts. Request a new code.', attemptsLeft: left },
      left > 0 ? 400 : 429,
    );
  }

  // Single use: only the first request to flip consumed_at gets through.
  const consumed = await rest(cfg, `card_otp_challenges?id=eq.${challenge.id}&consumed_at=is.null`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: { consumed_at: new Date().toISOString() },
  });
  if (!consumed.length) return json({ error: 'This code has already been used. Request a new one.' }, 410);

  try {
    const [card] = await rest(cfg, 'rpc/card_apply_verified_action', {
      method: 'POST',
      body: { p_user_id: user.id, p_card_id: challenge.card_id, p_action: challenge.action },
    });
    return json({ card, action: challenge.action });
  } catch (error) {
    const message =
      error.code === '22023' || error.code === 'P0002' ? error.message : 'We could not update your card. Please try again.';
    return json({ error: message }, error.code === 'P0002' ? 404 : 409);
  }
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  const cfg = config();
  if (!cfg) return json({ error: 'The server is not configured.' }, 500);

  try {
    const user = await currentUser(cfg, request);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const body = await request.json().catch(() => ({}));
    if (body?.step === 'request') return await requestCode(cfg, user, body, request);
    if (body?.step === 'verify') return await verifyCode(cfg, user, body);
    return json({ error: 'Unknown step.' }, 400);
  } catch {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
};
