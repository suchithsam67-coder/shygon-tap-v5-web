// Account phone verification (V01 T-11; finding F4): migration 039, the
// /api/account phone operations, card-otp and the order-text fallback on the
// local stack, against DEC-2026-045 (approved for the local build 2026-11-05).
// Texts go to the stack's SMS stand-in, which records them; no real number is
// texted.
//
// Not claimed: two requests racing the limits (PGlite has one connection; the
// advisory lock is read from the functions instead).
//
//   node --import ./scripts/ci/deny-network.mjs supabase/tests/phone-verify.mjs
import { startStack } from '../local/stack.mjs';
import { assert, assertEqual, callFunction, createHarness, signUp, supabaseClient } from '../local/testkit.mjs';

const t = createHarness('Account phone verification (039, /api/account, card-otp, DEC-2026-045)');
const logLines = [];
for (const level of ['log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    const line = args.map(String).join(' ');
    if (line.startsWith('{')) logLines.push(line);
    original(...args);
  };
}

const stack = await startStack();
stack.useSms('twilio', { receipts: false });
const sms = stack.sms;
const responses = [];
const codesSeen = [];
const call = async (body, token) => {
  const r = await callFunction(stack, 'account', { token, body });
  responses.push(JSON.stringify(r.body));
  return r;
};
const cardOtp = async (body, token) => {
  const r = await callFunction(stack, 'card-otp', { token, body });
  responses.push(JSON.stringify(r.body));
  return r;
};
const codeOf = (r) => r.body?.error?.code;
const q = async (sql, params = []) => (await stack.query(sql, params)).rows;
const setPhone = (u, phone) => q(`UPDATE public.profiles SET phone = $2 WHERE id = $1`, [u.userId, phone]);
/** The newest text to a number, and the code in it. */
const textTo = (e164) => sms.messages.filter((m) => m.to === e164).at(-1);
const codeTo = (e164) => {
  const code = /(\d{6})/.exec(textTo(e164)?.body ?? '')?.[1] ?? null;
  if (code) codesSeen.push(code);
  return code;
};
/** Moves an account's codes back in time, past the 45-second gap between sends. */
const pastCooldown = (u) => q(`UPDATE public.account_phone_challenges SET created_at = created_at - interval '1 minute' WHERE user_id = $1`, [u.userId]);
const wrongCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');
const start = (u) => call({ op: 'phone.verify.start' }, u.token);
const confirm = (u, code) => call({ op: 'phone.verify.confirm', code }, u.token);
async function verified(name, phone) {
  const u = await signUp(stack, { name });
  await setPhone(u, phone);
  const s = await start(u);
  assertEqual(s.status, 200, `start for ${name}: ${JSON.stringify(s.body)}`);
  const c = await confirm(u, codeTo(`+91${phone.replace(/\D/g, '').slice(-10)}`));
  assertEqual(c.status, 200, `confirm for ${name}: ${JSON.stringify(c.body)}`);
  return u;
}
let cardSeq = 0;
async function card(u) {
  cardSeq++;
  return (await q(`INSERT INTO public.cards (user_id, card_id, activation_code, sku, card_slot, status)
    VALUES ($1, $2, $3, 'phone-test', 1, 'active') RETURNING id`, [u.userId, `SHY-PHV-${cardSeq}`, `ACTPHV${cardSeq}`]))[0].id;
}

// ---------------------------------------------------------------------------
t.section('A. Closure');

await t.check('server only: both tables closed to client roles; all five functions service-only', async () => {
  const r = (await q(`SELECT
      (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.oid IN ('public.account_phone_verifications'::regclass, 'public.account_phone_challenges'::regclass)) AS rls,
      has_table_privilege('anon', 'public.account_phone_verifications', 'SELECT') OR has_table_privilege('authenticated', 'public.account_phone_verifications', 'SELECT')
        OR has_table_privilege('authenticated', 'public.account_phone_challenges', 'SELECT') OR has_table_privilege('authenticated', 'public.account_phone_verifications', 'INSERT') AS client_tables,
      has_function_privilege('authenticated', 'public.account_phone_confirm(uuid, text, text)', 'EXECUTE')
        OR has_function_privilege('anon', 'public.account_phone_start(uuid, text, uuid, text)', 'EXECUTE')
        OR has_function_privilege('authenticated', 'public.account_phone_state(uuid, text)', 'EXECUTE') AS client_functions,
      has_function_privilege('service_role', 'public.account_phone_confirm(uuid, text, text)', 'EXECUTE') AS service`))[0];
  assertEqual(r, { rls: true, client_tables: false, client_functions: false, service: true }, 'closure');
  const src = (await q(`SELECT string_agg(prosrc, ' ') AS s FROM pg_proc WHERE proname IN ('account_phone_start', 'account_phone_confirm')`))[0].s;
  assertEqual((src.match(/pg_advisory_xact_lock\(hashtext\('account_phone:' \|\| p_user::text\)\)/g) ?? []).length, 2, 'one request at a time per account');
  return 'reachable only through /api/account';
});

// ---------------------------------------------------------------------------
t.section('B. Verifying the account phone');

await t.check('no phone, or a number that is not a mobile number: refused, nothing sent', async () => {
  const u = await signUp(stack, { name: 'Nora NoPhone' });
  await setPhone(u, null);
  const before = sms.messages.length;
  assertEqual((await call({ op: 'phone.status' }, u.token)).body, { phone: null, phoneValid: true, verified: false, verifiedAt: null, usableFrom: null }, 'status');
  assertEqual([(await start(u)).status, codeOf(await start(u))], [409, 'no_phone'], 'no phone');
  await setPhone(u, '12345');
  assertEqual((await call({ op: 'phone.status' }, u.token)).body.phoneValid, false, 'invalid flagged');
  const bad = await start(u);
  assertEqual([bad.status, codeOf(bad)], [422, 'invalid_phone'], 'invalid');
  assertEqual(sms.messages.length, before, 'texts');
  return 'the number comes only from the account, never from the request';
});

let asha;
await t.check('a code to the account phone verifies it; the first verified number is usable at once', async () => {
  asha = await signUp(stack, { name: 'Asha Phone' });
  await setPhone(asha, '98123 45678');
  const st = await call({ op: 'phone.status' }, asha.token);
  assertEqual([st.body.phone, st.body.verified], ['+91 ••••• 45678', false], 'status before');
  const s = await call({ op: 'phone.verify.start', phone: '+919999999999' }, asha.token);
  assertEqual([s.status, s.body.phoneMasked, s.body.resendAfter, typeof s.body.expiresAt], [200, '+91 ••••• 45678', 45, 'string'], 'start');
  assertEqual(sms.messages.filter((m) => m.to === '+919999999999').length, 0, 'a number in the body is ignored');
  const text = textTo('+919812345678');
  const code = codeTo('+919812345678');
  assertEqual(text.body, `SHYGON: ${code} is your code to verify this phone number for your SHYGON account. It expires in 10 minutes. Do not share it with anyone.`, 'the DEC-2026-045 wording');
  const wrong = await confirm(asha, wrongCode(code));
  assertEqual([wrong.status, codeOf(wrong), wrong.body.error.attemptsLeft], [400, 'wrong_code', 4], 'a wrong code counts');
  assertEqual(codeOf(await confirm(asha, 'abc')), 'invalid_code', 'not six digits');
  const ok = await confirm(asha, code);
  assertEqual([ok.status, ok.body.verified, ok.body.usableFrom], [200, true, ok.body.verifiedAt], 'verified, no wait');
  const after = await call({ op: 'phone.status' }, asha.token);
  assertEqual([after.body.verified, after.body.usableFrom], [true, ok.body.verifiedAt], 'status after');
  assertEqual(codeOf(await start(asha)), 'already_verified', 'no second code for the same number');
  const ev = await q(`SELECT event_type, detail FROM public.account_events WHERE user_id = $1 AND event_type LIKE 'phone_%'`, [asha.userId]);
  assertEqual([ev.length, ev[0].event_type, ev[0].detail.last4], [1, 'phone_verified', '5678'], 'account history');
  return 'one text, one code, the owner\'s history records it';
});

await t.check('the limits: 45 s between sends, 5 per account per hour, 3 per number per day', async () => {
  const u = await signUp(stack, { name: 'Lim Limits' });
  await setPhone(u, '+919811000001');
  assertEqual((await start(u)).status, 200, 'first');
  const again = await start(u);
  assert(codeOf(again) === 'verify_cooldown' && again.status === 429 && again.body.error.retryAfter > 0 && again.body.error.retryAfter <= 45, `cooldown ${JSON.stringify(again.body)}`);
  for (let i = 2; i <= 3; i++) {
    await pastCooldown(u);
    await setPhone(u, `+91981100000${i}`);
    assertEqual((await start(u)).status, 200, `send ${i}`);
  }
  // Two more from this account (5 in the hour), then the sixth is refused.
  for (let i = 4; i <= 5; i++) {
    await pastCooldown(u);
    await setPhone(u, `+91981100000${i}`);
    assertEqual((await start(u)).status, 200, `send ${i}`);
  }
  await pastCooldown(u);
  await setPhone(u, '+919811000006');
  const sixth = await start(u);
  assert(codeOf(sixth) === 'verify_rate_limited' && sixth.body.error.retryAfter <= 3600, `per account ${JSON.stringify(sixth.body)}`);
  // Per number, across accounts: a stranger's number cannot be flooded through SHYGON.
  const shared = '+919822000000';
  for (const name of ['Pia One', 'Pia Two', 'Pia Three']) {
    const p = await signUp(stack, { name });
    await setPhone(p, shared);
    assertEqual((await start(p)).status, 200, name);
  }
  const fourth = await signUp(stack, { name: 'Pia Four' });
  await setPhone(fourth, shared);
  const refused = await start(fourth);
  assert(codeOf(refused) === 'number_rate_limited' && refused.body.error.retryAfter > 86000, `per number ${JSON.stringify(refused.body)}`);
  assertEqual(sms.messages.filter((m) => m.to === shared).length, 3, 'texts to the shared number');
  return 'as 029 and card-otp';
});

await t.check('codes expire, allow 5 attempts, are single-use, and one new code retires the old', async () => {
  const u = await signUp(stack, { name: 'Exp Expiry' });
  await setPhone(u, '+919833000001');
  await start(u);
  const first = codeTo('+919833000001');
  await pastCooldown(u);
  await start(u);
  const second = codeTo('+919833000001');
  if (first !== second) assertEqual(codeOf(await confirm(u, first)), 'wrong_code', 'the retired code');
  await q(`UPDATE public.account_phone_challenges SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND consumed_at IS NULL`, [u.userId]);
  assertEqual([(await confirm(u, second)).status, codeOf(await confirm(u, second))], [410, 'code_expired'], 'expired');
  await pastCooldown(u);
  await start(u);
  const third = codeTo('+919833000001');
  let last;
  for (let i = 0; i < 5; i++) last = await confirm(u, wrongCode(third));
  assertEqual([codeOf(last), last.body.error.attemptsLeft], ['too_many_attempts', 0], 'fifth wrong');
  assertEqual(codeOf(await confirm(u, third)), 'too_many_attempts', 'the right code after 5 wrong ones');
  const v = await verified('Sin Single', '+91 98330 00002');
  assertEqual(codeOf(await confirm(v, '000000')), 'no_challenge', 'a used code is gone');
  return 'no guessing past five';
});

await t.check('no provider: 503 sms_unavailable and the code is retired; nothing pretends to be sent', async () => {
  const u = await signUp(stack, { name: 'Ned NoSms' });
  await setPhone(u, '+919844000001');
  stack.useSms(null);
  try {
    const r = await start(u);
    assertEqual([r.status, codeOf(r)], [503, 'sms_unavailable'], 'start');
    const open = (await q(`SELECT count(*)::int AS n FROM public.account_phone_challenges WHERE user_id = $1 AND consumed_at IS NULL`, [u.userId]))[0].n;
    assertEqual(open, 0, 'open codes');
    assertEqual(codeOf(await confirm(u, '123456')), 'no_challenge', 'nothing to confirm');
  } finally {
    stack.useSms('twilio', { receipts: false });
  }
  return 'verification waits for the provider (F-10)';
});

await t.check('editing the phone unverifies it at once; a code sent before an edit verifies nothing', async () => {
  const u = await verified('Eda Edit', '+919855000001');
  await setPhone(u, '+919855000002');
  assertEqual((await call({ op: 'phone.status' }, u.token)).body.verified, false, 'edited');
  await pastCooldown(u);
  assertEqual((await start(u)).status, 200, 'a code to the new number');
  const code = codeTo('+919855000002');
  await setPhone(u, '+919855000003');
  const r = await confirm(u, code);
  assertEqual([r.status, codeOf(r)], [409, 'phone_changed'], 'the number changed after the code was sent');
  await setPhone(u, '+919855000001');
  assertEqual((await call({ op: 'phone.status' }, u.token)).body.verified, true, 'back to the verified number');
  return 'verified means: this number, now';
});

// ---------------------------------------------------------------------------
t.section('C. card-otp and the order text (finding F4)');

await t.check('card-otp: refused while the account phone is unverified, nothing sent; sent once verified', async () => {
  const u = await signUp(stack, { name: 'Cal Card' });
  await setPhone(u, '+919866000001');
  const id = await card(u);
  const before = sms.messages.length;
  const refused = await cardOtp({ step: 'request', cardId: id, action: 'deactivate' }, u.token);
  assertEqual([refused.status, refused.body.code], [409, 'phone_not_verified'], 'unverified');
  assertEqual(sms.messages.length, before, 'texts while unverified');
  await start(u);
  await confirm(u, codeTo('+919866000001'));
  const sent = await cardOtp({ step: 'request', cardId: id, action: 'deactivate' }, u.token);
  assertEqual([sent.status, typeof sent.body.challengeId], [200, 'string'], `verified: ${JSON.stringify(sent.body)}`);
  assert(/to deactivate your card/.test(textTo('+919866000001').body), 'the card text went to the verified number');
  return 'the code reaches only a number the owner proved';
});

await t.check('a stolen session that swaps the number: verified, but cannot move a card for 24 hours', async () => {
  const u = await verified('Vic Victim', '+919877000001');
  const id = await card(u);
  // The attacker, holding the session, changes the phone to theirs and verifies it.
  await setPhone(u, '+919877000999');
  await pastCooldown(u);
  assertEqual((await start(u)).status, 200, 'a code to the new number');
  const swap = await confirm(u, codeTo('+919877000999'));
  assertEqual(swap.status, 200, 'the new number is verified');
  const wait = (Date.parse(swap.body.usableFrom) - Date.parse(swap.body.verifiedAt)) / 3600000;
  assertEqual(Math.round(wait), 24, 'hours before it can confirm card actions');
  const before = sms.messages.filter((m) => m.to === '+919877000999').length;
  const refused = await cardOtp({ step: 'request', cardId: id, action: 'deactivate' }, u.token);
  assert(refused.status === 409 && refused.body.code === 'phone_cooling_down' && refused.body.retryAfter > 86000, `cooling down ${JSON.stringify(refused.body)}`);
  assertEqual(sms.messages.filter((m) => m.to === '+919877000999').length, before, 'no card code to the new number');
  const note = await q(`SELECT title, body FROM public.notifications WHERE user_id = $1 AND category = 'account'`, [u.userId]);
  assert(note.length === 1 && /ending in 0999/.test(note[0].body) && !/919877000999/.test(note[0].body), 'the owner is told, by the last 4 digits');
  const ev = await q(`SELECT event_type FROM public.account_events WHERE user_id = $1 AND event_type = 'phone_replaced'`, [u.userId]);
  assertEqual(ev.length, 1, 'account history');
  // A day later the number may confirm card actions.
  await q(`UPDATE public.account_phone_verifications SET usable_from = now() - interval '1 second' WHERE user_id = $1`, [u.userId]);
  assertEqual((await cardOtp({ step: 'request', cardId: id, action: 'deactivate' }, u.token)).status, 200, 'after the wait');
  return 'today\'s card-otp would have texted the attacker at once';
});

await t.check('the order text falls back to the account phone only once it is verified', async () => {
  const { sendOrderConfirmation } = await import('../../netlify/lib/orderMessages.mjs');
  const admin = supabaseClient(stack, stack.keys.serviceRoleKey);
  const order = async (u, n) => (await q(`INSERT INTO public.orders (order_id, user_id, customer_id, product_name, amount, amount_in_paise,
      payment_status, order_status, fulfillment_status, order_type)
    VALUES ($1, $2, $2, 'Business experience', 299, 29900, 'paid', 'confirmed', 'fulfilled', 'digitalUpgrade') RETURNING id`, [`ST-PHONE${n}-0001`, u.userId]))[0].id;
  const unv = await signUp(stack, { name: 'Una Unverified' });
  await setPhone(unv, '+919888000001');
  const r1 = await sendOrderConfirmation(admin, await order(unv, 1));
  assertEqual([r1.sent, r1.reason], [false, 'unverified-phone'], 'unverified');
  assertEqual(sms.messages.filter((m) => m.to === '+919888000001').length, 0, 'texts to an unverified number');
  const ver = await verified('Ved Verified', '+919888000002');
  const r2 = await sendOrderConfirmation(admin, await order(ver, 2));
  assertEqual(r2.sent, true, 'verified');
  assert(/ST-PHONE2-0001/.test(textTo('+919888000002').body), 'the order text');
  return 'a number the buyer gave at checkout is still used as before';
});

// ---------------------------------------------------------------------------
t.section('D. Export, retention and canaries');

await t.check('the export shows the verified number as its last 4 digits; codes are purged after 24 hours', async () => {
  const x = (await q(`SELECT public.account_export_build($1) AS x`, [asha.userId]))[0].x;
  assertEqual([x.phoneVerification.last4, typeof x.phoneVerification.verifiedAt], ['5678', 'string'], 'export');
  assert(!JSON.stringify(x).includes('9812345678'), 'no full number in the export');
  await q(`INSERT INTO public.account_phone_challenges (id, user_id, phone_digest, phone_last4, code_hash, expires_at, created_at)
    VALUES (gen_random_uuid(), $1, repeat('a', 64), '0000', repeat('b', 64), now() - interval '25 hours', now() - interval '25 hours')`, [asha.userId]);
  const purged = (await q(`SELECT public.account_phone_purge() AS n`))[0].n;
  assert(purged >= 1, `purged ${purged}`);
  const left = (await q(`SELECT count(*)::int AS n FROM public.account_phone_challenges WHERE created_at < now() - interval '24 hours'`))[0].n;
  assertEqual(left, 0, 'old codes left');
  return 'retention as 029';
});

await t.check('no full number, code or hash in any answer or log line', async () => {
  const text = responses.join('\n') + '\n' + logLines.join('\n');
  const numbers = [...new Set(sms.messages.map((m) => m.to).filter(Boolean))].map((n) => n.replace(/^\+91/, ''));
  const leaked = [...numbers.filter((n) => text.includes(n)), ...[...new Set(codesSeen)].filter((c) => text.includes(`"${c}"`) || text.includes(`:${c}`))];
  assertEqual(leaked, [], 'numbers or codes');
  const hashes = (await q(`SELECT code_hash FROM public.account_phone_challenges`)).map((r) => r.code_hash);
  assertEqual(hashes.filter((h) => text.includes(h)), [], 'hashes');
  return `${responses.length} answers, ${logLines.length} log lines, ${numbers.length} numbers, ${codesSeen.length} codes`;
});

await stack.close();
process.exit(t.finish() ? 0 : 1);
