// Product utility functions
// Helper functions for product-related operations

import type { Product, ContractUsageType, StairSystemConfig } from '../types/contract.types';
import { CONTRACT_VISIBILITY_FIELD_MAP } from '../constants/contract.constants';
import { generateFullProductName } from './formatUtils';

/**
 * Check if a product supports a specific contract type
 */
export const productSupportsContractType = (
  product: Product,
  contractType?: ContractUsageType | null
): boolean => {
  if (!contractType) return true;
  const fieldName = CONTRACT_VISIBILITY_FIELD_MAP[contractType];
  const flagValue = product[fieldName as keyof Product];
  if (flagValue === undefined || flagValue === null) {
    return true;
  }
  return Boolean(flagValue);
};

/**
 * Generate full product name (re-export from formatUtils for convenience)
 */
export { generateFullProductName };

/**
 * Initialize stair system configuration with default values
 */
export const initializeStairSystemConfig = (defaultProduct: Product | null): StairSystemConfig => {
  return {
    numberOfSteps: 0,
    quantityType: 'steps',
    numberOfStaircases: 1,
    defaultProduct: defaultProduct,
    tread: {
      partType: 'tread',
      isSelected: false,
      productId: defaultProduct?.id || null,
      product: defaultProduct,
      treadWidth: 0,
      treadDepth: 30,
      quantity: 0,
      squareMeters: 0,
      pricePerSquareMeter: defaultProduct?.basePrice || 0,
      totalPrice: 0,
      nosingType: 'none',
      nosingOverhang: 30,
      nosingCuttingCost: 0,
      nosingCuttingCostPerMeter: 0,
      isMandatory: false,
      mandatoryPercentage: 20,
      originalTotalPrice: 0,
      description: '',
      currency: 'تومان',
      lengthUnit: 'm'
    },
    riser: {
      partType: 'riser',
      isSelected: false,
      productId: defaultProduct?.id || null,
      product: defaultProduct,
      riserHeight: 17,
      quantity: 0,
      squareMeters: 0,
      pricePerSquareMeter: defaultProduct?.basePrice || 0,
      totalPrice: 0,
      isMandatory: true,
      mandatoryPercentage: 20,
      originalTotalPrice: 0,
      description: '',
      currency: 'تومان'
    },
    landing: {
      partType: 'landing',
      isSelected: false,
      productId: defaultProduct?.id || null,
      product: defaultProduct,
      landingWidth: 0,
      landingDepth: 0,
      numberOfLandings: 0,
      quantity: 0,
      squareMeters: 0,
      pricePerSquareMeter: defaultProduct?.basePrice || 0,
      totalPrice: 0,
      isMandatory: true,
      mandatoryPercentage: 20,
      originalTotalPrice: 0,
      description: '',
      currency: 'تومان'
    }
  };
};

/**
 * Get cutting type price per meter from cutting types array
 */
interface CuttingType {
  code: string;
  pricePerMeter: number | null;
}

export const getCuttingTypePricePerMeter = (
  cutTypeCode: string,
  cuttingTypes: CuttingType[]
): number | null => {
  const cuttingType = cuttingTypes.find(
    ct => ct.code === cutTypeCode && ct.pricePerMeter !== null && ct.pricePerMeter !== undefined
  );
  return cuttingType?.pricePerMeter || null;
};


