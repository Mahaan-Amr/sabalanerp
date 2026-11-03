import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bindCanonicalCaseGraph } from '../src';

test('canonical graph adapter preserves independent rows and binds only one Case owner', async () => {
  const graph = { schemaVersion: 1, revision: 1, calculationPolicy: { calculation: 'v1', packing: 'v1', pricing: 'v1', rounding: 'v1' },
    catalogSnapshots: [{ catalogProductId: 'stone', snapshotVersion: 'v1', facts: {} }], rows: [{ productRowId: 'fixture-row-313', catalogProductId: 'stone', catalogSnapshotVersion: 'v1', productType: 'longitudinal', contractualTitle: 'سنگ', commercial: {} }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [] };
  const owner = { caseId: 'case-313', revision: 1, integrityHash: 'sha256-v1:' + 'a'.repeat(64) };
  const result = await bindCanonicalCaseGraph(owner, graph);
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.productRowIds, ['fixture-row-313']);
  assert.equal((await bindCanonicalCaseGraph(owner, { ...graph, rows: [...graph.rows, ...graph.rows] })).ok, false);
});
