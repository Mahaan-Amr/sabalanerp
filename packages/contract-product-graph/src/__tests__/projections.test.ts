import assert from 'node:assert/strict';
import type { CanonicalProductGraph } from '../productGraph';
import { parseCanonicalProductGraph } from '../productGraphSerialization';
import { projectCanonicalGraphToLegacyProducts, projectCanonicalProductGraph } from '../projections';

const graph = parseCanonicalProductGraph({
  schemaVersion: 1,
  revision: 2,
  calculationPolicy: {
    calculation: 'calculation-v1', packing: 'packing-v1',
    pricing: 'pricing-v1', rounding: 'rounding-v1'
  },
  catalogSnapshots: [{
    catalogProductId: 'catalog', snapshotVersion: 'snapshot', facts: {}
  }],
  rows: [{
    productRowId: 'parent', catalogProductId: 'catalog', catalogSnapshotVersion: 'snapshot',
    productType: 'longitudinal', contractualTitle: 'Parent',
    commercial: {
      requestedLengthMeters: '0.8',
      requestedWidthMeters: '0.4',
      requestedAreaSquareMeters: '209.92',
      requestedQuantity: '656',
      totalAmountToman: '100',
      legacySnapshot: {
        length: '80',
        lengthUnit: 'cm',
        width: '40',
        widthUnit: 'cm'
      }
    }
  }, {
    productRowId: 'child', parentProductRowId: 'parent', sourceProductRowId: 'parent',
    catalogProductId: 'catalog', catalogSnapshotVersion: 'snapshot',
    productType: 'longitudinal', contractualTitle: 'Child',
    commercial: { totalAmountToman: '25' }
  }],
  stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [],
  allocations: [], operationGroups: [], toolSelections: [], finishingSelections: []
});

for (const audience of ['step5', 'confirmation', 'pdf', 'accounting', 'workshop', 'delivery', 'logistics'] as const) {
  const projection = projectCanonicalProductGraph(graph, audience);
  assert.equal(projection.totalAmountToman, '125');
  assert.deepEqual(projection.products[0]?.childRowIds, ['child']);
}
assert.equal(projectCanonicalGraphToLegacyProducts(graph)[1]?.sourceProductRowId, 'parent');
const legacyProjection = projectCanonicalGraphToLegacyProducts(graph)[0];
assert.equal(legacyProjection?.length, '0.8');
assert.equal(legacyProjection?.lengthUnit, 'm');
assert.equal(legacyProjection?.width, '0.4');
assert.equal(legacyProjection?.widthUnit, 'm');

const pricedLongitudinalGraph = parseCanonicalProductGraph({
  schemaVersion: 1,
  revision: 1,
  calculationPolicy: {
    calculation: 'calculation-v1', packing: 'packing-v1',
    pricing: 'pricing-v1', rounding: 'rounding-v1'
  },
  catalogSnapshots: [{
    catalogProductId: 'priced-catalog', snapshotVersion: 'priced-snapshot', facts: {}
  }],
  rows: [{
    productRowId: 'priced-row', catalogProductId: 'priced-catalog',
    catalogSnapshotVersion: 'priced-snapshot', productType: 'longitudinal',
    contractualTitle: 'طولی تراورتن',
    commercial: {
      baseAmountToman: '5700000',
      totalAmountToman: '6000000',
      calculationSnapshot: {
        pricingLines: [{
          lineId: 'base-material', quantity: '6', rateToman: '950000', amountToman: '5700000'
        }, {
          lineId: 'longitudinal-cut', quantity: '15', rateToman: '20000', amountToman: '300000'
        }]
      }
    }
  }],
  stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [],
  allocations: [], operationGroups: [], toolSelections: [], finishingSelections: []
});

const accountingPricingProjection = projectCanonicalProductGraph(pricedLongitudinalGraph, 'accounting');
assert.deepEqual(accountingPricingProjection.products[0]?.pricingComponents, [{
  id: 'base-material',
  kind: 'base-material',
  amountToman: '5700000'
}, {
  id: 'longitudinal-cut',
  kind: 'longitudinal-cut',
  amountToman: '300000'
}]);

const paidSourceRemainderGraph = parseCanonicalProductGraph({
  ...pricedLongitudinalGraph,
  rows: [{
    ...pricedLongitudinalGraph.rows[0],
    productRowId: 'paid-source-remainder-row',
    commercial: {
      ...pricedLongitudinalGraph.rows[0]!.commercial,
      baseRateToman: '0',
      baseAmountToman: '0',
      totalAmountToman: '300000',
      calculationSnapshot: {
        ...pricedLongitudinalGraph.rows[0]!.commercial.calculationSnapshot,
        materialPricing: { amountToman: '0', reason: 'paid-in-source-product' }
      }
    }
  }]
});
const paidSourceProjection = projectCanonicalProductGraph(paidSourceRemainderGraph, 'accounting');
assert.deepEqual(paidSourceProjection.products[0]?.pricingComponents, [{
  id: 'base-material',
  kind: 'base-material',
  amountToman: '0'
}, {
  id: 'longitudinal-cut',
  kind: 'longitudinal-cut',
  amountToman: '300000'
}]);

const conflictingPaidMaterialGraph = {
  ...paidSourceRemainderGraph,
  rows: [{
    ...paidSourceRemainderGraph.rows[0]!,
    commercial: {
      ...paidSourceRemainderGraph.rows[0]!.commercial,
      calculationSnapshot: {
        ...paidSourceRemainderGraph.rows[0]!.commercial.calculationSnapshot,
        materialPricing: { amountToman: '999', reason: 'paid-in-source-product' }
      }
    }
  }]
} as unknown as CanonicalProductGraph;
assert.throws(
  () => projectCanonicalProductGraph(conflictingPaidMaterialGraph, 'accounting'),
  /material pricing evidence is malformed/
);

const reallocatedPaidSourceGraph = parseCanonicalProductGraph({
  ...paidSourceRemainderGraph,
  rows: [{
    ...paidSourceRemainderGraph.rows[0],
    commercial: {
      ...paidSourceRemainderGraph.rows[0]!.commercial,
      totalAmountToman: '250000',
      calculationSnapshot: {
        ...paidSourceRemainderGraph.rows[0]!.commercial.calculationSnapshot,
        remainderCutting: {
          allocationId: 'reallocated-remainder',
          longitudinalMeters: '10', crossMeters: '0', calibrationMeters: '0',
          amountToman: '250000'
        }
      }
    }
  }]
});
const reallocatedProjection = projectCanonicalProductGraph(reallocatedPaidSourceGraph, 'accounting');
assert.deepEqual(reallocatedProjection.products[0]?.pricingComponents, [{
  id: 'base-material', kind: 'base-material', amountToman: '0'
}, {
  id: 'remainder-cutting:reallocated-remainder', kind: 'remainder-cutting',
  amountToman: '250000'
}]);

for (const malformedRemainderCutting of [
  ['not-an-object'],
  'not-an-object',
  { allocationId: '', amountToman: '250000' },
  { allocationId: 'reallocated-remainder', amountToman: 'not-an-amount' }
]) {
  const malformedRemainderGraph = {
    ...reallocatedPaidSourceGraph,
    rows: [{
      ...reallocatedPaidSourceGraph.rows[0]!,
      commercial: {
        ...reallocatedPaidSourceGraph.rows[0]!.commercial,
        calculationSnapshot: {
          ...reallocatedPaidSourceGraph.rows[0]!.commercial.calculationSnapshot,
          remainderCutting: malformedRemainderCutting
        }
      }
    }]
  } as unknown as CanonicalProductGraph;
  assert.throws(
    () => projectCanonicalProductGraph(malformedRemainderGraph, 'accounting'),
    /remainder cutting evidence is malformed/
  );
}

const stairLayerGraph = {
  ...pricedLongitudinalGraph,
  rows: [{
    ...pricedLongitudinalGraph.rows[0]!,
    productRowId: 'stair-parent',
    productType: 'stair',
    commercial: {
      baseAmountToman: '5700000',
      totalAmountToman: '6500000',
      calculationSnapshot: {
        pricingLines: [{
          lineId: 'base-material', quantity: '6', rateToman: '950000', amountToman: '5700000'
        }, {
          lineId: 'stair-cut', quantity: '15', rateToman: '20000', amountToman: '300000'
        }]
      }
    }
  }],
  layerConfigurations: [{
    layerConfigurationId: 'front-layer',
    parentProductRowId: 'stair-parent',
    result: {
      layerPricingLine: {
        lineId: 'layer-price', quantity: '1', rateToman: '200000', amountToman: '200000'
      },
      materialPricingLine: {
        lineId: 'base-material', quantity: '1', rateToman: '100000', amountToman: '100000'
      },
      cuttingPricingLines: [{
        lineId: 'longitudinal-cut', quantity: '5', rateToman: '20000', amountToman: '100000'
      }],
      sideOperationResults: [{
        operationCollectionId: 'front-polish',
        result: {
          pricingLines: [{
            lineId: 'tool:edge-polish', quantity: '1', rateToman: '100000', amountToman: '100000'
          }]
        }
      }]
    }
  }]
} as unknown as CanonicalProductGraph;
const stairLayerProjection = projectCanonicalProductGraph(stairLayerGraph, 'accounting');
assert.deepEqual(stairLayerProjection.products[0]?.pricingComponents, [{
  id: 'base-material', kind: 'base-material', amountToman: '5700000'
}, {
  id: 'stair-cut', kind: 'stair-cut', amountToman: '300000'
}, {
  id: 'layer:front-layer:layer-price', kind: 'stair-layer:layer-price', amountToman: '200000'
}, {
  id: 'layer:front-layer:base-material', kind: 'stair-layer:base-material', amountToman: '100000'
}, {
  id: 'layer:front-layer:longitudinal-cut', kind: 'stair-layer:longitudinal-cut', amountToman: '100000'
}, {
  id: 'layer:front-layer:operation:front-polish:tool:edge-polish',
  kind: 'stair-layer-operation:tool:edge-polish', amountToman: '100000'
}]);

const pricedSlabGraph = parseCanonicalProductGraph({
  ...pricedLongitudinalGraph,
  rows: [{
    ...pricedLongitudinalGraph.rows[0],
    productRowId: 'priced-slab-row', productType: 'slab',
    commercial: {
      baseAmountToman: '5000000', totalAmountToman: '5350000',
      calculationSnapshot: {
        materialPricingLine: {
          lineId: 'slab-material', quantity: '5', rateToman: '1000000', amountToman: '5000000'
        },
        cuttingPricingLines: [{
          lineId: 'slab-cut-longitudinal', quantity: '10', rateToman: '20000', amountToman: '200000'
        }],
        verticalCutPricingLine: {
          lineId: 'slab-cut-vertical', quantity: '5', rateToman: '30000', amountToman: '150000'
        }
      }
    }
  }]
});
const slabProjection = projectCanonicalProductGraph(pricedSlabGraph, 'accounting');
assert.deepEqual(slabProjection.products[0]?.pricingComponents, [{
  id: 'slab-material', kind: 'slab-material', amountToman: '5000000'
}, {
  id: 'slab-cut-longitudinal', kind: 'slab-cut-longitudinal', amountToman: '200000'
}, {
  id: 'slab-cut-vertical', kind: 'slab-cut-vertical', amountToman: '150000'
}]);

const malformedPricingGraph = parseCanonicalProductGraph({
  ...pricedLongitudinalGraph,
  rows: [{
    ...pricedLongitudinalGraph.rows[0],
    commercial: {
      ...pricedLongitudinalGraph.rows[0]!.commercial,
      calculationSnapshot: { pricingLines: [{ lineId: 'base-material' }] }
    }
  }]
});
assert.throws(
  () => projectCanonicalProductGraph(malformedPricingGraph, 'accounting'),
  /pricing component is malformed/
);
assert.doesNotThrow(() => projectCanonicalProductGraph(malformedPricingGraph, 'step5'));
assert.deepEqual(
  projectCanonicalProductGraph(malformedPricingGraph, 'step5').products[0]?.pricingComponents,
  []
);
console.log('canonical projection tests passed');
