import type { ContractProduct, StoneFinishing } from '../types/contract.types';
import { formatDisplayNumber, formatPrice, formatSquareMeters, toFiniteNumber } from '@/lib/numberFormat';

export type FinishingCalculationBase = 'length' | 'squareMeters';

export interface NormalizedFinishingSnapshot {
  id: string | null;
  name: string | null;
  calculationBase: FinishingCalculationBase;
  unitPrice: number;
  quantity: number;
  cost: number;
  unitLabel: string;
  amountLabel: string;
  rateLabel: string;
}

export const getFinishingCalculationBase = (value?: Partial<StoneFinishing> | null): FinishingCalculationBase =>
  value?.calculationBase === 'length' ? 'length' : 'squareMeters';

export const getFinishingUnitLabel = (calculationBase?: FinishingCalculationBase | null) =>
  calculationBase === 'length' ? 'متر طول' : 'متر مربع';

export const getFinishingUnitPrice = (value?: Partial<StoneFinishing> | null): number =>
  toFiniteNumber(value?.unitPrice) || toFiniteNumber(value?.pricePerSquareMeter);

export const calculateDefaultFinishingQuantity = ({
  calculationBase,
  productType,
  length,
  lengthUnit,
  quantity,
  squareMeters
}: {
  calculationBase: FinishingCalculationBase;
  productType?: ContractProduct['productType'] | null;
  length?: number | null;
  lengthUnit?: 'cm' | 'm' | null;
  quantity?: number | null;
  squareMeters?: number | null;
}): number => {
  if (calculationBase === 'squareMeters') return toFiniteNumber(squareMeters);
  if (productType === 'slab') return 0;

  const lengthValue = toFiniteNumber(length);
  const quantityValue = toFiniteNumber(quantity) || 1;
  if (lengthValue <= 0) return 0;
  const lengthInMeters = lengthUnit === 'cm' ? lengthValue / 100 : lengthValue;
  return lengthInMeters * quantityValue;
};

export const calculateFinishingCost = (quantity?: number | null, unitPrice?: number | null): number =>
  toFiniteNumber(quantity) * toFiniteNumber(unitPrice);

export const normalizeProductFinishing = (product: Partial<ContractProduct> | null | undefined): NormalizedFinishingSnapshot | null => {
  if (!product?.finishingId && !product?.finishingCost) return null;

  const metaFinishing = (product.meta as any)?.finishing || {};
  const calculationBase = (product.finishingCalculationBase || metaFinishing.calculationBase || 'squareMeters') === 'length'
    ? 'length'
    : 'squareMeters';
  const unitPrice =
    toFiniteNumber(product.finishingUnitPrice) ||
    toFiniteNumber(metaFinishing.unitPrice) ||
    toFiniteNumber(product.finishingPricePerSquareMeter) ||
    toFiniteNumber(metaFinishing.pricePerSquareMeter);
  const quantity =
    toFiniteNumber(product.finishingQuantity) ||
    toFiniteNumber(metaFinishing.quantity) ||
    toFiniteNumber(product.finishingSquareMeters) ||
    toFiniteNumber(metaFinishing.squareMeters) ||
    (calculationBase === 'squareMeters' ? toFiniteNumber(product.squareMeters) : 0);
  const cost = toFiniteNumber(product.finishingCost) || calculateFinishingCost(quantity, unitPrice);
  const unitLabel = getFinishingUnitLabel(calculationBase);

  return {
    id: product.finishingId || metaFinishing.id || null,
    name: product.finishingName || metaFinishing.name || null,
    calculationBase,
    unitPrice,
    quantity,
    cost,
    unitLabel,
    amountLabel: calculationBase === 'squareMeters'
      ? formatSquareMeters(quantity)
      : `${formatDisplayNumber(quantity)} ${unitLabel}`,
    rateLabel: unitPrice > 0 ? `${formatPrice(unitPrice, 'تومان')}/${unitLabel}` : ''
  };
};
