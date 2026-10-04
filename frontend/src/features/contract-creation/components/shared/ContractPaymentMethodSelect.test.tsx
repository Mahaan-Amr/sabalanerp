import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractPaymentMethodSelect, contractPaymentMethodOptions } from './ContractPaymentMethodSelect';

test('ordinary and Partner payment editors hide customer balance for new payments', () => {
  assert.deepEqual(contractPaymentMethodOptions.map(option => option.value),
    ['CASH_CARD', 'CASH_SHIBA', 'CHECK', 'SELLER_CREDIT', 'SPECIAL_CUSTOMER_CREDIT']);

  const html = renderToStaticMarkup(<ContractPaymentMethodSelect value="CASH_CARD" onChange={() => undefined} />);
  assert.match(html, /نقدی \(کارت‌خوان\)/);
  assert.match(html, /نقدی \(شبا\)/);
  assert.match(html, /چک/);
  assert.doesNotMatch(html, /استفاده از باقی مانده مشتری/);
  assert.doesNotMatch(html, /SELLER_CREDIT/);
  assert.doesNotMatch(html, /SPECIAL_CUSTOMER_CREDIT/);
  const special = renderToStaticMarkup(<ContractPaymentMethodSelect value="SPECIAL_CUSTOMER_CREDIT" allowSpecialCustomerCredit onChange={() => undefined} />);
  assert.match(special, /اعتباری مشتری خاص/);
  assert.doesNotMatch(special, /value="SPECIAL_CUSTOMER_CREDIT" disabled/);
  const downgraded = renderToStaticMarkup(<ContractPaymentMethodSelect value="SPECIAL_CUSTOMER_CREDIT" onChange={() => undefined} />);
  assert.match(downgraded, /value="SPECIAL_CUSTOMER_CREDIT" disabled/);
  const creditHtml = renderToStaticMarkup(<ContractPaymentMethodSelect value="SELLER_CREDIT" allowSellerCredit sellerCreditLabel="مانده: ۵۰۰ ریال" onChange={() => undefined} />);
  assert.match(creditHtml, /استفاده از اعتبار فروشنده/);
  assert.match(creditHtml, /مانده: ۵۰۰ ریال/);

  const legacyHtml = renderToStaticMarkup(<ContractPaymentMethodSelect value="CUSTOMER_BALANCE" onChange={() => undefined} />);
  assert.match(legacyHtml, /استفاده از باقی مانده مشتری \(غیرفعال\)/);

  const existingHtml = renderToStaticMarkup(<ContractPaymentMethodSelect value="CUSTOMER_BALANCE"
    existingContract onChange={() => undefined} />);
  assert.match(existingHtml, /<option value="CUSTOMER_BALANCE" disabled="" selected="">استفاده از باقی مانده مشتری \(غیرفعال\)/);
});
