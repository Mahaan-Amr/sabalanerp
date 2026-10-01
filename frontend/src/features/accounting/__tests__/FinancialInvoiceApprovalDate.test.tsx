import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { FinancialInvoiceApprovalForm, type FinancialInvoiceApprovalPayload } from '../accountingUi';

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
