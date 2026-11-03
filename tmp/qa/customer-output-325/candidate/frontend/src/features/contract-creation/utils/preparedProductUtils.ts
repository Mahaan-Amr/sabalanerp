import type { ContractProduct, ContractProductType, PreparedProductKind, PreparedProductUnit, Product } from '../types/contract.types';

export type ActiveContractProductType = Exclude<ContractProductType, 'volumetric'>;

export const normalizeContractProductType = (productType?: string | null): ActiveContractProductType | null => {
  if (productType === 'volumetric') return 'prepared';
  if (productType === 'longitudinal' || productType === 'stair' || productType === 'slab' || productType === 'prepared') {
    return productType;
  }
  return null;
};

export const isPreparedProductType = (productType?: string | null): boolean =>
  normalizeContractProductType(productType) === 'prepared';

const normalizePersianLabel = (value: unknown): string =>
  String(value ?? '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .trim()
    .toLowerCase();

export const inferPreparedKindFromProduct = (product?: Product | null): PreparedProductKind => {
  const label = normalizePersianLabel([
    product?.cuttingDimensionNamePersian,
    product?.cuttingDimensionNamePersian,
    product?.namePersian,
    product?.name,
    product?.fullName
  ].join(' '));

  if (label.includes('قطعات') || label.includes('آماده')) return 'readyPiece';
  return 'cubic';
};

export const getPreparedKindLabel = (kind?: PreparedProductKind | null): string => {
  if (kind === 'readyPiece') return 'قطعات آماده';
  return 'کیوبیک';
};

export const getPreparedUnitLabel = (unit?: PreparedProductUnit | null): string => {
  if (unit === 'ton') return 'تن';
  if (unit === 'squareMeter') return 'متر مربع';
  return 'تعداد';
};

export const getPreparedUnitDeliveryValue = (unit?: PreparedProductUnit | null): 'squareMeter' | 'ton' | 'count' =>
  unit === 'ton' ? 'ton' : unit === 'squareMeter' ? 'squareMeter' : 'count';

export const getPreparedQuantity = (product: ContractProduct): number =>
  Number(product.preparedQuantity ?? product.quantity ?? 0) || 0;

export const getPreparedUnit = (product: ContractProduct): PreparedProductUnit =>
  (product.preparedUnit === 'ton' || product.preparedUnit === 'squareMeter' || product.preparedUnit === 'count')
    ? product.preparedUnit
    : 'count';

export const getPreparedRowSummary = (product: ContractProduct): string => {
  const kindLabel = getPreparedKindLabel(product.preparedKind || inferPreparedKindFromProduct(product.product));
  const unitLabel = getPreparedUnitLabel(getPreparedUnit(product));
  return `${kindLabel} | ${unitLabel}`;
};
