import {
  normalizeLegacyJson,
  type CanonicalJsonObject
} from './canonicalJson';
import Decimal from 'decimal.js';
import { recoverLegacyRemainingChildren } from './legacyRemainingRecovery';
import type {
  CalculationPolicySnapshot,
  CanonicalProductGraph,
  CanonicalLayerConfiguration,
  CanonicalProductRow,
  CanonicalProductType,
  CanonicalSourceBatch,
  CatalogSnapshot,
  StairSystemId
} from './productGraph';
import type {
  CalculatedFinishingSelection,
  CalculatedOperationGroup,
  CalculatedToolSelection
} from './operationsPolicy';
import {
  calculateProductOperations,
  parseProductOperationsInput
} from './operationsPolicy';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import { parseCanonicalDecimal } from './canonicalDecimal';
import { parseCanonicalProductGraph } from './productGraphSerialization';
import { findGraphIntegrityConflicts } from './graphIntegrity';
import {
  calculateLongitudinalProduct,
  parseLongitudinalProductInput
} from './longitudinalPolicy';
import { calculateSlab, parseSlabPolicyInput } from './slabPolicy';
import { materializePaidRemainderStocks } from './remainderPolicy';
import {
  calculateStairPart,
  parseStairPartPolicyInput,
  type CanonicalStairSystem
} from './stairPolicy';
import {
  parseStairLayerConfigurationInput,
  replayStairLayerConfigurations,
  type StairLayerConfigurationInput,
  type StairLayerParentGeometry
} from './stairLayerPolicy';

export interface LegacyProductGraphInput {
  readonly recoverRemainingChildrenOnWrite?: boolean;
  readonly contractId: string;
  readonly revision: number;
  readonly calculationPolicy: CalculationPolicySnapshot;
  readonly products: readonly Readonly<Record<string, unknown>>[];
}

export interface LegacyProductGraphConflict {
  readonly code:
    | 'legacy-remaining-recovery-required'
    | 'legacy-catalog-product-id-missing'
    | 'legacy-canonical-input-invalid'
    | 'legacy-layer-operation-ambiguous'
    | 'legacy-product-reference-invalid'
    | 'legacy-product-reference-missing'
    | 'legacy-product-row-id-conflict'
    | 'legacy-product-row-id-duplicate'
    | 'legacy-product-type-invalid';
  readonly path: readonly string[];
  readonly message: string;
  readonly productRowId?: string;
  readonly causeCode?: string;
}

export type LegacyProductGraphRead =
  | {
      readonly ok: true;
      readonly source: 'legacy-read';
      readonly migrationRequired: true;
      readonly graph: CanonicalProductGraph;
      readonly conflicts: readonly [];
    }
  | {
      readonly ok: false;
      readonly source: 'legacy-read';
      readonly contractId: string;
      readonly revision: number;
      readonly migrationRequired: true;
      readonly legacyView: readonly Readonly<Record<string, unknown>>[];
      readonly conflicts: readonly LegacyProductGraphConflict[];
    };

const PRODUCT_TYPES = new Set<CanonicalProductType>([
  'longitudinal',
  'stair',
  'slab',
  'prepared',
  'volumetric'
]);

const cloneLegacyValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map(item => cloneLegacyValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneLegacyValue(item)])
    ) as T;
  }
  return value;
};

const resolveLegacyProductRowId = (
  product: Readonly<Record<string, unknown>>,
  index: number,
  contractId: string
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  const canonical = typeof product.productRowId === 'string' ? product.productRowId.trim() : '';
  const compatibility = typeof product.rowId === 'string' ? product.rowId.trim() : '';

  if (canonical && compatibility && canonical !== compatibility) {
    return {
      conflict: {
        code: 'legacy-product-row-id-conflict',
        path: ['products', String(index), 'productRowId'],
        message: 'Legacy contract product has contradictory stable row identities.'
      }
    };
  }
  const value = canonical || compatibility;
  if (!value) {
    // The row itself and its order in the immutable legacy snapshot are known
    // facts, so assigning an identity here does not guess a parent/source
    // relationship. The same contract snapshot always receives the same ID.
    return { value: `legacy-row:${contractId}:${index}` };
  }
  return { value };
};

const resolveLegacyProductType = (
  product: Readonly<Record<string, unknown>>,
  index: number
): { value?: CanonicalProductType; conflict?: LegacyProductGraphConflict } => {
  const value = product.productType;
  if (typeof value !== 'string' || !PRODUCT_TYPES.has(value as CanonicalProductType)) {
    return {
      conflict: {
        code: 'legacy-product-type-invalid',
        path: ['products', String(index), 'productType'],
        message: 'Legacy contract product has no recognized product type.'
      }
    };
  }
  return { value: value as CanonicalProductType };
};

const resolveLegacyCatalogProductId = (
  product: Readonly<Record<string, unknown>>,
  index: number
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  const value = typeof product.productId === 'string' ? product.productId.trim() : '';
  if (!value) {
    return {
      conflict: {
        code: 'legacy-catalog-product-id-missing',
        path: ['products', String(index), 'productId'],
        message: 'Legacy contract product has no unambiguous catalog product identity.'
      }
    };
  }
  return { value };
};

const resolveLegacyProductReference = (
  product: Readonly<Record<string, unknown>>,
  key: 'parentProductRowId' | 'sourceProductRowId',
  index: number
): { value?: string; conflict?: LegacyProductGraphConflict } => {
  if (product[key] === undefined || product[key] === null) return {};
  const value = typeof product[key] === 'string' ? product[key].trim() : '';
  if (!value) {
    return {
      conflict: {
        code: 'legacy-product-reference-invalid',
        path: ['products', String(index), key],
        message: `Legacy contract product has an invalid explicit ${key}.`
      }
    };
  }
  return { value };
};

export const readLegacyProductGraph = ({
  contractId,
  revision,
  calculationPolicy,
  recoverRemainingChildrenOnWrite,
  products
}: LegacyProductGraphInput): LegacyProductGraphRead => {
  const legacyView = products.map(product => cloneLegacyValue(product));
  const conflicts: LegacyProductGraphConflict[] = [];
  const rows: CanonicalProductRow[] = [];
  const rowLegacyIndexes: number[] = [];
  const catalogSnapshots: CatalogSnapshot[] = [];
  const operationGroups: Array<CalculatedOperationGroup & {
    productRowId: StableIdentity<'product-row'>;
  }> = [];
  const toolSelections: CalculatedToolSelection[] = [];
  const finishingSelections: CalculatedFinishingSelection[] = [];
  const sourceBatches: CanonicalSourceBatch[] = [];
  const stairSystemsById = new Map<StairSystemId, CanonicalStairSystem>();
  const layerInputs: Array<{
    readonly input: StairLayerConfigurationInput;
    readonly legacyIndex: number;
    readonly legacySnapshot: CanonicalJsonObject;
  }> = [];

  legacyView.forEach((product, index) => {
    const identity = resolveLegacyProductRowId(product, index, contractId);
    const productType = resolveLegacyProductType(product, index);
    const catalogIdentity = resolveLegacyCatalogProductId(product, index);
    const parentReference = resolveLegacyProductReference(product, 'parentProductRowId', index);
    const sourceReference = resolveLegacyProductReference(product, 'sourceProductRowId', index);
    if (identity.conflict) conflicts.push(identity.conflict);
    if (productType.conflict) conflicts.push(productType.conflict);
    if (catalogIdentity.conflict) conflicts.push(catalogIdentity.conflict);
    if (parentReference.conflict) conflicts.push(parentReference.conflict);
    if (sourceReference.conflict) conflicts.push(sourceReference.conflict);
    if (!identity.value || !productType.value || !catalogIdentity.value) return;

    const productRowId = parseStableIdentity('product-row', identity.value);
    const catalogProductId = catalogIdentity.value;
    const catalogSnapshotVersion = `legacy:${contractId}:${revision}:${productRowId}`;
    const legacySnapshot = normalizeLegacyJson(product) as CanonicalJsonObject;
    const contractualTitleCandidates = [
      product.contractualTitle,
      product.name,
      product.stoneName
    ];
    const contractualTitle = contractualTitleCandidates.find(
      candidate => typeof candidate === 'string'
    ) as string | undefined;

    rows.push({
      productRowId,
      catalogProductId,
      catalogSnapshotVersion,
      productType: productType.value,
      contractualTitle: contractualTitle || '',
      commercial: {
        ...(product.totalPrice !== undefined && product.totalPrice !== null
          ? { totalAmountToman: parseCanonicalDecimal(String(product.totalPrice)) }
          : {}),
        legacySnapshot
      },
      ...(parentReference.value
        ? { parentProductRowId: parseStableIdentity('product-row', parentReference.value) }
        : {}),
      ...(sourceReference.value
        ? { sourceProductRowId: parseStableIdentity('product-row', sourceReference.value) }
        : {})
    });
    rowLegacyIndexes.push(index);
    catalogSnapshots.push({
      catalogProductId,
      snapshotVersion: catalogSnapshotVersion,
      facts: {
        legacySnapshot
      }
    });
    if (product.longitudinalPolicyInput !== undefined) {
      try {
        const policyInput = parseLongitudinalProductInput(
          product.longitudinalPolicyInput
        );
        const calculation = calculateLongitudinalProduct(policyInput);
        if (!calculation.ok) {
          conflicts.push({
            code: 'legacy-canonical-input-invalid',
            path: ['products', String(index), 'longitudinalPolicyInput'],
            message: calculation.conflicts
              .map(conflict => conflict.message)
              .join(' | ')
          });
        } else {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            commercial: {
              requestedLengthMeters: calculation.result.lengthMeters,
              requestedWidthMeters: calculation.result.widthMeters,
              requestedAreaSquareMeters:
                calculation.result.requestedAreaSquareMeters,
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
              calculationSnapshot: normalizeLegacyJson(
                calculation.result
              ) as CanonicalJsonObject,
              legacySnapshot
            }
          };
          sourceBatches.push({
            sourceBatchId: policyInput.sourceBatchId,
            ownerProductRowId: productRowId,
            initialRemainders: materializePaidRemainderStocks({
              ownerProductRowId: productRowId,
              catalogProductId,
              sourceBatchId: policyInput.sourceBatchId,
              remainders: calculation.result.packingPlan.remainders,
              startingCreationOrder: index * 1000
            })
          });
        }
      } catch (error) {
        conflicts.push({
          code: 'legacy-canonical-input-invalid',
          path: ['products', String(index), 'longitudinalPolicyInput'],
          message: error instanceof Error
            ? error.message
            : 'Longitudinal product policy is invalid.'
        });
      }
    }
    if (product.slabPolicyInput !== undefined) {
      try {
        const policyInput = parseSlabPolicyInput(product.slabPolicyInput);
        const calculation = calculateSlab(policyInput);
        if (!calculation.ok) {
          conflicts.push({
            code: 'legacy-canonical-input-invalid',
            path: ['products', String(index), 'slabPolicyInput'],
            message: calculation.conflicts
              .map(conflict => conflict.message)
              .join(' | ')
          });
        } else {
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            slab: {
              lengthDisplayUnit: calculation.result.lengthDisplayUnit,
              widthDisplayUnit: calculation.result.widthDisplayUnit,
              cuttingPricingMethod: calculation.result.cuttingPricingMethod,
              sourceRows: calculation.result.sourceRows.map(row => ({ ...row }))
            },
            commercial: {
              requestedLengthMeters: calculation.result.lengthMeters,
              requestedWidthMeters: calculation.result.widthMeters,
              requestedAreaSquareMeters:
                calculation.result.finishedAreaSquareMeters,
              requestedQuantity: parseCanonicalDecimal(
                String(calculation.result.quantity)
              ),
              baseRateToman: policyInput.baseMaterialRateToman,
              baseAmountToman: calculation.result.materialAmountToman,
              totalAmountToman: calculation.result.totalAmountToman,
              calculationSnapshot: normalizeLegacyJson(
                calculation.result
              ) as CanonicalJsonObject,
              legacySnapshot
            }
          };
          sourceBatches.push({
            sourceBatchId: policyInput.sourceBatchId,
            ownerProductRowId: productRowId,
            initialRemainders: materializePaidRemainderStocks({
              ownerProductRowId: productRowId,
              catalogProductId,
              sourceBatchId: policyInput.sourceBatchId,
              remainders: calculation.result.packingPlan.remainders,
              startingCreationOrder: index * 1000
            })
          });
        }
      } catch (error) {
        conflicts.push({
          code: 'legacy-canonical-input-invalid',
          path: ['products', String(index), 'slabPolicyInput'],
          message: error instanceof Error
            ? error.message
            : 'Slab product policy is invalid.'
        });
      }
    }
    if (product.stairPartPolicyInput !== undefined) {
      try {
        const policyInput = parseStairPartPolicyInput(
          product.stairPartPolicyInput
        );
        const calculation = calculateStairPart(policyInput);
        if (!calculation.ok) {
          conflicts.push({
            code: 'legacy-canonical-input-invalid',
            path: ['products', String(index), 'stairPartPolicyInput'],
            message: calculation.conflicts
              .map(conflict => conflict.message)
              .join(' | ')
          });
        } else {
          const stairCatalogSnapshotVersion =
            `legacy:${contractId}:${revision}:stair:${policyInput.stairSystemId}`;
          rows[rows.length - 1] = {
            ...rows[rows.length - 1],
            catalogSnapshotVersion: stairCatalogSnapshotVersion,
            stairPart: calculation.result.stairPart,
            commercial: {
              requestedLengthMeters: calculation.result.lengthMeters,
              requestedWidthMeters: calculation.result.crossDimensionMeters,
              requestedAreaSquareMeters:
                calculation.result.requestedAreaSquareMeters,
              requestedQuantity: parseCanonicalDecimal(
                String(calculation.result.quantity)
              ),
              baseRateToman: policyInput.baseRateToman,
              baseAmountToman: calculation.result.baseAmountToman,
              totalAmountToman: calculation.result.totalAmountToman,
              calculationSnapshot: normalizeLegacyJson(
                calculation.result
              ) as CanonicalJsonObject,
              legacySnapshot
            }
          };
          const currentCatalogSnapshotIndex = catalogSnapshots.length - 1;
          const sharedStairSnapshotExists = catalogSnapshots.some(
            (snapshot, snapshotIndex) =>
              snapshotIndex !== currentCatalogSnapshotIndex &&
              snapshot.catalogProductId === catalogProductId &&
              snapshot.snapshotVersion === stairCatalogSnapshotVersion
          );
          if (sharedStairSnapshotExists) {
            catalogSnapshots.splice(currentCatalogSnapshotIndex, 1);
          } else {
            catalogSnapshots[currentCatalogSnapshotIndex] = {
              catalogProductId,
              snapshotVersion: stairCatalogSnapshotVersion,
              facts: {}
            };
          }
          sourceBatches.push({
            sourceBatchId: policyInput.sourceBatchId,
            ownerProductRowId: productRowId,
            initialRemainders: materializePaidRemainderStocks({
              ownerProductRowId: productRowId,
              catalogProductId,
              sourceBatchId: policyInput.sourceBatchId,
              remainders: calculation.result.packingPlan.remainders,
              startingCreationOrder: index * 1000
            })
          });
          const existingSystem = stairSystemsById.get(
            policyInput.stairSystemId
          );
          stairSystemsById.set(policyInput.stairSystemId, {
            stairSystemId: policyInput.stairSystemId,
            quantityMode: existingSystem?.quantityMode ?? 'steps',
            totalSteps: Math.max(
              existingSystem?.totalSteps ?? 0,
              calculation.result.quantity
            )
          });
        }
      } catch (error) {
        conflicts.push({
          code: 'legacy-canonical-input-invalid',
          path: ['products', String(index), 'stairPartPolicyInput'],
          message: error instanceof Error
            ? error.message
            : 'Stair part policy is invalid.'
        });
      }
    }
    const layerSourcePlan = (
      product.meta !== null &&
      typeof product.meta === 'object' &&
      !Array.isArray(product.meta)
    )
      ? (product.meta as Readonly<Record<string, unknown>>).layerSourcePlan
      : undefined;
    const canonicalLayerInput = (
      layerSourcePlan !== null &&
      typeof layerSourcePlan === 'object' &&
      !Array.isArray(layerSourcePlan)
    )
      ? (layerSourcePlan as Readonly<Record<string, unknown>>).canonicalInput
      : undefined;
    if (canonicalLayerInput !== undefined) {
      try {
        layerInputs.push({
          input: parseStairLayerConfigurationInput(canonicalLayerInput),
          legacyIndex: index,
          legacySnapshot
        });
      } catch (error) {
        conflicts.push({
          code: 'legacy-canonical-input-invalid',
          path: [
            'products',
            String(index),
            'meta',
            'layerSourcePlan',
            'canonicalInput'
          ],
          message: error instanceof Error
            ? error.message
            : 'Stair layer policy is invalid.'
        });
      }
    }
    const legacyMeta = (
      product.meta !== null &&
      typeof product.meta === 'object' &&
      !Array.isArray(product.meta)
    )
      ? product.meta as Readonly<Record<string, unknown>>
      : undefined;
    const isLegacyLayer = legacyMeta?.isLayer === true;
    const isRemainingStoneChild = parentReference.value !== undefined && !isLegacyLayer;
    const legacyOperationRecord = (
      product.operationPolicyInput !== null &&
      typeof product.operationPolicyInput === 'object' &&
      !Array.isArray(product.operationPolicyInput)
    )
      ? product.operationPolicyInput as Readonly<Record<string, unknown>>
      : undefined;
    const hasLegacyLayerOperations =
      (
        Array.isArray(legacyOperationRecord?.tools) &&
        legacyOperationRecord.tools.length > 0
      ) ||
      (
        Array.isArray(legacyOperationRecord?.finishings) &&
        legacyOperationRecord.finishings.length > 0
      );
    if (
      product.operationPolicyInput !== undefined &&
      isLegacyLayer &&
      canonicalLayerInput === undefined &&
      hasLegacyLayerOperations
    ) {
      conflicts.push({
        code: 'legacy-layer-operation-ambiguous',
        path: ['products', String(index), 'operationPolicyInput'],
        message:
          'Historical layer operations have no certain side ownership or canonical parent relation.'
      });
    } else if (product.operationPolicyInput !== undefined) {
      try {
        const operationInput = parseProductOperationsInput(product.operationPolicyInput);
        const operationResult = calculateProductOperations(operationInput);
        if (!operationResult.ok) {
          conflicts.push({
            code: 'legacy-canonical-input-invalid',
            path: ['products', String(index), 'operationPolicyInput'],
            message: operationResult.conflicts.map(conflict => conflict.message).join(' | ')
          });
        } else {
          operationGroups.push(...operationResult.result.groups.map(group => ({
            ...group,
            productRowId
          })));
          toolSelections.push(...operationResult.result.tools);
          finishingSelections.push(...operationResult.result.finishings);
          const canonicalRowIndex = rows.findIndex(
            row => row.productRowId === productRowId
          );
          if (canonicalRowIndex >= 0) {
            const canonicalRow = rows[canonicalRowIndex];
            const hasCanonicalProductCalculation =
              canonicalRow.commercial.calculationSnapshot !== undefined;
            const amountBeforeOperations =
              isRemainingStoneChild && !hasCanonicalProductCalculation
              ? new Decimal(String(product.cuttingCost ?? '0'))
              : new Decimal(canonicalRow.commercial.totalAmountToman ?? '0');
            rows[canonicalRowIndex] = {
              ...canonicalRow,
              commercial: {
                ...canonicalRow.commercial,
                totalAmountToman: parseCanonicalDecimal(
                  amountBeforeOperations
                    .plus(operationResult.result.totalAmountToman ?? '0')
                    .toFixed()
                )
              }
            };
          }
        }
      } catch (error) {
        conflicts.push({
          code: 'legacy-canonical-input-invalid',
          path: ['products', String(index), 'operationPolicyInput'],
          message: error instanceof Error ? error.message : 'Product operations are invalid.'
        });
      }
    }
  });

  const rowIndexesById = new Map<string, number[]>();
  rows.forEach((row, index) => {
    const indexes = rowIndexesById.get(row.productRowId) ?? [];
    indexes.push(rowLegacyIndexes[index]);
    rowIndexesById.set(row.productRowId, indexes);
  });
  rowIndexesById.forEach((indexes, productRowId) => {
    if (indexes.length > 1) {
      conflicts.push({
        code: 'legacy-product-row-id-duplicate',
        path: ['products', String(indexes[1]), 'productRowId'],
        message: `Legacy contract contains duplicate product row identity ${productRowId}.`
      });
    }
  });

  const rowIds = new Set(rows.map(row => row.productRowId));
  rows.forEach((row, index) => {
    const references = [
      ['parentProductRowId', row.parentProductRowId],
      ['sourceProductRowId', row.sourceProductRowId]
    ] as const;
    references.forEach(([key, reference]) => {
      if (reference && !rowIds.has(reference)) {
        conflicts.push({
          code: 'legacy-product-reference-missing',
          path: ['products', String(rowLegacyIndexes[index]), key],
          message: `Legacy contract product references missing row ${reference}.`
        });
      }
    });
  });

  if (conflicts.length > 0) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts
    };
  }

  const layerSourceBatchIds = new Set(
    sourceBatches.map(batch => batch.sourceBatchId)
  );
  layerInputs.forEach(({ input }) => {
    if (!layerSourceBatchIds.has(input.sourceBatchId)) {
      sourceBatches.push({
        sourceBatchId: input.sourceBatchId,
        ownerProductRowId: input.parentProductRowId,
        initialRemainders: []
      });
      layerSourceBatchIds.add(input.sourceBatchId);
    }
    const layerSource = input.source;
    if (
      layerSource.kind === 'new-material' &&
      !catalogSnapshots.some(snapshot =>
        snapshot.catalogProductId === layerSource.catalogProductId &&
        snapshot.snapshotVersion === layerSource.catalogSnapshotVersion
      )
    ) {
      const legacyLayer = layerInputs.find(
        candidate =>
          candidate.input.layerConfigurationId === input.layerConfigurationId
      );
      catalogSnapshots.push({
        catalogProductId: layerSource.catalogProductId,
        snapshotVersion: layerSource.catalogSnapshotVersion,
        facts: legacyLayer
          ? { legacySnapshot: legacyLayer.legacySnapshot }
          : {}
      });
    }
  });

  const layerParents = new Map<
    StableIdentity<'product-row'>,
    StairLayerParentGeometry
  >();
  rows.forEach(row => {
    const quantity = Number(row.commercial.requestedQuantity);
    if (
      row.productType === 'stair' &&
      row.stairPart &&
      row.commercial.requestedLengthMeters !== undefined &&
      row.commercial.requestedWidthMeters !== undefined &&
      Number.isSafeInteger(quantity) &&
      quantity > 0
    ) {
      layerParents.set(row.productRowId, {
        lengthMeters: row.commercial.requestedLengthMeters,
        crossDimensionMeters: row.commercial.requestedWidthMeters,
        quantity
      });
    }
  });
  const layerReplay = replayStairLayerConfigurations({
    inputs: layerInputs.map(entry => entry.input),
    parents: layerParents,
    baseInventory: sourceBatches.flatMap(
      batch => batch.initialRemainders?.map(stock => ({ ...stock })) ?? []
    )
  });
  if (!layerReplay.ok) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts: layerReplay.conflicts.map(conflict => ({
        code: 'legacy-canonical-input-invalid',
        path: ['layerConfigurations', conflict.entityId ?? conflict.field],
        message: conflict.message
      }))
    };
  }
  const layerConfigurations: CanonicalLayerConfiguration[] =
    layerReplay.result.configurations.map(({ input, result }) => ({
      layerConfigurationId: input.layerConfigurationId,
      parentProductRowId: input.parentProductRowId,
      sourceBatchId: input.sourceBatchId,
      creationOrder: input.creationOrder,
      input,
      result
    }));
  layerConfigurations.forEach(configuration => {
    const layerLegacyEntry = layerInputs.find(
      entry =>
        entry.input.layerConfigurationId ===
        configuration.layerConfigurationId
    );
    if (!layerLegacyEntry) return;
    const rowIndex = rowLegacyIndexes.findIndex(
      legacyIndex => legacyIndex === layerLegacyEntry.legacyIndex
    );
    if (rowIndex < 0) return;
    rows[rowIndex] = {
      ...rows[rowIndex],
      commercial: {
        ...rows[rowIndex].commercial,
        totalAmountToman: configuration.result.totalAmountToman,
        calculationSnapshot: normalizeLegacyJson(
          configuration.result
        ) as CanonicalJsonObject
      }
    };
  });

  let graph: CanonicalProductGraph = {
    schemaVersion: 1 as const,
    revision,
    calculationPolicy: { ...calculationPolicy },
    catalogSnapshots,
    rows,
    stairSystems: [...stairSystemsById.values()],
    layerConfigurations,
    sourceBatches,
    remainingStones: layerReplay.result.inventory,
    allocations: [],
    operationGroups,
    toolSelections,
    finishingSelections
  };
  if (recoverRemainingChildrenOnWrite) {
    const recovery = recoverLegacyRemainingChildren(graph, products);
    if (!recovery.ok) return { ok: false, source: 'legacy-read', contractId, revision,
      migrationRequired: true, legacyView, conflicts: recovery.conflicts };
    graph = recovery.graph;
  }
  const integrityConflicts = findGraphIntegrityConflicts(
    graph as CanonicalProductGraph
  );
  if (integrityConflicts.length > 0) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts: integrityConflicts.map(conflict => ({
        code: 'legacy-canonical-input-invalid',
        causeCode: conflict.code,
        path: conflict.path,
        message: conflict.message,
        ...(conflict.productRowId
          ? { productRowId: conflict.productRowId }
          : {})
      }))
    };
  }
  let canonicalGraph: CanonicalProductGraph;
  try {
    canonicalGraph = parseCanonicalProductGraph(graph);
  } catch (error) {
    return {
      ok: false,
      source: 'legacy-read',
      contractId,
      revision,
      migrationRequired: true,
      legacyView,
      conflicts: [{
        code: 'legacy-canonical-input-invalid',
        path: ['graph'],
        message: error instanceof Error ? error.message : 'Legacy graph metadata is invalid.'
      }]
    };
  }

  return {
    ok: true,
    source: 'legacy-read',
    migrationRequired: true,
    graph: canonicalGraph,
    conflicts: []
  };
};
