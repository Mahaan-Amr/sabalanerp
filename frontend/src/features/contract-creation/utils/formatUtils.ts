// Formatting utilities for contract creation
// Re-exports from numberFormat and adds contract-specific formatters

export {
  formatDisplayNumber,
  formatPrice,
  formatPriceWithRial,
  formatDimensions,
  formatSquareMeters,
  formatQuantity,
  tomanToRial
} from '@/lib/numberFormat';

/**
 * Generate full product name from product attributes
 */
export const generateFullProductName = (product: {
  stoneTypeNamePersian: string;
  cuttingDimensionNamePersian: string;
  widthValue: number;
  thicknessValue: number;
  mineNamePersian: string;
  finishNamePersian: string;
  colorNamePersian: string;
  qualityNamePersian: string;
}): string => {
  const parts = [
    product.stoneTypeNamePersian,
    product.cuttingDimensionNamePersian,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm`,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian
  ].filter(part => part && part.trim() !== '');
  
  return parts.join(' - ');
};

/**
 * Generate compact product name for saved contract rows.
 */
export const generateCompactProductName = (product: {
  stoneTypeNamePersian?: string;
  cuttingDimensionNamePersian?: string;
  widthValue?: number;
  thicknessValue?: number;
  mineNamePersian?: string;
  finishNamePersian?: string;
  namePersian?: string;
  name?: string;
}): string => {
  const width = product.widthValue ? String(product.widthValue) : '';
  const thickness = product.thicknessValue ? `ض ${product.thicknessValue}` : '';
  const parts = [
    product.cuttingDimensionNamePersian,
    product.stoneTypeNamePersian,
    width,
    thickness,
    product.mineNamePersian,
    product.finishNamePersian
  ].filter((part) => part && String(part).trim() !== '');

  return parts.join(' ') || product.namePersian || product.name || '';
};

