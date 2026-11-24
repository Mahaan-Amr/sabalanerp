import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';

import { renderToStaticMarkup } from 'react-dom/server';
import { StoneReturnPostingResult } from './StoneReturnPosting';
import type { StoneReturnFinalization, StoneReturnReview } from './stoneReturnApi';

test('finalized detail retains the immutable allocation source and reason for historical cases', () => {
  const draft: StoneReturnReview['draft'] = {
    id: 'version-1', version: 1, attributionReason: 'انتخاب بر اساس خرید هم‌خوان', createdAt: '2026-09-24', rows: [{
      id: 'share-1', contractNumber: 'contract-1001', originalInvoiceNumber: 'invoice-1001',
      originalInvoiceId: 'original-1001', originalLineId: 'invoice-line-5', productRowId: 'product-row-9',
      dispatchEvidenceId: 'shipment-evidence-15', quantity: '15',
    }],
  };
  const original = { originalNetRials: '15000', originalTaxRials: '1500' };
  const finalization: StoneReturnFinalization = {
    id: 'final-1', draftVersion: 1, finalizedAt: '2026-09-24', documentDate: '2026-09-24',
    summary: {
      ...original, agreedUnitRateRials: '1200', rateDifferenceReason: 'نرخ توافقی ثبت شده است.',
      customerCreditRials: '18000', inventoryIdentityId: 'lot-1', receiptEventId: 'receipt-event-1', receiptEvidenceHash: 'receipt-hash-1',
      credits: [{
        ...original, originalInvoiceId: 'original-1001', originalInvoiceNumber: 'invoice-1001',
        creditInvoiceId: 'credit-1', creditNumber: 'CR-1', voucherId: 'voucher-1',
        voucherNumber: 20, openItemId: 'open-1', taxInvoiceId: 'tax-1', customerCreditRials: '18000',
        shares: [{
          ...original, draftRowId: 'share-1', shipmentReturnEvidenceId: 'return-evidence-1', valuationLayerId: 'layer-1',
          quantity: '15', costRials: '500', originalInvoicedQuantity: '20', originalLineNetRials: '20000',
        }],
      }],
    },
  };
  const html = renderToStaticMarkup(<StoneReturnPostingResult finalization={finalization} draft={draft} unit="squareMeter" />);
  for (const reference of ['contract-1001', 'invoice-1001', 'invoice-line-5', 'product-row-9', 'shipment-evidence-15', draft.attributionReason!]) {
    assert.ok(html.includes(reference), reference);
  }
  assert.doesNotMatch(html, /<button|<input/);
});
