import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const c = graph.parseCanonicalDecimal;
const input = () => ({
  inputRevision: 7,
  stairSystemId: graph.parseStableIdentity('stair-system', 'stairs-one'),
  sourceBatchId: graph.parseStableIdentity('source-batch', 'stairs-source'),
  part: 'tread' as const, lengthMeters: c('1'), crossDimensionMeters: c('0.3'),
  motherLengthMeters: c('2'), motherWidthMeters: c('0.6'), quantity: 4,
  lengthDisplayUnit: 'm' as const, crossDimensionDisplayUnit: 'cm' as const,
  sawKerfEnabled: false, sawKerfMeters: c('0'),
  calibrationEnabled: false, calibrationSelection: 'automatic' as const,
});

test('four treads pack into one explicit mother, preserving staircase identity without private rates', () => {
  const result = graph.calculateStairPartTechnical(input());
  assert.ok(result.ok);
  assert.equal(result.result.inputRevision, 7);
  assert.equal(result.result.stairPart.stairSystemId, 'stairs-one');
  assert.equal(result.result.motherLengthMode, 'explicit');
  assert.equal(result.result.requestedAreaSquareMeters, '1.2');
  assert.equal(result.result.consumedMotherAreaSquareMeters, '1.2');
  assert.equal(result.result.packingPlan.consumedSources.length, 1);
  assert.equal(/Rate|Amount|pricing|Policy|inputHash|resultHash/.test(JSON.stringify(result)), false);
});

test('stair previews reject private fields, malformed geometry and unknown part identities without echoing them', () => {
  for (const invalid of [
    { ...input(), baseRateToman: 'private-rate' },
    { ...input(), part: 'private-part' },
    { ...input(), lengthMeters: 'private-length' },
    { ...input(), inputRevision: -1 },
  ]) {
    const result = graph.calculateStairPartTechnical(invalid as unknown as graph.StairPartTechnicalInput);
    assert.ok(!result.ok);
    assert.equal(JSON.stringify(result).includes('private-'), false);
  }
});

test('riser and landing retain derived mother length, manual calibration and bounded source geometry', () => {
  for (const part of ['riser', 'landing'] as const) {
    const preview = graph.calculateStairPartTechnical({ ...input(), part, motherLengthMeters: undefined,
      calibrationSelection: 'manual', calibrationEnabled: false });
    assert.ok(preview.ok);
    assert.equal(preview.result.stairPart.part, part);
    assert.equal(preview.result.motherLengthMode, 'derived-from-finished');
    assert.equal(preview.result.motherLengthMeters, '1');
    assert.equal(preview.result.packingPlan.consumedSources.length, 2);
    assert.equal(preview.result.calibrationEnabled, false);
  }
  const oversized = graph.calculateStairPartTechnical({ ...input(), lengthMeters: c('3') });
  assert.ok(!oversized.ok);
  assert.equal(oversized.conflicts[0].code, 'stair-maximum-mother-length-exceeded');
  const incomplete = graph.calculateStairPartTechnical({ ...input(), quantity: undefined });
  assert.ok(!incomplete.ok);
  assert.equal(incomplete.conflicts[0].field, 'quantity');
  assert.equal(incomplete.inputRevision, 7);
});
