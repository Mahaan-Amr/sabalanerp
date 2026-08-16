import { expect, test } from '@playwright/test';
import { loginAsAdmin as login } from './support/design-system';

test('role-aware dispatch timeline preserves authorized LSV and clears it on denial', async ({ page }) => {
  let responseMode: 'success' | 'transient' | 'denied' = 'success';
  const empty = JSON.stringify({ success: true, data: [] });
  await page.route('**/api/workspace-permissions/user-workspaces', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [{ workspace: 'security', permission: 'edit' }] }) }));
  await page.route('**/api/security/exit-desk/authorizations**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty }));
  await page.route('**/api/security/canonical-driver-queue**', (route) => {
    if (route.request().url().includes('/admission-options')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true,
      data: { internalAssignments: [], externalDrivers: [], externalVehicles: [] } }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: empty });
  });
  await page.route('**/api/security/driver-queue**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty }));
  await page.route('**/api/security/vehicle-pairs**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty }));
  await page.route('**/api/security/vehicle-movements**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: empty }));
  await page.route('**/api/dispatch-cases**', async (route) => {
    if (responseMode === 'denied') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'denied' }) });
    if (responseMode === 'transient') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'offline' }) });
    const detail = /\/dispatch-cases\/turn-1/.test(route.request().url());
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail ? { success: true, data: {
      case: { id: 'turn-1' }, currentAction: 'GUARD_REVIEW', recovery: 'RETRY_AT_GUARD', capabilities: { canMutateTimeline: false },
      events: [{ id: 'event-1', station: 'GUARD', eventType: 'ADMITTED', occurredAt: '2026-08-08T08:00:00.000Z', detail: { state: 'READY' } }],
    } } : { success: true, access: { workspace: 'security', permission: 'edit' }, data: [{ id: 'turn-1', driverName: 'راننده آزمون', loadingNumber: 'L-100', status: 'WAITING_AT_GATE' }] }) });
  });

  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/dashboard/security/vehicles');
  await expect(page.getByText('راننده آزمون', { exact: true })).toBeVisible();
  const timelineButton = page.getByRole('button', { name: 'مشاهده خط زمانی', exact: true });
  await timelineButton.focus();
  await page.keyboard.press('Enter');
  const sheet = page.getByRole('dialog', { name: 'خط زمانی پرونده ارسال' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'مشاهده شواهد GUARD', exact: true }).click();
  await expect(sheet.getByText('شواهد ایستگاه GUARD', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  expect(await sheet.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  await page.keyboard.press('Escape');

  responseMode = 'transient';
  await page.getByRole('button', { name: 'تازه‌سازی', exact: true }).click();
  await expect(page.getByText(/آخرین نمای موفق/)).toBeVisible();
  await expect(page.getByText('راننده آزمون', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('dispatch-cases:last-success:') && key.endsWith(':edit')))).toBe(true);

  responseMode = 'denied';
  await page.getByRole('button', { name: 'تازه‌سازی', exact: true }).click();
  await expect(page.getByText('دسترسی به پرونده‌های ارسال مجاز نیست.', { exact: true })).toBeVisible();
  await expect(page.getByText('راننده آزمون', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((key) => key.startsWith('dispatch-cases:last-success:')))).toBe(false);
});
