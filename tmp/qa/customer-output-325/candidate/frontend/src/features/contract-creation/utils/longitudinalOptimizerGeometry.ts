import type { ContractProduct, SmartCutProductionPiece } from '../types/contract.types';

interface LongitudinalCustomerFieldsInput {
  enteredLength: number;
  enteredLengthUnit: 'cm' | 'm';
  enteredWidth: number;
  enteredQuantity: number;
  plan: ContractProduct['smartCutPlan'];
}

export const resolveLongitudinalCustomerFields = ({
  enteredLength,
  enteredLengthUnit,
  enteredWidth,
  enteredQuantity,
  plan
}: LongitudinalCustomerFieldsInput): Pick<ContractProduct, 'length' | 'width' | 'quantity'> => {
  if (!plan?.derivedQuantity) {
    return { length: enteredLength, width: enteredWidth, quantity: enteredQuantity };
  }

  return {
    length: enteredLengthUnit === 'cm'
      ? Number(plan.totalRequestedLengthM || 0) * 100
      : Number(plan.totalRequestedLengthM || 0),
    width: enteredWidth,
    quantity: 0
  };
};

export interface ContractProductOperationGeometry {
  totalLengthMeters: number;
  totalWidthMeters: number;
  squareMeters: number;
  productionPieces: SmartCutProductionPiece[];
  usesInternalOptimizerGeometry: boolean;
}

export const restoreLongitudinalCustomerRequest = (
  product: ContractProduct
): ContractProduct => {
  const plan = product.smartCutPlan;
  if (
    product.productType !== 'longitudinal' ||
    !product.smartCutDerivedQuantity ||
    !plan?.derivedQuantity ||
    Number(plan.totalRequestedLengthM || 0) <= 0
  ) {
    return product;
  }

  const restoredLength = product.lengthUnit === 'cm'
    ? Number(plan.totalRequestedLengthM) * 100
    : Number(plan.totalRequestedLengthM);
  const restoredWidth = product.widthUnit === 'm'
    ? Number(plan.requestedWidthCm || 0) / 100
    : Number(plan.requestedWidthCm || 0);

  return {
    ...product,
    quantity: 0,
    length: restoredLength,
    width: restoredWidth > 0 ? restoredWidth : product.width,
    squareMeters: Number(plan.requestedAreaSqm || product.squareMeters || 0)
  };
};

export const getContractProductOperationGeometry = (
  product: ContractProduct
): ContractProductOperationGeometry => {
  const optimizerPieces = product.smartCutDerivedQuantity
    ? (product.smartCutPlan?.productionPieces || [])
    : [];

  if (optimizerPieces.length > 0) {
    return {
      totalLengthMeters: optimizerPieces.reduce(
        (total, piece) => total + Number(piece.lengthM || 0) * Math.max(0, Number(piece.quantity) || 0),
        0
      ),
      totalWidthMeters: optimizerPieces.reduce(
        (total, piece) => total + (Number(piece.widthCm || 0) / 100) * Math.max(0, Number(piece.quantity) || 0),
        0
      ),
      squareMeters: Number(product.smartCutPlan?.requestedAreaSqm || product.squareMeters || 0),
      productionPieces: optimizerPieces,
      usesInternalOptimizerGeometry: true
    };
  }

  const quantity = Math.max(1, Number(product.quantity) || 1);
  const lengthMeters = product.lengthUnit === 'cm'
    ? Number(product.length || 0) / 100
    : Number(product.length || 0);
  const widthMeters = product.widthUnit === 'm'
    ? Number(product.width || 0)
    : Number(product.width || 0) / 100;

  return {
    totalLengthMeters: lengthMeters * quantity,
    totalWidthMeters: widthMeters * quantity,
    squareMeters: Number(product.squareMeters || 0),
    productionPieces: [],
    usesInternalOptimizerGeometry: false
  };
};
