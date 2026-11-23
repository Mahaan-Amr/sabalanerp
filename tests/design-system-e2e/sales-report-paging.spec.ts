import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

const reply = (route: Route, data: unknown) => route.fulfill({ json: { success: true, data } });
const metadata = {
  generatedAtLabel: 'زمان آزمون',
  scope: { label: 'دامنهٔ مجاز آزمون' },
  permissions: { canCompany: false, canManage: false, canSelectSeller: false, canViewSellerComparisons: false },
};
const overview = (label: string) => ({
  ...metadata,
  generatedAtLabel: label,
  period: { label },
  cards: { grossRealized: 200, adjustments: -25, netRealized: 175, pipelineValue: 50, pipelineCount: 1 },
  trend: [],
  statusDistribution: [],
});

test('sales report applies and stores only the newest filters when responses arrive out of order', async ({ page }) => {
  await loginAsAdmin(page);
  let releaseOlder: (() => void) | undefined;
  const reads: string[] = [];
  await page.route('**/api/sales/reports/summary?*', async (route) => {
    const request = new URL(route.request().url()).searchParams;
    const period = request.get('period')!;
    reads.push(period);
    expect(request.get('section')).toBe('overview');
    if (period === 'week') {
      await new Promise<void>((resolve) => { releaseOlder = resolve; });
      await reply(route, overview('نتیجهٔ قدیمی')).catch(() => undefined);
    } else {
      await reply(route, overview(period === 'today' ? 'نتیجهٔ امروز' : 'نتیجهٔ فیلتر آخر'));
    }
  });
  const detailReads: string[] = [];
  await page.route('**/api/sales/reports/details?*', async (route) => {
    detailReads.push(route.request().url());
    await reply(route, { rows: [], page: 1, pageSize: 25, total: 0, totalPages: 1 });
  });
  await page.goto('/dashboard/sales/reports?period=today');
  await expect(page.getByText(/نتیجهٔ امروز/)).toBeVisible();
  expect(reads).toEqual(['today']);
  expect(detailReads).toEqual([]);
  const filter = page.getByRole('combobox', { name: 'بازه', exact: true });
  await filter.selectOption('week');
  await expect.poll(() => Boolean(releaseOlder)).toBe(true);
  await filter.selectOption('yesterday');
  await expect(page.getByText(/نتیجهٔ فیلتر آخر/)).toBeVisible();
  releaseOlder!();
  await expect(page.getByText(/نتیجهٔ قدیمی/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sabalan-report-filters-sales') || '{}').range))
    .toBe('yesterday');
  await page.goto('/dashboard/sales/reports');
  await expect(filter).toHaveValue('yesterday');
  expect(detailReads).toEqual([]);
});

test('customer drilldown opens the authorized result in bounded pages and closes by keyboard', async ({ page }) => {
  await loginAsAdmin(page);
  const pages: string[] = [];
  await page.route('**/api/sales/reports/summary?*', async (route) => {
    expect(new URL(route.request().url()).searchParams.get('section')).toBe('customers');
    await reply(route, { ...metadata, customers: [{ id: 'customer-qa', name: 'مشتری آزمون', value: 250, contracts: 27 }] });
  });
  await page.route('**/api/sales/reports/details?*', async (route) => {
    const request = new URL(route.request().url()).searchParams;
    expect(request.get('kind')).toBe('customer');
    expect(request.get('key')).toBe('customer-qa');
    expect(request.get('pageSize')).toBe('25');
    const pageNumber = request.get('page')!;
    pages.push(pageNumber);
    await reply(route, {
      rows: [{ id: `contract-${pageNumber}`, contractNumber: `QA-PAGE-${pageNumber}`, customer: 'مشتری آزمون',
        statusLabel: 'قطعی', amount: 250, responsibleSeller: 'فروشنده آزمون', canOpenSource: true }],
      page: Number(pageNumber), pageSize: 25, total: 27, totalPages: 2,
    });
  });
  await page.goto('/dashboard/sales/reports?view=customers&period=today');
  const customer = page.getByRole('button', { name: 'مشتری آزمون', exact: true });
  await expect(customer).toBeVisible();
  expect(pages).toEqual([]);
  await customer.click();
  const drilldown = page.getByRole('dialog', { name: 'مشتری: مشتری آزمون' });
  await expect(drilldown.getByRole('link', { name: 'QA-PAGE-1' })).toBeVisible();
  await drilldown.getByRole('button', { name: 'بعدی', exact: true }).click();
  await expect(drilldown.getByRole('link', { name: 'QA-PAGE-2' })).toBeVisible();
  await expect(drilldown.getByRole('link', { name: 'QA-PAGE-1' })).toHaveCount(0);
  expect(pages).toEqual(['1', '2']);
  await page.keyboard.press('Escape');
  await expect(drilldown).toHaveCount(0);
  await expect(customer).toBeFocused();
});

test('an older preset save cannot clear input after a newer save completes', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/sales/reports/summary?*', (route) => reply(route, metadata));
  let releaseOlder: (() => void) | undefined;
  await page.route('**/api/sales/reports/presets', async (route) => {
    if (route.request().method() === 'GET') return reply(route, []);
    const saved = route.request().postDataJSON();
    if (saved.name === 'تنظیم یک') await new Promise<void>((resolve) => { releaseOlder = resolve; });
    await reply(route, { ...saved, id: saved.name });
  });
  await page.goto('/dashboard/sales/reports?view=export&period=today');
  const name = page.getByPlaceholder('نام پیش‌تنظیم');
  const save = page.getByRole('button', { name: 'ذخیره پیش‌تنظیم', exact: true });
  await name.fill('تنظیم یک');
  await save.click();
  await expect.poll(() => Boolean(releaseOlder)).toBe(true);
  await name.fill('تنظیم دو');
  await save.click();
  await expect(name).toHaveValue('');
  await name.fill('تنظیم یک');
  releaseOlder!();
  await expect(page.locator('option').filter({ hasText: 'تنظیم یک' })).toHaveCount(1);
  await expect(name).toHaveValue('تنظیم یک');
});
