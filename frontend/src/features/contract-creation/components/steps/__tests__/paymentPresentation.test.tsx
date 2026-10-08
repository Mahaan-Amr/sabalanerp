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
