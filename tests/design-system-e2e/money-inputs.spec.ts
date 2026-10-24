import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Partner accounting money input groups digits while submitting exact canonical decimals', async ({ page }) => {
  await loginAsAdmin(page);
  const caseId = 'money-input-fixture';
  const amount = '694064000.125';
  const amountRial = '6940640001.25';
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
  await page.getByRole('button', { name: 'تایید مالی', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'مبلغ سپیدار باید با مبلغ صورتحساب برابر باشد' })).toBeVisible();
  expect(payload).toBeUndefined();
  // Sepidar input is rial; the submitted amount remains exact invoice-currency toman.
  await input.fill('۶۹۴۰۶۴۰۰۰۱٫۲۵');
  await expect(input).toHaveValue('6,940,640,001.25');
  await input.fill('');
  await expect(input).toHaveValue('');
  await input.pressSequentially(amountRial);
  await expect(input).toHaveValue('6,940,640,001.25');
  await page.getByRole('button', { name: 'تایید مالی', exact: true }).click();
  await expect.poll(() => payload?.sepidarAmount).toBe(amount);
});
