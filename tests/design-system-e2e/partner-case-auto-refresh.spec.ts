import { test, expect } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin } from './support/design-system';

test('Partner checks metadata, fetches only changes, and preserves search and an open reason field', async ({ page }) => {
  await loginAsAdmin(page);
  const fixture = createPartnerFixtures();
  let complete = false, generation = 1, fullReads = 0, checks = 0, failChecks = false;
  let holdNextRead = false;
  let releaseNextRead: (() => void) | undefined;
  const caseId = fixture.partner.owner.caseId;
  await page.route('**/api/partner/cases/creation-context?*', route => route.fulfill({ json: { success: true,
    data: { schemaVersion: 1, kind: 'PARTNER', actorId: 'test-partner', profileId: 'test-profile', writable: true,
      inquiryIds: [], customers: [], projects: [] } } }));
  await page.route('**/api/partner/cases/changes-v2', route => {
    checks++;
    if (failChecks) return route.fulfill({ status: 503, json: { success: false, error: 'خطای موقت' } });
    return route.fulfill({ json: { success: true, data: { version: `sha256-v1:${String(generation).repeat(64)}` } } });
  });
  await page.route('**/api/partner/cases/query-v2', async route => {
    fullReads++;
    if (holdNextRead) {
      holdNextRead = false;
      await new Promise<void>(resolve => { releaseNextRead = resolve; });
    }
    return route.fulfill({ json: { success: true, data: { cases: [{
      view: { ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', customerContractNumber: '100123',
        sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined,
        products: fixture.partner.products.map(({ wholesaleUnitPrice: _price, ...product }) => product) },
      customerName: 'مشتری پاسخ خودکار', snapshotId: null, inquiryResponseComplete: complete,
      pricingResponseState: complete ? 'REJECTED' : 'PARTIAL',
      commercial: { version: 1, revision: 1, status: complete ? 'QUOTED' : 'DRAFT', salesApproved: true,
        customerAccepted: false, inquiry: complete ? 'CORRECTION_REQUIRED' : 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
      editRecovery: { recoveryId: 'test-recovery', baseRevision: 1 },
      actions: { canContinue: true, canPreview: false, canIssue: false, canFinalize: false,
        canSendConfirmation: false, canRequestCorrection: false, canCancel: true, canRequestVoid: false },
    }] } } });
  });
  await page.route('**/api/partner/corrections/**', route => route.fulfill({ json: { success: true, data: null } }));
  await page.clock.install();
  await page.goto('/dashboard/sales/contracts');
  await expect(page.getByRole('cell', { name: 'مشتری پاسخ خودکار', exact: true })).toBeVisible();
  const search = page.getByPlaceholder('نام مشتری، شماره قرارداد یا محصول...');
  await search.fill('مشتری');
  const initialReads = fullReads, initialChecks = checks;
  expect(initialReads, 'superseded StrictMode metadata checks must not start another full Case read').toBe(1);
  await page.clock.fastForward(20_001);
  await expect.poll(() => checks).toBeGreaterThan(initialChecks);
  expect(fullReads).toBe(initialReads);
  complete = true; generation++; holdNextRead = true;
  await page.clock.fastForward(20_001);
  await expect.poll(() => fullReads).toBe(initialReads + 1);
  await expect(page.getByRole('cell', { name: 'مشتری پاسخ خودکار', exact: true })).toBeVisible();
  await expect(search).toHaveValue('مشتری');
  releaseNextRead?.();
  await expect(page.locator('span:visible').filter({ hasText: /^استعلام شده$/ })).toBeVisible();
  await expect(search).toHaveValue('مشتری');
  expect(fullReads).toBe(initialReads + 1);

  const beforeHidden = checks;
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(60_000);
  expect(checks).toBe(beforeHidden);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => checks).toBe(beforeHidden + 1);
  expect(fullReads).toBe(initialReads + 1);
  failChecks = true;
  await page.clock.fastForward(20_001);
  await expect(page.getByText('دریافت وضعیت تازه انجام نشد.', { exact: true })).toBeVisible();
  const failedChecks = checks;
  await page.clock.fastForward(20_001);
  expect(checks).toBe(failedChecks);
  failChecks = false;
  await page.clock.fastForward(20_001);
  await expect(page.getByText('دریافت وضعیت تازه انجام نشد.', { exact: true })).toHaveCount(0);
  await expect(search).toHaveValue('مشتری');

  complete = false; generation++;
  await page.goto(`/dashboard/sales/contracts?caseId=${encodeURIComponent(caseId)}`);
  await expect(page.getByRole('button', { name: 'رد', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بررسی پاسخ سبلان', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'رد', exact: true }).click();
  const reason = page.getByRole('dialog').getByRole('textbox');
  await reason.fill('این متن باید حفظ شود');
  complete = true; generation++;
  await page.clock.fastForward(20_001);
  await expect(page.getByRole('button', { name: 'بررسی پاسخ سبلان', exact: true })).toBeVisible();
  await expect(reason).toHaveValue('این متن باید حفظ شود');
});
