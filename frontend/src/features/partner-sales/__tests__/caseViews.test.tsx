import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCaseDetailContent, partnerCaseMetrics } from '../cases/PartnerCaseDetail';
import { ErpMetricGrid } from '@/components/erp';
import { PartnerAccountPanel } from '../account/PartnerAccountPanel';
import { PartnerReportContent, partnerReportPrimaryAction, type PartnerReportPresentation } from '../reports/PartnerReportView';
import { RetailCollectionsPanel, type RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import { PartnerCorrectionPanel } from '../cases/PartnerCorrectionPanel';

test('Partner case detail separates retail, wholesale and margin without exposing the internal record', () => {
  const fixture = createPartnerFixtures();
  const html = renderToStaticMarkup(<><ErpMetricGrid items={partnerCaseMetrics(fixture.partner)} /><PartnerCaseDetailContent view={fixture.partner} actions={{
    canPreview: true, canIssue: true, canSendConfirmation: true, canRequestCorrection: true, canCancel: true, canRequestVoid: false,
  }} /></>);
  assert.match(html, /فروش به مشتری/);
  assert.match(html, /خرید از سبلان/);
  assert.match(html, /سود بازفروش/);
  assert.match(html, /پیش‌نمایش/);
  assert.match(html, /صدور نهایی/);
  assert.match(html, /ارسال دوباره کد تأیید/);
  assert.doesNotMatch(html, /FIXTURE-INTERNAL-313|شماره سند داخلی|approvalEvidenceId|commercialAccountId/);
});

test('private retail collection keeps historical plans visible and explains independent debt', () => {
  const fixture = createPartnerFixtures();
  const history: RetailCollectionHistory = {
    currentPlan: fixture.partner.customerPaymentPlan,
    historicalPlans: [{ ...fixture.partner.customerPaymentPlan, planId: 'fixture-old-plan', version: 1 }],
    receipts: [{ receiptId: 'receipt-1', planId: 'fixture-old-plan', amount: { amount: '500', currency: 'IRR' },
      effectiveDate: '2026-08-28', status: 'REVERSED' }],
    collected: { amount: '500', currency: 'IRR' }, balance: { amount: '1500', currency: 'IRR' },
  };
  const html = renderToStaticMarkup(<RetailCollectionsPanel history={history} canRecord />);
  assert.match(html, /برنامه‌های تاریخی/);
  assert.match(html, /برگشت‌خورده/);
  assert.match(html, /بدهی شما به سبلان را تغییر نمی‌دهد/);
  assert.doesNotMatch(html, /Accounting|Sepidar|شماره سند داخلی/);
});

test('account panel is read-only and contains only accounting-backed partner-safe facts', () => {
  const fixture = createPartnerFixtures();
  const purchase = { owner: fixture.partner.owner, caseNumber: fixture.partner.caseNumber,
    amount: { amount: '1600', currency: 'IRR' as const }, sabalanPaymentPlan: fixture.partner.sabalanPaymentPlan,
    received: { amount: '600', currency: 'IRR' as const }, balance: { amount: '1000', currency: 'IRR' as const },
    status: 'PARTIALLY_PAID' as const };
  const tomanPurchase = { ...purchase, owner: { ...purchase.owner, revision: 2 }, caseNumber: 'CASE-IRT',
    amount: { amount: '200', currency: 'IRT' as const }, received: { amount: '50', currency: 'IRT' as const }, balance: { amount: '150', currency: 'IRT' as const } };
  const html = renderToStaticMarkup(<PartnerAccountPanel view={{ ...fixture.account, purchases: [purchase, tomanPurchase] }} />);
  assert.match(html, /حساب من با سبلان/);
  assert.match(html, /فقط‌خواندنی/);
  assert.match(html, /FIXTURE-CASE-313/);
  assert.match(html, /CASE-IRT/);
  assert.match(html, /تومان/);
  assert.match(html, /برنامه پرداخت به سبلان/);
  assert.match(html, /سررسید 2026-08-28/);
  assert.doesNotMatch(html, /قیمت مشتری|سود بازفروش|یادداشت حسابداری|Sepidar|ثبت دریافت/);
});

test('Concept C report keeps the two economic truths distinct and exposes scoped export', () => {
  const report: PartnerReportPresentation = {
    scopeLabel: 'فقط اطلاعات حساب من', from: '2026-08-01', effectiveThrough: '2026-08-29',
    totals: [
      { currency: 'IRR', metrics: { retailSales: '2000', retailCollected: '500', wholesalePurchases: '1600', netComparableMargin: '400' }, accountingBalance: '1000', accountingReceivedAsOf: '2026-08-29', accountingCovered: 1, accountingEligible: 1 },
      { currency: 'IRT', metrics: { retailSales: '3000', retailCollected: null, wholesalePurchases: '2200', netComparableMargin: null }, accountingBalance: null, accountingReceivedAsOf: null, accountingCovered: 0, accountingEligible: 1 },
    ],
    rows: [{ caseId: 'case-332', revision: 3, caseNumber: 'CASE-332', customerContractNumber: 'CUSTOMER-332', state: 'COMMITTED', currency: 'IRR',
      metrics: { retailSales: '2000', retailCollected: '500', wholesalePurchases: '1600', netComparableMargin: '400' }, collectionStatus: 'PARTIAL',
      history: { receiptCount: 2, revisionCount: 3, superseded: true, cancelled: false } }],
  };
  const html = renderToStaticMarkup(<PartnerReportContent report={report} onOpenCase={() => undefined} />);
  assert.match(html, /فروش من/);
  assert.match(html, /خرید از سبلان/);
  assert.match(html, /سود بازفروش من/);
  assert.match(html, /درآمد سبلان نیست/);
  assert.match(html, /نسخه جایگزین‌شده/);
  assert.match(html, /پوشش حسابداری در دسترس نیست/);
  assert.match(html, /داده معتبر در دسترس نیست/);
  assert.match(html, /مشاهده پرونده/);
  assert.doesNotMatch(html, /href="\/dashboard\/sales\/contracts\/case-332"/);
  assert.equal(partnerReportPrimaryAction(true)?.label, 'خروجی همین محدوده');
  assert.match(html, /تومان/);
  assert.doesNotMatch(html, /internalRecordNumber|شماره سند داخلی|یادداشت حسابداری/);
});

test('non-retail correction scopes never expose Partner-authored retail controls', () => {
  const fixture = createPartnerFixtures();
  const html = renderToStaticMarkup(<PartnerCorrectionPanel view={fixture.partner} correction={{
    opportunityId: 'opportunity-shared', status: 'APPROVED_TO_EDIT', scope: 'SHARED', saved: false, editableCustomerInstallmentIds: [],
  }} pending={false} onRequest={() => undefined} onSave={() => assert.fail('shared scope must not save retail fields')} />);
  assert.match(html, /وضعیت اصلاح پرونده/);
  assert.doesNotMatch(html, /ذخیره نهایی اصلاح|برنامه پرداخت مشتری/);
});

test('approved retail correction makes its deadline, one-save rule and fresh confirmation explicit', () => {
  const fixture = createPartnerFixtures();
  const html = renderToStaticMarkup(<PartnerCorrectionPanel view={fixture.partner} correction={{
    opportunityId: 'opportunity-332', status: 'APPROVED_TO_EDIT', scope: 'RETAIL_ONLY', expiresAt: '2026-09-02T12:00:00.000Z', saved: false,
    editableCustomerInstallmentIds: [fixture.partner.customerPaymentPlan.installments[0].installmentId],
  }} pending={false} onRequest={() => undefined} onSave={() => undefined} />);
  assert.match(html, /اصلاح قیمت فروش و پرداخت مشتری/);
  assert.match(html, /فقط یک‌بار ذخیره/);
  assert.match(html, /تأیید دوباره مشتری/);
  assert.match(html, /ذخیره نهایی اصلاح/);
  assert.match(html, /برنامه پرداخت آینده مشتری/);
  assert.match(html, /نسخه جانشین/);
  assert.doesNotMatch(html, /حسابداری|شماره سند داخلی|قیمت تأییدشده سبلان/);
});
