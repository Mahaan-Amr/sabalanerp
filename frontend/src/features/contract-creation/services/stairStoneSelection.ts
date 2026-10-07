import type { Product, StairPartDraftV2, StairStepperPart } from '../types/contract.types';
import { createFreshStairPartDraft } from '../utils/productConfigurationController';
import { generateFullProductName } from '../utils/productUtils';
import { createStairOperationInput } from './stairCalculationService';

/** A new row owns fresh operations; catalog selection never reuses row data. */
export const createStairDraftForStone = (
  part: StairStepperPart,
  product: Product,
  quantity?: number | null
): StairPartDraftV2 => {
  const label = generateFullProductName(product);
  const draft: StairPartDraftV2 = {
    ...createFreshStairPartDraft(part),
    stoneId: product.id,
    stoneLabel: label,
    contractualTitle: label,
    stoneProduct: product,
    thicknessCm: product.thicknessValue ?? null,
    pricePerSquareMeter: null,
    quantity: quantity ?? null
  };
  return { ...draft, operationPolicyInput: createStairOperationInput(part, draft, product.id) };
};

/** Retained catalog identity and generated defaults are not another row. */
export const hasStairEntryChanges = (
  draft: StairPartDraftV2,
  baseline: StairPartDraftV2
): boolean => {
  const enteredFields = [
    'stoneId', 'contractualTitle', 'lengthValue', 'widthCm', 'quantity',
    'pricePerSquareMeter', 'standardLengthValue', 'description',
    'useMandatory', 'mandatoryPercentage', 'calibrationCutEnabled',
    'calibrationSelection', 'sawKerfEnabled', 'sawKerfCm',
    'numberOfLayersPerStair', 'layerWidthCm', 'layerTypeId', 'layerSourceKind',
    'layerStoneProductId', 'layerPricePerSquareMeter', 'layerDescription',
    'finishingEnabled', 'finishingId', 'layerEdges', 'layerConfigurations',
    'tools', 'layerSelectedRemainingStoneIds', 'layerSideOperations'
  ] as const;
  const normalize = (value: unknown) => value === undefined || value === '' ? null : value;
  return enteredFields.some(field =>
    JSON.stringify(normalize(draft[field])) !== JSON.stringify(normalize(baseline[field]))
  ) || ['tools', 'finishings'].some(field => {
    const key = field as 'tools' | 'finishings';
    return JSON.stringify(draft.operationPolicyInput?.[key] || []) !==
      JSON.stringify(baseline.operationPolicyInput?.[key] || []);
  });
};
