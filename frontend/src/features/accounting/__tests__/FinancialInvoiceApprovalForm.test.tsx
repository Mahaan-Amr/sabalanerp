import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialInvoiceApprovalForm, money } from '../accountingUi';
import { formatPartnerMoney } from '../../partner-sales/presentation';

Object.assign(globalThis, { React });

test('Partner replacement asks for real cancellation evidence without changing ordinary invoice approval', () => {
  const invoice = { id: 'invoice', amount: '1100', status: 'DRAFT',
    metadata: { mode: 'PARTNER_SHARED_CORRECTION_REPLACEMENT' } };
  const replacement = renderToStaticMarkup(<FinancialInvoiceApprovalForm invoice={invoice} onApprove={() => undefined} />);
  assert.match(replacement, /مرجع ابطال صورتحساب قبلی/);
  assert.match(replacement, /مستند تسویه و اصلاح سوابق پایین‌دستی/);
  const ordinary = renderToStaticMarkup(<FinancialInvoiceApprovalForm invoice={{ ...invoice, metadata: undefined }} onApprove={() => undefined} />);
  assert.doesNotMatch(ordinary, /مرجع ابطال صورتحساب قبلی/);
});

test('Partner financial displays preserve exact decimal money and explicit currency', () => {
  assert.equal(formatPartnerMoney('9007199254740993.01', 'IRT'), '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳٫۰۱ تومان');
  assert.equal(money('9007199254740993.01', 'IRR'), '۹٬۰۰۷٬۱۹۹٬۲۵۴٬۷۴۰٬۹۹۳٫۰۱ ریال');
  assert.equal(formatPartnerMoney('0', 'USD'), 'داده معتبر در دسترس نیست');
});
