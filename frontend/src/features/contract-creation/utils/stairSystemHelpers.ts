// Stair System Helper Utilities
// Pure functions for stair system operations

import type {
  StairPartDraftV2,
  StairStepperPart,
  ContractProduct
} from '../types/contract.types';

/**
 * Check if a draft has any layer edge selection
 */
export const hasLayerEdgeSelection = (edges?: StairPartDraftV2['layerEdges']): boolean =>
  !!(edges && (edges.front || edges.left || edges.right || edges.back || edges.perimeter));

/**
 * Derive layer edges from tool selections
 * Aggregates edge selections from all tools and applies part-specific rules
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

  // Non-landing parts don't have back/perimeter edges
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
 * Get display label for stair part type (Persian)
 */
export const getPartDisplayLabel = (part: StairStepperPart): string => {
  const labels: Record<StairStepperPart, string> = {
    tread: 'کف پله',
    riser: 'خیز پله',
    landing: 'پاگرد'
  };
  return labels[part] || part;
};

/**
 * Calculate total cutting cost for a contract product
 */
export const getProductCuttingCost = (product: ContractProduct): number => {
  if (product.cuttingBreakdown && product.cuttingBreakdown.length > 0) {
    return product.cuttingBreakdown.reduce((sum, entry) => sum + (entry.cost || 0), 0);
  }
  return product.isCut ? product.cuttingCost || 0 : 0;
};

/**
 * Calculate total service cost (tools + cutting) for a contract product
 */
export const getProductServiceCost = (product: ContractProduct): number => {
  const toolCost = product.totalSubServiceCost || 0;
  const cuttingCost = getProductCuttingCost(product);
  return toolCost + cuttingCost;
};
