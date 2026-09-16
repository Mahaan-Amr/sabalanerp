import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractDiscountEditor } from './ContractDiscountEditor';

test('shared contract discount editor preserves ordinary percent and Partner amount capabilities', () => {
  const percent = renderToStaticMarkup(<ContractDiscountEditor mode="percent" value="4.5"
    label="درصد تخفیف" max="8" onValueChange={() => undefined}
    summaryItems={[{ label: 'جمع پایه', value: '۱٬۰۰۰٬۰۰۰ تومان' }]} />);
  assert.match(percent, /درصد تخفیف/);
  assert.match(percent, /جمع پایه/);
  assert.match(percent, /max="8"/);

  const amount = renderToStaticMarkup(<ContractDiscountEditor mode="amount" value="125000"
    label="تخفیف فروش به مشتری (تومان)" onValueChange={() => undefined}
    error="تخفیف نمی‌تواند از جمع فروش بیشتر باشد."
    summaryItems={[{ label: 'جمع فروش پس از تخفیف', value: '۲٬۵۰۰٬۰۰۰ تومان' }]} />);
  assert.match(amount, /تخفیف فروش به مشتری/);
  assert.match(amount, /125,000/);
  assert.match(amount, /جمع فروش پس از تخفیف/);
  assert.match(amount, /aria-invalid="true"/);
  assert.match(amount, /تخفیف نمی‌تواند/);
});
