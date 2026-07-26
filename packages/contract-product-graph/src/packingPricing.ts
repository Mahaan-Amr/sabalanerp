import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

type SourceBatchId = StableIdentity<'source-batch'>;
type RemainingStoneId = StableIdentity<'remaining-stone'>;

export interface PackingSourceBatch {
  readonly sourceBatchId: SourceBatchId;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
  /**
   * Lower values are consumed first when differently priced source classes
   * participate in one exact plan. Ordinary callers omit this and retain the
   * historical geometry-only objective.
   */
  readonly allocationPriority?: number;
}

export interface PackingDemand {
  readonly demandId: string;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity: number;
}

export interface PackingRequest {
  readonly policyVersion: string;
  readonly kerfMeters: CanonicalDecimal;
  readonly calibrationEnabled?: boolean;
  readonly sources: readonly PackingSourceBatch[];
  readonly demands: readonly PackingDemand[];
}

export interface PackedPlacement {
  readonly demandId: string;
  readonly demandOrdinal: number;
  readonly sourceBatchId: SourceBatchId;
  readonly sourceOrdinal: number;
  readonly xMeters: CanonicalDecimal;
  readonly yMeters: CanonicalDecimal;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
}

export interface PhysicalCut {
  readonly cutId: string;
  readonly sequence: number;
  readonly axis: 'longitudinal' | 'cross';
  readonly sourceBatchId: SourceBatchId;
  readonly sourceOrdinal: number;
  readonly positionMeters: CanonicalDecimal;
  readonly spanStartMeters: CanonicalDecimal;
  readonly meters: CanonicalDecimal;
  readonly kerfMeters: CanonicalDecimal;
}

export interface PackedRemainder {
  readonly remainingStoneId: RemainingStoneId;
  readonly sourceBatchId: SourceBatchId;
  readonly sourceOrdinal: number;
  readonly xMeters: CanonicalDecimal;
  readonly yMeters: CanonicalDecimal;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
}

export interface PackingPlan {
  readonly policyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly consumedSources: readonly { sourceBatchId: SourceBatchId; sourceOrdinal: number }[];
  readonly unusedSources: readonly { sourceBatchId: SourceBatchId; quantity: number }[];
  readonly placements: readonly PackedPlacement[];
  readonly cuts: readonly PhysicalCut[];
  readonly longitudinalCutMeters: CanonicalDecimal;
  readonly crossCutMeters: CanonicalDecimal;
  readonly calibrationMeters: CanonicalDecimal;
  readonly kerfWasteSquareMeters: CanonicalDecimal;
  readonly remainders: readonly PackedRemainder[];
}

export type PackingResult =
  | { readonly ok: true; readonly plan: PackingPlan }
  | {
      readonly ok: false;
      readonly conflict: {
        readonly code: 'insufficient-source-capacity' | 'invalid-packing-input';
        readonly message: string;
      };
    };

interface Rect { x: Decimal; y: Decimal; length: Decimal; width: Decimal }
interface SourcePiece {
  batchId: SourceBatchId;
  ordinal: number;
  allocationPriority: number;
  free: Rect[];
  used: boolean;
  cutCount: number;
}
interface DemandPiece { id: string; ordinal: number; length: Decimal; width: Decimal }
interface SearchState {
  sources: SourcePiece[];
  placements: Array<PackedPlacement>;
  cuts: Array<PhysicalCut>;
  cutTotal: Decimal;
}

const d = (value: CanonicalDecimal | string) => new Decimal(value);
const canonical = (value: Decimal): CanonicalDecimal => parseCanonicalDecimal(value.toFixed());
const inputDecimal = (value: unknown, path: string): Decimal => {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a canonical decimal string.`);
  const parsed = parseCanonicalDecimal(value);
  if (parsed !== value) throw new TypeError(`${path} must be normalized.`);
  return d(parsed);
};
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;
const policyVersion = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new TypeError(`${path} must be a normalized non-empty string.`);
  }
  return value;
};
const rectOrder = (left: Rect, right: Rect) =>
  left.y.comparedTo(right.y) || left.x.comparedTo(right.x) ||
  left.width.comparedTo(right.width) || left.length.comparedTo(right.length);
const rectSignature = (rect: Rect) =>
  [rect.x, rect.y, rect.width, rect.length].map(value => value.toFixed()).join(',');

const splitRect = (
  rect: Rect,
  piece: DemandPiece,
  kerf: Decimal,
  order: 'width-first' | 'length-first'
): {
  free: Rect[];
  cuts: Array<{
    axis: 'longitudinal' | 'cross';
    meters: Decimal;
    position: Decimal;
    spanStart: Decimal;
  }>;
} | null => {
  if (piece.width.gt(rect.width) || piece.length.gt(rect.length)) return null;
  const rawWidth = rect.width.minus(piece.width);
  const rawLength = rect.length.minus(piece.length);
  const widthRemainder = rawWidth.gt(0) ? rawWidth.minus(kerf) : rawWidth;
  const lengthRemainder = rawLength.gt(0) ? rawLength.minus(kerf) : rawLength;
  if (widthRemainder.lt(0) || lengthRemainder.lt(0)) return null;
  const free: Rect[] = [];
  const cuts: Array<{
    axis: 'longitudinal' | 'cross';
    meters: Decimal;
    position: Decimal;
    spanStart: Decimal;
  }> = [];

  if (order === 'width-first') {
    if (rawWidth.gt(0)) {
      cuts.push({
        axis: 'longitudinal',
        meters: rect.length,
        position: rect.x.plus(piece.width),
        spanStart: rect.y
      });
      if (widthRemainder.gt(0)) free.push({
        x: rect.x.plus(piece.width).plus(kerf), y: rect.y,
        width: widthRemainder, length: rect.length
      });
    }
    if (rawLength.gt(0)) {
      cuts.push({
        axis: 'cross',
        meters: piece.width,
        position: rect.y.plus(piece.length),
        spanStart: rect.x
      });
      if (lengthRemainder.gt(0)) free.push({
        x: rect.x, y: rect.y.plus(piece.length).plus(kerf),
        width: piece.width, length: lengthRemainder
      });
    }
  } else {
    if (rawLength.gt(0)) {
      cuts.push({
        axis: 'cross',
        meters: rect.width,
        position: rect.y.plus(piece.length),
        spanStart: rect.x
      });
      if (lengthRemainder.gt(0)) free.push({
        x: rect.x, y: rect.y.plus(piece.length).plus(kerf),
        width: rect.width, length: lengthRemainder
      });
    }
    if (rawWidth.gt(0)) {
      cuts.push({
        axis: 'longitudinal',
        meters: piece.length,
        position: rect.x.plus(piece.width),
        spanStart: rect.y
      });
      if (widthRemainder.gt(0)) free.push({
        x: rect.x.plus(piece.width).plus(kerf), y: rect.y,
        width: widthRemainder, length: piece.length
      });
    }
  }
  return { free: free.sort(rectOrder), cuts };
};

const objective = (
  state: SearchState
): [number, Decimal, number, Decimal, number, Decimal, string] => {
  const used = state.sources.filter(source => source.used);
  const nonPreferredUsed = used.filter(
    source => source.allocationPriority > 0
  ).length;
  const sourceByIdentity = new Map(
    state.sources.map(source => [
      `${source.batchId}:${source.ordinal}`,
      source
    ])
  );
  const preferredPlacementArea = state.placements.reduce((sum, placement) => {
    const source = sourceByIdentity.get(
      `${placement.sourceBatchId}:${placement.sourceOrdinal}`
    );
    return source?.allocationPriority === 0
      ? sum.plus(d(placement.lengthMeters).times(placement.widthMeters))
      : sum;
  }, d('0'));
  const cutMeters = state.cutTotal;
  const remainders = used.flatMap(source => source.free);
  const largest = remainders.reduce(
    (max, rect) => Decimal.max(max, rect.length.times(rect.width)), new Decimal(0)
  );
  const signature = used.map(source =>
    `${source.batchId}:${source.ordinal}:${source.free.map(rectSignature).join(';')}`
  ).join('|');
  const consumedOrder = state.sources.flatMap((source, index) =>
    source.used ? [String(index).padStart(8, '0')] : []
  ).join(',');
  return [
    nonPreferredUsed,
    preferredPlacementArea.negated(),
    used.length,
    cutMeters,
    remainders.length,
    largest.negated(),
    `${consumedOrder}|${signature}`
  ];
};

const better = (left: ReturnType<typeof objective>, right?: ReturnType<typeof objective>) => {
  if (!right) return true;
  if (left[0] !== right[0]) return left[0] < right[0];
  const preferredAreaComparison = left[1].comparedTo(right[1]);
  if (preferredAreaComparison !== 0) return preferredAreaComparison < 0;
  if (left[2] !== right[2]) return left[2] < right[2];
  const cutComparison = left[3].comparedTo(right[3]);
  if (cutComparison !== 0) return cutComparison < 0;
  if (left[4] !== right[4]) return left[4] < right[4];
  const largestComparison = left[5].comparedTo(right[5]);
  if (largestComparison !== 0) return largestComparison < 0;
  return left[6] < right[6];
};

const searchBestPackingState = ({
  sources,
  pieces,
  kerf
}: {
  sources: SourcePiece[];
  pieces: DemandPiece[];
  kerf: Decimal;
}): SearchState | undefined => {
  let bestState: SearchState | undefined;
  let bestObjective: ReturnType<typeof objective> | undefined;
  const memo = new Map<string, Decimal>();
  const visit = (pieceIndex: number, state: SearchState): void => {
    const nonPreferredUsed = state.sources.filter(
      source => source.used && source.allocationPriority > 0
    ).length;
    if (bestObjective && nonPreferredUsed > bestObjective[0]) return;
    if (pieceIndex === pieces.length) {
      const candidate = objective(state);
      if (better(candidate, bestObjective)) {
        bestState = state;
        bestObjective = candidate;
      }
      return;
    }
    const piece = pieces[pieceIndex];
    const stateKey = `${pieceIndex}|${state.sources.map(source =>
      `${source.used ? 1 : 0}:${source.free.map(rectSignature).sort().join(';')}`
    ).join('|')}`;
    const currentCuts = state.cutTotal;
    const knownCuts = memo.get(stateKey);
    if (knownCuts && knownCuts.lte(currentCuts)) return;
    memo.set(stateKey, currentCuts);

    const emitted = new Set<string>();
    state.sources.forEach((source, sourceIndex) => {
      const candidateRectIndexes = source.free.map((_, index) => index);
      candidateRectIndexes.forEach(rectIndex => {
        const rect = source.free[rectIndex];
        (['width-first', 'length-first'] as const).forEach(splitOrder => {
          const split = splitRect(rect, piece, kerf, splitOrder);
          if (!split) return;
          /*
           * Sources with the same used/free geometry are interchangeable for
           * the remaining search. Exploring the same placement against every
           * identical source creates factorial branches for repeated stair
           * pieces. Iteration order already represents the stable source
           * tie-break, so retain only the first equivalent transition.
           */
          const sourceShape = `${source.allocationPriority}:${
            source.used ? 1 : 0
          }:${
            source.free.map(rectSignature).sort().join(';')
          }`;
          const optionKey = `${sourceShape}:${rectSignature(rect)}:${
            split.free.map(rectSignature).join(';')
          }`;
          if (emitted.has(optionKey)) return;
          emitted.add(optionKey);
          const nextSources = state.sources.map((item, index) => index === sourceIndex ? {
            ...item,
            used: true,
            cutCount: item.cutCount + split.cuts.length,
            free: [...item.free.slice(0, rectIndex), ...item.free.slice(rectIndex + 1), ...split.free].sort(rectOrder)
          } : { ...item, free: [...item.free] });
          const placement: PackedPlacement = {
            demandId: piece.id,
            demandOrdinal: piece.ordinal,
            sourceBatchId: source.batchId,
            sourceOrdinal: source.ordinal,
            xMeters: canonical(rect.x), yMeters: canonical(rect.y),
            lengthMeters: canonical(piece.length), widthMeters: canonical(piece.width)
          };
          const cuts = split.cuts.map((cut, cutIndex): PhysicalCut => {
            const sequence = source.cutCount + cutIndex + 1;
            return {
              cutId: `${source.batchId}:${source.ordinal}:cut:${sequence}`,
              sequence,
              axis: cut.axis,
              sourceBatchId: source.batchId,
              sourceOrdinal: source.ordinal,
              positionMeters: canonical(cut.position),
              spanStartMeters: canonical(cut.spanStart),
              meters: canonical(cut.meters),
              kerfMeters: canonical(kerf)
            };
          });
          visit(pieceIndex + 1, {
            sources: nextSources,
            placements: [...state.placements, placement],
            cuts: [...state.cuts, ...cuts],
            cutTotal: state.cutTotal.plus(
              split.cuts.reduce((sum, cut) => sum.plus(cut.meters), d('0'))
            )
          });
        });
      });
    });
  };
  visit(0, { sources, placements: [], cuts: [], cutTotal: d('0') });
  return bestState;
};

const uniformAxisCapacity = (
  sourceSize: Decimal,
  pieceSize: Decimal,
  kerf: Decimal
) => {
  const upperBound = Math.floor(
    sourceSize.plus(kerf).div(pieceSize.plus(kerf)).toNumber()
  );
  for (let count = upperBound; count > 0; count -= 1) {
    const remainder = sourceSize
      .minus(pieceSize.times(count))
      .minus(kerf.times(Math.max(0, count - 1)));
    if (remainder.eq(0) || remainder.gte(kerf)) return count;
  }
  return 0;
};

const calculateUniformGridState = ({
  sources,
  pieces,
  kerf
}: {
  sources: SourcePiece[];
  pieces: DemandPiece[];
  kerf: Decimal;
}): SearchState | undefined => {
  const firstSourceRect = sources[0]?.free[0];
  const firstPiece = pieces[0];
  if (!firstSourceRect || !firstPiece ||
      sources.some(source =>
        source.free.length !== 1 ||
        !source.free[0].length.eq(firstSourceRect.length) ||
        !source.free[0].width.eq(firstSourceRect.width)
      ) ||
      pieces.some(piece =>
        !piece.length.eq(firstPiece.length) ||
        !piece.width.eq(firstPiece.width)
      )) {
    return undefined;
  }

  const capacity =
    uniformAxisCapacity(firstSourceRect.length, firstPiece.length, kerf) *
    uniformAxisCapacity(firstSourceRect.width, firstPiece.width, kerf);
  /*
   * Single-source exact searches stay small for normal stair geometry. Larger
   * grids already use the strip fast path or fall back to the general search.
   */
  if (capacity <= 0 || capacity > 12) return undefined;
  const sourceCount = Math.ceil(pieces.length / capacity);
  if (sourceCount > sources.length) return undefined;

  const patterns = new Map<number, {
    state: SearchState;
    remainderCount: number;
    largestRemainder: Decimal;
    signature: string;
  }>();
  for (let count = 1; count <= Math.min(capacity, pieces.length); count += 1) {
    const templateSource: SourcePiece = {
      ...sources[0],
      free: sources[0].free.map(rect => ({ ...rect })),
      used: false,
      cutCount: 0
    };
    const state = searchBestPackingState({
      sources: [templateSource],
      pieces: pieces.slice(0, count),
      kerf
    });
    if (!state) continue;
    const remainders = state.sources.flatMap(source => source.free);
    patterns.set(count, {
      state,
      remainderCount: remainders.length,
      largestRemainder: remainders.reduce(
        (largest, rect) =>
          Decimal.max(largest, rect.length.times(rect.width)),
        d('0')
      ),
      signature: state.sources
        .flatMap(source => source.free.map(rectSignature))
        .join(';')
    });
  }

  interface Distribution {
    readonly counts: readonly number[];
    readonly cutTotal: Decimal;
    readonly remainderCount: number;
    readonly largestRemainder: Decimal;
    readonly signature: string;
  }
  const betterDistribution = (
    left: Distribution,
    right?: Distribution
  ) => {
    if (!right) return true;
    const cutComparison = left.cutTotal.comparedTo(right.cutTotal);
    if (cutComparison !== 0) return cutComparison < 0;
    if (left.remainderCount !== right.remainderCount) {
      return left.remainderCount < right.remainderCount;
    }
    const largestComparison =
      left.largestRemainder.comparedTo(right.largestRemainder);
    if (largestComparison !== 0) return largestComparison > 0;
    return left.signature < right.signature;
  };
  const memo = new Map<string, Distribution | null>();
  const distribute = (
    sourceIndex: number,
    remaining: number
  ): Distribution | undefined => {
    if (sourceIndex === sourceCount) {
      return remaining === 0
        ? {
            counts: [],
            cutTotal: d('0'),
            remainderCount: 0,
            largestRemainder: d('0'),
            signature: ''
          }
        : undefined;
    }
    const key = `${sourceIndex}:${remaining}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const sourcesAfterThis = sourceCount - sourceIndex - 1;
    const minimum = Math.max(1, remaining - sourcesAfterThis * capacity);
    const maximum = Math.min(capacity, remaining - sourcesAfterThis);
    let best: Distribution | undefined;
    for (let count = maximum; count >= minimum; count -= 1) {
      const pattern = patterns.get(count);
      const rest = distribute(sourceIndex + 1, remaining - count);
      if (!pattern || !rest) continue;
      const candidate: Distribution = {
        counts: [count, ...rest.counts],
        cutTotal: pattern.state.cutTotal.plus(rest.cutTotal),
        remainderCount: pattern.remainderCount + rest.remainderCount,
        largestRemainder: Decimal.max(
          pattern.largestRemainder,
          rest.largestRemainder
        ),
        signature: `${
          String(capacity - count).padStart(8, '0')
        }:${pattern.signature}|${rest.signature}`
      };
      if (betterDistribution(candidate, best)) best = candidate;
    }
    memo.set(key, best ?? null);
    return best;
  };

  const distribution = distribute(0, pieces.length);
  if (!distribution) return undefined;
  const packedSources: SourcePiece[] = [];
  const placements: PackedPlacement[] = [];
  const cuts: PhysicalCut[] = [];
  let pieceOffset = 0;
  let cutTotal = d('0');
  distribution.counts.forEach((count, sourceIndex) => {
    const source: SourcePiece = {
      ...sources[sourceIndex],
      free: sources[sourceIndex].free.map(rect => ({ ...rect })),
      used: false,
      cutCount: 0
    };
    const state = searchBestPackingState({
      sources: [source],
      pieces: pieces.slice(pieceOffset, pieceOffset + count),
      kerf
    });
    if (!state) return;
    packedSources.push(...state.sources);
    placements.push(...state.placements);
    cuts.push(...state.cuts);
    cutTotal = cutTotal.plus(state.cutTotal);
    pieceOffset += count;
  });
  if (pieceOffset !== pieces.length) return undefined;
  return { sources: packedSources, placements, cuts, cutTotal };
};

const calculateUniformStripPlan = ({
  request,
  sources,
  pieces,
  kerf
}: {
  request: PackingRequest;
  sources: SourcePiece[];
  pieces: DemandPiece[];
  kerf: Decimal;
}): PackingPlan | null => {
  if (sources.length === 0 || pieces.length === 0) return null;
  const sourceLength = sources[0].free[0]?.length;
  const sourceWidth = sources[0].free[0]?.width;
  const pieceLength = pieces[0].length;
  const pieceWidth = pieces[0].width;
  if (!sourceLength || !sourceWidth ||
      sources.some(source =>
        !source.free[0]?.length.eq(sourceLength) ||
        !source.free[0]?.width.eq(sourceWidth)
      ) ||
      pieces.some(piece => !piece.length.eq(pieceLength) || !piece.width.eq(pieceWidth)) ||
      !pieceLength.eq(sourceLength)) {
    return null;
  }

  const mutable = sources.map(source => ({
    ...source,
    nextX: new Decimal(0),
    remainingWidth: sourceWidth,
    placements: 0
  }));
  const placements: PackedPlacement[] = [];
  const cuts: PhysicalCut[] = [];
  for (const piece of pieces) {
    const target = mutable.find(source => {
      if (source.remainingWidth.lt(pieceWidth)) return false;
      const rawRemainder = source.remainingWidth.minus(pieceWidth);
      return rawRemainder.eq(0) || rawRemainder.gte(kerf);
    });
    if (!target) return null;
    placements.push({
      demandId: piece.id,
      demandOrdinal: piece.ordinal,
      sourceBatchId: target.batchId,
      sourceOrdinal: target.ordinal,
      xMeters: canonical(target.nextX),
      yMeters: canonical(new Decimal(0)),
      lengthMeters: canonical(pieceLength),
      widthMeters: canonical(pieceWidth)
    });
    const rawRemainder = target.remainingWidth.minus(pieceWidth);
    target.used = true;
    target.placements += 1;
    if (rawRemainder.gt(0)) {
      const sequence = target.cutCount + 1;
      cuts.push({
        cutId: `${target.batchId}:${target.ordinal}:cut:${sequence}`,
        sequence,
        axis: 'longitudinal',
        sourceBatchId: target.batchId,
        sourceOrdinal: target.ordinal,
        positionMeters: canonical(target.nextX.plus(pieceWidth)),
        spanStartMeters: canonical(new Decimal(0)),
        meters: canonical(sourceLength),
        kerfMeters: canonical(kerf)
      });
      target.cutCount = sequence;
      target.nextX = target.nextX.plus(pieceWidth).plus(kerf);
      target.remainingWidth = rawRemainder.minus(kerf);
    } else {
      target.nextX = target.nextX.plus(pieceWidth);
      target.remainingWidth = new Decimal(0);
    }
  }

  const consumed = mutable.filter(source => source.used);
  const remainders = consumed.flatMap(source =>
    source.remainingWidth.gt(0)
      ? [{
          remainingStoneId: parseStableIdentity(
            'remaining-stone',
            `${source.batchId}:${source.ordinal}:remainder:1`
          ),
          sourceBatchId: source.batchId,
          sourceOrdinal: source.ordinal,
          xMeters: canonical(source.nextX),
          yMeters: canonical(new Decimal(0)),
          lengthMeters: canonical(sourceLength),
          widthMeters: canonical(source.remainingWidth)
        }]
      : []
  );
  const longitudinalCutMeters = cuts.reduce(
    (sum, cut) => sum.plus(cut.meters),
    new Decimal(0)
  );
  const unusedSources = request.sources.map(source => ({
    sourceBatchId: source.sourceBatchId,
    quantity: source.quantity -
      consumed.filter(item => item.batchId === source.sourceBatchId).length
  })).filter(source => source.quantity > 0);
  const planBase = {
    policyVersion: request.policyVersion,
    inputHash: hashCanonicalValue(request),
    consumedSources: consumed.map(source => ({
      sourceBatchId: source.batchId,
      sourceOrdinal: source.ordinal
    })),
    unusedSources,
    placements,
    cuts,
    longitudinalCutMeters: canonical(longitudinalCutMeters),
    crossCutMeters: canonical(new Decimal(0)),
    calibrationMeters: canonical(
      request.calibrationEnabled ? longitudinalCutMeters : new Decimal(0)
    ),
    kerfWasteSquareMeters: canonical(longitudinalCutMeters.times(kerf)),
    remainders
  };
  return { ...planBase, resultHash: hashCanonicalValue(planBase) };
};

export const calculatePackingPlan = (request: PackingRequest): PackingResult => {
  try {
    policyVersion(request.policyVersion, 'policyVersion');
    const kerf = inputDecimal(request.kerfMeters, 'kerfMeters');
    if (kerf.lt(0)) throw new TypeError('Kerf cannot be negative.');
    const sources: SourcePiece[] = [];
    const sourceIdentities = new Set<string>();
    request.sources.forEach(source => {
      const length = inputDecimal(source.lengthMeters, 'source.lengthMeters');
      const width = inputDecimal(source.widthMeters, 'source.widthMeters');
      parseStableIdentity('source-batch', source.sourceBatchId);
      if (sourceIdentities.has(source.sourceBatchId)) {
        throw new TypeError(`Duplicate source batch identity: ${source.sourceBatchId}.`);
      }
      sourceIdentities.add(source.sourceBatchId);
      if (!positiveInteger(source.quantity) || length.lte(0) || width.lte(0)) {
        throw new TypeError('Source dimensions and quantity must be positive.');
      }
      const allocationPriority = source.allocationPriority ?? 0;
      if (
        !Number.isSafeInteger(allocationPriority) ||
        allocationPriority < 0
      ) {
        throw new TypeError('Source allocation priority must be a non-negative integer.');
      }
      for (let ordinal = 1; ordinal <= source.quantity; ordinal += 1) {
        sources.push({
          batchId: source.sourceBatchId,
          ordinal,
          allocationPriority,
          used: false,
          cutCount: 0,
          free: [{ x: d('0'), y: d('0'), length, width }]
        });
      }
    });
    const pieces: DemandPiece[] = [];
    const demandIdentities = new Set<string>();
    request.demands.forEach(demand => {
      const length = inputDecimal(demand.lengthMeters, 'demand.lengthMeters');
      const width = inputDecimal(demand.widthMeters, 'demand.widthMeters');
      if (!demand.demandId.trim() || !positiveInteger(demand.quantity) ||
          length.lte(0) || width.lte(0)) {
        throw new TypeError('Demand identity, dimensions, and quantity must be positive.');
      }
      if (demandIdentities.has(demand.demandId)) {
        throw new TypeError(`Duplicate packing demand identity: ${demand.demandId}.`);
      }
      demandIdentities.add(demand.demandId);
      for (let ordinal = 1; ordinal <= demand.quantity; ordinal += 1) {
        pieces.push({ id: demand.demandId, ordinal, length, width });
      }
    });
    pieces.sort((left, right) =>
      right.length.times(right.width).comparedTo(left.length.times(left.width)) ||
      left.id.localeCompare(right.id) || left.ordinal - right.ordinal
    );

    const uniformStripPlan = calculateUniformStripPlan({ request, sources, pieces, kerf });
    if (uniformStripPlan) return { ok: true, plan: uniformStripPlan };

    const bestState =
      calculateUniformGridState({ sources, pieces, kerf }) ??
      searchBestPackingState({ sources, pieces, kerf });
    if (!bestState) return {
      ok: false,
      conflict: { code: 'insufficient-source-capacity', message: 'Entered sources cannot satisfy exact demand.' }
    };

    const finalState: SearchState = bestState;
    const consumed = finalState.sources.filter(source => source.used);
    const remainderOrdinals = new Map<string, number>();
    const remainders: PackedRemainder[] = consumed
      .flatMap(source => source.free.map(rect => ({ source, rect })))
      .sort((left, right) =>
        sources.indexOf(left.source) - sources.indexOf(right.source) || rectOrder(left.rect, right.rect)
      )
      .map(({ source, rect }) => {
        const sourceKey = `${source.batchId}:${source.ordinal}`;
        const remainderOrdinal = (remainderOrdinals.get(sourceKey) ?? 0) + 1;
        remainderOrdinals.set(sourceKey, remainderOrdinal);
        return {
          remainingStoneId: parseStableIdentity(
            'remaining-stone', `${sourceKey}:remainder:${remainderOrdinal}`
          ),
          sourceBatchId: source.batchId,
          sourceOrdinal: source.ordinal,
          xMeters: canonical(rect.x), yMeters: canonical(rect.y),
          lengthMeters: canonical(rect.length), widthMeters: canonical(rect.width)
        };
      });
    const totalByAxis = (axis: PhysicalCut['axis']) => finalState.cuts
      .filter(cut => cut.axis === axis)
      .reduce((sum, cut) => sum.plus(cut.meters), d('0'));
    const kerfWaste = finalState.cuts.reduce(
      (sum, cut) => sum.plus(d(cut.meters).times(kerf)), d('0')
    );
    const unusedSources = request.sources.map(source => ({
      sourceBatchId: source.sourceBatchId,
      quantity: source.quantity - consumed.filter(item => item.batchId === source.sourceBatchId).length
    })).filter(source => source.quantity > 0);
    const planBase = {
      policyVersion: request.policyVersion,
      inputHash: hashCanonicalValue(request),
      consumedSources: consumed.map(source => ({ sourceBatchId: source.batchId, sourceOrdinal: source.ordinal })),
      unusedSources,
      placements: finalState.placements,
      cuts: finalState.cuts,
      longitudinalCutMeters: canonical(totalByAxis('longitudinal')),
      crossCutMeters: canonical(totalByAxis('cross')),
      calibrationMeters: canonical(
        request.calibrationEnabled ? totalByAxis('longitudinal') : d('0')
      ),
      kerfWasteSquareMeters: canonical(kerfWaste),
      remainders
    };
    return { ok: true, plan: { ...planBase, resultHash: hashCanonicalValue(planBase) } };
  } catch (error) {
    return {
      ok: false,
      conflict: {
        code: 'invalid-packing-input',
        message: error instanceof Error ? error.message : 'Packing input is invalid.'
      }
    };
  }
};

export interface PricingRequest {
  readonly policyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly lines: readonly {
    readonly lineId: string;
    readonly quantity: CanonicalDecimal;
    readonly rateToman: CanonicalDecimal;
  }[];
}

export interface PricedLine {
  readonly lineId: string;
  readonly quantity: CanonicalDecimal;
  readonly rateToman: CanonicalDecimal;
  readonly amountToman: CanonicalDecimal;
}

export interface PricingResult {
  readonly policyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly lines: readonly PricedLine[];
  readonly totalAmountToman: CanonicalDecimal;
}

export const calculatePricing = (request: PricingRequest): PricingResult => {
  policyVersion(request.policyVersion, 'policyVersion');
  policyVersion(request.roundingPolicyVersion, 'roundingPolicyVersion');
  const lineIdentities = new Set<string>();
  const lines = request.lines.map(line => {
    const quantity = inputDecimal(line.quantity, 'pricingLine.quantity');
    const rate = inputDecimal(line.rateToman, 'pricingLine.rateToman');
    if (!line.lineId.trim() || quantity.lt(0) || rate.lt(0)) {
      throw new TypeError('Pricing line identity, quantity, and rate are invalid.');
    }
    if (lineIdentities.has(line.lineId)) {
      throw new TypeError(`Duplicate pricing line identity: ${line.lineId}.`);
    }
    lineIdentities.add(line.lineId);
    return {
      ...line,
      amountToman: canonical(quantity.times(rate).toDecimalPlaces(0, Decimal.ROUND_HALF_UP))
    };
  });
  const resultBase = {
    policyVersion: request.policyVersion,
    roundingPolicyVersion: request.roundingPolicyVersion,
    inputHash: hashCanonicalValue(request),
    lines,
    totalAmountToman: canonical(lines.reduce((sum, line) => sum.plus(line.amountToman), d('0')))
  };
  return { ...resultBase, resultHash: hashCanonicalValue(resultBase) };
};
