import { normalizeDigits } from './numberFormat';

export const normalizePhoneDigits = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '';
  return normalizeDigits(String(value)).replace(/\D/g, '');
};

export const normalizeIranianMobile = (value: string | number | null | undefined): string => {
  const digits = normalizePhoneDigits(value);
  if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.startsWith('9') && digits.length === 10) return `0${digits}`;
  return digits;
};

export const isValidIranianMobile = (value: string | number | null | undefined): boolean => {
  return /^09\d{9}$/.test(normalizeIranianMobile(value));
};

export const normalizeOptionalIranianMobile = (value: string | number | null | undefined): string => {
  const normalized = normalizeIranianMobile(value);
  return normalized;
};

export const validateRequiredIranianMobile = (value: string | number | null | undefined): string | null => {
  const normalized = normalizeIranianMobile(value);
  if (!normalized) return 'شماره تماس الزامی است';
  return /^09\d{9}$/.test(normalized) ? null : 'شماره تماس باید ۱۱ رقم و با 09 شروع شود';
};

export const validateOptionalIranianMobile = (value: string | number | null | undefined): string | null => {
  const normalized = normalizeIranianMobile(value);
  if (!normalized) return null;
  return /^09\d{9}$/.test(normalized) ? null : 'شماره تماس باید ۱۱ رقم و با 09 شروع شود';
};
