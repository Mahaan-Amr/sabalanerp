import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.route('**/trustseal.enamad.ir/**', route => route.fulfill({ status: 204 }));
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
}

test('contract search preserves current results, supports clear, failure/retry and RTL mobile', async ({ page }) => {
  await login(page);
  const originalResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/accounting/contracts');
  await page.goto('/dashboard/accounting/contracts');
  const original = await (await originalResponse).json();
  expect(original.success).toBe(true);
  const source = original.data.items[0]; expect(source).toBeTruthy();
  let releaseOld!: () => void;
  const oldHeld = new Promise<void>(resolve => { releaseOld = resolve; });
  let fail = false;
  await page.route('**/api/accounting/contracts?**', async route => {
    const search = new URL(route.request().url()).searchParams.get('search') || '';
    if (!search) await oldHeld;
    if (fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'خطای آزمایشی دریافت' }) });
    const item = { ...source, contractId: 'search-ui-fixture', contractNumber: '800001',
      customer: { ...source.customer, displayName: search ? 'حسن محمد زارع' : 'فهرست قدیمی آزمایشی' }, nextBestActions: [] };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: { ...original.data, total: 1, page: 1, items: [item] },
    }) }).catch(() => {}); // The old transport is expected to be aborted.
  });
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  const input = page.getByPlaceholder('جستجو در شماره قرارداد، مشتری، کد ملی یا عنوان...');
  await input.fill('زارع حسن');
  await expect(page).toHaveURL(/search=/);
  await expect(page.getByText('حسن محمد زارع', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  releaseOld();
  await expect(page.getByText('فهرست قدیمی آزمایشی', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(400);
  await expect(input).toHaveValue('زارع حسن');
  await expect(page.getByText('فهرست قدیمی آزمایشی', { exact: true })).toHaveCount(0);

  fail = true; await input.fill('خطای دریافت');
  await expect(page.getByRole('alert').filter({ hasText: 'دریافت' })).toBeVisible();
  fail = false; await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
  await expect(page.getByText('حسن محمد زارع', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  await page.screenshot({ path: 'reports/qa/accounting-performance-20261017/implementation/contracts-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.classList.add('dark'); });
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'reports/qa/accounting-performance-20261017/implementation/contracts-mobile-dark.png', fullPage: true });
  await input.fill('');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe(null);
  await expect(page.getByText('فهرست قدیمی آزمایشی', { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test('acknowledging a delayed URL search must preserve newer typing', async ({ page }) => {
  await login(page);
  await page.goto('/dashboard/accounting/contracts');
  const input = page.getByPlaceholder('جستجو در شماره قرارداد، مشتری، کد ملی یا عنوان...');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/dashboard/accounting/contracts?**', async route => {
    if (new URL(route.request().url()).searchParams.get('search') === 'حسن') await held;
    await route.continue();
  });
  const submitted = page.waitForRequest(request => {
    const url = new URL(request.url());
    return url.pathname === '/dashboard/accounting/contracts' && url.searchParams.get('search') === 'حسن';
  });
  await input.fill('حسن'); await submitted;
  await input.fill('حسن زارع'); release();
  await page.waitForTimeout(800);
  await expect(input).toHaveValue('حسن زارع');
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('حسن زارع');
});
