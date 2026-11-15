import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('a fresh Accounting review request renders its links and opens the review list', async ({ page }) => {
  await loginAsAdmin(page);
  const response = await page.goto('/dashboard/accounting/workflows/review');
  expect(response?.status()).toBe(200);
  await expect(page.locator('body')).not.toContainText('906465025');
  await expect(page.getByRole('heading', { name: 'بررسی و پیگیری' })).toBeVisible();
  const reviewLink = page.getByRole('main').last().getByRole('link', { name: 'قراردادهای قابل بررسی' });
  await expect(reviewLink).toHaveAttribute('href', '/dashboard/accounting/contracts?view=reviewable');
  await reviewLink.click();
  await expect(page).toHaveURL(/\/dashboard\/accounting\/contracts\?view=reviewable/);
  await expect(page.getByRole('heading', { name: 'قراردادهای قابل بررسی' })).toBeVisible();
});
