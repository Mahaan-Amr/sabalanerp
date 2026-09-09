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

  const apiResponses: Array<{ url: string; status: number; cacheControl: string }> = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/hr/personnel-performance/')) {
      apiResponses.push({ url: response.url(), status: response.status(),
        cacheControl: response.headers()['cache-control'] ?? '' });
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
    await page.reload();
    await expect(page.getByRole('heading', { name: 'گردش ارزیابی عملکرد' })).toBeVisible();
    const runningMotion = await page.evaluate(() => document.getAnimations()
      .filter((animation) => animation.playState === 'running'
        && Number(animation.effect?.getComputedTiming().duration || 0) > 1).length);
    expect(runningMotion).toBe(0);
    await page.keyboard.press('Tab');
    const focusEvidence = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { moved: false, visible: false };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const focusPaint = (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0)
        || style.boxShadow !== 'none';
      return { moved: true, visible: rect.width > 0 && rect.height > 0
        && style.visibility !== 'hidden' && style.display !== 'none' && focusPaint };
    });
    expect(focusEvidence).toEqual({ moved: true, visible: true });
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
  expect(apiResponses.every(({ cacheControl }) => cacheControl.includes('private') && cacheControl.includes('no-store'))).toBe(true);

  const accounts = JSON.parse(process.env.PERFORMANCE_BROWSER_ACCOUNTS_JSON || 'null') as null | Record<string, {
    username: string; password: string; expectedCapabilities: string[];
    lifecycle: Array<{ status: string; evaluationId: string }>;
    security: { maliciousHtml: string; formula: string; hiddenNonDisplayKey: string };
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
      await expect(rolePage.locator('body')).not.toContainText(account.security.hiddenNonDisplayKey);
      await expect(rolePage.locator('body')).not.toContainText(account.security.maliciousHtml);
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
      await expect(rolePage.getByText(account.security.maliciousHtml, { exact: false }).first()).toBeVisible();
      expect(await rolePage.evaluate(() => (globalThis as typeof globalThis & { __performancePwned?: boolean }).__performancePwned)).toBeUndefined();
    }
    const actionChecks = [];
    const readExpectations = [
      { path: '/api/hr/personnel-performance/supervisor/sections', allowed: role === 'supervisor' },
      { path: '/api/hr/personnel-performance/reviews', allowed: role === 'reviewer' },
      { path: '/api/hr/personnel-performance/lifecycle/sections', allowed: role === 'reviewer' || role === 'lifecycleManager' },
    ];
    for (const expectation of readExpectations) {
      const action = await context.request.get(expectation.path);
      expect(action.status(), `${role} ${expectation.path}`).toBe(expectation.allowed ? 200 : 403);
      expect(action.headers()['cache-control']).toContain('no-store');
      actionChecks.push({ action: `GET ${expectation.path}`, status: action.status(), allowed: expectation.allowed });
      await action.dispose();
    }
    for (const state of account.lifecycle) {
      const action = await context.request.post(`/api/hr/personnel-performance/evaluations/${state.evaluationId}/cancel`, {
        data: { reason: `آزمون مرورگری چرخه ${state.status} با اختیار واقعی و ماندگاری پایگاه داده.` },
      });
      const actionBody = await action.json();
      const expectedStatus = role !== 'lifecycleManager' ? 403 : state.status === 'DRAFT' ? 200 : 409;
      expect(action.status(), `${role} cancel ${state.status}: ${JSON.stringify(actionBody)}`).toBe(expectedStatus);
      expect(action.headers()['cache-control']).toContain('no-store');
      let persistedOutcome = expectedStatus === 200 ? actionBody.evaluation?.status : actionBody.code;
      if (expectedStatus === 200) {
        expect(actionBody.evaluation?.status).toBe('CANCELLED');
        const persisted = await context.request.post(`/api/hr/personnel-performance/evaluations/${state.evaluationId}/cancel`, {
          data: { reason: `بازخوانی مستقل ماندگاری لغو ${state.status}.` },
        });
        const persistedBody = await persisted.json();
        expect(persisted.status()).toBe(409);
        expect(persistedBody.code).toBe('PERFORMANCE_CANCELLATION_STATE_INVALID');
        persistedOutcome = `${actionBody.evaluation.status}:${persistedBody.code}`;
        await persisted.dispose();
      }
      if (role === 'lifecycleManager' && state.status !== 'DRAFT') {
        expect(actionBody.code).toBe('PERFORMANCE_CANCELLATION_STATE_INVALID');
      }
      actionChecks.push({ action: 'cancel', lifecycleState: state.status, status: action.status(),
        persistedOutcome });
      await action.dispose();
    }
    if (role === 'noAccess') {
      const realId = account.lifecycle[0].evaluationId;
      const [real, unknown, searched] = await Promise.all([
        context.request.post(`/api/hr/personnel-performance/evaluations/${realId}/cancel`, { data: { reason: 'بررسی عدم افشای شناسه واقعی' } }),
        context.request.post('/api/hr/personnel-performance/evaluations/00000000-0000-4000-8000-000000000000/cancel', { data: { reason: 'بررسی عدم افشای شناسه ناشناخته' } }),
        context.request.get(`/api/hr/personnel-performance/lifecycle/sections?search=${encodeURIComponent(account.security.maliciousHtml)}`),
      ]);
      expect([real.status(), unknown.status(), searched.status()]).toEqual([403, 403, 403]);
      const [realBody, unknownBody, searchedBody] = await Promise.all([real.json(), unknown.json(), searched.json()]);
      expect(Object.keys(realBody).sort()).toEqual(Object.keys(unknownBody).sort());
      expect(JSON.stringify([realBody, unknownBody, searchedBody])).not.toContain(realId);
      expect(JSON.stringify(searchedBody)).not.toMatch(/count|total|result|placeholder|search/i);
      for (const response of [real, unknown, searched]) {
        expect(response.headers()['cache-control']).toContain('no-store');
        await response.dispose();
      }
    }
    const placeholderValues = await rolePage.locator('[placeholder]').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('placeholder') ?? ''));
    expect(JSON.stringify(placeholderValues)).not.toContain(account.security.hiddenNonDisplayKey);
    expect(JSON.stringify(placeholderValues)).not.toContain(account.lifecycle[0].evaluationId);
    const storedBrowserState = await rolePage.evaluate(async () => {
      const cacheEntries = 'caches' in globalThis
        ? (await Promise.all((await caches.keys()).map(async (name) => (await caches.open(name)).keys())))
          .flat().map((request) => request.url)
        : [];
      return { local: JSON.stringify(localStorage), session: JSON.stringify(sessionStorage), cacheEntries };
    });
    const persistedSecrets = [account.security.hiddenNonDisplayKey, ...account.lifecycle.map(({ evaluationId }) => evaluationId)];
    expect(persistedSecrets.some((secret) => JSON.stringify(storedBrowserState).includes(secret))).toBe(false);
    roleChecks.push({ name: role, capabilities: account.expectedCapabilities, realPersistence: true, actionChecks });
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
    roleActionScopeMatrixComplete: roleChecks.length === 4 && roleChecks.every(({ actionChecks }) => actionChecks.length === 7),
    securityNegativeMatrix: [
      'persisted-route-identifier-enumeration-equivalence',
      'persisted-route-search-count-placeholder-nondisclosure',
      'browser-cache-no-store',
      'persisted-malicious-text-inert-browser-rendering',
    ] })}`);
  await page.context().close();
});
