declare const canonicalDecimalBrand: unique symbol;

export type CanonicalDecimal = string & {
  readonly [canonicalDecimalBrand]: 'CanonicalDecimal';
};

const DIGIT_MAP: Readonly<Record<string, string>> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9'
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
