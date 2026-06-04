import type { ContractProduct, Product, RemainingStone } from '../types/contract.types';
import { normalizeRemainingStoneCollection } from './remainingStoneGuards';

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
  const originalWidth = getOriginalWidthForProduct(selectedProduct, draft, isEditMode);

  if (hasWidth || !calculationNeedsWidth || originalWidth <= 0) {
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

