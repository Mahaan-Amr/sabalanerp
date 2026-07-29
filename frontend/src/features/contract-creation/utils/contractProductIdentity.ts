import type { ContractProduct } from '../types/contract.types';
import {
  parseStableIdentity,
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
  toolIds: Map<string, string>;
  finishingIds: Map<string, string>;
} => {
  if (!input) {
    return {
      input: undefined,
      toolIds: new Map(),
      finishingIds: new Map()
    };
  }

  const groupIds = new Map(
    input.groups.map(group => [
      group.operationGroupId,
      createIndependentIdentity('operation-group', productRowId)
    ])
  );
  const toolIds = new Map(
    input.tools.map(tool => [
      tool.toolSelectionId,
      createIndependentIdentity('tool-selection', productRowId)
    ])
  );
  const finishingIds = new Map(
    input.finishings.map(finishing => [
      finishing.finishingSelectionId,
      createIndependentIdentity('finishing-selection', productRowId)
    ])
  );

  return {
    input: {
      ...input,
      productRowId: parseStableIdentity('product-row', productRowId),
      groups: input.groups.map(group => ({
        ...group,
        operationGroupId: groupIds.get(group.operationGroupId)!
      })),
      tools: input.tools.map(tool => ({
        ...tool,
        toolSelectionId: toolIds.get(tool.toolSelectionId)!,
        operationGroupId: groupIds.get(tool.operationGroupId) ??
          createIndependentIdentity('operation-group', productRowId)
      })),
      finishings: input.finishings.map(finishing => ({
        ...finishing,
        finishingSelectionId: finishingIds.get(finishing.finishingSelectionId)!,
        operationGroupId: groupIds.get(finishing.operationGroupId) ??
          createIndependentIdentity('operation-group', productRowId)
      }))
    },
    toolIds,
    finishingIds
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
  product.appliedSubServices = (product.appliedSubServices || []).map((tool, index) => ({
    ...tool,
    id: operations.toolIds.get(tool.id) ||
      operations.input?.tools[index]?.toolSelectionId ||
      createIndependentIdentity('tool-selection', productRowId)
  }));
  product.finishings = (product.finishings || []).map((finishing, index) => ({
    ...finishing,
    selectionId: operations.finishingIds.get(finishing.selectionId) ||
      operations.input?.finishings[index]?.finishingSelectionId ||
      createIndependentIdentity('finishing-selection', productRowId)
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
}

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
    const nextProduct = rowIdentityChanged || operationOwnerMismatch || hasCollision
      ? rekeyProductDependentIdentities(
          product,
          product.rowId as string,
          product.stairSystemId
        )
      : product;
    dependentIdsFor(nextProduct).forEach(identity => claimedDependentIds.add(identity));
    return nextProduct;
  });

  return {
    products: productsWithIndependentDependencies,
    repairedDuplicateRowIds,
    blockedDuplicateRowIds
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
