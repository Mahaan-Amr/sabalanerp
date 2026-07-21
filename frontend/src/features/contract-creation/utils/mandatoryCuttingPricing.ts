import { toFiniteNumber } from '@/lib/numberFormat';
import type { ContractProduct, CuttingBreakdownEntry } from '../types/contract.types';

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
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage' | 'cuttingCost' | 'cutType' | 'cuttingBreakdown'>
): number => {
  if (!isMandatoryCuttingPolicyActive(product)) {
    return toFiniteNumber(product.cuttingCost);
  }

  const longitudinalBreakdown = product.cuttingBreakdown?.filter((cut) => cut.type === 'longitudinal') || [];
  if (longitudinalBreakdown.length > 0) {
    return longitudinalBreakdown.reduce((sum, cut) => sum + toFiniteNumber(cut.cost), 0);
  }

  return product.cutType === 'longitudinal' ? toFiniteNumber(product.cuttingCost) : 0;
};

export const isMandatoryCuttingPolicyActive = (
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage'>
): boolean =>
  product.isMandatory === true &&
  toFiniteNumber(product.mandatoryPercentage) > 0;

export const getBillableCuttingBreakdown = (
  product: Pick<ContractProduct, 'productType' | 'isMandatory' | 'mandatoryPercentage' | 'cuttingBreakdown'>
): CuttingBreakdownEntry[] => {
  const breakdown = product.cuttingBreakdown || [];
  if (!isMandatoryCuttingPolicyActive(product)) return breakdown;

  return breakdown.map((cut) => cut.type === 'cross'
    ? { ...cut, rate: 0, cost: 0 }
    : cut
  );
};

/** @deprecated Mandatory longitudinal cutting is billable; only cross cutting is waived. */
export const isMandatoryLongitudinalCuttingNonBillable = isMandatoryCuttingPolicyActive;

export const normalizeMandatoryLongitudinalCuttingPricing = (
  product: ContractProduct
): ContractProduct => {
  if (!isMandatoryCuttingPolicyActive(product)) {
    return product;
  }

  const previousCuttingCost = toFiniteNumber(product.cuttingCost);
  const physicalCuttingCost = getPhysicalCuttingCost(product);
  const billableCuttingCost = getBillableCuttingCost(product);
  if (Math.abs(previousCuttingCost - billableCuttingCost) < 0.000001) {
    return {
      ...product,
      cuttingCost: billableCuttingCost,
      physicalCuttingCost
    };
  }

  return {
    ...product,
    cuttingCost: billableCuttingCost,
    physicalCuttingCost,
    totalPrice: Math.max(toFiniteNumber(product.totalPrice) - previousCuttingCost + billableCuttingCost, 0)
  };
};
