import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setTheme, setViewportAndZoom } from './support/design-system';
import { createPartnerCustomerBrowserFixture } from './support/partner-customer-fixture';

test.beforeEach(({ page }) => { page.setDefaultTimeout(15_000); page.setDefaultNavigationTimeout(30_000); });

const category = (page: Page) => page.getByRole('combobox', { name: 'دسته‌بندی فعالیت مشتری' });
const removeFixture = async (page: Page, id: string) => {
  const preview = await page.request.get(`/api/crm/customers/${id}/deletion-preview`);
  expect(preview.ok()).toBeTruthy();
  const { data } = await preview.json();
  const removed = await page.request.delete(`/api/crm/customers/${id}`, { data: {
    reason: 'پایان آزمون محلی دسته‌بندی فعالیت مشتری', confirmed: true, previewToken: data.previewToken,
  } });
  expect(removed.ok()).toBeTruthy();
};

test('ordinary seller explicitly creates, displays and edits activity; NONE has no badge', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  let id: string | undefined;
  try {
    const invalid = await page.request.post('/api/crm/customers', { data: { firstName: 'آزمون', lastName: 'نامعتبر', customerType: 'Individual' } });
    expect(invalid.status()).toBe(400);
    await page.goto('/dashboard/crm/customers/create');
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await expect(category(page)).toHaveValue('');
    await page.getByRole('textbox', { name: 'نام', exact: true }).fill('آزمون فعالیت');
    const surname = `دسته-${Date.now()}`;
    await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill(surname);
    await page.getByRole('textbox', { name: 'شماره تماس اول', exact: true }).fill(`091${String(Date.now()).slice(-8)}`);
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await expect(page.getByText('دسته‌بندی فعالیت مشتری الزامی است', { exact: true })).toBeVisible();
    await category(page).selectOption('BUILDER');
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await page.getByRole('textbox', { name: 'نام پروژه', exact: true }).fill('پروژه آزمون فعالیت');
    await page.getByRole('textbox', { name: 'آدرس', exact: true }).fill('نشانی آزمون محلی');
    const created = page.waitForResponse(response => response.url().endsWith('/api/crm/customers') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /ذخیره|ثبت مشتری/ }).last().click();
    const response = await created; expect(response.ok()).toBeTruthy();
    const customer = (await response.json()).data; id = customer.id;
    expect(customer.activityCategory).toBe('BUILDER'); expect(customer.trustCategory).toBe('NORMAL');
    await expect(page).toHaveURL(/\/crm\/customers$/);
    const row = page.getByRole('row').filter({ hasText: surname });
    await expect(row.getByText('سازنده', { exact: true })).toBeVisible();
    await page.goto(`/dashboard/crm/customers/${id}`);
    await expect(page.getByText('سازنده', { exact: true })).toBeVisible();
    await page.goto(`/dashboard/crm/customers/${id}/edit`);
    await expect(category(page)).toHaveValue('BUILDER');
    await category(page).selectOption('NONE');
    const saved = page.waitForResponse(res => res.url().endsWith(`/api/crm/customers/${id}`) && res.request().method() === 'PUT');
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page).toHaveURL(new RegExp(`/crm/customers/${id}$`));
    await expect(page.getByText('سازنده', { exact: true })).toHaveCount(0);
    await expect(page.getByText('هیچ کدام', { exact: true })).toHaveCount(0);
    const after = await (await page.request.get(`/api/crm/customers/${id}`)).json();
    expect(after.data.activityCategory).toBe('NONE'); expect(after.data.trustCategory).toBe('NORMAL');
    await page.screenshot({ path: testInfo.outputPath('ordinary-none-detail.png'), fullPage: true });
  } finally { if (id) await removeFixture(page, id); }
});

test('Partner legacy card requires classification, shows architect in list and detail, and hides NONE', async ({ page }, testInfo) => {
  await loginAsAdmin(page);
  const seeded = await createPartnerCustomerBrowserFixture();
  try {
    await page.context().addCookies([{ name: 'sabalan_session', value: seeded.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
    await page.goto(`/dashboard/sales/partner-customers/${seeded.customerId}/edit`);
    await expect(category(page)).toHaveValue('');
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
    await expect(page.getByText('دسته‌بندی فعالیت مشتری الزامی است', { exact: true })).toBeVisible();
    await category(page).selectOption('ARCHITECT');
    const saved = page.waitForResponse(res => res.url().includes('/full-card') && res.request().method() === 'PUT');
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByText('معمار', { exact: true })).toBeVisible();
    await page.goto('/dashboard/sales/partner-customers');
    await expect(page.getByRole('table').getByText('معمار', { exact: true })).toBeVisible();
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme); await setViewportAndZoom(page, { width: 390, height: 844 });
      await assertNoHorizontalOverflow(page); await assertNoSeriousAxeViolations(page);
      await page.screenshot({ path: testInfo.outputPath(`partner-architect-${theme}-390.png`), fullPage: true });
    }
    await setViewportAndZoom(page, { width: 1280, height: 900 });
    await page.goto(`/dashboard/sales/partner-customers/${seeded.customerId}/edit`);
    await expect(category(page)).toHaveValue('ARCHITECT'); await category(page).selectOption('NONE');
    await page.getByRole('button', { name: 'ذخیره تغییرات', exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/partner-customers/${seeded.customerId}$`));
    await expect(page.getByText('معمار', { exact: true })).toHaveCount(0);
    await expect(page.getByText('هیچ کدام', { exact: true })).toHaveCount(0);
    await page.goto('/dashboard/sales/partner-customers');
    await expect(page.getByText('معمار', { exact: true })).toHaveCount(0);
    await expect(page.getByText('تعیین‌نشده', { exact: true })).toHaveCount(0);
  } finally { await seeded.cleanup(); }
});

test('real Partner creates a customer with explicit NONE through the shared wizard', async ({ page }) => {
  await loginAsAdmin(page);
  const adminCookies = await page.context().cookies();
  const seeded = await createPartnerCustomerBrowserFixture({ customerCreation: true });
  let id: string | undefined;
  try {
    await page.context().addCookies([{ name: 'sabalan_session', value: seeded.token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax', secure: false }]);
    await page.goto('/dashboard/crm/customers/create');
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await expect(category(page)).toHaveValue('');
    await page.getByRole('textbox', { name: 'نام', exact: true }).fill('آزمون ساخت همکار');
    await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill(`فعالیت-${Date.now()}`);
    await page.getByRole('textbox', { name: 'شماره تماس اول', exact: true }).fill(`092${String(Date.now()).slice(-8)}`);
    await category(page).selectOption('NONE');
    await page.getByRole('button', { name: 'بعدی', exact: true }).click();
    await page.getByRole('textbox', { name: 'نام پروژه', exact: true }).fill('پروژه آزمون همکار');
    await page.getByRole('textbox', { name: 'آدرس', exact: true }).fill('نشانی آزمون همکار');
    const created = page.waitForResponse(res => res.url().includes('/api/crm/partner/contract-customers') && res.request().method() === 'POST');
    await page.getByRole('button', { name: /ذخیره|ثبت مشتری/ }).last().click();
    const response = await created; expect(response.ok()).toBeTruthy();
    const customer = (await response.json()).data.customer; id = customer.customerId;
    expect(customer.activityCategory).toBe('NONE');
    await expect(page).toHaveURL(/\/dashboard\/sales\/partner-customers$/);
    await page.goto(`/dashboard/sales/partner-customers/${id}`);
    await expect(page.getByRole('heading', { name: 'اطلاعات مشتری', exact: true })).toBeVisible();
    await expect(page.getByText('هیچ کدام', { exact: true })).toHaveCount(0);
    await expect(page.getByText('تعیین‌نشده', { exact: true })).toHaveCount(0);
  } finally {
    try {
      await page.context().addCookies(adminCookies);
      if (id) await removeFixture(page, id);
    } finally { await seeded.cleanup(); }
  }
});
