const educationCodes = new Set([
  'PRIMARY', 'LOWER_SECONDARY', 'DIPLOMA', 'ASSOCIATE', 'BACHELOR',
  'MASTER', 'DOCTORATE', 'SEMINARY', 'OTHER',
]);

const legacyEducation = new Map<string, string>([
  ['ابتدایی', 'PRIMARY'],
  ['متوسطه اول', 'LOWER_SECONDARY'],
  ['دیپلم', 'DIPLOMA'],
  ['کاردانی', 'ASSOCIATE'],
  ['کارشناسی', 'BACHELOR'],
  ['کارشناسی ارشد', 'MASTER'],
  ['دکتری', 'DOCTORATE'],
  ['حوزوی', 'SEMINARY'],
  ['سایر', 'OTHER'],
]);

export type LegacyEducationClassification =
  | { kind: 'VALID' }
  | { kind: 'EMPTY' }
  | { kind: 'CHANGE'; educationLevel: string; educationLevelOther: string; legacyRaw: string };

export const classifyLegacyEducation = (value: unknown): LegacyEducationClassification => {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'EMPTY' };
  if (educationCodes.has(raw)) return { kind: 'VALID' };
  const mapped = legacyEducation.get(raw);
  return {
    kind: 'CHANGE',
    educationLevel: mapped || 'OTHER',
    educationLevelOther: mapped === 'OTHER' || !mapped ? raw : '',
    legacyRaw: raw,
  };
};

export type LegacyGraduationYearClassification =
  | { kind: 'VALID' }
  | { kind: 'EMPTY' }
  | { kind: 'REVIEW'; reason: 'NON_CANONICAL_YEAR' | 'AMBIGUOUS_YEAR' | 'YEAR_OUT_OF_RANGE'; raw: string };

export const classifyLegacyGraduationYear = (
  value: unknown,
  currentYear: number,
): LegacyGraduationYearClassification => {
  const raw = String(value ?? '').trim();
  if (!raw) return { kind: 'EMPTY' };
  if (!/^\d{4}$/.test(raw)) {
    return {
      kind: 'REVIEW',
      reason: /^[۰-۹٠-٩]{4}$/.test(raw) ? 'NON_CANONICAL_YEAR' : 'AMBIGUOUS_YEAR',
      raw,
    };
  }
  const numeric = Number(raw);
  if (numeric < 1300 || numeric > currentYear) return { kind: 'REVIEW', reason: 'YEAR_OUT_OF_RANGE', raw };
  return { kind: 'VALID' };
};

export const currentJalaliYear = (now = new Date()) => Number(
  new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' })
    .formatToParts(now)
    .find((part) => part.type === 'year')?.value,
);
