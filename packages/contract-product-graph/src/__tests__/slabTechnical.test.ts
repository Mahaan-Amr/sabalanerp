import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const c = graph.parseCanonicalDecimal;
const input = () => ({
  inputRevision: 3,
  sourceBatchId: graph.parseStableIdentity('source-batch', 'slab-batch'),
  lengthMeters: c('1'), widthMeters: c('1'), quantity: 4,
  lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const,
  sourceRows: [{ sourceRowId: graph.parseStableIdentity('slab-source-row', 'source-one'),
    lengthMeters: c('2'), widthMeters: c('2'), quantity: 2,
    lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const }],
  kerfMeters: c('0'), verticalCutSides: ['top', 'left'] as const,
});

test('slab technical preview packs four tiles, retains unused sources and derives vertical edges without pricing', () => {
  const preview = graph.calculateSlabTechnical(input());
  assert.ok(preview.ok);
  assert.equal(preview.result.inputRevision, 3);
  assert.equal(preview.result.finishedAreaSquareMeters, '4');
  assert.equal(preview.result.materialAreaSquareMeters, '4');
  assert.equal(preview.result.verticalCutMeters, '4');
  assert.equal(preview.result.packingPlan.consumedSources.length, 1);
  assert.deepEqual(preview.result.packingPlan.unusedSources, [{ sourceBatchId: 'slab-batch:source-one', quantity: 1 }]);
  assert.equal(/Rate|Amount|pricing|Policy|inputHash|resultHash/.test(JSON.stringify(preview)), false);
});

test('slab input is strictly technical at nested boundaries and invalid input never echoes private evidence', () => {
  for (const invalid of [
    { ...input(), baseMaterialRateToman: 'private-price' },
    { ...input(), sourceRows: [{ ...input().sourceRows[0], pricingHash: 'private-hash' }] },
    { ...input(), sourceRows: [{ ...input().sourceRows[0], lengthMeters: 'private-value' }] },
    { ...input(), inputRevision: -1 },
    { ...input(), verticalCutSides: ['private-edge'] },
  ]) {
    const preview = graph.calculateSlabTechnical(invalid as unknown as graph.SlabTechnicalInput);
    assert.ok(!preview.ok);
    assert.equal(JSON.stringify(preview).includes('private-'), false);
  }
});

test('slab previews retain manual area authority and report incomplete, duplicate and insufficient sources', () => {
  const area = graph.calculateSlabTechnical({ ...input(), areaSquareMeters: c('8'), lastManualField: 'area', lastManualDimension: 'length' });
  assert.ok(area.ok);
  assert.equal(area.result.widthMeters, '2');
  for (const [draft, code] of [
    [{ ...input(), widthMeters: undefined }, 'slab-geometry-incomplete'],
    [{ ...input(), sourceRows: [] }, 'slab-source-required'],
    [{ ...input(), sourceRows: [input().sourceRows[0], input().sourceRows[0]] }, 'duplicate-slab-source'],
    [{ ...input(), quantity: 9 }, 'slab-source-insufficient'],
  ] as const) {
    const before = JSON.stringify(draft);
    const result = graph.calculateSlabTechnical(draft);
    assert.ok(!result.ok);
    assert.equal(result.inputRevision, 3);
    assert.equal(result.conflicts[0].code, code);
    assert.equal(JSON.stringify(draft), before);
  }
});
