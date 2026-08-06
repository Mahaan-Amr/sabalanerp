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
console.log('canonical projection tests passed');
