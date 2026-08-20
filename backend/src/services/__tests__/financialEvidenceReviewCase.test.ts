import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertGeneralFlagTransitionAllowed,
  financialEvidenceReviewActionUrl,
  presentFinancialEvidenceReviewCase,
} from '../financialEvidenceReviewCase';

const quantityCase = {
  id: 'case-quantity-1',
  contractId: 'contract-1',
  sourceFinancialRecordId: 'invoice-1',
  trackingCode: 'financial-evidence:invoice-1',
  title: 'نیازمند بررسی شواهد مالی',
  note: 'تأیید مالی تا رفع تعارض مسدود است.',
  status: 'OPEN',
  severity: 'BLOCKER',
  createdBy: 'accountant-1',
  evidence: {
    code: 'FINANCIAL_EVIDENCE_CONFLICT',
    reviewKind: 'QUANTITY',
    remediationKind: 'RESPONSIBLE_SELLER_CORRECTION',
    createdActorId: 'accountant-1',
    userMessageFa: 'کمیت قطعات ثبت‌شده با کمیت کل قرارداد سازگار نیست.',
    structuredEvidence: {
      productRowId: 'product-row-1',
      rule: 'CONTRACT_PRODUCT_GRAPH_V2_SCALE_THREE_PERSISTENCE',
      rawOptimizerQuantity: '10.125',
      transformedOptimizerQuantity: '10.125',
      rawProductionQuantity: '10.124',
      transformedProductionQuantity: '10.124',
      rawCanonicalGraphQuantity: '10.125',
      transformedCanonicalGraphQuantity: '10.125',
      difference: '-0.001',
      unit: 'meter',
      rawPersistedDeliveryRows: [
        { deliveryId: 'delivery-1', deliveryProductId: 'delivery-product-1', rawQuantity: '10.125', transformedQuantity: '10.125' },
      ],
    },
  },
  createdAt: new Date('2026-08-20T08:00:00.000Z'),
  updatedAt: new Date('2026-08-20T08:00:00.000Z'),
};

test('financial evidence review deep-link identifies the exact case', () => {
  assert.equal(
    financialEvidenceReviewActionUrl('contract-1', 'case-quantity-1'),
    '/dashboard/accounting/contracts/contract-1/financial-evidence-reviews/case-quantity-1',
  );
});

test('quantity review presentation exposes exact witnesses and a guided source correction', () => {
  const result = presentFinancialEvidenceReviewCase(
    quantityCase,
    actorId => actorId === 'accountant-1' ? 'حسابدار آزمون' : actorId,
  );

  assert.equal(result.kind, 'QUANTITY');
  assert.equal(result.primaryAction.kind, 'OPEN_SALES_CONTRACT');
  assert.equal(result.primaryAction.href, '/dashboard/sales/contracts/contract-1');
  assert.equal(result.canRetryReconciliation, true);
  assert.deepEqual(result.witnesses, [
    { source: 'OPTIMIZER_TOTAL', labelFa: 'کمیت کل optimizer', rawValue: '10.125', transformedValue: '10.125', unit: 'متر' },
    { source: 'OPTIMIZER_PRODUCTION', labelFa: 'جمع قطعات تولیدی optimizer', rawValue: '10.124', transformedValue: '10.124', unit: 'متر' },
    { source: 'PRODUCT_GRAPH', labelFa: 'کمیت Product Graph', rawValue: '10.125', transformedValue: '10.125', unit: 'متر' },
    { source: 'DELIVERY', labelFa: 'تحویل ثبت‌شده 1', rawValue: '10.125', transformedValue: '10.125', unit: 'متر', referenceId: 'delivery-product-1' },
  ]);
  assert.deepEqual(result.differences, [{ labelFa: 'اختلاف دقیق', value: '-0.001', unit: 'متر' }]);
  assert.match(result.guidance, /فروشنده مسئول/);
  assert.equal(result.audit.createdBy, 'حسابدار آزمون');
  assert.deepEqual(result.checklist.map(item => item.labelFa), [
    'فروشنده مسئول از صفحه قرارداد فروش، درخواست اصلاح را ثبت و گردش تأیید را کامل کند',
    'حسابداری پیش‌فاکتور ناسازگار را با دکمه «حذف پیش‌نویس» حذف کند',
    'پس از اعمال اصلاح مبدأ، پیش‌فاکتور تازه ایجاد شود',
    'شواهد پیش‌فاکتور تازه بازآزمایی و تأیید مالی دوباره اجرا شود',
  ]);
});

test('a case retired with its stale draft does not claim that financial approval is ready', () => {
  const result = presentFinancialEvidenceReviewCase({
    ...quantityCase,
    status: 'RESOLVED',
    evidence: { ...quantityCase.evidence, resolutionMode: 'SOURCE_DRAFT_RETIRED' },
    resolutionNote: 'پیش‌فاکتور ناسازگار حذف شد. این پرونده فقط برای همان پیش‌فاکتور بسته شد.',
  });

  assert.equal(result.resolutionMode, 'SOURCE_DRAFT_RETIRED');
  assert.equal(result.readyForFinancialApproval, false);
  assert.equal(result.primaryAction.kind, 'OPEN_ACCOUNTING_CONTRACT');
  assert.match(result.primaryAction.labelFa, /پیش‌فاکتور تازه/);
});

test('a legacy generic resolution remains unverified and cannot claim approval readiness', () => {
  const result = presentFinancialEvidenceReviewCase({
    ...quantityCase,
    status: 'RESOLVED',
    resolvedBy: 'legacy-manager',
    resolvedAt: new Date('2026-08-19T08:00:00.000Z'),
    resolutionNote: 'بستن عمومی قدیمی',
  });

  assert.equal(result.resolutionMode, 'LEGACY_UNVERIFIED');
  assert.equal(result.readyForFinancialApproval, false);
});

test('only a marked successful evidence recheck can claim approval readiness', () => {
  const result = presentFinancialEvidenceReviewCase({
    ...quantityCase,
    status: 'RESOLVED',
    evidence: {
      ...quantityCase.evidence,
      resolutionMode: 'RECONCILED_BY_EVIDENCE_RECHECK',
      reconciledApprovedPricingVersionId: 'pricing-version-2',
      reconciledApprovedPricingIntegrityHash: 'sha256-example',
    },
  });

  assert.equal(result.resolutionMode, 'RECONCILED_BY_EVIDENCE_RECHECK');
  assert.equal(result.readyForFinancialApproval, true);
});

test('financial evidence review cannot be closed or cancelled as a generic flag', () => {
  assert.throws(
    () => assertGeneralFlagTransitionAllowed(quantityCase),
    /پرونده بررسی شواهد مالی فقط پس از بازآزمایی موفق بسته می‌شود/,
  );
});
