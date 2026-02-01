// Contract calculation service
// Handles all contract-level calculations

import type { ContractProduct } from '../types/contract.types';
import { calculateFinalPrice } from './pricingService';

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
  
  let total = product.totalPrice || 0;
  
  if (includeCuttingCost && product.cuttingCost) {
    total += product.cuttingCost;
  }
  
  if (includeSubServiceCost && product.totalSubServiceCost) {
    total += product.totalSubServiceCost;
  }
  
  if (product.finishingCost) {
    total += product.finishingCost;
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
    productsTotal += product.totalPrice || 0;
    
    if (includeCuttingCosts && product.cuttingCost) {
      cuttingCostsTotal += product.cuttingCost;
    }
    
    if (includeSubServiceCosts && product.totalSubServiceCost) {
      subServiceCostsTotal += product.totalSubServiceCost;
    }
    
    if (product.finishingCost) {
      finishingCostsTotal += product.finishingCost;
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
  
  return product.cuttingCost;
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
  
  return product.appliedSubServices.reduce((sum, service) => sum + (service.cost || 0), 0);
};

