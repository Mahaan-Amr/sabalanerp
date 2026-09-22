import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCanonicalDecimal as decimal, type CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import { calculatePartnerCanonicalRetail, calculatePartnerCanonicalWholesale } from '../partnerSales/cases/canonicalWholesale';

const row = (commercial: CanonicalProductRow['commercial']): CanonicalProductRow => ({
  productRowId: 'row-1' as CanonicalProductRow['productRowId'], catalogProductId: 'stone-1',
  catalogSnapshotVersion: 'catalog-v1', productType: 'longitudinal', contractualTitle: 'سنگ طولی', commercial,
});

test('approved main-stone rate replaces only canonical material while all ordinary components remain', () => {
  const result = calculatePartnerCanonicalWholesale(row({ requestedAreaSquareMeters: decimal('4'), baseRateToman: decimal('1000000'), baseAmountToman: decimal('4000000'),
    totalAmountToman: decimal('4750000') }), '1600000');
  assert.deepEqual(result, { materialQuantity: '4', materialAmount: '6400000', componentAmount: '750000',
    totalAmount: '7150000' });
});

test('paid remainder has zero second material charge and retains new operations', () => {
  const result = calculatePartnerCanonicalWholesale(row({ requestedAreaSquareMeters: decimal('4'), baseRateToman: decimal('1000000'), baseAmountToman: decimal('0'),
    totalAmountToman: decimal('250000') }), '1600000');
  assert.deepEqual(result, { materialQuantity: '0', materialAmount: '0', componentAmount: '250000',
    totalAmount: '250000' });
});

test('Partner retail and Sabalan wholesale keep the identical canonical ancillary amount', () => {
  const product = row({ requestedAreaSquareMeters: decimal('4'), baseRateToman: decimal('1000000'), baseAmountToman: decimal('4000000'),
    totalAmountToman: decimal('4750000') });
  const retail = calculatePartnerCanonicalRetail(product, '1800000');
  const wholesale = calculatePartnerCanonicalWholesale(product, '1400000');
  assert.equal(retail.componentAmount, '750000');
  assert.equal(wholesale.componentAmount, retail.componentAmount);
  assert.equal(retail.totalAmount, '7950000');
  assert.equal(wholesale.totalAmount, '6350000');
});

test('a different main stone in a layer requires and uses its own approved rate', () => {
  const product = row({ requestedAreaSquareMeters: decimal('4'), baseRateToman: decimal('100'), baseAmountToman: decimal('400'), totalAmountToman: decimal('750') });
  const layer = { parentProductRowId: product.productRowId,
    input: { source: { kind: 'new-material', catalogProductId: 'stone-2' } },
    result: { materialSourceSplit: { newMaterialSquareMeters: decimal('2'), newMaterialAmountToman: decimal('200') } },
  } as any;
  assert.throws(() => calculatePartnerCanonicalWholesale(product, '150', [layer]), /additional material rate/);
  assert.deepEqual(calculatePartnerCanonicalWholesale(product, '150', [layer], new Map([['stone-2', '300']])), {
    materialQuantity: '4', materialAmount: '1200', componentAmount: '150', totalAmount: '1350',
  });
});

test('stair and slab quotes use the negotiated family unit instead of square-meter material area', () => {
  const stair = { ...row({ requestedQuantity: decimal('3'), baseRateToman: decimal('100'),
    baseAmountToman: decimal('800'), totalAmountToman: decimal('950') }), productType: 'stair' as const,
    stairPart: { stairSystemId: 'stair-system:1', part: 'tread' as const } } as CanonicalProductRow;
  const slab = { ...row({ requestedQuantity: decimal('8'), baseRateToman: decimal('100'),
    baseAmountToman: decimal('1200'), totalAmountToman: decimal('1400'), calculationSnapshot: {
      packingPlan: { consumedSources: [{}] },
    } }), productType: 'slab' as const,
    slab: { lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const,
      cuttingPricingMethod: 'lineBased' as const,
      sourceRows: [{ sourceRowId: 'slab-source-row:1' as any, lengthMeters: decimal('3'),
        widthMeters: decimal('2'), lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const, quantity: 2 }] } } as CanonicalProductRow;
  assert.deepEqual(calculatePartnerCanonicalWholesale(stair, '500'), {
    materialQuantity: '3', materialAmount: '1500', componentAmount: '150', totalAmount: '1650',
  });
  assert.deepEqual(calculatePartnerCanonicalWholesale(slab, '700'), {
    materialQuantity: '1', materialAmount: '700', componentAmount: '200', totalAmount: '900',
  });
});
