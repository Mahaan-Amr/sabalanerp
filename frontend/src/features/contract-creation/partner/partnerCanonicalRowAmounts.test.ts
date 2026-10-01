import assert from 'node:assert/strict';
import test from 'node:test';
import { PartnerWholesaleQuoteSchema } from '@sabalanerp/partner-sales-contracts';
import { partnerRetailDiscountFromPercent, partnerRetailRowSummary, partnerRetailSummary, refreshPartnerInquiryRow, type PartnerRetailRow } from './partnerRetail';

const row: PartnerRetailRow = {
  productRowId: 'stone', quantity: '11', unit: 'squareMeter',
  inquiryRow: { rowId: 'inquiry', revision: 1 } as PartnerRetailRow['inquiryRow'],
  retailUnitPrice: { amount: '0.5', currency: 'IRT' },
  retailEffectiveUnitPrice: { amount: '9.1363636363636363636', currency: 'IRT' },
  wholesaleUnitPrice: { amount: '9.1363636363636363636', currency: 'IRT' },
  retailLineTotal: { amount: '100.5', currency: 'IRT' },
  wholesaleLineTotal: { amount: '100.5', currency: 'IRT' }
};
test('Partner preview preserves canonical row amounts through summary, discount and payment basis', () => {
  const quote = PartnerWholesaleQuoteSchema.parse({ schemaVersion: 1, recoveryId: 'recovery', recoveryRevision: 1,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, rows: [{ productRowId: row.productRowId,
      retailEffectiveUnitPrice: row.retailEffectiveUnitPrice, wholesaleUnitPrice: row.wholesaleUnitPrice,
      retailLineTotal: row.retailLineTotal, wholesaleLineTotal: row.wholesaleLineTotal }] });
  assert.equal(quote.rows[0].retailLineTotal?.amount, '100.5');
  const exact = partnerRetailSummary([row], { amount: '0', currency: 'IRT' });
  assert.ok(exact.valid);
  if (exact.valid) { assert.equal(exact.retail, '101'); assert.equal(exact.wholesale, '101'); }
  assert.equal(partnerRetailRowSummary(row)?.retail, '100.5');
  assert.equal(partnerRetailDiscountFromPercent([row], '10', 'IRT')?.amount, '10.05');
  const legacy = partnerRetailSummary([{ ...row, retailLineTotal: undefined, wholesaleLineTotal: undefined }], { amount: '0', currency: 'IRT' });
  assert.ok(legacy.valid);
  if (legacy.valid) assert.equal(legacy.retail, '100', 'the old divide/multiply path reproduces the one-unit discrepancy');
});
test('Partner exact row amounts are summed before rounding and stale approvals lose their totals', () => {
  const exact = partnerRetailSummary([row, { ...row, productRowId: 'second' }], { amount: '0', currency: 'IRT' });
  assert.ok(exact.valid);
  if (exact.valid) assert.equal(exact.retail, '201', 'never round each 100.5 row before adding');
  const refreshed = refreshPartnerInquiryRow(row, { ...row.inquiryRow, revision: 2 });
  assert.equal(refreshed.wholesaleUnitPrice, undefined);
  assert.equal(refreshed.wholesaleLineTotal, undefined);
  const invalid = partnerRetailSummary([{ ...row, retailLineTotal: { amount: '100.5', currency: 'IRR' } }], { amount: '0', currency: 'IRT' });
  assert.equal(invalid.valid, false);
});
