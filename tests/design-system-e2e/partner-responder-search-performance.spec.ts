import { test, expect } from '@playwright/test';
import { createPartnerWorkspaceFixturesV2 } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin } from './support/design-system';
test('responder search sends one scoped request after typing settles', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerWorkspaceFixturesV2();
  const queries: Array<{ search?: string }> = [];
  await page.route('**/api/partner/**', route => route.abort());
  await page.route('**/api/partner/cases/creation-context', route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, kind: 'ORDINARY_SALES' } } }));
  await page.route('**/api/partner/workspaces/query-v2', route => {
    queries.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, data: fixture.responderWorkspace } });
  });
  await page.goto('/dashboard/sales/partner-inquiries');
  await expect(page.getByRole('heading', { name: 'استعلام های همکار', exact: true })).toBeVisible();
  await page.waitForTimeout(350);
  const before = queries.length;
  const search = page.getByRole('searchbox', { name: 'جستجو', exact: true });
  await search.fill('م'); await search.fill('مه'); await search.fill('مهدی');
  await expect.poll(() => queries.at(-1)?.search).toBe('مهدی');
  expect(queries.length - before).toBe(1);
});
