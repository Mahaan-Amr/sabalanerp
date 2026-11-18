import { expect, test } from '@playwright/test';

test('accountant registers a loading reference and finds every driver row by it', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
  let reference: string | null = null;
  let canManage = true;
  let partnerWritable = false;
  let failNextSave = true;
  const rows = ['driver-a', 'driver-b', 'driver-c'].map(id => ({ id, loadingId: id === 'driver-c' ? 'loading-2' : 'loading-1',
    status: 'PENDING', canManage: true, sepidarLoadingReference: reference,
    summary: { loadingNumber: '42', driverName: id, plate: '۱۲۳', customerName: 'مشتری' },
    waybills: id === 'driver-a' ? [{ id: 'waybill-a', status: 'ISSUED', number: '1' }] : [] }));
  await page.route('**/api/dispatch-confirmation/capabilities', route => route.fulfill({ json: { success: true,
    data: { canManageAccountingCandidates: true, canManageAccountingConfirmation: true } } }));
  await page.route('**/api/dispatch-confirmation/waybills/waybill-a/sessions', route => route.fulfill({ json: {
    success: true, data: { id: 'session-a', waybillId: 'waybill-a' },
  } }));
  await page.route('**/api/accounting/dispatch-candidates', route => route.fulfill({ json: {
    success: true, data: rows.map(row => ({ ...row, canManage: canManage && (row.id !== 'driver-b' || partnerWritable),
      sepidarLoadingReference: row.loadingId === 'loading-1' ? reference : null })),
  } }));
  await page.route('**/api/accounting/loadings/loading-1/sepidar-reference', async route => {
    if (failNextSave) {
      failNextSave = false;
      await route.fulfill({ status: 409, json: { success: false, error: 'این شماره برای بارگیری دیگری ثبت شده است.' } });
      return;
    }
    reference = '00123';
    await route.fulfill({ json: { success: true, data: { value: reference } } });
  });
  await page.goto('/dashboard/accounting/dispatch');
  await expect(page.getByRole('columnheader', { name: 'شماره بارگیری سپیدار' })).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' })).toHaveCount(0);
  partnerWritable = true;
  await page.getByRole('button', { name: 'به‌روزرسانی' }).click();
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' }).click();
  await page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' }).fill(' ۰۰۱۲۳ ');
  await page.getByRole('button', { name: 'ثبت شماره', exact: true }).click();
  await expect(page.getByText('این شماره برای بارگیری دیگری ثبت شده است.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'شماره بارگیری سپیدار' })).toHaveValue(' 00123 ');
  await page.getByRole('button', { name: 'ثبت شماره', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00123');
  await expect(page.getByRole('row').filter({ hasText: 'driver-b' })).toContainText('00123');
  await page.getByRole('searchbox', { name: 'جست‌وجو' }).fill('00123');
  await expect(page.getByRole('row').filter({ hasText: /driver-/ })).toHaveCount(2);
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'جزئیات اقلام و اسناد بارگیری' }).click();
  await expect(page.getByText('شماره بارگیری سپیدار: 00123')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('row').filter({ hasText: 'driver-a' }).getByRole('button', { name: 'تأیید هویت راننده' }).click();
  await expect(page.getByText('شماره بارگیری سپیدار: 00123')).toBeVisible();
  await page.getByRole('main').getByRole('button', { name: 'بازگشت', exact: true }).click();
  canManage = false;
  await page.getByRole('searchbox', { name: 'جست‌وجو' }).fill('');
  await page.getByRole('button', { name: 'به‌روزرسانی' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'driver-a' })).toContainText('00123');
  await expect(page.getByRole('row').filter({ hasText: 'driver-c' }).getByRole('cell').nth(1)).toHaveText('—');
  await expect(page.getByRole('button', { name: 'ثبت شماره بارگیری سپیدار' })).toHaveCount(0);
});
