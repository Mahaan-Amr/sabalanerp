import assert from 'node:assert/strict';
import {
  calculateLongitudinalMaterialPricing,
  calculateSmartLongitudinalCutPlan
} from '../remainingStoneService';

const approx = (actual: number, expected: number) => {
  assert.equal(Number(actual.toFixed(6)), Number(expected.toFixed(6)));
};

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 27,
    enteredWidthUnit: 'cm',
    enteredLength: 1,
    enteredLengthUnit: 'm',
    quantity: 30,
    longitudinalRatePerMeter: 20_000,
    calibrationCutEnabled: false,
    seed: 30
  });
  assert.equal(plan.requestedAreaSqm, 8.1, 'saved requested area must not retain a binary-float artifact');
  assert.equal(plan.consumedAreaSqm, 12);
}

{
  const packedExplicitPieces = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 100,
    calibrationCutEnabled: false,
    seed: 17
  });

  assert.equal(packedExplicitPieces.derivedQuantity, false);
  assert.deepEqual(packedExplicitPieces.productionPieces, [{ widthCm: 20, lengthM: 10, quantity: 2 }]);
  assert.equal(packedExplicitPieces.stripsPerSource, 2);
  assert.equal(packedExplicitPieces.sourceBandsNeeded, 1);
  approx(packedExplicitPieces.sourceLengthConsumedM, 10);
  approx(packedExplicitPieces.consumedAreaSqm, 4);
  assert.equal(packedExplicitPieces.remainingStones.length, 0);
  approx(packedExplicitPieces.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 10);

  const calibratedPackedPieces = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 100,
    calibrationCutEnabled: true,
    seed: 17
  });
  approx(calibratedPackedPieces.sourceLengthConsumedM, 10);
  approx(calibratedPackedPieces.consumedAreaSqm, 4);
  approx(calibratedPackedPieces.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 20);

  const kerfedPackedPieces = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 100,
    sawKerfEnabled: true,
    sawKerfCm: 0.3,
    calibrationCutEnabled: false,
    seed: 17
  });
  assert.equal(kerfedPackedPieces.stripsPerSource, 1);
  assert.equal(kerfedPackedPieces.sourceBandsNeeded, 2);
  approx(kerfedPackedPieces.sourceLengthConsumedM, 20);
  approx(kerfedPackedPieces.consumedAreaSqm, 8);
  assert.equal(kerfedPackedPieces.remainingStones.length, 1);
  approx(kerfedPackedPieces.remainingStones[0].width, 19.7);
  approx(kerfedPackedPieces.remainingStones[0].length, 10);
  assert.equal(kerfedPackedPieces.remainingStones[0].quantity, 2);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 13,
    enteredWidthUnit: 'cm',
    enteredLength: 0.8,
    enteredLengthUnit: 'm',
    quantity: 308,
    sawKerfEnabled: false,
    calibrationCutEnabled: false,
    seed: 308
  });
  const pricing = calculateLongitudinalMaterialPricing({
    plan,
    fallbackPricingSquareMeters: 98.56,
    pricePerSquareMeter: 1_500_000,
    isMandatory: true,
    mandatoryPercentage: 20
  });

  assert.equal(plan.stripsPerSource, 3);
  assert.equal(plan.sourceBandsNeeded, 103);
  approx(plan.requestedAreaSqm, 32.032);
  approx(plan.consumedAreaSqm, 32.96);
  approx(plan.remainingStones.reduce((total, stone) => total + stone.squareMeters, 0), 0.928);
  approx(pricing.pricingSquareMeters, 32.96);
  approx(pricing.originalTotalPrice, 49_440_000);
  approx(pricing.totalPrice, 59_328_000);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 15,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 1
  });

  assert.equal(plan.mode, 'single-strip');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 15, lengthM: 10, quantity: 1 }]);
  assert.equal(plan.remainingStones.length, 1);
  approx(plan.remainingStones[0].width, 25);
  approx(plan.remainingStones[0].length, 10);
  approx(plan.consumedAreaSqm, 4);
  approx(plan.requestedAreaSqm, 1.5);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 20);
  assert.equal(plan.cuttingBreakdown.some((cut) => cut.type === 'cross'), false);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 13,
    enteredWidthUnit: 'cm',
    enteredLength: 2,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 20000,
    crossRatePerMeter: 0,
    sawKerfEnabled: true,
    sawKerfCm: 0.3,
    seed: 6
  });

  assert.equal(plan.mode, 'optimized');
  assert.equal(plan.sawKerfEnabled, true);
  approx(plan.consumedWidthCm, 13.3);
  approx(plan.sourceLengthConsumedM, 2);
  approx(plan.consumedAreaSqm, 0.8);
  approx(plan.requestedAreaSqm, 0.52);
  approx(plan.remainingStones[0].width, 13.4);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 13.3,
    enteredWidthUnit: 'cm',
    enteredLength: 2,
    enteredLengthUnit: 'm',
    quantity: 3,
    longitudinalRatePerMeter: 20000,
    sawKerfEnabled: true,
    sawKerfCm: 0.3,
    seed: 7
  });

  assert.equal(plan.sourceBandsNeeded, 2);
  assert.ok(plan.warnings.some((warning) => warning.includes('خوراک اره')));
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 25,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1,
    allowPhysicalSplitting: true,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 2
  });

  assert.equal(plan.mode, 'single-strip');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 25, lengthM: 10, quantity: 1 }]);
  approx(plan.remainingStones[0].width, 15);
  approx(plan.remainingStones[0].length, 10);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 20);
  assert.equal(plan.cuttingBreakdown.some((cut) => cut.type === 'cross'), false);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 0,
    enteredLengthUnit: 'm',
    requestedAreaSqm: 3.6,
    quantity: 1,
    longitudinalRatePerMeter: 100,
    seed: 12
  });

  assert.equal(plan.derivedDimension, 'length');
  approx(plan.requestedLengthM, 18);
  assert.equal(plan.mode, 'optimized');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 20, lengthM: 9, quantity: 2 }]);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 15,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 3
  });

  approx(plan.totalRequestedLengthM, 20);
  assert.deepEqual(plan.productionPieces, [{ widthCm: 15, lengthM: 10, quantity: 2 }]);
  approx(plan.remainingStones[0].width, 10);
  approx(plan.remainingStones[0].length, 10);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 18,
    enteredLengthUnit: 'm',
    quantity: 1,
    allowPhysicalSplitting: true,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 4
  });

  assert.equal(plan.mode, 'optimized');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 20, lengthM: 9, quantity: 2 }]);
  approx(plan.totalRequestedLengthM, 18);
  approx(plan.sourceLengthConsumedM, 9);
  approx(plan.consumedAreaSqm, 3.6);
  approx(plan.requestedAreaSqm, 3.6);
  assert.equal(plan.remainingStones.length, 0);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 18);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 13,
    enteredWidthUnit: 'cm',
    enteredLength: 2,
    enteredLengthUnit: 'm',
    quantity: 2,
    longitudinalRatePerMeter: 20000,
    crossRatePerMeter: 0,
    seed: 5
  });

  assert.equal(plan.mode, 'optimized');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 13, lengthM: 2, quantity: 2 }]);
  assert.equal(plan.stripsPerSource, 2);
  approx(plan.sourceLengthConsumedM, 2);
  approx(plan.consumedAreaSqm, 0.8);
  assert.equal(plan.remainingStones.length, 1);
  approx(plan.remainingStones[0].width, 14);
  approx(plan.remainingStones[0].length, 2);
  approx(plan.remainingStones[0].squareMeters, 0.28);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 6);
  assert.equal(plan.cuttingBreakdown.some((cut) => cut.type === 'cross'), false);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 20,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    seed: 8
  });

  approx(plan.sourceLengthConsumedM, 20);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 40);
  approx(plan.totalCuttingCost, 4000);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 10,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 4,
    longitudinalRatePerMeter: 100,
    seed: 9
  });

  approx(plan.sourceLengthConsumedM, 10);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 40);
  approx(plan.totalCuttingCost, 4000);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 20,
    enteredWidthUnit: 'cm',
    enteredLength: 20,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    calibrationCutEnabled: false,
    seed: 10
  });

  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 20);
  approx(plan.totalCuttingCost, 2000);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 40,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    seed: 11
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.cuttingBreakdown.length, 0);
  approx(plan.totalCuttingCost, 0);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 50,
    enteredLengthUnit: 'm',
    quantity: 0,
    requestedAreaSqm: 3.5,
    calibrationCutEnabled: false,
    seed: 13
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.mode, 'optimized');
  assert.equal(plan.derivedQuantity, true);
  assert.deepEqual(plan.productionPieces, [{ widthCm: 7, lengthM: 10, quantity: 5 }]);
  approx(plan.totalRequestedLengthM, 50);
  approx(plan.sourceLengthConsumedM, 10);
  approx(plan.requestedAreaSqm, 3.5);
  approx(plan.consumedAreaSqm, 4);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 50);
  assert.equal(plan.remainingStones.length, 1);
  approx(plan.remainingStones[0].width, 5);
  approx(plan.remainingStones[0].length, 10);
  approx(plan.remainingStones[0].squareMeters, 0.5);
  const pricing = calculateLongitudinalMaterialPricing({
    plan,
    pricePerSquareMeter: 1_600_000
  });
  approx(pricing.pricingSquareMeters, 4);
  approx(pricing.originalTotalPrice, 6_400_000);

  const calibratedPlan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 50,
    enteredLengthUnit: 'm',
    quantity: 0,
    requestedAreaSqm: 3.5,
    calibrationCutEnabled: true,
    seed: 13
  });
  approx(calibratedPlan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 60);

  const replayPlan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 5,
    requestedAreaSqm: 3.5,
    calibrationCutEnabled: false,
    seed: 13
  });

  assert.equal(replayPlan.derivedQuantity, false);
  assert.deepEqual(replayPlan.productionPieces, plan.productionPieces);
  approx(replayPlan.totalRequestedLengthM, plan.totalRequestedLengthM);
  approx(replayPlan.sourceLengthConsumedM, plan.sourceLengthConsumedM);
  approx(replayPlan.consumedAreaSqm, plan.consumedAreaSqm);
  approx(replayPlan.remainingStones[0].width, plan.remainingStones[0].width);
  approx(replayPlan.remainingStones[0].length, plan.remainingStones[0].length);
}

{
  const kerfPlan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 50,
    enteredLengthUnit: 'm',
    quantity: 0,
    requestedAreaSqm: 3.5,
    sawKerfEnabled: true,
    sawKerfCm: 0.3,
    calibrationCutEnabled: false,
    seed: 16
  });

  assert.equal(kerfPlan.requestedQuantity, 5);
  approx(kerfPlan.requestedLengthM, 10);
  approx(kerfPlan.consumedWidthCm, 7.3);
  approx(kerfPlan.remainingStones[0].width, 3.5);
  approx(kerfPlan.remainingStones[0].length, 10);
}

{
  const explicitSinglePiece = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 7,
    enteredWidthUnit: 'cm',
    enteredLength: 50,
    enteredLengthUnit: 'm',
    quantity: 1,
    requestedAreaSqm: 3.5,
    calibrationCutEnabled: false,
    seed: 14
  });

  assert.equal(explicitSinglePiece.derivedQuantity, false);
  assert.deepEqual(explicitSinglePiece.productionPieces, [{ widthCm: 7, lengthM: 50, quantity: 1 }]);
  approx(explicitSinglePiece.sourceLengthConsumedM, 50);
  approx(explicitSinglePiece.remainingStones[0].width, 33);
  approx(explicitSinglePiece.remainingStones[0].length, 50);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 0,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.mode, 'none');
  assert.ok(plan.warnings.length > 0);
}

console.log('smartLongitudinalCutPlan tests passed');
