const FALLBACK_TEXT = 'نامشخص';

const mojibakePattern = /[ØÙÛ]/;
const questionOnlyPattern = /^[\s?؟]+$/;

export const isCorruptedUiText = (value: unknown): boolean => {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  if (!text) return true;
  if (mojibakePattern.test(text)) return true;
  if (questionOnlyPattern.test(text)) return true;
  if (text.includes('???') || text.includes('??')) return true;
  return false;
};

export const sanitizeUiText = (value: unknown, fallback = FALLBACK_TEXT): string => {
  if (isCorruptedUiText(value)) return fallback;
  return String(value).trim();
};

export const sanitizeUiTextWithCandidates = (
  candidates: unknown[],
  fallback = FALLBACK_TEXT
): string => {
  const valid = candidates.find((candidate) => !isCorruptedUiText(candidate));
  return valid !== undefined ? String(valid).trim() : fallback;
};
