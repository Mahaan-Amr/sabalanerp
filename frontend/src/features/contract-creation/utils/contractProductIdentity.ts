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

export const isRemainingStoneChild = (product: ContractProduct | null | undefined): boolean =>
  !!(product?.parentProductRowId || product?.meta?.remainingSource?.sourceProductRowId || product?.meta?.remainingSource);
