import { test, expect } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setTheme, setViewportAndZoom } from './support/design-system';

const fixture = (owner = false) => ({ id: 'partner-crm-fixture', firstName: 'مشتری', lastName: 'آزمایشی', customerType: 'Government', status: 'Active',
  partnerOwnerProfileId: 'fixture-owner', partnerRevision: 1, cardVersion: 'fixture-card', crmVersion: 'fixture-crm',
  partnerCrmSections: true, partnerOwnerView: owner, managementReadOnly: true, canManageCustomerCard: owner,
  isBlacklisted: false, isLocked: false, phoneNumbers: [], projectAddresses: [], contacts: [], leads: [], salesContracts: [],
  crmCapabilities: { project_addresses_view: true, contacts_view: true, leads_view: true, contracts_view: true, financial_view: false },
  createdAt: '2026-10-12T08:00:00Z', updatedAt: '2026-10-12T08:00:00Z' });
test.beforeEach(async ({ page }) => { await loginAsAdmin(page); });

test('live Partner CRM detail renders four sections and keeps contract responses price-free', async ({ page }) => {
  const listResponse = await page.request.get('/api/crm/customers?ownership=partner&limit=1');
  expect(listResponse.ok()).toBeTruthy();
  const list = await listResponse.json(); const id = list.data[0]?.id;
  expect(id, 'existing local Partner customer').toBeTruthy();
  const detailResponse = await page.request.get(`/api/crm/customers/${id}`);
  expect(detailResponse.ok()).toBeTruthy(); const card = (await detailResponse.json()).data;
  expect(card.partnerCrmSections).toBe(true);
  const stale = await page.request.post(`/api/crm/customers/${id}/crm-actions`, { data: { resource: 'contacts', operation: 'create', expectedRevision: card.partnerRevision + 1, expectedCrmVersion: card.crmVersion, data: { firstName: 'نباید ثبت شود', lastName: 'آزمون', isPrimary: false, isActive: true } } });
  expect(stale.status()).toBe(409);
  const after = (await (await page.request.get(`/api/crm/customers/${id}`)).json()).data;
  expect(after.partnerRevision).toBe(card.partnerRevision);
  expect(after.contacts.length).toBe(card.contacts.length);
  for (const contract of card.salesContracts) { expect(contract).not.toHaveProperty('totalAmount'); expect(contract).not.toHaveProperty('content'); expect(contract).not.toHaveProperty('contractData'); }
  await page.goto(`/dashboard/crm/customers/${id}`);
  for (const title of ['آدرس‌های پروژه', 'مخاطبین', 'سرنخ‌ها', 'قراردادها']) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
});

test('read-only managerial card shows empty sections without mutation buttons in both themes and at mobile zoom', async ({ page }, testInfo) => {
  await page.route('**/api/crm/customers/partner-crm-fixture', route => route.fulfill({ json: { success: true, data: fixture() } }));
  await page.goto('/dashboard/crm/customers/partner-crm-fixture');
  for (const title of ['آدرس‌های پروژه', 'مخاطبین', 'سرنخ‌ها', 'قراردادها']) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /افزودن آدرس پروژه|افزودن مخاطب|افزودن سرنخ/ })).toHaveCount(0);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme); await setViewportAndZoom(page, { width: 390, height: 844 });
    await assertNoHorizontalOverflow(page); await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`partner-crm-${theme}-390.png`), fullPage: true });
  }
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2); await assertNoHorizontalOverflow(page);
});

test('exact contact capability opens a canonical editor and failed save preserves input and pending state', async ({ page }) => {
  const card = { ...fixture(), crmCapabilities: { ...fixture().crmCapabilities, contacts_create: true } };
  await page.route('**/api/crm/customers/partner-crm-fixture', route => route.fulfill({ json: { success: true, data: card } }));
  let release: () => void = () => {};
  await page.route('**/api/crm/customers/partner-crm-fixture/crm-actions', async route => {
    const body = route.request().postDataJSON(); expect(body.resource).toBe('contacts'); expect(body.expectedCrmVersion).toBe('fixture-crm');
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ status: 409, json: { success: false, error: 'اطلاعات همزمان تغییر کرده است؛ دوباره دریافت کنید.' } });
  });
  await page.goto('/dashboard/crm/customers/partner-crm-fixture');
  await page.getByRole('button', { name: 'افزودن مخاطب', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'افزودن مخاطب' });
  await dialog.getByRole('textbox', { name: 'نام', exact: true }).fill('نام محفوظ');
  await dialog.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمون');
  await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true'); await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'انصراف' })).toBeDisabled(); release();
  await expect(dialog).toContainText('اطلاعات همزمان تغییر کرده است');
  await expect(dialog.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('نام محفوظ');
});

const allowOwnerRoutes = async (page: import('@playwright/test').Page) => {
  await page.route('**/api/dashboard/route-availability?*', route => route.fulfill({ json: { success: true, data: { allowed: true, workspace: 'sales' } } }));
};

test('owning Partner detail and full edit share customer pages and preserve owner-list navigation', async ({ page }) => {
  await allowOwnerRoutes(page);
  const card = { ...fixture(true), phoneNumbers: [{ id: 'phone', number: '09120000001', type: 'mobile', isActive: true, isPrimary: true }] };
  await page.route('**/api/crm/partner/customers/partner-crm-fixture/full-card', route => route.fulfill({ json: { success: true, data: card } }));
  await page.goto('/dashboard/sales/partner-customers/partner-crm-fixture');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const title of ['اطلاعات مشتری', 'آدرس‌های پروژه', 'مخاطبین', 'سرنخ‌ها', 'قراردادها']) await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/partner-customers\/partner-crm-fixture\/edit$/);
  await expect(page.getByRole('heading', { name: 'ویرایش مشتری', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'نام', exact: true })).toHaveValue('مشتری');
  await expect(page.getByRole('textbox', { name: 'نام برند' })).toBeVisible();
});

test('Partner list observation and edit are navigation links, not customer modals', async ({ page }) => {
  await allowOwnerRoutes(page);
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true, data: { total: 1, items: [{ customerId: 'partner-crm-fixture', revision: 1,
    displayName: 'مشتری آزمایشی', firstName: 'مشتری', lastName: 'آزمایشی', customerType: 'Individual', personType: 'NATURAL', status: 'Active', isBlacklisted: false, isLocked: false, phone: '09120000001', projectCount: 0 }] } } }));
  await page.goto('/dashboard/sales/partner-customers');
  await expect(page.getByRole('link', { name: 'مشاهده مشتری' })).toHaveAttribute('href', '/dashboard/sales/partner-customers/partner-crm-fixture');
  await expect(page.getByRole('link', { name: 'ویرایش', exact: true })).toHaveAttribute('href', '/dashboard/sales/partner-customers/partner-crm-fixture/edit');
});

test('real owning Partner creates a Contact and saves the shared full Customer form through local HTTP', async ({ page }, testInfo) => {
  const { createPartnerCustomerBrowserFixture } = await import('./support/partner-customer-fixture');
  const seeded = await createPartnerCustomerBrowserFixture();
  try {
    await page.context().addCookies([{ name: 'sabalan_session', value: seeded.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
    await page.goto(`/dashboard/sales/partner-customers/${seeded.customerId}`);
    await expect(page.getByRole('heading', { name: 'مخاطبین', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'افزودن مخاطب', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'افزودن مخاطب' });
    await dialog.getByRole('textbox', { name: 'نام', exact: true }).fill('مخاطب محلی');
    await dialog.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمون');
    const createResponse = page.waitForResponse(response => response.url().includes('/crm-actions') && response.request().method() === 'POST');
    await dialog.getByRole('button', { name: 'ذخیره', exact: true }).click(); expect((await createResponse).ok()).toBeTruthy();
    await expect(dialog).toHaveCount(0); await expect(page.getByText('مخاطب محلی آزمون', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ویرایش مشتری', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'نام', exact: true }).fill('نام اصلاح‌شده محلی');
    const saved = page.waitForResponse(response => response.url().includes('/full-card') && response.request().method() === 'PUT');
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/dashboard/sales/partner-customers/${seeded.customerId}$`));
    await expect(page.getByRole('heading', { name: 'نام اصلاح‌شده محلی مشتری همکار', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('partner-customer-owner-detail.png'), fullPage: true });
  } finally { await seeded.cleanup(); }
});
