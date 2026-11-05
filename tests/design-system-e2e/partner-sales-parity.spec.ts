import { expect, test } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, setViewportAndZoom } from './support/design-system';

test('Partner customer editor retains fields on denied save', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({ json: { success: true, data: { allowed: true } } }));
  const customer = { customerId: 'parity-customer', revision: 0, displayName: 'مشتری آزمون', firstName: 'مشتری',
    lastName: 'آزمون', customerType: 'Individual', personType: 'NATURAL', status: 'Active',
    isBlacklisted: false, isLocked: false, phone: '09123456789', address: 'نشانی آزمون', projectCount: 0 };
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true,
    data: { items: [customer], total: 1 } } }));
  await page.route('**/api/crm/partner/customers/parity-customer/full-card', route => route.request().method() === 'GET'
    ? route.fulfill({ json: { success: true, data: { ...customer, id: customer.customerId, activityCategory: 'NONE',
      partnerOwnerProfileId: 'partner-profile', canManageCustomerCard: true, partnerRevision: 0, cardVersion: 'version-one',
      phoneNumbers: [{ id: 'qa-phone', number: '09123456789', type: 'mobile', isPrimary: true, isActive: true }],
      projectAddresses: [], contacts: [] } } })
    : route.fulfill({ status: 403, json: { success: false, error: 'اجازه انجام این اقدام را ندارید.' } }));
  await page.goto('/dashboard/sales/partner-customers');
  await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ویرایش مشتری', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('نام اصلاح‌شده');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
  await expect(page.getByText(/اجازه انجام این اقدام/)).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('نام اصلاح‌شده');
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoHorizontalOverflow(page);
  await expect(page.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('نام اصلاح‌شده');
});
