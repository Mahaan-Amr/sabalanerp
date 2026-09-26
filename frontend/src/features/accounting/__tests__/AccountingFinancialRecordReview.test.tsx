import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingFinancialRecordReview } from '../AccountingFinancialRecordReview';

test('partner financial review shows Sabalan amount, settlement, tax and history before approval', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{
      id: 'partner-financial-1', sourceKind: 'PARTNER_INTERNAL_RECORD', status: 'DRAFT',
      amount: '1200000', currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z',
      partnerContext: { caseNumber: 'پرونده ۱۴۰۵/۱۲', internalRecordNumber: 'PI-17',
        debtor: { displayName: 'فروشنده همکار' } },
      invoiceItems: [{ id: 'line-1', description: 'اسلب سنگ', quantity: '2', totalPrice: '1200000' }],
      receivables: [{ id: 'debt-1', originalAmount: '1200000', paidAmount: '300000',
        remainingAmount: '900000', status: 'PARTIALLY_PAID',
        paymentStatuses: [{ id: 'payment-1', amount: '300000', status: 'RECEIVED', method: 'BANK_TRANSFER' }] }],
      taxRecords: [{ id: 'tax-1', submissionStatus: 'NOT_READY', vatAmount: '120000' }],
    }}
    auditRows={[{ id: 'audit-1', action: 'APPROVE_FINANCIAL_INVOICE', createdAt: '2026-09-21T10:00:00.000Z' }]}
    canApprove={false}
    showAccountingDetails={false}
    onApprove={async () => {}}
  />);
  assert.match(html, /پرونده ۱۴۰۵\/۱۲/);
  assert.match(html, /فروشنده همکار/);
  assert.match(html, /۱٬۲۰۰٬۰۰۰/);
  assert.match(html, /دریافت‌ها و مانده/);
  assert.match(html, /۹۰۰٬۰۰۰/);
  assert.match(html, /وضعیت مالیات/);
  assert.match(html, /تاریخچه/);
  assert.doesNotMatch(html, /شماره فاکتور سیستمی/);
  assert.doesNotMatch(html, /partner-financial-1/);
});

test('contract money retains its original toman unit in the review', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'ordinary-1', sourceKind: 'SALES_CONTRACT', status: 'DRAFT', amount: '1000',
      currency: 'تومان', createdAt: '2026-09-20T10:00:00.000Z',
      contract: { contractNumber: '۱۰۲', customer: { displayName: 'مشتری نمونه' } } }}
    auditRows={[]} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /۱٬۰۰۰ تومان/);
  assert.doesNotMatch(html, /۱٬۰۰۰ ریال/);
});

test('large rial and toman strings keep every digit in the review', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'large-amount', sourceKind: 'SALES_CONTRACT', status: 'DRAFT',
      amount: '9007199254740993', currency: 'تومان', createdAt: '2026-09-20T10:00:00.000Z' }}
    auditRows={[]} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ تومان/);
});

test('partner witness products remain visible when no invoice items exist', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'partner-2', sourceKind: 'PARTNER_INTERNAL_RECORD', status: 'DRAFT', amount: '9000',
      currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z',
      sourceSnapshot: { partnerPreparation: { products: [{ productRowId: 'row-1',
        description: 'سنگ تراورتن', quantity: '1.25', unit: 'meter' }] } } }}
    auditRows={[]} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /سنگ تراورتن/);
  assert.match(html, /۱٫۲۵ متر/);
  assert.doesNotMatch(html, /meter/);
});

test('multiple receivables are not summed with floating-point arithmetic', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'financial-3', sourceKind: 'SALES_CONTRACT', status: 'DRAFT', amount: '9000',
      currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z', receivables: [
        { id: 'r1', originalAmount: '0.1', paidAmount: '0', remainingAmount: '0.1', status: 'OPEN' },
        { id: 'r2', originalAmount: '0.2', paidAmount: '0', remainingAmount: '0.2', status: 'OPEN' },
      ] }} auditRows={[]} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /مانده هر دریافتنی در پایین آمده است/);
  assert.doesNotMatch(html, /0\.30000000000000004/);
});

test('received count excludes expected and reversed payment statuses', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'payment-count', sourceKind: 'SALES_CONTRACT', status: 'DRAFT', amount: '1000',
      currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z', receivables: [{ id: 'r1',
        originalAmount: '1000', paidAmount: '300', remainingAmount: '700', status: 'PARTIALLY_PAID',
        paymentStatuses: [
          { id: 'p1', amount: '300', method: 'CASH', status: 'RECEIVED' },
          { id: 'p2', amount: '400', method: 'CHECK', status: 'EXPECTED' },
          { id: 'p3', amount: '100', method: 'CASH', status: 'REVERSED' },
        ] }] }} auditRows={[]} canApprove={false} showAccountingDetails onApprove={async () => {}}
  />);
  assert.match(html, /تعداد دریافت‌های ثبت‌شده.*?۱/s);
});

test('large exact quantities are displayed without Number coercion', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'quantity', sourceKind: 'SALES_CONTRACT', status: 'DRAFT', amount: '1000',
      currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z', invoiceItems: [{ id: 'item',
        description: 'سنگ', quantity: '9007199254740993.25', totalPrice: '1000' }] }}
    auditRows={[]} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /۹۰۰۷۱۹۹۲۵۴۷۴۰۹۹۳٫۲۵/);
});

test('partial audit history is labelled with a visible total', () => {
  const html = renderToStaticMarkup(<AccountingFinancialRecordReview
    record={{ id: 'audit', sourceKind: 'SALES_CONTRACT', status: 'DRAFT', amount: '1000',
      currency: 'IRR', createdAt: '2026-09-20T10:00:00.000Z' }}
    auditRows={[{ id: 'a1', action: 'CREATE_INVOICE', createdAt: '2026-09-20T10:00:00.000Z', note: 'Internal note' }]}
    auditTotal={2} onLoadMoreAudit={() => {}} canApprove={false} showAccountingDetails={false} onApprove={async () => {}}
  />);
  assert.match(html, /۱ رویداد از ۲ رویداد/);
  assert.match(html, /نمایش رویدادهای پیشین/);
  assert.doesNotMatch(html, /Internal note/);
});
