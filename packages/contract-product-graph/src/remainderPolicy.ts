import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import {
  calculatePackingPlan,
  calculatePricing,
  type PackedRemainder,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import { packPreservedSourceDistribution } from './preservedSourcePacking';

export interface PaidRemainderStock {
  readonly remainingStoneId: StableIdentity<'remaining-stone'>;
  readonly ownerProductRowId: StableIdentity<'product-row'>;
  readonly catalogProductId: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly creationOrder: number;
  readonly materialPaid: true;
}

export const calculatePaidRemainderFacts = (stock: PaidRemainderStock) => {
  validateStock(stock, 0);
  return {
    widthCentimeters: canonical(decimal(stock.widthMeters).times(100)),
    areaSquareMeters: canonical(
      decimal(stock.lengthMeters).times(stock.widthMeters)
    )
  };
};

export interface RemainderChildIntent {
  /** Witnessed distribution: replay consumption, never repack these sources together. */
  readonly sourcePieceQuantities?: readonly number[];
  readonly secondaryOwnerProductRowId?: StableIdentity<'product-row'>;
  readonly allocationId: StableIdentity<'allocation'>;
  readonly allocationOrder: number;
  readonly childProductRowId: StableIdentity<'product-row'>;
  readonly sourceProductRowId: StableIdentity<'product-row'>;
  readonly selectedRemainingStoneId?: StableIdentity<'remaining-stone'>;
  readonly catalogProductId: string;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly kerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly crossCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
}

export interface RemainderChildPolicyInput {
  readonly sourcePieceQuantities?: readonly number[];
  readonly secondaryOwnerProductRowId?: StableIdentity<'product-row'>;
  readonly allocationId: StableIdentity<'allocation'>;
  readonly sourceProductRowId: StableIdentity<'product-row'>;
  readonly selectedRemainingStoneId?: StableIdentity<'remaining-stone'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
  readonly kerfMeters: CanonicalDecimal;
  readonly calibrationEnabled: boolean;
  readonly longitudinalCutRateToman?: CanonicalDecimal;
  readonly crossCutRateToman?: CanonicalDecimal;
  readonly calibrationCutRateToman?: CanonicalDecimal;
}

export interface CanonicalRemainderAllocation {
  readonly allocationId: StableIdentity<'allocation'>;
  readonly allocationOrder: number;
  readonly sourceProductRowId: StableIdentity<'product-row'>;
  readonly targetProductRowId: StableIdentity<'product-row'>;
  readonly sourceRemainingStoneId: StableIdentity<'remaining-stone'>;
  readonly consumedSourcePieces: number;
  readonly generatedRemainingStoneIds: readonly StableIdentity<'remaining-stone'>[];
  readonly packingPlan: PackingPlan;
  readonly materialAmountToman: CanonicalDecimal;
  readonly materialPricingReason: 'paid-in-source-product';
  readonly cuttingPricingLines: readonly PricedLine[];
  readonly cuttingAmountToman: CanonicalDecimal;
}

export interface RemainderReplayInput {
  readonly policyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly baseInventory: readonly PaidRemainderStock[];
  readonly childIntents: readonly RemainderChildIntent[];
}

export type RemainderReplayConflictCode =
  | 'duplicate-remainder-identity'
  | 'duplicate-allocation-identity'
  | 'explicit-source-required'
  | 'remainder-catalog-mismatch'
  | 'remainder-source-mismatch'
  | 'remainder-cut-rate-missing'
  | 'selected-remainder-missing'
  | 'selected-remainder-insufficient'
  | 'invalid-remainder-input';

export interface RemainderReplayConflict {
  readonly code: RemainderReplayConflictCode;
  readonly path: readonly string[];
  readonly message: string;
  readonly childProductRowId?: StableIdentity<'product-row'>;
  readonly sourceRemainingStoneId?: StableIdentity<'remaining-stone'>;
}

export interface RemainderReplayResult {
  readonly policyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly inventory: readonly PaidRemainderStock[];
  readonly allocations: readonly CanonicalRemainderAllocation[];
}

export type RemainderReplay =
  | { readonly ok: true; readonly result: RemainderReplayResult }
  | { readonly ok: false; readonly conflicts: readonly RemainderReplayConflict[] };

export const parseRemainderChildPolicyInput = (
  value: unknown
): RemainderChildPolicyInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Remainder child policy input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const requiredString = (key: string) => {
    const item = record[key];
    if (typeof item !== 'string') throw new TypeError(`${key} must be a string.`);
    return item;
  };
  const quantity = record.quantity;
  if (typeof quantity !== 'number') throw new TypeError('quantity must be a number.');
  const calibrationEnabled = record.calibrationEnabled;
  if (typeof calibrationEnabled !== 'boolean') {
    throw new TypeError('calibrationEnabled must be boolean.');
  }
  const parsed: RemainderChildPolicyInput = {
    allocationId: parseStableIdentity('allocation', requiredString('allocationId')),
    sourceProductRowId: parseStableIdentity(
      'product-row',
      requiredString('sourceProductRowId')
    ),
    ...(record.selectedRemainingStoneId === undefined ||
      record.selectedRemainingStoneId === null
      ? {}
      : {
          selectedRemainingStoneId: parseStableIdentity(
            'remaining-stone',
            requiredString('selectedRemainingStoneId')
          )
        }),
    ...(record.sourcePieceQuantities === undefined ? {} : {
      sourcePieceQuantities: record.sourcePieceQuantities as readonly number[]
    }),
    ...(record.secondaryOwnerProductRowId === undefined ? {} : {
      secondaryOwnerProductRowId: parseStableIdentity('product-row', requiredString('secondaryOwnerProductRowId'))
    }),
    lengthMeters: parseCanonicalDecimal(requiredString('lengthMeters')),
    widthMeters: parseCanonicalDecimal(requiredString('widthMeters')),
    quantity,
    kerfMeters: parseCanonicalDecimal(requiredString('kerfMeters')),
    calibrationEnabled,
    ...(record.longitudinalCutRateToman === undefined ||
      record.longitudinalCutRateToman === null
      ? {}
      : {
          longitudinalCutRateToman: parseCanonicalDecimal(
            requiredString('longitudinalCutRateToman')
          )
        }),
    ...(record.crossCutRateToman === undefined ||
      record.crossCutRateToman === null
      ? {}
      : {
          crossCutRateToman: parseCanonicalDecimal(
            requiredString('crossCutRateToman')
          )
        }),
    ...(record.calibrationCutRateToman === undefined ||
      record.calibrationCutRateToman === null
      ? {}
      : {
          calibrationCutRateToman: parseCanonicalDecimal(
            requiredString('calibrationCutRateToman')
          )
        })
  };
  validateIntent({
    ...parsed,
    allocationOrder: 0,
    childProductRowId: parseStableIdentity('product-row', 'validation-child'),
    catalogProductId: 'validation-catalog'
  }, 0);
  return parsed;
};

export const materializePaidRemainderStocks = ({
  ownerProductRowId,
  catalogProductId,
  sourceBatchId,
  remainders,
  startingCreationOrder = 0
}: {
  readonly ownerProductRowId: StableIdentity<'product-row'>;
  readonly catalogProductId: string;
  readonly sourceBatchId: StableIdentity<'source-batch'>;
  readonly remainders: readonly PackedRemainder[];
  readonly startingCreationOrder?: number;
}): PaidRemainderStock[] => {
  parseStableIdentity('product-row', ownerProductRowId);
  parseStableIdentity('source-batch', sourceBatchId);
  normalizedText(catalogProductId, 'catalogProductId');
  const grouped = new Map<string, {
    lengthMeters: CanonicalDecimal;
    widthMeters: CanonicalDecimal;
    quantity: number;
  }>();
  remainders.forEach(remainder => {
    if (
      decimal(remainder.lengthMeters).lte(0) ||
      decimal(remainder.widthMeters).lte(0)
    ) return;
    const key = `${remainder.lengthMeters}x${remainder.widthMeters}`;
    const existing = grouped.get(key);
    grouped.set(key, {
      lengthMeters: remainder.lengthMeters,
      widthMeters: remainder.widthMeters,
      quantity: (existing?.quantity ?? 0) + 1
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
        `${ownerProductRowId}:base-remainder:${index + 1}`
      ),
      ownerProductRowId,
      catalogProductId,
      sourceBatchId,
      lengthMeters: remainder.lengthMeters,
      widthMeters: remainder.widthMeters,
      quantity: remainder.quantity,
      creationOrder: startingCreationOrder + index,
      materialPaid: true
    }));
};

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

const validateStock = (stock: PaidRemainderStock, index: number) => {
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

const validateIntent = (intent: RemainderChildIntent, index: number) => {
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

const aggregateSecondaryRemainders = ({
  intent,
  plan,
  sourceBatchId,
  startingCreationOrder
}: {
  intent: RemainderChildIntent;
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

export const replayRemainderAllocations = (
  input: RemainderReplayInput
): RemainderReplay => {
  try {
    normalizedText(input.policyVersion, 'policyVersion');
    normalizedText(input.pricingPolicyVersion, 'pricingPolicyVersion');
    normalizedText(input.roundingPolicyVersion, 'roundingPolicyVersion');
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
    const allocations: CanonicalRemainderAllocation[] = [];
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
      const requiredRates = [
        {
          meters: packed.plan.longitudinalCutMeters,
          rate: intent.longitudinalCutRateToman,
          label: 'longitudinal'
        },
        {
          meters: packed.plan.crossCutMeters,
          rate: intent.crossCutRateToman,
          label: 'cross'
        },
        {
          meters: packed.plan.calibrationMeters,
          rate: intent.calibrationCutRateToman,
          label: 'calibration'
        }
      ];
      const missingRate = requiredRates.find(item =>
        decimal(item.meters).gt(0) && item.rate === undefined
      );
      if (missingRate) {
        replayConflicts.push({
          code: 'remainder-cut-rate-missing',
          path: ['childIntents', String(stableIndex), `${missingRate.label}CutRateToman`],
          message: `${missingRate.label} cutting rate is not registered.`,
          childProductRowId: intent.childProductRowId,
          sourceRemainingStoneId: selected.remainingStoneId
        });
        continue;
      }
      const cutting = calculatePricing({
        policyVersion: input.pricingPolicyVersion,
        roundingPolicyVersion: input.roundingPolicyVersion,
        lines: requiredRates
          .flatMap(item =>
            decimal(item.meters).gt(0) && item.rate !== undefined
              ? [{
                  lineId: `${intent.allocationId}:${item.label}-cut`,
                  quantity: item.meters,
                  rateToman: item.rate
                }]
              : []
          )
      });

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
        packingPlan: packed.plan,
        materialAmountToman: canonical(0),
        materialPricingReason: 'paid-in-source-product',
        cuttingPricingLines: cutting.lines,
        cuttingAmountToman: cutting.totalAmountToman
      });
    }

    if (replayConflicts.length > 0) {
      return { ok: false, conflicts: replayConflicts };
    }

    const resultBase = {
      policyVersion: input.policyVersion,
      inputHash: hashCanonicalValue(input),
      inventory,
      allocations
    };
    return {
      ok: true,
      result: {
        ...resultBase,
        resultHash: hashCanonicalValue(resultBase)
      }
    };
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

export const findRemainderDependents = (
  sourceProductRowId: StableIdentity<'product-row'>,
  childIntents: readonly RemainderChildIntent[]
) => childIntents
  .filter(intent => intent.sourceProductRowId === sourceProductRowId)
  .sort((left, right) =>
    left.allocationOrder - right.allocationOrder ||
    left.childProductRowId.localeCompare(right.childProductRowId)
  );

export const canDeleteRemainderSource = (
  sourceProductRowId: StableIdentity<'product-row'>,
  childIntents: readonly RemainderChildIntent[]
) => findRemainderDependents(sourceProductRowId, childIntents).length === 0;
