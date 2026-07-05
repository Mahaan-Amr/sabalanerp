import { toFiniteNumber } from '@/lib/numberFormat';
import type { ContractProduct } from '../types/contract.types';

export const isMandatoryLongitudinalCuttingNonBillable = (
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage'>
): boolean =>
  product.productType === 'longitudinal' &&
  product.isMandatory === true &&
  toFiniteNumber(product.mandatoryPercentage) > 0;

export const normalizeMandatoryLongitudinalCuttingPricing = (
  product: ContractProduct
): ContractProduct => {
  if (!isMandatoryLongitudinalCuttingNonBillable(product)) {
    return product;
  }

  const previousCuttingCost = toFiniteNumber(product.cuttingCost);
  if (previousCuttingCost <= 0) {
    return {
      ...product,
      cuttingCost: 0
    };
  }

  return {
    ...product,
    cuttingCost: 0,
    totalPrice: Math.max(toFiniteNumber(product.totalPrice) - previousCuttingCost, 0)
  };
};
