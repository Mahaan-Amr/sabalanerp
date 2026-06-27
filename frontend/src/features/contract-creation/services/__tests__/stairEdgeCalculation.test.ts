import assert from 'node:assert/strict';
import {
  computeLayerSqmV2,
  computeToolMetersForTool,
  getLayerEdgeDemands,
  getTotalLayerLengthPerStairM
} from '../stairCalculationService';
import { deriveLayerEdgesFromTools } from '../../utils/stairSystemHelpers';
import type { StairPartDraftV2, StairStepperPart, ToolSelectionV2 } from '../../types/contract.types';

const approx = (actual: number, expected: number, precision = 6) => {
  assert.equal(Number(actual.toFixed(precision)), Number(expected.toFixed(precision)));
};

const stairDraft = (overrides: Partial<StairPartDraftV2> = {}): StairPartDraftV2 => ({
  lengthValue: 1.2,
  lengthUnit: 'm',
  widthCm: 17.5,
  quantity: 4,
  ...overrides
});

const tool = (edges: Partial<ToolSelectionV2>): ToolSelectionV2 => ({
  toolId: 'tool-edge',
  name: 'edge tool',
  pricePerMeter: 35_000,
  ...edges
});

for (const part of ['tread', 'riser', 'landing'] as StairStepperPart[]) {
  approx(computeToolMetersForTool(part, stairDraft(), tool({ front: true })), 4.8);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ back: true })), 4.8);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ left: true })), 0.7);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ right: true })), 0.7);
  approx(computeToolMetersForTool(part, stairDraft(), tool({ perimeter: true })), 11);
  approx(computeToolMetersForTool(part, stairDraft(), tool({
    front: true,
    back: true,
    left: true,
    right: true
  })), 11);
}

for (const part of ['tread', 'riser', 'landing'] as StairStepperPart[]) {
  const derived = deriveLayerEdgesFromTools(stairDraft({
    tools: [tool({ back: true, perimeter: true })]
  }), part);

  assert.equal(derived.layerEdges?.back, false);
  assert.equal(derived.layerEdges?.perimeter, true);

  const backOnly = deriveLayerEdgesFromTools(stairDraft({
    tools: [tool({ back: true })]
  }), part);

  assert.equal(backOnly.layerEdges?.back, true);
  assert.equal(backOnly.layerEdges?.perimeter, false);
}

{
  const draft = stairDraft({
    layerWidthCm: 3,
    numberOfLayersPerStair: 1,
    layerEdges: { front: true, back: true, left: true, right: true }
  });

  approx(getTotalLayerLengthPerStairM('tread', draft), 2.63);
  approx(computeLayerSqmV2('tread', draft), 0.3156);

  const demands = getLayerEdgeDemands('tread', draft);
  assert.deepEqual(demands.map((demand) => demand.edge), ['front', 'back', 'left', 'right']);
  approx(demands.find((demand) => demand.edge === 'front')?.lengthM || 0, 1.17);
  approx(demands.find((demand) => demand.edge === 'left')?.lengthM || 0, 0.145);
}

console.log('stairEdgeCalculation tests passed');
