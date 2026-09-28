import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPartnerInternalDocumentHtml, partnerInternalPrintInput } from '../partnerSales/accounting/internalDocument';
import { projectPartnerInternalContent } from '../partnerSales/accounting/internalDocumentContent';

test('internal document recovers frozen Sabalan rows even when invoice items are absent', () => {
  const content = projectPartnerInternalContent({ partnerPreparation: {
    owner: { caseId: 'case-1', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` },
    products: [{ productRowId: 'row-1', description: 'سنگ تست', quantity: '300', unit: 'meter',
      wholesaleUnitPrice: '1200000', approvalEvidenceId: 'approval-1', retailUnitPrice: 'PRIVATE_RETAIL_PRICE' }],
    totals: { net: '360000000', discount: '0', tax: '0', charges: '0', payable: '360000000', currency: 'IRT' },
    paymentPlan: { planId: 'plan-1', version: 1, effectiveDate: '2026-09-27', installments: [] },
  } }, { rows: [{ productRowId: 'row-1', productType: 'longitudinal', commercial: {
    requestedQuantity: '3', requestedLengthMeters: '100', requestedWidthMeters: '0.25',
    baseRateToman: 'PRIVATE_RETAIL_PRICE', totalAmountToman: 'PRIVATE_RETAIL_TOTAL',
  } }], layerConfigurations: [{ parentProductRowId: 'row-1', input: { layerTitle: 'لایه دوبل',
    widthMeters: '0.01', targetSides: ['front'], materialRateToman: 'PRIVATE_RETAIL_PRICE' } }] });
  assert.equal(content.items.length, 1);
  assert.equal(content.items[0].totalPrice, '360000000');
  assert.match(content.items[0].details.join(' '), /تعداد: 3/);
  assert.match(content.items[0].details.join(' '), /لایه دوبل/);
  assert.doesNotMatch(JSON.stringify(content), /PRIVATE_RETAIL/);
});

test('internal Partner PDF uses the Sabalan debtor and amount without leaking retail terms', () => {
  const document = {
    id: 'invoice-1', status: 'ISSUED', amount: '12000000', currency: 'IRT',
    createdAt: new Date('2026-09-26T00:00:00Z'), systemInvoiceNumber: '100329',
    partnerContext: { caseId: 'case-1', caseNumber: 'PC-secret', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'فروشنده همکار' },
      endCustomer: { displayName: '<مشتری نهایی>' }, revision: 1, actionUrl: '/private' },
    items: [{ description: '<سنگ>', quantity: '2', unitPrice: '6000000', totalPrice: '12000000', unit: 'count', details: ['تعداد: 2', 'لایه: دوبل · جلو'] }],
    technicalEvidenceAvailable: true, deliveries: [],
    receivables: [], taxRecords: [], flags: [],
    retailUnitPrice: 'PRIVATE_RETAIL_PRICE', customerPaymentPlan: 'PRIVATE_PAYMENT_PLAN',
  };
  const html = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
  assert.match(html, /طرف‌حساب سبلان: فروشنده همکار/);
  assert.match(html, /مشتری نهایی مرتبط: &lt;مشتری نهایی&gt;/);
  assert.match(html, /&lt;سنگ&gt;/);
  assert.match(html, /لایه: دوبل · جلو/);
  assert.match(html, /۲/);
  assert.match(html, /برنامه پرداخت به سبلان هنوز ثبت نشده/);
  assert.match(html, /جمع خرید از سبلان: 120000000 ریال/);
  assert.match(html, /class="sheet\s*"/);
  assert.match(html, /<th>نرخ - ریال<\/th>/);
  assert.match(html, /۶۰٬۰۰۰٬۰۰۰ ریال/);
  assert.match(html, /۱۲۰٬۰۰۰٬۰۰۰ ریال/);
  assert.equal(partnerInternalPrintInput(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]).currency, 'تومان');
  assert.doesNotMatch(html, /PRIVATE_RETAIL_PRICE|PRIVATE_PAYMENT_PLAN|PC-secret|\/private/);
  for (const variant of ['original', 'accounting', 'workshop', 'custom'] as const) {
    const rendered = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0], { variant });
    assert.doesNotMatch(rendered, /PRIVATE_RETAIL_PRICE|PRIVATE_PAYMENT_PLAN|PC-secret|\/private/);
    if (variant === 'workshop') assert.doesNotMatch(rendered, /120000000|۱۲۰٬۰۰۰٬۰۰۰|۶۰٬۰۰۰٬۰۰۰/);
  }
  const custom = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0], { variant: 'custom', customPrint: { showPrices: false, showTotals: false } });
  assert.doesNotMatch(custom, /120000000|۱۲۰٬۰۰۰٬۰۰۰|۶۰٬۰۰۰٬۰۰۰/);
});
