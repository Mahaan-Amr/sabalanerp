import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Back from driver confirmation returns to the dispatch order list', async ({ page }) => {
  const dispatchPath = '/dashboard/accounting/dispatch';
  await loginAsAdmin(page);
  await page.route('**/api/accounting/dispatch-candidates', route =>
    route.fulfill({ json: { success: true, data: [] } }));
  await page.goto(dispatchPath);

  const back = page.getByRole('main').getByRole('button', { name: 'بازگشت', exact: true });
  await page.getByRole('button', { name: 'تأیید راننده', exact: true }).click();
  await expect(page.getByText('تأیید فعالی وجود ندارد')).toBeVisible();
  await back.click();

  await expect(page).toHaveURL(new RegExp(`${dispatchPath}$`));
  await expect(page.getByRole('heading', { name: 'فرمان‌های ارسال' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'جست‌وجو' })).toBeVisible();

  await back.click();
  await expect(page).toHaveURL(/\/dashboard\/accounting$/);
});
