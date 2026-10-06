import { expect, test } from '@playwright/test';
import { apiCustomer, buyExperience, eventually, server, stayLocal } from './stack';

/**
 * The public Tap on a phone (Stage 3 "mobile layout"): it renders, nothing
 * overflows sideways, and the contact the owner chose to hide is not there.
 */
test('a published Tap on a phone: renders, no sideways scroll, hidden contact absent', async ({ page, context }) => {
  await stayLocal(context);
  const db = server();
  const owner = await apiCustomer('Phone Owner');
  await buyExperience(owner, 'business');
  // Published, with a phone number stored but switched off (V6-071).
  const { error } = await owner.client
    .from('tap_profiles')
    .update({ status: 'active', phone: '+919822222222', email: 'phone.owner@example.test', enabled_customizations: ['email'] })
    .eq('user_id', owner.userId);
  expect(error).toBeNull();
  const { data: tap } = await db.from('tap_profiles').select('slug').eq('user_id', owner.userId).single();

  await page.goto(`/t/${tap!.slug}?src=nfc`);
  await expect(page.getByText('Phone Owner')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.locator('a[href="mailto:phone.owner@example.test"]').first()).toBeVisible();

  // The NFC tap was counted as a view plus an nfc event.
  const events = await eventually(async () => {
    const { data } = await db.from('tap_events').select('event_type').eq('tap_profile_id', (await db.from('tap_profiles').select('id').eq('user_id', owner.userId).single()).data!.id);
    return (data?.length ?? 0) >= 2 ? data : null;
  }, 'view and nfc recorded');
  expect(events!.map((e) => e.event_type).sort()).toEqual(['nfc', 'view']);
});
