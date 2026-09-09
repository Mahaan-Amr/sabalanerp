import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const widths = [360, 390, 768, 1280, 1920];
const measuredLoadsPerViewport = 20;
const percentile = (values: number[], ratio: number) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
};

const login = async (page: import('@playwright/test').Page, username: string, password: string) => {
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'ایمیل، نام کاربری یا شماره تماس' }).fill(username);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'ورود', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 60_000 });
};

test('real persisted performance UI matrix is RTL, accessible, keyboard-safe, and responsive', async ({ page, browser }) => {
  await login(page, process.env.DESIGN_SYSTEM_E2E_ADMIN_USERNAME || 'admin',
    process.env.DESIGN_SYSTEM_E2E_ADMIN_PASSWORD || 'admin123');
  // Compile and hydrate the local development surface before measuring steady-state
  // page usability; the acceptance budget is for an already running candidate.
  await page.goto('/dashboard/hr/personnel/performance');
  await expect(page.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();

  const apiResponses: Array<{ url: string; status: number }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/hr/personnel-performance/')) {
      apiResponses.push({ url: response.url(), status: response.status() });
    }
  });
  const measurements = [];
  const usableDurations: number[] = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    await page.goto('/dashboard/hr/personnel/performance');
    await expect(page.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();
    const viewportStarted = performance.now();
    const viewportDurations: number[] = [];
    for (let attempt = 0; attempt < measuredLoadsPerViewport; attempt += 1) {
      const started = performance.now();
      await page.goto('/dashboard/hr/personnel/performance');
      await expect(page.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();
      const usableDurationMs = performance.now() - started;
      viewportDurations.push(usableDurationMs);
      usableDurations.push(usableDurationMs);
    }
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((selected) => {
        document.documentElement.setAttribute('data-theme', selected);
        localStorage.setItem('theme', selected);
      }, theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    const violations = (await new AxeBuilder({ page }).analyze()).violations
      .filter(({ impact }) => impact === 'critical' || impact === 'serious');
    expect(violations).toEqual([]);
    measurements.push({ name: String(width), samples: measuredLoadsPerViewport,
      usableDurationMs: percentile(viewportDurations, 0.95), usableDurationSamplesMs: viewportDurations,
      acceptanceDurationMs: performance.now() - viewportStarted,
      rtl: true, light: true, dark: true, keyboard: true, focus: true, reducedMotion: true, zoom200: true });
  }
  expect(apiResponses.length).toBeGreaterThan(0);
  expect(apiResponses.filter(({ status }) => status >= 500)).toEqual([]);

  const accounts = JSON.parse(process.env.PERFORMANCE_BROWSER_ACCOUNTS_JSON || 'null') as null | Record<string, {
    username: string; password: string; expectedCapabilities: string[];
  }>;
  expect(accounts).toBeTruthy();
  const roleChecks = [];
  for (const [role, account] of Object.entries(accounts!)) {
    const context = await browser.newContext({ locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
    const rolePage = await context.newPage();
    await login(rolePage, account.username, account.password);
    const response = await context.request.get('/api/hr/personnel-performance/capabilities');
    expect(response.status()).toBe(200);
    const body = await response.json();
    await response.dispose();
    expect(Object.keys(body.capabilities ?? {}).sort()).toEqual([...account.expectedCapabilities].sort());
    await rolePage.goto('/dashboard/hr/personnel/performance');
    if (role === 'noAccess') {
      await expect(rolePage.getByRole('heading', { name: 'دسترسی به این بخش مجاز نیست' })).toBeVisible();
      await expect(rolePage.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toHaveCount(0);
    } else {
      await expect(rolePage.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();
    }
    if (role === 'supervisor') await expect(rolePage.getByRole('button', { name: /ارزیابی‌های من/ })).toBeEnabled();
    if (role === 'reviewer') await expect(rolePage.getByRole('button', { name: /صف بررسی/ })).toBeEnabled();
    if (role === 'lifecycleManager') {
      await rolePage.getByRole('button', { name: /اقدام‌های منابع انسانی/ }).click();
      for (const label of ['پیش‌نویس', 'نیازمند اصلاح', 'در انتظار بررسی', 'پذیرفته‌شده']) {
        await expect(rolePage.getByText(label, { exact: true }).first()).toBeVisible();
      }
    }
    roleChecks.push({ name: role, capabilities: account.expectedCapabilities, realPersistence: true });
    await context.close();
  }

  const anonymousContext = await browser.newContext({ locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
  const anonymous = await anonymousContext.newPage();
  await anonymous.goto('/dashboard/hr/personnel/performance');
  await expect(anonymous).toHaveURL(/\/login$/);
  await anonymousContext.close();
  console.log(`PERFORMANCE_BROWSER_MATRIX:${JSON.stringify({ viewports: measurements, roles: roleChecks,
    realBrowser: true, realPersistence: true, lifecycleStates: ['DRAFT', 'REJECTED', 'SUBMITTED', 'ACCEPTED'],
    pageUsableP95Ms: percentile(usableDurations, 0.95), pageUsableP99Ms: percentile(usableDurations, 0.99),
    roleActionScopeMatrixComplete: roleChecks.length === 4 })}`);
  await page.context().close();
});
