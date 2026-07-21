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

const normalizePrintedRow = (value: string): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٬/g, ',')
  .replace(/٫/g, '.')
  .replace(/\s+/g, ' ')
  .trim();

const mandatoryCutHtml = renderContractHtml({
  ...contract,
  contractNumber: 'TEST-MANDATORY-CUT',
  contractData: {
    products: [{
      ...contract.contractData.products[0],
      smartCutDerivedQuantity: false,
      smartCutPlan: undefined,
      isMandatory: true,
      mandatoryPercentage: 20,
      originalTotalPrice: 10_000,
      totalPrice: 13_000,
      cuttingCost: 1_000,
      cuttingBreakdown: [{
        type: 'longitudinal',
        code: 'CUT-LONG-BILLABLE',
        meters: 10,
        rate: 100,
        cost: 1_000
      }, {
        type: 'cross',
        code: 'CUT-CROSS-FREE',
        meters: 0.4,
        rate: 80,
        cost: 32
      }]
    }]
  }
} as any);
const mandatoryLongitudinalRow = mandatoryCutHtml.match(/<tr[^>]*>[\s\S]*?CUT-LONG-BILLABLE[\s\S]*?<\/tr>/)?.[0] || '';
const normalizedMandatoryLongitudinalRow = normalizePrintedRow(mandatoryLongitudinalRow);

assert.ok(normalizedMandatoryLongitudinalRow.includes('100'), 'billable longitudinal cut should show its saved rate');
assert.ok(normalizedMandatoryLongitudinalRow.includes('1,000'), 'billable longitudinal cut should show its saved total');
const mandatoryCrossRow = mandatoryCutHtml.match(/<tr[^>]*>[\s\S]*?CUT-CROSS-FREE[\s\S]*?<\/tr>/)?.[0] || '';
const normalizedMandatoryCrossRow = normalizePrintedRow(mandatoryCrossRow);
assert.match(normalizedMandatoryCrossRow, /0\.4.*0.*0/, 'non-billable physical cross cut should show zero rate and zero total');
const mandatoryCutSummaryHtml = renderContractHtml({
  ...contract,
  contractNumber: 'TEST-MANDATORY-CUT-SUMMARY',
  contractData: {
    products: [{
      ...contract.contractData.products[0],
      smartCutDerivedQuantity: false,
      smartCutPlan: undefined,
      isMandatory: true,
      mandatoryPercentage: 20,
      originalTotalPrice: 10_000,
      totalPrice: 12_000,
      cuttingCost: 0,
      cuttingBreakdown: [{
        type: 'cross',
        code: 'CUT-CROSS-FREE-SUMMARY',
        meters: 0.4,
        rate: 80,
        cost: 32
      }]
    }]
  }
} as any, { variant: 'summary' });
const mandatoryCrossSummaryRow = mandatoryCutSummaryHtml.match(/<tr[^>]*>[\s\S]*?CUT-CROSS-FREE-SUMMARY[\s\S]*?<\/tr>/)?.[0] || '';
assert.match(
  normalizePrintedRow(mandatoryCrossSummaryRow),
  /0\.4.*0.*0/,
  'summarized non-billable physical cut should show zero rate and zero total'
);

const workshopHtml = renderContractHtml({
  ...contract,
  contractData: {
    products: [{
      ...contract.contractData.products[0],
      smartCutDerivedQuantity: false,
      smartCutPlan: undefined,
      cuttingBreakdown: [{
        type: 'longitudinal',
        code: 'CUT-WORKSHOP',
        meters: 10,
        rate: 100,
        cost: 1_000
      }]
    }]
  }
} as any, { variant: 'workshop' });
assert.ok(workshopHtml.includes('CUT-WORKSHOP'), 'workshop output should retain the physical cut row');
assert.ok(!workshopHtml.includes('نرخ - تومان'), 'workshop output should omit the rate column');
assert.ok(!workshopHtml.includes('مبلغ کل - تومان'), 'workshop output should omit the total column');

const summarizedDifferentRatesHtml = renderContractHtml({
  ...contract,
  contractNumber: 'TEST-DIFFERENT-CUT-RATES',
  contractData: {
    products: [100, 200].map((rate, index) => ({
      ...contract.contractData.products[0],
      productId: `stone-rate-${index}`,
      smartCutDerivedQuantity: false,
      smartCutPlan: undefined,
      cuttingCost: rate * 10,
      cuttingBreakdown: [{
        type: 'longitudinal',
        code: 'CUT-LONG-GROUP',
        meters: 10,
        rate,
        cost: rate * 10
      }]
    }))
  }
} as any, { variant: 'summary' });

assert.equal(
  summarizedDifferentRatesHtml.match(/CUT-LONG-GROUP/g)?.length,
  2,
  'summarized output should keep cuts with different saved rates in separate rows'
);

const summarizedSameRateHtml = renderContractHtml({
  ...contract,
  contractNumber: 'TEST-SAME-CUT-RATE',
  contractData: {
    products: [0, 1].map((index) => ({
      ...contract.contractData.products[0],
      productId: `stone-same-rate-${index}`,
      smartCutDerivedQuantity: false,
      smartCutPlan: undefined,
      cuttingCost: 1_000,
      cuttingBreakdown: [{
        type: 'longitudinal',
        code: 'CUT-LONG-SAME-RATE',
        meters: 10,
        rate: 100,
        cost: 1_000
      }]
    }))
  }
} as any, { variant: 'summary' });
assert.equal(
  summarizedSameRateHtml.match(/CUT-LONG-SAME-RATE/g)?.length,
  1,
  'summarized output may merge cuts with the same type and saved rate'
);

console.log('printTemplateLongitudinalOptimizer tests passed');
