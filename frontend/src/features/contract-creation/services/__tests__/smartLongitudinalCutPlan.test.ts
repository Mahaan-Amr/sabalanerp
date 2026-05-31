import assert from 'node:assert/strict';
import { calculateSmartLongitudinalCutPlan } from '../remainingStoneService';

const approx = (actual: number, expected: number) => {
  assert.equal(Number(actual.toFixed(6)), Number(expected.toFixed(6)));
};

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

  assert.equal(plan.mode, 'optimized');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 15, lengthM: 5, quantity: 2 }]);
  assert.equal(plan.remainingStones.length, 1);
  approx(plan.remainingStones[0].width, 10);
  approx(plan.remainingStones[0].length, 5);
  approx(plan.consumedAreaSqm, 2);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 10);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'cross')?.meters || 0, 0.4);
}

{
  const plan = calculateSmartLongitudinalCutPlan({
    originalWidthCm: 40,
    enteredWidth: 25,
    enteredWidthUnit: 'cm',
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 2
  });

  assert.equal(plan.mode, 'single-strip');
  assert.deepEqual(plan.productionPieces, [{ widthCm: 25, lengthM: 10, quantity: 1 }]);
  approx(plan.remainingStones[0].width, 15);
  approx(plan.remainingStones[0].length, 10);
  approx(plan.cuttingBreakdown.find((cut) => cut.type === 'longitudinal')?.meters || 0, 10);
  assert.equal(plan.cuttingBreakdown.some((cut) => cut.type === 'cross'), false);
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
    enteredLength: 10,
    enteredLengthUnit: 'm',
    quantity: 1,
    longitudinalRatePerMeter: 100,
    crossRatePerMeter: 50,
    seed: 4
  });

  assert.equal(plan.mode, 'optimized');
  assert.equal(plan.remainingStones.length, 0);
  assert.deepEqual(plan.productionPieces, [{ widthCm: 20, lengthM: 5, quantity: 2 }]);
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
