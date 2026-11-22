import assert from 'node:assert/strict';
import { parseCanonicalDecimal as c, parseStableIdentity } from '@sabalanerp/contract-product-graph';
import { resolveLongitudinalDraftForSave } from '../../utils/productConfigurationController';

const input = {
  calculationPolicyVersion: 'calculation-v1', packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1', roundingPolicyVersion: 'rounding-v1',
  sourceBatchId: parseStableIdentity('source-batch', 'cut-snapshot'),
  motherWidthMeters: c('0.4'), lengthMeters: c('0.4'), widthMeters: c('0.12'), quantity: 157,
  lengthDisplayUnit: 'cm' as const, widthDisplayUnit: 'cm' as const,
  lastManualField: 'quantity' as const, lastManualDimension: 'width' as const,
  baseRateToman: c('3000000'), mandatoryEnabled: true, mandatoryPercentage: c('20'),
  rememberedMandatoryPercentage: c('20'), sawKerfEnabled: false, sawKerfMeters: c('0.003'),
  calibrationEnabled: false, calibrationSelection: 'manual' as const,
  longitudinalCutRateToman: c('30000'), calibrationCutRateToman: c('30000')
};
const staleDetails = [{ id: 'stale-cut', originalWidth: 40, cutWidth: 12, remainingWidth: 28,
  length: 2120, cuttingCost: 1884000, cuttingCostPerMeter: 30000 }];
const saved = resolveLongitudinalDraftForSave({ rowId: 'row-cut', longitudinalPolicyInput: input,
  cutDetails: staleDetails, cutDescription: 'stale description', physicalCuttingCost: 1884000 });
assert.ok(saved.ok);
if (!saved.ok) throw new Error(saved.message);
assert.deepEqual(saved.draft.cuttingBreakdown, [{ type: 'longitudinal', meters: 62.8, rate: 30000, cost: 1884000 }]);
assert.equal(saved.draft.cutDetails?.[0].meters, 62.8);
assert.equal(saved.draft.cutDetails?.[0].length, 62.8, 'new details use an explicit meter witness');
assert.equal(staleDetails[0].length, 2120, 'saved historical input must remain unchanged');

const uncut = resolveLongitudinalDraftForSave({ ...saved.draft,
  longitudinalPolicyInput: { ...input, widthMeters: c('0.4') } });
assert.ok(uncut.ok);
if (!uncut.ok) throw new Error(uncut.message);
assert.deepEqual(uncut.draft.cutDetails, []);
assert.deepEqual(uncut.draft.cuttingBreakdown, []);
assert.equal(uncut.draft.cutDescription, '');
assert.equal(uncut.draft.isCut, false);
assert.equal(uncut.draft.cutType, null);
assert.equal(uncut.draft.cuttingCost, 0);
assert.equal(uncut.draft.physicalCuttingCost, 0);

const resized = resolveLongitudinalDraftForSave({ ...saved.draft,
  longitudinalPolicyInput: { ...input, quantity: 10, lengthMeters: c('0.8'), widthMeters: c('0.13') } });
assert.ok(resized.ok);
if (!resized.ok) throw new Error(resized.message);
assert.equal(resized.draft.cutDetails?.[0].cutWidth, 13);
assert.equal(resized.draft.cuttingBreakdown?.[0].meters, 8);
assert.equal(resized.draft.cuttingBreakdown?.[0].cost, 240000);

const calibrated = resolveLongitudinalDraftForSave({ ...saved.draft,
  longitudinalPolicyInput: { ...input, calibrationEnabled: true, calibrationCutRateToman: c('40000') } });
assert.ok(calibrated.ok);
if (!calibrated.ok) throw new Error(calibrated.message);
assert.equal(calibrated.draft.cuttingBreakdown?.length, 2, 'different calibration rates retain their own witnesses');
assert.equal(calibrated.draft.cuttingBreakdown?.[0].meters, 62.8);
assert.equal(calibrated.draft.cuttingBreakdown?.[1].meters, 21.2);
assert.equal(calibrated.draft.cuttingBreakdown?.[1].cost, 848000);
const recalibrated = resolveLongitudinalDraftForSave({ ...calibrated.draft,
  longitudinalPolicyInput: { ...input, calibrationEnabled: false } });
assert.ok(recalibrated.ok);
if (!recalibrated.ok) throw new Error(recalibrated.message);
assert.deepEqual(recalibrated.draft.cuttingBreakdown, saved.draft.cuttingBreakdown);
assert.equal(recalibrated.draft.cutDetails?.length, 1, 'disabled calibration leaves no old witness');
console.log('longitudinal cut snapshots passed');
