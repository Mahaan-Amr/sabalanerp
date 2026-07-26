declare const canonicalDecimalBrand: unique symbol;

export type CanonicalDecimal = string & {
  readonly [canonicalDecimalBrand]: 'CanonicalDecimal';
};

const DIGIT_MAP: Readonly<Record<string, string>> = {
  '\u06F0': '0',
  '\u06F1': '1',
  '\u06F2': '2',
  '\u06F3': '3',
  '\u06F4': '4',
  '\u06F5': '5',
  '\u06F6': '6',
  '\u06F7': '7',
  '\u06F8': '8',
  '\u06F9': '9',
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9'
};

const normalizeDigits = (value: string): string =>
  Array.from(value, character => DIGIT_MAP[character] ?? character).join('');

export const parseCanonicalDecimal = (input: string): CanonicalDecimal => {
  if (typeof input !== 'string') {
    throw new TypeError('Canonical decimal input must be a string.');
  }
  const normalizedInput = normalizeDigits(String(input))
    .trim()
    .replace(/[,\u066C\s]/g, '')
    .replace(/\u066B/g, '.');

  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalizedInput)) {
    throw new TypeError(`Invalid canonical decimal: ${String(input)}`);
  }

  const negative = normalizedInput.startsWith('-');
  const unsigned = normalizedInput.replace(/^[+-]/, '');
  const [rawInteger = '0', rawFraction = ''] = unsigned.split('.');
  const integer = rawInteger.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.replace(/0+$/, '');
  const magnitude = fraction ? `${integer}.${fraction}` : integer;

  return (negative && magnitude !== '0' ? `-${magnitude}` : magnitude) as CanonicalDecimal;
};
