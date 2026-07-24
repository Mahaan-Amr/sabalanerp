import {
  parseCanonicalDecimal,
  parseStableIdentity,
  type CanonicalDecimal,
  type SlabCuttingPricingMethod,
  type SlabManualField,
  type SlabPolicyInput,
  type SlabSourceRowInput,
  type StableIdentity
} from '@sabalanerp/contract-product-graph';

export interface SlabDraftDefaults {
  readonly calculationPolicyVersion: string;
  readonly packingPolicyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly kerfMeters: CanonicalDecimal;
}

export const createEmptySlabDraft = (
  defaults: SlabDraftDefaults
): SlabPolicyInput => ({
  ...defaults,
  lengthDisplayUnit: 'm',
  widthDisplayUnit: 'm',
  sourceRows: [],
  cuttingPricingMethod: 'lineBased',
  verticalCutSides: []
});

export const createSlabSourceRow = ({
  sourceRowId,
  lengthDisplayUnit = 'm',
  widthDisplayUnit = 'm'
}: {
  sourceRowId: StableIdentity<'slab-source-row'> | string;
  lengthDisplayUnit?: 'cm' | 'm';
  widthDisplayUnit?: 'cm' | 'm';
}): SlabSourceRowInput => ({
  sourceRowId: parseStableIdentity('slab-source-row', sourceRowId),
  lengthMeters: parseCanonicalDecimal('0'),
  widthMeters: parseCanonicalDecimal('0'),
  lengthDisplayUnit,
  widthDisplayUnit,
  quantity: 0
});

export const replaceSlabSourceRow = (
  rows: readonly SlabSourceRowInput[],
  sourceRowId: StableIdentity<'slab-source-row'>,
  update: (row: SlabSourceRowInput) => SlabSourceRowInput
): readonly SlabSourceRowInput[] => rows.map(row =>
  row.sourceRowId === sourceRowId ? update(row) : row
);

export const removeSlabSourceRow = (
  rows: readonly SlabSourceRowInput[],
  sourceRowId: StableIdentity<'slab-source-row'>
): readonly SlabSourceRowInput[] =>
  rows.filter(row => row.sourceRowId !== sourceRowId);

export const commitSlabDecimal = (
  input: SlabPolicyInput,
  field: 'lengthMeters' | 'widthMeters' | 'areaSquareMeters' | 'baseMaterialRateToman' | 'squareMeterCutRateToman',
  rawValue: string,
  manualField?: SlabManualField
): SlabPolicyInput => {
  const value = rawValue.trim() === ''
    ? undefined
    : parseCanonicalDecimal(rawValue);
  return {
    ...input,
    [field]: value,
    ...(manualField
      ? {
          lastManualField: manualField,
          ...(manualField === 'length' || manualField === 'width'
            ? { lastManualDimension: manualField }
            : {})
        }
      : {})
  };
};

export const setSlabCuttingPricingMethod = (
  input: SlabPolicyInput,
  cuttingPricingMethod: SlabCuttingPricingMethod
): SlabPolicyInput => ({
  ...input,
  cuttingPricingMethod
});

export type SlabValidationTarget =
  | 'geometry'
  | 'quantity'
  | 'baseMaterialRateToman'
  | 'sourceRows'
  | 'squareMeterCutRateToman'
  | undefined;

export const firstSlabValidationTarget = (
  input: SlabPolicyInput
): SlabValidationTarget => {
  const positive = (value?: CanonicalDecimal) =>
    value !== undefined && Number(value) > 0;
  const resolvedDimensions =
    (positive(input.lengthMeters) && positive(input.widthMeters)) ||
    (positive(input.lengthMeters) && positive(input.areaSquareMeters)) ||
    (positive(input.widthMeters) && positive(input.areaSquareMeters));
  if (!resolvedDimensions) return 'geometry';
  if (!Number.isSafeInteger(input.quantity) || Number(input.quantity) <= 0) {
    return 'quantity';
  }
  if (!positive(input.baseMaterialRateToman)) return 'baseMaterialRateToman';
  if (input.sourceRows.length === 0) return 'sourceRows';
  if (
    input.cuttingPricingMethod === 'squareMeter' &&
    !positive(input.squareMeterCutRateToman)
  ) {
    return 'squareMeterCutRateToman';
  }
  return undefined;
};

