import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPartnerInternalDocumentHtml, partnerInternalPrintInput } from '../partnerSales/accounting/internalDocument';
import { projectPartnerInternalContent } from '../partnerSales/accounting/internalDocumentContent';

test('Partner customer section prints saved identity and delivery managers, with double-dash missing values', () => {
  const document = { amount: '100', currency: 'IRT', createdAt: new Date('2026-10-12'),
    partnerContext: { customerContractNumber: '100697', internalRecordNumber: 'PI-100697',
      debtor: { displayName: 'همکار خصوصی' }, endCustomer: { displayName: 'مشتری', phone: '09120000000' } },
    customerInformation: { nationalCode: '0012345678', companyName: '<شرکت مشتری>', brandName: 'برند جایگزین',
      projectManagerName: 'مدیر ثبت‌شده مشتری', projectManagerNumber: '09121112233' },
    items: [], deliveries: [
      { date: '2026-10-13', destination: 'پروژه', projectManagerName: 'مدیر تحویل اول', receiverName: 'گیرنده جداگانه', items: [] },
      { date: '2026-10-14', destination: 'پروژه', projectManagerName: 'مدیر تحویل دوم', items: [] },
      { date: '2026-10-15', destination: 'پروژه', projectManagerName: 'مدیر تحویل اول', items: [] },
    ] };
  const section = (value: unknown) => renderPartnerInternalDocumentHtml(value as Parameters<typeof partnerInternalPrintInput>[0])
    .match(/<h2>مشخصات مشتری و پروژه<\/h2>([\s\S]*?)<\/section>/)?.[1] || '';
  const rendered = section(document);
  assert.match(rendered, /کد ملی:<\/strong> ۰۰۱۲۳۴۵۶۷۸/);
  assert.match(rendered, /نام برند\/شرکت:<\/strong> &lt;شرکت مشتری&gt;/);
  assert.match(rendered, /مدیر پروژه:<\/strong> مدیر تحویل اول، مدیر تحویل دوم/);
  assert.match(rendered, /شماره مدیر پروژه:<\/strong> ۰۹۱۲۱۱۱۲۲۳۳/);
  assert.doesNotMatch(rendered, /همکار خصوصی|گیرنده جداگانه|مدیر ثبت‌شده مشتری|برند جایگزین/);
  const brandOnly = { ...document, deliveries: [], customerInformation: { ...document.customerInformation, companyName: '  ' } };
  assert.match(section(brandOnly), /نام برند\/شرکت:<\/strong> برند جایگزین/);
  assert.match(section(brandOnly), /مدیر پروژه:<\/strong> مدیر ثبت‌شده مشتری/);
  const missing = { ...document, customerInformation: { nationalCode: ' ', companyName: '', brandName: null, projectManagerName: '', projectManagerNumber: ' ' },
    partnerContext: { ...document.partnerContext, endCustomer: { displayName: 'مشتری', phone: '' } },
    deliveries: [{ date: '2026-10-13', destination: '', projectManagerName: ' ', receiverName: 'گیرنده جداگانه', items: [] }] };
  for (const label of ['کد ملی', 'نام برند/شرکت', 'شماره تماس', 'مدیر پروژه', 'شماره مدیر پروژه']) {
    assert.ok(section(missing).includes(`${label}:</strong> --`), `${label} must show -- when missing`);
  }
});

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
      endCustomer: { displayName: '<مشتری نهایی>', phone: '09120000000' }, revision: 1, actionUrl: '/private' },
    items: [{ description: '<سنگ>', quantity: '2', unitPrice: '6000000', totalPrice: '12000000', unit: 'count', details: ['تعداد: 2', 'لایه: دوبل · جلو'] }],
    technicalEvidenceAvailable: true, deliveries: [],
    receivables: [], taxRecords: [], flags: [],
    retailUnitPrice: 'PRIVATE_RETAIL_PRICE', customerPaymentPlan: 'PRIVATE_PAYMENT_PLAN',
  };
  const html = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
  assert.match(html, /طرف‌حساب سبلان: فروشنده همکار/);
  assert.match(html, /مشتری نهایی مرتبط: &lt;مشتری نهایی&gt;/);
  const customerSection = html.match(/<h2>مشخصات مشتری و پروژه<\/h2>([\s\S]*?)<\/section>/)?.[1] || '';
  assert.match(customerSection, /نام مشتری:<\/strong> &lt;مشتری نهایی&gt;/);
  assert.match(customerSection, /شماره تماس:<\/strong> ۰۹۱۲۰۰۰۰۰۰۰/);
  assert.match(customerSection, /نام برند\/شرکت:<\/strong> --/);
  assert.doesNotMatch(customerSection, /فروشنده همکار/);
  const noPhoneDocument = { ...document, partnerContext: { ...document.partnerContext,
    endCustomer: { displayName: document.partnerContext.endCustomer.displayName } } };
  const noPhoneHtml = renderPartnerInternalDocumentHtml(noPhoneDocument as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]);
  assert.match(noPhoneHtml, /شماره تماس:<\/strong> --/);
  assert.match(html, /&lt;سنگ&gt;/);
  assert.match(html, /لایه: دوبل · جلو/);
  assert.match(html, /۲/);
  assert.match(html, /برنامه پرداخت به سبلان هنوز ثبت نشده/);
  assert.match(html, /جمع خرید از سبلان: 120,000,000 ریال \(12,000,000 تومان\)/);
  assert.match(html, /class="sheet\s*"/);
  assert.match(html, /<th>نرخ - ریال<\/th>/);
  assert.match(html, /۶۰٬۰۰۰٬۰۰۰ ریال/);
  assert.match(html, /۱۲۰٬۰۰۰٬۰۰۰ ریال/);
  assert.equal(partnerInternalPrintInput(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0]).currency, 'تومان');
  assert.doesNotMatch(html, /PRIVATE_RETAIL_PRICE|PRIVATE_PAYMENT_PLAN|PC-secret|\/private/);
  for (const variant of ['original', 'accounting', 'workshop', 'custom'] as const) {
    const rendered = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0], { variant });
    assert.doesNotMatch(rendered, /PRIVATE_RETAIL_PRICE|PRIVATE_PAYMENT_PLAN|PC-secret|\/private/);
    const section = rendered.match(/<h2>مشخصات مشتری و پروژه<\/h2>([\s\S]*?)<\/section>/)?.[1];
    if (variant !== 'workshop') {
      assert.match(section || '', /نام مشتری:<\/strong> &lt;مشتری نهایی&gt;/);
      assert.match(section || '', /شماره تماس:<\/strong> ۰۹۱۲۰۰۰۰۰۰۰/);
      assert.doesNotMatch(section || '', /فروشنده همکار/);
    }
    if (variant === 'workshop') assert.doesNotMatch(rendered, /120000000|۱۲۰٬۰۰۰٬۰۰۰|۶۰٬۰۰۰٬۰۰۰/);
    else {
      assert.match(rendered, /<th>نرخ - ریال<\/th>/);
      assert.match(rendered, /۶۰٬۰۰۰٬۰۰۰ ریال/);
      assert.match(rendered, /جمع خرید از سبلان: 120,000,000 ریال \(12,000,000 تومان\)/);
    }
  }
  const custom = renderPartnerInternalDocumentHtml(document as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0], { variant: 'custom', customPrint: { showPrices: false, showTotals: false } });
  assert.doesNotMatch(custom, /120000000|۱۲۰٬۰۰۰٬۰۰۰|۶۰٬۰۰۰٬۰۰۰/);
});

test('frozen wholesale mandatory prints separately without repricing customer money or double charging the total', () => {
  const breakdown = { materialAmount: '18000000', componentAmount: '1000000', totalAmount: '22600000',
    mandatoryCharges: [{ subjectId: 'row-1', basisAmount: '18000000', percentage: '20', amount: '3600000' }] };
  const content = projectPartnerInternalContent({ partnerPreparation: {
    owner: { caseId: 'case-1', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` },
    products: [{ productRowId: 'row-1', description: 'اسلب', quantity: '18', unit: 'squareMeter',
      wholesaleUnitPrice: '1255555.5555555555556', wholesaleLineTotal: '22600000',
      wholesalePricing: breakdown, approvalEvidenceId: 'approval-1' }],
    totals: { net: '22600000', discount: '0', tax: '0', charges: '0', payable: '22600000', currency: 'IRT' },
    paymentPlan: { planId: 'plan-1', version: 1, effectiveDate: '2026-10-07', installments: [] },
  } });
  assert.deepEqual(content.items[0]?.wholesalePricing, breakdown);
  const document = { id: 'record-1', amount: '22600000', currency: 'IRT', createdAt: new Date('2026-10-07'),
    partnerContext: { customerContractNumber: '100001', internalRecordNumber: '100001', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' } },
    ...content, deliveries: [] } as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0];
  const html = renderPartnerInternalDocumentHtml(document);
  assert.match(html, /حکمی سبلان ۲۰٪/);
  assert.match(html, /۳۶٬۰۰۰٬۰۰۰ ریال/);
  assert.match(html, /۱۸۰٬۰۰۰٬۰۰۰ ریال/);
  assert.match(html, /۱۰٬۰۰۰٬۰۰۰ ریال/);
  assert.match(html, /جمع خرید از سبلان: 226,000,000 ریال \(22,600,000 تومان\)/);
  for (const options of [{ variant: 'workshop' as const }, { variant: 'custom' as const, customPrint: { showPrices: false, showTotals: false } }]) {
    assert.doesNotMatch(renderPartnerInternalDocumentHtml(document, options), /۳۶٬۰۰۰٬۰۰۰|۱۸۰٬۰۰۰٬۰۰۰|۱۰٬۰۰۰٬۰۰۰/);
  }
});

test('Partner delivery retains exact decimal quantities and the contracted unit in every PDF layout', () => {
  const document = { amount: '100', currency: 'IRT', createdAt: new Date('2026-10-11'),
    partnerContext: { customerContractNumber: '100347', internalRecordNumber: 'PI-100347', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' } },
    items: [{ productRowId: 'tread', description: 'کف پله', productType: 'stair', quantity: '15.4', unit: 'squareMeter', unitPrice: '1', totalPrice: '15.4' },
      { productRowId: 'riser', description: 'خیز', productType: 'stair', quantity: '9.2575', unit: 'squareMeter', unitPrice: '1', totalPrice: '9.2575' }],
    deliveries: [{ date: '2026-10-12', destination: 'محلی', items: [{ productRowId: 'tread', quantity: '15.4' }, { productRowId: 'riser', quantity: '9.2575' }] }]
  } as unknown as Parameters<typeof renderPartnerInternalDocumentHtml>[0];
  for (const variant of ['original', 'accounting', 'custom', 'workshop'] as const) {
    const html = renderPartnerInternalDocumentHtml(document, { variant });
    assert.match(html, /۱۵٫۴ متر مربع/);
    assert.match(html, /۹٫۲۵۷۵ متر مربع/);
    assert.doesNotMatch(html, /۱۵ عدد|۹ عدد/);
  }
});
