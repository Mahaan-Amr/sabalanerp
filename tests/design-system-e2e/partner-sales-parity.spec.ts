import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, setViewportAndZoom } from './support/design-system';

test('Partner customer edit uses a centered modal and retains fields on denied save', async ({ page }) => {
  await loginAsAdmin(page);
  const customer = { customerId: 'parity-customer', revision: 0, displayName: 'مشتری آزمون', firstName: 'مشتری',
    lastName: 'آزمون', customerType: 'Individual', personType: 'NATURAL', status: 'Active',
    isBlacklisted: false, isLocked: false, phone: '09123456789', address: 'نشانی آزمون', projectCount: 0 };
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true,
    data: { items: [customer], total: 1 } } }));
  await page.route('**/api/crm/partner/customers/parity-customer', route => route.fulfill({ status: 403,
    json: { success: false, error: 'اجازه انجام این اقدام را ندارید.' } }));
  await page.goto('/dashboard/sales/partner-customers');
  await page.getByRole('button', { name: 'ویرایش', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ویرایش مشتری', exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(24, 38, 49)');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await expect.poll(() => dialog.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgb(24, 38, 49)');
  await dialog.getByRole('textbox', { name: 'نام', exact: true }).fill('نام اصلاح‌شده');
  await dialog.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).click();
  await expect(dialog.getByText(/اجازه انجام این اقدام/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('نام اصلاح‌شده');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
