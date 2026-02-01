/**
 * Number formatting utilities for the Sablan ERP platform
 * Provides consistent number formatting with thousands separators
 */

/**
 * Format a number with thousands separators using Persian locale
 * @param value - The number to format
 * @param options - Formatting options
 * @returns Formatted number string
 */
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

  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
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
    maximumFractionDigits,
  };

  if (currency) {
    formatOptions.style = 'currency';
    formatOptions.currency = currency;
  }

  return num.toLocaleString(locale, formatOptions);
};

/**
 * Format a number for display with thousands separators
 * @param value - The number to format
 * @returns Formatted number string
 */
export const formatDisplayNumber = (value: number | string | null | undefined): string => {
  // Round to 2 decimal places before formatting
  if (value === null || value === undefined || value === '') {
    return '0';
  }
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  const roundedValue = Math.round(num * 100) / 100;
  
  return formatNumber(roundedValue, {
    locale: 'fa-IR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
};

/**
 * Format a currency amount with thousands separators
 * @param value - The amount to format
 * @param currency - The currency code (default: 'IRR')
 * @returns Formatted currency string
 */
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

/**
 * Format a price with thousands separators (for Toman/Rial)
 * @param value - The price to format
 * @param currency - The currency unit (default: 'تومان')
 * @returns Formatted price string
 */
export const formatPrice = (
  value: number | string | null | undefined,
  currency: string = 'تومان'
): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} ${currency}`;
};

/**
 * Convert Toman to Rial (1 Toman = 10 Rials)
 * @param tomanValue - The value in Toman
 * @returns The value in Rial
 */
export const tomanToRial = (tomanValue: number | string | null | undefined): number => {
  if (tomanValue === null || tomanValue === undefined || tomanValue === '') {
    return 0;
  }
  const num = typeof tomanValue === 'string' ? parseFloat(tomanValue) : tomanValue;
  if (isNaN(num)) return 0;
  return num * 10;
};

/**
 * Format price with Toman and show Rial conversion
 * @param value - The price in Toman
 * @param currency - The currency unit (default: 'تومان')
 * @param showRialConversion - Whether to show Rial conversion (default: true)
 * @returns Formatted price string with optional Rial conversion
 */
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

/**
 * Parse a formatted number string back to a number
 * @param formattedValue - The formatted number string
 * @returns The parsed number
 */
export const parseFormattedNumber = (formattedValue: string): number => {
  if (!formattedValue) return 0;
  
  // Remove all non-numeric characters except decimal point
  const cleaned = formattedValue.replace(/[^\d.-]/g, '');
  const num = parseFloat(cleaned);
  
  return isNaN(num) ? 0 : num;
};

/**
 * Format a number input value for display in input fields
 * @param value - The number to format
 * @returns Formatted number string for input display
 */
export const formatInputNumber = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const num = typeof value === 'string' ? parseFloat(value) : value;
  
  if (isNaN(num)) {
    return '';
  }

  // Round to 2 decimal places before formatting
  const roundedValue = Math.round(num * 100) / 100;
  
  // For input fields, we want to show the number without currency symbols
  return formatDisplayNumber(roundedValue);
};

/**
 * Format dimensions with proper labels
 * @param width - Width value
 * @param thickness - Thickness value
 * @param unit - Unit (default: 'cm')
 * @returns Formatted dimensions string
 */
export const formatDimensions = (
  width: number | string | null | undefined,
  thickness: number | string | null | undefined,
  unit: string = 'cm'
): string => {
  const formattedWidth = formatDisplayNumber(width);
  const formattedThickness = formatDisplayNumber(thickness);
  
  return `عرض ${formattedWidth} × ضخامت ${formattedThickness} ${unit}`;
};

/**
 * Format square meters with proper label
 * @param value - The square meter value
 * @returns Formatted square meters string
 */
export const formatSquareMeters = (value: number | string | null | undefined): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} متر مربع`;
};

/**
 * Format quantity with proper label
 * @param value - The quantity value
 * @returns Formatted quantity string
 */
export const formatQuantity = (value: number | string | null | undefined): string => {
  const formatted = formatDisplayNumber(value);
  return `${formatted} عدد`;
};
