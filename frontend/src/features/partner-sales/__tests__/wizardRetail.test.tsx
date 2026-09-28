import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createWizardFixtures as createPartnerFixtures } from './wizardFixtures';
import { PartnerRetailStep } from '../../contract-creation/partner/PartnerRetailStep';
import { partnerRetailIntentRows, defaultPartnerRetailRows, partnerRetailDiscountFromPercent, partnerRetailSummary, refreshPartnerInquiryRow } from '../../contract-creation/partner/partnerRetail';

test('periodic price refresh keeps the quoted delivery-unit total for the 100329 rate example', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const approved = { ...inquiry.rows[0], approvedPrice: { amount: '1500000', currency: 'IRT' as const } };
  const row = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '20', unit: 'm',
    inquiryRow: approved, retailUnitPrice: { amount: '2000000', currency: 'IRT' as const } }])[0];
  row.retailEffectiveUnitPrice = { amount: '1117500', currency: 'IRT' };
  row.wholesaleUnitPrice = { amount: '867500', currency: 'IRT' };
  const summary = partnerRetailSummary([refreshPartnerInquiryRow(row, approved)], { amount: '0', currency: 'IRT' });
  assert.equal(summary.wholesale, '17350000');
  assert.equal(summary.retail, '22350000');
  assert.equal(summary.difference, '5000000');
  assert.equal(summary.loss, false);
});

test('retail defaults to approval but a retail-only discount can create a confirmable loss', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2.000', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  rows[0].wholesaleUnitPrice = { amount: '800', currency: 'IRR' };
  assert.equal(rows[0].retailUnitPrice.amount, '800');
  const discount = { amount: '100', currency: 'IRR' as const };
  const summary = partnerRetailSummary(rows, discount);
  assert.equal(summary.wholesale, '1600');
  assert.equal(summary.retail, '1500');
  assert.equal(summary.difference, '-100');
  const html = renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={discount} belowCostConfirmed={false}
    disabled={false} onRowsChange={() => undefined} onConfirmLoss={() => undefined} />);
  assert.match(html, /فروش با زیان/);
  assert.match(html, /زیان را بررسی کرده‌ام/);
  assert.equal(inquiry.rows[0].approvedPrice?.amount, '800');
});

test('retail preserves an explicit customer unit price instead of replacing it with the Sabalan approval', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2.000', unit: 'm',
    inquiryRow: inquiry.rows[0], retailUnitPrice: { amount: '1250', currency: 'IRR' as const } }]);
  assert.equal(rows[0].retailUnitPrice.amount, '1250');
  assert.equal(rows[0].inquiryRow.approvedPrice?.amount, '800');
});

test('Sabalan quote is shown as its base unit rate, not multiplied into a misleading unit price', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  inquiry.rows[0].approvedPrice = { amount: '1500000', currency: 'IRT' };
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '10', unit: 'm',
    inquiryRow: inquiry.rows[0], retailUnitPrice: { amount: '2000000', currency: 'IRT' as const } }]);
  rows[0].wholesaleUnitPrice = { amount: '1500000', currency: 'IRT' };
  const html = renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={{ amount: '0', currency: 'IRT' }}
    belowCostConfirmed={false} disabled={false} onRowsChange={() => undefined} onConfirmLoss={() => undefined} />);
  assert.match(html, /نرخ پایه پیشنهادی سبلان/);
  assert.match(html, /نرخ پایه پیشنهادی سبلان: ۱,۵۰۰,۰۰۰ تومان/);
  assert.match(html, /جمع خرید این ردیف از سبلان/);
  assert.match(html, /جمع خرید این ردیف از سبلان[\s\S]*۱۵,۰۰۰,۰۰۰ تومان/);
});

test('partner percentage discount changes only the customer retail envelope', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2', unit: 'm',
    inquiryRow: inquiry.rows[0], retailUnitPrice: { amount: '1250', currency: 'IRR' as const } }]);
  rows[0].wholesaleUnitPrice = { amount: '800', currency: 'IRR' };
  const discount = partnerRetailDiscountFromPercent(rows, '10', 'IRR');
  assert.deepEqual(discount, { amount: '250', currency: 'IRR' });
  const summary = partnerRetailSummary(rows, discount!);
  assert.equal(summary.retail, '2250');
  assert.equal(summary.wholesale, '1600');
  assert.equal(rows[0].wholesaleUnitPrice.amount, '800');
});

test('retail preview rounds only payable totals above the safe integer range', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  inquiry.rows[0].approvedPrice = { amount: '9007199254740993.01', currency: 'IRR' };
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '0.1', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  rows[0].wholesaleUnitPrice = { amount: '9007199254740993.01', currency: 'IRR' };
  rows[0].retailUnitPrice.amount = '9007199254740993.02';
  const summary = partnerRetailSummary(rows, { amount: '0', currency: 'IRR' });
  assert.equal(summary.wholesale, '900719925474099');
  assert.equal(summary.retail, '900719925474099');
  assert.equal(summary.difference, '0');
  assert.equal(rows[0].retailUnitPrice.amount, '9007199254740993.02');
  assert.equal(summary.loss, false);
  assert.equal(partnerRetailSummary(rows, { amount: '1', currency: 'IRT' }).valid, false);
});

test('customer retail totals remain valid while Sabalan inquiry pricing is pending', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const pending = { ...inquiry.rows[0], state: 'PENDING' as const, approvedPrice: undefined,
    approvedAt: undefined, expiresAt: undefined, approvedRowBinding: undefined };
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2', unit: 'm',
    inquiryRow: pending, retailUnitPrice: { amount: '1250', currency: 'IRR' as const } }]);
  const summary = partnerRetailSummary(rows, { amount: '100', currency: 'IRR' });
  assert.equal(summary.valid, true);
  assert.equal(summary.retail, '2400');
  assert.equal(summary.pricingReady, false);
  assert.equal(summary.wholesale, undefined);
  assert.equal(summary.difference, undefined);
});

test('invalid retail values are associated with the offending product field', () => {
  const { inquiry, configurationDraft } = createPartnerFixtures();
  const rows = defaultPartnerRetailRows([{ productRowId: configurationDraft.productRowId, quantity: '2', unit: 'm', inquiryRow: inquiry.rows[0] }]);
  rows[0].wholesaleUnitPrice = { amount: '800', currency: 'IRR' };
  const render = (amount: string) => renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={{ amount, currency: 'IRR' }} belowCostConfirmed={false}
    disabled={false} onRowsChange={() => undefined} onConfirmLoss={() => undefined} />);
  rows[0].retailUnitPrice.amount = '';
  assert.match(render('0'), /aria-invalid="true"/);
  assert.match(render('0'), /aria-describedby="[^"]+-error"/);
});


test('four main products keep their remainder child nested and retain all financial intent rows', () => {
  const { inquiry } = createPartnerFixtures();
  const roots = defaultPartnerRetailRows(Array.from({ length: 4 }, (_, i) => ({ productRowId: `root-${i}`,
    quantity: '1', unit: 'count', inquiryRow: { ...inquiry.rows[0], description: `سنگ ${i}` },
    retailUnitPrice: { amount: '10', currency: 'IRT' as const } })));
  const child = { ...roots[0], productRowId: 'child', parentProductRowId: 'root-0',
    retailUnitPrice: { amount: '0', currency: 'IRT' as const } };
  const rows = [...roots, child];
  const html = renderToStaticMarkup(<PartnerRetailStep rows={rows} discount={{ amount: '0', currency: 'IRT' }}
    belowCostConfirmed={false} disabled={false} onRowsChange={() => undefined} onConfirmLoss={() => undefined} />);
  assert.match(html, /۴ محصول/);
  assert.match(html, /فرزند باقی‌مانده/);
  assert.equal((html.match(/inputMode="numeric"/g) ?? []).length, 4);
  assert.ok(html.indexOf('data-retail-row-id="child"') < html.indexOf('data-retail-row-id="root-1"'));
  assert.equal(partnerRetailIntentRows(rows).length, 5);
  assert.equal(partnerRetailSummary(rows, { amount: '0', currency: 'IRT' }).retail, '40');
});
