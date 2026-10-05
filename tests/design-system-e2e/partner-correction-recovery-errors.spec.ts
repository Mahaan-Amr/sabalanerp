import { expect, test } from '@playwright/test';
import { partnerError } from '../../packages/partner-sales-contracts/dist';
import { assertNoHorizontalOverflow, loginAsAdmin, setTheme } from './support/design-system';

for (const width of [1280, 390]) test(`Partner correction shows takeover only for an actual writer conflict at ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  let code: 'STATE_CONFLICT' | 'EDIT_SESSION_OWNED_ELSEWHERE' = 'STATE_CONFLICT';
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const candidate = { caseId: 'correction-case', recoveryId: 'correction-recovery', baseRevision: 0, updatedAt: new Date().toISOString() };
    if (path.endsWith('/creation-context')) return route.fulfill({ json: { success: true, data: {
      schemaVersion: 1, kind: 'PARTNER', actorId: 'partner-correction-browser', profileId: 'partner-profile',
      actorDisplayName: 'همکار آزمایشی', writable: true, inquiryIds: [],
      customers: [], projects: [], recoverableDraft: candidate, recoverableDrafts: [candidate],
    } } });
    if (path.endsWith('/recoveries/acquire')) {
      const error = partnerError(code);
      return route.fulfill({ status: error.status, json: { success: false, ...error } });
    }
    if (path.endsWith('/catalog/query')) return route.fulfill({ json: { success: true, data: {
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: route.request().postDataJSON().kind, items: [],
    } } });
    return route.fulfill({ status: 404, json: { success: false, code: 'NOT_FOUND' } });
  });
  await page.goto('/dashboard/sales/contracts/create?caseId=correction-case');
  await expect(page.getByText(partnerError('STATE_CONFLICT').message, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ادامه ویرایش در اینجا', exact: true })).toHaveCount(0);
  await expect(page.getByText('این پیش‌نویس در محل دیگری در حال ویرایش است', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'به‌روزرسانی', exact: true })).toBeVisible();
  await setTheme(page, 'light'); await assertNoHorizontalOverflow(page);
  await setTheme(page, 'dark'); await assertNoHorizontalOverflow(page);
  code = 'EDIT_SESSION_OWNED_ELSEWHERE';
  await page.reload();
  await expect(page.getByRole('button', { name: 'ادامه ویرایش در اینجا', exact: true })).toBeVisible();
});
