import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ContractPaymentCheckFields } from './ContractPaymentCheckFields';

test('shared check editor exposes ordinary and Partner check evidence with field errors', () => {
  const html = renderToStaticMarkup(<ContractPaymentCheckFields value={{ number: '', ownerName: '',
    handoverDate: '', bank: '', nationalCode: '' }} showBank nationalCodeRequired
    errors={{ ownerName: 'نام صاحب چک الزامی است.' }} onChange={() => undefined} />);
  assert.match(html, /شماره چک/);
  assert.match(html, /نام صاحب چک/);
  assert.match(html, /تاریخ تحویل چک/);
  assert.match(html, /بانک/);
  assert.match(html, /کد ملی/);
  assert.match(html, /aria-invalid="true"/);
});

test('today payment can display an optional national ID without the required marker', () => {
  const html = renderToStaticMarkup(<ContractPaymentCheckFields showCheckFields={false} showNationalCode
    nationalCodeRequired={false} value={{ number: '', ownerName: '', handoverDate: '', nationalCode: '' }} onChange={() => undefined} />);
  assert.match(html, /برای پرداخت امروز اختیاری است/);
  assert.match(html, /کد ملی مشتری/);
  assert.doesNotMatch(html, /الزامی است/);
});
