import { expect, test } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoHorizontalOverflow } from './support/design-system';

test('Personnel unit tabs scroll, preserve URL filtering and reset pagination', async ({ page }) => {
  await loginAsAdmin(page);
  let units = Array.from({ length: 24 }, (_, i) => ({ id: `unit-${i}`, name: `واحد سازمانی ${i + 1}` }));
  await page.route('**/api/hr/authorization/me', route => route.fulfill({ json: { data: { actionPermissionCodes: [], effectiveAccess: { features: [{ feature: 'PERSONNEL', permission: 'view' }] } } } }));
  await page.route('**/api/hr/operational-reference/personnel', route => route.fulfill({ json: { data: { positions: [] } } }));
  await page.route(/\/api\/hr\/personnel(?:\?|$)/, route => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get('unitAssignmentScope')).toBe('current');
    return route.fulfill({ json: { data: Array.from({ length: 10 }, (_, i) => ({ id: `scroll-person-${i}`, firstName: 'پرسنل', lastName: `آزمایشی ${i}`, hrEmploymentRelationships: [] })), meta: { page: Number(url.searchParams.get('page') || 1), total: 0, totalPages: 2, organizationalUnits: units } } });
  });
  await page.goto('/dashboard/hr/personnel?page=2');
  const tabs = page.getByTestId('personnel-unit-tabs');
  for (const width of [1440, 390]) {
    await setViewportAndZoom(page, { width, height: 950 });
    await expect(tabs).toBeVisible();
    expect(await tabs.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await assertNoHorizontalOverflow(page);
    const search = await page.getByRole('textbox', { name: 'جستجوی پرسنل' }).boundingBox();
    const unitBox = await tabs.boundingBox();
    if (width >= 1024) {
      expect(search!.x).toBeGreaterThan(unitBox!.x);
      expect(Math.abs(search!.y + search!.height - unitBox!.y - unitBox!.height)).toBeLessThan(2);
    } else {
      expect(unitBox!.y).toBeGreaterThanOrEqual(search!.y + search!.height);
    }
  }
  await tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true }).click();
  await expect(page).toHaveURL(/organizationalUnitId=unit-23/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(tabs.getByRole('button', { name: 'واحد سازمانی 24', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await tabs.getByRole('button', { name: 'همهٔ واحدها', exact: true }).click();
  await expect(page).not.toHaveURL(/organizationalUnitId/);
  units = [
    { id: 'administration', name: 'اداری' }, { id: 'cutting', name: 'خط برش' },
    { id: 'hr-testing', name: 'واحد آزمایشی منابع انسانی' },
  ];
  await setViewportAndZoom(page, { width: 1218, height: 853 });
  await page.reload();
  await expect(tabs.getByRole('button')).toHaveCount(4);
  expect(await tabs.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 180 }));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  expect(scrollBefore).toBeGreaterThan(50);
  let documentRequests = 0;
  page.on('request', request => { if (request.resourceType() === 'document') documentRequests++; });
  const response = page.waitForResponse(response => /\/api\/hr\/personnel\?/.test(response.url()) && response.url().includes('organizationalUnitId=administration'));
  await tabs.getByRole('button', { name: 'اداری', exact: true }).click();
  await response;
  await expect(tabs.getByRole('button', { name: 'اداری', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollBefore);
  expect(documentRequests).toBe(0);

});

test('Personnel unit tabs use current assignments from the existing local database', async ({ page }) => {
  await loginAsAdmin(page);
  const listing = page.waitForResponse(response => /\/api\/hr\/personnel\?/.test(response.url()) && response.ok());
  await page.goto('/dashboard/hr/personnel');
  const data = await (await listing).json();
  const units = data.meta.organizationalUnits;
  expect(Array.isArray(units)).toBe(true);
  const tabs = page.getByTestId('personnel-unit-tabs');
  await expect(tabs.getByRole('button')).toHaveCount(units.length + 1);
  if (units.length) {
    const selected = units[0];
    const filtered = page.waitForResponse(response => /\/api\/hr\/personnel\?/.test(response.url()) && response.url().includes(`organizationalUnitId=${selected.id}`) && response.ok());
    await tabs.getByRole('button', { name: selected.name, exact: true }).click();
    const result = await (await filtered).json();
    expect(result.meta.total).toBeGreaterThan(0);
    expect(new Set(result.data.map((person: any) => person.id)).size).toBe(result.data.length);
    for (const person of result.data) {
      const at = Date.now();
      expect(person.hrEmploymentRelationships.some((relationship: any) =>
        ['ACTIVE', 'SUSPENDED'].includes(relationship.status)
        && Date.parse(relationship.effectiveFrom) <= at
        && (!relationship.effectiveTo || Date.parse(relationship.effectiveTo) >= at)
        && relationship.assignments.some((assignment: any) => assignment.organizationalUnitId === selected.id
          && Date.parse(assignment.effectiveFrom) <= at
          && (!assignment.effectiveTo || Date.parse(assignment.effectiveTo) >= at)))).toBe(true);
    }
  }
});
