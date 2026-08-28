import Decimal from 'decimal.js';
import { compareProductDependentOrder } from './dependentOrder';
import { hashCanonicalValue } from './canonicalHash';
import { findGraphIntegrityConflicts } from './graphIntegrity';
import {
  cloneCanonicalJson,
  normalizeLegacyJson,
  stableCanonicalJson,
  type CanonicalJsonObject
} from './canonicalJson';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import type { StableIdentity } from './stableIdentity';
import {
  parseCanonicalProductGraph,
  parseProductGraphCommand
} from './productGraphSerialization';
import { calculatePricing, type PackingPlan } from './packingPricing';
import {
  calculateLongitudinalProduct,
  parseLongitudinalProductInput,
  type LongitudinalProductInput
} from './longitudinalPolicy';
import {
  calculateProductOperations,
  type CalculatedFinishingSelection,
  type CalculatedOperationGroup,
  type CalculatedToolSelection,
  type ProductOperationsInput,
  type ProductOperationsResult
} from './operationsPolicy';
import {
  canDeleteRemainderSource,
  materializePaidRemainderStocks,
  replayRemainderAllocations,
  type CanonicalRemainderAllocation,
  type PaidRemainderStock,
  type RemainderChildIntent,
  type RemainderChildPolicyInput
} from './remainderPolicy';
import {
  calculateStairPart,
  resolveStaircaseQuantity,
  type CanonicalStairPartFacts,
  type CanonicalStairSystem,
  type StairPartPolicyInput,
  type StaircaseQuantityIntent
} from './stairPolicy';
import {
  calculateStairLayerConfiguration,
  type StairLayerConfigurationInput,
  type StairLayerConfigurationResult
} from './stairLayerPolicy';
import {
  calculateSlab,
  type CanonicalSlabFacts,
  type SlabPolicyInput
} from './slabPolicy';

export const CONTRACT_PRODUCT_GRAPH_SCHEMA_VERSION = 1 as const;

export type ProductRowId = StableIdentity<'product-row'>;
export type LayerConfigurationId = StableIdentity<'layer-configuration'>;
export type SourceBatchId = StableIdentity<'source-batch'>;
export type RemainingStoneId = StableIdentity<'remaining-stone'>;
export type AllocationId = StableIdentity<'allocation'>;
export type OperationGroupId = StableIdentity<'operation-group'>;
export type ToolSelectionId = StableIdentity<'tool-selection'>;
export type FinishingSelectionId = StableIdentity<'finishing-selection'>;
export type AuditMutationId = StableIdentity<'audit-mutation'>;
export type StairSystemId = StableIdentity<'stair-system'>;

export type CanonicalProductType =
  | 'longitudinal'
  | 'stair'
  | 'slab'
  | 'prepared'
  | 'volumetric';

export interface CalculationPolicySnapshot {
  readonly calculation: string;
  readonly packing: string;
  readonly pricing: string;
  readonly rounding: string;
}

export interface CanonicalCommercialFacts {
  readonly requestedLengthMeters?: CanonicalDecimal;
  readonly requestedWidthMeters?: CanonicalDecimal;
  readonly requestedAreaSquareMeters?: CanonicalDecimal;
  readonly requestedQuantity?: CanonicalDecimal;
  readonly baseRateToman?: CanonicalDecimal;
  readonly baseAmountToman?: CanonicalDecimal;
  readonly totalAmountToman?: CanonicalDecimal;
  readonly calculationSnapshot?: CanonicalJsonObject;
  readonly legacySnapshot?: CanonicalJsonObject;
}

export interface CatalogTechnicalFacts {
  readonly motherLengthMeters?: CanonicalDecimal;
  readonly motherWidthMeters?: CanonicalDecimal;
  readonly thicknessMeters?: CanonicalDecimal;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly legacySnapshot?: CanonicalJsonObject;
}

export interface CatalogSnapshot {
  readonly catalogProductId: string;
  readonly snapshotVersion: string;
  readonly facts: CatalogTechnicalFacts;
}

export interface CanonicalProductRow {
  readonly productRowId: ProductRowId;
  readonly catalogProductId: string;
  readonly catalogSnapshotVersion: string;
  readonly productType: CanonicalProductType;
  readonly contractualTitle: string;
  readonly description?: string;
  readonly stairPart?: CanonicalStairPartFacts;
  readonly slab?: CanonicalSlabFacts;
  readonly commercial: CanonicalCommercialFacts;
  readonly parentProductRowId?: ProductRowId;
  readonly sourceProductRowId?: ProductRowId;
}

export interface CanonicalLayerConfiguration {
  readonly layerConfigurationId: LayerConfigurationId;
  readonly parentProductRowId: ProductRowId;
  readonly sourceBatchId: SourceBatchId;
  readonly creationOrder: number;
  readonly input: StairLayerConfigurationInput;
  readonly result: StairLayerConfigurationResult;
}

export interface CanonicalSourceBatch {
  readonly sourceBatchId: SourceBatchId;
  readonly ownerProductRowId?: ProductRowId;
  readonly initialRemainders?: readonly PaidRemainderStock[];
}

export interface CanonicalRemainingStone extends PaidRemainderStock {}

export interface CanonicalAllocation extends CanonicalRemainderAllocation {
  readonly intentSnapshot: RemainderChildIntent;
}

export interface CanonicalOperationGroup extends CalculatedOperationGroup {
  readonly productRowId: ProductRowId;
}

export interface CanonicalToolSelection extends CalculatedToolSelection {}

export interface CanonicalFinishingSelection extends CalculatedFinishingSelection {}

export interface CanonicalProductGraph {
  readonly schemaVersion: typeof CONTRACT_PRODUCT_GRAPH_SCHEMA_VERSION;
  readonly revision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly catalogSnapshots: readonly CatalogSnapshot[];
  readonly rows: readonly CanonicalProductRow[];
  readonly stairSystems: readonly CanonicalStairSystem[];
  readonly layerConfigurations: readonly CanonicalLayerConfiguration[];
  readonly sourceBatches: readonly CanonicalSourceBatch[];
  readonly remainingStones: readonly CanonicalRemainingStone[];
  readonly allocations: readonly CanonicalAllocation[];
  readonly operationGroups: readonly CanonicalOperationGroup[];
  readonly toolSelections: readonly CanonicalToolSelection[];
  readonly finishingSelections: readonly CanonicalFinishingSelection[];
}

export interface AddRowSellerIntent {
  readonly row: CanonicalProductRow;
  readonly productPolicyInput?: LongitudinalProductInput;
  readonly operationPolicyInput?: ProductOperationsInput;
  readonly remainderChildPolicyInput?: RemainderChildPolicyInput;
  readonly stairPartPolicyInput?: StairPartPolicyInput;
  readonly layerConfigurationInputs?: readonly StairLayerConfigurationInput[];
  readonly slabPolicyInput?: SlabPolicyInput;
}

export interface AddRowCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'add-row';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: AddRowSellerIntent;
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export interface ReplaceRowCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'replace-row';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: AddRowSellerIntent;
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export interface DeleteRowCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'delete-row';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: {
    readonly productRowId: ProductRowId;
  };
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export interface DeleteLayerConfigurationCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'delete-layer-configuration';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: {
    readonly layerConfigurationId: LayerConfigurationId;
  };
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export interface AddStairSystemCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'add-stair-system';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: {
    readonly stairSystemId: StairSystemId;
    readonly quantity: StaircaseQuantityIntent;
    readonly parts: readonly AddRowSellerIntent[];
  };
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export type ProductGraphCommand =
  | AddRowCommand
  | ReplaceRowCommand
  | DeleteRowCommand
  | DeleteLayerConfigurationCommand
  | AddStairSystemCommand;

export interface ProductGraphCommandRequest {
  readonly graph: CanonicalProductGraph;
  readonly command: ProductGraphCommand;
}

export type ProductGraphConflictCode =
  | 'catalog-snapshot-conflict'
  | 'catalog-snapshot-missing'
  | 'duplicate-stable-identity'
  | 'duplicate-product-row-id'
  | 'invalid-canonical-command'
  | 'invalid-canonical-graph'
  | 'layer-configuration-missing'
  | 'orphan-graph-reference'
  | 'orphan-product-reference'
  | 'product-row-missing'
  | 'product-policy-conflict'
  | 'policy-version-conflict'
  | 'revision-conflict'
  | 'remainder-allocation-conflict'
  | 'source-has-dependent-products';

export interface ProductGraphConflict {
  readonly code: ProductGraphConflictCode;
  readonly path: readonly string[];
  readonly message: string;
  readonly entityId?: string;
  readonly productRowId?: ProductRowId;
  readonly expected?: string | number;
  readonly received?: string | number;
}

export interface AppliedProductGraphCommand {
  readonly commandId: AuditMutationId;
  readonly inputRevision: number;
  readonly outputRevision: number;
  readonly inputHash: string;
  readonly resultHash: string;
}

export type ProductGraphCommandResult =
  | {
      readonly ok: true;
      readonly graph: CanonicalProductGraph;
      readonly appliedCommand: AppliedProductGraphCommand;
    }
  | {
      readonly ok: false;
      readonly conflicts: readonly ProductGraphConflict[];
    };

const cloneCommercialFacts = (facts: CanonicalCommercialFacts): CanonicalCommercialFacts => ({
  ...facts,
  ...(facts.calculationSnapshot
    ? { calculationSnapshot: cloneCanonicalJson(facts.calculationSnapshot) }
    : {}),
  ...(facts.legacySnapshot
    ? { legacySnapshot: cloneCanonicalJson(facts.legacySnapshot) }
    : {})
});

const calculateAuthoritativeCommercialFacts = (
  facts: CanonicalCommercialFacts,
  policy: CalculationPolicySnapshot
): CanonicalCommercialFacts => {
  const {
    baseAmountToman: _clientBaseAmount,
    totalAmountToman: _clientTotalAmount,
    ...sellerFacts
  } = facts;
  const pricingQuantity =
    facts.requestedAreaSquareMeters ??
    facts.requestedQuantity ??
    facts.requestedLengthMeters;
  if (pricingQuantity === undefined || facts.baseRateToman === undefined) {
    return cloneCommercialFacts(sellerFacts);
  }
  const pricing = calculatePricing({
    policyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding,
    lines: [{
      lineId: 'base-material',
      quantity: pricingQuantity,
      rateToman: facts.baseRateToman
    }]
  });
  return {
    ...cloneCommercialFacts(sellerFacts),
    baseAmountToman: pricing.totalAmountToman,
    totalAmountToman: pricing.totalAmountToman
  };
};

const cloneCatalogSnapshot = (snapshot: CatalogSnapshot): CatalogSnapshot => ({
  ...snapshot,
  facts: {
    ...snapshot.facts,
    ...(snapshot.facts.attributes
      ? { attributes: { ...snapshot.facts.attributes } }
      : {}),
    ...(snapshot.facts.legacySnapshot
      ? { legacySnapshot: cloneCanonicalJson(snapshot.facts.legacySnapshot) }
      : {})
  }
});

const clonePackingPlan = (plan: PackingPlan): PackingPlan => ({
  ...plan,
  consumedSources: plan.consumedSources.map(source => ({ ...source })),
  unusedSources: plan.unusedSources.map(source => ({ ...source })),
  placements: plan.placements.map(placement => ({ ...placement })),
  cuts: plan.cuts.map(cut => ({ ...cut })),
  remainders: plan.remainders.map(remainder => ({ ...remainder }))
});

const cloneGraph = (graph: CanonicalProductGraph): CanonicalProductGraph => ({
  ...graph,
  calculationPolicy: { ...graph.calculationPolicy },
  catalogSnapshots: graph.catalogSnapshots.map(cloneCatalogSnapshot),
  rows: graph.rows.map(row => ({
    ...row,
    ...(row.slab
      ? {
          slab: {
            ...row.slab,
            sourceRows: row.slab.sourceRows.map(source => ({ ...source }))
          }
        }
      : {}),
    commercial: cloneCommercialFacts(row.commercial)
  })),
  stairSystems: graph.stairSystems.map(system => ({ ...system })),
  layerConfigurations: graph.layerConfigurations.map(item => structuredClone(item)),
  sourceBatches: graph.sourceBatches.map(item => ({
    ...item,
    ...(item.initialRemainders
      ? { initialRemainders: item.initialRemainders.map(stock => ({ ...stock })) }
      : {})
  })),
  remainingStones: graph.remainingStones.map(item => ({ ...item })),
  allocations: graph.allocations.map(item => ({
    ...item,
    generatedRemainingStoneIds: [...item.generatedRemainingStoneIds],
    packingPlan: clonePackingPlan(item.packingPlan),
    cuttingPricingLines: item.cuttingPricingLines.map(line => ({ ...line })),
    intentSnapshot: { ...item.intentSnapshot }
  })),
  operationGroups: graph.operationGroups.map(item => ({ ...item })),
  toolSelections: graph.toolSelections.map(item => ({
    ...item,
    ...(item.edges ? { edges: [...item.edges] } : {}),
    ...(item.quantityOverride
      ? { quantityOverride: { ...item.quantityOverride } }
      : {})
  })),
  finishingSelections: graph.finishingSelections.map(item => ({
    ...item,
    incompatibleCatalogItemIds: [...item.incompatibleCatalogItemIds],
    ...(item.quantityOverride
      ? { quantityOverride: { ...item.quantityOverride } }
      : {})
  }))
});

const canonicalGraphValue = (graph: CanonicalProductGraph) => graph;

const canonicalCommandValue = (
  graph: CanonicalProductGraph,
  command: ProductGraphCommand
) => ({
  graph: canonicalGraphValue(graph),
  command
});

const findPolicyConflict = (
  graphPolicy: CalculationPolicySnapshot,
  commandPolicy: CalculationPolicySnapshot
): ProductGraphConflict | null => {
  const policyKeys = ['calculation', 'packing', 'pricing', 'rounding'] as const;
  for (const key of policyKeys) {
    if (graphPolicy[key] !== commandPolicy[key]) {
      return {
        code: 'policy-version-conflict',
        path: ['calculationPolicy', key],
        message: 'Contract product graph policy does not match the command policy.',
        expected: graphPolicy[key],
        received: commandPolicy[key]
      };
    }
  }
  return null;
};

const replayCanonicalResourceConsumers = ({
  rows,
  previousConfigurations,
  layerInputs,
  remainderIntents,
  sourceBatches,
  policy,
  baseCommercialRowIds = new Set<ProductRowId>()
}: {
  readonly rows: readonly CanonicalProductRow[];
  readonly previousConfigurations: readonly CanonicalLayerConfiguration[];
  readonly layerInputs: readonly StairLayerConfigurationInput[];
  readonly remainderIntents: readonly RemainderChildIntent[];
  readonly sourceBatches: readonly CanonicalSourceBatch[];
  readonly policy: CalculationPolicySnapshot;
  readonly baseCommercialRowIds?: ReadonlySet<ProductRowId>;
}):
  | {
      readonly ok: true;
      readonly configurations: readonly CanonicalLayerConfiguration[];
      readonly allocations: readonly CanonicalAllocation[];
      readonly inventory: readonly PaidRemainderStock[];
      readonly rows: readonly CanonicalProductRow[];
    }
  | { readonly ok: false; readonly conflicts: readonly ProductGraphConflict[] } => {
  const parents = new Map<ProductRowId, {
    lengthMeters: CanonicalDecimal;
    crossDimensionMeters: CanonicalDecimal;
    quantity: number;
  }>();
  rows.forEach(row => {
    if (
      row.productType !== 'stair' ||
      !row.stairPart ||
      row.commercial.requestedLengthMeters === undefined ||
      row.commercial.requestedWidthMeters === undefined ||
      row.commercial.requestedQuantity === undefined
    ) return;
    const quantity = Number(row.commercial.requestedQuantity);
    if (Number.isSafeInteger(quantity) && quantity > 0) {
      parents.set(row.productRowId, {
        lengthMeters: row.commercial.requestedLengthMeters,
        crossDimensionMeters: row.commercial.requestedWidthMeters,
        quantity
      });
    }
  });
  let inventory = sourceBatches.flatMap(
    batch => batch.initialRemainders?.map(stock => ({ ...stock })) ?? []
  );
  const configurations: CanonicalLayerConfiguration[] = [];
  const allocations: CanonicalAllocation[] = [];
  const events = [
    ...layerInputs.map(input => ({
      kind: 'layer' as const,
      order: input.creationOrder,
      identity: input.layerConfigurationId,
      input
    })),
    ...remainderIntents.map(intent => ({
      kind: 'remainder' as const,
      order: intent.allocationOrder,
      identity: intent.allocationId,
      intent
    }))
  ].sort(compareProductDependentOrder);
  for (const event of events) {
    if (event.kind === 'layer') {
      const parent = parents.get(event.input.parentProductRowId);
      if (!parent) {
        return {
          ok: false,
          conflicts: [{
            code: 'orphan-graph-reference',
            path: ['layerConfigurations', event.input.layerConfigurationId, 'parent'],
            entityId: event.input.layerConfigurationId,
            message: 'Layer configuration references a missing canonical stair parent.'
          }]
        };
      }
      const calculation = calculateStairLayerConfiguration({
        input: event.input,
        parent,
        availableInventory: inventory
      });
      if (!calculation.ok) {
        return {
          ok: false,
          conflicts: calculation.conflicts.map(conflict => ({
            code: 'product-policy-conflict' as const,
            path: [
              'layerConfigurations',
              event.input.layerConfigurationId,
              conflict.field
            ],
            entityId: conflict.entityId ?? event.input.layerConfigurationId,
            message: conflict.message
          }))
        };
      }
      configurations.push({
        layerConfigurationId: event.input.layerConfigurationId,
        parentProductRowId: event.input.parentProductRowId,
        sourceBatchId: event.input.sourceBatchId,
        creationOrder: event.input.creationOrder,
        input: structuredClone(event.input),
        result: structuredClone(calculation.result)
      });
      inventory = calculation.inventory.map(stock => ({ ...stock }));
      continue;
    }
    const replay = replayRemainderAllocations({
      policyVersion: policy.packing,
      pricingPolicyVersion: policy.pricing,
      roundingPolicyVersion: policy.rounding,
      baseInventory: inventory,
      childIntents: [event.intent]
    });
    if (!replay.ok) {
      return {
        ok: false,
        conflicts: replay.conflicts.map(conflict => ({
          code: 'remainder-allocation-conflict' as const,
          path: ['remainderAllocations', ...conflict.path],
          entityId: conflict.sourceRemainingStoneId,
          productRowId: conflict.childProductRowId,
          message: conflict.message
        }))
      };
    }
    const allocation = replay.result.allocations[0];
    if (!allocation) {
      throw new TypeError(`Allocation ${event.intent.allocationId} was not replayed.`);
    }
    allocations.push({
      ...allocation,
      intentSnapshot: { ...event.intent }
    });
    inventory = replay.result.inventory.map(stock => ({ ...stock }));
  }
  const previousByParent = new Map<ProductRowId, Decimal>();
  previousConfigurations.forEach(configuration => {
    previousByParent.set(
      configuration.parentProductRowId,
      (previousByParent.get(configuration.parentProductRowId) ?? new Decimal(0))
        .plus(configuration.result.totalAmountToman)
    );
  });
  const nextByParent = new Map<ProductRowId, Decimal>();
  configurations.forEach(configuration => {
    nextByParent.set(
      configuration.parentProductRowId,
      (nextByParent.get(configuration.parentProductRowId) ?? new Decimal(0))
        .plus(configuration.result.totalAmountToman)
    );
  });
  const layerPricedRows = rows.map(row => {
    const previous = baseCommercialRowIds.has(row.productRowId)
      ? new Decimal(0)
      : previousByParent.get(row.productRowId) ?? new Decimal(0);
    const next = nextByParent.get(row.productRowId) ?? new Decimal(0);
    if (previous.eq(0) && next.eq(0)) return row;
    return {
      ...row,
      commercial: {
        ...row.commercial,
        totalAmountToman: parseCanonicalDecimal(
          new Decimal(
            row.commercial.totalAmountToman ?? parseCanonicalDecimal('0')
          ).minus(previous).plus(next).toFixed()
        )
      }
    };
  });
  return {
    ok: true,
    configurations,
    allocations,
    inventory,
    rows: layerPricedRows
  };
};

const reconcileRemainderChildCommercialFacts = ({
  rows,
  allocations,
  operationGroups,
  toolSelections,
  finishingSelections,
  policy
}: {
  readonly rows: readonly CanonicalProductRow[];
  readonly allocations: readonly CanonicalAllocation[];
  readonly operationGroups: readonly CanonicalOperationGroup[];
  readonly toolSelections: readonly CanonicalToolSelection[];
  readonly finishingSelections: readonly CanonicalFinishingSelection[];
  readonly policy: CalculationPolicySnapshot;
}): CanonicalProductRow[] => {
  const allocationByTarget = new Map(
    allocations.map(allocation => [allocation.targetProductRowId, allocation])
  );
  return rows.map(row => {
    const allocation = allocationByTarget.get(row.productRowId);
    if (!allocation) return row;
    const groupIds = new Set(
      operationGroups
        .filter(group => group.productRowId === row.productRowId)
        .map(group => group.operationGroupId)
    );
    const operationAmounts = [
      ...toolSelections
        .filter(selection => groupIds.has(selection.operationGroupId))
        .map(selection => ({
          lineId: `tool:${selection.toolSelectionId}`,
          quantity: selection.amountToman,
          rateToman: parseCanonicalDecimal('1')
        })),
      ...finishingSelections
        .filter(selection => groupIds.has(selection.operationGroupId))
        .map(selection => ({
          lineId: `finishing:${selection.finishingSelectionId}`,
          quantity: selection.amountToman,
          rateToman: parseCanonicalDecimal('1')
        }))
    ];
    const total = calculatePricing({
      policyVersion: policy.pricing,
      roundingPolicyVersion: policy.rounding,
      lines: [
        {
          lineId: `remainder-cutting:${allocation.allocationId}`,
          quantity: allocation.cuttingAmountToman,
          rateToman: parseCanonicalDecimal('1')
        },
        ...operationAmounts
      ]
    });
    return {
      ...row,
      commercial: {
        ...row.commercial,
        baseRateToman: parseCanonicalDecimal('0'),
        baseAmountToman: parseCanonicalDecimal('0'),
        totalAmountToman: total.totalAmountToman,
        calculationSnapshot: {
          ...cloneCanonicalJson(row.commercial.calculationSnapshot ?? {}),
          materialPricing: {
            amountToman: '0',
            reason: 'paid-in-source-product'
          },
          remainderCutting: {
            allocationId: allocation.allocationId,
            longitudinalMeters: allocation.packingPlan.longitudinalCutMeters,
            crossMeters: allocation.packingPlan.crossCutMeters,
            calibrationMeters: allocation.packingPlan.calibrationMeters,
            amountToman: allocation.cuttingAmountToman
          }
        }
      }
    };
  });
};

const appliedResult = ({
  inputGraph,
  command,
  nextGraph
}: {
  readonly inputGraph: CanonicalProductGraph;
  readonly command: ProductGraphCommand;
  readonly nextGraph: CanonicalProductGraph;
}): ProductGraphCommandResult => ({
  ok: true,
  graph: nextGraph,
  appliedCommand: {
    commandId: command.commandId,
    inputRevision: inputGraph.revision,
    outputRevision: nextGraph.revision,
    inputHash: hashCanonicalValue(canonicalCommandValue(inputGraph, command)),
    resultHash: hashCanonicalValue(canonicalGraphValue(nextGraph))
  }
});

export const executeProductGraphCommand = (
  request: ProductGraphCommandRequest
): ProductGraphCommandResult => {
  let graph: CanonicalProductGraph;
  let command: ProductGraphCommand;
  try {
    graph = parseCanonicalProductGraph(request.graph);
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        code: 'invalid-canonical-graph',
        path: ['graph'],
        message: error instanceof Error ? error.message : 'Canonical graph is invalid.'
      }]
    };
  }
  try {
    command = parseProductGraphCommand(request.command);
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        code: 'invalid-canonical-command',
        path: ['command'],
        message: error instanceof Error ? error.message : 'Canonical command is invalid.'
      }]
    };
  }
  if (command.baseRevision !== graph.revision) {
    return {
      ok: false,
      conflicts: [{
        code: 'revision-conflict',
        path: ['revision'],
        message: 'Contract product graph revision does not match the command base revision.',
        expected: graph.revision,
        received: command.baseRevision
      }]
    };
  }

  const policyConflict = findPolicyConflict(graph.calculationPolicy, command.calculationPolicy);
  if (policyConflict) {
    return { ok: false, conflicts: [policyConflict] };
  }

  if (command.type === 'delete-row') {
    const deletedRow = graph.rows.find(
      row => row.productRowId === command.sellerIntent.productRowId
    );
    if (!deletedRow) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-row-missing',
          path: ['rows', command.sellerIntent.productRowId],
          productRowId: command.sellerIntent.productRowId,
          message: 'Contract product row does not exist for deletion.'
        }]
      };
    }
    const intents = graph.allocations.map(allocation => allocation.intentSnapshot);
    const dependents = intents.filter(
      intent => intent.sourceProductRowId === deletedRow.productRowId
    );
    if (!canDeleteRemainderSource(deletedRow.productRowId, intents)) {
      return {
        ok: false,
        conflicts: dependents.map(intent => ({
          code: 'source-has-dependent-products' as const,
          path: ['rows', deletedRow.productRowId, 'dependents'],
          productRowId: deletedRow.productRowId,
          entityId: intent.childProductRowId,
          message: 'The source product has dependent remainder products and cannot be deleted.'
        }))
      };
    }
    const removedGroupIds = new Set(
      graph.operationGroups
        .filter(group => group.productRowId === deletedRow.productRowId)
        .map(group => group.operationGroupId)
    );
    const retainedIntents = intents.filter(
      intent => intent.childProductRowId !== deletedRow.productRowId
    );
    const retainedSourceBatches = graph.sourceBatches.filter(
      batch => batch.ownerProductRowId !== deletedRow.productRowId
    );
    const nextRows = graph.rows.filter(
      row => row.productRowId !== deletedRow.productRowId
    );
    const nextStairSystems = graph.stairSystems.filter(system =>
      nextRows.some(
        row => row.stairPart?.stairSystemId === system.stairSystemId
      )
    );
    const nextOperationGroups = graph.operationGroups.filter(
      group => !removedGroupIds.has(group.operationGroupId)
    );
    const nextToolSelections = graph.toolSelections.filter(
      selection => !removedGroupIds.has(selection.operationGroupId)
    );
    const nextFinishingSelections = graph.finishingSelections.filter(
      selection => !removedGroupIds.has(selection.operationGroupId)
    );
    const retainedLayerInputs = graph.layerConfigurations
      .filter(configuration =>
        configuration.parentProductRowId !== deletedRow.productRowId
      )
      .map(configuration => configuration.input);
    const resourceReplay = replayCanonicalResourceConsumers({
      rows: nextRows,
      previousConfigurations: graph.layerConfigurations,
      layerInputs: retainedLayerInputs,
      remainderIntents: retainedIntents,
      sourceBatches: retainedSourceBatches,
      policy: graph.calculationPolicy
    });
    if (!resourceReplay.ok) return resourceReplay;
    const previousLayerBatchIds = new Set(
      graph.layerConfigurations.map(
        configuration => configuration.sourceBatchId
      )
    );
    const finalSourceBatches = [
      ...retainedSourceBatches.filter(
        batch => !previousLayerBatchIds.has(batch.sourceBatchId)
      ),
      ...resourceReplay.configurations.map(configuration => ({
        sourceBatchId: configuration.sourceBatchId,
        ownerProductRowId: configuration.parentProductRowId
      }))
    ];
    const nextGraph: CanonicalProductGraph = {
      ...cloneGraph(graph),
      revision: graph.revision + 1,
      rows: reconcileRemainderChildCommercialFacts({
        rows: resourceReplay.rows,
        allocations: resourceReplay.allocations,
        operationGroups: nextOperationGroups,
        toolSelections: nextToolSelections,
        finishingSelections: nextFinishingSelections,
        policy: graph.calculationPolicy
      }),
      stairSystems: nextStairSystems,
      layerConfigurations: resourceReplay.configurations,
      sourceBatches: finalSourceBatches,
      remainingStones: resourceReplay.inventory,
      allocations: resourceReplay.allocations,
      operationGroups: nextOperationGroups,
      toolSelections: nextToolSelections,
      finishingSelections: nextFinishingSelections
    };
    const conflicts = findGraphIntegrityConflicts(nextGraph);
    if (conflicts.length > 0) return { ok: false, conflicts };
    return appliedResult({ inputGraph: graph, command, nextGraph });
  }

  if (command.type === 'delete-layer-configuration') {
    const deleted = graph.layerConfigurations.find(
      configuration =>
        configuration.layerConfigurationId ===
        command.sellerIntent.layerConfigurationId
    );
    if (!deleted) {
      return {
        ok: false,
        conflicts: [{
          code: 'layer-configuration-missing',
          path: [
            'layerConfigurations',
            command.sellerIntent.layerConfigurationId
          ],
          entityId: command.sellerIntent.layerConfigurationId,
          message: 'Structural layer configuration does not exist for deletion.'
        }]
      };
    }
    const retainedInputs = graph.layerConfigurations
      .filter(configuration =>
        configuration.layerConfigurationId !== deleted.layerConfigurationId
      )
      .map(configuration => configuration.input);
    const resourceReplay = replayCanonicalResourceConsumers({
      rows: graph.rows,
      previousConfigurations: graph.layerConfigurations,
      layerInputs: retainedInputs,
      remainderIntents: graph.allocations.map(
        allocation => allocation.intentSnapshot
      ),
      sourceBatches: graph.sourceBatches,
      policy: graph.calculationPolicy
    });
    if (!resourceReplay.ok) return resourceReplay;
    const previousLayerBatchIds = new Set(
      graph.layerConfigurations.map(
        configuration => configuration.sourceBatchId
      )
    );
    const nextGraph: CanonicalProductGraph = {
      ...cloneGraph(graph),
      revision: graph.revision + 1,
      rows: reconcileRemainderChildCommercialFacts({
        rows: resourceReplay.rows,
        allocations: resourceReplay.allocations,
        operationGroups: graph.operationGroups,
        toolSelections: graph.toolSelections,
        finishingSelections: graph.finishingSelections,
        policy: graph.calculationPolicy
      }),
      layerConfigurations: resourceReplay.configurations,
      sourceBatches: [
        ...graph.sourceBatches.filter(
          batch => !previousLayerBatchIds.has(batch.sourceBatchId)
        ),
        ...resourceReplay.configurations.map(configuration => ({
          sourceBatchId: configuration.sourceBatchId,
          ownerProductRowId: configuration.parentProductRowId
        }))
      ],
      remainingStones: resourceReplay.inventory,
      allocations: resourceReplay.allocations
    };
    const conflicts = findGraphIntegrityConflicts(nextGraph);
    if (conflicts.length > 0) return { ok: false, conflicts };
    return appliedResult({ inputGraph: graph, command, nextGraph });
  }

  if (command.type === 'add-stair-system') {
    if (graph.stairSystems.some(
      system => system.stairSystemId === command.sellerIntent.stairSystemId
    )) {
      return {
        ok: false,
        conflicts: [{
          code: 'duplicate-stable-identity',
          path: ['stairSystems', command.sellerIntent.stairSystemId],
          entityId: command.sellerIntent.stairSystemId,
          message: 'Stair system identity already exists.'
        }]
      };
    }
    if (command.sellerIntent.parts.length === 0) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'parts'],
          message: 'A stair system must contain at least one selected part.'
        }]
      };
    }
    const partWithoutExactlyOneCatalogSnapshot = command.sellerIntent.parts.find(part =>
      command.catalogSnapshots.filter(snapshot =>
        snapshot.catalogProductId === part.row.catalogProductId &&
        snapshot.snapshotVersion === part.row.catalogSnapshotVersion
      ).length !== 1
    );
    if (partWithoutExactlyOneCatalogSnapshot) {
      return {
        ok: false,
        conflicts: [{
          code: 'catalog-snapshot-conflict',
          path: [
            'catalogSnapshots',
            partWithoutExactlyOneCatalogSnapshot.row.catalogProductId,
            partWithoutExactlyOneCatalogSnapshot.row.catalogSnapshotVersion
          ],
          productRowId: partWithoutExactlyOneCatalogSnapshot.row.productRowId,
          message: 'Every stair row requires exactly one matching catalog stone snapshot.'
        }]
      };
    }
    let resolvedQuantity: CanonicalStairSystem;
    try {
      resolvedQuantity = {
        ...resolveStaircaseQuantity(command.sellerIntent.quantity),
        stairSystemId: command.sellerIntent.stairSystemId
      };
    } catch (error) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'quantity'],
          message: error instanceof Error ? error.message : 'Stair quantity is invalid.'
        }]
      };
    }
    let stagedGraph: CanonicalProductGraph = {
      ...cloneGraph(graph),
      stairSystems: [...graph.stairSystems, resolvedQuantity]
    };
    for (const [index, part] of command.sellerIntent.parts.entries()) {
      if (!part.stairPartPolicyInput) {
        return {
          ok: false,
          conflicts: [{
            code: 'product-policy-conflict',
            path: ['sellerIntent', 'parts', String(index), 'stairPartPolicyInput'],
            productRowId: part.row.productRowId,
            message: 'Every stair-system part requires complete stair policy input.'
          }]
        };
      }
      if (
        part.stairPartPolicyInput.stairSystemId !==
        command.sellerIntent.stairSystemId
      ) {
        return {
          ok: false,
          conflicts: [{
            code: 'orphan-graph-reference',
            path: ['sellerIntent', 'parts', String(index), 'stairSystemId'],
            productRowId: part.row.productRowId,
            received: part.stairPartPolicyInput.stairSystemId,
            expected: command.sellerIntent.stairSystemId,
            message: 'Every created stair part must belong to the new stair system.'
          }]
        };
      }
      const initializedQuantity =
        part.stairPartPolicyInput.quantity === undefined &&
        (part.stairPartPolicyInput.part === 'tread' ||
          part.stairPartPolicyInput.part === 'riser')
          ? resolvedQuantity.totalSteps
          : part.stairPartPolicyInput.quantity;
      const result = executeProductGraphCommand({
        graph: stagedGraph,
        command: {
          commandId: command.commandId,
          type: 'add-row',
          baseRevision: stagedGraph.revision,
          calculationPolicy: command.calculationPolicy,
          sellerIntent: {
            ...part,
            stairPartPolicyInput: {
              ...part.stairPartPolicyInput,
              ...(initializedQuantity === undefined
                ? {}
                : { quantity: initializedQuantity })
            }
          },
          catalogSnapshots: command.catalogSnapshots
        }
      });
      if (!result.ok) {
        return {
          ok: false,
          conflicts: result.conflicts.map(conflict => ({
            ...conflict,
            path: ['sellerIntent', 'parts', String(index), ...conflict.path]
          }))
        };
      }
      stagedGraph = result.graph;
    }
    const nextGraph = {
      ...stagedGraph,
      revision: graph.revision + 1
    };
    return appliedResult({ inputGraph: graph, command, nextGraph });
  }

  const requestedRow = command.sellerIntent.row;
  let nextRow = requestedRow;
  let operationResult: ProductOperationsResult | undefined;
  let calculatedSourceBatch: CanonicalSourceBatch | undefined;
  if (
    requestedRow.productType === 'stair' &&
    !command.sellerIntent.stairPartPolicyInput
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'stairPartPolicyInput'],
        productRowId: requestedRow.productRowId,
        message: 'Canonical stair writes require complete stair-part policy input.'
      }]
    };
  }
  if (
    requestedRow.productType === 'slab' &&
    !command.sellerIntent.slabPolicyInput
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'slabPolicyInput'],
        productRowId: requestedRow.productRowId,
        message: 'Canonical slab writes require complete slab policy input.'
      }]
    };
  }
  if (
    command.sellerIntent.stairPartPolicyInput &&
    requestedRow.productType !== 'stair'
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'stairPartPolicyInput'],
        productRowId: requestedRow.productRowId,
        message: 'Stair policy input can only be applied to a stair row.'
      }]
    };
  }
  if (
    command.sellerIntent.productPolicyInput &&
    requestedRow.productType !== 'longitudinal'
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'productPolicyInput'],
        productRowId: requestedRow.productRowId,
        message: 'Longitudinal policy input can only be applied to a longitudinal row.'
      }]
    };
  }
  if (
    command.sellerIntent.slabPolicyInput &&
    requestedRow.productType !== 'slab'
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'slabPolicyInput'],
        productRowId: requestedRow.productRowId,
        message: 'Slab policy input can only be applied to a slab row.'
      }]
    };
  }
  if (requestedRow.productType === 'longitudinal' && command.sellerIntent.productPolicyInput) {
    let policyInput;
    try {
      policyInput = parseLongitudinalProductInput(command.sellerIntent.productPolicyInput);
    } catch (error) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'productPolicyInput'],
          productRowId: requestedRow.productRowId,
          message: error instanceof Error ? error.message : 'Longitudinal input is invalid.'
        }]
      };
    }
    const expectedVersions = {
      calculationPolicyVersion: graph.calculationPolicy.calculation,
      packingPolicyVersion: graph.calculationPolicy.packing,
      pricingPolicyVersion: graph.calculationPolicy.pricing,
      roundingPolicyVersion: graph.calculationPolicy.rounding
    };
    const mismatchedVersion = Object.entries(expectedVersions).find(
      ([key, expected]) => policyInput[key as keyof typeof expectedVersions] !== expected
    );
    if (mismatchedVersion) {
      return {
        ok: false,
        conflicts: [{
          code: 'policy-version-conflict',
          path: ['sellerIntent', 'productPolicyInput', mismatchedVersion[0]],
          productRowId: requestedRow.productRowId,
          message: 'Longitudinal policy input does not match the graph policy.',
          expected: mismatchedVersion[1],
          received: String(policyInput[
            mismatchedVersion[0] as keyof typeof expectedVersions
          ])
        }]
      };
    }
    const calculation = calculateLongitudinalProduct(policyInput);
    if (!calculation.ok) {
      return {
        ok: false,
        conflicts: calculation.conflicts.map(conflict => ({
          code: 'product-policy-conflict' as const,
          path: ['sellerIntent', 'productPolicyInput', conflict.field],
          productRowId: requestedRow.productRowId,
          message: conflict.message
        }))
      };
    }
    const calculationSnapshot = normalizeLegacyJson(
      calculation.result
    ) as CanonicalJsonObject;
    if (!command.sellerIntent.remainderChildPolicyInput) {
      calculatedSourceBatch = {
        sourceBatchId: policyInput.sourceBatchId,
        ownerProductRowId: requestedRow.productRowId,
        initialRemainders: materializePaidRemainderStocks({
          ownerProductRowId: requestedRow.productRowId,
          catalogProductId: requestedRow.catalogProductId,
          sourceBatchId: policyInput.sourceBatchId,
          remainders: calculation.result.remainders,
          startingCreationOrder: (() => {
            const existing = graph.sourceBatches
              .find(batch => batch.ownerProductRowId === requestedRow.productRowId)
              ?.initialRemainders ?? [];
            return existing.length > 0
              ? Math.min(...existing.map(stock => stock.creationOrder))
              : graph.rows.length * 1000;
          })()
        })
      };
    }
    nextRow = {
      ...requestedRow,
      commercial: {
        requestedLengthMeters: calculation.result.lengthMeters,
        requestedWidthMeters: calculation.result.widthMeters,
        requestedAreaSquareMeters: calculation.result.requestedAreaSquareMeters,
        ...(calculation.result.quantity === undefined
          ? {}
          : {
              requestedQuantity: parseCanonicalDecimal(
                String(calculation.result.quantity)
              )
            }),
        baseRateToman: policyInput.baseRateToman,
        baseAmountToman: calculation.result.baseAmountToman,
        totalAmountToman: calculation.result.totalAmountToman,
        calculationSnapshot
      }
    };
  }
  if (requestedRow.productType === 'slab' && command.sellerIntent.slabPolicyInput) {
    const slabInput = command.sellerIntent.slabPolicyInput;
    const expectedVersions = {
      calculationPolicyVersion: graph.calculationPolicy.calculation,
      packingPolicyVersion: graph.calculationPolicy.packing,
      pricingPolicyVersion: graph.calculationPolicy.pricing,
      roundingPolicyVersion: graph.calculationPolicy.rounding
    };
    const mismatchedVersion = Object.entries(expectedVersions).find(
      ([key, expected]) => slabInput[key as keyof typeof expectedVersions] !== expected
    );
    if (mismatchedVersion) {
      return {
        ok: false,
        conflicts: [{
          code: 'policy-version-conflict',
          path: ['sellerIntent', 'slabPolicyInput', mismatchedVersion[0]],
          productRowId: requestedRow.productRowId,
          expected: mismatchedVersion[1],
          received: String(
            slabInput[mismatchedVersion[0] as keyof typeof expectedVersions]
          ),
          message: 'Slab policy version does not match the graph policy.'
        }]
      };
    }
    const calculation = calculateSlab(slabInput);
    if (!calculation.ok) {
      return {
        ok: false,
        conflicts: calculation.conflicts.map(conflict => ({
          code: 'product-policy-conflict' as const,
          path: ['sellerIntent', 'slabPolicyInput', conflict.field],
          productRowId: requestedRow.productRowId,
          entityId: conflict.entityId,
          message: conflict.message
        }))
      };
    }
    calculatedSourceBatch = {
      sourceBatchId: slabInput.sourceBatchId,
      ownerProductRowId: requestedRow.productRowId,
      initialRemainders: materializePaidRemainderStocks({
        ownerProductRowId: requestedRow.productRowId,
        catalogProductId: requestedRow.catalogProductId,
        sourceBatchId: slabInput.sourceBatchId,
        remainders: calculation.result.packingPlan.remainders,
        startingCreationOrder: (() => {
          const existingRemainders = graph.sourceBatches.find(
            batch => batch.ownerProductRowId === requestedRow.productRowId
          )?.initialRemainders ?? [];
          return existingRemainders.length > 0
            ? Math.min(...existingRemainders.map(remainder => remainder.creationOrder))
            : graph.rows.length * 1000;
        })()
      })
    };
    nextRow = {
      ...requestedRow,
      slab: {
        lengthDisplayUnit: calculation.result.lengthDisplayUnit,
        widthDisplayUnit: calculation.result.widthDisplayUnit,
        cuttingPricingMethod: calculation.result.cuttingPricingMethod,
        sourceRows: calculation.result.sourceRows.map(source => ({ ...source }))
      },
      commercial: {
        requestedLengthMeters: calculation.result.lengthMeters,
        requestedWidthMeters: calculation.result.widthMeters,
        requestedAreaSquareMeters: calculation.result.finishedAreaSquareMeters,
        requestedQuantity: parseCanonicalDecimal(
          String(calculation.result.quantity)
        ),
        baseRateToman: slabInput.baseMaterialRateToman,
        baseAmountToman: calculation.result.materialAmountToman,
        totalAmountToman: calculation.result.totalAmountToman,
        calculationSnapshot: normalizeLegacyJson(
          calculation.result
        ) as CanonicalJsonObject
      }
    };
  }
  if (requestedRow.productType === 'stair' && command.sellerIntent.stairPartPolicyInput) {
    const stairInput = command.sellerIntent.stairPartPolicyInput;
    const expectedVersions = {
      calculationPolicyVersion: graph.calculationPolicy.calculation,
      packingPolicyVersion: graph.calculationPolicy.packing,
      pricingPolicyVersion: graph.calculationPolicy.pricing,
      roundingPolicyVersion: graph.calculationPolicy.rounding
    };
    const mismatchedVersion = Object.entries(expectedVersions).find(
      ([key, expected]) => stairInput[key as keyof typeof expectedVersions] !== expected
    );
    if (mismatchedVersion) {
      return {
        ok: false,
        conflicts: [{
          code: 'policy-version-conflict',
          path: ['sellerIntent', 'stairPartPolicyInput', mismatchedVersion[0]],
          productRowId: requestedRow.productRowId,
          expected: mismatchedVersion[1],
          received: stairInput[
            mismatchedVersion[0] as keyof typeof expectedVersions
          ],
          message: 'Stair part policy version does not match the graph policy.'
        }]
      };
    }
    const stairSystem = graph.stairSystems.find(
      system => system.stairSystemId === stairInput.stairSystemId
    );
    if (!stairSystem) {
      return {
        ok: false,
        conflicts: [{
          code: 'orphan-graph-reference',
          path: ['sellerIntent', 'stairPartPolicyInput', 'stairSystemId'],
          productRowId: requestedRow.productRowId,
          received: stairInput.stairSystemId,
          message: 'Stair part references a missing stair system.'
        }]
      };
    }
    const calculation = calculateStairPart(stairInput);
    if (!calculation.ok) {
      return {
        ok: false,
        conflicts: calculation.conflicts.map(conflict => ({
          code: 'product-policy-conflict' as const,
          path: ['sellerIntent', 'stairPartPolicyInput', conflict.field],
          productRowId: requestedRow.productRowId,
          message: conflict.message
        }))
      };
    }
    const calculationSnapshot = normalizeLegacyJson(
      calculation.result
    ) as CanonicalJsonObject;
    calculatedSourceBatch = {
      sourceBatchId: stairInput.sourceBatchId,
      ownerProductRowId: requestedRow.productRowId,
      initialRemainders: materializePaidRemainderStocks({
        ownerProductRowId: requestedRow.productRowId,
        catalogProductId: requestedRow.catalogProductId,
        sourceBatchId: stairInput.sourceBatchId,
        remainders: calculation.result.packingPlan.remainders,
        startingCreationOrder: (() => {
          const existing = graph.sourceBatches
            .find(batch => batch.ownerProductRowId === requestedRow.productRowId)
            ?.initialRemainders ?? [];
          return existing.length > 0
            ? Math.min(...existing.map(stock => stock.creationOrder))
            : graph.rows.length * 1000;
        })()
      })
    };
    nextRow = {
      ...requestedRow,
      stairPart: calculation.result.stairPart,
      commercial: {
        requestedLengthMeters: calculation.result.lengthMeters,
        requestedWidthMeters: calculation.result.crossDimensionMeters,
        requestedAreaSquareMeters: calculation.result.requestedAreaSquareMeters,
        requestedQuantity: parseCanonicalDecimal(String(calculation.result.quantity)),
        baseRateToman: stairInput.baseRateToman,
        baseAmountToman: calculation.result.baseAmountToman,
        totalAmountToman: calculation.result.totalAmountToman,
        calculationSnapshot
      }
    };
  }
  if (command.sellerIntent.remainderChildPolicyInput) {
    const childInput = command.sellerIntent.remainderChildPolicyInput;
    const authoritativeQuantity = nextRow.commercial.requestedQuantity === undefined
      ? undefined
      : Number(nextRow.commercial.requestedQuantity);
    if (
      nextRow.sourceProductRowId !== childInput.sourceProductRowId ||
      nextRow.commercial.requestedLengthMeters !== childInput.lengthMeters ||
      nextRow.commercial.requestedWidthMeters !== childInput.widthMeters ||
      authoritativeQuantity !== childInput.quantity
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'remainder-allocation-conflict',
          path: ['sellerIntent', 'remainderChildPolicyInput', 'geometry'],
          productRowId: nextRow.productRowId,
          message: 'Remainder allocation must use the authoritative child geometry and source.'
        }]
      };
    }
    const sourceRow = graph.rows.find(
      row => row.productRowId === childInput.sourceProductRowId
    );
    if (!sourceRow) {
      return {
        ok: false,
        conflicts: [{
          code: 'orphan-product-reference',
          path: ['sellerIntent', 'row', 'sourceProductRowId'],
          productRowId: nextRow.productRowId,
          message: 'Remainder child references a missing source product row.',
          received: childInput.sourceProductRowId
        }]
      };
    }
    if (
      sourceRow.catalogProductId !== nextRow.catalogProductId ||
      nextRow.commercial.baseRateToman !== parseCanonicalDecimal('0') ||
      command.sellerIntent.productPolicyInput?.baseMaterialPricing !==
        'paid-source-zero'
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'remainder-allocation-conflict',
          path: ['sellerIntent', 'remainderChildPolicyInput', 'pricing'],
          productRowId: nextRow.productRowId,
          message: 'A remainder child must use the source catalog stone with zero material rate.'
        }]
      };
    }
    const snapshot = nextRow.commercial.calculationSnapshot ?? {};
    nextRow = {
      ...nextRow,
      commercial: {
        ...nextRow.commercial,
        baseRateToman: parseCanonicalDecimal('0'),
        baseAmountToman: parseCanonicalDecimal('0'),
        calculationSnapshot: {
          ...cloneCanonicalJson(snapshot),
          materialPricing: {
            amountToman: '0',
            reason: 'paid-in-source-product'
          }
        }
      }
    };
  }
  if (
    !command.sellerIntent.productPolicyInput &&
    !command.sellerIntent.stairPartPolicyInput &&
    !command.sellerIntent.slabPolicyInput
  ) {
    nextRow = {
      ...nextRow,
      commercial: calculateAuthoritativeCommercialFacts(
        nextRow.commercial,
        graph.calculationPolicy
      )
    };
  }
  if (command.sellerIntent.operationPolicyInput) {
    const operationInput = command.sellerIntent.operationPolicyInput;
    const expectedQuantity = nextRow.commercial.requestedQuantity === undefined
      ? undefined
      : Number(nextRow.commercial.requestedQuantity);
    if (
      operationInput.productRowId !== nextRow.productRowId ||
      operationInput.lengthMeters !== nextRow.commercial.requestedLengthMeters ||
      operationInput.widthMeters !== nextRow.commercial.requestedWidthMeters ||
      operationInput.quantity !== expectedQuantity
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'operationPolicyInput', 'geometry'],
          productRowId: nextRow.productRowId,
          message: 'Operation groups must use the authoritative product geometry.'
        }]
      };
    }
    if (
      operationInput.policyVersion !== graph.calculationPolicy.calculation ||
      operationInput.pricingPolicyVersion !== graph.calculationPolicy.pricing ||
      operationInput.roundingPolicyVersion !== graph.calculationPolicy.rounding
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'policy-version-conflict',
          path: ['sellerIntent', 'operationPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Operation policy input does not match the graph policy.'
        }]
      };
    }
    const operations = calculateProductOperations(operationInput);
    if (!operations.ok) {
      return {
        ok: false,
        conflicts: operations.conflicts.map(conflict => ({
          code: 'product-policy-conflict' as const,
          path: ['sellerIntent', 'operationPolicyInput', ...conflict.path],
          productRowId: nextRow.productRowId,
          entityId: conflict.entityId,
          message: conflict.message
        }))
      };
    }
    operationResult = operations.result;
    const existingAmount = nextRow.commercial.totalAmountToman ??
      parseCanonicalDecimal('0');
    const combined = calculatePricing({
      policyVersion: graph.calculationPolicy.pricing,
      roundingPolicyVersion: graph.calculationPolicy.rounding,
      lines: [
        {
          lineId: 'product-before-operations',
          quantity: existingAmount,
          rateToman: parseCanonicalDecimal('1')
        },
        {
          lineId: 'operations',
          quantity: operations.result.totalAmountToman,
          rateToman: parseCanonicalDecimal('1')
        }
      ]
    });
    const existingSnapshot = nextRow.commercial.calculationSnapshot ?? {};
    nextRow = {
      ...nextRow,
      commercial: {
        ...nextRow.commercial,
        totalAmountToman: combined.totalAmountToman,
        calculationSnapshot: {
          ...cloneCanonicalJson(existingSnapshot),
          operations: normalizeLegacyJson(operations.result)
        }
      }
    };
  }
  const existingRowIndex = graph.rows.findIndex(
    existingRow => existingRow.productRowId === nextRow.productRowId
  );
  if (command.type === 'add-row' && existingRowIndex >= 0) {
    return {
      ok: false,
      conflicts: [{
        code: 'duplicate-product-row-id',
        path: ['rows', nextRow.productRowId],
        productRowId: nextRow.productRowId,
        message: 'Contract product row identity already exists.'
      }]
    };
  }
  if (command.type === 'replace-row' && existingRowIndex < 0) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-row-missing',
        path: ['rows', nextRow.productRowId],
        productRowId: nextRow.productRowId,
        message: 'Contract product row does not exist for replacement.'
      }]
    };
  }
  if (command.type === 'replace-row') {
    const existingRow = graph.rows[existingRowIndex];
    if (
      existingRow.productType !== nextRow.productType ||
      existingRow.catalogProductId !== nextRow.catalogProductId ||
      existingRow.catalogSnapshotVersion !== nextRow.catalogSnapshotVersion
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'row', 'catalogIdentity'],
          productRowId: nextRow.productRowId,
          message: 'Editing a row cannot change its product type or catalog identity.'
        }]
      };
    }
    if (
      existingRow.productType === 'stair' &&
      existingRow.stairPart &&
      !command.sellerIntent.stairPartPolicyInput
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'stairPartPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Editing a canonical stair row requires its complete policy input.'
        }]
      };
    }
    if (
      existingRow.stairPart &&
      nextRow.stairPart &&
      (
        existingRow.stairPart.stairSystemId !== nextRow.stairPart.stairSystemId ||
        existingRow.stairPart.part !== nextRow.stairPart.part
      )
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'stairPartPolicyInput', 'identity'],
          productRowId: nextRow.productRowId,
          message: 'Editing a stair row cannot move it to another system or part type.'
        }]
      };
    }
    if (
      existingRow.productType === 'longitudinal' &&
      existingRow.commercial.calculationSnapshot &&
      !command.sellerIntent.productPolicyInput
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'productPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Editing a canonical longitudinal row requires its complete policy input.'
        }]
      };
    }
    if (
      existingRow.productType === 'slab' &&
      existingRow.slab &&
      !command.sellerIntent.slabPolicyInput
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'slabPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Editing a canonical slab row requires its complete policy input.'
        }]
      };
    }
    const existingOperationGroups = graph.operationGroups.filter(
      group => group.productRowId === nextRow.productRowId
    );
    if (
      existingOperationGroups.length > 0 &&
      !command.sellerIntent.operationPolicyInput
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'product-policy-conflict',
          path: ['sellerIntent', 'operationPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Editing a row with operations requires its complete operation input.'
        }]
      };
    }
    const existingAllocation = graph.allocations.find(
      allocation => allocation.targetProductRowId === nextRow.productRowId
    );
    if (existingAllocation && !command.sellerIntent.remainderChildPolicyInput) {
      return {
        ok: false,
        conflicts: [{
          code: 'remainder-allocation-conflict',
          path: ['sellerIntent', 'remainderChildPolicyInput'],
          productRowId: nextRow.productRowId,
          message: 'Editing a remainder child requires its complete explicit source input.'
        }]
      };
    }
    if (
      existingAllocation &&
      command.sellerIntent.remainderChildPolicyInput &&
      existingAllocation.allocationId !==
        command.sellerIntent.remainderChildPolicyInput.allocationId
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'remainder-allocation-conflict',
          path: ['sellerIntent', 'remainderChildPolicyInput', 'allocationId'],
          productRowId: nextRow.productRowId,
          message: 'Editing a remainder child cannot replace its stable allocation identity.'
        }]
      };
    }
  }

  const matchingCatalogSnapshots = command.catalogSnapshots.filter(snapshot =>
    snapshot.catalogProductId === nextRow.catalogProductId &&
    snapshot.snapshotVersion === nextRow.catalogSnapshotVersion
  );
  const matchingCatalogSnapshot = matchingCatalogSnapshots[0];
  if (!matchingCatalogSnapshot) {
    return {
      ok: false,
      conflicts: [{
        code: 'catalog-snapshot-missing',
        path: ['catalogSnapshots', nextRow.catalogProductId, nextRow.catalogSnapshotVersion],
        productRowId: nextRow.productRowId,
        message: 'Contract product row does not have its referenced catalog snapshot.'
      }]
    };
  }
  if (command.sellerIntent.stairPartPolicyInput) {
    const stairInput = command.sellerIntent.stairPartPolicyInput;
    if (
      matchingCatalogSnapshot.facts.motherWidthMeters === undefined ||
      stairInput.motherWidthMeters !==
        matchingCatalogSnapshot.facts.motherWidthMeters
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'catalog-snapshot-conflict',
          path: ['catalogSnapshots', nextRow.catalogProductId, 'motherWidthMeters'],
          productRowId: nextRow.productRowId,
          message: 'Stair mother width must exactly match the inventory snapshot.'
        }]
      };
    }
  }

  const existingCatalogSnapshot = graph.catalogSnapshots.find(snapshot =>
    snapshot.catalogProductId === matchingCatalogSnapshot.catalogProductId &&
    snapshot.snapshotVersion === matchingCatalogSnapshot.snapshotVersion
  );
  const snapshotTruths = [existingCatalogSnapshot, ...matchingCatalogSnapshots]
    .filter((snapshot): snapshot is CatalogSnapshot => snapshot !== undefined)
    .map(snapshot => stableCanonicalJson(snapshot));
  if (new Set(snapshotTruths).size > 1) {
    return {
      ok: false,
      conflicts: [{
        code: 'catalog-snapshot-conflict',
        path: [
          'catalogSnapshots',
          matchingCatalogSnapshot.catalogProductId,
          matchingCatalogSnapshot.snapshotVersion
        ],
        productRowId: nextRow.productRowId,
        message: 'Catalog snapshot identity has contradictory immutable facts.'
      }]
    };
  }

  const nextGraphBase = cloneGraph(graph);
  const replacedOperationGroupIds = new Set(
    command.type === 'replace-row'
      ? nextGraphBase.operationGroups
          .filter(group => group.productRowId === nextRow.productRowId)
          .map(group => group.operationGroupId)
      : []
  );
  const retainedOperationGroups = nextGraphBase.operationGroups.filter(
    group => !replacedOperationGroupIds.has(group.operationGroupId)
  );
  const retainedToolSelections = nextGraphBase.toolSelections.filter(
    selection => !replacedOperationGroupIds.has(selection.operationGroupId)
  );
  const retainedFinishingSelections = nextGraphBase.finishingSelections.filter(
    selection => !replacedOperationGroupIds.has(selection.operationGroupId)
  );
  const calculatedOperationGroups: CanonicalOperationGroup[] =
    operationResult?.groups.map(group => ({
      ...group,
      productRowId: nextRow.productRowId
    })) ?? [];
  const retainedSourceBatches = calculatedSourceBatch
    ? nextGraphBase.sourceBatches.filter(
        batch => batch.ownerProductRowId !== nextRow.productRowId
      )
    : nextGraphBase.sourceBatches;
  const nextSourceBatches = [
    ...retainedSourceBatches,
    ...(calculatedSourceBatch ? [calculatedSourceBatch] : [])
  ];
  const existingAllocation = nextGraphBase.allocations.find(
    allocation => allocation.targetProductRowId === nextRow.productRowId
  );
  const retainedRemainderIntents = nextGraphBase.allocations
    .filter(allocation =>
      command.type !== 'replace-row' ||
      allocation.targetProductRowId !== nextRow.productRowId
    )
    .map(allocation => allocation.intentSnapshot);
  const childPolicyInput = command.sellerIntent.remainderChildPolicyInput;
  if (existingAllocation && childPolicyInput?.allocationOrder !== undefined &&
      childPolicyInput.allocationOrder !== existingAllocation.allocationOrder) {
    return { ok: false, conflicts: [{ code: 'remainder-allocation-conflict',
      path: ['sellerIntent', 'remainderChildPolicyInput', 'allocationOrder'], productRowId: nextRow.productRowId,
      message: 'An existing allocation must retain its original replay order.' }] };
  }
  const nextAllocationOrder = existingAllocation?.allocationOrder ??
    childPolicyInput?.allocationOrder ??
    (Math.max(
      nextGraphBase.allocations.reduce(
        (maximum, allocation) => Math.max(maximum, allocation.allocationOrder),
        -1
      ),
      nextGraphBase.layerConfigurations.reduce(
        (maximum, configuration) =>
          Math.max(maximum, configuration.creationOrder),
        -1
      )
    ) + 1);
  const nextRemainderIntent: RemainderChildIntent | undefined =
    childPolicyInput
      ? {
          ...childPolicyInput,
          allocationOrder: nextAllocationOrder,
          childProductRowId: nextRow.productRowId,
          catalogProductId: nextRow.catalogProductId
        }
      : undefined;
  const nextRemainderIntents = [
    ...retainedRemainderIntents,
    ...(nextRemainderIntent ? [nextRemainderIntent] : [])
  ];
  const alreadyHasCatalogSnapshot = nextGraphBase.catalogSnapshots.some(snapshot =>
    snapshot.catalogProductId === matchingCatalogSnapshot.catalogProductId &&
    snapshot.snapshotVersion === matchingCatalogSnapshot.snapshotVersion
  );
  const nextOperationGroups = [
    ...retainedOperationGroups,
    ...calculatedOperationGroups
  ];
  const nextToolSelections = [
    ...retainedToolSelections,
    ...(operationResult?.tools ?? [])
  ];
  const nextFinishingSelections = [
    ...retainedFinishingSelections,
    ...(operationResult?.finishings ?? [])
  ];
  const replacedRows = command.type === 'add-row'
    ? [
        ...nextGraphBase.rows,
        {
          ...nextRow,
          commercial: cloneCommercialFacts(nextRow.commercial)
        }
      ]
    : nextGraphBase.rows.map((existingRow, index) => index === existingRowIndex
      ? {
          ...nextRow,
          commercial: cloneCommercialFacts(nextRow.commercial)
        }
      : existingRow);
  const providedLayerInputs = command.sellerIntent.layerConfigurationInputs;
  if (
    providedLayerInputs?.some(
      input => input.parentProductRowId !== nextRow.productRowId
    )
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'orphan-graph-reference',
        path: ['sellerIntent', 'layerConfigurationInputs', 'parentProductRowId'],
        productRowId: nextRow.productRowId,
        message: 'Every submitted layer configuration must belong to the edited stair row.'
      }]
    };
  }
  if (
    providedLayerInputs !== undefined &&
    (nextRow.productType !== 'stair' || !nextRow.stairPart)
  ) {
    return {
      ok: false,
      conflicts: [{
        code: 'product-policy-conflict',
        path: ['sellerIntent', 'layerConfigurationInputs'],
        productRowId: nextRow.productRowId,
        message: 'Structural stair layers may belong only to a canonical stair part.'
      }]
    };
  }
  const retainedLayerInputs = nextGraphBase.layerConfigurations
    .filter(configuration =>
      providedLayerInputs === undefined ||
      configuration.parentProductRowId !== nextRow.productRowId
    )
    .map(configuration => configuration.input);
  const nextLayerInputs = [
    ...retainedLayerInputs,
    ...(providedLayerInputs ?? [])
  ];
  const newLayerMaterialSnapshots: CatalogSnapshot[] = [];
  for (const layerInput of nextLayerInputs) {
    const layerSource = layerInput.source;
    if (layerSource.kind !== 'new-material') continue;
    const snapshots = command.catalogSnapshots.filter(snapshot =>
      snapshot.catalogProductId === layerSource.catalogProductId &&
      snapshot.snapshotVersion === layerSource.catalogSnapshotVersion
    );
    const existing = nextGraphBase.catalogSnapshots.find(snapshot =>
      snapshot.catalogProductId === layerSource.catalogProductId &&
      snapshot.snapshotVersion === layerSource.catalogSnapshotVersion
    );
    const snapshot = snapshots[0] ?? existing;
    if (!snapshot) {
      return {
        ok: false,
        conflicts: [{
          code: 'catalog-snapshot-missing',
          path: [
            'sellerIntent',
            'layerConfigurationInputs',
            layerInput.layerConfigurationId,
            'source'
          ],
          entityId: layerInput.layerConfigurationId,
          productRowId: nextRow.productRowId,
          message: 'New layer material requires its explicit inventory snapshot.'
        }]
      };
    }
    const truths = [existing, ...snapshots]
      .filter((item): item is CatalogSnapshot => item !== undefined)
      .map(stableCanonicalJson);
    if (new Set(truths).size > 1) {
      return {
        ok: false,
        conflicts: [{
          code: 'catalog-snapshot-conflict',
          path: [
            'sellerIntent',
            'layerConfigurationInputs',
            layerInput.layerConfigurationId,
            'source'
          ],
          entityId: layerInput.layerConfigurationId,
          productRowId: nextRow.productRowId,
          message: 'New layer material has contradictory inventory facts.'
        }]
      };
    }
    if (
      snapshot.facts.motherLengthMeters === undefined ||
      snapshot.facts.motherWidthMeters === undefined ||
      layerSource.sourceRows.some(source =>
        source.lengthMeters !== snapshot.facts.motherLengthMeters ||
        source.widthMeters !== snapshot.facts.motherWidthMeters
      )
    ) {
      return {
        ok: false,
        conflicts: [{
          code: 'catalog-snapshot-conflict',
          path: [
            'sellerIntent',
            'layerConfigurationInputs',
            layerInput.layerConfigurationId,
            'source',
            'motherDimensions'
          ],
          entityId: layerInput.layerConfigurationId,
          productRowId: nextRow.productRowId,
          message: 'New layer source dimensions must match its inventory snapshot.'
        }]
      };
    }
    if (!existing) newLayerMaterialSnapshots.push(snapshot);
  }
  const resourceReplay = replayCanonicalResourceConsumers({
    rows: replacedRows,
    previousConfigurations: nextGraphBase.layerConfigurations,
    layerInputs: nextLayerInputs,
    remainderIntents: nextRemainderIntents,
    sourceBatches: nextSourceBatches,
    policy: graph.calculationPolicy,
    baseCommercialRowIds: new Set([nextRow.productRowId])
  });
  if (!resourceReplay.ok) return resourceReplay;
  const previousLayerBatchIds = new Set(
    nextGraphBase.layerConfigurations.map(
      configuration => configuration.sourceBatchId
    )
  );
  const finalSourceBatches = [
    ...nextSourceBatches.filter(
      batch => !previousLayerBatchIds.has(batch.sourceBatchId)
    ),
    ...resourceReplay.configurations.map(configuration => ({
      sourceBatchId: configuration.sourceBatchId,
      ownerProductRowId: configuration.parentProductRowId
    }))
  ];
  const nextGraph: CanonicalProductGraph = {
    ...nextGraphBase,
    revision: graph.revision + 1,
    catalogSnapshots: [
      ...nextGraphBase.catalogSnapshots,
      ...(alreadyHasCatalogSnapshot ? [] : [cloneCatalogSnapshot(matchingCatalogSnapshot)]),
      ...newLayerMaterialSnapshots
        .filter((snapshot, index, items) => (
          alreadyHasCatalogSnapshot ||
          snapshot.catalogProductId !== matchingCatalogSnapshot.catalogProductId ||
          snapshot.snapshotVersion !== matchingCatalogSnapshot.snapshotVersion
        ) && items.findIndex(item =>
          item.catalogProductId === snapshot.catalogProductId &&
          item.snapshotVersion === snapshot.snapshotVersion
        ) === index)
        .map(cloneCatalogSnapshot)
    ],
    rows: reconcileRemainderChildCommercialFacts({
      rows: resourceReplay.rows,
      allocations: resourceReplay.allocations,
      operationGroups: nextOperationGroups,
      toolSelections: nextToolSelections,
      finishingSelections: nextFinishingSelections,
      policy: graph.calculationPolicy
    }),
    layerConfigurations: resourceReplay.configurations,
    sourceBatches: finalSourceBatches,
    remainingStones: resourceReplay.inventory,
    allocations: resourceReplay.allocations,
    operationGroups: nextOperationGroups,
    toolSelections: nextToolSelections,
    finishingSelections: nextFinishingSelections
  };

  const integrityConflicts = findGraphIntegrityConflicts(nextGraph);
  if (integrityConflicts.length > 0) {
    return { ok: false, conflicts: integrityConflicts };
  }

  return {
    ok: true,
    graph: nextGraph,
    appliedCommand: {
      commandId: command.commandId,
      inputRevision: graph.revision,
      outputRevision: nextGraph.revision,
      inputHash: hashCanonicalValue(canonicalCommandValue(graph, command)),
      resultHash: hashCanonicalValue(canonicalGraphValue(nextGraph))
    }
  };
};
