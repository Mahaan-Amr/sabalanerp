import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCanonicalDecimal,
  parseStableIdentity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import {
  buildOperationCollectionPresentation,
  getPersianOperationEdgeLabel
} from '../operationCollectionPresentation';

const groupId = parseStableIdentity(
  'operation-group',
  'operation-group:test'
);

const input: ProductOperationsInput = {
  policyVersion: 'operations-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1',
  productRowId: parseStableIdentity('product-row', 'product-row:test'),
  lengthMeters: parseCanonicalDecimal('1.18'),
  widthMeters: parseCanonicalDecimal('0.35'),
  quantity: 32,
  groups: [{
    operationGroupId: groupId,
    scope: parseCanonicalDecimal('32')
  }],
  tools: [
    {
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        'tool-selection:valid'
      ),
      operationGroupId: groupId,
      catalogItemId: 'tool-valid',
      catalogSnapshotVersion: 'v1',
      name: 'نیم لول',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('50000'),
      edges: ['front']
    },
    {
      toolSelectionId: parseStableIdentity(
        'tool-selection',
        'tool-selection:invalid'
      ),
      operationGroupId: groupId,
      catalogItemId: 'tool-invalid',
      catalogSnapshotVersion: 'v1',
      name: 'ابزار بدون سمت',
      unit: 'meter',
      rateToman: parseCanonicalDecimal('45000'),
      edges: []
    }
  ],
  finishings: []
};

test('a valid tool keeps its quantity and amount beside an invalid sibling', () => {
  const presentation = buildOperationCollectionPresentation(input);

  assert.equal(presentation.complete, false);
  assert.equal(
    presentation.conflictByEntityId.get('tool-selection:invalid')?.code,
    'tool-edge-required'
  );
  assert.equal(
    presentation.toolsById.get('tool-selection:valid')?.finalQuantity,
    '37.76'
  );
  assert.equal(
    presentation.toolsById.get('tool-selection:valid')?.amountToman,
    '1888000'
  );
});

test('canonical operation edges have Persian presentation labels', () => {
  assert.equal(getPersianOperationEdgeLabel('front'), 'جلو');
  assert.equal(getPersianOperationEdgeLabel('back'), 'عقب');
  assert.equal(getPersianOperationEdgeLabel('left'), 'چپ');
  assert.equal(getPersianOperationEdgeLabel('right'), 'راست');
});
