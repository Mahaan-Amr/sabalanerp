import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContractProduct } from '../../types/contract.types';
import { resolveAttachedStairLayers } from '../stairEditGraph';

const main = (
  rowId: string,
  stairPartType: 'tread' | 'riser' | 'landing' = 'tread'
): ContractProduct => ({
  rowId,
  productId: 'same-catalog',
  productType: 'stair',
  stairSystemId: 'stair-session',
  stairPartType,
  stoneName: rowId,
  quantity: 1,
  totalPrice: 0
} as ContractProduct);

const layer = ({
  rowId,
  parentProductRowId,
  parentProductIndex
}: {
  rowId: string;
  parentProductRowId?: string;
  parentProductIndex?: number;
}): ContractProduct => ({
  rowId,
  parentProductRowId,
  parentProductIndex,
  productId: 'same-catalog',
  productType: 'stair',
  stairSystemId: 'stair-session',
  stairPartType: 'tread',
  stoneName: rowId,
  quantity: 1,
  totalPrice: 0,
  meta: {
    isLayer: true,
    layerInfo: {
      parentPartType: 'tread'
    }
  }
} as ContractProduct);

test('stable parent identity wins over a contradictory array index', () => {
  const rows = [
    main('parent-a'),
    main('parent-b'),
    layer({
      rowId: 'layer-b',
      parentProductRowId: 'parent-b',
      parentProductIndex: 0
    })
  ];

  assert.deepEqual(resolveAttachedStairLayers(rows, 0), {
    status: 'resolved',
    indices: []
  });
  assert.deepEqual(resolveAttachedStairLayers(rows, 1), {
    status: 'resolved',
    indices: [2]
  });
});

test('an unambiguous legacy layer can be adapted from its exact legacy index', () => {
  const rows = [
    main('parent-a'),
    layer({ rowId: 'legacy-layer', parentProductIndex: 0 })
  ];

  assert.deepEqual(resolveAttachedStairLayers(rows, 0), {
    status: 'resolved',
    indices: [1],
    historicalAdaptationRequired: true
  });
});

test('a historical layer with multiple same-part parent candidates is blocked rather than guessed', () => {
  const rows = [
    main('parent-a'),
    main('parent-b'),
    layer({ rowId: 'legacy-layer' })
  ];

  const resolution = resolveAttachedStairLayers(rows, 0);
  assert.equal(resolution.status, 'conflict');
  if (resolution.status !== 'conflict') return;
  assert.equal(resolution.code, 'STAIR_LAYER_PARENT_AMBIGUOUS');
  assert.deepEqual(resolution.candidateParentRowIds, ['parent-a', 'parent-b']);
});
