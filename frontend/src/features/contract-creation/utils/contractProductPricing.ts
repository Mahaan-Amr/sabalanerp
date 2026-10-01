import { toFiniteNumber } from '@/lib/numberFormat';
import { multiplyContractMonetaryAmounts, roundContractPayableTotal, sumContractMonetaryAmounts } from '@sabalanerp/contract-product-graph';
import type { ContractProduct, ContractServiceRow } from '../types/contract.types';
import { getBillableCuttingCost } from './mandatoryCuttingPricing';
import { getContractServiceRowExactAmount } from './contractServiceRows';

const exactAmountFields = ['materialBase', 'mandatoryAmount', 'cuttingCost', 'toolsCost', 'finishingCost', 'totalPrice'] as const;

/** Exact witnesses travel with the numeric UI projection, under an explicit producer policy. */
export const getContractProductExactAmounts = (product: ContractProduct) => {
  const pricing = product.meta?.pricing;
  const exact = pricing?.exactAmounts;
  if (pricing?.authority !== 'canonical-current-save' || exact?.policyVersion !== 'canonical-save-decimal-v1') return undefined;
  try {
    if (exactAmountFields.some(field => typeof exact[field] !== 'string' ||
      Number(exact[field]) !== Number(pricing[field]))) return undefined;
    if (Number(exact.totalPrice) !== Number(product.totalPrice)) return undefined;
    const components = sumContractMonetaryAmounts(exactAmountFields.slice(0, -1).map(field => exact[field]));
    if (components !== sumContractMonetaryAmounts([exact.totalPrice])) return undefined;
    return exact as Record<typeof exactAmountFields[number], string>;
  } catch { return undefined; }
};

export const serializeContractProductMonetaryAmounts = (product: ContractProduct) => {
  const exact = getContractProductExactAmounts(product);
  return product.productType === 'prepared' && exact ? {
    ...product,
    originalTotalPrice: exact.materialBase,
    totalPrice: exact.totalPrice
  } : product;
};

const getExactProductPayableTotal = (product: ContractProduct): string | number => {
  const exact = getContractProductExactAmounts(product);
  return exact && Number(exact.totalPrice) === getContractProductPayableTotal(product)
    ? exact.totalPrice : getContractProductPayableTotal(product);
};

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
  const rowTotal = Number(sumContractMonetaryAmounts((product.appliedSubServices || []).map(service => toFiniteNumber(service.cost))));
  return Math.max(snapshotTotal, rowTotal);
};

const getFinishingCost = (product: ContractProduct): number => {
  if (Array.isArray(product.finishings)) {
    return Number(sumContractMonetaryAmounts(product.finishings.map(finishing => toFiniteNumber(finishing.cost))));
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
  const explicitCanonicalPricing = (product.meta as any)?.pricing;
  const canonical = explicitCanonicalPricing?.authority === 'canonical-current-save'
    ? explicitCanonicalPricing : undefined;
  const materialBase = toFiniteNumber(canonical?.materialBase ?? product.originalTotalPrice);
  const hasReliableMaterialBase = materialBase > 0 || isRemainingStoneChild(product);
  const mandatoryPercentage = product.isMandatory
    ? Math.max(toFiniteNumber(product.mandatoryPercentage), 0)
    : 0;
  const mandatoryAmount = canonical?.mandatoryAmount === undefined
    ? Number(multiplyContractMonetaryAmounts(multiplyContractMonetaryAmounts(materialBase, mandatoryPercentage), '0.01'))
    : toFiniteNumber(canonical.mandatoryAmount);
  const cuttingCost = toFiniteNumber(canonical?.cuttingCost ?? getBillableCuttingCost(product));
  const toolsCost = toFiniteNumber(canonical?.toolsCost ?? getToolsCost(product));
  const finishingCost = toFiniteNumber(canonical?.finishingCost ?? getFinishingCost(product));
  const knownPayableMinimum = hasReliableMaterialBase
    ? Number(sumContractMonetaryAmounts([materialBase, mandatoryAmount, cuttingCost, toolsCost, finishingCost]))
    : savedTotal;
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
  return Number(sumContractMonetaryAmounts([components.cuttingCost, components.toolsCost, components.finishingCost]));
};

export const getContractProductNonServiceSubtotal = (product: ContractProduct): number =>
  Math.max(Number(sumContractMonetaryAmounts([getContractProductPayableTotal(product), -getContractProductOperationTotal(product)])), 0);

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
  Number(sumContractMonetaryAmounts(products.map(getExactProductPayableTotal)));

export const getContractGrossPayableTotal = (
  products: ContractProduct[],
  standaloneServiceRows: ContractServiceRow[] = []
): number => Number(sumContractMonetaryAmounts([
  ...products.map(getExactProductPayableTotal),
  ...standaloneServiceRows.map(getContractServiceRowExactAmount)
]));

export const getContractPayableTotal = (
  products: ContractProduct[],
  standaloneServiceRows: ContractServiceRow[] = [],
  discountAmount = 0,
  applyMonetaryRounding = true
): number => {
  const source = getContractUnroundedPayableTotal(products, standaloneServiceRows, discountAmount);
  return Number(applyMonetaryRounding ? roundContractPayableTotal(source, 'تومان').roundedAmount : source);
};

export const getContractUnroundedPayableTotal = (
  products: ContractProduct[], standaloneServiceRows: ContractServiceRow[] = [], discountAmount = 0
): string => {
  const source = sumContractMonetaryAmounts([
    ...products.map(getExactProductPayableTotal),
    ...standaloneServiceRows.map(getContractServiceRowExactAmount),
    -Math.max(toFiniteNumber(discountAmount), 0)
  ]);
  return source.startsWith('-') ? '0' : source;
};
