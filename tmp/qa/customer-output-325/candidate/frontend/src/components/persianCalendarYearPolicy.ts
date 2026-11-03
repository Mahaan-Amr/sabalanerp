import { normalizeIdentifierDigits } from "@/lib/numberFormat";

export const normalizeYearOnlyValue = (value: unknown, minYear: number, maxYear: number) => {
  const normalized = normalizeIdentifierDigits(String(value ?? "").trim());
  if (!/^\d{4}$/.test(normalized)) return "";
  const year = Number(normalized);
  return year >= minYear && year <= maxYear ? normalized : "";
};

export const yearOnlyOptions = (minYear: number, maxYear: number) =>
  Array.from({ length: Math.max(0, maxYear - minYear + 1) }, (_, index) => maxYear - index);
