import { requestLog } from '../lib/log.mjs';
import { config, currentUser, DbError, rpc } from '../lib/emergency.mjs';
import { readPossession } from '../lib/possession.mjs';

/**
 * POST /api/cards: the signed-in owner's cards (V01 tasks T-08, T-09; migration
 * 041; DEC-2026-047, approved for the local build). The contract is
 * docs/v6/aaroh/api-contract.md §7 (C-6 to C-8).
 *
 * Body: { op: '<operation>', ...fields }. Every operation needs
 * Authorization: Bearer <the customer's access token>.
 *
 *   owner.cards.list       my cards, without activation codes or chip UIDs
 *   owner.card.activate    { possession, cardId? }: "tap to activate" an AAROH card.
 *                          `possession` comes from a genuine Verified Tap on that
 *                          card (/api/verify) within 10 minutes; single use. Since
 *                          v0.18 (migration 045) the card may be left out: it is
 *                          found from the proof's code. If named, it must match.
 *   owner.card.retire      { cardId, confirm: true }: report stolen. Terminal: the
 *                          card opens nothing (/d/<code> answers unavailable).
 *                          A card without a chip (V5) keeps opening /t/ (F3).
 *
 * Errors: { error: { code, message } }. Messages are fixed text.
 */

const ERRORS = {
  unauthenticated: [401, 'Please sign in to manage your cards.'],
  method_not_allowed: [405, 'Method not allowed.'],
  unknown_op: [400, 'Unknown operation.'],
  invalid_request: [400, 'That request is not valid.'],
  invalid_card: [400, 'Choose a card.'],
  confirm_required: [400, 'Confirm that you want to switch this card off for good.'],
  invalid_proof: [400, 'Tap the card again to activate it.'],
  proof_expired: [410, 'That tap has expired. Tap the card again.'],
  card_not_found: [404, 'Card not found.'],
  not_registered: [409, 'This card has no secure chip. Activate it with a code instead.'],
  proof_mismatch: [409, 'That tap was not from this card.'],
  proof_used: [409, 'Tap the card again to activate it.'],
  already_active: [409, 'This card is already active.'],
  card_retired: [409, 'This card has been switched off.'],
  not_pairable: [409, 'This card cannot be activated here. Contact SHYGON support.'],
  server_misconfigured: [500, 'The server is not configured.'],
  internal: [500, 'Something went wrong. Please try again.'],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 4 * 1024;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function fail(code) {
  const [status, message] = ERRORS[code] ?? ERRORS.internal;
  return json({ error: { code: ERRORS[code] ? code : 'internal', message } }, status);
}

function fromDb(error, log) {
  if (error instanceof DbError && error.appCode && ERRORS[error.appCode]) return fail(error.appCode);
  log.error('cards.db-error', { status: error?.status, code: error?.code, error });
  return fail('internal');
}

const answer = (r, log, event) => {
  if (r?.ok !== true) {
    log.warn(`cards.${event}-refused`, { code: r?.code ?? null });
    return fail(r?.code);
  }
  log.info(`cards.${event}`, { cardId: r.card?.id ?? null });
  return json({ card: r.card });
};

const OPS = {
  'owner.cards.list': async (cfg, user) => json({ cards: await rpc(cfg, 'card_owner_list', { p_user: user.id }) }),
  'owner.card.activate': async (cfg, user, body, log) => {
    // v0.18: the card is optional; the proof names the chip (DEC-2026-047 §8).
    if (body.cardId !== undefined && (typeof body.cardId !== 'string' || !UUID.test(body.cardId))) return fail('invalid_card');
    const proof = readPossession(cfg.secret, body.possession);
    if (!proof.ok) return fail(proof.reason === 'expired' ? 'proof_expired' : 'invalid_proof');
    const r = await rpc(cfg, 'card_owner_activate', {
      p_user: user.id, p_card: body.cardId ?? null, p_code: proof.code, p_counter: proof.counter,
    });
    return answer(r, log, 'activated');
  },
  'owner.card.retire': async (cfg, user, body, log) => {
    if (typeof body.cardId !== 'string' || !UUID.test(body.cardId)) return fail('invalid_card');
    if (body.confirm !== true) return fail('confirm_required');
    const r = await rpc(cfg, 'card_owner_retire', { p_user: user.id, p_card: body.cardId });
    return answer(r, log, 'retired');
  },
};

async function handle(request, log) {
  if (request.method !== 'POST') return fail('method_not_allowed');
  const cfg = config();
  if (!cfg) {
    log.error('cards.misconfigured', { missing: 'database settings' });
    return fail('server_misconfigured');
  }
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return fail('invalid_request');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail('invalid_request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.op !== 'string') return fail('invalid_request');
  // Own keys only: `constructor`, `toString` or `__proto__` are not operations.
  const op = Object.hasOwn(OPS, body.op) ? OPS[body.op] : null;
  if (!op) return fail('unknown_op');
  try {
    // The owner comes only from the verified token; nothing in the body can name one.
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
  const log = requestLog('cards', request);
  return log.respond(await handle(request, log));
};
