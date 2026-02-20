import type { RemainingStone } from '../types/contract.types';

const EPSILON = 0.000001;

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildMergeKey = (stone: RemainingStone): string => {
  const startWidth = stone.position?.startWidth ?? 0;
  const startLength = stone.position?.startLength ?? 0;
  return [
    stone.sourceCutId || '',
    stone.width.toFixed(6),
    stone.length.toFixed(6),
    startWidth.toFixed(6),
    startLength.toFixed(6)
  ].join('|');
};

export const sanitizeRemainingStoneEntry = (stone: RemainingStone): RemainingStone => {
  const width = Math.max(0, toNumber(stone.width));
  const length = Math.max(0, toNumber(stone.length));
  const pieceSquareMeters = (width * length) / 100;
  const rawSquareMeters = Math.max(0, toNumber(stone.squareMeters));

  const explicitQuantity = Math.floor(toNumber(stone.quantity));
  const inferredQuantity =
    pieceSquareMeters > EPSILON && rawSquareMeters > EPSILON
      ? Math.floor((rawSquareMeters + EPSILON) / pieceSquareMeters)
      : 0;
  const quantity = explicitQuantity > 0 ? explicitQuantity : inferredQuantity;

  const squareMeters =
    quantity > 0 && pieceSquareMeters > EPSILON
      ? pieceSquareMeters * quantity
      : 0;

  const hasValidGeometry = width > EPSILON && length > EPSILON && squareMeters > EPSILON && quantity >= 1;
  const isAvailable = stone.isAvailable !== false && hasValidGeometry;

  return {
    ...stone,
    width,
    length,
    quantity: quantity > 0 ? quantity : 0,
    squareMeters,
    isAvailable
  };
};

export const isUsableRemainingStone = (stone: RemainingStone): boolean => {
  const sanitized = sanitizeRemainingStoneEntry(stone);
  return (
    sanitized.isAvailable === true &&
    sanitized.width > EPSILON &&
    sanitized.length > EPSILON &&
    sanitized.squareMeters > EPSILON &&
    (sanitized.quantity || 0) >= 1
  );
};

export const normalizeRemainingStoneCollection = (stones: RemainingStone[]): RemainingStone[] =>
  stones.map(sanitizeRemainingStoneEntry);

export const mergeRemainingStoneCollection = (stones: RemainingStone[]): RemainingStone[] => {
  const merged = new Map<string, RemainingStone>();

  for (const rawStone of stones) {
    const stone = sanitizeRemainingStoneEntry(rawStone);
    if (!stone.isAvailable) {
      continue;
    }

    const key = buildMergeKey(stone);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...stone });
      continue;
    }

    const quantity = (existing.quantity || 0) + (stone.quantity || 0);
    existing.quantity = quantity;
    existing.squareMeters += stone.squareMeters;
  }

  return Array.from(merged.values()).map(sanitizeRemainingStoneEntry);
};

