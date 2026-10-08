import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PartnerConfirmationStep } from './PartnerConfirmationStep';
import type { PartnerWizardDraft } from './PartnerContractWizard';

const draft = (discount = '0'): PartnerWizardDraft => ({
  step: 'confirmation', rows: [],
  serviceRows: [{ serviceRowId: 'service', title: 'خدمت آزمایشی', quantity: '2', unit: 'meter',
    retailUnitPrice: { amount: '1000', currency: 'IRT' }, wholesaleUnitPrice: { amount: '500', currency: 'IRT' } }],
  intent: { contractDate: '2026-10-03', retailDiscount: { amount: discount, currency: 'IRT' }, deliveries: [],
    customerPaymentPlan: { installments: [{ installmentId: 'payment', amount: { amount: '2000', currency: 'IRT' },
      dueDate: '2026-10-03', method: 'CASH', subtype: 'CARD' }] } },
} as unknown as PartnerWizardDraft);
const render = (value: PartnerWizardDraft) => renderToStaticMarkup(<PartnerConfirmationStep draft={value}
  technicalDraft={{ schemaVersion: 1, inputRevision: 0, rows: [] }} customer={{ displayName: 'مشتری آزمون', phone: '09123456789' }} />);

test('service-only confirmation renders exact financial totals, Persian dates and a readable payment method without a discount section', () => {
  const value = draft();
  const before = JSON.stringify(value);
  const html = render(value);
  for (const text of ['جمع‌بندی مالی', 'جمع خدمات مستقل', '۲٬۰۰۰ تومان', '۱٬۰۰۰ تومان', '1405/07/11',
    'نقدی (کارت‌خوان)', 'مشتری آزمون', 'خدمت آزمایشی', 'وضعیت تأیید مشتری', 'ارسال‌نشده']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('CASH_CARD'));
  assert.ok(!html.includes('تخفیف'));
  assert.equal(JSON.stringify(value), before, 'presentation must not rewrite persisted intent');
});

test('a retained historical discount remains visible without creating an editable discount control', () => {
  const html = render(draft('200'));
  assert.ok(html.includes('تخفیف ثبت‌شدهٔ قبلی'));
  assert.ok(html.includes('۱٬۸۰۰ تومان'));
  assert.ok(!html.includes('<input'));
});
