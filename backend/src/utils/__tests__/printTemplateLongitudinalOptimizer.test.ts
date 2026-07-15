import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const contract = {
  id: 'contract-test',
  contractNumber: 'TEST-OPTIMIZER',
  contractDate: '1405/04/23',
  status: 'DRAFT',
  currency: 'تومان',
  customer: {
    firstName: 'Test',
    lastName: 'Customer'
  },
  items: [],
  contractData: {
    products: [{
      productId: 'stone-40',
      productType: 'longitudinal',
      stoneName: 'سنگ طولی تست',
      length: 10,
      lengthUnit: 'm',
      width: 7,
      widthUnit: 'cm',
      quantity: 5,
      squareMeters: 3.5,
      originalWidth: 40,
      isCut: true,
      smartCutDerivedQuantity: true,
      cuttingCost: 5_000,
      cuttingBreakdown: [{
        type: 'longitudinal',
        code: 'CUT-LONG-TEST',
        meters: 50,
        rate: 100,
        cost: 5_000
      }],
      smartCutPlan: {
        enabled: true,
        mode: 'optimized',
        sourceWidthCm: 40,
        requestedWidthCm: 7,
        consumedWidthCm: 7,
        requestedLengthM: 10,
        requestedQuantity: 5,
        totalRequestedLengthM: 50,
        sourceBandsNeeded: 1,
        stripsPerSource: 5,
        sourceLengthConsumedM: 10,
        consumedAreaSqm: 4,
        requestedAreaSqm: 3.5,
        derivedQuantity: true,
        productionPieces: [{ widthCm: 7, lengthM: 10, quantity: 5 }],
        remainingStones: [{ width: 5, length: 10, quantity: 1, squareMeters: 0.5 }],
        cuttingBreakdown: [{
          type: 'longitudinal',
          code: 'CUT-LONG-TEST',
          meters: 50,
          rate: 100,
          cost: 5_000
        }],
        totalCuttingCost: 5_000,
        warnings: []
      }
    }]
  }
};

const html = renderContractHtml(contract as any);

assert.ok(html.includes('سنگ مصرفی'));
assert.match(html, /سنگ مصرفی[\s\S]*?<td>۱۰<\/td>[\s\S]*?<td>۰٫۴<\/td>[\s\S]*?<td>۱<\/td>[\s\S]*?<td>۴<\/td>/);
assert.ok(!html.includes('خروجی فیزیکی تولید'));
assert.ok(!html.includes('۵ عدد × عرض ۷cm × طول ۱۰m'));
assert.ok(html.includes('CUT-LONG-TEST'));

console.log('printTemplateLongitudinalOptimizer tests passed');
