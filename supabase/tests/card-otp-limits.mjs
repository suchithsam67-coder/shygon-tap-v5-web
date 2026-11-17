import { createLiveDb, newMigrations, MIGRATIONS_DIR } from './lib/live-db.mjs';

/**
 * Card activation code limits are decided and recorded in one step (migration
 * 046; V5's 057, the same design and the same checks as V5's verify-057, on
 * V6's live baseline + 020 onward).
 *
 *   node supabase/tests/card-otp-limits.mjs
 *   node supabase/tests/card-otp-limits.mjs --without-046   (negative control)
 *
 * PGlite is one connection, so true parallelism cannot be shown here. The checks
 * prove what makes the old race impossible: the limit check and the write happen
 * inside one database call (card_otp_begin = lock + count + insert;
 * card_otp_take_attempt = a conditional UPDATE that spends the attempt before
 * any comparison). The first check replays the OLD read-then-write sequence
 * interleaved by two callers and shows it let both through.
 */

const WITHOUT = process.argv.includes('--without-046');
const db = await createLiveDb();
for (const { name, sql } of newMigrations(MIGRATIONS_DIR)) {
  if (WITHOUT && name.startsWith('046_')) continue;
  await db.exec(sql);
}

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`  PASS  ${name}${detail ? `  — ${detail}` : ''}`);
    pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`);
    fail++;
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

const U = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'c@example.test'), ($2, 'o@example.test')`, [U, OTHER]);
const card = (await one(`INSERT INTO public.cards (user_id, card_id, activation_code, sku, card_slot, status)
  VALUES ($1, 'OTP-CARD-1', 'OTPCODE1', 'test', 1, 'shipped') RETURNING id`, [U])).id;

const begin = async () => {
  const id = (await one(`SELECT gen_random_uuid() id`)).id;
  const r = await one(
    `SELECT public.card_otp_begin($1::uuid, $2, $3, 'activate', $4, '6633', 'sms', now() + interval '10 minutes') r`,
    [id, U, card, 'hash-' + id],
  );
  return { id, ...r.r };
};

console.log(`\n=== card activation code limits are atomic (migration 046${WITHOUT ? ': NEGATIVE CONTROL, 046 skipped' : ''}) ===`);

await check('OLD read-then-write sequence, interleaved by two callers, lets both through (why 046 exists)', async () => {
  await db.query(`DELETE FROM public.card_otp_challenges WHERE user_id = $1`, [U]);
  // Both callers read before either writes: both see 0 codes this hour.
  const a = Number((await one(`SELECT count(*) n FROM public.card_otp_challenges WHERE user_id = $1`, [U])).n);
  const b = Number((await one(`SELECT count(*) n FROM public.card_otp_challenges WHERE user_id = $1`, [U])).n);
  for (let i = 0; i < 2; i++) {
    await db.query(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at)
                    VALUES ($1, $2, 'activate', 'x', now() + interval '10 minutes')`, [U, card]);
  }
  const n = Number((await one(`SELECT count(*) n FROM public.card_otp_challenges WHERE user_id = $1`, [U])).n);
  assert(a === 0 && b === 0 && n === 2, `unexpected ${a}/${b}/${n}`);
  await db.query(`DELETE FROM public.card_otp_challenges WHERE user_id = $1`, [U]);
  return 'two codes 0 s apart: the 45 s gap was never enforced';
});

await check('the functions exist and only the service role may call them', async () => {
  const r = await one(`SELECT has_function_privilege('authenticated', 'public.card_otp_begin(uuid,uuid,uuid,text,text,text,text,timestamptz)', 'EXECUTE') b,
                              has_function_privilege('anon', 'public.card_otp_take_attempt(uuid,uuid)', 'EXECUTE') t,
                              has_function_privilege('service_role', 'public.card_otp_take_attempt(uuid,uuid)', 'EXECUTE') s`);
  assert(!r.b && !r.t && r.s, JSON.stringify(r));
  return 'service_role only';
});

let first;
await check('the first code is accepted and recorded in the same call', async () => {
  first = await begin();
  assert(first.ok === true, JSON.stringify(first));
  const n = Number((await one(`SELECT count(*) n FROM public.card_otp_challenges WHERE id = $1`, [first.id])).n);
  assert(n === 1, 'not inserted');
  return 'inserted';
});

await check('a second code inside 45 s is refused, with a wait time', async () => {
  const r = await begin();
  assert(r.ok === false && r.reason === 'cooldown' && r.retryAfter >= 1 && r.retryAfter <= 45, JSON.stringify(r));
  const n = Number((await one(`SELECT count(*) n FROM public.card_otp_challenges WHERE user_id = $1`, [U])).n);
  assert(n === 1, `a refused call still inserted (${n} rows)`);
  return `cooldown, retry after ${r.retryAfter} s, nothing inserted`;
});

await check('the 6th code in an hour is refused', async () => {
  await db.query(`UPDATE public.card_otp_challenges SET created_at = now() - interval '50 minutes' WHERE user_id = $1`, [U]);
  for (let i = 0; i < 4; i++) {
    await db.query(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at, created_at)
                    VALUES ($1, $2, 'activate', 'x', now() + interval '10 minutes', now() - interval '40 minutes')`, [U, card]);
  }
  const r = await begin();
  assert(r.ok === false && r.reason === 'hourly', JSON.stringify(r));
  return '5 this hour, 6th refused';
});

await check('exactly 5 attempts are spent, then the code is locked', async () => {
  const results = [];
  for (let i = 0; i < 7; i++) results.push((await one(`SELECT public.card_otp_take_attempt($1, $2) r`, [first.id, U])).r);
  const oks = results.filter((r) => r.ok).length;
  assert(oks === 5, `${oks} attempts allowed: ${JSON.stringify(results.map((r) => (r.ok ? r.attempts : r.reason)))}`);
  assert(results[5].reason === 'attempts' && results[6].reason === 'attempts', JSON.stringify(results.slice(5)));
  assert(results[0].codeHash === 'hash-' + first.id, 'hash not returned for the comparison');
  return 'attempts 1–5 allowed, 6th and 7th refused';
});

await check('a consumed code and an expired code are refused with the right reason', async () => {
  const c = (await one(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at, consumed_at)
                        VALUES ($1, $2, 'activate', 'x', now() + interval '10 minutes', now()) RETURNING id`, [U, card])).id;
  const e = (await one(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at)
                        VALUES ($1, $2, 'activate', 'x', now() - interval '1 minute') RETURNING id`, [U, card])).id;
  const rc = (await one(`SELECT public.card_otp_take_attempt($1, $2) r`, [c, U])).r;
  const re = (await one(`SELECT public.card_otp_take_attempt($1, $2) r`, [e, U])).r;
  assert(rc.reason === 'used' && re.reason === 'expired', JSON.stringify({ rc, re }));
  return 'used / expired';
});

await check("another account cannot spend attempts on someone else's code", async () => {
  const c = (await one(`INSERT INTO public.card_otp_challenges (user_id, card_id, action, code_hash, expires_at)
                        VALUES ($1, $2, 'activate', 'x', now() + interval '10 minutes') RETURNING id`, [U, card])).id;
  const r = (await one(`SELECT public.card_otp_take_attempt($1, $2) r`, [c, OTHER])).r;
  const left = (await one(`SELECT attempts FROM public.card_otp_challenges WHERE id = $1`, [c])).attempts;
  assert(r.ok === false && left === 0, JSON.stringify({ r, left }));
  return 'refused, attempts unchanged';
});

console.log(`\n${pass} passed, ${fail} failed`);
await db.close();
process.exit(fail ? 1 : 0);
