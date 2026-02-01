// Stair-specific utility functions
// Helper functions for stair calculations and operations

import type { StairStepperPart, StairPartDraftV2 } from '../types/contract.types';
import { toMeters, convertMetersToUnit, hasLengthMeasurement } from './dimensionUtils';

/**
 * Get display label for stair part
 */
export const getPartDisplayLabel = (part: StairStepperPart): string => {
  if (part === 'tread') return 'کف پله';
  if (part === 'riser') return 'خیز پله';
  return 'پاگرد';
};

/**
 * Check if layer edges are selected
 */
export const hasLayerEdgeSelection = (edges?: StairPartDraftV2['layerEdges']): boolean =>
  !!(edges && (edges.front || edges.left || edges.right || edges.back || edges.perimeter));

/**
 * Derive layer edges from tool selections
 */
export const deriveLayerEdgesFromTools = (
  draft: StairPartDraftV2,
  part: StairStepperPart
): StairPartDraftV2 => {
  if (!draft.tools || draft.tools.length === 0) return draft;

  const aggregated = draft.tools.reduce(
    (acc, tool) => ({
      front: acc.front || !!tool.front,
      left: acc.left || !!tool.left,
      right: acc.right || !!tool.right,
      back: acc.back || !!tool.back,
      perimeter: acc.perimeter || !!tool.perimeter
    }),
    { front: false, left: false, right: false, back: false, perimeter: false }
  );

  if (part !== 'landing') {
    aggregated.back = false;
    aggregated.perimeter = false;
  }

  const hasEdges =
    aggregated.front || aggregated.left || aggregated.right || aggregated.back || aggregated.perimeter;

  if (!hasEdges) return draft;

  const layerEdges = aggregated.perimeter
    ? { front: false, left: false, right: false, back: false, perimeter: true }
    : {
        front: aggregated.front,
        left: aggregated.left,
        right: aggregated.right,
        back: part === 'landing' ? aggregated.back : false,
        perimeter: false
      };

  return { ...draft, layerEdges };
};

/**
 * Get draft standard length in meters
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
 * Get actual length in meters (manual or standard)
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
 * Get pricing length in meters (prefers standard, falls back to actual)
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

/**
 * Check if draft has length measurement
 */
export { hasLengthMeasurement };

/**
 * Convert meters to unit for display
 */
export { convertMetersToUnit };

