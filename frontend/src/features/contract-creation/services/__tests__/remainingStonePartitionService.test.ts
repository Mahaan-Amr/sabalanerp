import assert from 'node:assert/strict';
import { allocateRemainingStonePartitions } from '../remainingStonePartitionService';
import type { RemainingStone, StonePartition } from '../../types/contract.types';

const remaining = (quantity = 1): RemainingStone => ({
  id: 'remaining-9x2',
  width: 9,
  length: 2,
  squareMeters: 0.18 * quantity,
  isAvailable: true,
  sourceCutId: 'cut-1',
  quantity
});

const partition = (width: number, length: number, quantity: number): StonePartition => ({
  id: `partition-${width}-${length}-${quantity}`,
  width,
  length,
  quantity,
  squareMeters: (width * length * quantity) / 100
});

{
  const source: RemainingStone = {
    id: 'remaining-14x08',
    width: 14,
    length: 0.8,
    squareMeters: 0.112,
    isAvailable: true,
    sourceCutId: 'cut-14x08',
    quantity: 1
  };
  const result = allocateRemainingStonePartitions([partition(7, 0.6, 1)], source);

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 1);
  assert.deepEqual(result.sourcePieceQuantitiesByRow.get('partition-7-0.6-1'), [1]);
  assert.deepEqual(
    result.remainingAreas.map((stone) => [Number(stone.width.toFixed(6)), Number(stone.length.toFixed(6))]),
    [[7, 0.6], [14, 0.2]]
  );
  assert.equal(Number(result.remainingAreas.reduce((sum, stone) => sum + stone.squareMeters, 0).toFixed(6)), 0.07);

  const kerfResult = allocateRemainingStonePartitions([partition(7, 0.6, 1)], source, {
    sawKerfEnabled: true,
    sawKerfCm: 0.3
  });
  assert.equal(kerfResult.rowErrors.size, 0);
  assert.equal(Number(kerfResult.remainingAreas.reduce((sum, stone) => sum + stone.squareMeters, 0).toFixed(6)), 0.06778);
}

{
  const result = allocateRemainingStonePartitions([partition(4, 2, 2)], remaining(1));

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 1);
  assert.deepEqual(result.sourcePieceQuantitiesByRow.get('partition-4-2-2'), [2]);
  assert.equal(result.remainingAreas.length, 1);
  assert.equal(Number(result.remainingAreas[0].width.toFixed(6)), 1);
  assert.equal(Number(result.remainingAreas[0].length.toFixed(6)), 2);
  assert.equal(Number(result.remainingAreas[0].squareMeters.toFixed(6)), 0.02);
}

{
  const result = allocateRemainingStonePartitions([partition(4, 2, 2)], remaining(1), {
    sawKerfEnabled: true,
    sawKerfCm: 0.3
  });

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 1);
  assert.equal(result.remainingAreas.length, 1);
  assert.equal(Number(result.remainingAreas[0].width.toFixed(6)), 0.4);
  assert.equal(Number(result.remainingAreas[0].length.toFixed(6)), 2);
}

{
  const result = allocateRemainingStonePartitions([partition(4.5, 2, 2)], remaining(1), {
    sawKerfEnabled: true,
    sawKerfCm: 0.3
  });

  assert.equal(result.rowErrors.size, 1);
}

{
  const result = allocateRemainingStonePartitions([partition(5, 2, 2)], remaining(1));

  assert.equal(result.rowErrors.size, 1);
  assert.match(result.rowErrors.values().next().value || '', /ظرفیت باقی‌مانده/);
}

{
  const result = allocateRemainingStonePartitions([partition(5, 2, 2)], remaining(2));

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 2);
  assert.deepEqual(result.sourcePieceQuantitiesByRow.get('partition-5-2-2'), [1, 1]);
  assert.equal(result.remainingAreas.length, 2);
  assert.equal(result.remainingAreas.every((area) => area.width === 4 && area.length === 2), true);
}

{
  const segmentedSource: RemainingStone = {
    id: 'remaining-3x2x2',
    width: 3,
    length: 2,
    squareMeters: 0.12,
    isAvailable: true,
    sourceCutId: 'cut-segmented',
    quantity: 2
  };
  const result = allocateRemainingStonePartitions(
    [partition(3, 3, 1)],
    segmentedSource
  );

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 2);
  assert.deepEqual(result.sourcePieceQuantitiesByRow.get('partition-3-3-1'), [1, 1]);
  assert.deepEqual(
    result.physicalPiecesByRow.get('partition-3-3-1')?.map(piece => piece.length),
    [2, 1]
  );
  assert.deepEqual(result.remainingAreas.map(area => [area.width, area.length]), [[3, 1]]);
}

{
  const manySegmentSource: RemainingStone = {
    id: 'remaining-20x01x20',
    width: 20,
    length: 0.1,
    squareMeters: 0.4,
    isAvailable: true,
    sourceCutId: 'cut-many-segments',
    quantity: 20
  };
  const startedAt = performance.now();
  const result = allocateRemainingStonePartitions(
    [partition(7, 0.25, 10)],
    manySegmentSource
  );

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.physicalPiecesByRow.get('partition-7-0.25-10')?.length, 30);
  assert.equal(
    result.sourcePieceQuantitiesByRow.get('partition-7-0.25-10')?.reduce((sum, value) => sum + value, 0),
    30
  );
  assert.ok(performance.now() - startedAt < 2000, 'large split allocation must stay within the UI budget');
}

console.log('remainingStonePartitionService tests passed');
