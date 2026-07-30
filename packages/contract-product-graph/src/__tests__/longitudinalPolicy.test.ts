import assert from 'node:assert/strict';
import {
  calculateLongitudinalProduct,
  createNewLongitudinalProductInput,
  transitionLongitudinalQuantity,
  type LongitudinalProductInput
} from '../longitudinalPolicy';
import { parseCanonicalDecimal } from '../canonicalDecimal';
import { parseStableIdentity } from '../stableIdentity';

const sourceBatchId = parseStableIdentity('source-batch', 'source-batch:longitudinal-test');
const c = parseCanonicalDecimal;

assert.deepEqual(
  createNewLongitudinalProductInput({
    calculationPolicyVersion: 'longitudinal-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'half-up-toman-v1',
    sourceBatchId,
    motherWidthMeters: c('0.4'),
    defaultMandatoryPercentage: c('25'),
    sawKerfMeters: c('0.003')
  }),
  {
    calculationPolicyVersion: 'longitudinal-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'half-up-toman-v1',
    sourceBatchId,
    motherWidthMeters: c('0.4'),
    widthMeters: c('0.4'),
    lastManualField: 'width',
    lastManualDimension: 'width',
    lengthDisplayUnit: 'm',
    widthDisplayUnit: 'cm',
    mandatoryEnabled: false,
    mandatoryPercentage: c('25'),
    rememberedMandatoryPercentage: c('25'),
    sawKerfEnabled: false,
    sawKerfMeters: c('0.003'),
    calibrationEnabled: false,
    calibrationSelection: 'automatic'
  }
);

const baseInput = (
  overrides: Partial<LongitudinalProductInput> = {}
): LongitudinalProductInput => ({
  calculationPolicyVersion: 'longitudinal-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'half-up-toman-v1',
  sourceBatchId,
  motherWidthMeters: c('0.4'),
  lengthMeters: c('1.5'),
  widthMeters: c('0.4'),
  quantity: undefined,
  requestedAreaSquareMeters: undefined,
  lastManualField: 'length',
  lastManualDimension: 'length',
  lengthDisplayUnit: 'm',
  widthDisplayUnit: 'cm',
  baseRateToman: c('1000000'),
  mandatoryEnabled: false,
  mandatoryPercentage: c('25'),
  rememberedMandatoryPercentage: c('25'),
  sawKerfEnabled: false,
  sawKerfMeters: c('0.003'),
  calibrationEnabled: false,
  calibrationSelection: 'automatic',
  longitudinalCutRateToman: c('10000'),
  calibrationCutRateToman: c('5000'),
  ...overrides
});

const totalMeters = calculateLongitudinalProduct(baseInput());
assert.equal(totalMeters.ok, true);
if (totalMeters.ok) {
  assert.equal(totalMeters.result.quantityMode, 'total-linear-meters');
  assert.equal(totalMeters.result.lengthMeters, '1.5');
  assert.equal(totalMeters.result.requestedAreaSquareMeters, '0.6');
  assert.equal(totalMeters.result.baseAmountToman, '600000');
}

const optimizedTotalMeters = calculateLongitudinalProduct(baseInput({
  motherWidthMeters: c('0.35'),
  widthMeters: c('0.12'),
  lengthMeters: c('6.5'),
  requestedAreaSquareMeters: c('0.78'),
  baseRateToman: c('1700000'),
  longitudinalCutRateToman: c('20000'),
  calibrationEnabled: false,
  calibrationSelection: 'manual'
}));
assert.equal(optimizedTotalMeters.ok, true);
if (optimizedTotalMeters.ok) {
  assert.equal(optimizedTotalMeters.result.quantityMode, 'total-linear-meters');
  assert.equal(optimizedTotalMeters.result.lengthMeters, '6.5');
  assert.equal(optimizedTotalMeters.result.requestedAreaSquareMeters, '0.78');
  assert.equal(optimizedTotalMeters.result.packingPlan.placements.length, 2);
  assert.equal(optimizedTotalMeters.result.packingPlan.placements[0]?.lengthMeters, '3.25');
  assert.equal(optimizedTotalMeters.result.sourcePiecesConsumed, 1);
  assert.equal(optimizedTotalMeters.result.baseAmountToman, '1933750');
  assert.equal(optimizedTotalMeters.result.longitudinalCutAmountToman, '130000');
  assert.equal(optimizedTotalMeters.result.totalAmountToman, '2063750');
}

const areaFirst = calculateLongitudinalProduct(baseInput({
  lengthMeters: undefined,
  requestedAreaSquareMeters: c('10'),
  lastManualField: 'area'
}));
assert.equal(areaFirst.ok, true);
if (areaFirst.ok) {
  assert.equal(areaFirst.result.lengthMeters, '25');
  assert.equal(areaFirst.result.requestedAreaSquareMeters, '10');
}

const areaWithPieces = calculateLongitudinalProduct(baseInput({
  lengthMeters: undefined,
  requestedAreaSquareMeters: c('12'),
  quantity: 20,
  lastManualField: 'area'
}));
assert.equal(areaWithPieces.ok, true);
if (areaWithPieces.ok) {
  assert.equal(areaWithPieces.result.quantityMode, 'piece-count');
  assert.equal(areaWithPieces.result.lengthMeters, '1.5');
  assert.equal(areaWithPieces.result.requestedAreaSquareMeters, '12');
}

const lengthWinsAfterArea = calculateLongitudinalProduct(baseInput({
  lengthMeters: c('30'),
  requestedAreaSquareMeters: c('10'),
  lastManualField: 'length'
}));
assert.equal(lengthWinsAfterArea.ok, true);
if (lengthWinsAfterArea.ok) {
  assert.equal(lengthWinsAfterArea.result.requestedAreaSquareMeters, '12');
}

const packedPieces = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.12'),
  quantity: 20,
  mandatoryEnabled: true
}));
assert.equal(packedPieces.ok, true);
if (packedPieces.ok) {
  assert.equal(packedPieces.result.sourcePiecesConsumed, 7);
  assert.equal(packedPieces.result.calibrationEnabled, false);
  assert.equal(packedPieces.result.remainders.length, 7);
  assert.equal(packedPieces.result.remainders[6]?.widthMeters, '0.16');
  assert.equal(packedPieces.result.requestedAreaSquareMeters, '3.6');
  assert.equal(packedPieces.result.baseAmountToman, '4200000');
  assert.equal(packedPieces.result.mandatoryAmountToman, '1050000');
}

const paidRemainderKeepsConsumedMotherAreaBillable = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.18'),
  quantity: 2,
  longitudinalCutRateToman: c('20000')
}));
assert.equal(paidRemainderKeepsConsumedMotherAreaBillable.ok, true);
if (paidRemainderKeepsConsumedMotherAreaBillable.ok) {
  assert.equal(
    paidRemainderKeepsConsumedMotherAreaBillable.result.requestedAreaSquareMeters,
    '0.54'
  );
  assert.equal(paidRemainderKeepsConsumedMotherAreaBillable.result.baseAmountToman, '600000');
  assert.equal(
    paidRemainderKeepsConsumedMotherAreaBillable.result.longitudinalCutAmountToman,
    '60000'
  );
  assert.equal(paidRemainderKeepsConsumedMotherAreaBillable.result.totalAmountToman, '660000');
}

const exactWidthUse = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.2'),
  quantity: 2
}));
assert.equal(exactWidthUse.ok, true);
if (exactWidthUse.ok) {
  assert.equal(exactWidthUse.result.calibrationEnabled, true);
  assert.equal(exactWidthUse.result.remainders.length, 0);
}

const threeExactStripsFromOneBand = calculateLongitudinalProduct(baseInput({
  motherWidthMeters: c('0.6'),
  widthMeters: c('0.2'),
  quantity: 3,
  calibrationCutRateToman: c('10000')
}));
assert.equal(threeExactStripsFromOneBand.ok, true);
if (threeExactStripsFromOneBand.ok) {
  assert.equal(threeExactStripsFromOneBand.result.requestedAreaSquareMeters, '0.9');
  assert.equal(threeExactStripsFromOneBand.result.sourcePiecesConsumed, 1);
  assert.equal(threeExactStripsFromOneBand.result.remainders.length, 0);
  assert.equal(threeExactStripsFromOneBand.result.calibrationEnabled, true);
  assert.equal(threeExactStripsFromOneBand.result.packingPlan.longitudinalCutMeters, '3');
  assert.equal(threeExactStripsFromOneBand.result.packingPlan.calibrationMeters, '1.5');
}

const kerfPreventsFalseExactUse = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.2'),
  quantity: 2,
  sawKerfEnabled: true
}));
assert.equal(kerfPreventsFalseExactUse.ok, true);
if (kerfPreventsFalseExactUse.ok) {
  assert.equal(kerfPreventsFalseExactUse.result.sourcePiecesConsumed, 2);
  assert.equal(kerfPreventsFalseExactUse.result.calibrationEnabled, false);
}

const kerfUsesTwoBandsForThreeStrips = calculateLongitudinalProduct(baseInput({
  motherWidthMeters: c('0.6'),
  widthMeters: c('0.2'),
  quantity: 3,
  sawKerfEnabled: true,
  calibrationEnabled: true,
  calibrationSelection: 'manual',
  calibrationCutRateToman: c('10000')
}));
assert.equal(kerfUsesTwoBandsForThreeStrips.ok, true);
if (kerfUsesTwoBandsForThreeStrips.ok) {
  assert.equal(kerfUsesTwoBandsForThreeStrips.result.requestedAreaSquareMeters, '0.9');
  assert.equal(kerfUsesTwoBandsForThreeStrips.result.sourcePiecesConsumed, 2);
  assert.equal(kerfUsesTwoBandsForThreeStrips.result.remainders.length, 2);
  assert.equal(kerfUsesTwoBandsForThreeStrips.result.calibrationEnabled, true);
  assert.equal(kerfUsesTwoBandsForThreeStrips.result.packingPlan.calibrationMeters, '3');
}

const manualCalibrationSurvives = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.12'),
  quantity: 3,
  calibrationEnabled: true,
  calibrationSelection: 'manual'
}));
assert.equal(manualCalibrationSurvives.ok, true);
if (manualCalibrationSurvives.ok) {
  assert.equal(manualCalibrationSurvives.result.calibrationEnabled, true);
}

const invalidWidth = calculateLongitudinalProduct(baseInput({ widthMeters: c('0.41') }));
assert.equal(invalidWidth.ok, false);
if (!invalidWidth.ok) {
  assert.equal(invalidWidth.conflicts[0]?.code, 'maximum-mother-width-exceeded');
  assert.equal(invalidWidth.conflicts[0]?.field, 'widthMeters');
}

const zeroWidth = calculateLongitudinalProduct(baseInput({ widthMeters: c('0') }));
assert.equal(zeroWidth.ok, false);
if (!zeroWidth.ok) {
  assert.equal(zeroWidth.conflicts[0]?.field, 'widthMeters');
}

const fullWidthCannotCalibrate = calculateLongitudinalProduct(baseInput({
  calibrationEnabled: true,
  calibrationSelection: 'manual'
}));
assert.equal(fullWidthCannotCalibrate.ok, true);
if (fullWidthCannotCalibrate.ok) {
  assert.equal(fullWidthCannotCalibrate.result.calibrationEnabled, false);
}

const missingPrice = calculateLongitudinalProduct(baseInput({ baseRateToman: undefined }));
assert.equal(missingPrice.ok, false);
if (!missingPrice.ok) {
  assert.equal(missingPrice.conflicts[0]?.code, 'base-rate-required');
}

const paidSourceMaterial = calculateLongitudinalProduct(baseInput({
  baseMaterialPricing: 'paid-source-zero',
  baseRateToman: c('0')
}));
assert.equal(paidSourceMaterial.ok, true);
if (paidSourceMaterial.ok) {
  assert.equal(paidSourceMaterial.result.baseMaterialPricing, 'paid-source-zero');
  assert.equal(paidSourceMaterial.result.baseAmountToman, '0');
}

const paidSourceCannotBeMandatory = calculateLongitudinalProduct(baseInput({
  baseMaterialPricing: 'paid-source-zero',
  baseRateToman: c('0'),
  mandatoryEnabled: true
}));
assert.equal(paidSourceCannotBeMandatory.ok, false);

const missingCutRate = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.2'),
  quantity: 1,
  longitudinalCutRateToman: undefined
}));
assert.equal(missingCutRate.ok, false);
if (!missingCutRate.ok) {
  assert.equal(missingCutRate.conflicts[0]?.code, 'longitudinal-cut-rate-missing');
}

const missingCutRateAppearsWithValidGeometryBeforeBasePrice = calculateLongitudinalProduct(
  baseInput({
    motherWidthMeters: c('0.6'),
    widthMeters: c('0.2'),
    quantity: 3,
    baseRateToman: undefined,
    longitudinalCutRateToman: undefined,
    calibrationCutRateToman: undefined
  })
);
assert.equal(missingCutRateAppearsWithValidGeometryBeforeBasePrice.ok, false);
if (!missingCutRateAppearsWithValidGeometryBeforeBasePrice.ok) {
  assert.equal(
    missingCutRateAppearsWithValidGeometryBeforeBasePrice.conflicts.some(
      conflict => conflict.code === 'longitudinal-cut-rate-missing'
    ),
    true
  );
}

const freeInventoryCutRate = calculateLongitudinalProduct(baseInput({
  widthMeters: c('0.2'),
  quantity: 2,
  longitudinalCutRateToman: c('0'),
  calibrationCutRateToman: c('0')
}));
assert.equal(freeInventoryCutRate.ok, true);
if (freeInventoryCutRate.ok) {
  assert.equal(freeInventoryCutRate.result.packingPlan.longitudinalCutMeters, '1.5');
  assert.equal(freeInventoryCutRate.result.packingPlan.calibrationMeters, '1.5');
  assert.equal(freeInventoryCutRate.result.longitudinalCutAmountToman, '0');
  assert.equal(freeInventoryCutRate.result.calibrationCutAmountToman, '0');
}

const fullWidthDoesNotRequireLongRate = calculateLongitudinalProduct(baseInput({
  longitudinalCutRateToman: undefined,
  calibrationCutRateToman: undefined
}));
assert.equal(fullWidthDoesNotRequireLongRate.ok, true);

assert.deepEqual(
  transitionLongitudinalQuantity({
    previousQuantity: undefined,
    nextQuantity: 20,
    mandatoryEnabled: false,
    rememberedMandatoryPercentage: c('25')
  }),
  {
    quantity: 20,
    mandatoryEnabled: true,
    mandatoryPercentage: c('25'),
    rememberedMandatoryPercentage: c('25')
  }
);

assert.deepEqual(
  transitionLongitudinalQuantity({
    previousQuantity: 20,
    nextQuantity: undefined,
    mandatoryEnabled: true,
    mandatoryPercentage: c('25'),
    rememberedMandatoryPercentage: c('25')
  }),
  {
    quantity: undefined,
    mandatoryEnabled: false,
    mandatoryPercentage: c('25'),
    rememberedMandatoryPercentage: c('25')
  }
);

console.log('longitudinal product policy tests passed');
