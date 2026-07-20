import type { ContractProduct } from '../types/contract.types';

let fallbackSequence = 0;

export const createContractProductRowId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `contract-row-${globalThis.crypto.randomUUID()}`;
  }

  fallbackSequence += 1;
  return `contract-row-${Date.now()}-${fallbackSequence}`;
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

  return {
    products: normalizedProducts.map((product) => repairedSet.has(product.rowId as string)
      ? { ...product, rowId: nextUniqueRowId() }
      : product),
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
