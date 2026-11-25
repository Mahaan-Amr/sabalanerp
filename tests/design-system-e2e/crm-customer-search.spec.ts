import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

function directoryRow(firstName: string) {
  return { id: firstName, firstName, lastName: 'آزمون', customerType: 'Individual', status: 'Active',
    phoneNumbers: [], projectCount: 0, isBlacklisted: false, isLocked: false };
}

test('CRM search keeps the last expression and changing page leaves profile and details alone', async ({ page }) => {
  await loginAsAdmin(page);
  let profileRequests = 0;
  let detailRequests = 0;
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/dashboard/profile') profileRequests += 1;
    if (path.startsWith('/api/crm/customers/')) detailRequests += 1;
  });

  let releaseOldResult!: () => void;
  const oldResult = new Promise<void>(resolve => { releaseOldResult = resolve; });
  let routedOldResult!: () => void;
  const oldRequestStarted = new Promise<void>(resolve => { routedOldResult = resolve; });
  let oldRequestFinished!: () => void;
  const oldRequestDone = new Promise<void>(resolve => { oldRequestFinished = resolve; });
  await page.route('**/api/crm/customers?*', async route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('view')).toBe('directory');
    const search = params.get('search');
    const current = Number(params.get('page'));
    const result = search === 'قدیمی' ? 'پاسخ قدیمی'
      : search === 'تازه' ? current === 1 ? 'پاسخ تازه' : 'صفحه دوم'
        : 'نمایش اولیه';
    if (search === 'قدیمی') {
      routedOldResult();
      await oldResult;
    }
    try {
      await route.fulfill({ json: {
        success: true, data: [directoryRow(result)], summary: { blacklisted: 0, locked: 0 },
        pagination: { page: current, total: 20, pages: 2, limit: 10 },
      } });
    } catch (error) {
      if (search !== 'قدیمی') throw error;
    } finally {
      if (search === 'قدیمی') oldRequestFinished();
    }
  });

  await page.goto('/dashboard/crm/customers');
  const directory = page.getByRole('table');
  const customerName = (firstName: string) => directory.getByText(`${firstName} آزمون`, { exact: true });
  await expect(customerName('نمایش اولیه')).toBeVisible();
  const profileAtOpen = profileRequests;
  const search = page.getByRole('searchbox');
  try {
    await search.fill('قدیمی');
    await oldRequestStarted;
    await search.fill('تازه');
    await expect(customerName('پاسخ تازه')).toBeVisible();
  } finally {
    releaseOldResult();
  }
  await oldRequestDone;
  await expect(customerName('پاسخ قدیمی')).toHaveCount(0);
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(customerName('صفحه دوم')).toBeVisible();
  expect(profileRequests).toBe(profileAtOpen);
  expect(detailRequests).toBe(0);
});

for (const form of ['potential-projects', 'follow-ups']) {
  test(`CRM ${form} finds server matches, retains an older selection and skips full customer reads`, async ({ page }) => {
    await loginAsAdmin(page);
    let fullCustomerRequests = 0;
    page.on('request', request => {
      if (/\/api\/crm\/customers(?:\/|$)/.test(new URL(request.url()).pathname)) fullCustomerRequests += 1;
    });
    await page.route('**/api/crm/sellers', route => route.fulfill({ json: {
      success: true, data: [{ id: 'seller', firstName: 'فروشنده' }],
    } }));
    await page.route('**/api/crm/potential-projects?*', route => route.fulfill({ json: { success: true, data: [] } }));
    await page.route('**/api/crm/customer-options**', route => {
      const params = new URL(route.request().url()).searchParams;
      const data = params.get('id') === 'older'
        ? [{ id: 'older', firstName: 'گزینه', lastName: 'قدیمی' }]
        : params.get('search') === 'كيان' ? [{ id: 'found', firstName: 'کیان', lastName: 'نیکی', phone: '09123456987' }]
          : [{ id: 'recent', firstName: 'گزینه', lastName: 'جدید' }];
      return route.fulfill({ json: { success: true, data } });
    });

    await page.goto(`/dashboard/crm/${form}/create?customerId=older`);
    const picker = page.getByRole('combobox', { name: 'مخاطب CRM' });
    await expect(picker).toContainText('گزینه قدیمی');
    await picker.click();
    await page.getByRole('textbox', { name: 'جستجوی گزینه‌ها' }).fill('كيان');
    const match = page.getByRole('option', { name: /کیان نیکی/ });
    await expect(match).toBeVisible();
    await match.click();
    await expect(picker).toContainText('کیان نیکی');
    expect(fullCustomerRequests).toBe(0);
  });
}
