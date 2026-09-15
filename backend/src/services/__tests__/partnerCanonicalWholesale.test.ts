import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCanonicalDecimal as decimal, type CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import { calculatePartnerCanonicalWholesale } from '../partnerSales/cases/canonicalWholesale';

const row = (commercial: CanonicalProductRow['commercial']): CanonicalProductRow => ({
  productRowId: 'row-1' as CanonicalProductRow['productRowId'], catalogProductId: 'stone-1',
  catalogSnapshotVersion: 'catalog-v1', productType: 'longitudinal', contractualTitle: 'سنگ طولی', commercial,
});

test('approved main-stone rate replaces only canonical material while all ordinary components remain', () => {
  const result = calculatePartnerCanonicalWholesale(row({ baseRateToman: decimal('1000000'), baseAmountToman: decimal('4000000'),
    totalAmountToman: decimal('4750000') }), '1600000');
  assert.deepEqual(result, { materialQuantity: '4', materialAmount: '6400000', componentAmount: '750000',
    totalAmount: '7150000' });
});

test('paid remainder has zero second material charge and retains new operations', () => {
  const result = calculatePartnerCanonicalWholesale(row({ baseRateToman: decimal('1000000'), baseAmountToman: decimal('0'),
    totalAmountToman: decimal('250000') }), '1600000');
  assert.deepEqual(result, { materialQuantity: '0', materialAmount: '0', componentAmount: '250000',
    totalAmount: '250000' });
});

test('a different main stone in a layer requires and uses its own approved rate', () => {
  const product = row({ baseRateToman: decimal('100'), baseAmountToman: decimal('400'), totalAmountToman: decimal('750') });
  const layer = { parentProductRowId: product.productRowId,
    input: { source: { kind: 'new-material', catalogProductId: 'stone-2' } },
    result: { materialSourceSplit: { newMaterialSquareMeters: decimal('2'), newMaterialAmountToman: decimal('200') } },
  } as any;
  assert.throws(() => calculatePartnerCanonicalWholesale(product, '150', [layer]), /additional material rate/);
  assert.deepEqual(calculatePartnerCanonicalWholesale(product, '150', [layer], new Map([['stone-2', '300']])), {
    materialQuantity: '4', materialAmount: '1200', componentAmount: '150', totalAmount: '1350',
  });
});
