import { test, expect } from '@playwright/test';
import { loginAsAdmin, setViewportAndZoom, assertNoSeriousAxeViolations } from './support/design-system';

test('Partner invoice approval and explicit receivable creation remain separate', async ({ page }) => {
  await loginAsAdmin(page);
  const owner = { caseId: 'partner-manual-receivable', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` };
  const doc = {
    id: 'partner-manual-invoice', owner, caseState: 'COMMITTED', status: 'DRAFT', amount: '1600',
    receivedAmount: '0', remainingAmount: '1600', currency: 'IRT', systemInvoiceNumber: null as string | null,
    actions: { canCreateInvoice: true, canResolveFlag: false, canFlag: true, canRequestCorrection: true,
      canReviewInvoice: true, canCreateReceivable: true },
    partnerContext: { caseId: owner.caseId, caseNumber: 'همکار-آزمون', customerContractNumber: '100334',
      internalRecordNumber: 'PI-100334', debtor: { displayName: 'همکار آزمایشی' }, endCustomer: { displayName: 'مشتری' } },
    items: [], receivables: [] as unknown[], flags: [], taxRecords: [],
  };
  let creations = 0;
  await page.route(`**/api/accounting/contracts/partner/${owner.caseId}/internal`, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: doc }),
  }));
  await page.route('**/api/partner/accounting/receivables', async route => {
    expect(route.request().postDataJSON()).toEqual({ invoiceRecordId: doc.id, expected: owner });
    creations++;
    doc.receivables = [{ id: 'explicit-receivable', status: 'OPEN', paidAmount: '0', remainingAmount: '1600',
      dueDate: '2026-09-29', payments: [] }];
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: {} }) });
  });
  await page.goto(`/dashboard/accounting/contracts/partner/${owner.caseId}`);
  await expect(page.getByRole('button', { name: 'ایجاد دریافتنی', exact: true })).toBeDisabled();
  doc.status = 'ISSUED'; doc.systemInvoiceNumber = '5678';
  await page.getByRole('button', { name: 'به‌روزرسانی', exact: true }).click();
  const create = page.getByRole('button', { name: 'ایجاد دریافتنی', exact: true });
  await expect(create).toBeEnabled();
  expect(creations).toBe(0);
  await create.click();
  const modal = page.getByRole('dialog', { name: 'ایجاد دریافتنی', exact: true });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('همکار آزمایشی');
  expect(creations).toBe(0);
  await setViewportAndZoom(page, { width: 390, height: 844 });
  await assertNoSeriousAxeViolations(page);
  await modal.getByRole('button', { name: 'تأیید و ایجاد دریافتنی', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(create).toBeDisabled();
  expect(creations).toBe(1);
  await expect(page.getByRole('link', { name: 'مشاهده دریافتنی', exact: true })).toBeVisible();
});
