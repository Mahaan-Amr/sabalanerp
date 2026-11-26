import { normalizeStoneReturnQuantity, stoneReturnQuantityAtoms, stoneReturnQuantityScale } from './stoneReturnQuantityInput';

export type ProjectReturnLinearCalculation = {
  khatRas: string;
  pieceCount: string;
  plus: string;
  minus: string;
};

export type ProjectReturnQuantityDraft = {
  mode: 'direct' | 'linear';
  direct: string;
  linear: ProjectReturnLinearCalculation;
};

export function emptyProjectReturnQuantity(): ProjectReturnQuantityDraft {
  return { mode: 'direct', direct: '', linear: { khatRas: '', pieceCount: '', plus: '', minus: '' } };
}

const quantityScale = BigInt(`1${'0'.repeat(stoneReturnQuantityScale)}`);

function formatQuantityAtoms(atoms: bigint) {
  const fraction = (atoms % quantityScale).toString().padStart(stoneReturnQuantityScale, '0').replace(/0+$/, '');
  return `${atoms / quantityScale}${fraction ? '.' + fraction : ''}`;
}

export function resolveProjectReturnWidth(value: string) {
  const width = normalizeStoneReturnQuantity(value, true);
  const atoms = stoneReturnQuantityAtoms(width, 'meter');
  return atoms !== null && atoms > BigInt(0) ? width : null;
}

export function resolveProjectReturnArea(quantity: string, unit: string, widthMeters: string | null) {
  if (unit === 'squareMeter') return quantity;
  if (unit !== 'meter' || widthMeters === null) return null;
  const length = stoneReturnQuantityAtoms(quantity, unit);
  const width = stoneReturnQuantityAtoms(widthMeters, unit);
  if (length === null || width === null) return null;
  const result = formatQuantityAtoms((length * width + quantityScale / BigInt(2)) / quantityScale);
  return stoneReturnQuantityAtoms(result, 'squareMeter') === null ? null : result;
}

export function resolveProjectReturnQuantity(draft: ProjectReturnQuantityDraft, unit: string) {
  const normalize = (value: string, fallback = '') => normalizeStoneReturnQuantity(value.trim() || fallback, true);
  if (draft.mode === 'direct') {
    const value = normalize(draft.direct, '0');
    return stoneReturnQuantityAtoms(value, unit) === null ? null : { value };
  }
  if (unit !== 'meter') return null;
  const calculation = {
    khatRas: normalize(draft.linear.khatRas),
    pieceCount: normalize(draft.linear.pieceCount),
    plus: normalize(draft.linear.plus, '0'),
    minus: normalize(draft.linear.minus, '0'),
  };
  const length = stoneReturnQuantityAtoms(calculation.khatRas, unit);
  const pieces = stoneReturnQuantityAtoms(calculation.pieceCount, 'count');
  const plus = stoneReturnQuantityAtoms(calculation.plus, unit);
  const minus = stoneReturnQuantityAtoms(calculation.minus, unit);
  if (length === null || length === BigInt(0) || pieces === null || pieces === BigInt(0) || plus === null || minus === null) return null;

  // A whole piece count keeps the loading formula on the exact quantity scale.
  const calculated = length * (pieces / quantityScale) + plus - minus;
  if (calculated < BigInt(0)) return null;
  const value = formatQuantityAtoms(calculated);
  return stoneReturnQuantityAtoms(value, unit) === null ? null : { value, calculation };
}
