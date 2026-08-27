import { replayRemainderGeometry, validateStock, validateIntent } from './remainderGeometry';
export { aggregateSecondaryRemainders } from './remainderGeometry';
import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import {
  calculatePricing,
  type PackedRemainder,
  type PackingPlan,
  type PricedLine
} from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

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

export const replayRemainderAllocations = (input: RemainderReplayInput): RemainderReplay => {
  try {
    normalizedText(input.policyVersion, 'policyVersion');
    normalizedText(input.pricingPolicyVersion, 'pricingPolicyVersion');
    normalizedText(input.roundingPolicyVersion, 'roundingPolicyVersion');
    const geometry = replayRemainderGeometry(input);
    if (!geometry.ok) return { ok: false, conflicts: geometry.conflicts };
    const allocations: CanonicalRemainderAllocation[] = [];
    const replayConflicts: RemainderReplayConflict[] = [];
    for (const allocation of geometry.result.allocations) {
      const stableIndex = input.childIntents.findIndex(intent => intent.allocationId === allocation.allocationId);
      const intent = input.childIntents[stableIndex];
      const selected = { remainingStoneId: allocation.sourceRemainingStoneId };
      const packed = { plan: allocation.packingPlan };
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

      allocations.push({ ...allocation, materialAmountToman: canonical(0),
        materialPricingReason: 'paid-in-source-product', cuttingPricingLines: cutting.lines,
        cuttingAmountToman: cutting.totalAmountToman });
    }
    if (replayConflicts.length) return { ok: false, conflicts: replayConflicts };
    const resultBase = { policyVersion: input.policyVersion, inputHash: hashCanonicalValue(input),
      inventory: geometry.result.inventory, allocations };
    return { ok: true, result: { ...resultBase, resultHash: hashCanonicalValue(resultBase) } };
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
