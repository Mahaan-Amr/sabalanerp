import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

for (const legacy of [false, true]) {
  test(`unsaved invoice changes can be kept or discarded (${legacy ? 'without Navigation API' : 'with Navigation API'})`, async ({ page }) => {
    if (legacy) await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined }));
    await loginAsAdmin(page);
    const id = 'draft-guard-qa';
    const record = { id: 'invoice-qa', kind: 'INVOICE_CANDIDATE', status: 'DRAFT', amount: 100, currency: 'IRR', createdAt: '2026-08-20T08:00:00Z', draftDetails: { systemInvoiceNumber: 'saved' } };
    const contract = { contractId: id, contractNumber: 'QA', status: 'SIGNED', isInactive: false, customer: { displayName: 'مشتری آزمون' }, nextBestActions: [{ kind: 'CREATE_INVOICE', labelFa: 'ایجاد صورتحساب', visible: true, enabled: true }, { kind: 'SAVE_INVOICE_DRAFT', labelFa: 'ذخیره پیش‌نویس', visible: true, enabled: true }], accounting: { totalContractAmount: 100, invoicedAmount: 0, receivedAmount: 0, remainingAmount: 100, sourceStatus: 'READY', invoiceStatus: 'DRAFT', receivableStatus: 'NOT_CREATED', taxStatus: 'NOT_READY', eligibleForFinancialRecords: true, openCorrections: 0, openBlockerFlags: 0 } };
    await page.route(`**/api/accounting/contracts/${id}/lifecycle`, route => route.fulfill({ json: { success: true, data: { deactivationEligibility: { blockers: [] }, deleteEligibility: { blockers: [] } } } }));
    await page.route(`**/api/accounting/contracts/${id}`, route => route.fulfill({ json: { success: true, data: { contract, sourceSnapshot: { items: [], deliveries: [], paymentSchedule: [] }, financialRecords: [record], flags: [], financialEvidenceReviewCases: [], correctionRequests: [], lifecycleRequests: [], receivables: [], paymentEvents: [], tax: [], replacementWorkflow: null } } }));
    await page.route('**/api/accounting/actions', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe('SAVE_INVOICE_DRAFT');
      record.draftDetails.systemInvoiceNumber = payload.systemInvoiceNumber;
      await route.fulfill({ json: { success: true, data: {} } });
    });
    await page.goto(`/dashboard/accounting/contracts/${id}?section=financial`);
    await page.getByRole('button', { name: 'ادامه تکمیل' }).click();
    await page.evaluate(() => {
      history.pushState({ ...history.state, draftTestEntry: 'middle' }, '', location.href);
      history.pushState({ ...history.state, draftTestEntry: 'forward' }, '', location.href);
      history.back();
    });
    await expect.poll(() => page.evaluate(() => history.state.draftTestEntry)).toBe('middle');
    const invoice = page.getByRole('textbox', { name: 'شماره فاکتور سیستمی' });
    await invoice.fill('changed');
    // Model an unrelated portal dialog whose action would otherwise bypass the guard.
    await page.evaluate(() => {
      const otherDialog = document.createElement('div');
      otherDialog.setAttribute('role', 'dialog');
      otherDialog.innerHTML = '<button type="button">Unrelated dialog action</button>';
      otherDialog.querySelector('button')!.addEventListener('click', () => { otherDialog.dataset.executed = 'yes'; });
      document.body.appendChild(otherDialog);
    });
    await page.getByRole('button', { name: 'Unrelated dialog action' }).click();
    const exitDialog = page.getByRole('dialog').filter({ has: page.locator('[data-draft-exit-dialog]') });
    await expect(exitDialog).toBeVisible();
    await expect(page.getByRole('dialog').filter({ hasText: 'Unrelated dialog action' })).not.toHaveAttribute('data-executed', 'yes');
    await exitDialog.getByRole('button', { name: 'بازگشت به ویرایش' }).click();
    await expect(invoice).toHaveValue('changed');
    await page.getByRole('dialog').filter({ hasText: 'Unrelated dialog action' }).evaluate(element => element.remove());
    await page.getByRole('button', { name: 'خلاصه', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'بازگشت به ویرایش' }).click();
    await expect(invoice).toHaveValue('changed');
    const unloadDialog = page.waitForEvent('dialog');
    const reload = page.evaluate(() => { location.reload(); });
    const warning = await unloadDialog;
    expect(warning.type()).toBe('beforeunload');
    await warning.dismiss();
    await reload;
    await expect(invoice).toHaveValue('changed');
    await page.evaluate(() => history.back());
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state.draftTestEntry)).toBe('middle');
    await dialog.getByRole('button', { name: 'بازگشت به ویرایش' }).click();
    await expect(invoice).toHaveValue('changed');
    await page.evaluate(() => history.forward());
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => history.state.draftTestEntry)).toBe('middle');
    await dialog.getByRole('button', { name: 'خروج بدون ذخیره' }).click();
    await expect.poll(() => page.evaluate(() => history.state.draftTestEntry)).toBe('forward');
    await page.getByRole('button', { name: 'ادامه تکمیل' }).click();
    await expect(invoice).toHaveValue('saved');
    await invoice.fill('changed again');
    await page.getByRole('button', { name: 'خلاصه', exact: true }).click();
    await dialog.getByRole('button', { name: 'خروج بدون ذخیره' }).click();
    await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
    await page.getByRole('button', { name: 'ادامه تکمیل' }).click();
    await expect(invoice).toHaveValue('saved');
    await invoice.fill('saved again');
    await page.getByRole('button', { name: 'ذخیره پیش‌نویس' }).click();
    await expect(invoice).toHaveValue('saved again');
    await page.getByRole('button', { name: 'خلاصه', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'شماره فاکتور سیستمی' })).toHaveValue('saved again');
  });
}
