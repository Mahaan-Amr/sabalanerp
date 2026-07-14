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
  assert.deepEqual(
    result.remainingAreas.map((stone) => [Number(stone.width.toFixed(6)), Number(stone.length.toFixed(6))]),
    [[7, 0.2], [7, 0.8]]
  );
  assert.equal(Number(result.remainingAreas.reduce((sum, stone) => sum + stone.squareMeters, 0).toFixed(6)), 0.07);

  const kerfResult = allocateRemainingStonePartitions([partition(7, 0.6, 1)], source, {
    sawKerfEnabled: true,
    sawKerfCm: 0.3
  });
  assert.equal(kerfResult.rowErrors.size, 0);
  assert.equal(Number(kerfResult.remainingAreas.reduce((sum, stone) => sum + stone.squareMeters, 0).toFixed(6)), 0.067981);
}

{
  const result = allocateRemainingStonePartitions([partition(4, 2, 2)], remaining(1));

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 1);
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
  assert.equal(result.remainingAreas.length, 2);
  assert.equal(result.remainingAreas.every((area) => area.width === 4 && area.length === 2), true);
}

console.log('remainingStonePartitionService tests passed');
