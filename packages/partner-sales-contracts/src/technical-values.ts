import { z } from 'zod';
import { parseCanonicalDecimal, type CanonicalDecimal } from '@sabalanerp/contract-product-graph';

export const technicalDecimal = z.string().max(80).refine(value => {
  try { return parseCanonicalDecimal(value) === value; } catch { return false; }
}, 'Normalized technical decimal required');

export const optionalCanonicalDecimal = (value: string | undefined): CanonicalDecimal | undefined =>
  value === undefined ? undefined : parseCanonicalDecimal(value);

// Exact conversion of the positive inventory decimal, without a binary float.
export function centimetersToMeters(value: string | undefined): CanonicalDecimal | undefined {
  if (value === undefined) return undefined;
  const [whole, fraction = ''] = value.split('.');
  const padded = whole.padStart(3, '0');
  return parseCanonicalDecimal(`${padded.slice(0, -2)}.${padded.slice(-2)}${fraction}`);
}
