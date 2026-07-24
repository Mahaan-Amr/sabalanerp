import type {
  ContractProduct,
  PreparedProductKind,
  PreparedProductUnit,
  Product
} from '../../types/contract.types';
import {
  inferPreparedKindFromProduct
} from '../../utils/preparedProductUtils';

export interface PreparedProductPresentation {
  readonly kind: PreparedProductKind;
  readonly allowedUnits: readonly PreparedProductUnit[];
  readonly unit: PreparedProductUnit;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
}

export const resolvePreparedProductPresentation = (
  config: Partial<ContractProduct>,
  product: Product
): PreparedProductPresentation => {
  const kind = config.preparedKind || inferPreparedKindFromProduct(product);
  const allowedUnits: readonly PreparedProductUnit[] = kind === 'cubic'
    ? ['squareMeter', 'ton', 'count']
    : ['squareMeter', 'count'];
  const unit = config.preparedUnit && allowedUnits.includes(config.preparedUnit)
    ? config.preparedUnit
    : 'count';
  const quantity = Number(config.preparedQuantity ?? config.quantity ?? 1) || 0;
  const unitPrice = Number(
    config.unitPrice ?? config.pricePerSquareMeter ?? product.basePrice ?? 0
  ) || 0;
  return {
    kind,
    allowedUnits,
    unit,
    quantity,
    unitPrice,
    total: quantity * unitPrice
  };
};

export const changePreparedKind = (
  config: Partial<ContractProduct>,
  preparedKind: PreparedProductKind
): Partial<ContractProduct> => ({
  ...config,
  preparedKind,
  preparedUnit:
    preparedKind === 'readyPiece' && config.preparedUnit === 'ton'
      ? 'count'
      : (config.preparedUnit || 'count')
});

export const changePreparedUnit = (
  config: Partial<ContractProduct>,
  preparedUnit: PreparedProductUnit
): Partial<ContractProduct> => ({
  ...config,
  preparedUnit,
  squareMeters: preparedUnit === 'squareMeter'
    ? (Number(config.preparedQuantity ?? config.quantity ?? 0) || 0)
    : 0
});

export const changePreparedQuantity = (
  config: Partial<ContractProduct>,
  quantity: number,
  resolvedUnit: PreparedProductUnit
): Partial<ContractProduct> => ({
  ...config,
  preparedQuantity: quantity || 0,
  quantity: quantity || 0,
  squareMeters:
    (config.preparedUnit || resolvedUnit) === 'squareMeter'
      ? (quantity || 0)
      : 0
});

export const changePreparedUnitPrice = (
  config: Partial<ContractProduct>,
  unitPrice: number
): Partial<ContractProduct> => ({
  ...config,
  unitPrice: unitPrice || 0,
  pricePerSquareMeter: unitPrice || 0
});
