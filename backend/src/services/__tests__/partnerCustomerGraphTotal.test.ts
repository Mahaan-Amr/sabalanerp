import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCanonicalDecimal as decimal, parseStableIdentity, type CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import { PartnerTechnicalDraftSchema } from '@sabalanerp/partner-sales-contracts';
import { partnerCustomerGraphTotal } from '../partnerSales/cases/customerGraphTotal';

const main = (id: string, base: string, total: string): CanonicalProductRow => ({
  productRowId: parseStableIdentity('product-row', id), catalogProductId: 'stone', catalogSnapshotVersion: 'catalog-v1',
  productType: 'longitudinal', contractualTitle: id, commercial: { requestedAreaSquareMeters: decimal('1'),
    baseAmountToman: decimal(base), totalAmountToman: decimal(total) },
});
const draft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1,
  rows: [1, 2, 3, 4].map(id => ({ productRowId: `root-${id}`, catalogItemId: 'stone', catalogSnapshotVersion: '2026-09-01T00:00:00.000Z',
    family: 'prepared', configuration: { kind: 'readyPiece', quantity: '1', unit: 'count' },
    retailUnitPrice: { amount: String([62500000, 300000000, 200000000, 200000000][id - 1]), currency: 'IRT' } })) });
const graph = { rows: [1, 2, 3, 4].map(id => main(`root-${id}`, '1', '1')).concat(main('remainder-child', '0', '124625000')),
  layerConfigurations: [] };

test('final cart total includes remainder services exactly once and equals the customer quote total', () => {
  assert.deepEqual(partnerCustomerGraphTotal(graph, draft, { amount: '0', currency: 'IRT' }), { amount: '887125000', currency: 'IRT' });
  assert.deepEqual(partnerCustomerGraphTotal(graph, draft, { amount: '125000', currency: 'IRT' }), { amount: '887000000', currency: 'IRT' });
  assert.deepEqual(partnerCustomerGraphTotal(graph, draft, { amount: '0', currency: 'IRT' }, '10'), { amount: '798412500', currency: 'IRT' });
});

test('incomplete rates and discounts above the complete total never yield a misleading payable', () => {
  assert.throws(() => partnerCustomerGraphTotal(graph, { ...draft, rows: draft.rows.map(row => ({ ...row, retailUnitPrice: undefined })) },
    { amount: '0', currency: 'IRT' }));
  assert.throws(() => partnerCustomerGraphTotal(graph, draft, { amount: '999999999', currency: 'IRT' }));
});

test('final payable uses the shared whole-unit rounding after applying the discount', () => {
  const single = { ...draft, rows: [{ ...draft.rows[0], retailUnitPrice: { amount: '10.6', currency: 'IRT' as const } }] };
  assert.deepEqual(partnerCustomerGraphTotal({ rows: [main('root-1', '1', '1')], layerConfigurations: [] }, single,
    { amount: '0.1', currency: 'IRT' }), { amount: '11', currency: 'IRT' });
});
