import assert from 'node:assert/strict';
import {
  createNewStairPartPolicyInput,
  parseCanonicalDecimal,
  parseCanonicalProductGraph,
  parseStableIdentity,
  serializeCanonicalProductGraph
} from '@sabalanerp/contract-product-graph';
import {
  persistProductGraphCommand,
  type ProductGraphAtomicStore,
  type ProductGraphAuditEvent,
  type ProductGraphTransaction,
  type StoredProductGraphState
} from '../contractProductGraphPersistence';

class InMemoryAtomicStore implements ProductGraphAtomicStore {
  state: StoredProductGraphState | null = null;
  audits: ProductGraphAuditEvent[] = [];
  totalAmountToman = '0';

  async transaction<T>(
    work: (transaction: ProductGraphTransaction) => Promise<T>
  ): Promise<T> {
    let draftState = this.state ? {
      ...this.state,
      graph: parseCanonicalProductGraph(serializeCanonicalProductGraph(this.state.graph))
    } : null;
    const draftAudits = [...this.audits];
    let draftTotal = this.totalAmountToman;
    const transaction: ProductGraphTransaction = {
      loadState: async () => draftState,
      compareAndSetState: async (_contractId, expectedRevision, state, total) => {
        const currentRevision = draftState?.graph.revision ?? 0;
        if (currentRevision !== expectedRevision) return false;
        draftState = {
          ...state,
          graph: parseCanonicalProductGraph(serializeCanonicalProductGraph(state.graph))
        };
        draftTotal = total;
        return true;
      },
      appendAudit: async event => {
        if (draftAudits.some(audit => audit.commandId === event.commandId)) {
          throw new Error('Duplicate immutable audit command identity.');
        }
        draftAudits.push(structuredClone(event));
      }
    };
    const result = await work(transaction);
    this.state = draftState;
    this.audits = draftAudits;
    this.totalAmountToman = draftTotal;
    return result;
  }
}

const policy = {
  calculation: 'calculation-v1',
  packing: 'packing-guillotine-v1',
  pricing: 'pricing-decimal-v1',
  rounding: 'toman-half-up-v1'
};

const command = (baseRevision = 0, commandId = 'command-1') => ({
  commandId: parseStableIdentity('audit-mutation', commandId),
  type: 'add-row' as const,
  baseRevision,
  calculationPolicy: policy,
  sellerIntent: {
    row: {
      productRowId: parseStableIdentity('product-row', `row-${commandId}`),
      catalogProductId: 'catalog-stone',
      catalogSnapshotVersion: 'inventory-1',
      productType: 'longitudinal' as const,
      contractualTitle: 'Stone row',
      commercial: {
        requestedAreaSquareMeters: parseCanonicalDecimal('2.5'),
        baseRateToman: parseCanonicalDecimal('1000'),
        totalAmountToman: parseCanonicalDecimal('1')
      }
    }
  },
  catalogSnapshots: [{
    catalogProductId: 'catalog-stone',
    snapshotVersion: 'inventory-1',
    facts: {
      motherLengthMeters: parseCanonicalDecimal('3'),
      motherWidthMeters: parseCanonicalDecimal('0.4')
    }
  }]
});

const canonicalLongitudinalCommand = () => {
  const base = command(0, 'canonical-longitudinal');
  const productRowId = base.sellerIntent.row.productRowId;
  const operationGroupId = parseStableIdentity(
    'operation-group',
    'operation-group:canonical-longitudinal'
  );
  return {
    ...base,
    sellerIntent: {
      row: base.sellerIntent.row,
      productPolicyInput: {
        calculationPolicyVersion: policy.calculation,
        packingPolicyVersion: policy.packing,
        pricingPolicyVersion: policy.pricing,
        roundingPolicyVersion: policy.rounding,
        sourceBatchId: parseStableIdentity(
          'source-batch',
          'source-batch:canonical-longitudinal'
        ),
        motherWidthMeters: parseCanonicalDecimal('0.4'),
        lengthMeters: parseCanonicalDecimal('1.5'),
        widthMeters: parseCanonicalDecimal('0.2'),
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
      },
      operationPolicyInput: {
        policyVersion: policy.calculation,
        pricingPolicyVersion: policy.pricing,
        roundingPolicyVersion: policy.rounding,
        productRowId,
        lengthMeters: parseCanonicalDecimal('1.5'),
        widthMeters: parseCanonicalDecimal('0.2'),
        quantity: 2,
        groups: [{
          operationGroupId,
          scope: parseCanonicalDecimal('2')
        }],
        tools: [{
          toolSelectionId: parseStableIdentity(
            'tool-selection',
            'tool-selection:canonical-longitudinal'
          ),
          operationGroupId,
          catalogItemId: 'tool-catalog',
          catalogSnapshotVersion: 'tool-inventory-1',
          name: 'Edge tool',
          unit: 'meter' as const,
          rateToman: parseCanonicalDecimal('100'),
          edges: ['front'] as const
        }],
        finishings: [{
          finishingSelectionId: parseStableIdentity(
            'finishing-selection',
            'finishing-selection:canonical-longitudinal'
          ),
          operationGroupId,
          catalogItemId: 'finishing-catalog',
          catalogSnapshotVersion: 'finishing-inventory-1',
          name: 'Surface finishing',
          unit: 'squareMeter' as const,
          rateToman: parseCanonicalDecimal('50'),
          incompatibleCatalogItemIds: []
        }]
      }
    }
  };
};

const canonicalSlabCommand = () => {
  const base = command(0, 'canonical-slab');
  const productRowId = parseStableIdentity('product-row', 'persisted-slab-row');
  return {
    ...base,
    sellerIntent: {
      row: {
        ...base.sellerIntent.row,
        productRowId,
        catalogProductId: 'catalog-slab',
        catalogSnapshotVersion: 'slab-inventory-1',
        productType: 'slab' as const,
        contractualTitle: 'Manual source slab',
        commercial: {}
      },
      slabPolicyInput: {
        calculationPolicyVersion: policy.calculation,
        packingPolicyVersion: policy.packing,
        pricingPolicyVersion: policy.pricing,
        roundingPolicyVersion: policy.rounding,
        sourceBatchId: parseStableIdentity(
          'source-batch',
          'persisted-slab-source-batch'
        ),
        lengthMeters: parseCanonicalDecimal('1'),
        widthMeters: parseCanonicalDecimal('1'),
        quantity: 4,
        lastManualField: 'width' as const,
        lastManualDimension: 'width' as const,
        lengthDisplayUnit: 'm' as const,
        widthDisplayUnit: 'm' as const,
        sourceRows: [{
          sourceRowId: parseStableIdentity(
            'slab-source-row',
            'persisted-slab-source-row'
          ),
          lengthMeters: parseCanonicalDecimal('2'),
          widthMeters: parseCanonicalDecimal('2'),
          lengthDisplayUnit: 'm' as const,
          widthDisplayUnit: 'm' as const,
          quantity: 2
        }],
        baseMaterialRateToman: parseCanonicalDecimal('100'),
        kerfMeters: parseCanonicalDecimal('0'),
        cuttingPricingMethod: 'lineBased' as const,
        longitudinalCutRateToman: parseCanonicalDecimal('10'),
        crossCutRateToman: parseCanonicalDecimal('10'),
        verticalCutSides: [] as const
      }
    },
    catalogSnapshots: [{
      catalogProductId: 'catalog-slab',
      snapshotVersion: 'slab-inventory-1',
      facts: {
        motherLengthMeters: parseCanonicalDecimal('3'),
        motherWidthMeters: parseCanonicalDecimal('2')
      }
    }]
  };
};

const remainderCommands = () => {
  const sourceBase = canonicalLongitudinalCommand();
  const sourceRowId = parseStableIdentity('product-row', 'persisted-remainder-source');
  const sourceBatchId = parseStableIdentity('source-batch', 'persisted-remainder-batch');
  const source = {
    ...sourceBase,
    commandId: parseStableIdentity('audit-mutation', 'persist-remainder-source'),
    sellerIntent: {
      row: {
        ...sourceBase.sellerIntent.row,
        productRowId: sourceRowId,
        commercial: {}
      },
      productPolicyInput: {
        ...sourceBase.sellerIntent.productPolicyInput,
        sourceBatchId,
        widthMeters: parseCanonicalDecimal('0.12'),
        quantity: 2
      }
    }
  };
  const childRowId = parseStableIdentity('product-row', 'persisted-remainder-child');
  const selectedRemainingStoneId = parseStableIdentity(
    'remaining-stone',
    `${sourceRowId}:base-remainder:1`
  );
  const child = {
    ...source,
    commandId: parseStableIdentity('audit-mutation', 'persist-remainder-child'),
    baseRevision: 1,
    sellerIntent: {
      row: {
        ...source.sellerIntent.row,
        productRowId: childRowId,
        contractualTitle: 'Child from paid remainder',
        sourceProductRowId: sourceRowId,
        commercial: {}
      },
      productPolicyInput: {
        ...source.sellerIntent.productPolicyInput,
        sourceBatchId: parseStableIdentity(
          'source-batch',
          'persisted-remainder-child-preview'
        ),
        motherWidthMeters: parseCanonicalDecimal('0.16'),
        widthMeters: parseCanonicalDecimal('0.12'),
        quantity: 1,
        baseMaterialPricing: 'paid-source-zero' as const,
        baseRateToman: parseCanonicalDecimal('0'),
        longitudinalCutRateToman: parseCanonicalDecimal('0'),
        calibrationCutRateToman: parseCanonicalDecimal('0')
      },
      remainderChildPolicyInput: {
        allocationId: parseStableIdentity('allocation', 'persisted-remainder-allocation'),
        sourceProductRowId: sourceRowId,
        selectedRemainingStoneId,
        lengthMeters: parseCanonicalDecimal('1.5'),
        widthMeters: parseCanonicalDecimal('0.12'),
        quantity: 1,
        kerfMeters: parseCanonicalDecimal('0'),
        calibrationEnabled: false,
        longitudinalCutRateToman: parseCanonicalDecimal('0'),
        crossCutRateToman: parseCanonicalDecimal('0'),
        calibrationCutRateToman: parseCanonicalDecimal('0')
      }
    }
  };
  return { source, child, sourceRowId, childRowId, selectedRemainingStoneId };
};

const canonicalStairCommand = () => {
  const stairSystemId = parseStableIdentity('stair-system', 'persisted-stair-system');
  const versions = policy;
  const part = (kind: 'tread' | 'riser', suffix: string) => {
    const productRowId = parseStableIdentity(
      'product-row',
      `persisted-stair-${suffix}`
    );
    const draft = {
      row: {
        productRowId,
        catalogProductId: 'catalog-stair-stone',
        catalogSnapshotVersion: 'stair-inventory-1',
        productType: 'stair' as const,
        contractualTitle: kind === 'tread' ? 'Tread' : 'Riser',
        commercial: {}
      },
      stairPartPolicyInput: {
        ...createNewStairPartPolicyInput(
          kind,
          {
            stairSystemId,
            sourceBatchId: parseStableIdentity(
              'source-batch',
              `persisted-stair-source-${suffix}`
            )
          },
          versions
        ),
        motherLengthMeters: parseCanonicalDecimal('3'),
        motherWidthMeters: parseCanonicalDecimal('0.4'),
        lengthMeters: parseCanonicalDecimal('1.2'),
        baseRateToman: parseCanonicalDecimal('1000'),
        longitudinalCutRateToman: parseCanonicalDecimal('0'),
        crossCutRateToman: parseCanonicalDecimal('0'),
        calibrationCutRateToman: parseCanonicalDecimal('0')
      }
    };
    return kind === 'tread'
      ? {
          ...draft,
          layerConfigurationInputs: [{
            calculationPolicyVersion: versions.calculation,
            packingPolicyVersion: versions.packing,
            pricingPolicyVersion: versions.pricing,
            roundingPolicyVersion: versions.rounding,
            layerConfigurationId: parseStableIdentity(
              'layer-configuration',
              'persisted-tread-layer'
            ),
            parentProductRowId: productRowId,
            sourceBatchId: parseStableIdentity(
              'source-batch',
              'persisted-tread-layer-source'
            ),
            creationOrder: 1,
            layerCatalogItemId: 'layer-type-1',
            layerCatalogSnapshotVersion: 'layer-type-v1',
            layerTitle: 'Tread layer',
            layerUnit: 'set' as const,
            layerRateToman: parseCanonicalDecimal('100'),
            layersPerParentPiece: 1,
            widthMeters: parseCanonicalDecimal('0.04'),
            widthDisplayUnit: 'cm' as const,
            targetSides: ['front'] as const,
            source: {
              kind: 'new-material' as const,
              catalogProductId: 'catalog-stair-stone',
              catalogSnapshotVersion: 'stair-inventory-1',
              materialRateToman: parseCanonicalDecimal('1000'),
              sourceRows: [{
                sourceRowId: parseStableIdentity(
                  'layer-source-row',
                  'persisted-tread-layer-new-source'
                ),
                lengthMeters: parseCanonicalDecimal('3'),
                widthMeters: parseCanonicalDecimal('0.4'),
                quantity: 1
              }]
            },
            kerfMeters: parseCanonicalDecimal('0'),
            calibrationEnabled: false,
            longitudinalCutRateToman: parseCanonicalDecimal('0'),
            crossCutRateToman: parseCanonicalDecimal('0'),
            calibrationCutRateToman: parseCanonicalDecimal('0'),
            sideOperations: []
          }]
        }
      : draft;
  };
  return {
    commandId: parseStableIdentity('audit-mutation', 'persist-stair-system'),
    type: 'add-stair-system' as const,
    baseRevision: 0,
    calculationPolicy: policy,
    sellerIntent: {
      stairSystemId,
      quantity: {
        mode: 'staircases' as const,
        numberOfStaircases: 2,
        stepsPerStaircase: 2
      },
      parts: [part('tread', 'tread'), part('riser', 'riser')]
    },
    catalogSnapshots: [{
      catalogProductId: 'catalog-stair-stone',
      snapshotVersion: 'stair-inventory-1',
      facts: {
        motherLengthMeters: parseCanonicalDecimal('3'),
        motherWidthMeters: parseCanonicalDecimal('0.4'),
        thicknessMeters: parseCanonicalDecimal('0.02')
      }
    }]
  };
};

const run = async () => {
{
  const store = new InMemoryAtomicStore();
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-stair',
    actorId: 'seller-1',
    command: canonicalStairCommand()
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error('Expected stair system to persist atomically.');
  assert.equal(result.graph.revision, 1);
  assert.equal(result.graph.rows.length, 2);
  assert.equal(result.graph.stairSystems[0]?.totalSteps, 4);
  assert.equal(result.graph.rows[0]?.commercial.totalAmountToman, '3040');
  assert.equal(result.graph.rows[1]?.commercial.totalAmountToman, '816');
  assert.equal(result.graph.layerConfigurations.length, 1);
  assert.equal(result.totalAmountToman, '3856');
  assert.equal(store.audits.length, 1);
  if (!store.state) throw new Error('Expected stair graph to reload.');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state.graph)),
    result.graph
  );
  const deletedLayer = await persistProductGraphCommand(store, {
    contractId: 'contract-stair',
    actorId: 'seller-1',
    command: {
      commandId: parseStableIdentity(
        'audit-mutation',
        'persist-delete-stair-layer'
      ),
      type: 'delete-layer-configuration',
      baseRevision: 1,
      calculationPolicy: policy,
      sellerIntent: {
        layerConfigurationId: parseStableIdentity(
          'layer-configuration',
          'persisted-tread-layer'
        )
      },
      catalogSnapshots: []
    }
  });
  assert.equal(deletedLayer.ok, true, JSON.stringify(deletedLayer));
  if (!deletedLayer.ok) throw new Error('Expected structural layer deletion.');
  assert.equal(deletedLayer.graph.revision, 2);
  assert.equal(deletedLayer.graph.layerConfigurations.length, 0);
  assert.equal(deletedLayer.totalAmountToman, '2256');
  assert.equal(store.audits.length, 2);

  const invalid = canonicalStairCommand();
  const invalidStore = new InMemoryAtomicStore();
  const invalidResult = await persistProductGraphCommand(invalidStore, {
    contractId: 'contract-invalid-stair',
    actorId: 'seller-1',
    command: {
      ...invalid,
      sellerIntent: {
        ...invalid.sellerIntent,
        parts: [
          invalid.sellerIntent.parts[0],
          {
            ...invalid.sellerIntent.parts[1],
            stairPartPolicyInput: {
              ...invalid.sellerIntent.parts[1].stairPartPolicyInput,
              motherLengthMeters: undefined
            }
          }
        ]
      }
    }
  });
  assert.equal(invalidResult.ok, false);
  assert.equal(invalidStore.state, null);
  assert.equal(invalidStore.audits.length, 0);
}

{
  const store = new InMemoryAtomicStore();
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-1',
    actorId: 'seller-1',
    command: command()
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected graph command to persist.');
  assert.equal(result.graph.revision, 1);
  assert.equal(result.graph.rows[0].commercial.totalAmountToman, '2500');
  assert.equal(result.totalAmountToman, '2500');
  assert.equal(store.totalAmountToman, '2500');
  assert.equal(store.audits.length, 1);
  assert.deepEqual(store.state?.graph, result.graph);
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state?.graph)),
    result.graph
  );

  const before = structuredClone({
    state: store.state,
    audits: store.audits,
    total: store.totalAmountToman
  });
  const stale = await persistProductGraphCommand(store, {
    contractId: 'contract-1',
    actorId: 'seller-2',
    command: command(0, 'stale-command')
  });
  assert.equal(stale.ok, false);
  assert.deepEqual({ state: store.state, audits: store.audits, total: store.totalAmountToman }, before);
}

{
  const store = new InMemoryAtomicStore();
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-longitudinal',
    actorId: 'seller-1',
    command: canonicalLongitudinalCommand()
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected longitudinal policy command to persist.');
  assert.equal(result.graph.rows[0].commercial.requestedAreaSquareMeters, '0.6');
  assert.equal(result.graph.rows[0].commercial.baseAmountToman, '600');
  assert.equal(result.graph.rows[0].commercial.totalAmountToman, '1155');
  assert.equal(
    result.graph.rows[0].commercial.calculationSnapshot?.sourcePiecesConsumed,
    '1'
  );
  assert.equal(result.graph.toolSelections[0]?.amountToman, '300');
  assert.equal(result.graph.finishingSelections[0]?.amountToman, '30');
  assert.equal(result.totalAmountToman, '1155');
  assert.equal(store.totalAmountToman, '1155');
  if (!store.state) throw new Error('Expected canonical graph state to reload.');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state.graph)),
    result.graph
  );
}

{
  const store = new InMemoryAtomicStore();
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-slab',
    actorId: 'seller-1',
    command: canonicalSlabCommand()
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('Expected canonical slab command to persist.');
  const row = result.graph.rows[0];
  assert.equal(row?.commercial.requestedAreaSquareMeters, '4');
  assert.equal(row?.commercial.baseAmountToman, '400');
  assert.equal(row?.slab?.sourceRows[0]?.quantity, 2);
  assert.equal(
    (
      row?.commercial.calculationSnapshot as {
        packingPlan?: { consumedSources?: readonly unknown[] };
      }
    )?.packingPlan?.consumedSources?.length,
    1
  );
  assert.equal('cadDesign' in (row ?? {}), false);
  assert.equal(store.audits.length, 1);
  assert.equal(store.totalAmountToman, result.totalAmountToman);
  if (!store.state) throw new Error('Expected canonical slab graph to reload.');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state.graph)),
    result.graph
  );
}

{
  const store = new InMemoryAtomicStore();
  const commands = remainderCommands();
  const source = await persistProductGraphCommand(store, {
    contractId: 'contract-remainder',
    actorId: 'seller-1',
    command: commands.source
  });
  assert.equal(source.ok, true);
  if (!source.ok) throw new Error('Expected paid remainder source to persist.');
  assert.equal(source.graph.remainingStones[0]?.widthMeters, '0.16');

  const child = await persistProductGraphCommand(store, {
    contractId: 'contract-remainder',
    actorId: 'seller-1',
    command: commands.child
  });
  assert.equal(child.ok, true);
  if (!child.ok) throw new Error('Expected paid remainder child to persist.');
  assert.equal(child.graph.rows[1]?.sourceProductRowId, commands.sourceRowId);
  assert.equal(child.graph.rows[1]?.commercial.baseAmountToman, '0');
  assert.equal(
    child.graph.allocations[0]?.sourceRemainingStoneId,
    commands.selectedRemainingStoneId
  );
  assert.equal(child.graph.allocations[0]?.targetProductRowId, commands.childRowId);
  assert.equal(child.graph.remainingStones[0]?.ownerProductRowId, commands.childRowId);
  assert.equal(store.audits.length, 2);
  if (!store.state) throw new Error('Expected paid remainder graph to reload.');
  assert.deepEqual(
    parseCanonicalProductGraph(serializeCanonicalProductGraph(store.state.graph)),
    child.graph
  );
}

for (const failureInjection of ['after-state-write', 'after-audit-write'] as const) {
  const store = new InMemoryAtomicStore();
  await assert.rejects(
    persistProductGraphCommand(store, {
      contractId: 'contract-failure',
      actorId: 'seller-1',
      command: command(),
      failureInjection
    }),
    /Injected failure/
  );
  assert.equal(store.state, null);
  assert.equal(store.audits.length, 0);
  assert.equal(store.totalAmountToman, '0');
}

{
  const store: ProductGraphAtomicStore = {
    transaction: async work => work({
      loadState: async () => null,
      compareAndSetState: async () => false,
      appendAudit: async () => {
        throw new Error('Audit must not run after a failed compare-and-set.');
      }
    })
  };
  const result = await persistProductGraphCommand(store, {
    contractId: 'contract-race',
    actorId: 'seller-1',
    command: command()
  });
  assert.equal(result.ok, false);
  if (result.ok) throw new Error('Expected compare-and-set race to fail.');
  assert.equal(result.conflicts[0].code, 'revision-conflict');
}

console.log('contract product graph persistence tests passed');
};

void run();
