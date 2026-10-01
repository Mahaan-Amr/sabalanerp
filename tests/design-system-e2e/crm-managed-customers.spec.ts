import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const customer = { id: 'managed-customer', firstName: 'قاسم', lastName: 'آزمون همکار', customerType: 'Individual', status: 'Active',
  partnerOwnerProfileId: 'managed-profile', managementReadOnly: true, isBlacklisted: false, isLocked: false,
  ownerUser: { firstName: 'فروشنده', lastName: 'همکار' }, contacts: [], phoneNumbers: [], projectAddresses: [], createdAt: new Date().toISOString() };

for (const width of [1280, 390]) test(`managed Partner customer has read-only details and reason-only deletion confirmation at ${width}px`, async ({ page }) => {
  page.setDefaultTimeout(15000); await page.setViewportSize({ width, height: 900 }); await loginAsAdmin(page);
  await page.route('**/api/crm/customers?*', route => route.fulfill({ json: { success: true, data: [customer],
    permissions: { canViewAllCustomers: true, canDeleteCustomers: true }, pagination: { page: 1, total: 1, pages: 1 } } }));
  await page.route('**/api/crm/customers/managed-customer/deletion-preview', route => route.fulfill({ json: { success: true, data: {
    name: 'قاسم آزمون همکار', eligible: true, previewToken: 'test-preview', blockers: [],
    affected: { phones: [{ id: 'phone', label: '09120000000' }], contacts: [], projects: [] },
  } } }));
  let deleted = false;
  await page.route('**/api/crm/customers/managed-customer', route => {
    if (route.request().method() === 'DELETE') {
      const data = route.request().postDataJSON(); expect(data).toEqual({ reason: 'ثبت آزمایشی', confirmed: true, previewToken: 'test-preview' }); deleted = true;
      return route.fulfill({ json: { success: true, data: { receiptId: 'test-receipt' } } });
    }
    return route.fulfill({ json: { success: true, data: customer } });
  });
  await page.goto('/dashboard/crm/customers');
  await expect(page.locator('p:visible').filter({ hasText: /^قاسم آزمون همکار$/ }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'ویرایش', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'حذف دائمی', exact: true }).first().click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await expect(dialog.getByText('09120000000', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تأیید و حذف دائمی' })).toBeDisabled();
  await expect(dialog.getByRole('textbox')).toHaveCount(1);
  await dialog.getByRole('textbox', { name: 'دلیل حذف', exact: true }).fill('ثبت آزمایشی');
  await dialog.getByRole('button', { name: 'تأیید و حذف دائمی' }).click();
  await expect(page.getByText('مشتری حذف شد. رسید حذف: test-receipt')).toBeVisible(); expect(deleted).toBe(true);
  await page.goto('/dashboard/crm/customers/managed-customer');
  await expect(page.getByText('نمایش مدیریتی مشتری — دسترسی مشاهده اطلاعات')).toBeVisible();
  await expect(page.getByRole('link', { name: 'ویرایش', exact: true })).toHaveCount(0);
});

test('Admin sees edit blacklist and lock actions on a Partner customer', async ({ page }) => {
  page.setDefaultTimeout(5000); await loginAsAdmin(page);
  await page.route('**/api/crm/customers?*', route => route.fulfill({ json: { success: true,
    data: [{ ...customer, canManageCustomerCard: true, partnerRevision: 1 }],
    permissions: { canViewAllCustomers: true, canDeleteCustomers: true }, pagination: { page: 1, total: 1, pages: 1 } } }));
  await page.goto('/dashboard/crm/customers');
  await expect(page.getByRole('link', { name: 'ویرایش', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'افزودن به بلک‌لیست', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'قفل کردن', exact: true })).toBeVisible();
});

for (const width of [1280, 390]) test(`Admin manages Partner card through detail and atomic editor at ${width}px`, async ({ page }) => {
  page.setDefaultTimeout(15000); await page.setViewportSize({ width, height: 900 }); await loginAsAdmin(page);
  let record = { ...customer, canManageCustomerCard: true, partnerRevision: 1, cardVersion: 'version-one',
    phoneNumbers: [{ id: 'phone-one', number: '09120009991', type: 'mobile', isPrimary: true, isActive: true }],
    projectAddresses: [{ id: 'project-one', address: 'نشانی پیشین', isActive: true }] };
  await page.route('**/api/crm/customers/managed-customer', route => route.fulfill({ json: { success: true, data: record } }));
  await page.route('**/api/crm/customers/managed-customer/blacklist', route => {
    expect(route.request().method()).toBe('PUT'); record = { ...record, isBlacklisted: true };
    return route.fulfill({ json: { success: true, data: record } });
  });
  await page.route('**/api/crm/customers/managed-customer/lock', route => {
    expect(route.request().method()).toBe('PUT'); record = { ...record, isLocked: true };
    return route.fulfill({ json: { success: true, data: record } });
  });
  let saved = false;
  await page.route('**/api/crm/customers/managed-customer/admin-card', route => {
    const data = route.request().postDataJSON(); expect(data.expectedRevision).toBe(1); expect(data.expectedCardVersion).toBe('version-one');
    expect(data.firstName).toBe('نام اصلاح‌شده'); expect(data.phones[0].id).toBe('phone-one'); expect(data.projects[0].id).toBe('project-one');
    expect(data).not.toHaveProperty('partnerOwnerProfileId'); saved = true; record = { ...record, firstName: data.firstName };
    return route.fulfill({ json: { success: true, data: record } });
  });
  await page.goto('/dashboard/crm/customers/managed-customer');
  await page.getByRole('button', { name: 'افزودن به بلک‌لیست', exact: true }).click();
  await expect(page.getByRole('button', { name: 'حذف از بلک‌لیست', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'قفل کردن', exact: true }).click();
  await expect(page.getByRole('button', { name: 'باز کردن قفل', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('نام اصلاح‌شده');
  await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
  await expect(page).toHaveURL(/\/dashboard\/crm\/customers\/managed-customer$/); expect(saved).toBe(true);
});

for (const width of [1280, 390]) test(`permanent card deletion explicitly retains contracts and cases at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await loginAsAdmin(page);
  await page.route('**/api/crm/customers?*', route => route.fulfill({ json: { success: true, data: [customer],
    permissions: { canViewAllCustomers: true, canDeleteCustomers: true }, pagination: { page: 1, total: 1, pages: 1 } } }));
  await page.route('**/api/crm/customers/managed-customer/deletion-preview', route => route.fulfill({ json: { success: true, data: {
    name: 'قاسم آزمون همکار', eligible: true, mode: 'RETAIN_HISTORY', previewToken: 'retention-preview', blockers: [],
    retained: [{ label: 'قرارداد فروش', count: 2 }, { label: 'پرونده فروش همکار', count: 4 }],
    affected: { phones: [{ id: 'phone', label: '09120000000' }], contacts: [], projects: [] },
  } } }));
  let deleted = false;
  await page.route('**/api/crm/customers/managed-customer', route => {
    expect(route.request().method()).toBe('DELETE');
    expect(route.request().postDataJSON()).toEqual({ reason: 'حذف کارت و حفظ سابقه', confirmed: true, previewToken: 'retention-preview' });
    deleted = true; return route.fulfill({ json: { success: true, data: { receiptId: 'retention-receipt', mode: 'RETAIN_HISTORY' } } });
  });
  await page.goto('/dashboard/crm/customers'); await page.getByRole('button', { name: 'حذف دائمی', exact: true }).first().click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByText('سوابق محفوظ', { exact: true })).toBeVisible();
  await expect(dialog.getByText('قرارداد فروش: ۲', { exact: true })).toBeVisible();
  await expect(dialog.getByText('پرونده فروش همکار: ۴', { exact: true })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'دلیل حذف', exact: true }).fill('حذف کارت و حفظ سابقه');
  await dialog.getByRole('button', { name: 'تأیید و حذف دائمی', exact: true }).click(); expect(deleted).toBe(true);
  await expect(page.getByText('مشتری حذف شد. رسید حذف: retention-receipt')).toBeVisible();
});
