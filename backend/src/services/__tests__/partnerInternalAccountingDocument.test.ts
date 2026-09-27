import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPartnerInternalDocumentHtml } from '../partnerSales/accounting/internalDocument';

test('internal Partner PDF uses the Sabalan debtor and amount without leaking retail terms', () => {
  const document = {
    id: 'invoice-1', status: 'ISSUED', amount: '12000000', currency: 'IRT',
    createdAt: new Date('2026-09-26T00:00:00Z'), systemInvoiceNumber: '100329',
    partnerContext: { caseId: 'case-1', caseNumber: 'PC-secret', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'فروشنده همکار' },
      endCustomer: { displayName: '<مشتری نهایی>' }, revision: 1, actionUrl: '/private' },
    items: [{ description: '<سنگ>', quantity: '2', unitPrice: '6000000', totalPrice: '12000000' }],
    receivables: [], taxRecords: [], flags: [],
    retailUnitPrice: 'PRIVATE_RETAIL_PRICE', customerPaymentPlan: 'PRIVATE_PAYMENT_PLAN',
  };
  const html = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
  assert.match(html, /طرف‌حساب سبلان: فروشنده همکار/);
  assert.match(html, /مشتری نهایی مرتبط: &lt;مشتری نهایی&gt;/);
  assert.match(html, /&lt;سنگ&gt;/);
  assert.doesNotMatch(html, /PRIVATE_RETAIL_PRICE|PRIVATE_PAYMENT_PLAN|PC-secret|\/private/);
});
