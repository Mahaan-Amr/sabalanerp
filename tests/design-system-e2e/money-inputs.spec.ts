import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('Partner accounting money input groups digits while submitting exact canonical decimals', async ({ page }) => {
  await loginAsAdmin(page);
  const caseId = 'money-input-fixture';
  const amount = '694064000.125';
  const amountRial = '6940640001.25';
  await page.route('**/api/accounting/financial-records?**', route => route.fulfill({
    json: { success: true, data: { items: [{
      id: 'money-invoice', kind: 'INVOICE_CANDIDATE', sourceKind: 'PARTNER_INTERNAL_RECORD',
      status: 'DRAFT', amount, currency: 'IRT', systemInvoiceNumber: '1766',
      partnerContext: { caseId, caseNumber: 'money-case', debtor: { displayName: 'همکار آزمایشی' } },
    }], actionAvailability: { approve: true } } },
  }));
  await page.route('**/api/accounting/audit?**', route => route.fulfill({
    json: { success: true, data: { items: [], total: 0 } },
  }));
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/accounting/actions', route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await page.goto('/dashboard/accounting/invoice-candidates/money-invoice');
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
