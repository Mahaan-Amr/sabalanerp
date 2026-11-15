import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[name="identifier"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin');
  await page.locator('input[name="password"]').fill(process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  await page.locator('form').getByRole('button', { name: 'ورود' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
}

const returnToVisibleTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});

test('Accounting dashboard keeps its position and only refreshes changed sections on tab return', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await login(page);
  let fullReads = 0;
  let checks = 0;
  let workspaceReads = 0;
  let trendReads = 0;
  let changed = false;
  let revoked = false;
  let failTrend = false;
  let initialDashboard: any;
  await page.route('**/api/accounting/dashboard?**', async route => {
    fullReads += 1;
    const response = await route.fetch();
    initialDashboard = await response.json();
    await route.fulfill({ response });
  });
  await page.route('**/api/accounting/dashboard/change?**', async route => {
    checks += 1;
    if (revoked) return route.fulfill({ status: 403, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'دسترسی پایان یافت' }) });
    const revisions = initialDashboard.data.revisions;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: { accessChanged: false, workspaceChanged: changed, trendChanged: changed,
        revisions: changed ? { access: revisions.access, workspace: 'changed-workspace', trend: 'changed-trend' } : revisions },
    }) });
  });
  await page.route('**/api/accounting/dashboard/workspace?**', async route => {
    workspaceReads += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: { workspace: {
        ...initialDashboard.data.workspace,
        commandCenter: { ...initialDashboard.data.workspace.commandCenter, reviewableContracts: { count: 91 } },
      }, revisions: { access: initialDashboard.data.revisions.access,
        workspace: 'changed-workspace', trend: 'changed-trend' } },
    }) });
  });
  await page.route('**/api/accounting/financial-trend?**', async route => {
    trendReads += 1;
    if (failTrend) return route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'روند مالی موقتاً در دسترس نیست.' }) });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, data: initialDashboard.data.trend,
    }) });
  });

  await page.goto('/dashboard/accounting');
  await expect(page.getByText('قراردادهای قابل بررسی').first()).toBeVisible();
  expect(initialDashboard?.data?.revisions).toBeTruthy();
  expect(fullReads).toBe(1);
  await page.waitForTimeout(250);
  checks = 0;
  await page.evaluate(() => window.scrollTo(0, 280));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(y => window.scrollTo(0, y), scrollBefore);
  expect(fullReads).toBe(1);

  await returnToVisibleTab(page);
  await expect.poll(() => checks).toBe(1);
  expect(fullReads).toBe(1);
  expect(workspaceReads).toBe(0);
  expect(trendReads).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

  changed = true;
  failTrend = true;
  await returnToVisibleTab(page);
  await expect.poll(() => workspaceReads).toBe(1);
  await expect.poll(() => trendReads).toBe(1);
  await expect(page.getByText('۹۱').first()).toBeVisible();
  const chart = page.locator('section[aria-labelledby="accounting-financial-trend-title"]');
  await expect(chart.getByText(/آخرین نمایش موفق نشان داده می‌شود|روند مالی در دسترس نیست/)).toBeVisible();
  expect(fullReads).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await expect(page.getByLabel('در حال بارگذاری داشبورد حسابداری')).toHaveCount(0);

  failTrend = false;
  await chart.getByRole('button', { name: 'تلاش دوباره' }).click();
  await expect.poll(() => trendReads).toBe(2);
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  await expect.poll(() => fullReads).toBe(2);

  revoked = true;
  await returnToVisibleTab(page);
  await expect(page.getByText('دسترسی شما به داشبورد حسابداری پایان یافته است.')).toBeVisible();
  await expect(page.getByText('۹۱')).toHaveCount(0);
});
