import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InvoiceDraftEditor } from '../InvoiceDraftEditor';

test('saved incomplete draft can be resumed in the contract dossier', () => {
  const html = renderToStaticMarkup(<InvoiceDraftEditor record={{ id: 'draft-1', amount: '100', currency: 'IRR', draftDetails: { systemInvoiceNumber: 'S-19', systemInvoiceDate: '', sepidarAmount: '' } }} canSave canApprove busy={false} onSave={async () => true} onApprove={async () => true} />);
  assert.match(html, /S-19/);
  assert.match(html, /ذخیره پیش‌نویس/);
  assert.match(html, /تاریخ فاکتور/);
});
