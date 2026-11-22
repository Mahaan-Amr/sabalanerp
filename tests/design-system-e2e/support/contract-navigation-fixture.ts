import { expect, type Page } from '@playwright/test';
import { createOwnerScopedBrowserStorage } from '../../../frontend/src/lib/ownerScopedBrowserStorage';

/** Seed the known test payload through the real navigation storage contract. */
export async function scopeContractNavigationFixture(page: Page) {
  const payload = await page.evaluate(() => localStorage.getItem('contractWizardState'));
  if (!payload) throw new Error('Contract navigation fixture was not seeded');
  const response = await page.request.get('/api/auth/me');
  expect(response.ok()).toBe(true);
  const userId = (await response.json()).data?.id;
  if (typeof userId !== 'string') throw new Error('Authenticated fixture owner is missing');
  const entries = new Map<string, string>();
  const storage = createOwnerScopedBrowserStorage({
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
    removeItem: key => { entries.delete(key); },
  }, () => userId, 'contract-navigation');
  storage.setItem('contractWizardState', payload);
  expect(await page.evaluate(values => {
    for (const [key, value] of values) sessionStorage.setItem(key, value);
    return values.every(([key, value]) => sessionStorage.getItem(key) === value);
  }, [...entries])).toBe(true);
}
