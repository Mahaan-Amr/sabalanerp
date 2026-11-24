import { normalizeDigits } from '@/lib/numberFormat';

const scale = 30;

export function normalizeStoneReturnQuantity(value: string, allowGrouping = false) {
  const normalized = normalizeDigits(value).trim();
  const ungrouped = allowGrouping ? normalized.replace(/,/g, '') : normalized;
  return ungrouped.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function stoneReturnQuantityAtoms(value: string, unit: string): bigint | null {
  const parsed = /^(\d{1,35})(?:\.(\d{1,30}))?$/.exec(value);
  if (!parsed || (unit === 'count' && parsed[2])) return null;
  return BigInt(parsed[1] + (parsed[2] ?? '').padEnd(scale, '0'));
}
