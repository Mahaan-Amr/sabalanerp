import type { DispatchDocumentRenderData } from './dispatchDocumentPdf';

const base = {
  schemaVersion: 1 as const,
  templateVersion: 'dispatch-v1',
  issuedAt: '2026-08-09T08:30:00.000Z',
  customerName: 'شرکت سنگ‌آرای سپید سبلان',
  projectOrDestination: 'پروژه مجتمع اداری نیایش ـ تهران، بلوار آفریقا',
  vehiclePlate: 'ایران ۱۱ ـ ۴۲ب ـ ۳۶۵',
};

const statementLine = (index: number, label = 'سنگ تراورتن عباس‌آباد شامل خدمات متصل') => ({
  contractItemId: `contract-item-${index}`,
  productRowId: `product-row-${index}`,
  label,
  unit: 'متر مربع',
  quantity: '12.375',
  grossAmount: '123456789012.500000000000',
  allocatedDiscount: '3456789.500000000000',
  netAmount: '123453332223.000000000000',
});

const statement = (
  name: string,
  counts: number[],
  overrides: Partial<Pick<typeof base, 'customerName' | 'projectOrDestination'>> = {},
): DispatchDocumentRenderData => ({
  ...base,
  ...overrides,
  documentId: name,
  waybillNumber: `۱۴۰۵-${String(42 + counts.reduce((sum, count) => sum + count, 0)).padStart(4, '۰')}`,
  kind: 'STATEMENT',
  payload: {
    currency: 'ریال',
    contracts: counts.map((count, contractIndex) => ({
      contractId: `contract-${contractIndex + 1}`,
      contractNumber: `SC-${10042 + contractIndex}`,
      lines: Array.from({ length: count }, (_, lineIndex) => statementLine(
        contractIndex * 100 + lineIndex + 1,
        lineIndex === 0 && overrides.projectOrDestination
          ? 'سنگ تراورتن موج‌دار ممتاز با ابزار لبه، پرداخت چرمی و خدمات متصل به ردیف محصول'
          : undefined,
      )),
      grossAmount: '1234567890125.000000000000',
      allocatedDiscount: '34567895.000000000000',
      netAmount: '1234533322230.000000000000',
    })),
    grossAmount: '2469135780250.000000000000',
    allocatedDiscount: '69135790.000000000000',
    netAmount: '2469066644460.000000000000',
  },
});

const adjustment = (name: string, sequence: number, sign: '' | '-' | '+'): DispatchDocumentRenderData => ({
  ...base,
  documentId: name,
  waybillNumber: '۱۴۰۵-۰۰۴۲',
  kind: 'STATEMENT_ADJUSTMENT',
  payload: {
    sequence,
    originalStatementDocumentId: 'statement-ordinary',
    reason: sign === '-' ? 'اصلاح مقدار تحویل‌شده بر پایه سند بازگشت تأییدشده' : 'اصلاح مقدار قطعی ثبت‌شده برای محموله',
    currency: 'ریال',
    lines: [{
      contractId: 'contract-1',
      contractItemId: 'contract-item-1',
      productRowId: 'product-row-1',
      label: 'سنگ تراورتن عباس‌آباد شامل خدمات متصل',
      unit: 'متر مربع',
      quantityDelta: `${sign}1.250`,
      grossAmountDelta: `${sign}1200000.000000000000`,
      discountDelta: `${sign}50000.000000000000`,
      netAmountDelta: `${sign}1150000.000000000000`,
    }],
    grossAmountDelta: `${sign}1200000.000000000000`,
    discountDelta: `${sign}50000.000000000000`,
    netAmountDelta: `${sign}1150000.000000000000`,
  },
});

const reattribution: DispatchDocumentRenderData = {
  ...base,
  documentId: 'adjustment-reattribution',
  waybillNumber: '۱۴۰۵-۰۰۴۲',
  kind: 'STATEMENT_ADJUSTMENT',
  payload: {
    sequence: 3,
    originalStatementDocumentId: 'statement-ordinary',
    reason: 'اصلاح انتساب ردیف قرارداد با حفظ مقدار خالص محموله',
    currency: 'ریال',
    lines: [
      { contractId: 'contract-1', contractItemId: 'item-source', productRowId: 'row-source', label: 'ردیف مبدأ ـ سنگ تراورتن', unit: 'متر مربع', quantityDelta: '-2.000', grossAmountDelta: '-2000000.000000000000', discountDelta: '-100000.000000000000', netAmountDelta: '-1900000.000000000000' },
      { contractId: 'contract-1', contractItemId: 'item-target', productRowId: 'row-target', label: 'ردیف مقصد ـ سنگ تراورتن', unit: 'متر مربع', quantityDelta: '+2.000', grossAmountDelta: '+2000000.000000000000', discountDelta: '+100000.000000000000', netAmountDelta: '+1900000.000000000000' },
    ],
    grossAmountDelta: '0.000000000000',
    discountDelta: '0.000000000000',
    netAmountDelta: '0.000000000000',
  },
};

const ordinaryStatement = statement('statement-ordinary', [4]);
const ordinaryWaybill: DispatchDocumentRenderData = {
  ...base,
  documentId: 'waybill-ordinary',
  waybillNumber: ordinaryStatement.waybillNumber,
  kind: 'WAYBILL',
  payload: {
    allocationRevisionId: 'allocation-revision-ordinary',
    contracts: ordinaryStatement.kind === 'STATEMENT'
      ? ordinaryStatement.payload.contracts.map((contract) => ({
        contractId: contract.contractId,
        contractNumber: contract.contractNumber,
        lines: contract.lines.map(({ contractItemId, productRowId, label, unit, quantity }) => ({ contractItemId, productRowId, label, unit, quantity })),
      }))
      : [],
  },
};

export const dispatchDocumentVisualFixtures: ReadonlyArray<{
  name: string;
  expectedPages: number;
  input: DispatchDocumentRenderData;
}> = [
  { name: 'waybill-ordinary', expectedPages: 1, input: ordinaryWaybill },
  { name: 'statement-ordinary', expectedPages: 1, input: ordinaryStatement },
  { name: 'statement-boundary-one-page', expectedPages: 1, input: statement('statement-boundary-one-page', [12]) },
  { name: 'statement-continuation', expectedPages: 2, input: statement('statement-continuation', [30]) },
  { name: 'statement-multi-contract', expectedPages: 1, input: statement('statement-multi-contract', [3, 3]) },
  { name: 'statement-long-persian', expectedPages: 1, input: statement('statement-long-persian', [5], { customerName: 'شرکت توسعه و فرآوری سنگ‌های ساختمانی و تزئینی آذربایجان شرقی', projectOrDestination: 'پروژه بازآفرینی مجموعه فرهنگی تاریخی در خیابان استاد شهریار، ورودی ضلع جنوب‌غربی' }) },
  { name: 'statement-large-decimal', expectedPages: 1, input: statement('statement-large-decimal', [2]) },
  { name: 'adjustment-positive', expectedPages: 1, input: adjustment('adjustment-positive', 1, '+') },
  { name: 'adjustment-negative', expectedPages: 1, input: adjustment('adjustment-negative', 2, '-') },
  { name: 'adjustment-reattribution', expectedPages: 1, input: reattribution },
];

export const dispatchPrintBothFixture = {
  name: 'print-both-ordered',
  inputs: [ordinaryWaybill, ordinaryStatement] as const,
};
