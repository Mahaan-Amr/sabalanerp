import type { StairPartDraftV2, UnitType } from '../types/contract.types';

/**
 * Convert meters to specified unit (m or cm)
 */
export const convertMetersToUnit = (value: number, unit: UnitType): number => {
  if (!value || value <= 0) return 0;
  return unit === 'm' ? value : value * 100;
};

/**
 * Convert value from unit to meters
 */
export const toMeters = (value: number, unit: UnitType): number => {
  if (!value || value <= 0) return 0;
  return unit === 'm' ? value : value / 100;
};

/**
 * Get standard length in meters from draft
 */
export const getDraftStandardLengthMeters = (draft: StairPartDraftV2): number => {
  const value = draft.standardLengthValue;
  if (value && value > 0) {
    const unit = draft.standardLengthUnit || draft.lengthUnit || 'm';
    return toMeters(value, unit);
  }
  return 0;
};

/**
 * Get actual length in meters (manual length or standard length fallback)
 */
export const getActualLengthMeters = (draft: StairPartDraftV2): number => {
  const manualLength = toMeters(draft.lengthValue || 0, draft.lengthUnit || 'cm');
  if (manualLength > 0) {
    return manualLength;
  }
  const standardLength = getDraftStandardLengthMeters(draft);
  return standardLength > 0 ? standardLength : 0;
};

/**
 * Get pricing length in meters (standard length for pricing if set, otherwise actual length)
 */
export const getPricingLengthMeters = (draft: StairPartDraftV2): number => {
  const standardLength = getDraftStandardLengthMeters(draft);
  const actualLength = getActualLengthMeters(draft);
  if (standardLength > 0) {
    if (actualLength > 0 && Math.abs(standardLength - actualLength) < 0.000001) {
      return actualLength;
    }
    return standardLength;
  }
  return actualLength;
};
