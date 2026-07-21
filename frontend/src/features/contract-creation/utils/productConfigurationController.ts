import type {
  ContractProduct,
  ContractUsageType,
  Product,
  RemainingStone,
  SmartLongitudinalCutPlan
} from '../types/contract.types';
import { recalculateUsedRemainingDimensions } from './dimensionUtils';
import {
  mergeRemainingStoneCollection,
  normalizeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from './remainingStoneGuards';

export interface ContractQuantityInputPolicy {
  minimum: number;
  quantity: number;
  calculationQuantity: number;
  optimizerRequested: boolean;
}

export interface FreshContractProductDefaults {
  quantity: number;
  calibrationCutEnabled?: boolean;
}

export const getFreshContractProductDefaults = (
  productType: ContractUsageType | null | undefined
): FreshContractProductDefaults => {
  if (productType === 'longitudinal') {
    return { quantity: 0, calibrationCutEnabled: false };
  }
  if (productType === 'stair') {
    return { quantity: 1, calibrationCutEnabled: false };
  }
  return { quantity: 1 };
};

export const resolveExistingCalibrationCutEnabled = (value: boolean | null | undefined): boolean =>
  value ?? true;

export const getContractQuantityInputPolicy = (
  productType: ContractUsageType | null | undefined,
  value: number | null | undefined
): ContractQuantityInputPolicy => {
  const enteredQuantity = Math.max(0, Number(value) || 0);
  const optimizerRequested = productType === 'longitudinal' && enteredQuantity === 0;
  const quantity = optimizerRequested ? 0 : Math.max(1, enteredQuantity);

  return {
    minimum: productType === 'longitudinal' ? 0 : 1,
    quantity,
    calculationQuantity: optimizerRequested ? 1 : quantity,
    optimizerRequested
  };
};

export const resolveLongitudinalQuantityOptimizationFailure = (
  quantityOptimizationRequested: boolean,
  plan: Pick<SmartLongitudinalCutPlan, 'derivedQuantity' | 'requestedQuantity' | 'warnings'>
): string | null => {
  if (!quantityOptimizationRequested) return null;
  if (plan.derivedQuantity && plan.requestedQuantity > 0) return null;

  return plan.warnings[0] || 'بهینه‌سازی تعداد با ابعاد واردشده ممکن نیست. ابعاد سنگ و محصول را بررسی کنید.';
};

export const getOriginalWidthForProduct = (
  selectedProduct: Pick<Product, 'widthValue'> | null | undefined,
  draft: Partial<ContractProduct>,
  isEditMode: boolean
): number => (
  isEditMode && draft.originalWidth ? draft.originalWidth : selectedProduct?.widthValue || 0
);

export const widthCmToUnit = (widthCm: number, unit: 'cm' | 'm'): number =>
  unit === 'm' ? widthCm / 100 : widthCm;

export const resolveLongitudinalWidth = (
  draft: Partial<ContractProduct>,
  selectedProduct: Pick<Product, 'widthValue'> | null | undefined,
  widthUnit: 'cm' | 'm',
  isEditMode: boolean
): Partial<ContractProduct> => {
  const hasWidth = Number(draft.width || 0) > 0;
  const calculationNeedsWidth = Number(draft.length || 0) > 0 || Number(draft.squareMeters || 0) > 0;
  const canDeriveWidth =
    Number(draft.width || 0) <= 0 &&
    Number(draft.length || 0) > 0 &&
    Number(draft.squareMeters || 0) > 0 &&
    Number(draft.quantity || 0) > 0;
  const originalWidth = getOriginalWidthForProduct(selectedProduct, draft, isEditMode);

  if (hasWidth || canDeriveWidth || !calculationNeedsWidth || originalWidth <= 0) {
    return draft;
  }

  return {
    ...draft,
    width: widthCmToUnit(originalWidth, widthUnit)
  };
};

export interface RemainingStoneEditMergeResult {
  remainingStones: RemainingStone[];
  usedRemainingStones: RemainingStone[];
  totalUsedRemainingWidth: number;
  totalUsedRemainingLength: number;
  warning?: string;
}

export const mergeEditedRemainingStoneState = ({
  geometryChanged,
  nextAvailableRemainingStones,
  previousProduct
}: {
  geometryChanged: boolean;
  nextAvailableRemainingStones: RemainingStone[];
  previousProduct: ContractProduct | null;
}): RemainingStoneEditMergeResult => {
  if (!previousProduct) {
    return {
      remainingStones: normalizeRemainingStoneCollection(nextAvailableRemainingStones),
      usedRemainingStones: [],
      totalUsedRemainingWidth: 0,
      totalUsedRemainingLength: 0
    };
  }

  const usedRemainingStones = previousProduct.usedRemainingStones || [];

  if (!geometryChanged) {
    return {
      remainingStones: normalizeRemainingStoneCollection(previousProduct.remainingStones || nextAvailableRemainingStones),
      usedRemainingStones,
      totalUsedRemainingWidth: previousProduct.totalUsedRemainingWidth || 0,
      totalUsedRemainingLength: previousProduct.totalUsedRemainingLength || 0
    };
  }

  return {
    remainingStones: normalizeRemainingStoneCollection(nextAvailableRemainingStones),
    usedRemainingStones,
    totalUsedRemainingWidth: previousProduct.totalUsedRemainingWidth || 0,
    totalUsedRemainingLength: previousProduct.totalUsedRemainingLength || 0,
    warning: usedRemainingStones.length > 0
      ? 'باقی‌مانده‌های در دسترس با ابعاد جدید به‌روزرسانی شدند. محصولاتی که قبلاً از باقی‌مانده ساخته شده‌اند حذف نشدند؛ لطفاً ظرفیت آن‌ها را بررسی کنید.'
      : undefined
  };
};

export const restoreRemainingStoneAfterChildRemoval = (
  products: ContractProduct[],
  removedIndex: number
): ContractProduct[] => {
  const productToRemove = products[removedIndex];
  const remainingSourceMeta = productToRemove?.meta?.remainingSource;

  if (!remainingSourceMeta) {
    return products.filter((_, index) => index !== removedIndex);
  }

  const sourceProductIndex = remainingSourceMeta.sourceProductIndex as number;
  const partitionId = remainingSourceMeta.partitionId as string | undefined;
  const sourceRemainingStoneId = remainingSourceMeta.sourceRemainingStoneId as string | undefined;
  const productsAfterRemoval = products.filter((_, index) => index !== removedIndex);
  const normalizedSourceIndex = removedIndex < sourceProductIndex ? sourceProductIndex - 1 : sourceProductIndex;

  if (normalizedSourceIndex < 0 || normalizedSourceIndex >= productsAfterRemoval.length) {
    return productsAfterRemoval;
  }

  const sourceProduct = productsAfterRemoval[normalizedSourceIndex];
  const sourceRemainingStoneSnapshot = remainingSourceMeta.sourceRemainingStone
    ? sanitizeRemainingStoneEntry(remainingSourceMeta.sourceRemainingStone as RemainingStone)
    : null;
  const generatedRemainingStoneIds = new Set(
    Array.isArray(remainingSourceMeta.generatedRemainingStoneIds)
      ? remainingSourceMeta.generatedRemainingStoneIds.filter(Boolean)
      : []
  );
  const physicalPieces = Array.isArray(remainingSourceMeta.physicalPieces)
    ? remainingSourceMeta.physicalPieces
    : [];
  const fallbackRestoredRemainingStones = physicalPieces.length > 0
    ? physicalPieces.map((piece: any, pieceIndex: number) => sanitizeRemainingStoneEntry({
        id: `restored_${Date.now()}_${partitionId || 'partition'}_${pieceIndex}`,
        width: piece.width,
        length: piece.length,
        squareMeters: piece.squareMeters,
        isAvailable: true,
        sourceCutId: sourceRemainingStoneId || '',
        quantity: piece.quantity || 1
      } as RemainingStone))
    : [sanitizeRemainingStoneEntry({
        id: `restored_${Date.now()}_${partitionId || 'partition'}`,
        width: productToRemove.width,
        length: productToRemove.length,
        squareMeters: productToRemove.squareMeters,
        isAvailable: true,
        sourceCutId: sourceRemainingStoneId || '',
        quantity: productToRemove.quantity
      } as RemainingStone)];

  const restoredRemainingStones = sourceRemainingStoneSnapshot?.isAvailable
    ? [sourceRemainingStoneSnapshot]
    : fallbackRestoredRemainingStones;
  const cleanedUsedRemaining = (sourceProduct.usedRemainingStones || []).filter(stone => {
    if (!partitionId) return true;
    return !(stone.id && stone.id.includes(partitionId));
  });
  const recalculated = recalculateUsedRemainingDimensions(cleanedUsedRemaining);
  const retainedRemainingStones = (sourceProduct.remainingStones || []).filter(stone => {
    if (generatedRemainingStoneIds.has(stone.id)) return false;
    if (sourceRemainingStoneSnapshot && stone.id === sourceRemainingStoneSnapshot.id) return false;
    return true;
  });
  const mergedRemaining = mergeRemainingStoneCollection([
    ...retainedRemainingStones,
    ...restoredRemainingStones
  ]);

  productsAfterRemoval[normalizedSourceIndex] = {
    ...sourceProduct,
    usedRemainingStones: cleanedUsedRemaining,
    remainingStones: mergedRemaining,
    totalUsedRemainingWidth: recalculated.totalUsedWidth,
    totalUsedRemainingLength: recalculated.totalUsedLength
  };

  return productsAfterRemoval;
};
