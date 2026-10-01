import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test.beforeEach(async ({ page }) => { page.setDefaultTimeout(15_000); await loginAsAdmin(page); });

test('Partner identity uses Partner creation without a URL flag and returns to its customer list', async ({ page }) => {
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId: 'routing-partner', profileId: 'routing-profile',
    writable: true, inquiryIds: [], customers: [], projects: [],
  } } }));
  let ordinaryWrites = 0;
  await page.route('**/api/crm/customers', route => {
    if (route.request().method() === 'POST') ordinaryWrites += 1;
    return route.fulfill({ status: 409, json: { success: false } });
  });
  let partnerWrites = 0;
  await page.route('**/api/crm/partner/contract-customers', route => {
    partnerWrites += 1;
    const body = route.request().postDataJSON();
    expect(body.customer.phoneNumber1).toBe('09120000001');
    expect(body.project.projectName).toBe('پروژه آزمون');
    return route.fulfill({ json: { success: true, data: { customer: { customerId: 'routing-customer' },
      project: { id: 'routing-project' } } } });
  });
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true,
    data: { items: [], total: 0 } } }));
  await page.goto('/dashboard/crm/customers/create');
  await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'همکاری', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('قاسم');
  await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمون');
  await page.getByRole('textbox', { name: 'شماره تماس اول', exact: true }).fill('09120000001');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام پروژه', exact: true }).fill('پروژه آزمون');
  await page.getByRole('textbox', { name: 'آدرس پروژه', exact: true }).fill('نشانی آزمون');
  await page.getByRole('button', { name: /ذخیره|ثبت مشتری/ }).last().click();
  await expect(page).toHaveURL(/\/dashboard\/sales\/partner-customers$/);
  expect(partnerWrites).toBe(1);
  expect(ordinaryWrites).toBe(0);
});

test('unavailable persona context never exposes an ordinary creation form', async ({ page }) => {
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/dashboard/crm/customers/create');
  await expect(page.getByText('تشخیص مسیر ثبت مشتری ناموفق بود.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'بعدی', exact: true })).toHaveCount(0);
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید' })).toBeVisible();
});

test('owned duplicate displays customer and requires selection before continuing contract', async ({ page }) => {
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true, data: {
    schemaVersion: 1, kind: 'PARTNER', actorId: 'routing-partner', profileId: 'routing-profile',
    writable: true, inquiryIds: [], customers: [], projects: [],
  } } }));
  let ordinaryWrites = 0;
  await page.route('**/api/crm/customers', route => {
    if (route.request().method() === 'POST') ordinaryWrites += 1;
    return route.fulfill({ status: 409, json: { success: false } });
  });
  let partnerWrites = 0;
  await page.route('**/api/crm/partner/contract-customers', route => {
    partnerWrites += 1;
    const body = route.request().postDataJSON();
    expect(body.customer.phoneNumber1).toBe('09120000001');
    expect(body.project.projectName).toBe('پروژه آزمون');
    return route.fulfill({ json: { success: true, data: { duplicate: 'OWNED', customer: { customerId: 'routing-customer', displayName: 'قاسم آزمون', phone: '09120000001' } } } });
  });
  await page.route('**/api/crm/partner/customers?*', route => route.fulfill({ json: { success: true,
    data: { items: [], total: 0 } } }));
  await page.goto('/dashboard/crm/customers/create?returnTo=contract&step=2');
  await expect(page.getByRole('heading', { name: 'ایجاد مشتری جدید' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'همکاری', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام', exact: true }).fill('قاسم');
  await page.getByRole('textbox', { name: 'نام خانوادگی', exact: true }).fill('آزمون');
  await page.getByRole('textbox', { name: 'شماره تماس اول', exact: true }).fill('09120000001');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await page.getByRole('textbox', { name: 'نام پروژه', exact: true }).fill('پروژه آزمون');
  await page.getByRole('textbox', { name: 'آدرس پروژه', exact: true }).fill('نشانی آزمون');
  await page.getByRole('button', { name: /ذخیره|ثبت مشتری/ }).last().click();
  await expect(page.getByText('مشتری موجود در فهرست شما', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/customers\/create/);
  await page.getByRole('button', { name: 'انتخاب این مشتری و بازگشت به قرارداد' }).click();
  await expect(page).toHaveURL(/contracts\/create\?.*customerId=routing-customer/);
  expect(partnerWrites).toBe(1);
  expect(ordinaryWrites).toBe(0);
});
