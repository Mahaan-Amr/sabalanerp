import { Prisma } from '@prisma/client';

export type SimplePerformanceDirection = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
export type SimplePerformanceLevel = 'URGENT_IMPROVEMENT' | 'NEEDS_IMPROVEMENT'
  | 'MEETS_EXPECTATIONS' | 'EXCEEDS_EXPECTATIONS' | 'OUTSTANDING';
export type SimpleEvaluatorAuthority = 'SUPERVISOR' | 'HR_MANAGER';

export type SimplePerformanceInput = {
  indicatorId: string;
  direction: SimplePerformanceDirection;
  target: string;
  actual: string | null;
  weightPercent: string;
};

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const ZERO = decimal(0);
const HUNDRED = decimal(100);
const storedScore = (value: Prisma.Decimal.Value) => decimal(value).toDecimalPlaces(18, Prisma.Decimal.ROUND_DOWN).toFixed(18);

const performanceLevel = (score: Prisma.Decimal, exactlyOutstanding: boolean): SimplePerformanceLevel => {
  if (exactlyOutstanding) return 'OUTSTANDING';
  if (score.gte(90)) return 'EXCEEDS_EXPECTATIONS';
  if (score.gte(75)) return 'MEETS_EXPECTATIONS';
  if (score.gte(60)) return 'NEEDS_IMPROVEMENT';
  return 'URGENT_IMPROVEMENT';
};

export const calculateSimplePerformance = (inputs: SimplePerformanceInput[]) => {
  if (!inputs.length) throw new Error('حداقل یک معیار لازم است.');
  if (inputs.some(({ actual }) => actual === null || actual.trim() === '')) throw new Error('همه مقدارها را وارد کنید.');
  const weights = inputs.map(({ weightPercent }) => decimal(weightPercent));
  if (weights.some((weight) => weight.lte(ZERO)) || !weights.reduce((sum, weight) => sum.add(weight), ZERO).eq(HUNDRED)) {
    throw new Error('جمع وزن‌ها باید ۱۰۰ درصد باشد.');
  }

  const indicators = inputs.map((input) => {
    const target = decimal(input.target);
    const actual = decimal(input.actual!);
    if (target.lt(ZERO) || actual.lt(ZERO) || (input.direction === 'HIGHER_IS_BETTER' && target.eq(ZERO))) {
      throw new Error('هدف و مقدار واقعی معتبر نیست.');
    }
    let score: Prisma.Decimal;
    let reachedTarget: boolean;
    if (input.direction === 'HIGHER_IS_BETTER') {
      reachedTarget = actual.gte(target);
      score = actual.div(target).mul(HUNDRED);
    } else if (target.eq(ZERO)) {
      reachedTarget = actual.eq(ZERO);
      score = reachedTarget ? HUNDRED : ZERO;
    } else {
      reachedTarget = actual.lte(target);
      score = actual.eq(ZERO) ? HUNDRED : target.div(actual).mul(HUNDRED);
    }
    score = Prisma.Decimal.min(HUNDRED, score);
    return {
      indicatorId: input.indicatorId,
      score: storedScore(score),
      contribution: score.mul(input.weightPercent).div(HUNDRED),
      reachedTarget,
    };
  });
  const exactScore = indicators.reduce((sum, item) => sum.add(item.contribution), ZERO);
  const exactlyOutstanding = indicators.every(({ reachedTarget }) => reachedTarget);
  const safeScore = !exactlyOutstanding && exactScore.gte(HUNDRED)
    ? decimal('99.999999999999999999')
    : exactScore;
  return {
    score: storedScore(safeScore),
    level: performanceLevel(safeScore, exactlyOutstanding),
    indicators: indicators.map(({ contribution: _contribution, reachedTarget: _reachedTarget, ...item }) => item),
  };
};

export const canEvaluatePersonnel = (input: {
  hasEvaluateAll: boolean;
  hasEvaluateDirectReports: boolean;
  isResponsibleSupervisor: boolean;
}): SimpleEvaluatorAuthority | null => {
  if (input.hasEvaluateAll) return 'HR_MANAGER';
  if (input.hasEvaluateDirectReports && input.isResponsibleSupervisor) return 'SUPERVISOR';
  return null;
};

const dateInTehran = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const persianMonthInTehran = (date: Date) => new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit',
}).format(date);

export const validateSimpleEvaluationDate = (value: string, now = new Date()): { valid: boolean; message?: string } => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(value)) {
    return { valid: false, message: 'تاریخ ارزیابی معتبر نیست.' };
  }
  const today = dateInTehran(now);
  if (value > today) return { valid: false, message: 'تاریخ آینده مجاز نیست.' };
  if (persianMonthInTehran(parsed) !== persianMonthInTehran(now)) return { valid: false, message: 'تاریخ باید در ماه جاری باشد.' };
  return { valid: true };
};

export const SIMPLE_PERFORMANCE_LEVEL_LABELS: Record<SimplePerformanceLevel, string> = {
  URGENT_IMPROVEMENT: 'نیازمند بهبود فوری',
  NEEDS_IMPROVEMENT: 'نیازمند بهبود',
  MEETS_EXPECTATIONS: 'مطابق انتظار',
  EXCEEDS_EXPECTATIONS: 'فراتر از انتظار',
  OUTSTANDING: 'عملکرد برجسته',
};
