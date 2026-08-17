import assert from 'node:assert/strict';
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
  quantity: '6',
  rateToman: '950000',
  amountToman: '5700000'
}, {
  id: 'longitudinal-cut',
  kind: 'longitudinal-cut',
  quantity: '15',
  rateToman: '20000',
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
  quantity: '6',
  rateToman: '0',
  amountToman: '0'
}, {
  id: 'longitudinal-cut',
  kind: 'longitudinal-cut',
  quantity: '15',
  rateToman: '20000',
  amountToman: '300000'
}]);

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
  id: 'base-material', kind: 'base-material', quantity: '6',
  rateToman: '0', amountToman: '0'
}, {
  id: 'remainder-cutting:reallocated-remainder', kind: 'remainder-cutting',
  quantity: '250000', rateToman: '1', amountToman: '250000'
}]);
console.log('canonical projection tests passed');
