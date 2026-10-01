import assert from 'node:assert/strict';
import { calculateSmartLongitudinalCutPlan, calculateLongitudinalMaterialPricing } from '../remainingStoneService';
import { calculateCanonicalLongitudinalSavePricing } from '../../utils/canonicalLongitudinalSavePricing';
import { parseCanonicalDecimal as c, parseStableIdentity, planLegacyProductGraphMigration } from '@sabalanerp/contract-product-graph';
const plan = calculateSmartLongitudinalCutPlan({
  originalWidthCm: 40,
  enteredWidth: 13,
  enteredWidthUnit: 'cm',
  enteredLength: 20,
  enteredLengthUnit: 'm',
  quantity: 0,
  requestedAreaSqm: 2.6,
  longitudinalRatePerMeter: 20_000,
  calibrationCutEnabled: false,
  seed: 1
});
const pricing = calculateLongitudinalMaterialPricing({ plan, pricePerSquareMeter: 1_350_000 });
const input = {
  calculationPolicyVersion: 'calculation-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  sourceBatchId: parseStableIdentity('source-batch', 'repro'),
  motherWidthMeters: c('0.4'),
  lengthMeters: c('20'),
  widthMeters: c('0.13'),
  requestedAreaSquareMeters: c('2.6'),
  lengthDisplayUnit: 'm' as const,
  widthDisplayUnit: 'cm' as const,
  lastManualField: 'length' as const,
  lastManualDimension: 'length' as const,
  baseRateToman: c('1350000'),
  mandatoryEnabled: false,
  mandatoryPercentage: c('20'),
  rememberedMandatoryPercentage: c('20'),
  sawKerfEnabled: false,
  sawKerfMeters: c('0.003'),
  calibrationEnabled: false,
  calibrationSelection: 'manual' as const,
  longitudinalCutRateToman: c('20000'),
  calibrationCutRateToman: c('20000')
};
const saved = calculateCanonicalLongitudinalSavePricing(input, 0, 0);
if (!saved.ok) throw new Error("canonical calculation failed");
const total = saved.totalPrice;
assert.equal(total, 4_000_000);
assert.equal(saved.materialBase, 3_600_000);
assert.equal(saved.cuttingCost, 400_000);
const oldTotal = pricing.totalPrice + plan.totalCuttingCost;
assert.notEqual(oldTotal, total, 'the regression must exercise the original float artifact');
const replay = (amount: number) => planLegacyProductGraphMigration({
  contractId: 'repro', revision: 1,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-precise-prepared-v2', rounding: 'rounding-v2' },
  products: [{ rowId: 'row-repro', productId: 'catalog', productType: 'longitudinal', totalPrice: amount, longitudinalPolicyInput: input }]
});
assert.equal(replay(total).ok, true, 'the reported 20m × 13cm row must pass precise server reconciliation');
assert.equal(replay(oldTotal).ok, false, 'the original writer must reproduce the user error');
assert.equal(replay(total + 0.01).ok, false, 'real financial differences must still block submission');
assert.equal(replay(total + 1).ok, false);
const withAddOns = calculateCanonicalLongitudinalSavePricing(input, 100.4, 100.4);
assert.equal(withAddOns.ok, true);
if (withAddOns.ok) assert.equal(withAddOns.totalPrice, 4_000_200.8, 'sum precise charges before final payable rounding');
assert.equal(input.requestedAreaSquareMeters, '2.6', 'pricing must preserve physical dimensions');
for (const mandatoryEnabled of [false, true]) {
  for (const calibrationEnabled of [false, true]) {
    const variant = { ...input, mandatoryEnabled, calibrationEnabled };
    const result = calculateCanonicalLongitudinalSavePricing(variant, 0, 0);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error('variant calculation failed');
    const replayed = planLegacyProductGraphMigration({
      contractId: 'repro', revision: 1,
      calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-precise-prepared-v2', rounding: 'rounding-v2' },
      products: [{ rowId: 'row-repro', productId: 'catalog', productType: 'longitudinal', totalPrice: result.totalPrice, longitudinalPolicyInput: variant }]
    });
    assert.equal(replayed.ok, true, 'mandatory and calibration charges must match server replay');
  }
}
assert.equal(calculateCanonicalLongitudinalSavePricing({ ...input, widthMeters: c('0.5') }, 0, 0).ok, false);
console.log('canonicalLongitudinalSavePricing regression tests passed');
