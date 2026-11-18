import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './support/design-system';

test('dossier approval sends stable financial identities when an HTTP response is lost', async ({ page }) => {
  await loginAsAdmin(page);
  const contractId = 'draft-approval-qa';
  const record = { id: 'invoice-approval-qa', kind: 'INVOICE_CANDIDATE', status: 'DRAFT', amount: 1234567,
    currency: 'IRR', createdAt: '2026-11-16T08:00:00Z', draftDetails: {
      systemInvoiceNumber: 'S-19', systemInvoiceDate: '2026-11-16', sepidarAmount: '100' } };
  const contract = { contractId, contractNumber: 'QA', status: 'SIGNED', isInactive: false,
    customer: { displayName: 'مشتری آزمون' },
    nextBestActions: [
      { kind: 'SAVE_INVOICE_DRAFT', visible: true, enabled: true },
      { kind: 'APPROVE_FINANCIAL_INVOICE', visible: true, enabled: true },
    ],
    accounting: { totalContractAmount: 100, invoicedAmount: 0, receivedAmount: 0, remainingAmount: 100,
      sourceStatus: 'READY', invoiceStatus: 'DRAFT', receivableStatus: 'NOT_CREATED', taxStatus: 'NOT_READY',
      eligibleForFinancialRecords: true, openCorrections: 0, openBlockerFlags: 0 } };
  await page.route(`**/api/accounting/contracts/${contractId}/lifecycle`, route => route.fulfill({ json: {
    success: true, data: { deactivationEligibility: { blockers: [] }, deleteEligibility: { blockers: [] } } } }));
  await page.route(`**/api/accounting/contracts/${contractId}`, route => route.fulfill({ json: { success: true, data: {
    contract, sourceSnapshot: { items: [], deliveries: [], paymentSchedule: [] }, financialRecords: [record],
    flags: [], financialEvidenceReviewCases: [], correctionRequests: [], lifecycleRequests: [],
    receivables: [], paymentEvents: [], tax: [], replacementWorkflow: null } } }));
  const approvals: Array<Record<string, unknown>> = [];
  await page.route('**/api/accounting/actions', async route => {
    const command = route.request().postDataJSON() as Record<string, unknown>;
    approvals.push(command);
    await route.fulfill(approvals.length === 1
      ? { status: 503, json: { success: false, error: 'Response lost after submission' } }
      : { json: { success: true, data: { outcome: 'APPLIED' } } });
  });

  await page.goto(`/dashboard/accounting/contracts/${contractId}?section=financial`);
  await page.getByRole('button', { name: 'ادامه تکمیل' }).click();
  const editor = page.locator('[data-invoice-draft-editor]');
  const amount = editor.getByRole('textbox', { name: 'مبلغ سپیدار (ریال)' });
  await amount.fill('');
  await amount.pressSequentially('1234567');
  await expect(amount).toHaveValue('1,234,567');
  await amount.fill('۱٬۲۳۴٬۵۶۷');
  await expect(amount).toHaveValue('1,234,567');
  const approve = editor.getByRole('button', { name: 'تأیید مالی' });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => approvals.length).toBe(1);
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect.poll(() => approvals.length).toBe(2);
  expect(approvals[0]).toMatchObject({ kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId: record.id,
    systemInvoiceNumber: 'S-19', systemInvoiceDate: '2026-11-16', sepidarAmount: '1234567' });
  expect(typeof approvals[0].idempotencyKey).toBe('string');
  expect(typeof approvals[0].correlationId).toBe('string');
  expect(String(approvals[0].idempotencyKey).length).toBeGreaterThan(0);
  expect(String(approvals[0].correlationId).length).toBeGreaterThan(0);
  expect(approvals[1]).toEqual(approvals[0]);
});
