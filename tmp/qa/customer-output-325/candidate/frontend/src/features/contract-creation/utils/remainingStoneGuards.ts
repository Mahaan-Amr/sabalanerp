import type { ContractProduct, RemainingStone } from '../types/contract.types';

const EPSILON = 0.000001;

export interface RemainingStoneInventoryGroup {
  key: string;
  width: number;
  length: number;
  quantity: number;
  pieceSquareMeters: number;
  totalSquareMeters: number;
  stones: RemainingStone[];
}

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

export const getRemainingStoneInventoryGroupKey = (
  stone: Pick<RemainingStone, 'width' | 'length' | 'isAvailable'>
): string => [
  stone.isAvailable === false ? 'unavailable' : 'available',
  String(Math.max(0, toNumber(stone.width))),
  String(Math.max(0, toNumber(stone.length)))
].join('|');

export const groupRemainingStoneInventory = (
  stones: RemainingStone[]
): RemainingStoneInventoryGroup[] => {
  const groups = new Map<string, RemainingStoneInventoryGroup>();

  normalizeRemainingStoneCollection(stones)
    .filter(isUsableRemainingStone)
    .forEach((stone) => {
      const key = getRemainingStoneInventoryGroupKey(stone);
      const quantity = Math.max(1, Math.trunc(Number(stone.quantity || 1)));
      const pieceSquareMeters = (stone.width * stone.length) / 100;
      const existing = groups.get(key);
      if (existing) {
        existing.quantity += quantity;
        existing.totalSquareMeters += pieceSquareMeters * quantity;
        existing.stones.push(stone);
        return;
      }
      groups.set(key, {
        key,
        width: stone.width,
        length: stone.length,
        quantity,
        pieceSquareMeters,
        totalSquareMeters: pieceSquareMeters * quantity,
        stones: [stone]
      });
    });

  return Array.from(groups.values());
};

export const sanitizeRemainingStoneEntry = (stone: RemainingStone): RemainingStone => {
  const width = Math.max(0, toNumber(stone.width));
  const length = Math.max(0, toNumber(stone.length));
  const pieceSquareMeters = (width * length) / 100;
  const rawSquareMeters = Math.max(0, toNumber(stone.squareMeters));

  const explicitQuantity = Math.floor(toNumber(stone.quantity));
  const inferredQuantity =
    pieceSquareMeters > 0 && rawSquareMeters > 0
      ? Math.max(1, Math.floor((rawSquareMeters / pieceSquareMeters) + EPSILON))
      : 0;
  const quantity = explicitQuantity > 0 ? explicitQuantity : inferredQuantity;

  const squareMeters =
    quantity > 0 && pieceSquareMeters > 0
      ? pieceSquareMeters * quantity
      : 0;

  const hasValidGeometry =
    width > 0 &&
    length > 0 &&
    squareMeters > 0 &&
    quantity >= 1;
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
    sanitized.width > 0 &&
    sanitized.length > 0 &&
    sanitized.squareMeters > 0 &&
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

const getLegacyRemainingStoneUsageKeys = (stone: RemainingStone): string[] => {
  const keys = [stone.id, stone.sourceCutId].filter(Boolean);
  const layerSourceMatch = stone.id.match(/^used_layer_(.*)_\d+$/);
  if (layerSourceMatch?.[1]) {
    keys.push(layerSourceMatch[1]);
  }
  return keys;
};

export const getAvailableRemainingStoneInventory = (
  product: Pick<ContractProduct, 'remainingStones' | 'remainingStoneSourceInventory' | 'usedRemainingStones'>
): RemainingStone[] => {
  const remaining = normalizeRemainingStoneCollection(product.remainingStones || [])
    .filter(isUsableRemainingStone);

  // Canonical replay already replaces consumed stock with its physical secondary remnants.
  // Applying the legacy sourceCutId filter again would hide every remnant in that lineage.
  if (Array.isArray(product.remainingStoneSourceInventory)) {
    return remaining;
  }

  const usedKeys = new Set((product.usedRemainingStones || []).flatMap(getLegacyRemainingStoneUsageKeys));
  return remaining.filter((stone) =>
    !getLegacyRemainingStoneUsageKeys(stone).some((key) => usedKeys.has(key))
  );
};
