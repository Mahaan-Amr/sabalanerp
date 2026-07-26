import assert from 'node:assert/strict';
import type { RemainingStone } from '../../types/contract.types';
import {
  groupRemainingStoneInventory
} from '../../utils/remainingStoneGuards';

const stone = (
  id: string,
  width: number,
  length: number,
  quantity = 1
): RemainingStone => ({
  id,
  width,
  length,
  quantity,
  squareMeters: (width * length * quantity) / 100,
  isAvailable: true,
  sourceCutId: `source-${id}`
});

{
  const inventory = [
    ...Array.from({ length: 32 }, (_, index) =>
      stone(`wide-${index + 1}`, 10, 1.6)
    ),
    ...Array.from({ length: 32 }, (_, index) =>
      stone(`short-${index + 1}`, 30, 0.1)
    )
  ];
  const groups = groupRemainingStoneInventory(inventory);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map(group => ({
      width: group.width,
      length: group.length,
      quantity: group.quantity,
      totalSquareMeters: Number(group.totalSquareMeters.toFixed(6))
    })),
    [
      { width: 10, length: 1.6, quantity: 32, totalSquareMeters: 5.12 },
      { width: 30, length: 0.1, quantity: 32, totalSquareMeters: 0.96 }
    ]
  );
  assert.equal(groups[0].stones[0].id, 'wide-1', 'FIFO source order must be retained');
  assert.equal(groups[0].stones[31].id, 'wide-32', 'FIFO source order must be retained');
}

{
  const groups = groupRemainingStoneInventory([
    stone('batched', 10, 1.6, 10),
    stone('single', 10, 1.6)
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].quantity, 11);
  assert.equal(groups[0].totalSquareMeters, 1.76);
}

{
  const tinyPositive = stone('tiny-positive', 0.001, 0.001);
  const groups = groupRemainingStoneInventory([tinyPositive]);
  assert.equal(groups.length, 1, 'positive physical remnants must not be auto-discarded');
  assert.equal(groups[0].quantity, 1);
}

console.log('remaining stone inventory group tests passed');
