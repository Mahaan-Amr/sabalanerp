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
    commercial: { totalAmountToman: '100' }
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
console.log('canonical projection tests passed');
