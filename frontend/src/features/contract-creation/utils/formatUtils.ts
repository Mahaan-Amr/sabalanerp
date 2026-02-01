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

