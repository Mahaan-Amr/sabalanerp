import { toFiniteNumber } from '@/lib/numberFormat';
import type { ContractProduct } from '../types/contract.types';

export const getPhysicalCuttingCost = (
  product: Pick<ContractProduct, 'physicalCuttingCost' | 'cuttingBreakdown' | 'cuttingCost'>
): number => {
  if (product.physicalCuttingCost !== undefined && product.physicalCuttingCost !== null) {
    return toFiniteNumber(product.physicalCuttingCost);
  }
  if (product.cuttingBreakdown?.length) {
    return product.cuttingBreakdown.reduce((sum, cut) => sum + toFiniteNumber(cut.cost), 0);
  }
  return toFiniteNumber(product.cuttingCost);
};

export const getBillableCuttingCost = (
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage' | 'cuttingCost'>
): number => isMandatoryLongitudinalCuttingNonBillable(product) ? 0 : toFiniteNumber(product.cuttingCost);

export const isMandatoryLongitudinalCuttingNonBillable = (
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage'>
): boolean =>
  product.isMandatory === true &&
  toFiniteNumber(product.mandatoryPercentage) > 0;

export const normalizeMandatoryLongitudinalCuttingPricing = (
  product: ContractProduct
): ContractProduct => {
  if (!isMandatoryLongitudinalCuttingNonBillable(product)) {
    return product;
  }

  const previousCuttingCost = toFiniteNumber(product.cuttingCost);
  const physicalCuttingCost = getPhysicalCuttingCost(product);
  if (previousCuttingCost <= 0) {
    return {
      ...product,
      cuttingCost: 0,
      physicalCuttingCost
    };
  }

  return {
    ...product,
    cuttingCost: 0,
    physicalCuttingCost,
    totalPrice: Math.max(toFiniteNumber(product.totalPrice) - previousCuttingCost, 0)
  };
};
