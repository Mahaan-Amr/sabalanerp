import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const frontendRequire = createRequire(path.resolve('frontend/package.json'));
const { buildSync } = frontendRequire('esbuild');
const { chromium, expect } = frontendRequire('@playwright/test');

const origin = 'https://workspace-navigation.test';
const accountingPath = '/dashboard/accounting/contracts';
const partnerManagementPath = '/dashboard/sales/partners';
const routePaths = [
  '/dashboard/sales/contracts',
  '/dashboard/sales/contracts/create',
  '/dashboard/sales/partner-cases',
  '/dashboard/sales/partner-customers',
  '/dashboard/sales/partner-customers/transfers',
  '/dashboard/sales/partner-inquiries',
  '/dashboard/sales/partner-reports',
  partnerManagementPath,
];

test('Partner Sales requests follow the current sidebar and signed-in actor', async () => {
  const [bundle] = buildSync({
    bundle: true,
    entryPoints: ['frontend/e2e/fixtures/workspace-navigation.tsx'],
    platform: 'browser',
    format: 'iife',
    jsx: 'automatic',
    tsconfig: 'frontend/tsconfig.json',
    write: false,
    loader: { '.module.css': 'empty' },
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_API_URL': '"/api"',
    },
  }).outputFiles;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  try {
    const page = await browser.newPage();
    const accountant = { id: 'fixture-accountant', role: 'ACCOUNTANT' };
    const manager = { id: 'fixture-manager', role: 'ADMIN' };
    let actor = accountant;
    const requests = [];
    const profileRequests = [];
    const activeRouteChecks = [];
    let failedAuthBootstrap = 0;
    let delayedAccountantRequest = false;
    let holdSalesRequest = false;
    let completeAccountantRequest;
    const holdAccountantRequest = new Promise(resolve => { completeAccountantRequest = resolve; });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route(origin + '/**', async route => {
      const url = new URL(route.request().url());
      switch (url.pathname) {
        case accountingPath:
          return route.fulfill({ contentType: 'text/html', body: '<div id="fixture"></div>' });
        case '/api/auth/me':
          if (route.request().headers()['x-correlation-id'] && failedAuthBootstrap === 0) {
            failedAuthBootstrap++;
            return route.fulfill({ status: 503, json: { success: false } });
          }
          return route.fulfill({ json: { success: true, data: actor, session: { id: actor.id } } });
        case '/api/auth/logout':
          return route.fulfill({ json: { success: true } });
        case '/api/auth/login':
          actor = manager;
          return route.fulfill({ json: { success: true, data: { user: actor }, session: { id: actor.id } } });
        case '/api/dashboard/profile':
          profileRequests.push(actor.id);
          return route.fulfill({ json: { success: true, data: actor } });
        case '/api/system-recovery/environment':
          return route.fulfill({ json: { success: true, data: { sanitizedEnvironment: false } } });
        case '/api/workspace-permissions/user-workspaces':
          return route.fulfill({ json: { success: true, data: [{ workspace: 'accounting', permission: 'view' }] } });
        case '/api/dashboard/route-availability': {
          const pathname = url.searchParams.get('path');
          const owner = route.request().headers()['x-sabalan-expected-user'];
          if (!routePaths.includes(pathname)) {
            activeRouteChecks.push({ owner, pathname });
            const allowed = pathname !== '/dashboard/crm' && !(pathname === '/dashboard/sales' && owner === manager.id);
            return route.fulfill({ json: { success: true, data: { allowed } } });
          }
          requests.push({ owner, pathname });
          if (owner === accountant.id && holdSalesRequest && pathname === partnerManagementPath) {
            delayedAccountantRequest = true;
            await holdAccountantRequest;
          }
          if (owner === manager.id) {
            return route.fulfill({ status: 503, json: { success: false } });
          }
          return route.fulfill({ json: { success: true, data: { allowed: pathname === partnerManagementPath } } });
        }
        case '/api/duties/workspaces/crm/summary':
        case '/api/duties/workspaces/sales/summary':
          return route.fulfill({ json: { success: true, data: { attention: 0 } } });
        default:
          return route.abort();
      }
    });

    await page.goto(origin + accountingPath);
    await page.addScriptTag({ content: bundle.text });
    await page.getByRole('button', { name: 'بازکردن منو', exact: true }).click();
    const sidebar = page.locator('[data-dashboard-sidebar]').getByRole('navigation');
    const partnerLink = sidebar.getByRole('link', { name: 'فروش همکار', exact: true });
    const partnerManagementLink = sidebar.getByRole('link', { name: 'مدیریت همکاران', exact: true });
    const navigate = name => page.getByRole('button', { name }).click();
    const requestsFor = ({ id }) => requests.filter(request => request.owner === id).map(request => request.pathname);

    await expect(sidebar.getByRole('link', { name: 'کارهای امروز', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(requests, []);
    assert.equal(failedAuthBootstrap, 1);
    assert.deepEqual(profileRequests, [accountant.id]);
    assert.ok(activeRouteChecks.some(check => check.pathname === accountingPath && check.owner === accountant.id));
    await expect(page.getByText('Active dashboard route')).toBeVisible();
    await expect(partnerLink).toHaveCount(0);

    await navigate('Main dashboard');
    await expect(partnerLink).toHaveAttribute('href', partnerManagementPath);
    assert.deepEqual(requestsFor(accountant).toSorted(), routePaths);

    await navigate('CRM workspace');
    await expect(sidebar.locator('[href="/dashboard/crm/duties"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    assert.equal(requests.length, routePaths.length);
    assert.ok(activeRouteChecks.some(check => check.pathname === '/dashboard/crm' && check.owner === accountant.id));
    await expect(page.getByText('Active dashboard route')).toHaveCount(0);

    await navigate('Sales workspace');
    await expect(partnerManagementLink).toHaveAttribute('href', partnerManagementPath);
    assert.equal(requests.length, 2 * routePaths.length);

    await navigate('CRM workspace');
    await expect(sidebar.locator('[href="/dashboard/crm/duties"]')).toBeVisible();
    holdSalesRequest = true;
    await navigate('Sales workspace');
    await expect.poll(() => requestsFor(accountant).length).toBe(3 * routePaths.length);
    await expect(partnerManagementLink).toHaveCount(0);

    await navigate('Change actor');
    await expect.poll(() => requestsFor(manager).toSorted()).toEqual(routePaths);
    assert.ok(delayedAccountantRequest);
    await expect.poll(() => activeRouteChecks.some(check => check.pathname === '/dashboard/sales' && check.owner === manager.id)).toBe(true);
    await expect(page.getByText('Active dashboard route')).toHaveCount(0);
    completeAccountantRequest();
    await page.waitForLoadState('networkidle');
    await expect(partnerManagementLink).toHaveCount(0);

    await navigate('Main dashboard');
    await expect(sidebar.locator('[href="/dashboard"]')).toBeVisible();
    await page.waitForLoadState('networkidle');
    assert.deepEqual(requestsFor(manager).toSorted(), routePaths);
    await expect(partnerLink).toHaveCount(0);
    assert.deepEqual(profileRequests, [accountant.id, manager.id]);
    await navigate('Sign out');
    await expect(sidebar).toHaveCount(0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser.close();
  }
});
