// Card pairing ("tap to activate") and "report stolen" (V01 T-08, T-09):
// migration 041, /api/verify's pairing answer and /api/cards on the local stack,
// against DEC-2026-047 (approved for the local build 2026-11-10). A simulated
// SDM chip (DESFire EV3, as in test:verified-tap) with random TEST keys.
//
//   A. Closure.
//   B. Pairing: a shipped card's genuine tap opens no Tap and carries a proof.
//   C. Activation with the proof, by the owner only; single use; tampering refused.
//   D. The guard: no other writer activates an AAROH card or revives a retired one.
//   E. Report stolen: terminal, and the card opens nothing.
//   F. The export shows each card's history.
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/card-lifecycle.mjs
import crypto from 'node:crypto';
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp } from '../local/testkit.mjs';
import { diversifyKey, sdmMac, sdmSessionMacKey } from '../../netlify/lib/sun.mjs';
import { possessionProof } from '../../netlify/lib/possession.mjs';

const t = createHarness('Card pairing and report stolen (041, /api/cards, DEC-2026-047)');
const hex = (n) => crypto.randomBytes(n).toString('hex');
const META_MASTER = hex(16);
const FILE_MASTER = hex(16);
const PEPPER = hex(32);
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const newCode = () => Array.from(crypto.randomBytes(16), (b) => BASE32[b % 32]).join('');
const uidHmac = (uid) => crypto.createHmac('sha256', PEPPER).update(uid.toLowerCase()).digest('hex');

/** A simulated chip, as in test:verified-tap (AN12196 §3.4; keys diversified by the card id, D-a). */
function chip(cardId, uid) {
  const input = Buffer.from(cardId.replace(/-/g, ''), 'hex');
  const meta = diversifyKey(META_MASTER, input);
  const file = diversifyKey(FILE_MASTER, input);
  return (counter) => {
    const block = Buffer.concat([Buffer.from([0xc7]), Buffer.from(uid, 'hex'),
      Buffer.from([counter & 0xff, (counter >> 8) & 0xff, (counter >> 16) & 0xff]), crypto.randomBytes(5)]);
    const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(meta, 'hex'), Buffer.alloc(16));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(block), cipher.final()]).toString('hex').toUpperCase();
    return { e, c: sdmMac(sdmSessionMacKey(file, uid, counter), '').toUpperCase() };
  };
}

const stack = await startStack();
process.env.STACK_SIM_CLIENT_ADDRESS = '1';
process.env.VERIFIED_TAP = 'on';
process.env.VERIFY_META_MASTER_1 = META_MASTER;
process.env.VERIFY_FILE_MASTER_1 = FILE_MASTER;
process.env.VERIFY_UID_PEPPER = PEPPER;
const SECRET = process.env.OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
const q = async (sql, params = []) => (await stack.query(sql, params)).rows;
let ip = 0;
const verify = (body) => callFunction(stack, 'verify', { body: { op: 'tap.verify', ...body }, headers: { 'x-shygon-sim-client': `203.0.113.${(ip++ % 200) + 1}` } });
const cards = (body, token) => callFunction(stack, 'cards', { token, body });
const codeOf = (r) => r.body?.error?.code;
const events = async (card) => (await q(`SELECT from_status, to_status, actor, reason FROM public.card_events WHERE card_id = $1 ORDER BY created_at, id`, [card]))
  .map((e) => `${e.from_status}>${e.to_status} ${e.actor}: ${e.reason}`);
const statusOf = async (card) => (await q(`SELECT status FROM public.cards WHERE id = $1`, [card]))[0].status;

/** An owner with a published Tap and a card issued to them, with or without a personalised chip. */
let seq = 0;
async function issued({ status = 'shipped', chipped = true, owner = null } = {}) {
  seq++;
  const o = owner ?? await signUp(stack, { name: `Card Owner ${seq}` });
  const slug = `card-${seq}-${hex(3)}`;
  if (!owner) {
    await q(`INSERT INTO public.tap_profiles (user_id, customer_id, slug, username, display_name, status, published)
      VALUES ($1, (SELECT id FROM public.customers WHERE user_id = $1), $2, $2, 'Card Owner', 'active', true)`, [o.userId, slug]);
  }
  const card = (await q(`INSERT INTO public.cards (user_id, card_id, activation_code, sku, card_slot, status,
      edition_design, edition_serial, edition_count, edition_chapter_size)
    VALUES ($1, $2, $3, 'aaroh-test', 1, $4, 'Obsidian', $5, 100, 100) RETURNING id`,
  [o.userId, `CARD-${seq}-${hex(3)}`, `CARDACT${seq}`, status, 50 + seq]))[0].id;
  const uid = `04${hex(6)}`;
  const code = newCode();
  if (chipped) await q(`SELECT public.verify_register_device($1, $2, 1, $3)`, [card, code, uidHmac(uid)]);
  return { owner: o, slug: owner ? null : slug, card, code, tap: chip(card, uid) };
}

// ---------------------------------------------------------------------------
t.section('A. Closure');

await t.check('card_events is closed and append-only; the new functions are server only; the guard is in place', async () => {
  const r = (await q(`SELECT
      has_table_privilege('authenticated', 'public.card_events', 'SELECT') OR has_table_privilege('anon', 'public.card_events', 'SELECT') AS client,
      has_table_privilege('service_role', 'public.card_events', 'UPDATE') OR has_table_privilege('service_role', 'public.card_events', 'DELETE') AS rewrite,
      has_function_privilege('authenticated', 'public.card_transition(uuid, text, text, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.card_owner_activate(uuid, uuid, text, integer)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.card_owner_retire(uuid, uuid)', 'EXECUTE') AS fn,
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cards_guard_transition' AND NOT tgisinternal) AS guard`))[0];
  assertEqual(r, { client: false, rewrite: false, fn: false, guard: true }, 'closure');
  return 'reachable only through /api/cards';
});

// ---------------------------------------------------------------------------
t.section('B. Pairing: a card issued to an owner but not yet active');

const a = await issued();
let proofA;
await t.check('a shipped card: a plain link is not_verified; a genuine tap opens no Tap and carries a possession proof', async () => {
  assertEqual((await verify({ code: a.code })).body, { slug: null, verdict: 'not_verified' }, 'plain link');
  const r = await verify({ code: a.code, ...a.tap(5) });
  assertEqual([r.status, r.body.slug, r.body.verdict, r.body.edition?.number], [200, null, 'genuine', 50 + 1], 'genuine, no Tap');
  assert(/^[a-z2-7]{16}\.5\.\d+\.[0-9a-f]{64}$/.test(r.body.possession ?? ''), `proof ${r.body.possession}`);
  proofA = r.body.possession;
  const again = await verify({ code: a.code, ...a.tap(5) });
  assertEqual([again.body.verdict, 'possession' in again.body], ['already_checked', false], 'a replayed tap carries no proof');
  return 'the owner\'s page is never opened by a card that is not active';
});

// ---------------------------------------------------------------------------
t.section('C. Tap to activate');

await t.check('only the owner\'s own session activates, and only with a proof from that card', async () => {
  assertEqual((await cards({ op: 'owner.card.activate', cardId: a.card, possession: proofA })).status, 401, 'no session');
  const other = await signUp(stack, { name: 'Oscar Other' });
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: proofA }, other.token)), 'card_not_found', 'another account');
  const b = await issued({ owner: a.owner });
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: b.card, possession: proofA }, a.owner.token)), 'proof_mismatch', 'a proof from another card');
  const tampered = proofA.replace(/.$/, (ch) => (ch === '0' ? '1' : '0'));
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: tampered }, a.owner.token)), 'invalid_proof', 'tampered');
  const expired = possessionProof(SECRET, a.code, 5, Date.now() - 11 * 60_000);
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: expired }, a.owner.token)), 'proof_expired', 'expired');
  const unseen = possessionProof(SECRET, a.code, 99);
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: unseen }, a.owner.token)), 'proof_mismatch', 'a counter never accepted as genuine');
  assertEqual(await statusOf(a.card), 'shipped', 'still shipped');
  return 'a stolen session without the card, or the card without the session, activates nothing';
});

await t.check('the owner\'s proof activates the card, links it to their Tap, logs it; then the card opens the Tap', async () => {
  const r = await cards({ op: 'owner.card.activate', cardId: a.card, possession: proofA }, a.owner.token);
  assertEqual([r.status, r.body.card.status, r.body.card.verifiedTap.registered, r.body.card.verifiedTap.retired], [200, 'active', true, false], 'activated');
  assert(!JSON.stringify(r.body).includes('CARDACT') && !('activationCode' in r.body.card), 'no activation code in the answer');
  const row = (await q(`SELECT tap_profile_id IS NOT NULL AS linked, activation_expires_at, activated_at IS NOT NULL AS stamped FROM public.cards WHERE id = $1`, [a.card]))[0];
  assertEqual(row, { linked: true, activation_expires_at: null, stamped: true }, 'linked, no expiry');
  assertEqual(await events(a.card), ['shipped>active owner: tap to activate'], 'history');
  assertEqual((await q(`SELECT count(*)::int AS n FROM public.account_events WHERE user_id = $1 AND event_type = 'card_activated'`, [a.owner.userId]))[0].n, 1, 'account history');
  const tap = await verify({ code: a.code, ...a.tap(6) });
  assertEqual([tap.body.slug, tap.body.verdict, 'possession' in tap.body], [a.slug, 'genuine', false], 'an active card opens the Tap and carries no proof');
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: proofA }, a.owner.token)), 'already_active', 'twice');
  return 'two factors: the card in hand and the owner\'s session';
});

await t.check('a proof is single use, a suspended card is not pairable, a card without a chip is pointed elsewhere', async () => {
  // Support returns the card to pending (a non-activating move the guard allows):
  // the old proof is spent.
  await q(`UPDATE public.cards SET status = 'pending' WHERE id = $1`, [a.card]);
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: a.card, possession: proofA }, a.owner.token)), 'proof_used', 'reused');
  const s = await issued({ status: 'suspended', owner: a.owner });
  assertEqual(codeOf(await verify({ code: s.code, ...s.tap(1) })), 'unavailable', 'a suspended card answers unavailable (O-7 stays closed)');
  const v5 = await issued({ chipped: false, owner: a.owner });
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: v5.card, possession: possessionProof(SECRET, a.code, 1) }, a.owner.token)), 'not_registered', 'no chip');
  return 'no path around the tap';
});

await t.check('v0.18 (045): the proof alone activates the right card; another account, an unregistered code or a bad card id activates nothing and uses no proof', async () => {
  const p = await issued();
  const proof = (await verify({ code: p.code, ...p.tap(7) })).body.possession;
  assert(typeof proof === 'string', 'a genuine tap carries a proof');
  const stranger = await signUp(stack, { name: 'Sam Stranger' });
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', possession: proof }, stranger.token)), 'card_not_found', 'another account, proof only');
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', cardId: 'not-a-uuid', possession: proof }, p.owner.token)), 'invalid_card', 'a malformed card id');
  assertEqual(codeOf(await cards({ op: 'owner.card.activate', possession: possessionProof(SECRET, newCode(), 7) }, p.owner.token)), 'card_not_found', 'a code registered to no card');
  assertEqual(codeOf(await cards({ op: 'owner.card.activate' }, p.owner.token)), 'invalid_proof', 'no proof at all');
  assertEqual(await statusOf(p.card), 'shipped', 'still shipped: no refusal used the proof');
  const r = await cards({ op: 'owner.card.activate', possession: proof }, p.owner.token);
  assertEqual([r.status, r.body.card?.id, r.body.card?.status], [200, p.card, 'active'], 'activated from the proof alone');
  assertEqual(await events(p.card), ['shipped>active owner: tap to activate'], 'the same history');
  return 'the /d/ page needs no card id';
});

// ---------------------------------------------------------------------------
t.section('D. The guard');

await t.check('no other writer makes an AAROH card active or brings one back from retired; V5 cards are untouched', async () => {
  const g = await issued();
  await q(`UPDATE public.cards SET status = 'active', activated_at = now() WHERE id = $1`, [g.card]);
  const row = (await q(`SELECT status, activated_at FROM public.cards WHERE id = $1`, [g.card]))[0];
  assertEqual([row.status, row.activated_at], ['shipped', null], 'the row is left as it was');
  assertEqual(await events(g.card), ['shipped>active system: refused: tap to activate only'], 'the refusal is logged');
  await q(`UPDATE public.cards SET status = 'suspended' WHERE id = $1`, [g.card]);
  assertEqual(await statusOf(g.card), 'suspended', 'a non-activating move is allowed (support)');
  const v5 = await issued({ chipped: false, owner: g.owner });
  await q(`UPDATE public.cards SET status = 'active' WHERE id = $1`, [v5.card]);
  assertEqual(await statusOf(v5.card), 'active', 'a V5 card keeps every live path');
  return 'the frozen writers are not edited; the trigger sits under them';
});

// ---------------------------------------------------------------------------
t.section('E. Report stolen');

await t.check('retiring needs confirm; it is terminal; the chip is retired; the card then opens nothing', async () => {
  const r = await issued();
  const tapped = await verify({ code: r.code, ...r.tap(1) });
  assertEqual((await cards({ op: 'owner.card.activate', cardId: r.card, possession: tapped.body.possession }, r.owner.token)).status, 200, 'activated');
  assertEqual(codeOf(await cards({ op: 'owner.card.retire', cardId: r.card }, r.owner.token)), 'confirm_required', 'no confirm');
  const other = await signUp(stack, { name: 'Tess Thief' });
  assertEqual(codeOf(await cards({ op: 'owner.card.retire', cardId: r.card, confirm: true }, other.token)), 'card_not_found', 'another account');
  const done = await cards({ op: 'owner.card.retire', cardId: r.card, confirm: true }, r.owner.token);
  assertEqual([done.status, done.body.card.status, done.body.card.verifiedTap.registered, done.body.card.verifiedTap.retired], [200, 'retired', true, true], 'retired');
  const after = await verify({ code: r.code, ...r.tap(2) });
  assertEqual([after.status, codeOf(after)], [404, 'unavailable'], 'the stolen card opens nothing');
  assertEqual(await events(r.card), ['shipped>active owner: tap to activate', 'active>retired owner: reported stolen'], 'history');
  await q(`UPDATE public.cards SET status = 'active' WHERE id = $1`, [r.card]);
  assertEqual(await statusOf(r.card), 'retired', 'no writer revives it');
  assertEqual(codeOf(await cards({ op: 'owner.card.retire', cardId: r.card, confirm: true }, r.owner.token)), 'card_retired', 'twice');
  const note = await q(`SELECT title FROM public.notifications WHERE user_id = $1 AND category = 'account'`, [r.owner.userId]);
  assertEqual(note.map((n) => n.title), ['Card switched off'], 'the owner is told');
  return 'only SHYGON support can undo it, with a new personalisation';
});

await t.check('a V5 card (no chip) can be retired too; the answer says it has no chip, because /t/ still opens (F3)', async () => {
  const v5 = await issued({ chipped: false, status: 'active' });
  const r = await cards({ op: 'owner.card.retire', cardId: v5.card, confirm: true }, v5.owner.token);
  assertEqual([r.body.card.status, r.body.card.verifiedTap.registered], ['retired', false], 'retired, no chip');
  const list = await cards({ op: 'owner.cards.list' }, v5.owner.token);
  assertEqual([list.status, list.body.cards.length, list.body.cards[0].status], [200, 1, 'retired'], 'list');
  assert(!JSON.stringify(list.body).includes('CARDACT') && !JSON.stringify(list.body).includes('card_uid'), 'no activation code or UID');
  return 'the page must say the Tap link still opens';
});

// ---------------------------------------------------------------------------
t.section('F. Export');

await t.check('the owner\'s export shows each card\'s history', async () => {
  const x = (await q(`SELECT public.account_export_build($1) AS x`, [a.owner.userId]))[0].x;
  const mine = x.cards.find((c) => c.cardId.startsWith('CARD-1-'));
  assertEqual(mine.history.map((h) => `${h.from}>${h.to} ${h.actor}`), ['shipped>active owner'], 'history');
  return 'export parity: card_events is exported with its card';
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
