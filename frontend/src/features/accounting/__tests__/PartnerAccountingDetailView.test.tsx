import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PartnerAccountingDetailView, type PartnerInternalDocument, type PartnerDetailSection } from '../PartnerAccountingDetailView';
const noop = () => {};
const doc: PartnerInternalDocument = {
  id: 'internal-invoice', caseState: 'COMMITTED', status: 'DRAFT', amount: '12000000', currency: 'IRT',
  receivedAmount: '0', remainingAmount: '12000000', systemInvoiceNumber: null,
  actions: { canOpenEdit: true, canCreateInvoice: true, canResolveFlag: false, canFlag: false, canRequestCorrection: false, canReviewInvoice: false, canCreateReceivable: false },
  partnerContext: { caseId: 'case-1', caseNumber: 'PC-secret', trackingNumber: 27, customerContractNumber: '100330',
    internalRecordNumber: 'PI-100330', debtor: { displayName: 'همکار آزمایشی' }, endCustomer: { displayName: 'مشتری نهایی' } },
  items: [{ productRowId: 'row-1', description: 'سنگ تست', quantity: '3', unit: 'count', unitPrice: '4000000', totalPrice: '12000000', details: ['لایه دوبل · جلو'] }],
  receivables: [], taxRecords: [], flags: [],
};
const render = (section: PartnerDetailSection, invoiceOpen = false) => renderToStaticMarkup(<AppRouterContext.Provider value={{ back: noop, forward: noop, refresh: noop, push: noop, replace: noop, prefetch: async () => {} }}>
  <PartnerAccountingDetailView document={{ ...doc, ...{ retailPrice: 'PRIVATE_CUSTOMER_PRICE', customerPaymentPlan: 'PRIVATE_PLAN' } }}
    section={section} invoiceOpen={invoiceOpen} onOpenInvoice={noop} onApproveInvoice={noop} onSection={noop} pending={false} onRefresh={noop} onPdf={noop} onFlag={noop} onCorrection={noop} onResolve={noop} />
</AppRouterContext.Provider>);
test('all Partner sections share Accounting metrics/tabs and exclude customer pricing', () => {
  for (const section of ['summary', 'items', 'financial', 'collections', 'compliance'] as const) {
    const html = render(section);
    for (const label of ['مبلغ قرارداد', 'صورتحساب شده', 'دریافت شده', 'مانده', 'خلاصه', 'اقلام', 'رکوردهای مالی', 'دریافت‌ها', 'مالیات و اصلاحات']) assert(html.includes(label), label);
    assert.doesNotMatch(html, /PRIVATE_CUSTOMER_PRICE|PRIVATE_PLAN/);
  }
  assert.match(render('items'), /لایه دوبل · جلو/);
  assert.match(render('summary'), /چاپ حسابداری|دانلود PDF/);
});
test('committed case never exposes ordinary hard-delete or duplicate invoice creation', () => {
  const html = render('summary');
  assert.doesNotMatch(html, /درخواست مجوز ویرایش و لغو/);
  assert.doesNotMatch(html, /غیرفعال‌سازی<\/span>|حذف دائمی<\/span>/);
  assert.equal((html.match(/درخواست اصلاح<\/span>/g) || []).length, 1);
  assert.match(html, /پیش‌نویس سند داخلی برای ثبت رکورد مالی باز می‌شود/);
  assert.doesNotMatch(html, /بررسی صورتحساب/);
  for (const label of ['چاپ نسخه اصلی', 'چاپ حسابداری', 'چاپ نمره کارگاه', 'چاپ سفارشی']) assert(html.includes(label));
  assert.match(render('collections'), /دریافتنی ثبت نشده است/);
  assert.match(render('compliance'), /پرونده مالیاتی هنوز ایجاد نشده است/);
});
test('draft action stays on the contract and opens the canonical inline financial form', () => {
  const closed = render('financial');
  const links = Array.from(closed.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)).map(match => match[0]);
  assert(!links.some(link => link.includes('ایجاد پیش‌نویس صورتحساب')));
  const opened = render('financial', true);
  for (const label of ['شماره فاکتور سیستمی', 'تاریخ فاکتور سیستمی', 'مبلغ سپیدار', 'تایید مالی']) assert(opened.includes(label), label);
  assert.doesNotMatch(opened, /PRIVATE_CUSTOMER_PRICE|PRIVATE_PLAN/);
});
