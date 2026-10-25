import crypto from 'node:crypto';
import { requestLog } from '../lib/log.mjs';
import { env, sendText, SmsError, toE164 } from '../lib/sms.mjs';
import { trustedClientIpHeader } from '../lib/client-address.mjs';
import {
  alertsConfigured, codeHash, config, currentUser, DbError, deliveryReceipts, dispatchDue, isUuid, rpc,
  verificationMessage, visitorDigest, PROVIDER_TIMEOUT_MS,
} from '../lib/emergency.mjs';

/**
 * POST /api/emergency: the SHYGON AAROH emergency module (migration 029).
 * The contract is docs/v6/aaroh/api-contract.md (AAROH-API); keep them in step.
 *
 * Body: { op: '<operation>', ...fields }.
 *
 * Owner operations (Authorization: Bearer <the customer's Supabase access token>):
 *   contacts.list              contacts (numbers masked) and settings
 *   contacts.save              add or edit a contact; a new number is unverified
 *   contacts.remove
 *   contacts.verify.request    texts a 6-digit code to the contact
 *   contacts.verify.confirm    the owner enters the code the contact read out
 *   settings.set               visitor alerts on or off (acknowledge required)
 *   alerts.create              alert every verified contact now (Idempotency key)
 *   alerts.list / alerts.get   status, per recipient, as the provider reported it
 *   alerts.retry               send what is due now (and what could not be sent
 *                              for lack of a provider, once one is configured)
 *   alerts.cancel              stop messages not yet sent
 *   alerts.report              mark an alert unwanted (a visitor alert turns
 *                              visitor alerts off); SHYGON is told
 * Visitor operations (no sign-in):
 *   public.status              { available } for /t/<slug>
 *   public.alert               alert the owner's verified contacts, relay only:
 *                              the visitor never learns who they are
 *
 * Errors: { error: { code, message, retryAfter? } } with the HTTP status.
 * Nothing is ever reported as sent unless the provider accepted it, and
 * nothing as delivered without the provider's delivery receipt.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in again.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_name: [400, "Enter the contact's name (up to 80 characters)."],
  invalid_relationship: [400, 'Keep the relationship to 40 characters.'],
  invalid_phone: [400, 'Enter a valid mobile number, for example +91 98765 43210.'],
  invalid_contact: [400, 'Choose a contact.'],
  invalid_event: [400, 'Choose an alert.'],
  invalid_code: [400, 'Enter the 6-digit code.'],
  invalid_setting: [400, 'Say whether visitor alerts should be on or off.'],
  invalid_idempotency_key: [400, 'Send a new idempotency key: 16 to 64 letters, digits, "-" or "_".'],
  confirm_required: [400, 'Confirm that this is an emergency.'],
  acknowledge_required: [400, 'Confirm that you have read what this setting changes.'],
  too_many_contacts: [409, 'You can have up to 5 emergency contacts.'],
  duplicate_contact: [409, 'That number is already one of your emergency contacts.'],
  contact_not_found: [404, 'Contact not found.'],
  already_verified: [409, 'This contact is already verified.'],
  verify_cooldown: [429, 'Please wait before sending another code.'],
  verify_rate_limited: [429, 'Too many codes requested. Try again later.'],
  number_rate_limited: [429, 'This number has had too many codes today. Try again tomorrow.'],
  no_challenge: [410, 'Request a new code.'],
  code_expired: [410, 'This code has expired. Request a new one.'],
  wrong_code: [400, 'That code is not right.'],
  too_many_attempts: [429, 'Too many wrong attempts. Request a new code.'],
  no_verified_contacts: [422, 'Verify at least one emergency contact first.'],
  alert_in_progress: [409, 'An alert was sent moments ago. Check its status.'],
  alert_rate_limited: [429, 'Too many alerts have been sent. Try again later.'],
  service_busy: [503, 'Alerts are limited right now. If someone is in danger, call 112.'],
  unavailable: [404, 'Emergency alerts are not available for this profile.'],
  event_not_found: [404, 'Alert not found.'],
  already_cancelled: [409, 'This alert has already been stopped.'],
  already_complete: [409, 'Every message has already been sent. Sent messages cannot be recalled.'],
  already_reported: [409, 'This alert has already been reported.'],
  provider_not_configured: [503, 'Text messages are not set up yet, so nothing was sent.'],
  provider_failed: [502, 'The text message could not be sent. Please try again.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const SAFETY = 'SHYGON does not contact emergency services. If someone is in danger, call 112.';
const KEY = /^[A-Za-z0-9_-]{16,64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{2,39}$/i;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

function fail(code, extra = {}) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  const error = { code: ERRORS[code] ? code : 'internal', message };
  if (Number.isFinite(extra.retryAfter) && status === 429) error.retryAfter = extra.retryAfter;
  if (extra.attemptsLeft !== undefined) error.attemptsLeft = extra.attemptsLeft;
  if (extra.eventId) error.eventId = extra.eventId;
  const response = json({ error }, status);
  if (error.retryAfter) response.headers.set('retry-after', String(error.retryAfter));
  return response;
}

/** A database refusal ("emergency:<code>") becomes its API error; anything else is internal. */
function fromDb(error, log) {
  if (error instanceof DbError && error.emergencyCode && ERRORS[error.emergencyCode]) {
    const retryAfter = Number.parseInt(error.details ?? '', 10);
    return fail(error.emergencyCode, { retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined });
  }
  log.error('emergency.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

const withMeta = (event) => event && { ...event, deliveryReceipts: deliveryReceipts(), providerConfigured: alertsConfigured() };

// --- owner: contacts and settings -------------------------------------------

async function listContacts(cfg, user) {
  const [contacts, settings] = await Promise.all([
    rpc(cfg, 'emergency_contacts_for', { p_user: user.id }),
    rpc(cfg, 'emergency_settings_for', { p_user: user.id }),
  ]);
  return json({ contacts, settings: { ...settings, providerConfigured: alertsConfigured() } });
}

async function saveContact(cfg, user, body) {
  const contactId = body.contactId ?? null;
  if (contactId !== null && !isUuid(contactId)) return fail('invalid_contact');
  if (typeof body.name !== 'string') return fail('invalid_name');
  if (body.relationship !== undefined && body.relationship !== null && typeof body.relationship !== 'string') {
    return fail('invalid_relationship');
  }
  const phone = toE164(body.phone);
  if (!phone) return fail('invalid_phone');
  const contact = await rpc(cfg, 'emergency_contact_save', {
    p_user: user.id, p_contact_id: contactId, p_name: body.name, p_relationship: body.relationship ?? null, p_phone: phone,
  });
  const { publicAlertsDisabled, ...rest } = contact;
  return json({ contact: rest, publicAlertsDisabled }, contactId ? 200 : 201);
}

async function removeContact(cfg, user, body) {
  if (!isUuid(body.contactId)) return fail('invalid_contact');
  return json(await rpc(cfg, 'emergency_contact_remove', { p_user: user.id, p_contact_id: body.contactId }));
}

async function setSettings(cfg, user, body) {
  if (typeof body.publicAlertsEnabled !== 'boolean') return fail('invalid_setting');
  if (body.acknowledge !== true) return fail('acknowledge_required');
  const settings = await rpc(cfg, 'emergency_settings_set', {
    p_user: user.id, p_public_alerts_enabled: body.publicAlertsEnabled, p_acknowledge: true,
  });
  return json({ settings: { ...settings, providerConfigured: alertsConfigured() } });
}

async function requestVerification(cfg, user, body, log) {
  if (!isUuid(body.contactId)) return fail('invalid_contact');
  const challengeId = crypto.randomUUID();
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const started = await rpc(cfg, 'emergency_verification_start', {
    p_user: user.id, p_contact_id: body.contactId, p_challenge_id: challengeId,
    p_code_hash: codeHash(cfg.secret, body.contactId, code),
  });
  const message = verificationMessage(started.ownerName, code);
  try {
    await sendText({ to: started.phone, text: message.text, msg91: message.msg91, timeoutMs: PROVIDER_TIMEOUT_MS });
  } catch (error) {
    await rpc(cfg, 'emergency_verification_abort', { p_user: user.id, p_challenge_id: challengeId }).catch(() => undefined);
    if (error instanceof SmsError) {
      log.warn('emergency.verify-not-sent', { kind: error.kind, httpStatus: error.httpStatus });
      return fail(error.kind === 'not_configured' ? 'provider_not_configured' : 'provider_failed');
    }
    throw error;
  }
  return json({ contactId: body.contactId, phone: started.phoneMasked, expiresAt: started.expiresAt, resendAfter: 45 });
}

async function confirmVerification(cfg, user, body) {
  if (!isUuid(body.contactId)) return fail('invalid_contact');
  const code = String(body.code ?? '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) return fail('invalid_code');
  const result = await rpc(cfg, 'emergency_verification_confirm', {
    p_user: user.id, p_contact_id: body.contactId, p_code_hash: codeHash(cfg.secret, body.contactId, code),
  });
  if (!result.ok) return fail(result.code, { attemptsLeft: result.attemptsLeft });
  return json({ contact: result.contact });
}

// --- owner: alerts --------------------------------------------------------------

async function eventDetail(cfg, userId, eventId) {
  return withMeta(await rpc(cfg, 'emergency_event_detail', { p_user: userId, p_event_id: eventId }));
}

async function createAlert(cfg, user, body, log) {
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || !KEY.test(key)) return fail('invalid_idempotency_key');
  const opened = await rpc(cfg, 'emergency_alert_open', { p_user: user.id, p_initiator: 'owner', p_idempotency_key: key });
  if (!opened.ok) {
    log.warn('emergency.alert-refused', { initiator: 'owner', code: opened.code });
    return fail(opened.code, { retryAfter: opened.retryAfter, eventId: opened.eventId });
  }
  if (!opened.replayed) {
    log.info('emergency.alert-created', { initiator: 'owner', eventId: opened.eventId });
    await dispatchDue(cfg, { eventId: opened.eventId, log });
  }
  return json({ event: await eventDetail(cfg, user.id, opened.eventId), replayed: opened.replayed, safety: SAFETY },
    opened.replayed ? 200 : 201);
}

async function getAlert(cfg, user, body) {
  if (!isUuid(body.eventId)) return fail('invalid_event');
  const event = await eventDetail(cfg, user.id, body.eventId);
  return event ? json({ event }) : fail('event_not_found');
}

async function listAlerts(cfg, user, body) {
  const limit = Number.isInteger(body.limit) ? body.limit : 20;
  return json({ events: await rpc(cfg, 'emergency_events_for', { p_user: user.id, p_limit: limit }) });
}

async function retryAlert(cfg, user, body, log) {
  if (!isUuid(body.eventId)) return fail('invalid_event');
  if (!(await rpc(cfg, 'emergency_event_detail', { p_user: user.id, p_event_id: body.eventId }))) return fail('event_not_found');
  let requeued = 0;
  if (alertsConfigured()) {
    requeued = await rpc(cfg, 'emergency_requeue_not_sent', { p_user: user.id, p_event_id: body.eventId });
  }
  const dispatched = await dispatchDue(cfg, { eventId: body.eventId, log });
  return json({ event: await eventDetail(cfg, user.id, body.eventId), requeued, dispatched: dispatched.claimed });
}

async function cancelAlert(cfg, user, body) {
  if (!isUuid(body.eventId)) return fail('invalid_event');
  return json({ event: withMeta(await rpc(cfg, 'emergency_cancel', { p_user: user.id, p_event_id: body.eventId })) });
}

async function reportAlert(cfg, user, body) {
  if (!isUuid(body.eventId)) return fail('invalid_event');
  if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 300)) return fail('invalid_request');
  return json(await rpc(cfg, 'emergency_report', { p_user: user.id, p_event_id: body.eventId, p_reason: body.reason ?? null }));
}

// --- visitors ---------------------------------------------------------------------

/**
 * Visitor-initiated alerts run only where EMERGENCY_PUBLIC_ALERTS=on is set on
 * the host. Off (unset) by default: until the owner decides DEC-2026-038 Q2, a
 * deployment answers "unavailable" to every visitor, whatever owners chose.
 */
const publicAlertsAllowed = () => env('EMERGENCY_PUBLIC_ALERTS') === 'on';

async function publicStatus(cfg, body) {
  const slug = String(body.slug ?? '').trim();
  if (!publicAlertsAllowed() || !SLUG.test(slug)) return json({ available: false });
  const target = await rpc(cfg, 'emergency_public_target', { p_slug: slug });
  return json({ available: Boolean(target) });
}

/** What a visitor learns: whether the alert reached the provider. Never who, or how many. */
const VISITOR_OUTCOME = {
  queued: 'sending', sending: 'sending', sent: 'sent', delivered: 'sent', partial: 'sent',
  failed: 'failed', not_sent: 'not_sent', cancelled: 'failed',
};

async function publicAlert(cfg, request, body, log) {
  if (!publicAlertsAllowed()) return fail('unavailable');
  if (body.confirm !== true) return fail('confirm_required');
  const key = body.idempotencyKey;
  if (typeof key !== 'string' || !KEY.test(key)) return fail('invalid_idempotency_key');
  const slug = String(body.slug ?? '').trim();
  if (!SLUG.test(slug)) return fail('unavailable');
  const digest = visitorDigest(cfg.secret, request);
  if (!digest) {
    log.warn('emergency.public-no-client-address', { trustedHeaderConfigured: Boolean(trustedClientIpHeader()) });
    return fail('unavailable');
  }
  const target = await rpc(cfg, 'emergency_public_target', { p_slug: slug });
  if (!target) return fail('unavailable');
  const opened = await rpc(cfg, 'emergency_alert_open', {
    p_user: target.userId, p_initiator: 'public', p_idempotency_key: key,
    p_tap_profile_id: target.tapProfileId, p_visitor_digest: digest,
  });
  if (!opened.ok) {
    log.warn('emergency.alert-refused', { initiator: 'public', code: opened.code });
    return fail(opened.code, { retryAfter: opened.retryAfter });
  }
  if (!opened.replayed) {
    log.info('emergency.alert-created', { initiator: 'public', eventId: opened.eventId });
    await dispatchDue(cfg, { eventId: opened.eventId, log });
  }
  const event = await rpc(cfg, 'emergency_event_detail', { p_user: target.userId, p_event_id: opened.eventId });
  return json({ outcome: VISITOR_OUTCOME[event?.status] ?? 'failed', safety: SAFETY }, 202);
}

// --- entry ------------------------------------------------------------------------

const OWNER_OPS = {
  'contacts.list': (cfg, user) => listContacts(cfg, user),
  'contacts.save': (cfg, user, body) => saveContact(cfg, user, body),
  'contacts.remove': (cfg, user, body) => removeContact(cfg, user, body),
  'contacts.verify.request': (cfg, user, body, log) => requestVerification(cfg, user, body, log),
  'contacts.verify.confirm': (cfg, user, body) => confirmVerification(cfg, user, body),
  'settings.set': (cfg, user, body) => setSettings(cfg, user, body),
  'alerts.create': (cfg, user, body, log) => createAlert(cfg, user, body, log),
  'alerts.list': (cfg, user, body) => listAlerts(cfg, user, body),
  'alerts.get': (cfg, user, body) => getAlert(cfg, user, body),
  'alerts.retry': (cfg, user, body, log) => retryAlert(cfg, user, body, log),
  'alerts.cancel': (cfg, user, body) => cancelAlert(cfg, user, body),
  'alerts.report': (cfg, user, body) => reportAlert(cfg, user, body),
};

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('emergency.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');

  try {
    if (body.op === 'public.status') return await publicStatus(cfg, body);
    if (body.op === 'public.alert') return await publicAlert(cfg, request, body, log);

    // Own keys only: `constructor`, `toString` or `__proto__` are not operations.
    const op = Object.hasOwn(OWNER_OPS, body.op) ? OWNER_OPS[body.op] : null;
    if (!op) return fail('unknown_op');
    const user = await currentUser(cfg, request);
    if (!user) {
      log.warn('security.session-refused', { op: body.op });
      return fail('unauthenticated');
    }
    return await op(cfg, user, body, log);
  } catch (error) {
    return fromDb(error, log);
  }
}

export default async (request) => {
  const log = requestLog('emergency', request);
  return log.respond(await handle(request, log));
};
