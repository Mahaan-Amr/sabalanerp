import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('a cancelled loading keeps the driver in Guard and makes the same visit available for another loading', async ({ page }) => {
  await loginAsAdmin(page);
  await page.route('**/api/security/canonical-driver-queue**', route => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/canonical-driver-queue')) return route.fallback();
    return route.fulfill({ json: { success: true, data: [{
      id: 'guard-cancelled-loading', driverSource: 'INTERNAL', status: 'AVAILABLE_FOR_LOADING',
      admittedAt: '2026-11-15T08:00:00Z', finalizedAt: null,
      admissionSnapshot: { driver: { firstName: 'راننده', lastName: 'آزمایش لغو' }, plate: { plate: 'QA' } },
    }] } });
  });
  await page.goto('/dashboard/security/vehicles');
  const present = page.locator('main.sds-workspace');
  await expect(present.getByRole('heading', { name: 'رانندگان حاضر' })).toBeVisible();
  await expect(present.getByText('آماده بارگیری')).toBeVisible();
  await expect(present.getByRole('button', { name: 'ابطال پذیرش', exact: true })).toBeVisible();
  await expect(present.getByRole('button', { name: 'خروج بدون بارگیری', exact: true })).toBeVisible();
  await expect(present.getByRole('button', { name: 'ورود برای بارگیری', exact: true })).toHaveCount(0);
});
