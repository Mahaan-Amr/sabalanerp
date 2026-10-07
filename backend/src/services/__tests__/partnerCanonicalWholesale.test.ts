import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCanonicalDecimal as decimal, type CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import { calculatePartnerCanonicalRetail, calculatePartnerCanonicalWholesale } from '../partnerSales/cases/canonicalWholesale';

const row = (commercial: CanonicalProductRow['commercial']): CanonicalProductRow => ({
  productRowId: 'row-1' as CanonicalProductRow['productRowId'], catalogProductId: 'stone-1',
  catalogSnapshotVersion: 'catalog-v1', productType: 'longitudinal', contractualTitle: 'سنگ طولی', commercial,
});

test('explicit wholesale mandatory replaces only the wholesale percentage and cross cutting, preserving retail and longitudinal cutting', () => {
  for (const retailMandatory of [false, true]) {
    const product = { ...row({ requestedAreaSquareMeters: decimal('4'), baseAmountToman: decimal('400'),
      totalAmountToman: decimal(retailMandatory ? '530' : '450'), calculationSnapshot: {
        partnerPricingBasis: 'ordinary-sale-v1', mandatoryEnabled: retailMandatory,
        mandatoryPercentage: '20', mandatoryAmountToman: retailMandatory ? '80' : '0',
        consumedMotherAreaSquareMeters: '4',
        pricingLines: [{ lineId: 'base-material', quantity: '4', rateToman: '100', amountToman: '400' },
          { lineId: 'crossCutRateToman', quantity: '2', rateToman: '10', amountToman: '20' },
          { lineId: 'longitudinalCutRateToman', quantity: '3', rateToman: '10', amountToman: '30' }],
      } }), productType: 'stair' as const };
    const unchanged = JSON.stringify(product);
    const enabled = calculatePartnerCanonicalWholesale(product, '150', [], new Map(), { enabled: true, percentage: '10' });
    assert.equal(enabled.materialAmount, '600');
    assert.equal(enabled.componentAmount, '90', '60 mandatory + 30 longitudinal, cross cutting free');
    const disabled = calculatePartnerCanonicalWholesale(product, '150', [], new Map(), { enabled: false, percentage: '10' });
    assert.equal(disabled.componentAmount, '50', 'longitudinal and cross cutting charged, wholesale percentage removed');
    const retail = calculatePartnerCanonicalRetail(product, '200');
    assert.equal(retail.componentAmount, retailMandatory ? '210' : '50');
    assert.equal(JSON.stringify(product), unchanged, 'physical and retail evidence remains immutable');
  }
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
  layer.layerConfigurationId = 'layer-2';
  layer.result.cuttingPricingLines = [{ lineId: 'layer-2:cut:cross', quantity: '2', rateToman: '10', amountToman: '20' }];
  const independentlyMandatory = calculatePartnerCanonicalWholesale(product, '150', [layer], new Map([['stone-2', '250']]),
    { enabled: false, percentage: '20' }, new Map([['layer-2', { enabled: true, percentage: '10' }]]));
  assert.equal(independentlyMandatory.materialAmount, '1100');
  assert.equal(independentlyMandatory.componentAmount, '180', 'the layer adds its own 50 percentage charge and waives its own 20 cross cutting');
  const noMandatory = calculatePartnerCanonicalWholesale(product, '150', [layer], new Map([['stone-2', '250']]),
    { enabled: false, percentage: '20' }, new Map([['layer-2', { enabled: false, percentage: '10' }]]));
  assert.equal(noMandatory.componentAmount, '150');
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

test('new ordinary pricing uses material areas across all families and reprices mandatory per agreement', () => {
  const cases = [
    { family: 'longitudinal', quantity: '6', commercial: { requestedAreaSquareMeters: decimal('4') }, snapshot: { pricingLines: [{ lineId: 'base-material', quantity: '6' }] } },
    { family: 'stair', quantity: '8', commercial: { requestedQuantity: decimal('3') }, snapshot: { consumedMotherAreaSquareMeters: '99', pricingLines: [{ lineId: 'base-material', quantity: '8' }] } },
    { family: 'slab', quantity: '12', commercial: { requestedQuantity: decimal('8') }, snapshot: { materialAreaSquareMeters: '99', materialPricingLine: { quantity: '12' }, packingPlan: { consumedSources: [{}] } } },
    { family: 'prepared', quantity: '7', commercial: { requestedQuantity: decimal('7') }, snapshot: {} },
  ] as const;
  for (const item of cases) {
    const base = Number(item.quantity) * 100;
    const mandatory = item.family === 'longitudinal' || item.family === 'stair';
    const product = { ...row({ ...item.commercial, baseAmountToman: decimal(String(base)),
      totalAmountToman: decimal(String(base + (mandatory ? base * 0.2 : 0) + 50)), calculationSnapshot: {
        ...item.snapshot, partnerPricingBasis: 'ordinary-sale-v1', mandatoryEnabled: mandatory,
        mandatoryPercentage: '20', mandatoryAmountToman: String(mandatory ? base * 0.2 : 0),
      } }), productType: item.family } as CanonicalProductRow;
    const wholesale = calculatePartnerCanonicalWholesale(product, '150');
    const retail = calculatePartnerCanonicalRetail(product, '200');
    assert.equal(wholesale.materialQuantity, item.quantity, item.family);
    assert.equal(wholesale.materialAmount, String(Number(item.quantity) * 150), item.family);
    assert.equal(retail.materialAmount, String(Number(item.quantity) * 200), item.family);
    assert.equal(wholesale.componentAmount, String(50 + (mandatory ? Number(item.quantity) * 30 : 0)), item.family);
    assert.equal(retail.componentAmount, String(50 + (mandatory ? Number(item.quantity) * 40 : 0)), item.family);
  }
});

test('ordinary pricing never recharges material or mandatory charges on paid remainders', () => {
  const product = { ...row({ requestedAreaSquareMeters: decimal('4'), baseAmountToman: decimal('0'),
    totalAmountToman: decimal('50'), calculationSnapshot: { partnerPricingBasis: 'ordinary-sale-v1',
      materialPricing: { amountToman: '0', reason: 'paid-in-source-product' }, mandatoryEnabled: false } }),
    sourceProductRowId: 'source-row' as CanonicalProductRow['productRowId'] };
  assert.deepEqual(calculatePartnerCanonicalWholesale(product, '100'), {
    materialQuantity: '0', materialAmount: '0', componentAmount: '50', totalAmount: '50',
  });
});

test('new ordinary repricing fails closed without material area or mandatory evidence', () => {
  const product = row({ requestedAreaSquareMeters: decimal('4'), baseAmountToman: decimal('400'),
    totalAmountToman: decimal('450'), calculationSnapshot: { partnerPricingBasis: 'ordinary-sale-v1', pricingLines: [{ lineId: 'base-material', quantity: '4' }], mandatoryEnabled: true } });
  assert.throws(() => calculatePartnerCanonicalWholesale(product, '100'), /mandatory pricing evidence/);
  for (const productType of ['stair', 'slab'] as const) {
    assert.throws(() => calculatePartnerCanonicalWholesale({ ...product, productType, commercial: { ...product.commercial, calculationSnapshot: { partnerPricingBasis: 'ordinary-sale-v1' } } } as CanonicalProductRow, '100'), /material area/);
  }
});

test('legacy mandatory amounts remain frozen without the new pricing basis marker', () => {
  const product = row({ requestedAreaSquareMeters: decimal('4'), baseAmountToman: decimal('400'),
    totalAmountToman: decimal('530'), calculationSnapshot: { mandatoryEnabled: true,
      mandatoryPercentage: '20', mandatoryAmountToman: '80' } });
  assert.equal(calculatePartnerCanonicalWholesale(product, '200').componentAmount, '130');
});


test('twenty percent breakdown preserves the canonical total, retail and paid-stone boundary', () => {
  const product = row({ requestedAreaSquareMeters: decimal('18'), baseAmountToman: decimal('18000000'),
    totalAmountToman: decimal('19000000') });
  const retailBefore = calculatePartnerCanonicalRetail(product, '2000000');
  const wholesale = calculatePartnerCanonicalWholesale(product, '1000000', [], new Map(), { enabled: true, percentage: '20' });
  assert.deepEqual(wholesale.wholesalePricing, { materialAmount: '18000000', componentAmount: '1000000',
    totalAmount: '22600000', mandatoryCharges: [{ subjectId: 'row-1', basisAmount: '18000000', percentage: '20', amount: '3600000' }] });
  assert.equal(wholesale.totalAmount, '22600000');
  assert.deepEqual(calculatePartnerCanonicalRetail(product, '2000000'), retailBefore);
  const disabled = calculatePartnerCanonicalWholesale(product, '1000000', [], new Map(), { enabled: false, percentage: '20' });
  assert.deepEqual(disabled.wholesalePricing?.mandatoryCharges, []);
  assert.equal(disabled.totalAmount, '19000000');
  const paid = calculatePartnerCanonicalWholesale(row({ requestedAreaSquareMeters: decimal('18'), baseAmountToman: decimal('0'),
    totalAmountToman: decimal('1000000') }), '1000000', [], new Map(), { enabled: true, percentage: '20' });
  assert.equal(paid.totalAmount, '1000000');
  assert.deepEqual(paid.wholesalePricing?.mandatoryCharges, []);
});
