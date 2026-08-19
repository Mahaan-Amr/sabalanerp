const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const normalizePersianSearchTokens = (value: unknown): string[] =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/[۰-۹]/g, digit => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

export const expandPersianSearchTokenVariants = (token: string): string[] => {
  const normalized = normalizePersianSearchTokens(token).join(' ');
  if (!normalized) return [];
  let variants = new Set([normalized]);
  for (let index = 0; index < normalized.length && variants.size < 64; index += 1) {
    const replacement = normalized[index] === 'ی' ? 'ي' : normalized[index] === 'ک' ? 'ك' : null;
    if (!replacement) continue;
    const expanded = new Set(variants);
    for (const value of variants) {
      expanded.add(`${value.slice(0, index)}${replacement}${value.slice(index + 1)}`);
    }
    variants = expanded;
  }
  return [...variants];
};
