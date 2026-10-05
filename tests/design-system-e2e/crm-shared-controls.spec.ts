import { expect, test } from '@playwright/test';
import { assertNoHorizontalOverflow, loginAsAdmin, setTheme, setViewportAndZoom } from './support/design-system';

const customer = {
  id: 'crm-controls', firstName: 'مینا', lastName: 'آزمایشی', customerType: 'Individual', status: 'Active',
  isBlacklisted: false, isLocked: false, phoneNumbers: [], contacts: [], projectAddresses: [], leads: [],
  createdAt: '2026-09-01', updatedAt: '2026-09-01', ownerUserId: 'owner',
  ownerUser: { id: 'owner', firstName: 'امین', lastName: 'آزمایشی' },
  salesContracts: [{ id: 'contract', contractNumber: '100312', status: 'SIGNED', commercialFlowVersion: 1, totalAmount: 35775000, createdAt: '2026-09-01' }],
};

test.beforeEach(async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/crm/customers/crm-controls', route => route.fulfill({ json: { success: true, data: customer } }));
  await page.route('**/api/crm/customers/crm-controls/credit', route => route.fulfill({ json: { success: true, data: { customerId: 'crm-controls', trustCategory: 'NORMAL', policyVersion: 1, limitRials: null, usedRials: '0', availableRials: null, deficitRials: '0', canManage: false } } }));
  await page.route('**/api/crm/customer-owners', route => route.fulfill({ json: { success: true, data: [customer.ownerUser] } }));
});

test('selected searchable dropdown uses a field-specific empty option and contract actions fit on mobile', async ({ page }, testInfo) => {
  await page.goto('/dashboard/crm/customers/crm-controls');
  for (const theme of ['light', 'dark'] as const) {
    await setViewportAndZoom(page, { width: 390, height: 844 });
    await setTheme(page, theme);
    const trigger = page.getByRole('combobox', { name: 'مسئول فروش' });
    await expect(trigger).toContainText('امین آزمایشی');
    await expect(page.getByRole('button', { name: 'پاک‌کردن انتخاب' })).toHaveCount(0);
    await trigger.click();
    await expect(page.getByRole('listbox')).toBeVisible();
    await expect(page.getByRole('option', { name: 'بدون مسئول فروش' })).toBeVisible();
    await page.getByRole('textbox', { name: 'جستجوی گزینه‌ها' }).fill('امین');
    await expect(page.getByRole('option', { name: 'امین آزمایشی' })).toBeVisible();
    await page.keyboard.press('Escape');
    const contract = page.locator('.sds-card').filter({ has: page.getByText('قرارداد شماره 100312', { exact: true }) }).last();
    await expect(contract).toContainText('قطعی');
    expect(await contract.evaluate(el => Array.from(el.querySelectorAll('a, span')).every(child => {
      const inner = child.getBoundingClientRect(); const outer = el.getBoundingClientRect();
      return inner.left >= outer.left - 1 && inner.right <= outer.right + 1;
    }))).toBe(true);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`customer-${theme}-mobile.png`), fullPage: true });
  }
  await setViewportAndZoom(page, { width: 780, height: 844 }, 2);
  await assertNoHorizontalOverflow(page);
});

test('direct customer entry returns to CRM dashboard even with browser history', async ({ page }) => {
  await page.goto('/dashboard/crm/customers/crm-controls');
  await expect(page.getByRole('heading', { name: 'مینا آزمایشی' })).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/crm$/);
});

test('CRM management actions remain distinct and reachable on mobile', async ({ page }) => {
  await page.route('**/api/crm/customers/crm-controls', route => route.fulfill({ json: { success: true, data: { ...customer, managementReadOnly: true, canManageCustomerCard: true, partnerOwnerProfileId: 'partner' } } }));
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await page.goto('/dashboard/crm/customers/crm-controls');
  const blacklist = page.getByRole('button', { name: /افزودن به.*لیست/ });
  const lock = page.getByRole('button', { name: 'قفل کردن', exact: true });
  await expect(blacklist).toBeVisible(); await expect(lock).toBeVisible();
  const a = (await blacklist.boundingBox())!; const b = (await lock.boundingBox())!;
  expect(a.x + a.width + 7 <= b.x || b.x + b.width + 7 <= a.x || a.y + a.height + 7 <= b.y || b.y + b.height + 7 <= a.y).toBe(true);
  await assertNoHorizontalOverflow(page);
});

test('CRM metrics link to the corresponding filtered registers', async ({ page }) => {
  await page.goto('/dashboard/crm');
  const metrics = page.getByRole('region', { name: 'شاخص‌های کلیدی' });
  await expect(metrics.getByRole('link', { name: /مخاطبین/ })).toHaveAttribute('href', '/dashboard/crm/customers');
  await expect(metrics.getByRole('link', { name: /پروژه‌های احتمالی/ })).toHaveAttribute('href', '/dashboard/crm/potential-projects');
  await expect(metrics.getByRole('link', { name: /سررسیدشده/ })).toHaveAttribute('href', '/dashboard/crm/next-actions?due=overdue');
  await expect(metrics.getByRole('link', { name: /ارزش برآوردی/ })).toHaveAttribute('href', '/dashboard/crm/potential-projects?scope=pipeline');
  const pending = page.waitForResponse(response => response.url().includes('/api/crm/next-actions?'));
  await metrics.getByRole('link', { name: /سررسیدشده/ }).click();
  const response = await pending;
  expect(response.ok()).toBe(true);
  expect(new URL(response.url()).searchParams.get('due')).toBe('overdue');
  const payload = await response.json();
  expect(payload.pagination.total).toBeGreaterThanOrEqual(payload.data.length);
  for (const row of payload.data) expect(row.status).toBe('باز');
  await expect(page.getByRole('heading', { name: 'اقدام‌های عقب‌افتاده' })).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/crm$/);
  await page.getByRole('region', { name: 'شاخص‌های کلیدی' }).getByRole('link', { name: /ارزش برآوردی/ }).click();
  await expect(page.getByRole('heading', { name: 'پروژه‌های فعال در برآورد' })).toBeVisible();
  await expect(page).toHaveURL(/scope=pipeline/);
});

test('back from an edit opened in CRM returns to the actual customer page', async ({ page }) => {
  await page.goto('/dashboard/crm/customers/crm-controls');
  await page.getByRole('link', { name: 'ویرایش', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ویرایش مشتری' })).toBeVisible();
  await page.getByRole('button', { name: 'بازگشت', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/crm\/customers\/crm-controls$/);
});

test('clearing the owner through the list saves null and disables the field while saving', async ({ page }) => {
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/crm/customers/crm-controls/owner', async route => {
    expect(route.request().postDataJSON()).toEqual({ ownerUserId: null });
    await pending;
    await route.fulfill({ json: { success: true, data: { ...customer, ownerUserId: null, ownerUser: null } } });
  });
  await page.goto('/dashboard/crm/customers/crm-controls');
  const trigger = page.getByRole('combobox', { name: 'مسئول فروش' });
  await expect(trigger).toContainText('امین آزمایشی');
  await trigger.click();
  await page.getByRole('option', { name: 'بدون مسئول فروش' }).click();
  await expect(trigger).toBeDisabled();

  release!();
  await expect(trigger).toBeEnabled();
  await expect(trigger).toContainText('بدون مسئول فروش');
  await expect(page.getByRole('button', { name: 'پاک‌کردن انتخاب' })).toHaveCount(0);
});


test('customer restriction metrics filter all matching results and preserve the search', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/crm/customers?**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    return route.fulfill({ json: { success: true, data: [{ ...customer, isBlacklisted: true, isLocked: true }], permissions: { canViewAllCustomers: true },
      summary: { blacklisted: 23, locked: 12 }, pagination: { page: Number(url.searchParams.get('page')), limit: 10, total: 23, pages: 3 } } });
  });
  await page.goto('/dashboard/crm/customers');
  const metrics = page.getByRole('region', { name: 'شاخص‌های کلیدی' });
  await expect(metrics.getByRole('button', { name: /بلک‌لیست/ })).toContainText('۲۳');
  await expect(metrics.getByRole('button', { name: /قفل‌شده/ })).toContainText('۱۲');
  await expect(metrics.getByRole('button', { name: /کل نتایج|نمایش فعلی/ })).toHaveCount(0);
  const search = page.getByPlaceholder('جستجو بر اساس نام، شماره تماس یا شرکت...');
  await search.fill('مینا');
  await expect.poll(() => requests.at(-1)?.searchParams.get('search')).toBe('مینا');
  await page.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('page')).toBe('2');
  await metrics.getByRole('button', { name: /بلک‌لیست/ }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('isBlacklisted')).toBe('true');
  expect(requests.at(-1)?.searchParams.get('search')).toBe('مینا');
  expect(requests.at(-1)?.searchParams.get('page')).toBe('1');
  await metrics.getByRole('button', { name: /قفل‌شده/ }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get('isLocked')).toBe('true');
  expect(requests.at(-1)?.searchParams.get('isBlacklisted')).toBe('true');
  await page.getByRole('combobox', { name: 'قفل', exact: true }).click();
  await page.getByRole('option', { name: 'همه وضعیت‌های قفل' }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.has('isLocked')).toBe(false);
  await assertNoHorizontalOverflow(page);
});

test('restriction totals remain accurate with an API version that has no summary', async ({ page }) => {
  const requests: URL[] = [];
  await page.route('**/api/crm/customers?**', route => {
    const url = new URL(route.request().url()); requests.push(url);
    const total = url.searchParams.get('isBlacklisted') === 'true' ? 23 : url.searchParams.get('isLocked') === 'true' ? 12 : 203;
    return route.fulfill({ json: { success: true, data: [{ ...customer, isBlacklisted: true, isLocked: true }],
      pagination: { page: 1, limit: 10, total, pages: Math.ceil(total / 10) } } });
  });
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await page.goto('/dashboard/crm/customers');
  const metrics = page.getByRole('region', { name: 'شاخص‌های کلیدی' });
  await expect(metrics.getByRole('button', { name: /بلک‌لیست/ })).toContainText('۲۳');
  await expect(metrics.getByRole('button', { name: /قفل‌شده/ })).toContainText('۱۲');
  const counted = Array.from(new Set(requests.filter(url => url.searchParams.get('limit') === '1').map(url => url.href))).map(url => new URL(url));
  expect(counted).toHaveLength(2);
  expect(counted.every(url => url.searchParams.get('page') === '1')).toBe(true);
  await assertNoHorizontalOverflow(page);
});
