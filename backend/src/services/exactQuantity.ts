import { Prisma } from '@prisma/client';

// Decimal(65,30): retain the previous 35-digit aggregate integer capacity.
// Excess precision is rejected, never rounded at a persistence boundary.
export const EXACT_QUANTITY_SCALE = 30;
export const ExactQuantityDecimal = Prisma.Decimal.clone({ precision: 150 });
const SCALE = 10n ** BigInt(EXACT_QUANTITY_SCALE);

export const parseExactQuantityAtoms = (value: string): bigint => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!match) throw new Error(`Invalid exact quantity: ${value}`);
  const fraction = (match[3] || '').replace(/0+$/, '');
  if (fraction.length > EXACT_QUANTITY_SCALE || match[2].replace(/^0+/, '').length > 35) {
    throw new Error('Quantity exceeds exact storage capacity (35 integer and 30 fractional digits)');
  }
  const atoms = BigInt(match[2]) * SCALE + BigInt(fraction.padEnd(EXACT_QUANTITY_SCALE, '0') || '0');
  return match[1] ? -atoms : atoms;
};

export const formatExactQuantityAtoms = (value: bigint): string => {
  const absolute = value < 0n ? -value : value;
  const fraction = String(absolute % SCALE).padStart(EXACT_QUANTITY_SCALE, '0').replace(/0+$/, '').padEnd(3, '0');
  return `${value < 0n ? '-' : ''}${absolute / SCALE}.${fraction}`;
};

/** Keep historical scale-three hash formatting; preserve every additional digit. */
export const exactQuantityText = (value: unknown): string => {
  const decimal = new Prisma.Decimal(String(value));
  if (!decimal.isFinite()) throw new Error('Quantity must be finite');
  return formatExactQuantityAtoms(parseExactQuantityAtoms(decimal.toFixed()));
};
