import { test, expect } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin } from './support/design-system';

for (const width of [1280, 390]) for (const outcome of ['READY', 'PARTIAL', 'REJECTED'] as const) test(`Partner detail approval and ${outcome} response continuation ${width}px`, async ({ page }) => {
  await loginAsAdmin(page);
  await page.setViewportSize({ width, height: 900 });
  const fixture = createPartnerFixtures();
  const view = { ...fixture.partner, state: 'DRAFT', pricingState: 'AWAITING_INQUIRY', customerConfirmationState: 'NOT_SENT',
    products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row), sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined };
  let approved = false;
  const commands: string[] = [];
  await page.route('**/api/sales/contracts/response-test', route => route.fulfill({ json: { success: true, data: {
    id: 'response-test', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: view.owner.caseId,
    partnerRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash, partnerCaseView: view,
    status: 'DRAFT', commercialFlowVersion: 2, products: [],
  } } }));
  await page.route('**/api/sales/contracts/response-test/approve', route => route.fulfill({ status: 409, json: { success: false, error: 'Legacy approval must not be used' } }));
  await page.route('**/api/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/commercial')) { commands.push(route.request().postDataJSON().action); approved = true; }
    await route.fulfill({ json: { success: true, data: { cases: [{ view, pricingResponseState: outcome,
      commercial: { version: 1, revision: 1, status: approved ? outcome === 'READY' ? 'QUOTED' : 'DRAFT' : 'NOTE', salesApproved: approved,
        customerAccepted: false, inquiry: 'WAITING', expiresAt: null, firstFinancialRecordAt: null },
      snapshotId: null, history: [], editRecovery: { recoveryId: 'response-draft', baseRevision: 0 },
      actions: { canApproveSales: !approved, canContinue: true, canPreview: false, canIssue: false,
        canFinalize: false, canSendConfirmation: false, canRequestCorrection: false, canCancel: false, canRequestVoid: false },
    }] } } });
  });
  await page.goto('/dashboard/sales/contracts/response-test');
  await expect(page.getByText('یادداشت', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'تایید', exact: true }).click();
  await expect(page.getByText(outcome === 'READY' ? 'استعلام شده' : 'پیش‌نویس', { exact: true }).first()).toBeVisible();
  expect(commands).toEqual(['APPROVE_SALES']);
  await expect(page.getByRole('button', { name: 'تایید', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ویرایش', exact: true })).toBeVisible();
  await page.screenshot({ path: `tmp/qa/partner-visual-2026-10-03/response-${outcome}-${width}.png`, fullPage: true });
  await page.getByRole('button', { name: 'ادامه تکمیل قرارداد', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`caseId=${encodeURIComponent(view.owner.caseId)}&draftId=response-draft&baseRevision=0&returnTo=contract&step=5`));
});
