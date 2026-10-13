import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { FinancialInvoiceApprovalForm, type FinancialInvoiceApprovalPayload } from '../accountingUi';

test('Partner approval compares rial input and submits the original invoice currency exactly', (t) => {
  const cases = [
    ['IRT', '455616250', '4556162500', '455616250'],
    ['IRT', '455616250', '۴۵۵۶۱۶۲۵۰۰', '455616250'],
    ['IRR', '4556162500', '4556162500', '4556162500'],
    ['IRT', '9007199254740993.1', '90071992547409931', '9007199254740993.1'],
    ['IRT', '455616250', '455616250', undefined],
    ['IRR', '4556162500', '4556162501', undefined],
    ['IRT', '455616250', '0', undefined],
  ];
  for (const mode of ['PARTNER_INTERNAL_RECORD', 'PARTNER_SHARED_CORRECTION_REPLACEMENT']) {
    for (const [currency, amount, input, expected] of cases) {
      const states = ['1482', '1405/07/06', 0, input, 'void-reference', '', {}];
      let index = 0;
      const stateMock = t.mock.method(React, 'useState', () => [states[index++], () => {}]);
      const effectMock = t.mock.method(React, 'useEffect', () => {});
      let submitted: FinancialInvoiceApprovalPayload | undefined;
      try {
        const tree = FinancialInvoiceApprovalForm({
          invoice: { id: 'partner-invoice', amount: amount!, currency, status: 'DRAFT',
            ...(mode === 'PARTNER_INTERNAL_RECORD' ? { sourceKind: mode } : { metadata: { mode } }) },
          onApprove: payload => { submitted = payload; },
        });
        const visit = (node: any): any => {
          if (!node || typeof node !== 'object') return undefined;
          if (node.props?.label === 'تایید مالی') return node;
          return React.Children.toArray(node.props?.children).map(visit).find(Boolean);
        };
        visit(tree).props.onClick();
        assert.equal(submitted?.sepidarAmount, expected, `${mode}: ${currency} ${input}`);
      } finally {
        stateMock.mock.restore();
        effectMock.mock.restore();
      }
    }
  }
});

test('Partner approval initializes a saved toman amount as rial input', (t) => {
  let index = 0;
  let initialized: unknown;
  const stateMock = t.mock.method(React, 'useState', (value: unknown) => {
    const slot = index++;
    return [value, (next: unknown) => { if (slot === 3) initialized = next; }];
  });
  const effectMock = t.mock.method(React, 'useEffect', (effect: () => void) => effect());
  try {
    FinancialInvoiceApprovalForm({
      invoice: { id: 'partner', sourceKind: 'PARTNER_INTERNAL_RECORD', status: 'DRAFT',
        amount: '455616250', sepidarAmount: '455616250', currency: 'IRT' },
      onApprove: () => {},
    });
    assert.equal(initialized, '4556162500');
  } finally {
    stateMock.mock.restore();
    effectMock.mock.restore();
  }
});

test('invoice approval submits Monday 6 Mehr as a calendar day in every browser timezone', (t) => {
  const previousTimezone = process.env.TZ;
  t.after(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });
  for (const timezone of ['Asia/Tehran', 'UTC', 'America/Los_Angeles']) {
    process.env.TZ = timezone;
    const states = ['1482', '1405/07/06', 110000000, '', '', '', {}];
    let stateIndex = 0;
    // Exercise the real submit callback with the values committed by the fields.
    const stateMock = t.mock.method(React, 'useState', () => [states[stateIndex++], () => {}]);
    const effectMock = t.mock.method(React, 'useEffect', () => {});
    let submitted: FinancialInvoiceApprovalPayload | undefined;
    try {
      const tree = FinancialInvoiceApprovalForm({
        invoice: { id: 'invoice-1482', amount: 110000000, status: 'DRAFT' },
        onApprove: (payload) => { submitted = payload; },
      });
      const visit = (node: any): any => {
        if (!node || typeof node !== 'object') return undefined;
        if (node.props?.label === 'تایید مالی') return node;
        return React.Children.toArray(node.props?.children).map(visit).find(Boolean);
      };
      const approve = visit(tree);
      assert(approve, 'the financial approval action must exist');
      approve.props.onClick();
      assert(submitted, 'valid fields must submit');
      assert.equal(submitted.systemInvoiceDate, '2026-09-28', timezone);
    } finally {
      stateMock.mock.restore();
      effectMock.mock.restore();
    }
  }
});
