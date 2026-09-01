import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { calculatePackingPlan } from './packingPricing';
import type { PackingPlan } from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import { packPreservedSourceDistribution } from './preservedSourcePacking';
import type { PaidRemainderStock, RemainderChildIntent, CanonicalRemainderAllocation, RemainderReplayConflict } from './remainderPolicy';

export type RemainderTechnicalIntent = Omit<RemainderChildIntent,
  'longitudinalCutRateToman' | 'crossCutRateToman' | 'calibrationCutRateToman'>;
export type RemainderGeometryAllocation = Omit<CanonicalRemainderAllocation,
  'materialAmountToman' | 'materialPricingReason' | 'cuttingPricingLines' | 'cuttingAmountToman'>;
interface RemainderGeometryInput {
  readonly policyVersion: string;
  readonly baseInventory: readonly PaidRemainderStock[];
  readonly childIntents: readonly RemainderTechnicalIntent[];
}
export interface RemainderGeometryResult {
  readonly inventory: readonly PaidRemainderStock[];
  readonly allocations: readonly RemainderGeometryAllocation[];
}
type RemainderGeometryReplay =
  | { readonly ok: true; readonly result: RemainderGeometryResult }
  | { readonly ok: false; readonly conflicts: readonly RemainderReplayConflict[]; readonly result?: RemainderGeometryResult };

const decimal = (value: CanonicalDecimal) => new Decimal(value);
const canonical = (value: Decimal | string | number): CanonicalDecimal =>
  parseCanonicalDecimal(new Decimal(value).toFixed());

const positiveInteger = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
};

const normalizedText = (value: string, label: string) => {
  if (!value || value !== value.trim()) {
    throw new TypeError(`${label} must be a normalized non-empty string.`);
  }
};

const cloneStock = (stock: PaidRemainderStock): PaidRemainderStock => ({ ...stock });

export const validateStock = (stock: PaidRemainderStock, index: number) => {
  parseStableIdentity('remaining-stone', stock.remainingStoneId);
  parseStableIdentity('product-row', stock.ownerProductRowId);
  parseStableIdentity('source-batch', stock.sourceBatchId);
  normalizedText(stock.catalogProductId, `baseInventory.${index}.catalogProductId`);
  if (decimal(stock.lengthMeters).lte(0) || decimal(stock.widthMeters).lte(0)) {
    throw new TypeError(`baseInventory.${index} dimensions must be positive.`);
  }
  positiveInteger(stock.quantity, `baseInventory.${index}.quantity`);
  if (!Number.isSafeInteger(stock.creationOrder) || stock.creationOrder < 0) {
    throw new TypeError(`baseInventory.${index}.creationOrder must be a non-negative integer.`);
  }
  if (stock.materialPaid !== true) {
    throw new TypeError(`baseInventory.${index} must be paid material.`);
  }
};

export const validateIntent = (intent: RemainderTechnicalIntent, index: number) => {
  if (intent.sourcePieceQuantities !== undefined) {
    if (!Array.isArray(intent.sourcePieceQuantities) || !intent.sourcePieceQuantities.length ||
      intent.sourcePieceQuantities.some(q => !Number.isSafeInteger(q) || q <= 0) ||
      intent.sourcePieceQuantities.reduce((sum, q) => sum + q, 0) !== intent.quantity) {
      throw new TypeError('Preserved source distribution must account for every requested piece.');
    }
  }
  if (intent.secondaryOwnerProductRowId !== undefined &&
    intent.secondaryOwnerProductRowId !== intent.sourceProductRowId) {
    throw new TypeError('Preserved secondary inventory must retain the source owner.');
  }
  parseStableIdentity('allocation', intent.allocationId);
  parseStableIdentity('product-row', intent.childProductRowId);
  parseStableIdentity('product-row', intent.sourceProductRowId);
  if (intent.selectedRemainingStoneId !== undefined) {
    parseStableIdentity('remaining-stone', intent.selectedRemainingStoneId);
  }
  normalizedText(intent.catalogProductId, `childIntents.${index}.catalogProductId`);
  positiveInteger(intent.quantity, `childIntents.${index}.quantity`);
  if (decimal(intent.lengthMeters).lte(0) || decimal(intent.widthMeters).lte(0)) {
    throw new TypeError(`childIntents.${index} dimensions must be positive.`);
  }
  if (decimal(intent.kerfMeters).lt(0)) {
    throw new TypeError(`childIntents.${index}.kerfMeters cannot be negative.`);
  }
  if (!Number.isSafeInteger(intent.allocationOrder) || intent.allocationOrder < 0) {
    throw new TypeError(`childIntents.${index}.allocationOrder must be a non-negative integer.`);
  }
  if (!Number.isSafeInteger(1_000_000_000 + intent.allocationOrder * 1000)) {
    throw new TypeError(`childIntents.${index}.allocationOrder is too large.`);
  }
};

const stockSort = (left: PaidRemainderStock, right: PaidRemainderStock) =>
  left.creationOrder - right.creationOrder ||
  left.remainingStoneId.localeCompare(right.remainingStoneId);

export const aggregateSecondaryRemainders = ({
  intent,
  plan,
  sourceBatchId,
  startingCreationOrder
}: {
  intent: RemainderTechnicalIntent;
  plan: PackingPlan;
  sourceBatchId: StableIdentity<'source-batch'>;
  startingCreationOrder: number;
}): PaidRemainderStock[] => {
  const grouped = new Map<string, {
    lengthMeters: CanonicalDecimal;
    widthMeters: CanonicalDecimal;
    quantity: number;
  }>();
  plan.remainders.forEach(remainder => {
    if (
      decimal(remainder.lengthMeters).lte(0) ||
      decimal(remainder.widthMeters).lte(0)
    ) return;
    const key = `${remainder.lengthMeters}x${remainder.widthMeters}`;
    const current = grouped.get(key);
    grouped.set(key, {
      lengthMeters: remainder.lengthMeters,
      widthMeters: remainder.widthMeters,
      quantity: (current?.quantity ?? 0) + 1
    });
  });
  return [...grouped.values()]
    .sort((left, right) =>
      decimal(right.lengthMeters).times(right.widthMeters).comparedTo(
        decimal(left.lengthMeters).times(left.widthMeters)
      ) ||
      left.lengthMeters.localeCompare(right.lengthMeters) ||
      left.widthMeters.localeCompare(right.widthMeters)
    )
    .map((remainder, index) => ({
      remainingStoneId: parseStableIdentity(
        'remaining-stone',
        `${intent.allocationId}:secondary:${index + 1}`
      ),
      ownerProductRowId: intent.secondaryOwnerProductRowId ?? intent.childProductRowId,
      catalogProductId: intent.catalogProductId,
      sourceBatchId,
      lengthMeters: remainder.lengthMeters,
      widthMeters: remainder.widthMeters,
      quantity: remainder.quantity,
      creationOrder: startingCreationOrder + index,
      materialPaid: true
    }));
};

export const replayRemainderGeometry = (
  input: RemainderGeometryInput
): RemainderGeometryReplay => {
  try {
    normalizedText(input.policyVersion, 'policyVersion');
    const stockIds = new Set<string>();
    input.baseInventory.forEach((stock, index) => {
      validateStock(stock, index);
      if (stockIds.has(stock.remainingStoneId)) {
        throw new TypeError(`Duplicate remainder identity: ${stock.remainingStoneId}.`);
      }
      stockIds.add(stock.remainingStoneId);
    });
    const allocationIds = new Set<string>();
    input.childIntents.forEach((intent, index) => {
      validateIntent(intent, index);
      if (allocationIds.has(intent.allocationId)) {
        throw new TypeError(`Duplicate allocation identity: ${intent.allocationId}.`);
      }
      allocationIds.add(intent.allocationId);
    });

    let inventory = input.baseInventory.map(cloneStock).sort(stockSort);
    const allocations: RemainderGeometryAllocation[] = [];
    const replayConflicts: RemainderReplayConflict[] = [];
    const orderedIntents = input.childIntents
      .map((intent, stableIndex) => ({ intent, stableIndex }))
      .sort((left, right) =>
        left.intent.allocationOrder - right.intent.allocationOrder ||
        left.stableIndex - right.stableIndex
      );

    for (const { intent, stableIndex } of orderedIntents) {
      if (!intent.selectedRemainingStoneId) {
        replayConflicts.push({
            code: 'explicit-source-required',
            path: ['childIntents', String(stableIndex), 'selectedRemainingStoneId'],
            message: 'Select a contract remainder explicitly.',
            childProductRowId: intent.childProductRowId
        });
        continue;
      }
      const stockIndex = inventory.findIndex(
        stock => stock.remainingStoneId === intent.selectedRemainingStoneId
      );
      if (stockIndex < 0) {
        replayConflicts.push({
            code: 'selected-remainder-missing',
            path: ['childIntents', String(stableIndex), 'selectedRemainingStoneId'],
            message: 'The selected contract remainder is no longer available.',
            childProductRowId: intent.childProductRowId,
            sourceRemainingStoneId: intent.selectedRemainingStoneId
        });
        continue;
      }
      const selected = inventory[stockIndex];
      if (selected.ownerProductRowId !== intent.sourceProductRowId) {
        replayConflicts.push({
            code: 'remainder-source-mismatch',
            path: ['childIntents', String(stableIndex), 'sourceProductRowId'],
            message: 'The selected remainder does not belong to the explicit source product.',
            childProductRowId: intent.childProductRowId,
            sourceRemainingStoneId: selected.remainingStoneId
        });
        continue;
      }
      if (selected.catalogProductId !== intent.catalogProductId) {
        replayConflicts.push({
            code: 'remainder-catalog-mismatch',
            path: ['childIntents', String(stableIndex), 'catalogProductId'],
            message: 'The selected remainder is not the same catalog stone.',
            childProductRowId: intent.childProductRowId,
            sourceRemainingStoneId: selected.remainingStoneId
        });
        continue;
      }

      const allocationSourceBatchId = parseStableIdentity(
        'source-batch',
        `${intent.allocationId}:selected-source`
      );
      const packingRequest = {
        policyVersion: input.policyVersion,
        kerfMeters: intent.kerfMeters,
        calibrationEnabled: intent.calibrationEnabled,
        sources: [{
          sourceBatchId: allocationSourceBatchId,
          lengthMeters: selected.lengthMeters,
          widthMeters: selected.widthMeters,
          quantity: selected.quantity
        }],
        demands: [{
          demandId: intent.childProductRowId,
          lengthMeters: intent.lengthMeters,
          widthMeters: intent.widthMeters,
          quantity: intent.quantity
        }]
      };
      const packed = intent.sourcePieceQuantities
        ? packPreservedSourceDistribution(packingRequest, intent.sourcePieceQuantities)
        : calculatePackingPlan(packingRequest);
      if (!packed.ok) {
        replayConflicts.push({
            code: 'selected-remainder-insufficient',
            path: ['childIntents', String(stableIndex), 'selectedRemainingStoneId'],
            message: 'The selected remainder does not have enough capacity.',
            childProductRowId: intent.childProductRowId,
            sourceRemainingStoneId: selected.remainingStoneId
        });
        continue;
      }
      const consumedSourcePieces = packed.plan.consumedSources.length;
      const retainedQuantity = selected.quantity - consumedSourcePieces;
      const retained = retainedQuantity > 0
        ? [{ ...selected, quantity: retainedQuantity }]
        : [];
      const secondary = aggregateSecondaryRemainders({
        intent,
        plan: packed.plan,
        sourceBatchId: selected.sourceBatchId,
        startingCreationOrder: 1_000_000_000 + intent.allocationOrder * 1000
      });
      inventory = [
        ...inventory.slice(0, stockIndex),
        ...retained,
        ...secondary,
        ...inventory.slice(stockIndex + 1)
      ].sort(stockSort);
      allocations.push({
        allocationId: intent.allocationId,
        allocationOrder: intent.allocationOrder,
        sourceProductRowId: intent.sourceProductRowId,
        targetProductRowId: intent.childProductRowId,
        sourceRemainingStoneId: selected.remainingStoneId,
        consumedSourcePieces,
        generatedRemainingStoneIds: secondary.map(stock => stock.remainingStoneId),
        packingPlan: packed.plan
      });
    }

    if (replayConflicts.length > 0) {
      return { ok: false, conflicts: replayConflicts, result: { inventory, allocations } };
    }

    return { ok: true, result: { inventory, allocations } };
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        code: error instanceof Error &&
          error.message.startsWith('Duplicate remainder identity')
          ? 'duplicate-remainder-identity'
          : error instanceof Error &&
              error.message.startsWith('Duplicate allocation identity')
            ? 'duplicate-allocation-identity'
            : 'invalid-remainder-input',
        path: [],
        message: error instanceof Error ? error.message : 'Remainder input is invalid.'
      }]
    };
  }
};
