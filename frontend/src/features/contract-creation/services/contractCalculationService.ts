// Contract calculation service
// Handles all contract-level calculations

import type { ContractProduct } from '../types/contract.types';
import { calculateFinalPrice } from './pricingService';
import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';

/**
 * Calculate product total including all costs
 */
export const calculateProductTotal = (
  product: ContractProduct,
  config?: {
    includeCuttingCost?: boolean;
    includeSubServiceCost?: boolean;
  }
): number => {
  const { includeCuttingCost = true, includeSubServiceCost = true } = config || {};
  
  let total = toFiniteNumber(product.totalPrice);
  
  if (includeCuttingCost && product.cuttingCost) {
    total += toFiniteNumber(product.cuttingCost);
  }
  
  if (includeSubServiceCost && product.totalSubServiceCost) {
    total += toFiniteNumber(product.totalSubServiceCost);
  }
  
  if (product.finishingCost) {
    total += toFiniteNumber(product.finishingCost);
  }
  
  return total;
};

/**
 * Calculate contract total from all products
 */
export const calculateContractTotal = (
  products: ContractProduct[],
  options?: {
    includeCuttingCosts?: boolean;
    includeSubServiceCosts?: boolean;
  }
): {
  productsTotal: number;
  cuttingCostsTotal: number;
  subServiceCostsTotal: number;
  finishingCostsTotal: number;
  grandTotal: number;
} => {
  const { includeCuttingCosts = true, includeSubServiceCosts = true } = options || {};
  
  let productsTotal = 0;
  let cuttingCostsTotal = 0;
  let subServiceCostsTotal = 0;
  let finishingCostsTotal = 0;
  
  products.forEach(product => {
    productsTotal += toFiniteNumber(product.totalPrice);
    
    if (includeCuttingCosts && product.cuttingCost) {
      cuttingCostsTotal += toFiniteNumber(product.cuttingCost);
    }
    
    if (includeSubServiceCosts && product.totalSubServiceCost) {
      subServiceCostsTotal += toFiniteNumber(product.totalSubServiceCost);
    }
    
    if (product.finishingCost) {
      finishingCostsTotal += toFiniteNumber(product.finishingCost);
    }
  });
  
  const grandTotal = productsTotal + cuttingCostsTotal + subServiceCostsTotal + finishingCostsTotal;
  
  return {
    productsTotal,
    cuttingCostsTotal,
    subServiceCostsTotal,
    finishingCostsTotal,
    grandTotal
  };
};

/**
 * Calculate mandatory pricing for a product
 */
export const calculateMandatoryPricing = (
  basePrice: number,
  percentage: number
): {
  originalPrice: number;
  increaseAmount: number;
  finalPrice: number;
} => {
  const originalPrice = basePrice;
  const increaseAmount = basePrice * (percentage / 100);
  const finalPrice = basePrice + increaseAmount;
  
  return {
    originalPrice,
    increaseAmount,
    finalPrice
  };
};

/**
 * Calculate cutting costs for a product
 */
export const calculateCuttingCosts = (
  product: ContractProduct
): number => {
  if (!product.isCut || !product.cuttingCost) {
    return 0;
  }
  
  return toFiniteNumber(product.cuttingCost);
};

/**
 * Calculate sub-service costs for a product
 */
export const calculateSubServiceCosts = (
  product: ContractProduct
): number => {
  if (!product.appliedSubServices || product.appliedSubServices.length === 0) {
    return 0;
  }
  
  return sumNumericValues(product.appliedSubServices, (service) => service.cost);
};

