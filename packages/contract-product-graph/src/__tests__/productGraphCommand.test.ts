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
  assert.equal(result.graph.rows[0].commercial.baseAmountToman, '15625000');
  assert.equal(result.graph.rows[0].commercial.totalAmountToman, '15625000');
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
  const maliciousRow = row({
    commercial: {
      requestedAreaSquareMeters: parseCanonicalDecimal('2'),
      baseRateToman: parseCanonicalDecimal('100'),
      baseAmountToman: parseCanonicalDecimal('1'),
      totalAmountToman: parseCanonicalDecimal('1')
    }
  });
  const result = executeProductGraphCommand({
    graph: emptyGraph(),
    command: addRowCommand(maliciousRow)
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected authoritative price calculation to succeed.');
  assert.equal(result.graph.rows[0].commercial.baseAmountToman, '200');
  assert.equal(result.graph.rows[0].commercial.totalAmountToman, '200');
}

{
  const sellerRow = row({
    commercial: {
      baseAmountToman: parseCanonicalDecimal('1'),
      totalAmountToman: parseCanonicalDecimal('1')
    }
  });
  const command = addRowCommand(sellerRow);
  const productPolicyInput = {
    calculationPolicyVersion: 'calculation-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity(
      'source-batch',
      'source-batch:command-longitudinal'
    ),
    motherWidthMeters: parseCanonicalDecimal('0.4'),
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal('0.12'),
    quantity: 20,
    lastManualField: 'length' as const,
    lastManualDimension: 'length' as const,
    lengthDisplayUnit: 'm' as const,
    widthDisplayUnit: 'cm' as const,
    baseRateToman: parseCanonicalDecimal('1000000'),
    mandatoryEnabled: true,
    mandatoryPercentage: parseCanonicalDecimal('25'),
    rememberedMandatoryPercentage: parseCanonicalDecimal('25'),
    sawKerfEnabled: false,
    sawKerfMeters: parseCanonicalDecimal('0.003'),
    calibrationEnabled: false,
    calibrationSelection: 'automatic' as const,
    longitudinalCutRateToman: parseCanonicalDecimal('10000'),
    calibrationCutRateToman: parseCanonicalDecimal('5000')
  };
  const result = executeProductGraphCommand({
    graph: emptyGraph(),
    command: {
      ...command,
      sellerIntent: {
        row: sellerRow,
        productPolicyInput
      }
    }
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected canonical longitudinal command to succeed.');
  const commercial = result.graph.rows[0].commercial;
  assert.equal(commercial.requestedLengthMeters, '1.5');
  assert.equal(commercial.requestedWidthMeters, '0.12');
  assert.equal(commercial.requestedQuantity, '20');
  assert.equal(commercial.requestedAreaSquareMeters, '3.6');
  assert.equal(commercial.baseAmountToman, '3600000');
  assert.equal(commercial.totalAmountToman, '4800000');
  assert.equal(commercial.calculationSnapshot?.sourcePiecesConsumed, '7');
  assert.equal(commercial.calculationSnapshot?.calibrationEnabled, false);
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(result.graph)),
    result.graph
  );

  const edited = executeProductGraphCommand({
    graph: result.graph,
    command: {
      ...command,
      commandId: parseStableIdentity('audit-mutation', 'command-edit-longitudinal'),
      type: 'replace-row',
      baseRevision: 8,
      sellerIntent: {
        ...command.sellerIntent,
        productPolicyInput: {
          ...productPolicyInput,
          lengthMeters: parseCanonicalDecimal('2')
        }
      }
    }
  });
  if (!edited.ok) {
    throw new Error(`Expected longitudinal edit to succeed: ${JSON.stringify(edited.conflicts)}`);
  }
  assert.equal(edited.graph.rows.length, 1);
  assert.equal(edited.graph.rows[0].commercial.requestedLengthMeters, '2');
  assert.equal(edited.graph.rows[0].commercial.requestedAreaSquareMeters, '4.8');
  assert.equal(edited.graph.rows[0].commercial.totalAmountToman, '6400000');

  const duplicated = executeProductGraphCommand({
    graph: edited.graph,
    command: {
      ...command,
      commandId: parseStableIdentity('audit-mutation', 'command-duplicate-longitudinal'),
      baseRevision: 9,
      sellerIntent: {
        ...command.sellerIntent,
        productPolicyInput: {
          ...productPolicyInput,
          sourceBatchId: parseStableIdentity(
            'source-batch',
            'source-batch:duplicated-longitudinal'
          )
        },
        row: {
          ...command.sellerIntent.row,
          productRowId: parseStableIdentity('product-row', 'duplicated-longitudinal-row')
        }
      }
    }
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) throw new Error('Expected explicit longitudinal duplicate to succeed.');
  assert.equal(duplicated.graph.rows.length, 2);
  assert.equal(duplicated.graph.rows[0].productRowId, 'product-row-018f6d35');
  assert.equal(duplicated.graph.rows[1].productRowId, 'duplicated-longitudinal-row');
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
  const operationsRow = row({
    productRowId: parseStableIdentity('product-row', 'row-with-operations'),
    commercial: {}
  });
  const base = addRowCommand(operationsRow);
  const longitudinalInput = {
    calculationPolicyVersion: 'calculation-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity('source-batch', 'source-with-operations'),
    motherWidthMeters: parseCanonicalDecimal('0.4'),
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal('0.4'),
    quantity: 2,
    lastManualField: 'length' as const,
    lastManualDimension: 'length' as const,
    lengthDisplayUnit: 'm' as const,
    widthDisplayUnit: 'cm' as const,
    baseRateToman: parseCanonicalDecimal('1000'),
    mandatoryEnabled: false,
    mandatoryPercentage: parseCanonicalDecimal('25'),
    rememberedMandatoryPercentage: parseCanonicalDecimal('25'),
    sawKerfEnabled: false,
    sawKerfMeters: parseCanonicalDecimal('0.003'),
    calibrationEnabled: false,
    calibrationSelection: 'automatic' as const,
    longitudinalCutRateToman: parseCanonicalDecimal('100'),
    calibrationCutRateToman: parseCanonicalDecimal('50')
  };
  const operationGroupId = parseStableIdentity('operation-group', 'operation-group-main');
  const operationInput = {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: operationsRow.productRowId,
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal('0.4'),
    quantity: 2,
    groups: [{
      operationGroupId,
      scope: parseCanonicalDecimal('2')
    }],
    tools: [{
      toolSelectionId: parseStableIdentity('tool-selection', 'tool-selection-main'),
      operationGroupId,
      catalogItemId: 'tool-catalog',
      catalogSnapshotVersion: 'inventory-tool-1',
      name: 'نیم لول',
      unit: 'meter' as const,
      rateToman: parseCanonicalDecimal('100'),
      edges: ['front'] as const
    }],
    finishings: [{
      finishingSelectionId: parseStableIdentity(
        'finishing-selection',
        'finishing-selection-main'
      ),
      operationGroupId,
      catalogItemId: 'finishing-catalog',
      catalogSnapshotVersion: 'inventory-finishing-1',
      name: 'ساب سطح',
      unit: 'squareMeter' as const,
      rateToman: parseCanonicalDecimal('50'),
      incompatibleCatalogItemIds: []
    }]
  };
  const added = executeProductGraphCommand({
    graph: emptyGraph(),
    command: {
      ...base,
      sellerIntent: {
        row: operationsRow,
        productPolicyInput: longitudinalInput,
        operationPolicyInput: operationInput
      }
    }
  });
  assert.equal(added.ok, true);
  if (!added.ok) throw new Error('Expected operations command to succeed.');
  assert.equal(added.graph.rows[0].commercial.baseAmountToman, '1200');
  assert.equal(added.graph.rows[0].commercial.totalAmountToman, '1560');
  assert.equal(added.graph.operationGroups.length, 1);
  assert.equal(added.graph.toolSelections[0]?.finalQuantity, '3');
  assert.equal(added.graph.toolSelections[0]?.amountToman, '300');
  assert.equal(added.graph.finishingSelections[0]?.finalQuantity, '1.2');
  assert.equal(added.graph.finishingSelections[0]?.amountToman, '60');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(added.graph)),
    added.graph
  );

  const removedOperations = executeProductGraphCommand({
    graph: added.graph,
    command: {
      ...base,
      commandId: parseStableIdentity('audit-mutation', 'remove-row-operations'),
      type: 'replace-row',
      baseRevision: 8,
      sellerIntent: {
        row: operationsRow,
        productPolicyInput: longitudinalInput,
        operationPolicyInput: {
          ...operationInput,
          groups: [],
          tools: [],
          finishings: []
        }
      }
    }
  });
  assert.equal(removedOperations.ok, true);
  if (!removedOperations.ok) {
    throw new Error('Expected atomic operation replacement to succeed.');
  }
  assert.equal(removedOperations.graph.rows[0].commercial.totalAmountToman, '1200');
  assert.equal(removedOperations.graph.toolSelections.length, 0);
  assert.equal(removedOperations.graph.finishingSelections.length, 0);
  assert.equal(
    removedOperations.graph.operationGroups[0]?.automaticNoOperations,
    true
  );
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
  const sourceRowId = parseStableIdentity('product-row', 'remainder-source-row');
  const childRowId = parseStableIdentity('product-row', 'remainder-child-row');
  const sourceBatchId = parseStableIdentity('source-batch', 'remainder-source-batch');
  const childPackingBatchId = parseStableIdentity(
    'source-batch',
    'remainder-child-preview-batch'
  );
  const allocationId = parseStableIdentity('allocation', 'remainder-allocation');
  const longitudinalInput = ({
    batchId,
    width,
    quantity,
    baseRate
  }: {
    batchId: ReturnType<typeof parseStableIdentity<'source-batch'>>;
    width: string;
    quantity: number;
    baseRate: string;
  }) => ({
    calculationPolicyVersion: 'calculation-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: batchId,
    motherWidthMeters: parseCanonicalDecimal(
      batchId === childPackingBatchId ? '0.16' : '0.4'
    ),
    lengthMeters: parseCanonicalDecimal('1.5'),
    widthMeters: parseCanonicalDecimal(width),
    quantity,
    lastManualField: 'length' as const,
    lastManualDimension: 'length' as const,
    lengthDisplayUnit: 'm' as const,
    widthDisplayUnit: 'cm' as const,
    baseMaterialPricing: baseRate === '0'
      ? 'paid-source-zero' as const
      : 'manual-positive' as const,
    baseRateToman: parseCanonicalDecimal(baseRate),
    mandatoryEnabled: false,
    mandatoryPercentage: parseCanonicalDecimal('25'),
    rememberedMandatoryPercentage: parseCanonicalDecimal('25'),
    sawKerfEnabled: false,
    sawKerfMeters: parseCanonicalDecimal('0.003'),
    calibrationEnabled: false,
    calibrationSelection: 'automatic' as const,
    longitudinalCutRateToman: parseCanonicalDecimal('0'),
    calibrationCutRateToman: parseCanonicalDecimal('0')
  });
  const sourceRow = row({
    productRowId: sourceRowId,
    commercial: {}
  });
  const sourceCommand = addRowCommand(sourceRow, {
    commandId: parseStableIdentity('audit-mutation', 'add-remainder-source'),
    sellerIntent: {
      row: sourceRow,
      productPolicyInput: longitudinalInput({
        batchId: sourceBatchId,
        width: '0.12',
        quantity: 2,
        baseRate: '1000'
      })
    }
  });
  const sourceAdded = executeProductGraphCommand({
    graph: emptyGraph(),
    command: sourceCommand
  });
  assert.equal(sourceAdded.ok, true);
  if (!sourceAdded.ok) throw new Error('Expected remainder source to be added.');
  const selectedRemainderId = parseStableIdentity(
    'remaining-stone',
    `${sourceRowId}:base-remainder:1`
  );
  assert.equal(sourceAdded.graph.remainingStones[0]?.remainingStoneId, selectedRemainderId);
  assert.equal(sourceAdded.graph.remainingStones[0]?.widthMeters, '0.16');
  assert.equal(sourceAdded.graph.remainingStones[0]?.materialPaid, true);

  const childRow = row({
    productRowId: childRowId,
    sourceProductRowId: sourceRowId,
    contractualTitle: 'Independent remainder child',
    description: 'Independent child description',
    commercial: {}
  });
  const childInput = longitudinalInput({
    batchId: childPackingBatchId,
    width: '0.12',
    quantity: 1,
    baseRate: '0'
  });
  const childAdded = executeProductGraphCommand({
    graph: sourceAdded.graph,
    command: {
      ...sourceCommand,
      commandId: parseStableIdentity('audit-mutation', 'add-remainder-child'),
      baseRevision: 8,
      sellerIntent: {
        row: childRow,
        productPolicyInput: childInput,
        remainderChildPolicyInput: {
          allocationId,
          sourceProductRowId: sourceRowId,
          selectedRemainingStoneId: selectedRemainderId,
          lengthMeters: parseCanonicalDecimal('1.5'),
          widthMeters: parseCanonicalDecimal('0.12'),
          quantity: 1,
          kerfMeters: parseCanonicalDecimal('0'),
          calibrationEnabled: false,
          longitudinalCutRateToman: parseCanonicalDecimal('100'),
          crossCutRateToman: parseCanonicalDecimal('0'),
          calibrationCutRateToman: parseCanonicalDecimal('0')
        }
      }
    }
  });
  assert.equal(childAdded.ok, true, JSON.stringify(childAdded));
  if (!childAdded.ok) throw new Error('Expected remainder child to be added.');
  assert.equal(childAdded.graph.rows[1]?.commercial.baseRateToman, '0');
  assert.equal(childAdded.graph.rows[1]?.commercial.baseAmountToman, '0');
  assert.equal(childAdded.graph.rows[1]?.description, 'Independent child description');
  assert.equal(childAdded.graph.allocations[0]?.sourceRemainingStoneId, selectedRemainderId);
  assert.equal(childAdded.graph.allocations[0]?.materialAmountToman, '0');
  assert.equal(childAdded.graph.allocations[0]?.cuttingAmountToman, '150');
  assert.equal(childAdded.graph.rows[1]?.commercial.totalAmountToman, '150');
  assert.equal(childAdded.graph.remainingStones[0]?.ownerProductRowId, childRowId);
  assert.equal(childAdded.graph.remainingStones[0]?.widthMeters, '0.04');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(childAdded.graph)),
    childAdded.graph
  );

  const compatibleSourceEdit = executeProductGraphCommand({
    graph: childAdded.graph,
    command: {
      ...sourceCommand,
      commandId: parseStableIdentity('audit-mutation', 'edit-compatible-source'),
      type: 'replace-row',
      baseRevision: 9,
      sellerIntent: {
        row: sourceRow,
        productPolicyInput: longitudinalInput({
          batchId: sourceBatchId,
          width: '0.14',
          quantity: 2,
          baseRate: '1000'
        })
      }
    }
  });
  assert.equal(compatibleSourceEdit.ok, true, JSON.stringify(compatibleSourceEdit));
  if (!compatibleSourceEdit.ok) {
    throw new Error('Expected compatible source edit to replay child pricing.');
  }
  assert.equal(
    compatibleSourceEdit.graph.allocations[0]?.cuttingAmountToman,
    '0'
  );
  assert.equal(
    compatibleSourceEdit.graph.rows[1]?.commercial.totalAmountToman,
    '0'
  );

  const incompatibleSourceEdit = executeProductGraphCommand({
    graph: childAdded.graph,
    command: {
      ...sourceCommand,
      commandId: parseStableIdentity('audit-mutation', 'edit-remainder-source'),
      type: 'replace-row',
      baseRevision: 9,
      sellerIntent: {
        row: sourceRow,
        productPolicyInput: longitudinalInput({
          batchId: sourceBatchId,
          width: '0.2',
          quantity: 2,
          baseRate: '1000'
        })
      }
    }
  });
  assert.equal(incompatibleSourceEdit.ok, false);
  if (!incompatibleSourceEdit.ok) {
    assert.equal(
      incompatibleSourceEdit.conflicts[0]?.code,
      'remainder-allocation-conflict'
    );
    assert.equal(incompatibleSourceEdit.conflicts[0]?.productRowId, childRowId);
  }
  assert.equal(childAdded.graph.revision, 9);

  const blockedSourceDelete = executeProductGraphCommand({
    graph: childAdded.graph,
    command: {
      commandId: parseStableIdentity('audit-mutation', 'delete-blocked-source'),
      type: 'delete-row',
      baseRevision: 9,
      calculationPolicy: calculationPolicy(),
      sellerIntent: { productRowId: sourceRowId },
      catalogSnapshots: []
    }
  });
  assert.equal(blockedSourceDelete.ok, false);
  if (!blockedSourceDelete.ok) {
    assert.equal(
      blockedSourceDelete.conflicts[0]?.code,
      'source-has-dependent-products'
    );
    assert.equal(blockedSourceDelete.conflicts[0]?.entityId, childRowId);
  }

  const childDeleted = executeProductGraphCommand({
    graph: childAdded.graph,
    command: {
      commandId: parseStableIdentity('audit-mutation', 'delete-remainder-child'),
      type: 'delete-row',
      baseRevision: 9,
      calculationPolicy: calculationPolicy(),
      sellerIntent: { productRowId: childRowId },
      catalogSnapshots: []
    }
  });
  assert.equal(childDeleted.ok, true);
  if (!childDeleted.ok) throw new Error('Expected explicit child deletion.');
  assert.equal(childDeleted.graph.allocations.length, 0);
  assert.equal(childDeleted.graph.remainingStones[0]?.remainingStoneId, selectedRemainderId);
  assert.equal(childDeleted.graph.remainingStones[0]?.widthMeters, '0.16');

  const sourceDeleted = executeProductGraphCommand({
    graph: childDeleted.graph,
    command: {
      commandId: parseStableIdentity('audit-mutation', 'delete-remainder-source'),
      type: 'delete-row',
      baseRevision: 10,
      calculationPolicy: calculationPolicy(),
      sellerIntent: { productRowId: sourceRowId },
      catalogSnapshots: []
    }
  });
  assert.equal(sourceDeleted.ok, true);
  if (!sourceDeleted.ok) throw new Error('Expected source deletion after child deletion.');
  assert.equal(sourceDeleted.graph.rows.length, 0);
  assert.equal(sourceDeleted.graph.sourceBatches.length, 0);
  assert.equal(sourceDeleted.graph.remainingStones.length, 0);
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
