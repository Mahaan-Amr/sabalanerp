import { expect, test } from '@playwright/test';

test('anonymous Sales deep-link returns to a usable Persian login @internal-entry', async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  const unexpected: string[] = [];
  const knownLegacy: string[] = [];
  const expectedAnonymousRejections = ['/api/auth/me', '/api/dashboard/profile', '/api/dashboard/route-availability'];
  const nextDevelopmentStackFramePath = '/__nextjs_original-stack-frames';
  const nextDevelopmentFontPath = '/__nextjs_font/geist-latin.woff2';
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === 'http://127.0.0.1:3000'
      && request.method() === 'POST'
      && url.pathname === nextDevelopmentStackFramePath) {
      return route.continue();
    }
    if (url.origin !== 'http://127.0.0.1:3000' || !['GET', 'HEAD'].includes(request.method())) {
      unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  page.on('pageerror', () => unexpected.push('uncaught page error'));
  page.on('requestfailed', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === nextDevelopmentStackFramePath) return;
    if (pathname === nextDevelopmentFontPath) {
      knownLegacy.push('Next.js development font request was cancelled during the initial redirect');
      return;
    }
    if (pathname === '/brand/logo-project.png' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (request.isNavigationRequest() && pathname === '/dashboard/sales/contracts/create' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    if (pathname === '/login' && request.failure()?.errorText === 'net::ERR_ABORTED'
      && (request.isNavigationRequest() || request.headers().rsc === '1')) {
      knownLegacy.push('LEGACY-314-01: duplicate anonymous redirect cancelled login navigation/RSC');
      return;
    }
    unexpected.push(`network failure ${request.method()} ${pathname}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location().url;
    const pathname = location ? new URL(location).pathname : '(unknown)';
    if (pathname === nextDevelopmentStackFramePath) return;
    if (expectedAnonymousRejections.includes(pathname) && /status of 401/.test(message.text())) return;
    if (message.text().startsWith('Auth check error: AxiosError: Request failed with status code 401')) return;
    if (message.text().startsWith('Failed to fetch RSC payload for http://127.0.0.1:3000/login. Falling back to browser navigation.')) {
      knownLegacy.push('LEGACY-314-01: login RSC fallback logged by Next.js');
      return;
    }
    // No raw console payloads: later authenticated suites must never leak business evidence.
    unexpected.push(`console error ${pathname}`);
  });
  page.on('response', (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === nextDevelopmentStackFramePath) return;
    if (response.status() >= 400 && !(response.status() === 401 && expectedAnonymousRejections.includes(pathname))) {
      unexpected.push(`HTTP ${response.status()} ${pathname}`);
    }
  });
  await page.addInitScript((theme) => localStorage.setItem('theme', theme), testInfo.project.use.colorScheme || 'light');
  await page.goto('/dashboard/sales/contracts/create').catch(error => {
    if (!String(error).includes('ERR_ABORTED')) throw error;
  });
  await page.waitForURL(/\/login(?:\?|$)/, { timeout: 60_000 });
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'ورود به حساب' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.use.colorScheme!);
  await expect(page.locator('input[name="identifier"]')).toBeVisible();
  await page.locator('input[name="identifier"]').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('input[name="password"]')).toBeFocused();
  await expect(page.getByRole('button', { name: 'ورود', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
  await testInfo.attach('known-legacy-observations', { body: JSON.stringify({ defect: 'LEGACY-314-01', observations: knownLegacy }), contentType: 'application/json' });
  expect(unexpected).toEqual([]);
});
