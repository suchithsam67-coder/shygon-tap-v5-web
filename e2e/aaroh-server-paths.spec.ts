import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiCustomer, buyExperience, cspViolations, dismissCookieNotice, eventually, server, stayLocal } from './stack';

/**
 * The AAROH server paths that need a text-message provider or a host switch,
 * end to end in a real browser on the local stack, using Session A's
 * loopback-only hooks (AAROH-API v0.4 §1 rule 11):
 *   - verification with the code the provider stand-in actually received;
 *   - an owner alert: accepted, then delivered only by a signed receipt;
 *   - a provider refusal, then "Try sending again";
 *   - the visitor relay, with the host switch on and the owner opted in;
 *   - Return to owner: a finder writes, the owner replies, the finder reads it.
 *   - SHYGON Connect: a signed-in visitor asks from the owner's Tap, the owner
 *     accepts, both see the connection, and removing it revokes the grants.
 * Every check that a claim depends on reads the database back.
 *
 * The stand-in and the switches belong to the running stack, so every test
 * puts them back to off afterwards (provider none, both switches off).
 */

test.beforeEach(async ({ context }) => {
  await stayLocal(context);
});

test.afterEach(async ({ context, request }) => {
  await request.post('/__sim/sms/provider', { data: { provider: null } });
  await request.post('/__sim/switches', { data: { EMERGENCY_PUBLIC_ALERTS: false, RESCUE_RELAY: false } });
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

/** A number nobody else in this run uses: the provider limits sends per number. */
const freshNumber = () => `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

async function publishedOwner(name: string) {
  const owner = await apiCustomer(name);
  await buyExperience(owner, 'business');
  await owner.client.from('tap_profiles').update({ status: 'active' }).eq('user_id', owner.userId);
  const { data: tap } = await server().from('tap_profiles').select('slug').eq('user_id', owner.userId).single();
  return { owner, slug: tap!.slug as string };
}

/** Adds a contact in the page and verifies it with the code the stand-in received. */
async function addVerifiedContact(page: Page, request: APIRequestContext, name: string, number: string) {
  await page.goto('/shygontap/emergency');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel(/^Mobile number/).fill(number);
  await page.getByRole('button', { name: 'Add contact' }).click();
  const row = page.locator('li', { hasText: name });
  await expect(row.getByText('Not verified')).toBeVisible();
  await row.getByRole('button', { name: 'Verify number' }).click();
  const code = await eventually(async () => {
    const res = await request.get(`/__sim/sms/last-code?to=${encodeURIComponent(number)}`);
    if (!res.ok()) return null;
    return ((await res.json()) as { code?: string }).code ?? null;
  }, 'verification code reached the stand-in');
  await row.getByLabel(/Code sent to/).fill(code!);
  await row.getByRole('button', { name: 'Confirm code' }).click();
  await expect(page.getByText('Number verified. This contact can now be alerted.')).toBeVisible();
  await expect(row.getByText('Verified', { exact: true })).toBeVisible();
}

async function sendOwnerAlert(page: Page) {
  await page.getByRole('button', { name: /Alert my emergency contacts/ }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('SHYGON does not contact emergency services');
  await dialog.getByRole('button', { name: 'Send the alert' }).click();
}

test('owner alert with a provider: accepted is shown as "delivery not confirmed" until a signed receipt says delivered', async ({ page, request }) => {
  await request.post('/__sim/sms/provider', { data: { provider: 'twilio', receipts: true } });
  const { owner } = await publishedOwner('Receipt Owner');
  const number = freshNumber();
  await signIn(page, owner.email, owner.password);
  await addVerifiedContact(page, request, 'Ravi', number);
  const db = server();
  expect((await db.from('emergency_contacts').select('verified_at').eq('user_id', owner.userId).single()).data?.verified_at).not.toBeNull();

  await sendOwnerAlert(page);
  const card = page.getByTestId('emergency-event');
  await expect(card).toContainText('Delivery not confirmed');
  await expect(card).not.toContainText('Delivered to');
  await expect(card).toContainText('SHYGON does not contact emergency services');

  // The provider's signed receipt, for the alert's message (not the verification code's).
  const sid = await eventually(async () => {
    const messages = (await (await request.get('/__sim/sms/messages')).json()) as { to: string; sid: string }[];
    const toContact = messages.filter((m) => m.to === number || `+${m.to}` === number);
    return toContact.length >= 2 ? toContact[toContact.length - 1]!.sid : null;
  }, 'alert message reached the stand-in');
  const receipt = await request.post('/__sim/sms/deliver', { data: { sid, status: 'delivered' } });
  expect(receipt.ok()).toBe(true);

  await eventually(async () => {
    await card.getByRole('button', { name: 'Refresh' }).click();
    return (await card.textContent())?.includes('Delivered to 1 contact.') ? true : null;
  }, 'delivered after the receipt');
  const { data: events } = await db.from('emergency_events').select('id').eq('user_id', owner.userId);
  const { data: recipients } = await db.from('emergency_event_recipients').select('status').eq('event_id', events![0]!.id);
  expect(recipients!.map((r) => r.status)).toEqual(['delivered']);
});

test('provider refusal is final and says so; with no provider nothing is sent, and "Try sending again" sends it once one is set up', async ({ page, request }) => {
  // Waits out the server's two-minute gap between an owner's alerts.
  test.setTimeout(300_000);
  await request.post('/__sim/sms/provider', { data: { provider: 'twilio', receipts: false } });
  const { owner } = await publishedOwner('Refused Owner');
  await signIn(page, owner.email, owner.password);
  await addVerifiedContact(page, request, 'Meera', freshNumber());
  const db = server();

  // A refusal (an invalid number, 21211) is final: no retry is offered.
  await request.post('/__sim/sms/queue', { data: { scenarios: ['reject'] } });
  await sendOwnerAlert(page);
  const card = page.getByTestId('emergency-event');
  await expect(card).toContainText('Could not be sent.');
  await expect(card).toContainText('Failed');
  await expect(card).toContainText('is not sent again automatically');
  await expect(card.getByRole('button', { name: 'Try sending again' })).toHaveCount(0);

  // No provider: the server keeps the next alert unsent and says so. Once a
  // provider exists, "Try sending again" sends that same alert, not a new one.
  await request.post('/__sim/sms/provider', { data: { provider: null } });
  await page.reload();
  await eventually(
    async () => {
      await page.getByRole('button', { name: /Alert my emergency contacts/ }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Send the alert' }).click();
      await page.waitForTimeout(1500);
      return (await page.getByTestId('emergency-event').textContent())?.includes('Nothing was sent') ? true : null;
    },
    'a not_sent alert (after the owner cool-down between alerts)',
    180_000,
  );
  await request.post('/__sim/sms/provider', { data: { provider: 'twilio', receipts: false } });
  await card.getByRole('button', { name: 'Try sending again' }).click();
  await expect(card).toContainText('Delivery not confirmed');
  const { data: events } = await db.from('emergency_events').select('status').eq('user_id', owner.userId).order('created_at');
  expect(events!.map((e) => e.status)).toEqual(['failed', 'sent']);
});

test('visitor relay: with the host switch on and the owner opted in, a visitor alerts the contacts without seeing them', async ({ page, request, browser }) => {
  await request.post('/__sim/sms/provider', { data: { provider: 'twilio', receipts: false } });
  await request.post('/__sim/switches', { data: { EMERGENCY_PUBLIC_ALERTS: true } });
  const { owner, slug } = await publishedOwner('Relay Visitor Owner');
  await signIn(page, owner.email, owner.password);
  await addVerifiedContact(page, request, 'Asha', freshNumber());

  // Opt in, after the contract's consequence text.
  await page.getByRole('button', { name: 'Turn visitor alerts on' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('SHYGON cannot confirm emergencies; limited to 3 per day.');
  await dialog.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('button', { name: 'Turn visitor alerts off' })).toBeVisible();

  const visitor = await browser.newPage();
  await stayLocal(visitor.context());
  // The host (Netlify, Vercel) tells the function the visitor's address; the
  // server keys its per-visitor limits on it and refuses without it. The local
  // host sets it from the connection and drops any address header a browser
  // sends (B-9); this visitor gets its own documentation address through the
  // stack's opt-in simulator (STACK_SIM_CLIENT_ADDRESS=1, playwright.config.ts).
  await visitor.context().setExtraHTTPHeaders({ 'x-shygon-sim-client': '203.0.113.21' });
  await visitor.goto(`/t/${slug}`);
  await visitor.getByRole('button', { name: /Alert their contacts/ }).click();
  await expect(visitor.getByRole('heading', { level: 1, name: 'Emergency Profile' })).toBeVisible();
  await visitor.getByLabel(/I understand this alerts/).check();
  await visitor.getByRole('button', { name: 'Send the alert' }).click();
  await expect(visitor.getByRole('heading', { name: 'Alert handed to the text-message provider' })).toBeVisible();
  await expect(visitor.getByTestId('alert-safety')).toBeVisible();
  await expect(visitor.getByRole('button', { name: 'Send the alert' })).toHaveCount(0);
  const html = await visitor.content();
  expect(html).not.toContain('Asha');
  await visitor.close();

  const { data: events } = await server().from('emergency_events').select('initiator').eq('user_id', owner.userId);
  expect(events!.map((e) => e.initiator)).toEqual(['public']);
});

test('return to owner: a finder writes, the owner replies in the inbox, the finder reads the reply; no owner detail reaches the finder', async ({ page, request, browser }) => {
  await request.post('/__sim/switches', { data: { RESCUE_RELAY: true } });
  const { owner, slug } = await publishedOwner('Relay Inbox Owner');
  await signIn(page, owner.email, owner.password);
  await page.goto('/shygontap/return-to-owner');
  await page.getByLabel('A note for finders (optional)').fill('A reward is offered');
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();

  const finder = await browser.newPage();
  await stayLocal(finder.context());
  // The finder's own simulated address, as for the visitor relay above.
  await finder.context().setExtraHTTPHeaders({ 'x-shygon-sim-client': '203.0.113.22' });
  await finder.goto(`/t/${slug}`);
  await finder.getByRole('button', { name: /Message the owner/ }).click();
  await expect(finder.getByText('The owner’s note: “A reward is offered”')).toBeVisible();
  await finder.getByLabel('Your message').fill('Found your card at the station café.');
  await finder.getByRole('button', { name: 'Send to the owner' }).click();
  await expect(finder.getByRole('heading', { name: 'Sent to the owner. Waiting for a reply.' })).toBeVisible();
  expect(finder.url()).not.toMatch(/rt=/);

  await page.reload();
  await page.getByRole('button', { name: /Waiting for your reply/ }).click();
  const conversation = page.getByRole('list', { name: 'Conversation' });
  await expect(conversation.getByText('Found your card at the station café.')).toBeVisible();
  await page.getByLabel(/^Your reply/).fill('Thank you! Please leave it at the counter.');
  await page.getByRole('button', { name: /Send reply/ }).click();
  await expect(conversation.getByText('Thank you! Please leave it at the counter.')).toBeVisible();

  await finder.getByRole('button', { name: 'Check for a reply' }).click();
  await expect(finder.getByText('Thank you! Please leave it at the counter.')).toBeVisible();
  await expect(finder.getByRole('heading', { name: 'The owner replied.' })).toBeVisible();
  const html = await finder.content();
  expect(html).not.toContain(owner.email);
  expect(html).not.toContain(owner.userId);
  await finder.close();
});

test('connect: a signed-in visitor asks from the Tap, the owner accepts, details are self-reported, removal revokes the grants', async ({ page, browser }) => {
  const { owner, slug } = await publishedOwner('Connect Owner');
  const requester = await apiCustomer('Connect Requester');
  const db = server();

  // The owner opts in (default off).
  await signIn(page, owner.email, owner.password);
  await page.goto('/shygontap/connections');
  await expect(page.getByText(/Off\. Only signed-in SHYGON accounts can ask/)).toBeVisible();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByText(/^On\. Only signed-in SHYGON accounts can ask/)).toBeVisible();

  // The requester, signed in, taps the owner's card and asks, sharing their email.
  const context = await browser.newContext();
  await stayLocal(context);
  const other = await context.newPage();
  await signIn(other, requester.email, requester.password);
  await other.goto(`/t/${slug}`);
  await other.keyboard.press('Escape');
  await other.getByRole('link', { name: /Ask to connect/ }).click();
  await expect(other.getByRole('heading', { level: 1, name: 'Connect with Connect Owner' })).toBeVisible();
  await other.getByLabel('Email').check();
  await other.getByRole('button', { name: 'Send request' }).click();
  await expect(other.getByRole('heading', { name: 'Request sent' })).toBeVisible();

  // The owner sees the request with the requester's email, marked self-reported, and accepts.
  await page.reload();
  const request = page.locator('div', { has: page.getByText('Connect Requester', { exact: true }) }).filter({ has: page.getByRole('button', { name: /Accept/ }) }).last();
  await expect(request.getByText(requester.email)).toBeVisible();
  await expect(request.getByText('Self-reported')).toBeVisible();
  await request.getByRole('button', { name: 'Accept, sharing nothing' }).click();
  await expect(page.getByText('No requests.')).toBeVisible();
  const { data: rows } = await db.from('connections').select('status').eq('target_user_id', owner.userId);
  expect(rows!.map((r) => r.status)).toEqual(['accepted']);

  // The requester sees the connection; then removes it, after the un-share warning.
  await other.goto('/shygontap/connections');
  const card = other.locator('div', { has: other.getByText('Connect Owner', { exact: true }) }).filter({ has: other.getByRole('button', { name: 'Remove' }) }).last();
  await expect(card.getByText('Connected')).toBeVisible();
  await card.getByRole('button', { name: 'Remove' }).click();
  await expect(other.getByRole('alertdialog')).toContainText('cannot be un-shared');
  await other.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click();
  await expect(other.getByText('No connections yet.')).toBeVisible();
  await context.close();

  const { data: grants } = await db.from('consent_grants').select('revoked_at').eq('grantor_user_id', requester.userId);
  expect(grants!.length).toBeGreaterThan(0);
  expect(grants!.every((g) => g.revoked_at !== null)).toBe(true);
});
