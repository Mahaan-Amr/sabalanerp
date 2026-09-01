import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const c = graph.parseCanonicalDecimal;
const sourceBatchId = graph.parseStableIdentity('source-batch', 'technical-longitudinal-source');
const input = () => ({
  inputRevision: 1, sourceBatchId,
  motherWidthMeters: c('0.6'), lengthMeters: c('2'), widthMeters: c('0.2'), quantity: 3,
  lastManualField: 'length' as const, lastManualDimension: 'length' as const,
  lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'cm' as const,
  sawKerfEnabled: false, sawKerfMeters: c('0'),
  calibrationEnabled: false, calibrationSelection: 'automatic' as const,
});

test('three 20cm pieces use one 60cm source and one calibration side without any price evidence', () => {
  const preview = graph.calculateLongitudinalTechnical(input());
  assert.ok(preview.ok);
  assert.equal(preview.result.inputRevision, 1);
  assert.equal(preview.result.requestedAreaSquareMeters, '1.2');
  assert.equal(preview.result.sourcePiecesConsumed, 1);
  assert.equal(preview.result.calibrationEnabled, true);
  assert.equal(preview.result.packingPlan.calibrationMeters, '2');
  assert.equal(preview.result.packingPlan.remainders.length, 0);
  assert.equal(/Rate|Amount|pricing|Policy|inputHash|resultHash/.test(JSON.stringify(preview)), false);
});

test('longitudinal previews reject private fields and malformed correlation without echoing them', () => {
  for (const invalid of [
    { ...input(), baseRateToman: 'private-price' },
    { ...input(), mandatoryPercentage: 'private-percentage' },
    { ...input(), packingPolicyVersion: 'private-policy' },
    { ...input(), inputRevision: -1 },
    { ...input(), calibrationSelection: 'private-selection' },
  ]) {
    const preview = graph.calculateLongitudinalTechnical(invalid as graph.LongitudinalTechnicalInput);
    assert.equal(preview.ok, false);
    assert.equal(JSON.stringify(preview).includes('private-'), false);
  }
});

test('an incomplete kerf checkpoint has a field conflict, never a silent failed preview', () => {
  const preview = graph.calculateLongitudinalTechnical({ ...input(), sawKerfMeters: undefined } as unknown as graph.LongitudinalTechnicalInput);
  assert.ok(!preview.ok);
  assert.equal(preview.inputRevision, 1);
  assert.ok(preview.conflicts.some(conflict => conflict.field === 'dimensions'));
});

test('kerf consumes an additional source, while explicit calibration and total-meter intent retain their meaning', () => {
  const kerf = graph.calculateLongitudinalTechnical({ ...input(), sawKerfEnabled: true, sawKerfMeters: c('0.003') });
  assert.ok(kerf.ok);
  assert.equal(kerf.result.sourcePiecesConsumed, 2);
  assert.equal(kerf.result.calibrationEnabled, false);
  const manual = graph.calculateLongitudinalTechnical({ ...input(), calibrationSelection: 'manual', calibrationEnabled: false });
  assert.ok(manual.ok);
  assert.equal(manual.result.calibrationEnabled, false);
  for (const quantity of [undefined, 0]) {
    const meters = graph.calculateLongitudinalTechnical({ ...input(), quantity, lengthMeters: c('6') });
    assert.ok(meters.ok);
    assert.equal(meters.result.quantityMode, 'total-linear-meters');
    assert.equal(meters.result.requestedAreaSquareMeters, '1.2');
    assert.equal(meters.result.sourcePiecesConsumed, 1);
  }
  const area = graph.calculateLongitudinalTechnical({ ...input(), lastManualField: 'area', requestedAreaSquareMeters: c('2.4') });
  assert.ok(area.ok);
  assert.equal(area.result.lengthMeters, '4');
});
