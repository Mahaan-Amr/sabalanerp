import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type {
  PerformanceCriterionKind,
  PerformanceEvidenceKind,
  PerformanceLevelPolicySnapshot,
} from './personnelPerformanceCalculation';

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

export const canonicalPerformanceHash = (value: unknown) => (
  createHash('sha256').update(stableJson(value)).digest('hex')
);

export const CONTROLLED_PERFORMANCE_FACTS = new Set([
  'jobId',
  'positionId',
  'organizationalUnitId',
  'locationId',
  'shiftType',
  'assignmentType',
  'responsibilityCodes',
  'effectiveDate',
  'hasSafetyDuty',
]);

export type PerformanceCriterionPolicyContent = {
  schemaVersion: 1;
  conceptCode: string;
  titleFa: string;
  meaningFa: string;
  kind: PerformanceCriterionKind;
  anchorsFa: string[];
  applicability: {
    fact: string;
    operator: 'EQUALS' | 'IN' | 'EXISTS';
    values: unknown[];
  } | null;
  evidence: {
    allowedKinds: PerformanceEvidenceKind[];
    minimumReliableCount: number;
    lookbackDays: number;
    required: boolean;
  };
};

const containsPersian = (value: string) => /[\u0600-\u06ff]/.test(value);

export const validateCriterionPolicyContent = (content: PerformanceCriterionPolicyContent): string[] => {
  const errors: string[] = [];
  if (content.schemaVersion !== 1) errors.push('نسخه ساختار معیار پشتیبانی نمی‌شود.');
  if (!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(content.conceptCode)) errors.push('کد مفهوم معیار معتبر نیست.');
  if (!content.titleFa.trim() || !containsPersian(content.titleFa)) errors.push('عنوان فارسی معیار الزامی است.');
  if (!content.meaningFa.trim() || !containsPersian(content.meaningFa)) errors.push('معنای فارسی معیار الزامی است.');
  if (content.kind === 'JUDGMENT') {
    if (content.anchorsFa.length !== 5 || content.anchorsFa.some((anchor) => !anchor.trim() || !containsPersian(anchor))) {
      errors.push('برای معیار قضاوتی، توضیح رفتاری فارسی هر پنج درجه الزامی است.');
    }
  } else if (content.anchorsFa.length > 0) {
    errors.push('KPI، متن توضیحی و کنترل بله/خیر درجه پنهان و امتیاز مرکب ندارند.');
  }
  if (content.applicability && !CONTROLLED_PERFORMANCE_FACTS.has(content.applicability.fact)) {
    errors.push('قاعده کاربردپذیری باید فقط از واقعیت کنترل‌شده تصویر ثابت استفاده کند.');
  }
  if (content.applicability?.operator !== 'EXISTS' && content.applicability?.values.length === 0) {
    errors.push('قاعده کاربردپذیری بدون مقدار معتبر نیست.');
  }
  if (!Number.isInteger(content.evidence.minimumReliableCount) || content.evidence.minimumReliableCount < 0) {
    errors.push('حداقل تعداد شاهد قابل اتکا معتبر نیست.');
  }
  if (!Number.isInteger(content.evidence.lookbackDays) || content.evidence.lookbackDays < 0) {
    errors.push('بازه نگاه‌به‌عقب شاهد معتبر نیست.');
  }
  if (content.evidence.required && content.evidence.minimumReliableCount < 1) {
    errors.push('شاهد الزامی باید حداقل یک ثبت قابل اتکا بخواهد.');
  }
  if (new Set(content.evidence.allowedKinds).size !== content.evidence.allowedKinds.length) {
    errors.push('نوع شاهد در سیاست معیار تکرار شده است.');
  }
  return errors;
};

export type LevelPolicyContent = Omit<PerformanceLevelPolicySnapshot, 'versionId'> & { schemaVersion: 1 };

const EXPECTED_LEVELS = [
  ['URGENT_IMPROVEMENT', 'نیازمند بهبود فوری'],
  ['IMPROVEMENT', 'نیازمند بهبود'],
  ['MEETS', 'مطابق انتظار'],
  ['EXCEEDS', 'فراتر از انتظار'],
  ['OUTSTANDING', 'عملکرد برجسته'],
] as const;

export const DEFAULT_LEVEL_POLICY_CONTENT: LevelPolicyContent = {
  schemaVersion: 1,
  thresholds: [
    { code: 'URGENT_IMPROVEMENT', titleFa: 'نیازمند بهبود فوری', meaningFa: 'عملکرد مصوب به‌طور جدی پایین‌تر از انتظارهای نقش بوده است', minimum: '0.000000', maximumExclusive: '20.000000' },
    { code: 'IMPROVEMENT', titleFa: 'نیازمند بهبود', meaningFa: 'عملکرد مصوب در بخشی از انتظارهای نقش نیازمند بهبود است', minimum: '20.000000', maximumExclusive: '40.000000' },
    { code: 'MEETS', titleFa: 'مطابق انتظار', meaningFa: 'عملکرد مصوب با انتظارهای نقش هم‌خوان است', minimum: '40.000000', maximumExclusive: '60.000000' },
    { code: 'EXCEEDS', titleFa: 'فراتر از انتظار', meaningFa: 'عملکرد مصوب در مجموع فراتر از انتظارهای نقش بوده است', minimum: '60.000000', maximumExclusive: '80.000000' },
    { code: 'OUTSTANDING', titleFa: 'عملکرد برجسته', meaningFa: 'عملکرد مصوب به‌شکلی پایدار و برجسته فراتر از انتظارهای نقش بوده است', minimum: '80.000000', maximumInclusive: '100.000000' },
  ],
};

const isSixDecimal = (value: string) => /^\d+\.\d{6}$/.test(value);

export const validateLevelPolicyContent = (content: LevelPolicyContent): string[] => {
  const errors: string[] = [];
  if (content.schemaVersion !== 1) errors.push('نسخه ساختار سیاست سطح‌بندی پشتیبانی نمی‌شود.');
  if (content.thresholds.length !== 5) errors.push('سیاست سطح‌بندی باید دقیقاً پنج سطح داشته باشد.');
  content.thresholds.forEach((threshold, index) => {
    const expected = EXPECTED_LEVELS[index];
    if (!expected || threshold.code !== expected[0] || threshold.titleFa !== expected[1]) {
      errors.push('نام و ترتیب پنج سطح سازمانی باید مطابق واژگان مصوب باشد.');
    }
    if (!threshold.meaningFa?.trim() || !containsPersian(threshold.meaningFa)) errors.push(`معنای فارسی سطح «${threshold.titleFa}» الزامی است.`);
    if (!isSixDecimal(threshold.minimum)
      || (threshold.maximumExclusive !== undefined && !isSixDecimal(threshold.maximumExclusive))
      || (threshold.maximumInclusive !== undefined && !isSixDecimal(threshold.maximumInclusive))) {
      errors.push(`مرزهای سطح «${threshold.titleFa}» باید با شش رقم اعشار ثبت شوند.`);
    }
    if (index < content.thresholds.length - 1) {
      const upper = threshold.maximumExclusive;
      const nextMinimum = content.thresholds[index + 1]?.minimum;
      if (!upper || !nextMinimum || !new Prisma.Decimal(upper).eq(nextMinimum)) {
        errors.push(`میان سطح «${threshold.titleFa}» و سطح بعدی شکاف یا هم‌پوشانی وجود دارد.`);
      }
    }
  });
  if (content.thresholds[0]?.minimum !== '0.000000'
    || content.thresholds.at(-1)?.maximumInclusive !== '100.000000') {
    errors.push('سیاست سطح‌بندی باید تمام بازه دقیق صفر تا صد را پوشش دهد.');
  }
  return [...new Set(errors)];
};

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1_000;
const tehranDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
};

export const nextTehranDayStart = (now: Date) => {
  const local = tehranDateParts(now);
  return new Date(Date.UTC(local.year, local.month - 1, local.day + 1) - TEHRAN_OFFSET_MS);
};

export const validatePerformancePublication = (input: {
  now: Date;
  effectiveFrom: Date;
  reason: string;
}): string[] => {
  const errors: string[] = [];
  if (input.reason.trim().length < 8) errors.push('دلیل انتشار باید روشن و قابل حسابرسی باشد.');
  if (!Number.isFinite(input.effectiveFrom.getTime())) {
    errors.push('تاریخ اثر معتبر نیست.');
    return errors;
  }
  if (input.effectiveFrom.getTime() !== nextTehranDayStart(input.now).getTime()
    && input.effectiveFrom.getTime() < nextTehranDayStart(input.now).getTime()) {
    errors.push('تاریخ اثر باید ابتدای روز آینده تهران یا یک روز پس از آن باشد.');
  }
  const parts = tehranDateParts(input.effectiveFrom);
  const localStart = new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - TEHRAN_OFFSET_MS);
  if (input.effectiveFrom.getTime() !== localStart.getTime()) {
    errors.push('تاریخ اثر باید دقیقاً از ابتدای روز انتخابی به وقت تهران آغاز شود.');
  }
  return errors;
};

const LEVEL_ORDER = new Map<string, number>(EXPECTED_LEVELS.map(([code], index) => [code, index]));

export type PolicyPreviewSubject = {
  subjectId: string;
  before: { state: string; levelCode: string | null } | null;
  after: { state: string; levelCode: string | null; reason?: string } | null;
  error?: string;
};

export const buildDeterministicPolicyPreview = (subjects: PolicyPreviewSubject[]) => {
  const population = [...subjects].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
  const counts = {
    eligible: population.length,
    evaluated: population.length,
    increased: 0,
    decreased: 0,
    unchanged: 0,
    expired: 0,
    needsNewEvaluation: 0,
    errors: 0,
  };
  for (const subject of population) {
    if (subject.error || !subject.after) {
      counts.errors += 1;
      continue;
    }
    if (subject.after.reason === 'EXPIRY') {
      counts.expired += 1;
      continue;
    }
    if (subject.after.state === 'NEEDS_NEW_EVALUATION') {
      counts.needsNewEvaluation += 1;
      continue;
    }
    const beforeOrder = subject.before?.levelCode ? LEVEL_ORDER.get(subject.before.levelCode) : undefined;
    const afterOrder = subject.after.levelCode ? LEVEL_ORDER.get(subject.after.levelCode) : undefined;
    if (beforeOrder !== undefined && afterOrder !== undefined && afterOrder > beforeOrder) counts.increased += 1;
    else if (beforeOrder !== undefined && afterOrder !== undefined && afterOrder < beforeOrder) counts.decreased += 1;
    else counts.unchanged += 1;
  }
  return { population, counts, resultHash: canonicalPerformanceHash(population) };
};
