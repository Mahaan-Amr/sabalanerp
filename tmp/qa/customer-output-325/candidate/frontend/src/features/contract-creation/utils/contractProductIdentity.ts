import type { ContractProduct } from '../types/contract.types';
import {
  parseStableIdentity,
  repairLegacyProductOperationIdentities,
  type OperationIdentityRepairEvidence,
  type ProductOperationsInput,
  type StableIdentity
} from '@sabalanerp/contract-product-graph';

let fallbackSequence = 0;

export const createContractProductRowId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `contract-row-${globalThis.crypto.randomUUID()}`;
  }

  fallbackSequence += 1;
  return `contract-row-${Date.now()}-${fallbackSequence}`;
};

const createIndependentIdentity = <Kind extends Parameters<typeof parseStableIdentity>[0]>(
  kind: Kind,
  scope: string
): StableIdentity<Kind> => parseStableIdentity(
  kind,
  `${scope}:${createContractProductRowId()}`
);

const rekeyOperations = (
  input: ProductOperationsInput | undefined,
  productRowId: string
): {
  input?: ProductOperationsInput;
  toolIds: string[];
  finishingIds: string[];
  toolIdsByOriginal: Map<string, string[]>;
  finishingIdsByOriginal: Map<string, string[]>;
} => {
  if (!input) {
    return {
      input: undefined,
      toolIds: [],
      finishingIds: [],
      toolIdsByOriginal: new Map(),
      finishingIdsByOriginal: new Map()
    };
  }

  const groups = input.groups.filter((group, index, collection) =>
    collection.findIndex(candidate =>
      candidate.operationGroupId === group.operationGroupId
    ) === index
  );
  const groupIds = new Map(groups.map(group => [
    group.operationGroupId,
    createIndependentIdentity('operation-group', productRowId)
  ]));
  const toolIds = input.tools.map(() =>
    createIndependentIdentity('tool-selection', productRowId)
  );
  const finishingIds = input.finishings.map(() =>
    createIndependentIdentity('finishing-selection', productRowId)
  );
  const groupRekeyedIds = <T>(
    items: readonly T[],
    originalId: (item: T) => string,
    rekeyedIds: readonly string[]
  ) => {
    const grouped = new Map<string, string[]>();
    items.forEach((item, index) => {
      const key = originalId(item);
      grouped.set(key, [...(grouped.get(key) || []), rekeyedIds[index]]);
    });
    return grouped;
  };

  return {
    input: {
      ...input,
      productRowId: parseStableIdentity('product-row', productRowId),
      groups: groups.map(group => ({
        ...group,
        operationGroupId: groupIds.get(group.operationGroupId)!
      })),
      tools: input.tools.map((tool, index) => ({
        ...tool,
        toolSelectionId: toolIds[index],
        operationGroupId: groupIds.get(tool.operationGroupId) ??
          createIndependentIdentity('operation-group', productRowId)
      })),
      finishings: input.finishings.map((finishing, index) => ({
        ...finishing,
        finishingSelectionId: finishingIds[index],
        operationGroupId: groupIds.get(finishing.operationGroupId) ??
          createIndependentIdentity('operation-group', productRowId)
      }))
    },
    toolIds,
    finishingIds,
    toolIdsByOriginal: groupRekeyedIds(
      input.tools,
      tool => tool.toolSelectionId,
      toolIds
    ),
    finishingIdsByOriginal: groupRekeyedIds(
      input.finishings,
      finishing => finishing.finishingSelectionId,
      finishingIds
    )
  };
};

const rekeyProductDependentIdentities = (
  source: ContractProduct,
  productRowId: string,
  stairSystemId?: string
): ContractProduct => {
  const product = structuredClone(source);
  const operations = rekeyOperations(product.operationPolicyInput, productRowId);

  product.operationPolicyInput = operations.input;
  product.longitudinalPolicyInput = product.longitudinalPolicyInput
    ? {
        ...product.longitudinalPolicyInput,
        sourceBatchId: createIndependentIdentity('source-batch', productRowId)
      }
    : undefined;
  product.slabPolicyInput = product.slabPolicyInput
    ? {
        ...product.slabPolicyInput,
        sourceBatchId: createIndependentIdentity('source-batch', productRowId),
        sourceRows: product.slabPolicyInput.sourceRows.map(sourceRow => ({
          ...sourceRow,
          sourceRowId: createIndependentIdentity('slab-source-row', productRowId)
        }))
      }
    : undefined;
  product.stairPartPolicyInput = product.stairPartPolicyInput
    ? {
        ...product.stairPartPolicyInput,
        stairSystemId: parseStableIdentity(
          'stair-system',
          stairSystemId || product.stairPartPolicyInput.stairSystemId
        ),
        sourceBatchId: createIndependentIdentity('source-batch', productRowId)
      }
    : undefined;
  const claimedToolIds = new Map<string, number>();
  const claimedFinishingIds = new Map<string, number>();
  const claimRekeyedId = (
    originalId: string,
    idsByOriginal: Map<string, string[]>,
    claimed: Map<string, number>,
    fallback: string
  ) => {
    const occurrence = claimed.get(originalId) || 0;
    claimed.set(originalId, occurrence + 1);
    return idsByOriginal.get(originalId)?.[occurrence] || fallback;
  };
  product.appliedSubServices = (product.appliedSubServices || []).map((tool, index) => ({
    ...tool,
    id: claimRekeyedId(
      tool.id,
      operations.toolIdsByOriginal,
      claimedToolIds,
      operations.input?.tools[index]?.toolSelectionId ||
        createIndependentIdentity('tool-selection', productRowId)
    )
  }));
  product.finishings = (product.finishings || []).map((finishing, index) => ({
    ...finishing,
    selectionId: claimRekeyedId(
      finishing.selectionId,
      operations.finishingIdsByOriginal,
      claimedFinishingIds,
      operations.input?.finishings[index]?.finishingSelectionId ||
        createIndependentIdentity('finishing-selection', productRowId)
    )
  }));
  return product;
};

/**
 * Copies seller-owned commercial configuration while giving the new contract
 * row a completely independent graph identity. Delivery assignments are
 * intentionally outside this function and therefore remain attached only to
 * the original row until the seller assigns the duplicate explicitly.
 */
export const duplicateContractProductForIndependentEditing = (
  source: ContractProduct,
  sourceIndex: number,
  stairSystemId?: string
): ContractProduct => {
  const rowId = createContractProductRowId();
  const duplicate = rekeyProductDependentIdentities(
    source,
    rowId,
    stairSystemId || `stair-system:${rowId}`
  );
  duplicate.rowId = rowId;
  duplicate.finishingEnabled = !!(
    duplicate.finishingEnabled ||
    duplicate.finishingId ||
    duplicate.finishingCost ||
    duplicate.meta?.finishing?.id ||
    duplicate.meta?.finishing?.cost
  );
  duplicate.calibrationCutEnabled = duplicate.calibrationCutEnabled ??
    (duplicate.productType === 'longitudinal' || duplicate.productType === 'stair');
  if (stairSystemId) {
    duplicate.stairSystemId = stairSystemId;
  } else {
    delete duplicate.stairSystemId;
  }
  delete duplicate.parentProductIndex;
  delete duplicate.parentProductRowId;
  delete duplicate.remainingStoneAllocationOrder;
  duplicate.usedRemainingStones = [];
  duplicate.totalUsedRemainingWidth = 0;
  duplicate.totalUsedRemainingLength = 0;
  duplicate.meta = {
    ...(duplicate.meta || {}),
    duplicatedFromProductIndex: sourceIndex,
    remainingSource: undefined
  };

  return duplicate;
};

export const ensureContractProductRowIds = (products: ContractProduct[]): ContractProduct[] => {
  const rowIds = products.map((product) => product.rowId || createContractProductRowId());
  const rowIndexById = new Map(rowIds.map((rowId, index) => [rowId, index]));

  return products.map((product, index) => {
    const remainingSource = product.meta?.remainingSource;
    const legacyParentIndex = typeof product.parentProductIndex === 'number'
      ? product.parentProductIndex
      : (typeof remainingSource?.sourceProductIndex === 'number' ? remainingSource.sourceProductIndex : undefined);
    const parentProductRowId = product.parentProductRowId ||
      remainingSource?.sourceProductRowId ||
      (legacyParentIndex !== undefined ? rowIds[legacyParentIndex] : undefined);
    const parentProductIndex = parentProductRowId
      ? rowIndexById.get(parentProductRowId)
      : product.parentProductIndex;

    return {
      ...product,
      rowId: rowIds[index],
      parentProductRowId,
      parentProductIndex,
      meta: remainingSource
        ? {
            ...(product.meta || {}),
            remainingSource: {
              ...remainingSource,
              sourceProductRowId: parentProductRowId,
              sourceProductIndex: parentProductIndex
            }
          }
        : product.meta
    };
  });
};

export interface ContractProductRowIdentityNormalization {
  products: ContractProduct[];
  repairedDuplicateRowIds: string[];
  blockedDuplicateRowIds: string[];
  repairedOperationRowIds: string[];
  blockedOperationRowIds: string[];
  operationRepairEvidence: OperationIdentityRepairEvidence[];
}

const analyzeOperationIdentities = (
  product: ContractProduct
): { repairable: boolean; blocked: boolean } => {
  const input = product.operationPolicyInput;
  if (!input) return { repairable: false, blocked: false };

  const groupsById = new Map<string, typeof input.groups>();
  input.groups.forEach(group => {
    groupsById.set(
      group.operationGroupId,
      [...(groupsById.get(group.operationGroupId) || []), group]
    );
  });
  const duplicateGroups = Array.from(groupsById.values())
    .filter(groups => groups.length > 1);
  const contradictoryGroup = duplicateGroups.some(groups =>
    groups.some(group => group.scope !== groups[0].scope)
  );
  const knownGroupIds = new Set(input.groups.map(group => group.operationGroupId));
  const orphanSelection = [
    ...input.tools.map(tool => tool.operationGroupId),
    ...input.finishings.map(finishing => finishing.operationGroupId)
  ].some(groupId => !knownGroupIds.has(groupId));
  if (contradictoryGroup || orphanSelection) {
    return { repairable: false, blocked: true };
  }

  const hasDuplicate = (identities: string[]) =>
    new Set(identities).size !== identities.length;
  return {
    repairable:
      duplicateGroups.length > 0 ||
      hasDuplicate(input.tools.map(tool => tool.toolSelectionId)) ||
      hasDuplicate(input.finishings.map(finishing => finishing.finishingSelectionId)),
    blocked: false
  };
};

const getReferencedParentRowIds = (products: ContractProduct[]): Set<string> => {
  const referencedRowIds = new Set<string>();

  products.forEach((product) => {
    const meta = product.meta as any;
    const candidates = [
      product.parentProductRowId,
      meta?.remainingSource?.sourceProductRowId,
      meta?.layerInfo?.parentProductRowId
    ];
    candidates.forEach((rowId) => {
      if (typeof rowId === 'string' && rowId) referencedRowIds.add(rowId);
    });
  });

  return referencedRowIds;
};

export const normalizeContractProductRowIdentities = (
  products: ContractProduct[]
): ContractProductRowIdentityNormalization => {
  const normalizedProducts = ensureContractProductRowIds(products);
  const rowIdCounts = new Map<string, number>();
  normalizedProducts.forEach((product) => {
    if (!product.rowId) return;
    rowIdCounts.set(product.rowId, (rowIdCounts.get(product.rowId) || 0) + 1);
  });

  const duplicateRowIds = Array.from(rowIdCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([rowId]) => rowId);
  const referencedParentRowIds = getReferencedParentRowIds(normalizedProducts);
  const blockedDuplicateRowIds = duplicateRowIds.filter((rowId) => referencedParentRowIds.has(rowId));
  const repairedDuplicateRowIds = duplicateRowIds.filter((rowId) => !referencedParentRowIds.has(rowId));
  const repairedSet = new Set(repairedDuplicateRowIds);
  const reservedRowIds = new Set(normalizedProducts.map((product) => product.rowId).filter((rowId): rowId is string => !!rowId));
  const nextUniqueRowId = (): string => {
    let rowId = createContractProductRowId();
    while (reservedRowIds.has(rowId)) rowId = createContractProductRowId();
    reservedRowIds.add(rowId);
    return rowId;
  };

  const rekeyedProducts = normalizedProducts.map((product) => repairedSet.has(product.rowId as string)
    ? { ...product, rowId: nextUniqueRowId() }
    : product);
  const operationIdentityAnalysis = rekeyedProducts.map(analyzeOperationIdentities);
  const blockedOperationRowIds = rekeyedProducts
    .filter((_, index) => operationIdentityAnalysis[index].blocked)
    .map(product => product.rowId as string);
  const repairedOperationRowIds = rekeyedProducts
    .filter((_, index) => operationIdentityAnalysis[index].repairable)
    .map(product => product.rowId as string);
  const repairedOperationSet = new Set(repairedOperationRowIds);
  const claimedDependentIds = new Set<string>();
  const dependentIdsFor = (product: ContractProduct): string[] => {
    const identities: Array<string | undefined> = [
      product.longitudinalPolicyInput?.sourceBatchId,
      product.slabPolicyInput?.sourceBatchId,
      product.stairPartPolicyInput?.sourceBatchId,
      ...(product.slabPolicyInput?.sourceRows.map(row => row.sourceRowId) || []),
      ...(product.operationPolicyInput?.groups.map(group => group.operationGroupId) || []),
      ...(product.operationPolicyInput?.tools.map(tool => tool.toolSelectionId) || []),
      ...(product.operationPolicyInput?.finishings.map(finishing => finishing.finishingSelectionId) || [])
    ];
    return identities.filter((identity): identity is string => typeof identity === 'string');
  };
  const productsWithIndependentDependencies = rekeyedProducts.map((product, index) => {
    const dependentIds = dependentIdsFor(product);
    const rowIdentityChanged = product.rowId !== normalizedProducts[index]?.rowId;
    const operationOwnerMismatch = Boolean(
      product.operationPolicyInput &&
      product.operationPolicyInput.productRowId !== product.rowId
    );
    const hasCollision = dependentIds.some(identity => claimedDependentIds.has(identity));
    const nextProduct =
      !operationIdentityAnalysis[index].blocked &&
      (rowIdentityChanged ||
        operationOwnerMismatch ||
        hasCollision ||
        repairedOperationSet.has(product.rowId as string))
      ? rekeyProductDependentIdentities(
          product,
          product.rowId as string,
          product.stairSystemId
        )
      : product;
    dependentIdsFor(nextProduct).forEach(identity => claimedDependentIds.add(identity));
    return nextProduct;
  });
  const sharedOperationRepair = repairLegacyProductOperationIdentities(
    productsWithIndependentDependencies
  );
  const combinedRepairedOperationRowIds = Array.from(new Set([
    ...repairedOperationRowIds,
    ...sharedOperationRepair.repairedProductRowIds
  ]));
  const combinedBlockedOperationRowIds = Array.from(new Set([
    ...blockedOperationRowIds,
    ...sharedOperationRepair.blockedProductRowIds
  ]));

  return {
    products: sharedOperationRepair.products,
    repairedDuplicateRowIds,
    blockedDuplicateRowIds,
    repairedOperationRowIds: combinedRepairedOperationRowIds,
    blockedOperationRowIds: combinedBlockedOperationRowIds,
    operationRepairEvidence: sharedOperationRepair.evidence
  };
};

export const prepareStairEditReplacementRowIdentities = (
  sessionItems: ContractProduct[],
  oldProduct: ContractProduct,
  editingProductIndex: number
): ContractProduct[] => sessionItems.map((item) => {
  const isLayer = Boolean((item.meta as any)?.isLayer);
  const parentProductRowId = isLayer
    ? (item.parentProductRowId || oldProduct.rowId)
    : item.parentProductRowId;
  const replacement = {
    ...item,
    rowId: item.rowId || createContractProductRowId(),
    stairSystemId: oldProduct.stairSystemId,
    parentProductIndex: isLayer ? editingProductIndex : item.parentProductIndex,
    parentProductRowId
  };

  if (!isLayer) return replacement;
  return {
    ...replacement,
    meta: {
      ...replacement.meta,
      layerInfo: {
        ...(replacement.meta as any)?.layerInfo,
        parentProductRowId
      }
    }
  };
});

export const resolveEditedContractProductRowId = (
  products: ContractProduct[],
  editingProductIndex: number
): string => products[editingProductIndex]?.rowId || createContractProductRowId();

export const isRemainingStoneChild = (product: ContractProduct | null | undefined): boolean =>
  !!(product?.parentProductRowId || product?.meta?.remainingSource?.sourceProductRowId || product?.meta?.remainingSource);
