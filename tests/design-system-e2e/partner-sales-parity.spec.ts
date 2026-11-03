import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, setViewportAndZoom, setTheme } from './support/design-system';

test('Partner customer editor preserves fields after a denied atomic save in both themes', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({ json: { success: true, data: { allowed: true, workspace: 'sales' } } }));
  const customer = { customerId: 'parity-customer', revision: 0, displayName: 'مشتری آزمون', firstName: 'مشتری',
    lastName: 'آزمون', customerType: 'Individual', personType: 'NATURAL', status: 'Active',
    isBlacklisted: false, isLocked: false, phone: '09123456789', address: 'نشانی آزمون', projectCount: 0 };
  const card = { ...customer, id: customer.customerId, activityCategory: 'ARCHITECT', partnerOwnerProfileId: 'parity-profile',
    managementReadOnly: true, canManageCustomerCard: true, partnerOwnerView: true, partnerRevision: 0, cardVersion: 'parity-card',
    phoneNumbers: [{ id: 'parity-phone', number: customer.phone, type: 'mobile', isPrimary: true, isActive: true }],
    projectAddresses: [], contacts: [], createdAt: '2026-10-03T00:00:00Z' };
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true,
    data: { items: [customer], total: 1 } } }));
  let saves = 0;
  await page.route('**/api/crm/partner/customers/parity-customer/full-card', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, data: card } });
    expect(route.request().method()).toBe('PUT');
    expect(route.request().postDataJSON()).toMatchObject({ firstName: 'نام اصلاح‌شده', expectedRevision: 0, expectedCardVersion: 'parity-card' });
    saves++;
    return route.fulfill({ status: 403, json: { success: false, error: 'اجازه انجام این اقدام را ندارید.' } });
  });
  await page.goto('/dashboard/sales/partner-customers');
  const edit = page.getByRole('link', { name: 'ویرایش', exact: true });
  await expect(edit).toHaveAttribute('href', '/dashboard/sales/partner-customers/parity-customer/edit');
  await edit.click();
  await expect(page.getByRole('heading', { name: 'ویرایش مشتری', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const name = page.getByRole('textbox', { name: 'نام', exact: true });
  await setTheme(page, 'dark');
  const dark = await name.evaluate(element => getComputedStyle(element).backgroundColor);
  await setTheme(page, 'light');
  expect(await name.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(dark);
  await name.fill('نام اصلاح‌شده');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
  await expect(page.getByText(/اجازه انجام این اقدام/)).toBeVisible();
  expect(saves).toBe(1);
  await expect(name).toHaveValue('نام اصلاح‌شده');
  await expect(page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first()).toBeEnabled();
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
});
