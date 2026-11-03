import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCanonicalDecimal,
  parseStableIdentity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import type {
  Product,
  StairPartDraftV2
} from '../../types/contract.types';
import {
  resolveLayerBulkOperationView,
  selectNewLayerStone
} from '../stairLayerInteractionState';

const product = {
  id: 'stone-new',
  code: 'STONE-NEW',
  name: 'New stone',
  namePersian: 'سنگ جدید'
} as Product;

test('one result activation commits a new layer stone without losing the layer draft', () => {
  const draft = {
    layerUseDifferentStone: true,
    layerStoneProductId: null,
    layerStoneProduct: null,
    layerStoneLabel: null,
    layerPricePerSquareMeter: 1_250_000,
    layerWidthCm: 4,
    numberOfLayersPerStair: 2,
    layerDescription: 'حفظ شود',
    layerDetachedOperationSides: ['front']
  } as StairPartDraftV2;

  const selected = selectNewLayerStone(draft, product, 'سنگ جدید کامل');

  assert.equal(selected.layerStoneProductId, product.id);
  assert.equal(selected.layerStoneProduct, product);
  assert.equal(selected.layerStoneLabel, 'سنگ جدید کامل');
  assert.equal(selected.layerPricePerSquareMeter, null);
  assert.equal(selected.layerWidthCm, 4);
  assert.equal(selected.numberOfLayersPerStair, 2);
  assert.equal(selected.layerDescription, 'حفظ شود');
  assert.deepEqual(selected.layerDetachedOperationSides, ['front']);
});

const operationInput = (
  side: 'front' | 'left',
  catalogItemId: string
): ProductOperationsInput => {
  const groupId = parseStableIdentity(
    'operation-group',
    `operation-group:test:layer-side:${side}`
  );
  return {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: parseStableIdentity(
      'product-row',
      `product-row:test:layer-side:${side}`
    ),
    lengthMeters: parseCanonicalDecimal(side === 'front' ? '1.5' : '0.3'),
    widthMeters: parseCanonicalDecimal('0.04'),
    quantity: 2,
    groups: [{
      operationGroupId: groupId,
      scope: parseCanonicalDecimal('2')
    }],
    tools: [{
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        `tool-selection:test:layer-side:${side}`
      ),
      operationGroupId: groupId,
      catalogItemId,
      catalogSnapshotVersion: 'v1',
      name: 'لول کامل',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('80000'),
      edges: ['front']
    }],
    finishings: []
  };
};

test('all-strips view reports mixed side operations instead of borrowing the first side', () => {
  const front = operationInput('front', 'tool-front');
  const left = operationInput('left', 'tool-left');

  const view = resolveLayerBulkOperationView([front, left]);

  assert.equal(view.mixed, true);
  assert.equal(view.message, 'عملیات نوارها یکسان نیست');
  assert.equal(view.input.tools.length, 0);
});

test('all-strips view keeps semantically shared operations despite side identities and geometry', () => {
  const front = operationInput('front', 'tool-shared');
  const left = operationInput('left', 'tool-shared');

  const view = resolveLayerBulkOperationView([front, left]);

  assert.equal(view.mixed, false);
  assert.equal(view.message, null);
  assert.equal(view.input.tools.length, 1);
  assert.equal(view.input.tools[0]?.catalogItemId, 'tool-shared');
});

test('different automatic snapshots do not split an identical manual bulk quantity intent', () => {
  const withOverride = (
    input: ProductOperationsInput,
    automaticQuantitySnapshot: '6' | '1.2'
  ): ProductOperationsInput => ({
    ...input,
    tools: input.tools.map(tool => ({
      ...tool,
      quantityOverride: {
        value: parseCanonicalDecimal('1'),
        automaticQuantitySnapshot:
          parseCanonicalDecimal(automaticQuantitySnapshot),
        resolution: 'keep'
      }
    }))
  });
  const front = withOverride(operationInput('front', 'tool-shared'), '6');
  const left = withOverride(operationInput('left', 'tool-shared'), '1.2');

  const view = resolveLayerBulkOperationView([front, left]);

  assert.equal(view.mixed, false);
  assert.equal(view.input.tools.length, 1);
});
