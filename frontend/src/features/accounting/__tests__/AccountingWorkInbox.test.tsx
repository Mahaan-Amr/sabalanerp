import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingWorkInbox } from '../AccountingWorkInbox';
import type { AccountingContractRow } from '../accountingUi';

const row: AccountingContractRow = {
  contractId: 'contract-1', contractNumber: '۱۲۳', titlePersian: 'قرارداد فروش',
  customer: { displayName: 'مشتری نمونه' }, status: 'SIGNED',
  accounting: { sourceStatus: 'ELIGIBLE', eligibleForFinancialRecords: true,
    currency: 'IRR', invoiceStatus: 'DRAFT', receivableStatus: 'NONE', taxStatus: 'READY', openFlags: 0,
    openBlockerFlags: 0, openCorrections: 0, totalContractAmount: '9007199254740993',
    invoicedAmount: '0', receivedAmount: '1000', remainingAmount: '9007199254739993' },
  attention: { priority: 2, reason: 'پیش‌نویس در انتظار بررسی مالی', evidence: 'مبلغ و مدرک منشأ بررسی شوند.',
    owner: 'حسابداری', waitingSince: '2026-09-24T00:00:00.000Z', nextAction: 'بررسی و تأیید مالی' },
};

test('work inbox names reason, amount, payment, evidence, waiting time, owner and detail action', () => {
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[row]} now={new Date('2026-09-26T00:00:00.000Z')} />);
  for (const text of ['قرارداد ۱۲۳', 'مشتری نمونه', 'پیش‌نویس در انتظار بررسی مالی',
    '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳ ریال', 'دریافت‌شده', 'مدرک یا مغایرت', '۲ روز',
    'مسئول فعلی: حسابداری', 'بررسی و تأیید مالی']) assert(html.includes(text), text);
  assert(html.includes('/dashboard/accounting/contracts/contract-1?section=financial'));
  assert(!html.includes('onClick='));
});

test('completed rows do not look like pending work', () => {
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[{ ...row, attention: null }]} />);
  assert(!html.includes('قرارداد ۱۲۳'));
  assert(html.includes('مشاهده همه قراردادها'));
});

test('blocking and older work wins the limited inbox even when input order differs', () => {
  const ordinary = Array.from({ length: 6 }, (_, index) => ({ ...row, contractId: `ordinary-${index}`,
    contractNumber: `معمولی-${index}` }));
  const blocker = { ...row, contractId: 'blocker', contractNumber: 'مسدود', attention: {
    ...row.attention!, priority: 1, waitingSince: '2026-09-20T00:00:00.000Z' } };
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[...ordinary, blocker]} />);
  assert(html.includes('قرارداد مسدود'));
  assert(!html.includes('قرارداد معمولی-۵'));
});

test('partner tasks link to the partner case and never an ordinary contract', () => {
  const partner = { ...row, sourceKind: 'PARTNER_INTERNAL_RECORD' as const, partnerContext: {
    caseId: 'partner-1', caseNumber: '1', customerContractNumber: 'C', internalRecordNumber: 'I',
    debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '' } };
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[partner]} />);
  assert(html.includes('/dashboard/accounting/contracts/partner/partner-1'));
  assert(!html.includes('/dashboard/accounting/contracts/contract-1?'));
});

test('work inbox displays the recorded currency without guessing unknown units', () => {
  const toman = { ...row, accounting: { ...row.accounting, totalContractAmount: '1000', currency: 'IRT' } };
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[toman]} />);
  assert(html.includes('۱٬۰۰۰ تومان'));
  const unknown = { ...row, accounting: { ...row.accounting, currency: undefined } };
  assert(renderToStaticMarkup(<AccountingWorkInbox contracts={[unknown]} />).includes('داده معتبر در دسترس نیست'));
});

test('unpriced partner preparation displays unknown amount and waiting time', () => {
  const pending = { ...row, preparationOnly: true, amountKnown: false,
    partnerContext: { caseId: 'partner-unknown', caseNumber: '1', customerContractNumber: 'C', internalRecordNumber: 'I',
      debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '' },
    attention: { ...row.attention!, waitingSince: null } };
  const html = renderToStaticMarkup(<AccountingWorkInbox contracts={[pending]} />);
  assert(html.includes('مبلغ قرارداد: نامشخص'));
  assert(html.includes('مانده: نامشخص'));
  assert(html.includes('زمان انتظار نامشخص'));
  assert(html.includes('/dashboard/accounting/contracts/partner/partner-unknown'));
});
