import { expect, test } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoHorizontalOverflow } from './support/design-system';

test('Personnel unit tabs scroll, preserve URL filtering and reset pagination', async ({ page }) => {
  await loginAsAdmin(page);
  const units = Array.from({ length: 24 }, (_, i) => ({ id: `unit-${i}`, name: `واحد سازمانی ${i + 1}` }));
  await page.route('**/api/hr/authorization/me', route => route.fulfill({ json: { data: { actionPermissionCodes: [], effectiveAccess: { features: [{ feature: 'PERSONNEL', permission: 'view' }] } } } }));
  await page.route('**/api/hr/operational-reference/personnel', route => route.fulfill({ json: { data: { positions: [] } } }));
  await page.route(/\/api\/hr\/personnel(?:\?|$)/, route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('unitAssignmentScope')).toBe('current');
    return route.fulfill({ json: { data: [], meta: { page: Number(url.searchParams.get('page') || 1), total: 0, totalPages: 2, organizationalUnits: units } } });
  });
  await page.goto('/dashboard/hr/personnel?page=2');
  const tabs = page.getByTestId('personnel-unit-tabs');
  for (const width of [1440, 390]) {
    await setViewportAndZoom(page, { width, height: 950 });
    await expect(tabs).toBeVisible();
    expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await assertNoHorizontalOverflow(page);
  }
  await tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true }).click();
  await expect(page).toHaveURL(/organizationalUnitId=unit-23/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', { name: 'همهٔ واحدها', exact: true }).click();
  await expect(page).not.toHaveURL(/organizationalUnitId/);
});
