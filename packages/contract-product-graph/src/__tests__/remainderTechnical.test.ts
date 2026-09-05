import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as graph from '../index';

const c = graph.parseCanonicalDecimal;
const id = graph.parseStableIdentity;
const source = id('product-row', 'source');
const stock = () => ({ remainingStoneId: id('remaining-stone', 'stock'), ownerProductRowId: source,
  catalogProductId: 'granite', sourceBatchId: id('source-batch', 'batch'),
  lengthMeters: c('1.5'), widthMeters: c('0.16'), quantity: 3, creationOrder: 0, materialPaid: true as const });
const child = () => ({ allocationId: id('allocation', 'allocation'), allocationOrder: 0,
  childProductRowId: id('product-row', 'child'), sourceProductRowId: source,
  selectedRemainingStoneId: id('remaining-stone', 'stock'), catalogProductId: 'granite',
  lengthMeters: c('1.5'), widthMeters: c('0.12'), quantity: 2, kerfMeters: c('0'), calibrationEnabled: false });

test('rate-free remainder replay consumes two sources and links new residual stock to its child without repricing material', () => {
  const input = { inputRevision: 9, baseInventory: [stock()], childIntents: [child()] };
  const replay = graph.replayRemainderTechnical(input);
  assert.ok(replay.ok);
  assert.equal(replay.result.inputRevision, 9);
  assert.equal(replay.result.allocations[0].consumedSourcePieces, 2);
  assert.equal(replay.result.allocations[0].sourceProductRowId, source);
  assert.equal(replay.result.allocations[0].targetProductRowId, 'child');
  assert.equal(replay.result.inventory.find(item => item.remainingStoneId === 'stock')?.quantity, 1);
  assert.deepEqual(replay.result.inventory.filter(item => item.ownerProductRowId === 'child').map(item =>
    [item.lengthMeters, item.widthMeters, item.quantity]), [['1.5', '0.04', 2]]);
  assert.equal(graph.canDeleteRemainderSource(source, input.childIntents), false);
  assert.equal(/Rate|Amount|pricing|Pricing|Policy|inputHash|resultHash/.test(JSON.stringify(replay)), false);
  assert.deepEqual(graph.replayRemainderTechnical(input), replay);
});

test('remainder previews reject private extensions and malformed correlation before returning inventory', () => {
  for (const input of [
    { inputRevision: 1, baseInventory: [stock()], childIntents: [{ ...child(), longitudinalCutRateToman: 'private-rate' }] },
    { inputRevision: 1, baseInventory: [{ ...stock(), cost: 'private-cost' }], childIntents: [child()] },
    { inputRevision: 1, baseInventory: [stock()], childIntents: [{ ...child(), widthMeters: 'private-width' }] },
    { inputRevision: -1, baseInventory: [stock()], childIntents: [child()] },
  ]) {
    const result = graph.replayRemainderTechnical(input as graph.RemainderTechnicalInput);
    assert.ok(!result.ok);
    assert.equal(JSON.stringify(result).includes('private-'), false);
  }
});

test('remainder replay retains a valid sibling allocation while rejecting cross-parent access', () => {
  const bad = { ...child(), allocationId: id('allocation', 'bad'), childProductRowId: id('product-row', 'bad-child'),
    sourceProductRowId: id('product-row', 'wrong-parent') };
  const replay = graph.replayRemainderTechnical({ inputRevision: 2, baseInventory: [stock()], childIntents: [bad, child()] });
  assert.ok(!replay.ok);
  assert.equal(replay.conflicts[0].code, 'remainder-source-mismatch');
  assert.equal(replay.conflicts[0].childProductRowId, 'bad-child');
  assert.equal(replay.result?.allocations[0].targetProductRowId, 'child');
  assert.equal(replay.result?.allocations.length, 1);
});

test('witnessed child distribution preserves two consumed source pieces instead of repacking into one', () => {
  const replay = graph.replayRemainderTechnical({ inputRevision: 3,
    baseInventory: [{ ...stock(), lengthMeters: c('2'), widthMeters: c('1'), quantity: 2 }],
    childIntents: [{ ...child(), lengthMeters: c('1'), widthMeters: c('0.5'), quantity: 4,
      sourcePieceQuantities: [2, 2], secondaryOwnerProductRowId: source }] });
  assert.ok(replay.ok);
  assert.equal(replay.result.allocations[0].consumedSourcePieces, 2);
  assert.ok(replay.result.inventory.every(item => item.ownerProductRowId === source));
});
