// Pricing calculation service
// Handles all pricing calculations including mandatory pricing

import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';

/**
 * Calculate base price from dimensions and price per square meter
 */
export const calculateBasePrice = (
  squareMeters: number,
  pricePerSquareMeter: number
): number => {
  return squareMeters * pricePerSquareMeter;
};

/**
 * Apply mandatory pricing (percentage increase)
 */
export const applyMandatoryPricing = (
  basePrice: number,
  percentage: number
): number => {
  if (percentage <= 0) return basePrice;
  return basePrice * (1 + percentage / 100);
};

/**
 * Calculate final price for a product
 * Includes base price, mandatory pricing, and cutting costs
 */
export const calculateFinalPrice = (data: {
  basePrice: number;
  isMandatory: boolean;
  mandatoryPercentage: number;
  cuttingCost?: number;
}): {
  originalPrice: number;
  finalPrice: number;
  mandatoryIncrease: number;
  totalWithCutting: number;
} => {
  const { basePrice, isMandatory, mandatoryPercentage, cuttingCost = 0 } = data;
  
  const originalPrice = basePrice;
  let finalPrice = basePrice;
  let mandatoryIncrease = 0;
  
  if (isMandatory && mandatoryPercentage > 0) {
    finalPrice = applyMandatoryPricing(basePrice, mandatoryPercentage);
    mandatoryIncrease = finalPrice - basePrice;
  }
  
  const totalWithCutting = finalPrice + cuttingCost;
  
  return {
    originalPrice,
    finalPrice,
    mandatoryIncrease,
    totalWithCutting
  };
};

/**
 * Calculate total contract amount from products
 */
export const calculateContractTotal = (products: Array<{ totalPrice: number | string | null | undefined }>): number => {
  return sumNumericValues(products, (product) => product.totalPrice);
};

/**
 * Calculate sub-service costs
 */
export const calculateSubServiceCosts = (subServices: Array<{
  meter: number | string | null | undefined;
  pricePerMeter: number | string | null | undefined;
}>): number => {
  return subServices.reduce((sum, service) => sum + (toFiniteNumber(service.meter) * toFiniteNumber(service.pricePerMeter)), 0);
};

