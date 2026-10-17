import { expect, test, type Page } from '@playwright/test';
import { assertNoHorizontalOverflow, assertNoSeriousAxeViolations, setTheme, setViewportAndZoom } from './support/design-system';

// Component/browser acceptance against the reviewed compiled frontend. API
// responses are controlled here; real cookie/database enforcement is separately
// exercised by notificationServiceDevice.fixture.ts, never inferred from mocks.
async function setup(page: Page) {
  const state = { owner: 'notification_owner_a', sessionId: 'notification_session_a', logins: 0, revision: 1, privateRequests: 0, mutations: 0, probesDenied: 0 };
  const user = { id: 'notification_owner_a', firstName: 'آزمون', lastName: 'اعلان', username: 'notification-qa', email: 'notification@example.invalid', role: 'ADMIN', isActive: true };
  await page.route('**/socket.io/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const send = (data: unknown, extra = {}) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data, ...extra }) });
    if (path === '/api/auth/login') {
      state.logins++;
      const body = request.postDataJSON(); expect(body.expectedUserId).toBe(user.id);
      if (body.identifier !== user.username) return route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ code: 'AUTH_CONTEXT_CHANGED', error: 'برای ادامهٔ این فرم، با همان حساب قبلی وارد شوید.' }) });
      state.owner = user.id; state.sessionId = 'notification_session_restored';
      return send({ user }, { session: { id: state.sessionId } });
    }
    if (path === '/api/auth/me') {
      if (request.headers()['x-sabalan-expected-user'] && state.owner !== user.id) {
        state.probesDenied++;
        return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'AUTH_CONTEXT_CHANGED', error: 'نشست این صفحه تغییر کرده است' }) });
      }
      return send(user, { session: { id: state.sessionId } });
    }
    if (path === '/api/dashboard/profile') return send(user);
    if (path === '/api/dashboard/route-availability') return send({ allowed: true });
    if (path === '/api/workspace-permissions/user-workspaces') return send([]);
    if (path === '/api/system-recovery/environment') return send({ sanitizedEnvironment: true });
    if (path.includes('/personnel-performance/badge/me')) return send(null, { badge: null });
    if (path.startsWith('/api/notifications')) {
      state.privateRequests++;
      expect(request.headers()['x-sabalan-expected-user']).toBe(user.id);
      expect(request.headers()['x-sabalan-expected-session']).toBe(state.sessionId);
      // A rejected fresh probe must prevent any subsequent private operation.
      expect(state.owner).toBe(user.id);
      if (request.method() !== 'GET') { state.mutations++; return send({}); }
      if (path.endsWith('/unread-count')) return send({ count: 1 });
      if (path.endsWith('/metadata')) return send({ workspaces: [], categories: [] });
      if (path.endsWith('/settings/preferences')) return send({ supported: false, preference: { webPushEnabled: false, mutedCategories: [], lowPriorityDelivery: 'IMMEDIATE' }, devices: [{ id: 'qa-device', deviceLabel: 'دستگاه خصوصی', createdAt: '2026-10-15T00:00:00Z' }] });
      const cursor = url.searchParams.get('cursor');
      const item = { id: cursor ? 'second' : 'first', title: cursor ? 'اعلان صفحه دوم' : `اعلان خصوصی ${state.revision}`, message: 'متن خصوصی حساب اول', priority: 'NORMAL', type: 'SYSTEM', createdAt: '2026-10-15T00:00:00Z' };
      const read = url.searchParams.get('state') === 'READ';
      return send(read ? [] : [item], { pagination: { nextCursor: cursor ? null : 'first', hasMore: !cursor } });
    }
    return send([]);
  });
  await page.goto('/dashboard/personal/notifications');
  await expect(page.getByRole('heading', { name: 'اعلان خصوصی 1', exact: true })).toBeVisible();
  return state;
}

test('notification catch-up preserves visible pages and unsaved preferences in the compiled browser', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'نمایش بیشتر', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'اعلان صفحه دوم' })).toBeVisible();
  await page.getByRole('button', { name: 'ترجیحات و دستگاه‌ها' }).click();
  const muted = page.getByRole('checkbox', { name: 'بی‌صدا کردن جذب', exact: true });
  await muted.check();
  await page.getByRole('textbox', { name: 'نام دستگاه', exact: true }).fill('نوشته ذخیره نشده');
  state.revision = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: 'اعلان خصوصی 2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اعلان صفحه دوم' })).toBeVisible();
  await expect(muted).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'نام دستگاه', exact: true })).toHaveValue('نوشته ذخیره نشده');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
    await assertNoHorizontalOverflow(page);
    await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`notification-${theme}-mobile-200.png`), fullPage: true });
  }
  expect(state.mutations).toBe(0);
});

test('session continuation retains unsaved form state and accepts only its original account', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'ترجیحات و دستگاه‌ها' }).click();
  const draft = page.getByRole('textbox', { name: 'نام دستگاه', exact: true });
  await draft.fill('نوشتهٔ من هنگام پایان نشست');
  state.owner = 'notification_owner_b';
  await page.getByRole('button', { name: 'غیرفعال‌سازی', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ادامهٔ کار با همین حساب' });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اعلان خصوصی 1', exact: true })).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/personal\/notifications$/);
  expect(state.mutations).toBe(0);
  await dialog.getByRole('textbox', { name: 'نام کاربری یا شماره همراه' }).fill('other-device-owner');
  await dialog.getByLabel('رمز عبور', { exact: true }).fill('valid-other-account-password');
  await dialog.getByRole('button', { name: 'ورود و ادامهٔ فرم' }).click();
  await expect(dialog.getByRole('alert')).toContainText('همان حساب قبلی');
  expect(state.owner).toBe('notification_owner_b'); expect(state.mutations).toBe(0);
  await expect(dialog.getByLabel('رمز عبور', { exact: true })).toHaveValue('');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme); await setViewportAndZoom(page, { width: 390, height: 844 }, 2);
    await assertNoHorizontalOverflow(page); await assertNoSeriousAxeViolations(page);
    await page.screenshot({ path: testInfo.outputPath(`session-continuation-${theme}-mobile-200.png`), fullPage: true });
  }
  await dialog.getByRole('textbox', { name: 'نام کاربری یا شماره همراه' }).fill('notification-qa');
  await dialog.getByLabel('رمز عبور', { exact: true }).fill('valid-original-account-password');
  await dialog.getByRole('button', { name: 'ورود و ادامهٔ فرم' }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(draft).toHaveValue('نوشتهٔ من هنگام پایان نشست');
  expect(state.mutations).toBe(0); expect(state.logins).toBe(2);
});

for (const operation of ['read-all', 'disable-device'] as const) test(`changed account hides private page on ${operation} without navigation or mutation`, async ({ page }) => {
  const state = await setup(page);
  if (operation === 'disable-device') await page.getByRole('button', { name: 'ترجیحات و دستگاه‌ها' }).click();
  state.owner = 'notification_owner_b';
  await page.getByRole('button', { name: operation === 'read-all' ? 'خواندن همه' : 'غیرفعال‌سازی', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'ادامهٔ کار با همین حساب' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'اعلان خصوصی 1', exact: true })).toHaveCount(0);
  await expect(page.getByText('دستگاه خصوصی', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/personal\/notifications$/);
  expect(state.mutations).toBe(0); expect(state.probesDenied).toBeGreaterThan(0);
});

for (const operation of ['read-all', 'read-one'] as const) test(`changed account clears the shell notification preview on ${operation}`, async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: /^اعلان‌ها/ }).click();
  const dialog = page.getByRole('dialog', { name: 'اعلان‌ها', exact: true });
  await expect(dialog.getByText('اعلان خصوصی 1', { exact: true })).toBeVisible();
  state.owner = 'notification_owner_b';
  if (operation === 'read-all') await dialog.getByRole('button', { name: 'خواندن همه', exact: true }).click();
  else await dialog.getByRole('button').filter({ hasText: 'اعلان خصوصی 1' }).click();
  await expect(dialog.getByText('اعلان خصوصی 1', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'ادامهٔ کار با همین حساب' })).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/personal\/notifications$/);
  expect(state.mutations).toBe(0); expect(state.probesDenied).toBeGreaterThan(0);
});
