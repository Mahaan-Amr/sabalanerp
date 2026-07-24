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
import { calculatePricing } from './packingPricing';
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

export type ProductGraphCommand = AddRowCommand | ReplaceRowCommand;

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
  | 'product-row-missing'
  | 'product-policy-conflict'
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

  const requestedRow = command.sellerIntent.row;
  let nextRow = requestedRow;
  let operationResult: ProductOperationsResult | undefined;
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
  if (!command.sellerIntent.productPolicyInput) {
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
    rows: command.type === 'add-row'
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
        : existingRow),
    operationGroups: [
      ...retainedOperationGroups,
      ...calculatedOperationGroups
    ],
    toolSelections: [
      ...retainedToolSelections,
      ...(operationResult?.tools ?? [])
    ],
    finishingSelections: [
      ...retainedFinishingSelections,
      ...(operationResult?.finishings ?? [])
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
