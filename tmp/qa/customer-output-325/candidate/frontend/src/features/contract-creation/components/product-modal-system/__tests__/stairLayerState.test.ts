import assert from 'node:assert/strict';
import {
  appendStairLayerDraft,
  duplicateStairLayerDraft,
  stairLayerProductionFacts,
  toggleStairLayerSide,
  type StairLayerConfigurationDraft
} from '../StairLayersSection';

const draft = (
  draftId: string,
  layerTitle = 'Double layer'
): StairLayerConfigurationDraft => ({
  draftId,
  layerTitle,
  layerUnit: 'set',
  layerRateToman: '80000',
  layersPerParentPiece: '2',
  width: '4',
  widthUnit: 'cm',
  targetSides: ['front', 'left'],
  source: 'contract-remainder',
  sourceLabel: '16cm × 1.5m',
  description: ''
});

{
  const first = draft('layer-1');
  const identical = draft('layer-2');
  const appended = appendStairLayerDraft([first], identical);
  assert.equal(appended.length, 2);
  assert.notEqual(appended[0]?.draftId, appended[1]?.draftId);
  assert.equal(appended[0]?.layerTitle, appended[1]?.layerTitle);
}

{
  const source = draft('layer-original');
  const duplicated = duplicateStairLayerDraft(source, 'layer-copy');
  assert.equal(duplicated.source, null);
  assert.equal(duplicated.sourceLabel, '');
  assert.deepEqual(duplicated.targetSides, source.targetSides);
  assert.equal(duplicated.layerRateToman, source.layerRateToman);
  assert.notEqual(duplicated.draftId, source.draftId);
}

{
  const facts = stairLayerProductionFacts({
    parentQuantity: 10,
    layersPerParentPiece: 2,
    targetSides: ['front', 'left']
  });
  assert.deepEqual(facts, {
    commercialLayerSets: 20,
    physicalStripCount: 40
  });
}

{
  const original = draft('layer-sides');
  const withoutFront = toggleStairLayerSide(original, 'front');
  assert.deepEqual(withoutFront.targetSides, ['left']);
  assert.deepEqual(original.targetSides, ['front', 'left']);
  assert.deepEqual(toggleStairLayerSide(withoutFront, 'right').targetSides, [
    'left',
    'right'
  ]);
}

console.log('stair layer state tests passed');
