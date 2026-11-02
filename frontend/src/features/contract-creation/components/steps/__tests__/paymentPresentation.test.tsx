import React from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Step7PaymentMethod } from '../Step7PaymentMethod';
import type { ContractWizardData } from '../../../types/contract.types';

test('ordinary Sales retains its discount editor alongside the shared empty payment list and totals', () => {
  const html = renderToStaticMarkup(<Step7PaymentMethod
    wizardData={{ payment: { payments: [], currency: 'تومان', totalContractAmount: 2000 } } as unknown as ContractWizardData}
    updateWizardData={() => {}} errors={{}} baseSubtotal={2000} productsTotal={2000}
    discountPercent={0} maxDiscountPercent={10} maxDiscountAmount={200} discountAmount={0}
    discountEntryMode="AMOUNT_TOMAN" discountPercentInput={0} hasMatchingDiscountRange
    onDiscountAmountChange={() => {}} onDiscountPercentChange={() => {}} onDiscountEntryModeChange={() => {}}
    showPaymentEntryModal={false} setShowPaymentEntryModal={() => {}} />);
  for (const text of ['مبلغ تخفیف (تومان)', 'سقف مجاز', 'مبلغ قرارداد:', 'جمع پرداخت:', 'باقیمانده:',
    'لیست پرداخت‌ها', 'هنوز پرداختی ثبت نشده است', 'ایجاد پرداخت جدید']) assert.ok(html.includes(text), text);
});

for (const scenario of [
  { label: 'empty new contract', total: 0, existing: false, disabled: true },
  { label: 'new contract with a payable total', total: 2000, existing: false, disabled: false },
  { label: 'existing contract retains extra-payment entry', total: 0, existing: true, disabled: false },
]) test(`payment entry availability: ${scenario.label}`, () => {
  const html = renderToStaticMarkup(<Step7PaymentMethod
    existingContract={scenario.existing}
    wizardData={{ payment: { payments: [], currency: 'تومان', totalContractAmount: scenario.total } } as unknown as ContractWizardData}
    updateWizardData={() => {}} errors={{}} baseSubtotal={scenario.total} productsTotal={scenario.total}
    discountPercent={0} maxDiscountPercent={10} maxDiscountAmount={200} discountAmount={0}
    discountEntryMode="AMOUNT_TOMAN" discountPercentInput={0} hasMatchingDiscountRange
    onDiscountAmountChange={() => {}} onDiscountPercentChange={() => {}} onDiscountEntryModeChange={() => {}}
    showPaymentEntryModal={false} setShowPaymentEntryModal={() => {}} />);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  for (const label of ['افزودن پرداخت', 'ایجاد پرداخت جدید']) {
    const button = buttons.find(match => match[2].includes(label));
    assert.ok(button, `${label} exists`);
    assert.equal(/\sdisabled(?:=|\s|$)/.test(button[1]), scenario.disabled, label);
  }
});
