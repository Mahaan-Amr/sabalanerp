import { hashCanonicalValue } from './canonicalHash';
import { findGraphIntegrityConflicts } from './graphIntegrity';
import {
  cloneCanonicalJson,
  stableCanonicalJson,
  type CanonicalJsonObject
} from './canonicalJson';
import type { CanonicalDecimal } from './canonicalDecimal';
import type { StableIdentity } from './stableIdentity';
import {
  parseCanonicalProductGraph,
  parseProductGraphCommand
} from './productGraphSerialization';
import { calculatePricing } from './packingPricing';

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
  readonly commercial: CanonicalCommercialFacts;
  readonly parentProductRowId?: ProductRowId;
  readonly sourceProductRowId?: ProductRowId;
}

export interface CanonicalLayerConfiguration {
  readonly layerConfigurationId: LayerConfigurationId;
  readonly parentProductRowId: ProductRowId;
  readonly sourceBatchId?: SourceBatchId;
}

export interface CanonicalSourceBatch {
  readonly sourceBatchId: SourceBatchId;
  readonly ownerProductRowId?: ProductRowId;
}

export interface CanonicalRemainingStone {
  readonly remainingStoneId: RemainingStoneId;
  readonly sourceBatchId: SourceBatchId;
}

export interface CanonicalAllocation {
  readonly allocationId: AllocationId;
  readonly sourceBatchId: SourceBatchId;
  readonly targetProductRowId: ProductRowId;
  readonly remainingStoneId?: RemainingStoneId;
}

export interface CanonicalOperationGroup {
  readonly operationGroupId: OperationGroupId;
  readonly productRowId: ProductRowId;
}

export interface CanonicalToolSelection {
  readonly toolSelectionId: ToolSelectionId;
  readonly operationGroupId: OperationGroupId;
}

export interface CanonicalFinishingSelection {
  readonly finishingSelectionId: FinishingSelectionId;
  readonly operationGroupId: OperationGroupId;
}

export interface CanonicalProductGraph {
  readonly schemaVersion: typeof CONTRACT_PRODUCT_GRAPH_SCHEMA_VERSION;
  readonly revision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly catalogSnapshots: readonly CatalogSnapshot[];
  readonly rows: readonly CanonicalProductRow[];
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
}

export interface AddRowCommand {
  readonly commandId: AuditMutationId;
  readonly type: 'add-row';
  readonly baseRevision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly sellerIntent: AddRowSellerIntent;
  readonly catalogSnapshots: readonly CatalogSnapshot[];
}

export type ProductGraphCommand = AddRowCommand;

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
  | 'orphan-graph-reference'
  | 'orphan-product-reference'
  | 'policy-version-conflict'
  | 'revision-conflict';

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

const cloneGraph = (graph: CanonicalProductGraph): CanonicalProductGraph => ({
  ...graph,
  calculationPolicy: { ...graph.calculationPolicy },
  catalogSnapshots: graph.catalogSnapshots.map(cloneCatalogSnapshot),
  rows: graph.rows.map(row => ({
    ...row,
    commercial: cloneCommercialFacts(row.commercial)
  })),
  layerConfigurations: graph.layerConfigurations.map(item => ({ ...item })),
  sourceBatches: graph.sourceBatches.map(item => ({ ...item })),
  remainingStones: graph.remainingStones.map(item => ({ ...item })),
  allocations: graph.allocations.map(item => ({ ...item })),
  operationGroups: graph.operationGroups.map(item => ({ ...item })),
  toolSelections: graph.toolSelections.map(item => ({ ...item })),
  finishingSelections: graph.finishingSelections.map(item => ({ ...item }))
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

  const nextRow = command.sellerIntent.row;
  if (graph.rows.some(existingRow => existingRow.productRowId === nextRow.productRowId)) {
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
  const alreadyHasCatalogSnapshot = nextGraphBase.catalogSnapshots.some(snapshot =>
    snapshot.catalogProductId === matchingCatalogSnapshot.catalogProductId &&
    snapshot.snapshotVersion === matchingCatalogSnapshot.snapshotVersion
  );
  const nextGraph: CanonicalProductGraph = {
    ...nextGraphBase,
    revision: graph.revision + 1,
    catalogSnapshots: [
      ...nextGraphBase.catalogSnapshots,
      ...(alreadyHasCatalogSnapshot ? [] : [cloneCatalogSnapshot(matchingCatalogSnapshot)])
    ],
    rows: [
      ...nextGraphBase.rows,
      {
        ...nextRow,
        commercial: calculateAuthoritativeCommercialFacts(
          nextRow.commercial,
          graph.calculationPolicy
        )
      }
    ]
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
