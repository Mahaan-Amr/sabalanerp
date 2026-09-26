import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractPaymentMethodSelect, contractPaymentMethodOptions } from './ContractPaymentMethodSelect';

test('ordinary and Partner payment editors hide customer balance for new payments', () => {
  assert.deepEqual(contractPaymentMethodOptions.map(option => option.value),
    ['CASH_CARD', 'CASH_SHIBA', 'CHECK']);

  const html = renderToStaticMarkup(<ContractPaymentMethodSelect value="CASH_CARD" onChange={() => undefined} />);
  assert.match(html, /نقدی \(کارت‌خوان\)/);
  assert.match(html, /نقدی \(شبا\)/);
  assert.match(html, /چک/);
  assert.doesNotMatch(html, /استفاده از باقی مانده مشتری/);

  const legacyHtml = renderToStaticMarkup(<ContractPaymentMethodSelect value="CUSTOMER_BALANCE" onChange={() => undefined} />);
  assert.match(legacyHtml, /استفاده از باقی مانده مشتری \(غیرفعال\)/);

  const existingHtml = renderToStaticMarkup(<ContractPaymentMethodSelect value="CUSTOMER_BALANCE"
    existingContract onChange={() => undefined} />);
  assert.match(existingHtml, /<option value="CUSTOMER_BALANCE" selected="">استفاده از باقی مانده مشتری<\/option>/);
});
