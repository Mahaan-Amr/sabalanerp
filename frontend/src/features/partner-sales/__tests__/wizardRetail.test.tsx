import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerRetailStep } from '../../contract-creation/partner/PartnerRetailStep';
import { defaultPartnerRetailRows, partnerRetailSummary } from '../../contract-creation/partner/partnerRetail';

test('retail defaults to approval but a retail-only discount can create a confirmable loss', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2.000', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  assert.equal(rows[0].retailUnitPrice.amount, '800');
  const discount = { amount: '100', currency: 'IRR' as const };
  const summary = partnerRetailSummary(rows, discount);
  assert.equal(summary.wholesale, '1600');
  assert.equal(summary.retail, '1500');
  assert.equal(summary.difference, '-100');
  const html = renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={discount} belowCostConfirmed={false}
    disabled={false} onRowsChange={() => undefined} onDiscountChange={() => undefined} onConfirmLoss={() => undefined} />);
  assert.match(html, /فروش با زیان/);
  assert.match(html, /زیان را بررسی کرده‌ام/);
  assert.equal(inquiry.rows[0].approvedPrice?.amount, '800');
});

test('retail preview keeps sub-unit differences exact above the safe integer range', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  inquiry.rows[0].approvedPrice = { amount: '9007199254740993.01', currency: 'IRR' };
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '0.1', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  rows[0].retailUnitPrice.amount = '9007199254740993.02';
  const summary = partnerRetailSummary(rows, { amount: '0', currency: 'IRR' });
  assert.equal(summary.wholesale, '900719925474099.301');
  assert.equal(summary.retail, '900719925474099.302');
  assert.equal(summary.difference, '0.001');
  assert.equal(summary.loss, false);
  assert.equal(partnerRetailSummary(rows, { amount: '1', currency: 'IRT' }).valid, false);
});

test('invalid retail and discount values are associated with the offending field', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  const render = (amount: string) => renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={{ amount, currency: 'IRR' }} belowCostConfirmed={false}
    disabled={false} onRowsChange={() => undefined} onDiscountChange={() => undefined} onConfirmLoss={() => undefined} />);
  rows[0].retailUnitPrice.amount = '';
  assert.match(render('0'), /aria-invalid="true"/);
  assert.match(render('0'), /aria-describedby="[^"]+-error"/);
  rows[0].retailUnitPrice.amount = '800';
  const discount = render('2000');
  assert.match(discount, /aria-invalid="true"/);
  assert.match(discount, /تخفیف نمی‌تواند/);
});
