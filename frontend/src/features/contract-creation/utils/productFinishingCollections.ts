import type { AppliedProductFinishing, ContractProduct } from '../types/contract.types';
import { normalizeProductFinishing } from './finishingUtils';

export const normalizeProductFinishingCollection = (product: ContractProduct): AppliedProductFinishing[] => {
  if (Array.isArray(product.finishings)) return product.finishings;
  const legacy = normalizeProductFinishing(product);
  if (!legacy?.id) return [];
  return [{
    selectionId: `legacy-${legacy.id}`,
    finishingId: legacy.id,
    code: legacy.code,
    name: legacy.name || '',
    calculationBase: legacy.calculationBase,
    unitPrice: legacy.unitPrice,
    automaticQuantity: legacy.quantity,
    quantity: legacy.quantity,
    quantityMode: 'auto',
    overrideStatus: 'current',
    cost: legacy.cost
  }];
};

export const refreshFinishingAutomaticQuantity = (
  selection: AppliedProductFinishing,
  automaticQuantity: number
): AppliedProductFinishing => {
  const safeAutomatic = Math.max(0, automaticQuantity);
  if (selection.quantityMode === 'auto') {
    return {
      ...selection,
      automaticQuantity: safeAutomatic,
      quantity: safeAutomatic,
      cost: safeAutomatic * selection.unitPrice,
      overrideStatus: 'current'
    };
  }
  return {
    ...selection,
    automaticQuantity: safeAutomatic,
    overrideStatus: Math.abs(selection.quantity - safeAutomatic) > 0.000001
      ? 'requiresConfirmation'
      : 'current'
  };
};

export const changeFinishingCatalogItem = (
  previous: AppliedProductFinishing,
  next: Pick<AppliedProductFinishing, 'finishingId' | 'code' | 'name' | 'calculationBase' | 'unitPrice'>,
  automaticQuantity: number
): AppliedProductFinishing => ({
  ...previous,
  ...next,
  selectionId: `${next.finishingId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  automaticQuantity,
  quantity: automaticQuantity,
  quantityMode: 'auto',
  overrideStatus: 'current',
  cost: automaticQuantity * next.unitPrice
});

export const confirmFinishingManualQuantity = (
  selection: AppliedProductFinishing
): AppliedProductFinishing => ({ ...selection, overrideStatus: 'confirmed' });

export const resetFinishingToAutomaticQuantity = (
  selection: AppliedProductFinishing
): AppliedProductFinishing => ({
  ...selection,
  quantity: selection.automaticQuantity,
  quantityMode: 'auto',
  overrideStatus: 'current',
  cost: selection.automaticQuantity * selection.unitPrice
});

export const hasUnconfirmedProductQuantityOverride = (product: ContractProduct): boolean =>
  normalizeProductFinishingCollection(product).some((selection) =>
    selection.quantityMode === 'manual' && selection.overrideStatus === 'requiresConfirmation'
  ) || (product.appliedSubServices || []).some((service) =>
    (service as any)?.quantityMode === 'manual' && (service as any)?.overrideStatus === 'requiresConfirmation'
  );

export const getFinishingCompatibilityConflicts = (
  selections: AppliedProductFinishing[],
  incompatibleByFinishingId: Record<string, string[]>
): Array<[string, string]> => {
  const selectedIds = new Set(selections.map((selection) => selection.finishingId));
  const conflicts: Array<[string, string]> = [];
  selections.forEach((selection) => {
    (incompatibleByFinishingId[selection.finishingId] || []).forEach((otherId) => {
      if (selectedIds.has(otherId) && selection.finishingId < otherId) {
        conflicts.push([selection.finishingId, otherId]);
      }
    });
  });
  return conflicts;
};
