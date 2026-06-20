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
  const result = allocateRemainingStonePartitions([partition(4, 2, 2)], remaining(1));

  assert.equal(result.rowErrors.size, 0);
  assert.equal(result.consumedSourcePieces, 1);
  assert.equal(result.remainingAreas.length, 1);
  assert.equal(Number(result.remainingAreas[0].width.toFixed(6)), 1);
  assert.equal(Number(result.remainingAreas[0].length.toFixed(6)), 2);
  assert.equal(Number(result.remainingAreas[0].squareMeters.toFixed(6)), 0.02);
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
