import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiCustomer, cspViolations, dismissCookieNotice, eventually, server, stack, stayLocal } from './stack';

/**
 * The account phone's verification (AAROH-API v0.13 §4b; DEC-2026-045, finding
 * F4), end to end on the local stack with Session A's real functions and the
 * text-message stand-in:
 *   - an owner with an unverified number is told on the card page, and card-otp
 *     refuses (phone_not_verified) before any code is sent;
 *   - "Verify your phone" with the code the stand-in received; the server reads
 *     back verified, and a card code then goes to that number;
 *   - Settings warns before a new number is saved; the new number, once
 *     verified, waits 24 hours, and card-otp says from when (phone_cooling_down).
 *
 * MSG91 carries the verification text here, because the stand-in reads codes
 * from MSG91's template variable (Twilio only for "code: NNNNNN" texts). The
 * card code needs only to be sent, so Twilio carries that.
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

test.afterEach(async ({ context, request }) => {
  await request.post('/__sim/sms/provider', { data: { provider: null } });
  expect(cspViolations(context)).toEqual([]);
});

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/shygontap/auth');
  await dismissCookieNotice(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/shygontap/account');
}

/** A number nobody else in this run uses: the server limits codes per number. */
const freshNumber = () => `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
const masked = (e164: string) => `${e164.slice(0, 3)} ••••• ${e164.slice(-5)}`;

/** What the server says about the account phone, read with the owner's own token. */
async function phoneStatus(token: string) {
  const response = await fetch(`${stack().appUrl}/api/account`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ op: 'phone.status' }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { phone: string | null; verified: boolean; usableFrom: string | null };
}

async function codeTextedTo(request: APIRequestContext, number: string) {
  return eventually(async () => {
    const res = await request.get(`/__sim/sms/last-code?to=${encodeURIComponent(number)}`);
    if (!res.ok()) return null;
    return ((await res.json()) as { code?: string }).code ?? null;
  }, 'verification code reached the stand-in');
}

/**
 * On /shygontap/phone: send a code, type what the stand-in received. Within 45
 * seconds of the account's last code the server refuses (verify_cooldown, per
 * account): the page says how long, counts down, and the next send works.
 */
async function verifyHere(page: Page, request: APIRequestContext, number: string, { cooldown = false } = {}) {
  await request.post('/__sim/sms/provider', { data: { provider: 'msg91', receipts: false } });
  const box = page.getByTestId('phone-verify');
  await expect(box).toHaveAttribute('data-state', 'unverified');
  await expect(box).toContainText(`${masked(number)} is not verified yet.`);
  const send = page.getByRole('button', { name: 'Send code', exact: true });
  await send.click();
  if (cooldown) {
    await expect(box.getByRole('alert')).toContainText(/^Please wait \d+ seconds? before sending another code\./);
    await expect(page.getByRole('button', { name: /^Send code in \d+s$/ })).toBeDisabled();
    await expect(send).toBeEnabled({ timeout: 60_000 });
    await send.click();
  }
  await expect(box).toContainText(`Enter the 6-digit code we texted to ${masked(number)}`);
  const code = await codeTextedTo(request, number);
  await page.getByLabel('Verification code').fill(code!);
}

test('phone verification: refused while unverified, verified with the texted code, then a card code goes to it; a new number waits 24 hours', async ({ page, request }) => {
  test.setTimeout(180_000); // includes the server's 45-second wait between codes
  const owner = await apiCustomer('Phone Verify Owner');
  const first = freshNumber();
  await owner.client.from('profiles').update({ phone: first }).eq('id', owner.userId);
  const { error } = await server().from('cards').insert({
    user_id: owner.userId, card_id: `SHY-E2E-PV-${Date.now()}`, activation_code: `ACTE2EPV${Date.now()}`,
    sku: 'phone-test', card_slot: 1, status: 'active',
  });
  expect(error).toBeNull();
  await signIn(page, owner.email, owner.password);

  // 1. Unverified: the card page says so, and card-otp refuses before sending.
  await page.goto('/shygontap/cards');
  await expect(page.getByTestId('cards-phone-unverified')).toContainText('we send the one-time code only to a verified number');
  await page.getByRole('button', { name: 'Renew activation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('alert')).toContainText('Codes for your card are sent only to a verified number.');
  await expect(dialog.getByLabel('One-time code')).toHaveCount(0);
  const before = (await (await request.get('/__sim/sms/messages')).json()) as { to: string }[];
  expect(before.filter((m) => `+${m.to.replace(/^\+/, '')}` === first)).toEqual([]);

  // 2. "Verify your phone", from the dialog's own link.
  await dialog.getByRole('link', { name: 'Verify your phone' }).click();
  await page.waitForURL('**/shygontap/phone');
  await verifyHere(page, request, first);
  await expect(page.getByTestId('phone-verify')).toHaveAttribute('data-state', 'verified');
  await expect(page.getByText('Your number is verified:')).toBeVisible();
  expect(await phoneStatus(owner.token)).toMatchObject({ phone: masked(first), verified: true });

  // 3. The card code now goes to the verified number.
  await request.post('/__sim/sms/provider', { data: { provider: 'twilio', receipts: false } });
  await page.goto('/shygontap/cards');
  await expect(page.getByTestId('cards-phone-unverified')).toHaveCount(0);
  await page.getByRole('button', { name: 'Renew activation' }).click();
  await expect(page.getByRole('dialog')).toContainText(`Enter the 6-digit code we texted to ${masked(first)}`);
  const sent = (await (await request.get('/__sim/sms/messages')).json()) as { to: string }[];
  expect(sent.some((m) => `+${m.to.replace(/^\+/, '')}` === first)).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  // 4. Settings: verified; a new number warns before it is saved.
  await page.goto('/shygontap/settings');
  const state = page.getByTestId('settings-phone-state');
  await expect(state).toHaveText('Verified');
  const field = page.getByLabel('Mobile number');
  await field.fill(first.replace('+91', '+91 ').replace(/(\d{5})$/, ' $1')); // the same number, spaced: no warning
  await expect(state).toHaveText('Verified');
  const second = freshNumber();
  await field.fill(second);
  await expect(state).toContainText('Saving a new number removes the verification from your current one.');
  await page.getByRole('button', { name: 'Save details' }).click();
  await expect(state).toContainText('Not verified yet.');
  expect(await phoneStatus(owner.token)).toMatchObject({ phone: masked(second), verified: false });

  // 5. The new number, once verified, waits 24 hours, and says from when.
  await state.getByRole('link', { name: 'Verify your phone' }).click();
  await page.waitForURL('**/shygontap/phone');
  // The first code went out under a minute ago: the per-account wait shows first.
  await verifyHere(page, request, second, { cooldown: true });
  await expect(page.getByTestId('phone-verify')).toHaveAttribute('data-state', 'waiting');
  await expect(page.getByTestId('phone-verify')).toContainText('can confirm card changes from');
  const waiting = await phoneStatus(owner.token);
  expect(waiting).toMatchObject({ phone: masked(second), verified: true });
  const hours = (Date.parse(waiting.usableFrom!) - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(23.5);
  expect(hours).toBeLessThanOrEqual(24);

  await page.goto('/shygontap/cards');
  await expect(page.getByTestId('cards-phone-waiting')).toContainText('it can confirm card changes from');
  await page.getByRole('button', { name: 'Renew activation' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Your mobile number changed recently. For your security, it can confirm card changes from',
  );
  await expect(page.getByRole('dialog').getByLabel('One-time code')).toHaveCount(0);
});
