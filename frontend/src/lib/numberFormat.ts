/**
 * Number formatting utilities for the Sabalan ERP platform.
 */

export const normalizeDigits = (value: string): string => {
  return value
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\u066B/g, '.')
    .replace(/[\u060C\u066C]/g, ',');
};

const canonicalNumericText = (
  value: string,
  maximumFractionDigits: number | null
): string => {
  const normalized = normalizeDigits(value);
  let result = '';
  let hasDecimal = false;
  let fractionDigits = 0;

  for (const character of normalized) {
    if (character >= '0' && character <= '9') {
      if (
        hasDecimal &&
        maximumFractionDigits !== null &&
        fractionDigits >= maximumFractionDigits
      ) {
        continue;
      }
      result += character;
      if (hasDecimal) fractionDigits += 1;
      continue;
    }
    if (character === '.' && !hasDecimal) {
      result += character;
      hasDecimal = true;
      continue;
    }
    if (character === '-' && result.length === 0) {
      result = '-';
    }
  }

  return result;
};

const groupCanonicalNumericText = (canonicalText: string): string => {
  const negative = canonicalText.startsWith('-');
  const unsigned = negative ? canonicalText.slice(1) : canonicalText;
  const hasDecimal = unsigned.includes('.');
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${groupedInteger}${hasDecimal ? `.${fractionPart}` : ''}`;
};

export interface FormattedNumericInputText {
  canonicalText: string;
  displayText: string;
  caretPosition: number;
}

export const formatNumericInputText = (
  value: string,
  selectionStart: number = value.length,
  maximumFractionDigits: number | null = null
): FormattedNumericInputText => {
  const canonicalText = canonicalNumericText(value, maximumFractionDigits);
  const displayText = groupCanonicalNumericText(canonicalText);
  const prefix = value.slice(0, Math.max(0, selectionStart));
  const canonicalPrefix = canonicalNumericText(prefix, maximumFractionDigits);
  const caretPosition = groupCanonicalNumericText(canonicalPrefix).length;

  return { canonicalText, displayText, caretPosition };
};

export const parseFormattedNumber = (formattedValue: string): number => {
  if (!formattedValue) return 0;

  const normalized = normalizeDigits(formattedValue).replace(/[,\s]/g, '');
  const cleaned = normalized.replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);

  return isNaN(num) ? 0 : num;
};

export type NumericValue = number | string | null | undefined;

export const toFiniteNumber = (value: NumericValue): number => {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const num = typeof value === 'string' ? parseFormattedNumber(value) : value;
  return Number.isFinite(num) ? num : 0;
};

export const sumNumericValues = <T>(
  items: T[],
  selector: (item: T) => NumericValue
): number => {
  return items.reduce((sum, item) => sum + toFiniteNumber(selector(item)), 0);
};

export const formatNumber = (
  value: number | string | null | undefined,
  options: {
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    currency?: string;
  } = {}
): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }

  const num = toFiniteNumber(value);

  if (!Number.isFinite(num)) {
    return '0';
  }

  const {
    locale = 'fa-IR',
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    currency
  } = options;

  const formatOptions: Intl.NumberFormatOptions = {
    minimumFractionDigits,
    maximumFractionDigits
  };

  if (currency) {
    formatOptions.style = 'currency';
    formatOptions.currency = currency;
  }

  return num.toLocaleString(locale, formatOptions);
};

export const formatDisplayNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }
  const num = toFiniteNumber(value);
  if (!Number.isFinite(num)) return '0';

  return formatNumber(num, {
    locale: 'fa-IR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
};

export const formatDisplayNumberLatin = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '0';
  }
  const num = toFiniteNumber(value);
  if (!Number.isFinite(num)) return '0';

  return num.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4
  });
};

export const formatCurrency = (
  value: number | string | null | undefined,
  currency: string = 'IRR'
): string => {
  return formatNumber(value, {
    locale: 'fa-IR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    currency
  });
};

export const formatPrice = (
  value: number | string | null | undefined,
  currency: string = 'تومان'
): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} ${currency}`;
};

export const tomanToRial = (tomanValue: number | string | null | undefined): number => {
  if (tomanValue === null || tomanValue === undefined || tomanValue === '') {
    return 0;
  }
  const num = toFiniteNumber(tomanValue);
  if (!Number.isFinite(num)) return 0;
  return num * 10;
};

export const formatPriceWithRial = (
  value: number | string | null | undefined,
  currency: string = 'تومان',
  showRialConversion: boolean = true
): string => {
  const formatted = formatPrice(value, currency);
  if (showRialConversion && currency === 'تومان') {
    const rialValue = tomanToRial(value);
    const formattedRial = formatDisplayNumber(rialValue);
    return `${formatted} (${formattedRial} ریال)`;
  }
  return formatted;
};

export const formatInputNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = toFiniteNumber(value);

  if (!Number.isFinite(num)) {
    return '';
  }

  return formatDisplayNumber(num);
};

export const formatInputNumberLatin = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = toFiniteNumber(value);

  if (!Number.isFinite(num)) {
    return '';
  }

  return formatDisplayNumberLatin(num);
};

export const formatDimensions = (
  width: number | string | null | undefined,
  thickness: number | string | null | undefined,
  unit: string = 'cm'
): string => {
  const formattedWidth = formatDisplayNumber(width);
  const formattedThickness = formatDisplayNumber(thickness);

  return `عرض ${formattedWidth} × ضخامت ${formattedThickness} ${unit}`;
};

export const formatSquareMeters = (value: number | string | null | undefined): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} متر مربع`;
};

export const formatQuantity = (value: number | string | null | undefined): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} عدد`;
};
