import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateSlab, parseCanonicalDecimal as decimal, parseStableIdentity, type SlabPolicyInput } from '@sabalanerp/contract-product-graph';
import { renderContractHtml } from '../printTemplate';

const normalize = (html: string) => html.replace(/<[^>]*>/g, ' ')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٬/g, ',').replace(/٫/g, '.').replace(/\s+/g, ' ').trim();
const cutRows = (html: string) => (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [])
  .map(row => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => normalize(cell[1])))
  .filter(cells => cells[3] === 'برش');

// Same snapshot shape emitted by the slab save path, including physical cuts
// which are present even when they are not the selected billing basis.
const savedSlab = (geometry: 'manual' | 'automatic', method: 'squareMeter' | 'lineBased', vertical = false) => {
  const input: SlabPolicyInput = {
    calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity('source-batch', 'print-slab'),
    lengthMeters: decimal('2.95'),
    ...(geometry === 'manual' ? { widthMeters: decimal('1.75') } : { areaSquareMeters: decimal('15.4875') }),
    quantity: 3, lastManualField: geometry === 'manual' ? 'width' : 'area', lastManualDimension: 'length',
    lengthDisplayUnit: 'm', widthDisplayUnit: 'm', kerfMeters: decimal('0'),
    sourceRows: [{ sourceRowId: parseStableIdentity('slab-source-row', 'source'),
      lengthMeters: decimal('2.95'), widthMeters: decimal('1.8'), quantity: 3,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'm' }],
    baseMaterialRateToman: decimal('22000000'), cuttingPricingMethod: method,
    squareMeterCutRateToman: decimal('500000'), longitudinalCutRateToman: decimal('30000'), crossCutRateToman: decimal('40000'),
    verticalCutSides: vertical ? ['top'] : [], verticalCutRateToman: decimal('10000')
  };
  const calculation = calculateSlab(input);
  assert.equal(calculation.ok, true, JSON.stringify(calculation));
  if (!calculation.ok) throw new Error('Expected valid slab fixture');
  const slab = calculation.result;
  assert.equal(slab.widthMeters, '1.75');
  const cutDetails: { type: string; meters: number; rate: number; cost: number }[] = slab.packingPlan.cuts.map(cut => {
    const rate = cut.axis === 'longitudinal' ? 30000 : 40000;
    return { type: cut.axis, meters: Number(cut.meters), rate, cost: Math.round(Number(cut.meters) * rate) };
  });
  if (slab.verticalCutPricingLine) cutDetails.push({ type: 'vertical',
    meters: Number(slab.verticalCutPricingLine.quantity), rate: Number(slab.verticalCutPricingLine.rateToman),
    cost: Number(slab.verticalCutPricingLine.amountToman) });
  return {
    isCut: true, originalLength: 2.95, originalWidth: 180,
    productType: 'slab', productId: 'slab-test', stoneName: 'اسلب آزمایشی', rowId: 'slab-row',
    length: Number(slab.lengthMeters), lengthUnit: 'm', width: Number(slab.widthMeters), widthUnit: 'm', quantity: 3,
    squareMeters: Number(slab.finishedAreaSquareMeters), pricePerSquareMeter: 22000000,
    originalTotalPrice: Number(slab.materialAmountToman), totalPrice: Number(slab.totalAmountToman),
    cuttingCost: Number(slab.cuttingAmountToman) + Number(slab.verticalCutAmountToman),
    slabVerticalCutCost: Number(slab.verticalCutAmountToman),
    slabCuttingMode: method === 'squareMeter' ? 'perSquareMeter' : 'lineBased', slabCuttingPricePerSquareMeter: 500000,
    slabPolicyInput: input, cutDetails,
    slabStandardDimensions: [{ standardLengthCm: 295, standardWidthCm: 180, quantity: 3 }]
  };
};
const contractFor = (product: ReturnType<typeof savedSlab>) => ({
  contractNumber: 'TEST-100795-SLAB', currency: 'تومان', status: 'DRAFT',
  totalAmount: product.totalPrice, contractData: { products: [product] }
});

for (const geometry of ['manual', 'automatic'] as const) {
  for (const method of ['squareMeter', 'lineBased'] as const) {
    test(`${geometry} dimensions / ${method}: original, accounting, summary, workshop and custom`, () => {
      const product = savedSlab(geometry, method);
      const contract = contractFor(product);
      const unchanged = JSON.stringify(contract);
      for (const variant of ['original', 'accounting', 'summary', 'workshop', 'custom'] as const) {
        const html = renderContractHtml(contract, { variant });
        const rows = cutRows(html);
        assert.ok(rows.length > 0, variant);
        if (method === 'squareMeter') {
          assert.equal(rows.length, 1, `${variant}: physical cuts must not be billed again`);
          assert.equal(rows[0][7], '—', `${variant}: no linear measurement`);
          assert.equal(rows[0][8], '15.4875', `${variant}: finished area, not consumed source area`);
          if (variant !== 'workshop') {
            assert.ok(rows[0][9].includes(variant === 'accounting' ? '5,000,000' : '500,000'), `${variant}: selected rate`);
            assert.ok(rows[0][10].includes(variant === 'accounting' ? '77,437,500' : '7,743,750'), `${variant}: saved cutting amount`);
          }
          assert.ok(!rows.some(row => row[9]?.includes('30,000')), variant);
        } else {
          assert.equal(rows.length, variant === 'summary' ? 1 : 3, `${variant}: retain physical linear cuts`);
          assert.equal(rows[0][8], '—', `${variant}: no area billing`);
          assert.equal(rows[0][7], variant === 'summary' ? '8.85' : '2.95');
          if (variant !== 'workshop') assert.ok(rows[0][9].includes(variant === 'accounting' ? '300,000' : '30,000'));
        }
      }
      assert.equal(JSON.stringify(contract), unchanged, 'printing must not mutate saved snapshots');
    });
  }
}

test('square-meter slab keeps vertical cutting separate without double charging', () => {
  const product = savedSlab('manual', 'squareMeter', true);
  const rows = cutRows(renderContractHtml(contractFor(product)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0][10], '7,743,750');
  assert.equal(rows[1][2], 'برش قائم');
  assert.equal(rows[1][7], '5.4');
  assert.equal(rows[1][8], '—');
  assert.equal(rows[1][10], '54,000');
  assert.equal(rows.reduce((sum, row) => sum + Number(row[10].replace(/,/g, '')), 0), product.cuttingCost);
});

test('saved square-meter amount and zero rate are preserved rather than repriced', () => {
  const product = { ...savedSlab('manual', 'squareMeter'), cuttingCost: 12345, slabCuttingPricePerSquareMeter: 0 };
  const rows = cutRows(renderContractHtml(contractFor(product)));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][9], '0');
  assert.equal(rows[0][10], '12,345');
});

test('legacy square-meter snapshot without canonical policy is printed from saved fields', () => {
  const { slabPolicyInput, ...product } = savedSlab('manual', 'squareMeter');
  const html = renderContractHtml({ contractNumber: 'LEGACY', contractData: { products: [product] } });
  const rows = cutRows(html);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][9], '500,000');
  assert.equal(rows[0][10], '7,743,750');
});

test('policy-only square-meter snapshot uses its saved pricing method and rate', () => {
  const { slabCuttingMode, slabCuttingPricePerSquareMeter, ...product } = savedSlab('automatic', 'squareMeter');
  const rows = cutRows(renderContractHtml({ contractData: { products: [product] } }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0][9], '500,000');
  assert.equal(rows[0][10], '7,743,750');
});

test('linear slab retains distinct longitudinal, cross and vertical rates and amounts', () => {
  const product = { ...savedSlab('manual', 'lineBased'),
    cutDetails: [
      { type: 'longitudinal', meters: 2.95, rate: 30000, cost: 88500 },
      { type: 'cross', meters: 1.75, rate: 40000, cost: 70000 },
      { type: 'vertical', meters: 1.8, rate: 10000, cost: 18000 }
    ] };
  // An explicit saved line-based selection wins over a stale policy selection.
  const withStalePolicy = { ...product, slabPolicyInput: { ...product.slabPolicyInput, cuttingPricingMethod: 'squareMeter' as const } };
  const rows = cutRows(renderContractHtml(contractFor(withStalePolicy)));
  assert.deepEqual(rows.map(row => [row[2], row[7], row[8], row[9], row[10]]), [
    ['برش طولی', '2.95', '—', '30,000', '88,500'],
    ['برش عرضی', '1.75', '—', '40,000', '70,000'],
    ['برش قائم', '1.8', '—', '10,000', '18,000']
  ]);
});
