// Product utility functions
// Helper functions for product-related operations

import type { Product, ContractUsageType, StairSystemConfig } from '../types/contract.types';
import { CONTRACT_VISIBILITY_FIELD_MAP } from '../constants/contract.constants';
import { generateCompactProductName, generateFullProductName, generateSlabContractProductName } from './formatUtils';

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
 * Resolve the catalog's primary contract behavior. Availability flags describe
 * where a product may be used and are frequently all enabled, so they cannot
 * establish the default on their own. The coded cutting-dimension classification
 * is the primary catalog fact; flags are only a deterministic fallback for
 * incomplete legacy catalog rows.
 */
export const inferCatalogContractType = (
  product: Product
): Exclude<ContractUsageType, 'volumetric'> => {
  const classification = [
    product.cuttingDimensionNamePersian,
    (product as Product & { cuttingDimensionName?: string }).cuttingDimensionName,
    product.namePersian,
    product.name
  ].filter(Boolean).join(' ').toLocaleLowerCase('fa');

  if (classification.includes('اسلب') || classification.includes('slab')) return 'slab';
  if (
    classification.includes('کیوبیک') ||
    classification.includes('قطعات آماده') ||
    classification.includes('حجمی') ||
    classification.includes('cubic') ||
    classification.includes('prepared') ||
    classification.includes('cnc')
  ) return 'prepared';
  if (classification.includes('پله') || classification.includes('stair')) return 'stair';
  if (classification.includes('طولی') || classification.includes('longitudinal')) return 'longitudinal';

  if (product.availableInLongitudinalContracts) return 'longitudinal';
  if (product.availableInStairContracts) return 'stair';
  if (product.availableInSlabContracts) return 'slab';
  if (product.availableInVolumetricContracts) return 'prepared';
  return 'longitudinal';
};

/**
 * Resolve eligibility for one contract-entry route without changing catalog
 * identity. The stair route deliberately accepts every longitudinal catalog
 * product in addition to products explicitly classified or enabled for stairs.
 */
export const productSupportsContractRoute = (
  product: Product,
  contractType?: ContractUsageType | null
): boolean => {
  if (!contractType) return true;
  const normalizedType = contractType === 'volumetric'
    ? 'prepared'
    : contractType;
  const catalogType = inferCatalogContractType(product);
  if (normalizedType === 'stair') {
    return (
      catalogType === 'stair' ||
      catalogType === 'longitudinal' ||
      product.availableInStairContracts === true
    );
  }
  return catalogType === normalizedType;
};

/**
 * Generate full product name (re-export from formatUtils for convenience)
 */
export { generateFullProductName };

export { generateCompactProductName };

export { generateSlabContractProductName };

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
  return cuttingType?.pricePerMeter ?? null;
};


