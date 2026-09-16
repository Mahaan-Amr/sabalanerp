import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractPaymentMethodSelect, contractPaymentMethodOptions } from './ContractPaymentMethodSelect';

test('ordinary and Partner payment editors share the same customer payment choices', () => {
  assert.deepEqual(contractPaymentMethodOptions.map(option => option.value),
    ['CASH_CARD', 'CASH_SHIBA', 'CHECK', 'CUSTOMER_BALANCE']);

  const html = renderToStaticMarkup(<ContractPaymentMethodSelect value="CASH_CARD" onChange={() => undefined} />);
  assert.match(html, /نقدی \(کارت‌خوان\)/);
  assert.match(html, /نقدی \(شبا\)/);
  assert.match(html, /چک/);
  assert.match(html, /استفاده از باقی مانده مشتری/);
});
