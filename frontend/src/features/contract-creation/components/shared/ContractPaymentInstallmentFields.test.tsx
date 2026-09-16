import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractPaymentInstallmentFields } from './ContractPaymentInstallmentFields';

test('shared contract payment installment fields expose canonical method, amount and Persian date controls', () => {
  const html = renderToStaticMarkup(<ContractPaymentInstallmentFields method="CUSTOMER_BALANCE" amount="1250000"
    date="" onMethodChange={() => undefined} onAmountChange={() => undefined} onDateChange={() => undefined} />);
  assert.match(html, /استفاده از باقی مانده مشتری/);
  assert.match(html, /1,250,000/);
  assert.match(html, /تاریخ پرداخت/);
  assert.match(html, /مغایرت مانده مشتری/);
});
