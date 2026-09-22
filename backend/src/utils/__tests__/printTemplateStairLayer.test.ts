import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const contract = {
  id: 'layer-contract', contractNumber: '100498-regression', status: 'DRAFT', currency: 'تومان',
  totalAmount: 7_656_500, items: [], contractData: { products: [{
    rowId: 'parent-mixed', productId: 'stone-40', productType: 'stair', stairPartType: 'tread',
    stoneCode: 'ST-40', stoneName: 'کف پله گرانیت', length: 1, lengthUnit: 'm', width: 35,
    widthUnit: 'cm', quantity: 5, squareMeters: 1.75, pricePerSquareMeter: 2_100_000,
    originalTotalPrice: 4_200_000, totalPrice: 4_720_000, isMandatory: true,
    mandatoryPercentage: 10, cuttingBreakdown: [{ type: 'longitudinal', meters: 5, rate: 20_000, cost: 100_000 }]
  }, {
    rowId: 'layer-mixed', parentProductRowId: 'parent-mixed', productId: 'stone-40', productType: 'stair',
    stairPartType: 'tread', stoneCode: 'ST-40', stoneName: 'گرانیت - لایه', length: 1,
    lengthUnit: 'm', width: 5, widthUnit: 'cm', quantity: 5, squareMeters: 0.3375,
    pricePerSquareMeter: 2_310_000, originalTotalPrice: 924_000, totalPrice: 1_246_500,
    cuttingBreakdown: [{ type: 'longitudinal', meters: 1.75, rate: 20_000, cost: 35_000 }],
    tools: [{ code: '923218', name: 'نیم لول', computedMeters: 5.25, pricePerMeter: 50_000, totalPrice: 262_500 }],
    usedRemainingStones: [{ id: 'paid-1', width: 10, length: 1, quantity: 5, squareMeters: 0.5 }],
    layerTypeId: 'double-layer', layerTypeName: 'دوبل', layerTypePrice: 2_500,
    meta: {
      isLayer: true, layerEdges: { front: true, right: true },
      layerType: { id: 'double-layer', code: 'LAY-DBL', name: 'دوبل', pricePerLayer: 2_500, totalCost: 25_000 },
      layerInfo: { parentPartType: 'tread', layerSetQuantity: 5, physicalPieceQuantity: 10,
        pricingQuantity: 10, calculationUnit: 'physicalPiece' },
      layerSourcePlan: {
        fromAlreadyPaidSets: 5, fromNewSets: 5, sourceStoneQuantity: 6, sourceAreaSqm: 0.4,
        sourceWidthCm: 40, sourceLengthM: 1,
        canonicalInput: {
          layerTitle: 'دوبل', layerUnit: 'physicalPiece', layerRateToman: '2500',
          layersPerParentPiece: 1, widthMeters: '0.05', targetSides: ['front', 'right'],
          source: { kind: 'parent-material', materialRateToman: '2310000', sourceRows: [
            { sourceRowId: 'fresh-1', lengthMeters: '1', widthMeters: '0.4', quantity: 1 }
          ] }
        }
      }
    }
  }, {
    rowId: 'parent-paid', productId: 'stone-40', productType: 'stair', stairPartType: 'tread',
    stoneCode: 'ST-40', stoneName: 'کف پله گرانیت', length: 1, lengthUnit: 'm', width: 35,
    widthUnit: 'cm', quantity: 2, squareMeters: 0.7, pricePerSquareMeter: 2_100_000,
    originalTotalPrice: 1_680_000, totalPrice: 1_680_000
  }, {
    rowId: 'layer-paid', parentProductRowId: 'parent-paid', productId: 'stone-40', productType: 'stair',
    stairPartType: 'tread', stoneCode: 'ST-40', stoneName: 'گرانیت - لایه', length: 0.35,
    lengthUnit: 'm', width: 5, widthUnit: 'cm', quantity: 2, squareMeters: 0.035,
    pricePerSquareMeter: 2_100_000, originalTotalPrice: 0, totalPrice: 10_000,
    tools: [{ code: '923218', name: 'نیم لول', computedMeters: 0.1, pricePerMeter: 50_000, totalPrice: 5_000 }],
    usedRemainingStones: [{ id: 'paid-2', width: 5, length: 0.35, quantity: 2, squareMeters: 0.035 }],
    layerTypeId: 'double-layer', layerTypeName: 'دوبل', layerTypePrice: 2_500,
    meta: {
      isLayer: true, layerEdges: { right: true },
      layerType: { id: 'double-layer', code: 'LAY-DBL', name: 'دوبل', pricePerLayer: 2_500, totalCost: 5_000 },
      layerInfo: { parentPartType: 'tread', layerSetQuantity: 2, physicalPieceQuantity: 2,
        pricingQuantity: 2, calculationUnit: 'set' },
      layerSourcePlan: { fromAlreadyPaidSets: 2, fromNewSets: 0, sourceStoneQuantity: 1,
        sourceAreaSqm: 0, sourceWidthCm: 40, sourceLengthM: 1 }
    }
  }] }
} as any;

const normalizeCell = (value: string): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٬/g, ',').replace(/٫/g, '.').replace(/\s+/g, ' ').trim();
const rows = (html: string) => html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
const cellsFor = (html: string, text: string, occurrence = 0): string[] => {
  const matches = rows(html).filter(candidate => candidate.includes(text));
  return Array.from((matches[occurrence] || '').matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), match => normalizeCell(match[1]));
};

const customerHtml = renderContractHtml(contract, { variant: 'original' });
const accountingHtml = renderContractHtml(contract, { variant: 'accounting' });

assert.ok(customerHtml.includes('↳ لایه کف پله — نوع دوبل — جلو و راست'));
assert.ok(customerHtml.includes('۱۰ نوار'));
assert.ok(customerHtml.includes('تأمین سنگ لایه: بخشی از باقی‌مانده محاسبه‌شده و بخش قابل‌پرداخت از سنگ جدید تأمین شده است.'));
assert.ok(!customerHtml.includes('نوار جلو'));
assert.ok(!customerHtml.includes('نوار فیزیکی'));
assert.ok(!customerHtml.includes('سنگ مصرفی لایه — قبلاً در کف پله محاسبه شده'));
assert.equal((customerHtml.match(/سنگ جدید مصرفی لایه/g) || []).length, 1,
  'paid-only layer must not create a false new-material row');

const customerMixedLayer = cellsFor(customerHtml, '↳ لایه کف پله — نوع دوبل — جلو و راست');
assert.equal(customerMixedLayer[0], '—', 'dependent layer has no independent row number');
assert.equal(customerMixedLayer[1], 'LAY-DBL');
assert.equal(customerMixedLayer[6], '10 نوار');
assert.equal(customerMixedLayer[8], '0.3375');
assert.deepEqual(customerMixedLayer.slice(-2), ['2,500', '25,000']);
assert.deepEqual(cellsFor(customerHtml, 'سنگ جدید مصرفی لایه').slice(-2), ['2,100,000', '840,000']);
assert.deepEqual(cellsFor(customerHtml, 'حکمی سنگ جدید لایه').slice(-2), ['10%', '84,000']);

assert.ok(accountingHtml.includes('نوار جلو'));
assert.ok(accountingHtml.includes('نوار راست'));
assert.ok(accountingHtml.includes('سنگ مصرفی لایه — قبلاً در کف پله محاسبه شده'));
assert.ok(accountingHtml.includes('هزینه سنگ در محصول والد محاسبه شده است.'));
assert.deepEqual(cellsFor(accountingHtml, 'سنگ مصرفی لایه — قبلاً در کف پله محاسبه شده').slice(-2), ['0 ریال', '0 ریال']);
assert.ok(accountingHtml.includes('<tbody class="product-group">'));
assert.ok(accountingHtml.includes('page-break-inside: avoid'));
assert.match(customerHtml, /<tbody class="product-group">[\s\S]*?کف پله گرانیت[\s\S]*?↳ لایه کف پله[\s\S]*?<\/tbody>/,
  'parent and dependent layer stay in one printable row group');

const numberedProductRows = rows(customerHtml)
  .filter(row => row.includes('کف پله گرانیت'))
  .map(row => cellsFor(row, 'کف پله گرانیت')[0])
  .filter(Boolean);
assert.deepEqual(numberedProductRows, ['1', '2'], 'dependent layers do not consume top-level numbering');

console.log('printTemplateStairLayer tests passed');
