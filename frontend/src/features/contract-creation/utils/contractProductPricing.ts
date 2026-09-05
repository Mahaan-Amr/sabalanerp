import { sumNumericValues, toFiniteNumber } from '@/lib/numberFormat';
import type { ContractProduct, ContractServiceRow } from '../types/contract.types';
import { getBillableCuttingCost } from './mandatoryCuttingPricing';

export interface ContractProductPriceComponents {
  savedTotal: number;
  materialBase: number;
  mandatoryAmount: number;
  cuttingCost: number;
  toolsCost: number;
  finishingCost: number;
  knownPayableMinimum: number;
  reconciledTotal: number;
  hasReliableMaterialBase: boolean;
}

const getToolsCost = (product: ContractProduct): number => {
  const snapshotTotal = toFiniteNumber(product.totalSubServiceCost);
  const rowTotal = sumNumericValues(product.appliedSubServices || [], (service) => service.cost);
  return Math.max(snapshotTotal, rowTotal);
};

const getFinishingCost = (product: ContractProduct): number => {
  if (Array.isArray(product.finishings)) {
    return sumNumericValues(product.finishings, (finishing) => finishing.cost);
  }
  return Math.max(
    toFiniteNumber(product.finishingCost),
    toFiniteNumber((product.meta as any)?.finishing?.cost)
  );
};

const isRemainingStoneChild = (product: ContractProduct): boolean => Boolean(
  product.parentProductRowId || (product.meta as any)?.remainingSource
);

/**
 * Reconciles the all-in product total against independently saved price-bearing facts.
 *
 * `totalPrice` remains the canonical all-in persisted value. This function only raises
 * an inconsistent total to the minimum proven by the material and billable operation
 * snapshots; it never guesses a missing material base or removes an unknown legacy charge.
 */
export const getContractProductPriceComponents = (
  product: ContractProduct
): ContractProductPriceComponents => {
  const savedTotal = toFiniteNumber(product.totalPrice);
  const materialBase = toFiniteNumber(product.originalTotalPrice);
  const hasReliableMaterialBase = materialBase > 0 || isRemainingStoneChild(product);
  const mandatoryPercentage = product.isMandatory
    ? Math.max(toFiniteNumber(product.mandatoryPercentage), 0)
    : 0;
  const mandatoryAmount = materialBase * (mandatoryPercentage / 100);
  const cuttingCost = getBillableCuttingCost(product);
  const toolsCost = getToolsCost(product);
  const finishingCost = getFinishingCost(product);
  const knownPayableMinimum = hasReliableMaterialBase
    ? materialBase + mandatoryAmount + cuttingCost + toolsCost + finishingCost
    : savedTotal;
  const explicitCanonicalPricing = (product.meta as any)?.pricing;
  const reconciledTotal = explicitCanonicalPricing?.authority === 'canonical-current-save'
    ? toFiniteNumber(explicitCanonicalPricing.totalPrice)
    : Math.max(savedTotal, knownPayableMinimum);

  return {
    savedTotal,
    materialBase,
    mandatoryAmount,
    cuttingCost,
    toolsCost,
    finishingCost,
    knownPayableMinimum,
    reconciledTotal,
    hasReliableMaterialBase
  };
};

export const getContractProductPayableTotal = (product: ContractProduct): number =>
  getContractProductPriceComponents(product).reconciledTotal;

export const getContractProductOperationTotal = (product: ContractProduct): number => {
  const components = getContractProductPriceComponents(product);
  return components.cuttingCost + components.toolsCost + components.finishingCost;
};

export const getContractProductNonServiceSubtotal = (product: ContractProduct): number =>
  Math.max(getContractProductPayableTotal(product) - getContractProductOperationTotal(product), 0);

export const reconcileContractProductPricing = (product: ContractProduct): ContractProduct => {
  const components = getContractProductPriceComponents(product);
  const existingPricing = (product.meta as any)?.pricing;
  const preparedPricingFieldsAreComplete = [
    'materialBase',
    'mandatoryAmount',
    'cuttingCost',
    'toolsCost',
    'finishingCost',
    'totalPrice'
  ].every((key) => Object.prototype.hasOwnProperty.call(existingPricing || {}, key));
  const preparedPricingIsCanonical = product.productType === 'prepared' &&
    existingPricing?.authority === 'canonical-current-save' &&
    existingPricing?.reconciled === true &&
    preparedPricingFieldsAreComplete &&
    toFiniteNumber(existingPricing.materialBase) === components.materialBase &&
    toFiniteNumber(existingPricing.mandatoryAmount) === components.mandatoryAmount &&
    toFiniteNumber(existingPricing.cuttingCost) === components.cuttingCost &&
    toFiniteNumber(existingPricing.toolsCost) === components.toolsCost &&
    toFiniteNumber(existingPricing.finishingCost) === components.finishingCost &&
    toFiniteNumber(existingPricing.totalPrice) === components.reconciledTotal;
  if (
    components.reconciledTotal === components.savedTotal &&
    (product.productType !== 'prepared' || preparedPricingIsCanonical)
  ) return product;

  return {
    ...product,
    totalPrice: components.reconciledTotal,
    meta: {
      ...(product.meta || {}),
      pricing: {
        ...(existingPricing || {}),
        ...(product.productType === 'prepared'
          ? { authority: 'canonical-current-save' }
          : {}),
        materialBase: components.materialBase,
        mandatoryAmount: components.mandatoryAmount,
        cuttingCost: components.cuttingCost,
        toolsCost: components.toolsCost,
        finishingCost: components.finishingCost,
        totalPrice: components.reconciledTotal,
        reconciled: true
      }
    }
  };
};

export const getContractProductsPayableTotal = (products: ContractProduct[]): number =>
  sumNumericValues(products, getContractProductPayableTotal);

export const getContractGrossPayableTotal = (
  products: ContractProduct[],
  standaloneServiceRows: ContractServiceRow[] = []
): number => getContractProductsPayableTotal(products) +
  sumNumericValues(standaloneServiceRows, (row) => row.totalPrice);
