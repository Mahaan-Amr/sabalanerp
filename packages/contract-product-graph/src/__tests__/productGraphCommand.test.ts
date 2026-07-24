import assert from 'node:assert/strict';
import {
  executeProductGraphCommand,
  parseCanonicalProductGraph,
  parseCanonicalDecimal,
  parseStableIdentity,
  readLegacyProductGraph,
  serializeCanonicalProductGraph,
  type CalculationPolicySnapshot,
  type CanonicalProductGraph,
  type CanonicalProductRow
} from '../index';

const calculationPolicy = (): CalculationPolicySnapshot => ({
  calculation: 'calculation-v1',
  packing: 'packing-v1',
  pricing: 'pricing-v1',
  rounding: 'rounding-v1'
});

const emptyGraph = (): CanonicalProductGraph => ({
  schemaVersion: 1,
  revision: 7,
  calculationPolicy: calculationPolicy(),
  catalogSnapshots: [],
  rows: [],
  layerConfigurations: [],
  sourceBatches: [],
  remainingStones: [],
  allocations: [],
  operationGroups: [],
  toolSelections: [],
  finishingSelections: []
});

const row = (overrides: Partial<CanonicalProductRow> = {}): CanonicalProductRow => ({
  productRowId: parseStableIdentity('product-row', 'product-row-018f6d35'),
  catalogProductId: 'catalog-stone-40',
  catalogSnapshotVersion: 'inventory-42',
  productType: 'longitudinal',
  contractualTitle: 'Granite Natanz 40',
  commercial: {
    requestedAreaSquareMeters: parseCanonicalDecimal('۱۲٫۵۰۰'),
    baseRateToman: parseCanonicalDecimal('1,250,000')
  },
  ...overrides
});

const addRowCommand = (
  nextRow = row(),
  overrides: Record<string, unknown> = {}
) => ({
  commandId: parseStableIdentity('audit-mutation', 'command-add-row-1'),
  type: 'add-row' as const,
  baseRevision: 7,
  calculationPolicy: calculationPolicy(),
  sellerIntent: {
    row: nextRow
  },
  catalogSnapshots: [{
    catalogProductId: 'catalog-stone-40',
    snapshotVersion: 'inventory-42',
    facts: {
      motherWidthMeters: parseCanonicalDecimal('0.4')
    }
  }],
  ...overrides
});

{
  const graph = emptyGraph();
  const before = structuredClone(graph);
  const command = addRowCommand();
  const result = executeProductGraphCommand({ graph, command });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected add-row command to succeed.');

  assert.deepEqual(graph, before);
  assert.equal(result.graph.revision, 8);
  assert.equal(result.graph.rows[0].productRowId, 'product-row-018f6d35');
  assert.equal(result.graph.rows[0].catalogProductId, 'catalog-stone-40');
  assert.equal(result.graph.rows[0].catalogSnapshotVersion, 'inventory-42');
  assert.equal(result.graph.rows[0].commercial.requestedAreaSquareMeters, '12.5');
  assert.equal(result.graph.rows[0].commercial.baseRateToman, '1250000');
  assert.deepEqual(result.graph.catalogSnapshots, [{
    catalogProductId: 'catalog-stone-40',
    snapshotVersion: 'inventory-42',
    facts: {
      motherWidthMeters: '0.4'
    }
  }]);
  assert.deepEqual(result.graph.calculationPolicy, graph.calculationPolicy);
  assert.equal(result.appliedCommand.commandId, 'command-add-row-1');
  assert.equal(result.appliedCommand.inputRevision, 7);
  assert.equal(result.appliedCommand.outputRevision, 8);
  assert.match(result.appliedCommand.inputHash, /^cpg-fnv1a64-[0-9a-f]{16}$/);
  assert.match(result.appliedCommand.resultHash, /^cpg-fnv1a64-[0-9a-f]{16}$/);
  const serialized = serializeCanonicalProductGraph(result.graph);
  assert.deepEqual(parseCanonicalProductGraph(serialized), result.graph);
  assert.throws(
    () => parseCanonicalProductGraph({
      ...result.graph,
      rows: [{
        ...result.graph.rows[0],
        commercial: {
          ...result.graph.rows[0].commercial,
          baseRateToman: 1_250_000
        }
      }]
    }),
    /commercial\.baseRateToman must be a canonical decimal string/
  );

  const unsafeCommandResult = executeProductGraphCommand({
    graph,
    command: {
      ...command,
      sellerIntent: {
        row: {
          ...command.sellerIntent.row,
          commercial: { baseRateToman: 1250000 }
        }
      }
    } as never
  });
  assert.equal(unsafeCommandResult.ok, false);
  if (unsafeCommandResult.ok) throw new Error('Expected unsafe runtime number to fail.');
  assert.equal(unsafeCommandResult.conflicts[0]?.code, 'invalid-canonical-command');

  const blankPolicyResult = executeProductGraphCommand({
    graph,
    command: {
      ...command,
      calculationPolicy: {
        ...command.calculationPolicy,
        packing: '  '
      }
    }
  });
  assert.equal(blankPolicyResult.ok, false);
  if (blankPolicyResult.ok) throw new Error('Expected blank policy version to fail.');
  assert.equal(blankPolicyResult.conflicts[0]?.code, 'invalid-canonical-command');

  const duplicateSnapshotResult = executeProductGraphCommand({
    graph,
    command: {
      ...command,
      catalogSnapshots: [command.catalogSnapshots[0], command.catalogSnapshots[0]]
    }
  });
  assert.equal(duplicateSnapshotResult.ok, false);
  if (duplicateSnapshotResult.ok) throw new Error('Expected duplicate snapshot to fail.');
  assert.equal(duplicateSnapshotResult.conflicts[0]?.code, 'invalid-canonical-command');

  const repeatedResult = executeProductGraphCommand({ graph, command });
  assert.equal(repeatedResult.ok, true);
  if (!repeatedResult.ok) throw new Error('Expected repeated deterministic command to succeed.');
  assert.equal(repeatedResult.appliedCommand.inputHash, result.appliedCommand.inputHash);
  assert.equal(repeatedResult.appliedCommand.resultHash, result.appliedCommand.resultHash);
}

{
  const existing = row();
  const graph: CanonicalProductGraph = {
    ...emptyGraph(),
    rows: [existing],
    catalogSnapshots: addRowCommand().catalogSnapshots
  };
  const result = executeProductGraphCommand({
    graph,
    command: addRowCommand(row({ catalogProductId: 'different-catalog-product' }))
  });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'duplicate-product-row-id',
      path: ['rows', 'product-row-018f6d35'],
      productRowId: 'product-row-018f6d35',
      message: 'Contract product row identity already exists.'
    }]
  });
  assert.equal(graph.rows[0], existing);
}

{
  const graph = emptyGraph();
  const result = executeProductGraphCommand({
    graph,
    command: addRowCommand(row(), { baseRevision: 6 })
  });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'revision-conflict',
      path: ['revision'],
      message: 'Contract product graph revision does not match the command base revision.',
      expected: 7,
      received: 6
    }]
  });
  assert.equal(graph.rows.length, 0);
}

{
  const existingRow = row({
    productRowId: parseStableIdentity('product-row', 'existing-row')
  });
  const graph: CanonicalProductGraph = {
    ...emptyGraph(),
    rows: [existingRow],
    catalogSnapshots: addRowCommand().catalogSnapshots
  };
  const nextRow = row({
    productRowId: parseStableIdentity('product-row', 'new-row')
  });
  const command = addRowCommand(nextRow, {
    catalogSnapshots: [{
      catalogProductId: 'catalog-stone-40',
      snapshotVersion: 'inventory-42',
      facts: { motherWidthMeters: parseCanonicalDecimal('0.5') }
    }]
  });
  const result = executeProductGraphCommand({ graph, command });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'catalog-snapshot-conflict',
      path: ['catalogSnapshots', 'catalog-stone-40', 'inventory-42'],
      productRowId: 'new-row',
      message: 'Catalog snapshot identity has contradictory immutable facts.'
    }]
  });
  assert.equal(graph.rows.length, 1);
}

{
  const graph = emptyGraph();
  const result = executeProductGraphCommand({
    graph,
    command: addRowCommand(row(), {
      calculationPolicy: {
        ...calculationPolicy(),
        packing: 'packing-v2'
      }
    })
  });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'policy-version-conflict',
      path: ['calculationPolicy', 'packing'],
      message: 'Contract product graph policy does not match the command policy.',
      expected: 'packing-v1',
      received: 'packing-v2'
    }]
  });
  assert.equal(graph.rows.length, 0);
}

{
  const graph = emptyGraph();
  const result = executeProductGraphCommand({
    graph,
    command: addRowCommand(row({
      productRowId: parseStableIdentity('product-row', 'child-row'),
      parentProductRowId: parseStableIdentity('product-row', 'missing-parent')
    }))
  });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'orphan-product-reference',
      path: ['rows', 'child-row', 'parentProductRowId'],
      productRowId: 'child-row',
      message: 'Contract product row references a missing parent product row.',
      received: 'missing-parent'
    }]
  });
}

{
  const graph: CanonicalProductGraph = {
    ...emptyGraph(),
    sourceBatches: [{
      sourceBatchId: parseStableIdentity('source-batch', 'source-batch-1'),
      ownerProductRowId: parseStableIdentity('product-row', 'missing-source-owner')
    }]
  };
  const result = executeProductGraphCommand({
    graph,
    command: addRowCommand()
  });

  assert.deepEqual(result, {
    ok: false,
    conflicts: [{
      code: 'invalid-canonical-graph',
      path: ['graph'],
      message: 'Canonical product graph is invalid: Source batch references a missing owner product row.'
    }]
  });
}

{
  assert.throws(
    () => parseStableIdentity('product-row', '  '),
    /Stable product-row identity is required/
  );
  assert.throws(
    () => parseCanonicalDecimal(0.1 as never),
    /Canonical decimal input must be a string/
  );
}

{
  const legacyContract = {
    contractId: 'legacy-contract-42',
    revision: 3,
    calculationPolicy: calculationPolicy(),
    products: [{
      productRowId: 'existing-stable-row',
      productId: 'catalog-stone-40',
      productType: 'longitudinal',
      name: 'Historical saved title',
      totalPrice: 12_500_000
    }]
  };
  const before = structuredClone(legacyContract);
  const result = readLegacyProductGraph(legacyContract);

  assert.deepEqual(legacyContract, before);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected unambiguous legacy graph read to succeed.');
  assert.equal(result.source, 'legacy-read');
  assert.equal(result.migrationRequired, true);
  assert.equal(result.graph.rows[0].productRowId, 'existing-stable-row');
  assert.equal(
    result.graph.rows[0].commercial.legacySnapshot?.totalPrice,
    '12500000'
  );
  assert.equal(result.graph.revision, 3);
}

{
  const legacyContract = {
    contractId: 'legacy-contract-with-missing-identity',
    revision: 4,
    calculationPolicy: calculationPolicy(),
    products: [{
      productIndex: 5,
      productId: 'catalog-stone-40',
      productType: 'longitudinal',
      name: 'Another historical row',
      totalPrice: 8_000_000
    }]
  };
  const before = structuredClone(legacyContract);
  const result = readLegacyProductGraph(legacyContract);

  assert.deepEqual(legacyContract, before);
  assert.deepEqual(result, {
    ok: false,
    source: 'legacy-read',
    contractId: 'legacy-contract-with-missing-identity',
    revision: 4,
    migrationRequired: true,
    legacyView: before.products,
    conflicts: [{
      code: 'legacy-product-row-id-missing',
      path: ['products', '0', 'productRowId'],
      message: 'Legacy contract product has no stable product row identity.'
    }]
  });
  assert.equal('graph' in result, false);
}

{
  const result = readLegacyProductGraph({
    contractId: 'legacy-contract-with-missing-catalog-identity',
    revision: 5,
    calculationPolicy: calculationPolicy(),
    products: [{
      productRowId: 'existing-stable-row',
      productType: 'longitudinal',
      name: 'Legacy stone'
    }]
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected ambiguous legacy catalog relationship to fail.');
  assert.equal(result.conflicts[0]?.code, 'legacy-catalog-product-id-missing');
  assert.equal('graph' in result, false);
}

{
  const result = readLegacyProductGraph({
    contractId: 'legacy-contract-with-duplicate-row-identity',
    revision: 6,
    calculationPolicy: calculationPolicy(),
    products: [
      {
        productRowId: 'duplicate-row',
        productId: 'catalog-stone-40',
        productType: 'longitudinal'
      },
      {
        productRowId: 'duplicate-row',
        productId: 'catalog-stone-40',
        productType: 'longitudinal'
      }
    ]
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected duplicate legacy row identity to fail.');
  assert.equal(result.conflicts[0]?.code, 'legacy-product-row-id-duplicate');
}

{
  const result = readLegacyProductGraph({
    contractId: 'legacy-contract-with-explicit-relationship',
    revision: 7,
    calculationPolicy: calculationPolicy(),
    products: [
      {
        productRowId: 'parent-row',
        productId: 'catalog-stone-40',
        productType: 'longitudinal'
      },
      {
        productRowId: 'child-row',
        parentProductRowId: 'parent-row',
        sourceProductRowId: 'parent-row',
        productId: 'catalog-stone-40',
        productType: 'longitudinal'
      }
    ]
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected explicit legacy relationships to convert.');
  assert.equal(result.graph.rows[1].parentProductRowId, 'parent-row');
  assert.equal(result.graph.rows[1].sourceProductRowId, 'parent-row');
}

{
  const result = readLegacyProductGraph({
    contractId: 'legacy-contract-with-orphan-relationship',
    revision: 8,
    calculationPolicy: calculationPolicy(),
    products: [{
      productRowId: 'child-row',
      parentProductRowId: 'missing-parent',
      productId: 'catalog-stone-40',
      productType: 'longitudinal'
    }]
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected orphan legacy relationship to fail.');
  assert.equal(result.conflicts[0]?.code, 'legacy-product-reference-missing');
}

{
  const result = readLegacyProductGraph({
    contractId: 'legacy-contract-with-invalid-metadata',
    revision: -1,
    calculationPolicy: {
      ...calculationPolicy(),
      packing: ' '
    },
    products: [{
      productRowId: 'legacy-row',
      productId: 'catalog-stone-40',
      productType: 'longitudinal'
    }]
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected invalid legacy metadata to fail.');
  assert.equal(result.conflicts[0]?.code, 'legacy-canonical-input-invalid');
}

console.log('canonical product graph command tests passed');
