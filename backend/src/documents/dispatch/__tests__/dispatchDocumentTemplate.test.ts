import assert from 'node:assert/strict';
import {
  renderDispatchDocumentHtml,
  type DispatchDocumentRenderData,
} from '../dispatchDocumentPdf';

const common = {
  schemaVersion: 1,
  documentId: 'document-1',
  templateVersion: 'dispatch-v1',
  waybillNumber: 'WB-1405-0042',
  issuedAt: '2026-08-09T08:30:00.000Z',
  customerName: 'شرکت سنگ‌آرای سپید سبلان',
  projectOrDestination: 'تهران، بلوار آفریقا، پروژه مجتمع اداری نیایش',
  vehiclePlate: 'ایران ۱۱ ـ ۴۲ب ـ ۳۶۵',
} as const;

const statement: DispatchDocumentRenderData = {
  ...common,
  kind: 'STATEMENT',
  payload: {
    currency: 'ریال',
    contracts: [{
      contractId: 'contract-1',
      contractNumber: 'SC-10042',
      lines: [{
        contractItemId: 'contract-item-1',
        productRowId: 'row-stable-1',
        label: 'سنگ تراورتن عباس‌آباد شامل خدمات متصل',
        quantity: '12.375',
        unit: 'متر مربع',
        grossAmount: '123456789012.500000000000',
        allocatedDiscount: '3456789.500000000000',
        netAmount: '123453332223.000000000000',
      }],
      grossAmount: '123456789012.500000000000',
      allocatedDiscount: '3456789.500000000000',
      netAmount: '123453332223.000000000000',
    }],
    grossAmount: '123456789012.500000000000',
    allocatedDiscount: '3456789.500000000000',
    netAmount: '123453332223.000000000000',
  },
};

const statementHtml = renderDispatchDocumentHtml(statement, {
  logoDataUri: 'data:image/jpeg;base64,official-logo',
  fontFacesCss: "@font-face{font-family:'Yekan Bakh';src:url(data:font/woff2;base64,regular)}",
});
assert.match(statementHtml, /<html lang="fa" dir="rtl">/);
assert.match(statementHtml, /data:image\/jpeg;base64,official-logo/);
assert.match(statementHtml, /Yekan Bakh/);
assert.match(statementHtml, /صورت‌حساب محموله مشتری/);
assert.match(statementHtml, /WB-1405-0042/);
assert.match(statementHtml, /SC-10042/);
assert.match(statementHtml, /row-stable-1/);
assert.match(statementHtml, /شامل خدمات متصل/);
assert.match(statementHtml, /<thead>/);
assert.match(statementHtml, /display:\s*table-header-group/);
assert.ok(statementHtml.indexOf('جمع کل محموله') > statementHtml.indexOf('</table>'));
assert.doesNotMatch(statementHtml, /مانده مشتری|سوابق پرداخت|سپیدار|امضا|مهر|مالیات بر ارزش افزوده/);

const waybillHtml = renderDispatchDocumentHtml({
  ...common,
  kind: 'WAYBILL',
  payload: {
    allocationRevisionId: 'allocation-revision-1',
    contracts: statement.payload.contracts.map(({ contractId, contractNumber, lines }) => ({
      contractId,
      contractNumber,
      lines: lines.map(({ contractItemId, productRowId, label, quantity, unit }) => ({
        contractItemId, productRowId, label, quantity, unit,
      })),
    })),
  },
});
assert.match(waybillHtml, /بارنامه خروج محموله/);
assert.doesNotMatch(waybillHtml, /مبلغ ناخالص|تخفیف تخصیص‌یافته|مبلغ خالص|ریال/);

const adjustmentHtml = renderDispatchDocumentHtml({
  ...common,
  kind: 'STATEMENT_ADJUSTMENT',
  payload: {
    sequence: 2,
    originalStatementDocumentId: 'statement-1',
    reason: 'اصلاح وزن ثبت‌شده پس از خروج',
    currency: 'ریال',
    lines: [{
      contractId: 'contract-1',
      contractItemId: 'contract-item-1',
      productRowId: 'row-stable-1',
      label: 'سنگ تراورتن عباس‌آباد شامل خدمات متصل',
      quantityDelta: '-1.250',
      unit: 'متر مربع',
      grossAmountDelta: '-1200000.000000000000',
      discountDelta: '50000.000000000000',
      netAmountDelta: '-1150000.000000000000',
    }],
    grossAmountDelta: '-1200000.000000000000',
    discountDelta: '50000.000000000000',
    netAmountDelta: '-1150000.000000000000',
  },
});
assert.match(adjustmentHtml, /WB-1405-0042 \/ اصلاحیه ۲/);
assert.match(adjustmentHtml, /−۱٫۲۵۰/);
assert.match(adjustmentHtml, /جمع خالص اصلاحیه/);
assert.doesNotMatch(adjustmentHtml, /row-stable-2|جمع کل محموله/);

const positiveAdjustmentHtml = renderDispatchDocumentHtml({
  ...common,
  kind: 'STATEMENT_ADJUSTMENT',
  payload: {
    sequence: 3,
    originalStatementDocumentId: 'statement-1',
    reason: 'افزایش مقدار قطعی محموله',
    currency: 'ریال',
    lines: [{
      contractId: 'contract-1', contractItemId: 'contract-item-1', productRowId: 'row-stable-1',
      label: 'سنگ تراورتن عباس‌آباد شامل خدمات متصل', unit: 'متر مربع', quantityDelta: '+1.250',
      grossAmountDelta: '+1200000.000000000000', discountDelta: '+50000.000000000000', netAmountDelta: '+1150000.000000000000',
    }],
    grossAmountDelta: '+1200000.000000000000',
    discountDelta: '+50000.000000000000',
    netAmountDelta: '+1150000.000000000000',
  },
});
assert.match(positiveAdjustmentHtml, /\+۱٬۱۵۰٬۰۰۰/);

console.log('Dispatch document HTML template tests passed.');
