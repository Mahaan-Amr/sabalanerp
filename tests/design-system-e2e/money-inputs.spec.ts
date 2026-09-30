import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Partner accounting money input groups digits while submitting exact canonical decimals', async ({ page }) => {
  await loginAsAdmin(page);
  const caseId = 'money-input-fixture';
  const amount = '694064000.125';
  await page.route(`**/api/accounting/contracts/partner/${caseId}/internal`, route => route.fulfill({
    json: { success: true, data: {
      id: 'money-invoice', caseState: 'COMMITTED', status: 'DRAFT', amount, currency: 'IRT',
      receivedAmount: '0', remainingAmount: amount, systemInvoiceNumber: '1766',
      actions: { canCreateInvoice: true, canResolveFlag: false, canFlag: false,
        canRequestCorrection: false, canReviewInvoice: true, canCreateReceivable: false },
      partnerContext: { caseId, caseNumber: 'money-case', trackingNumber: 99, customerContractNumber: '100333',
        internalRecordNumber: 'PI-100333', debtor: { displayName: 'همکار آزمایشی' }, endCustomer: { displayName: 'مشتری آزمون' } },
      items: [], receivables: [], taxRecords: [], flags: [],
    } },
  }));
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/accounting/actions', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await page.goto(`/dashboard/accounting/contracts/partner/${caseId}`);
  await page.getByRole('button', { name: 'رکوردهای مالی', exact: true }).click();
  await page.getByRole('button', { name: 'ایجاد پیش‌نویس صورتحساب', exact: true }).click();
  const input = page.getByPlaceholder('مبلغ سپیدار', { exact: true });
  await input.fill('۶۹۴۰۶۴۰۰۰٫۱۲۵');
  await expect(input).toHaveValue('694,064,000.125');
  await input.fill('');
  await expect(input).toHaveValue('');
  await input.pressSequentially(amount);
  await expect(input).toHaveValue('694,064,000.125');
  await page.getByRole('button', { name: 'تایید مالی', exact: true }).click();
  await expect.poll(() => payload?.sepidarAmount).toBe(amount);
});
