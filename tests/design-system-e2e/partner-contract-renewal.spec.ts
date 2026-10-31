import { expect, test } from '@playwright/test';
import { createPartnerFixtures } from '../../packages/partner-sales-contracts/dist/testing';
import { loginAsAdmin, setTheme, assertNoHorizontalOverflow } from './support/design-system';

for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  for (const surface of ['list', 'detail']) test(`Partner expiry renewal from ${surface} ${width}px ${theme}`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    const fixture = createPartnerFixtures();
    const caseId = fixture.partner.owner.caseId;
    let renewed = false;
    let renewals = 0;
    const view = { ...fixture.partner, customerContractNumber: 'QA-RENEW', state: 'DRAFT',
      commercialFlowVersion: 1, pricingState: 'AWAITING_INQUIRY', customerConfirmationState: 'RECONFIRMATION_REQUIRED',
      products: fixture.partner.products.map(({ wholesaleUnitPrice, ...row }) => row),
      sabalanTotals: undefined, sabalanPaymentPlan: undefined, resaleDifference: undefined };
    const contract = () => ({ id: 'qa-partner-renew', partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: caseId,
      partnerRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash, partnerCaseView: view,
      contractNumber: 'QA-RENEW', titlePersian: 'قرارداد تمدید همکار', commercialFlowVersion: 2,
      partnerCommercialStatus: renewed ? 'NOTE' : 'EXPIRED', status: renewed ? 'DRAFT' : 'EXPIRED',
      totalAmount: '629350100', currency: 'IRT', createdAt: '2026-10-03T00:00:00.000Z',
      customer: { id: 'qa', firstName: 'مشتری', lastName: 'آزمون' },
      createdByUser: { id: 'qa', firstName: 'فروشنده', lastName: 'همکار' }, products: [],
      commercialActions: { canRenew: !renewed },
    });
    await page.route('**/api/sales/contracts?**', route => route.fulfill({ json: { success: true,
      scope: 'PARTNER_CASES', data: [contract()], pagination: { page: 1, limit: 20, total: 1, pages: 1 } } }));
    await page.route('**/api/sales/contracts/qa-partner-renew', route => route.fulfill({ json: { success: true, data: contract() } }));
    await page.route('**/api/partner/cases/changes-v2', route => route.fulfill({ json: { success: true, data: { version: null } } }));
    await page.route('**/api/partner/cases/query-v2', route => route.fulfill({ json: { success: true, data: { cases: [{
      view, customerContractId: 'qa-partner-renew', commercial: { version: 1, revision: renewed ? 2 : 1,
        status: renewed ? 'NOTE' : 'EXPIRED', salesApproved: false, customerAccepted: false, inquiry: 'WAITING',
        expiresAt: renewed ? '2026-12-01T00:00:00.000Z' : '2020-01-01T00:00:00.000Z', firstFinancialRecordAt: null },
      history: [], snapshotId: null, actions: { canRenew: !renewed, canContinue: false, canPreview: false,
        canIssue: false, canFinalize: false, canSendConfirmation: false, canRequestCorrection: false,
        canCancel: false, canRequestVoid: false },
    }] } } }));
    await page.route(`**/api/partner/cases/${caseId}/commercial`, async route => {
      expect(route.request().postDataJSON()).toEqual({ action: 'RENEW', revision: 1, reason: 'تمدید به درخواست مشتری' });
      renewals++; renewed = true;
      await route.fulfill({ json: { success: true } });
    });
    await page.goto(surface === 'list' ? '/dashboard/sales/contracts' : '/dashboard/sales/contracts/qa-partner-renew');
    await setTheme(page, theme);
    if (surface === 'list') {
      await expect(page.getByText('۶۲۹٬۳۵۰٬۱۰۰ تومان', { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText(/IRT/)).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'تمدید مهلت', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'تمدید مهلت قرارداد', exact: true });
    const submit = dialog.getByRole('button', { name: 'تمدید و بازگشت به یادداشت' });
    await expect(submit).toBeDisabled();
    await expect(dialog.getByText('تأیید فروش و امضای مشتری برای نسخه جاری باید دوباره ثبت شوند.')).toBeVisible();
    await dialog.getByLabel('دلیل تمدید').fill('تمدید به درخواست مشتری');
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: `tmp/qa/partner-renewal/${surface}-${width}-${theme}.png`, fullPage: true });
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'تمدید مهلت', exact: true })).toHaveCount(0);
    expect(renewals).toBe(1);
  });
}
