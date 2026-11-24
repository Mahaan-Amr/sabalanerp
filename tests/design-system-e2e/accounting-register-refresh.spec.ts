import { expect, test, type Page, type Route } from '@playwright/test';

const recordId = 'register-484-fixture';
const recordNumber = 'QA-484';
const baseRow = {
  id: recordId, currency: 'IRR', contractId: 'register-484-contract',
  contract: { contractNumber: recordNumber, customer: { displayName: 'طرف حساب آزمون' } },
};
const registers = [
  { page: 'receivables', api: 'receivables', focus: true, text: recordNumber, action: 'ثبت دریافت',
    row: { ...baseRow, status: 'OPEN', originalAmount: '100000', paidAmount: '0', remainingAmount: '100000' } },
  { page: 'payments', api: 'payments', focus: true, text: recordNumber, action: 'برگشت دریافت',
    row: { ...baseRow, method: 'CASH', status: 'RECEIVED', amount: '100000' } },
  { page: 'invoice-candidates', api: 'financial-records', focus: false, text: recordId, action: 'حذف پیش‌نویس',
    row: { ...baseRow, status: 'DRAFT', amount: '100000' } },
  { page: 'tax', api: 'tax', focus: false, text: recordNumber, action: 'پذیرفته شد',
    row: { ...baseRow, submissionStatus: 'READY', taxableAmount: '100000', vatAmount: '10000' } },
];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function routeAccounting(page: Page, actor: { id: string; role: string }) {
  const writes: string[] = [];
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push(path);
      return route.fulfill({ status: 405, json: { success: false } });
    }
    if (path === '/api/auth/me' || path === '/api/dashboard/profile') {
      const isSessionProbe = path === '/api/auth/me';
      const headers = request.headers();
      const expectedUser = headers['x-sabalan-expected-user'];
      const expectedSession = headers['x-sabalan-expected-session'];
      const session = { id: `session-${actor.id}` };
      const hasSessionBinding = expectedUser !== undefined || expectedSession !== undefined;
      const matchesSession = expectedUser === actor.id
        && (expectedSession === session.id || (isSessionProbe && expectedSession === undefined));
      if (hasSessionBinding && !matchesSession) {
        return route.fulfill({ status: 401, json: { success: false, code: 'AUTH_CONTEXT_CHANGED' } });
      }
      const user = {
        ...actor, username: actor.id, firstName: 'حسابدار', lastName: 'آزمون', isActive: true,
        mustChangePassword: false,
      };
      if (isSessionProbe) return route.fulfill({ json: { success: true, data: user, session } });
      return route.fulfill({ json: { success: true, data: {
        ...user, permissions: { features: [], workspaces: [{ workspace: 'accounting', permissionLevel: 'admin' }] },
      } } });
    }
    if (path === '/api/system-recovery/environment') {
      return route.fulfill({ json: { success: true, data: { sanitizedEnvironment: false } } });
    }
    if (path === '/api/workspace-permissions/user-workspaces') return route.fulfill({ json: { success: true, data:
      [{ workspace: 'accounting', permission: 'admin' }],
    } });
    if (path === '/api/dashboard/route-availability') return route.fulfill({ json: { success: true, data: { allowed: true } } });
    if (path === '/api/partner/accounting/sabalan-plan-candidates') return route.fulfill({ status: 403, json: { success: false } });
    if (path.endsWith('/badge/me')) return route.fulfill({ json: { success: true, badge: null } });
    return route.fulfill({ json: { success: true, data: { items: [], total: 0 }, count: 0, unreadCount: 0 } });
  });
  return writes;
}

function validResponse(route: Route, register: (typeof registers)[number]) {
  return route.fulfill({ json: { success: true, data: {
    items: [register.row], page: 1, pageSize: 50, total: 1,
    ...(register.focus ? { focus: { state: 'focused', inPage: true } } : {}),
  } } });
}

const returnToTab = (page: Page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('focus'));
});

for (const register of registers) {
  test(`${register.page} preserves rows and focus during a failed refresh and clears on access denial`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    const writes = await routeAccounting(page, { id: 'register-admin', role: 'ADMIN' });
    const controller = deferred();
    let status = 200;
    await page.route(`**/api/accounting/${register.api}?**`, async route => {
      if (status === 503) await controller.promise;
      if (status !== 200) return route.fulfill({ status, json: { success: false } });
      return validResponse(route, register);
    });
    await page.goto(`/dashboard/accounting/${register.page}${register.focus ? `?recordId=${recordId}` : ''}`);
    const row = page.getByRole('row').filter({ hasText: register.text });
    const action = row.getByRole('button', { name: register.action, exact: true });
    await expect(action).toBeEnabled();
    if (register.focus) await expect(row).toHaveAttribute('data-erp-focused-row', 'true');
    await action.focus();

    status = 503;
    try {
      await returnToTab(page);
      await expect(page.getByText('در حال به‌روزرسانی اطلاعات فهرست…')).toBeVisible();
      await expect(row).toBeVisible();
      await expect(action).toBeFocused();
      await expect(action).toBeDisabled();
      await page.keyboard.press('Enter');
      expect(writes).toEqual([]);
      await expect(page.getByRole('dialog')).toHaveCount(0);
    } finally {
      controller.resolve();
    }
    await expect(page.getByRole('alert').filter({ hasText: 'ثبت تغییر تا خواندن دوباره در دسترس نیست.' })).toBeVisible();
    await expect(action).toBeFocused();
    await expect(action).toBeDisabled();

    status = 200;
    await page.getByRole('button', { name: 'تلاش دوباره', exact: true }).click();
    await expect(action).toBeEnabled();
    if (register.focus) await expect(row).toHaveAttribute('data-erp-focused-row', 'true');

    status = 403;
    await returnToTab(page);
    await expect(page.getByText('دسترسی به اطلاعات این فهرست در دسترس نیست.')).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(writes).toEqual([]);
  });
}

test('a different browser-session actor cannot inherit open receipt data', async ({ page }) => {
  const actor = { id: 'register-accountant', role: 'ACCOUNTANT' };
  const writes = await routeAccounting(page, actor);
  const register = registers[0];
  await page.route('**/api/accounting/receivables?**', route => validResponse(route, register));
  await page.goto('/dashboard/accounting/receivables');
  const row = page.getByRole('row').filter({ hasText: recordNumber });
  await row.getByRole('button', { name: 'ثبت دریافت', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ثبت دریافت' })).toBeVisible();

  actor.id = 'register-other-actor';
  actor.role = 'ADMIN';
  await returnToTab(page);
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ثبت دریافت' })).toHaveCount(0);
  expect(writes).toEqual([]);
});
