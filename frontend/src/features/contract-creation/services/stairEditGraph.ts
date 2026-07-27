import type { ContractProduct } from '../types/contract.types';

export const isStairLayerProduct = (
  product: ContractProduct | undefined
): boolean => Boolean(product && (product.meta as any)?.isLayer);

export const isStairMainProduct = (
  product: ContractProduct | undefined
): boolean => Boolean(
  product &&
  product.productType === 'stair' &&
  !isStairLayerProduct(product)
);

export const resolveStairParentIndex = (
  products: ContractProduct[],
  product: ContractProduct,
  productIndex: number
): number => {
  if (!isStairLayerProduct(product)) return productIndex;
  if (product.parentProductRowId) {
    return products.findIndex(candidate =>
      isStairMainProduct(candidate) &&
      candidate.rowId === product.parentProductRowId
    );
  }
  return typeof product.parentProductIndex === 'number'
    ? product.parentProductIndex
    : -1;
};

export type AttachedStairLayerResolution =
  | {
      status: 'resolved';
      indices: number[];
      historicalAdaptationRequired?: boolean;
    }
  | {
      status: 'conflict';
      code: 'STAIR_LAYER_PARENT_AMBIGUOUS';
      message: string;
      candidateParentRowIds: string[];
    };

export const resolveAttachedStairLayers = (
  products: ContractProduct[],
  parentIndex: number
): AttachedStairLayerResolution => {
  const parent = products[parentIndex];
  if (!isStairMainProduct(parent)) {
    return { status: 'resolved', indices: [] };
  }

  const allLayerRows = products
    .map((product, index) => ({ product, index }))
    .filter(({ product }) => isStairLayerProduct(product));

  // Stable identity is authoritative even when redundant historical metadata
  // (system/part/index) is stale.
  const stableMatches = allLayerRows.filter(({ product }) =>
    Boolean(
      parent.rowId &&
      product.parentProductRowId === parent.rowId
    )
  );

  const legacyLayerRows = allLayerRows.filter(({ product }) =>
    !product.parentProductRowId &&
    product.stairSystemId === parent.stairSystemId &&
    (product.meta as any)?.layerInfo?.parentPartType === parent.stairPartType
  );

  const legacyIndexMatches = legacyLayerRows.filter(({ product }) =>
    !product.parentProductRowId &&
    product.parentProductIndex === parentIndex
  );

  const unresolvedLegacyLayers = legacyLayerRows.filter(({ product }) =>
    !product.parentProductRowId &&
    typeof product.parentProductIndex !== 'number'
  );

  const candidateParents = products.filter(product =>
    isStairMainProduct(product) &&
    product.stairSystemId === parent.stairSystemId &&
    product.stairPartType === parent.stairPartType
  );

  if (
    unresolvedLegacyLayers.length > 0 &&
    candidateParents.length > 1
  ) {
    return {
      status: 'conflict',
      code: 'STAIR_LAYER_PARENT_AMBIGUOUS',
      message:
        'رابطه لایه با ردیف والد مشخص نیست؛ ابتدا ردیف صحیح را تعیین کنید',
      candidateParentRowIds: candidateParents
        .map(candidate => candidate.rowId)
        .filter((rowId): rowId is string => Boolean(rowId))
    };
  }

  const uniqueParentFallback =
    unresolvedLegacyLayers.length > 0 &&
    candidateParents.length === 1 &&
    candidateParents[0] === parent
      ? unresolvedLegacyLayers
      : [];

  const indices = Array.from(new Set([
    ...stableMatches,
    ...legacyIndexMatches,
    ...uniqueParentFallback
  ].map(({ index }) => index))).sort((left, right) => left - right);

  return {
    status: 'resolved',
    indices,
    ...(
      legacyIndexMatches.length > 0 || uniqueParentFallback.length > 0
        ? { historicalAdaptationRequired: true }
        : {}
    )
  };
};

export const getStairRowWithAttachedLayers = (
  products: ContractProduct[],
  parentIndex: number
): {
  products: ContractProduct[];
  resolution: AttachedStairLayerResolution;
} => {
  const parent = products[parentIndex];
  const resolution = resolveAttachedStairLayers(products, parentIndex);
  if (!parent || resolution.status === 'conflict') {
    return {
      products: parent ? [parent] : [],
      resolution
    };
  }
  return {
    products: [
      parent,
      ...resolution.indices.map(index => products[index]).filter(Boolean)
    ],
    resolution
  };
};
