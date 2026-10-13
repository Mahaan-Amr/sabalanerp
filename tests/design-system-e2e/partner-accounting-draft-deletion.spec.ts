import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

for (const width of [1280, 390]) {
  test(`Partner financial draft deletion confirms, retains failure and reloads ${width}px`, async ({ page }) => {
    await loginAsAdmin(page);
    await page.setViewportSize({ width, height: 900 });
    let removed = false;
    let attempts = 0;
    const document = {
      id: 'draft-deletion-qa', status: 'DRAFT', caseState: 'COMMITTED', commercial: { status: 'NOTE' },
      amount: '30000000', receivedAmount: '0', remainingAmount: '30000000', currency: 'IRT', systemInvoiceNumber: null,
      partnerContext: { caseId: 'draft-deletion-qa', caseNumber: 'QA', customerContractNumber: '100697', internalRecordNumber: 'QA',
        debtor: { displayName: 'همکار آزمایشی' }, endCustomer: { displayName: 'مشتری آزمایشی' } },
      actions: { canDeleteDraft: true, canVoidRecord: false, canCreateInvoice: false, canResolveFlag: false,
        canFlag: false, canRequestCorrection: false, canReviewInvoice: false, canCreateReceivable: false },
      items: [], receivables: [], taxRecords: [], flags: [], voidWorkflows: [],
    };
    await page.route('**/api/accounting/contracts/partner/draft-deletion-qa/internal', route => route.fulfill({ json: { success: true, data: {
      ...document, preparationOnly: removed, financialRecords: removed ? [] : [{ id: document.id, status: 'DRAFT', amount: document.amount, currency: 'IRT', systemInvoiceNumber: null }],
    } } }));
    await page.route('**/api/accounting/actions', async route => {
      const payload = route.request().postDataJSON();
      expect(payload.kind).toBe('DELETE_DRAFT_ACCOUNTING_RECORD');
      expect(payload.recordId).toBe(document.id);
      expect(payload.note).toBe('حذف پیش‌نویس جهت لغو قرارداد');
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 409, json: { success: false, message: 'وضعیت رکورد تغییر کرده است.' } });
      removed = true;
      return route.fulfill({ json: { success: true, data: { status: 'APPLIED' } } });
    });
    await page.goto('/dashboard/accounting/contracts/partner/draft-deletion-qa');
    await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
    await page.getByRole('button', { name: 'حذف پیش‌نویس', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const submit = dialog.getByRole('button', { name: 'حذف پیش‌نویس', exact: true });
    await submit.click();
    expect(attempts).toBe(0);
    await dialog.getByRole('textbox', { name: 'دلیل', exact: true }).fill('حذف پیش‌نویس جهت لغو قرارداد');
    await page.screenshot({ path: `tmp/qa/partner-draft-deletion/confirm-${width}.png`, fullPage: true });
    await submit.click();
    await expect(dialog.getByText('وضعیت رکورد تغییر کرده است.')).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'دلیل', exact: true })).toHaveValue('حذف پیش‌نویس جهت لغو قرارداد');
    await submit.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'حذف پیش‌نویس', exact: true })).toHaveCount(0);
    await expect(page.getByText('رکورد مالی برای این قرارداد ثبت نشده است.', { exact: true })).toBeVisible();
    expect(attempts).toBe(2);
  });
}
