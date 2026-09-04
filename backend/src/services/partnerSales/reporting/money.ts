// Exact decimal addition/subtraction, including 80-digit shared-contract amounts.
// No currency inference/conversion or binary floating-point arithmetic.
export function sum(values: readonly string[]): string {
  const scale = Math.max(0, ...values.map(value => (value.split('.')[1] || '').length));
  let total = 0n;
  for (const value of values) {
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error('Invalid decimal');
    const negative = value.startsWith('-');
    const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    const integer = BigInt(whole + fraction.padEnd(scale, '0'));
    total += negative ? -integer : integer;
  }
  const negative = total < 0n;
  let digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  if (scale) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
  return negative ? `-${digits}` : digits;
}
export const negate = (value: string) => value.startsWith('-') ? value.slice(1) : `-${value}`;
export const subtract = (left: string, right: string) => sum([left, negate(right)]);

export function multiply(left: string, right: string): string {
  const a = sum([left]), b = sum([right]);
  const scale = (a.split('.')[1]?.length ?? 0) + (b.split('.')[1]?.length ?? 0);
  const units = BigInt(a.replace('.', '')) * BigInt(b.replace('.', ''));
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  return sum([`${units < 0n ? '-' : ''}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`]);
}
