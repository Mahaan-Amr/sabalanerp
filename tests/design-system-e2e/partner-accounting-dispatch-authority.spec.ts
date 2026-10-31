import { expect, test, type Route } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, setTheme, assertNoHorizontalOverflow } from './support/design-system';

const reply = (route: Route, data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
for (const width of [1280, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Partner Accounting uses ordinary paper acceptance and managerial request at ${width}px ${theme}`, async ({ page }, info) => {
    await loginAsAdmin(page);
    await setViewportAndZoom(page, { width, height: 900 });
    await setTheme(page, theme);
    const caseId = 'qa-partner-dispatch-authority', contractId = 'qa-partner-customer-contract';
    const doc = { id: 'qa-partner-internal', preparationOnly: true, commercial: { status: 'DRAFT' },
      caseState: 'DRAFT', status: 'DRAFT', amount: '1600', currency: 'IRT', receivedAmount: '0', remainingAmount: '1600', systemInvoiceNumber: null,
      customerSignature: { showActions: true, contractId, revision: 3, updatedAt: '2026-10-19T00:00:00Z', canRecordPaperSignature: true },
      actions: { canCreateInvoice: false, canResolveFlag: false, canFlag: false, canRequestCorrection: false, canReviewInvoice: false, canCreateReceivable: false },
      partnerContext: { caseId, caseNumber: 'qa-partner', customerContractNumber: '100399', internalRecordNumber: 'PI-100399',
        debtor: { displayName: 'همکار آزمایشی' }, endCustomer: { displayName: 'مشتری آزمایشی' } },
      items: [], receivables: [], flags: [], taxRecords: [] };
    const view: any = { authorities: [], access: { read: true, request: true, manage: false, managerDecision: false, seller: false },
      canRequestManager: false, eligible: false, actorId: 'accountant', activeManagerId: null,
      responsibleSeller: { id: 'partner', displayName: 'همکار آزمایشی' }, balance: null };
    await page.route(`**/api/accounting/contracts/partner/${caseId}/internal`, route => reply(route, doc));
    await page.route(`**/api/accounting/contracts/partner/${caseId}/lifecycle`, route => reply(route, { contract: { status: 'DRAFT', isInactive: false }, permissions: { canDeactivate: false, canReactivate: false, canDelete: false }, deleteEligibility: { blockers: [] }, deactivationEligibility: { blockers: [] }, pendingRequests: [] }));
    await page.route(`**/api/dispatch-credit/contracts/${contractId}`, route => reply(route, view));
    let signatures = 0; let requests = 0;
    await page.route(`**/api/partner/accounting/${caseId}/customer-paper-signature`, async route => {
      expect(route.request().postDataJSON()).toEqual({ revision: 3 }); signatures++;
      doc.customerSignature.canRecordPaperSignature = false; doc.customerSignature.updatedAt = '2026-10-19T01:00:00Z';
      doc.commercial.status = 'FINAL'; view.canRequestManager = true;
      await reply(route, { revision: 3 });
    });
    await page.route(`**/api/dispatch-credit/contracts/${contractId}/requests`, async route => {
      expect(route.request().postDataJSON()).toEqual({ kind: 'MANAGER', reason: '' }); requests++;
      view.authorities = [{ id: 'partner-manager-request', kind: 'MANAGER', status: 'PENDING', revision: 3, promisedDate: null,
        requestedBy: 'accountant', amountRials: '0', canDecide: false }];
      await reply(route, view.authorities[0]);
    });
    await page.goto(`/dashboard/accounting/contracts/partner/${caseId}`);
    await expect(page.getByText('۱۶٬۰۰۰ ریال (۱٬۶۰۰ تومان)', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/IRT/)).toHaveCount(0);
    const paper = page.getByRole('button', { name: 'ثبت امضای کاغذی مشتری', exact: true });
    const manager = page.getByRole('button', { name: 'درخواست تأیید مدیریتی', exact: true });
    await expect(paper).toBeEnabled(); await expect(manager).toBeDisabled();
    await paper.click(); await expect(paper).toHaveCount(0); await expect(manager).toBeEnabled();
    await manager.click();
    const dialog = page.getByRole('dialog', { name: 'مجوز مدیریتی', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'تاریخ وعده پرداخت مشتری', exact: true })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'ارسال درخواست', exact: true }).click();
    await expect(dialog).toBeHidden(); await expect(manager).toBeDisabled();
    await expect(page.getByRole('button', { name: 'تأیید', exact: true })).toHaveCount(0);
    await expect(page.getByText('شرط مالی ارسال برقرار است.', { exact: true })).toHaveCount(0);
    expect(signatures).toBe(1); expect(requests).toBe(1);
    await assertNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`partner-manager-${width}-${theme}.png`), fullPage: true });
  });
}
