import { Prisma } from '@prisma/client';

export type SellerPerformanceLevelCode =
  | 'COMPANION'
  | 'DILIGENT'
  | 'WORTHY'
  | 'CAPABLE'
  | 'SUPERIOR'
  | 'EXCELLENT'
  | 'ROLE_MODEL';

export type SellerPerformanceFactorInput = {
  factorCode: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'CAPPED_RATE';
  target: string;
  actual: string;
  weightPercent: string;
};

export type BehaviorSurveyScore = {
  respondentPersonnelId: string;
  targetPersonnelId: string;
  factorCode: string;
  score: number;
};

export const SELLER_PERFORMANCE_LEVEL_LABELS: Record<SellerPerformanceLevelCode, string> = {
  COMPANION: 'همراه',
  DILIGENT: 'کوشا',
  WORTHY: 'شایسته',
  CAPABLE: 'توانمند',
  SUPERIOR: 'برتر',
  EXCELLENT: 'سرآمد',
  ROLE_MODEL: 'الگو',
};

export const SELLER_PERFORMANCE_FACTORS = [
  { code: 'NET_CONTRACT_VALUE', familyCode: 'SALES_CONTRIBUTION', titleFa: 'ارزش خالص قراردادهای نهایی‌شده نسبت به هدف', weightPercent: 14, direction: 'HIGHER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 1 },
  { code: 'ACTUAL_RECEIVED_CASH', familyCode: 'SALES_CONTRIBUTION', titleFa: 'وجه وصول‌شده واقعی منتسب به فروشنده', weightPercent: 8, direction: 'HIGHER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 1 },
  { code: 'DUE_COLLECTION_RATE', familyCode: 'COLLECTION', titleFa: 'نرخ وصول تعهدهای سررسیدشده', weightPercent: 5, direction: 'CAPPED_RATE', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'ON_TIME_COLLECTION_FOLLOWUP', familyCode: 'COLLECTION', titleFa: 'پیگیری به‌موقع وصول وجه', weightPercent: 6, direction: 'CAPPED_RATE', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'RECEIVABLES_WITHOUT_FOLLOWUP', familyCode: 'COLLECTION', titleFa: 'مطالبات بدون پیگیری معتبر', weightPercent: 4, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'FIRST_VALID_SUBMISSION_TIME', familyCode: 'CONTRACT_SPEED', titleFa: 'زمان تحت کنترل فروشنده تا نخستین ارسال معتبر', weightPercent: 3, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'ACTIVE_CORRECTION_TIME', familyCode: 'CONTRACT_SPEED', titleFa: 'زمان فعال اصلاح قرارداد توسط فروشنده', weightPercent: 2, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'SIGNED_TO_ACCOUNTING_TIME', familyCode: 'CONTRACT_SPEED', titleFa: 'زمان امضا تا ارسال معتبر به حسابداری', weightPercent: 3, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'FIRST_PASS_ACCEPTANCE', familyCode: 'CONTRACT_QUALITY', titleFa: 'پذیرش قرارداد در نخستین ارسال', weightPercent: 3, direction: 'CAPPED_RATE', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'SELLER_ATTRIBUTABLE_CORRECTIONS', familyCode: 'CONTRACT_QUALITY', titleFa: 'اصلاحات منتسب به فروشنده', weightPercent: 2, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'COMPLEX_CASE_HANDLING', familyCode: 'CONTRACT_QUALITY', titleFa: 'رسیدگی حرفه‌ای به پرونده‌های پیچیده قرارداد', weightPercent: 2, direction: 'CAPPED_RATE', sourceKind: 'SUPERVISOR', minimumSampleCount: 1 },
  { code: 'SELLER_ATTRIBUTABLE_CANCELLATION', familyCode: 'CANCELLATION_RETURN', titleFa: 'نرخ لغو منتسب به فروشنده', weightPercent: 3, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'SELLER_ATTRIBUTABLE_RETURN', familyCode: 'CANCELLATION_RETURN', titleFa: 'نرخ مرجوعی یا برگشت منتسب به فروشنده', weightPercent: 2, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'VALID_NEW_CUSTOMERS', familyCode: 'CUSTOMER_OPPORTUNITY', titleFa: 'مشتریان جدید معتبر', weightPercent: 2, direction: 'HIGHER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 1 },
  { code: 'DECIDED_OPPORTUNITY_CONVERSION', familyCode: 'CUSTOMER_OPPORTUNITY', titleFa: 'نرخ تبدیل فرصت‌های تعیین‌تکلیف‌شده', weightPercent: 2, direction: 'CAPPED_RATE', sourceKind: 'SYSTEM', minimumSampleCount: 5 },
  { code: 'STALE_OPPORTUNITIES', familyCode: 'CUSTOMER_OPPORTUNITY', titleFa: 'فرصت‌های راکد بدون اقدام', weightPercent: 1, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 5 },
  { code: 'CUSTOMER_OPPORTUNITY_JUDGMENT', familyCode: 'CUSTOMER_OPPORTUNITY', titleFa: 'مدیریت مسئولانه مشتری و فرصت فروش', weightPercent: 3, direction: 'CAPPED_RATE', sourceKind: 'SUPERVISOR', minimumSampleCount: 1 },
  { code: 'DELIVERY_PROMISE_ACCURACY', familyCode: 'DELIVERY_COMMITMENT', titleFa: 'دقت وعده‌های تحویل فروشنده', weightPercent: 2, direction: 'CAPPED_RATE', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'SELLER_ATTRIBUTABLE_DELIVERY_ISSUE', familyCode: 'DELIVERY_COMMITMENT', titleFa: 'مشکلات تحویل منتسب به فروشنده', weightPercent: 1, direction: 'LOWER_IS_BETTER', sourceKind: 'SYSTEM', minimumSampleCount: 3 },
  { code: 'DELIVERY_COMMITMENT_JUDGMENT', familyCode: 'DELIVERY_COMMITMENT', titleFa: 'واقع‌بینی در تعهدهای تحویل', weightPercent: 2, direction: 'CAPPED_RATE', sourceKind: 'SUPERVISOR', minimumSampleCount: 1 },
] as const;

export const COMMON_BEHAVIOR_FACTORS = [
  { code: 'RESPECT', titleFa: 'رفتار محترمانه و حرفه‌ای', weightPercent: 4 },
  { code: 'TEAMWORK', titleFa: 'همکاری و کار تیمی', weightPercent: 4 },
  { code: 'ACCOUNTABILITY', titleFa: 'مسئولیت‌پذیری و پیگیری', weightPercent: 5 },
  { code: 'COMMUNICATION', titleFa: 'ارتباط روشن و مؤثر', weightPercent: 3 },
  { code: 'LEARNING', titleFa: 'یادگیری و پذیرش بازخورد', weightPercent: 3 },
  { code: 'WORKPLACE_STANDARD', titleFa: 'پوشش، آراستگی و استاندارد مصوب محیط کار', weightPercent: 2 },
  { code: 'ATTENDANCE', titleFa: 'رعایت برنامه حضور', weightPercent: 5 },
  { code: 'PUNCTUALITY', titleFa: 'وقت‌شناسی و تأخیر غیرموجه', weightPercent: 4 },
] as const;

const supervisorBehaviorWeights = ['2.2857', '2.2857', '2.8571', '1.7143', '1.7143', '1.1429'] as const;
export const SELLER_EVALUATION_TEMPLATE = [
  ...SELLER_PERFORMANCE_FACTORS.map((factor) => ({
    ...factor, weightPercent: String(factor.weightPercent), unitFa: factor.direction === 'LOWER_IS_BETTER' ? 'مقدار' : 'درصد/هدف',
  })),
  ...COMMON_BEHAVIOR_FACTORS.slice(0, 6).map((factor, index) => ({
    code: `SUPERVISOR_${factor.code}`, familyCode: 'BEHAVIOR', titleFa: `${factor.titleFa} ـ ارزیابی سرپرست`,
    weightPercent: supervisorBehaviorWeights[index], direction: 'CAPPED_RATE' as const, sourceKind: 'SUPERVISOR' as const,
    minimumSampleCount: 1, unitFa: 'امتیاز از ۱۰۰',
  })),
  ...COMMON_BEHAVIOR_FACTORS.slice(0, 6).map((factor) => ({
    code: `SURVEY_${factor.code}`, familyCode: 'BEHAVIOR', titleFa: `${factor.titleFa} ـ نظرسنجی همکاران`,
    weightPercent: '1.5', direction: 'CAPPED_RATE' as const, sourceKind: 'SURVEY' as const,
    minimumSampleCount: 3, unitFa: 'امتیاز از ۱۰۰',
  })),
  { code: 'SYSTEM_ATTENDANCE', familyCode: 'BEHAVIOR', titleFa: 'رعایت برنامه حضور', weightPercent: '5', direction: 'CAPPED_RATE' as const, sourceKind: 'SYSTEM' as const, minimumSampleCount: 1, unitFa: 'درصد' },
  { code: 'SYSTEM_PUNCTUALITY', familyCode: 'BEHAVIOR', titleFa: 'وقت‌شناسی و تأخیر غیرموجه', weightPercent: '4', direction: 'CAPPED_RATE' as const, sourceKind: 'SYSTEM' as const, minimumSampleCount: 1, unitFa: 'درصد' },
] as const;

const ZERO = new Prisma.Decimal(0);
const TWENTY_FIVE = new Prisma.Decimal(25);
const SEVENTY_FIVE = new Prisma.Decimal(75);
const HUNDRED = new Prisma.Decimal(100);
const ONE_HUNDRED_TWENTY = new Prisma.Decimal(120);

const stored = (value: Prisma.Decimal) => value.toDecimalPlaces(18, Prisma.Decimal.ROUND_DOWN).toFixed(18);

export const sellerPerformanceLevel = (score: Prisma.Decimal.Value): SellerPerformanceLevelCode => {
  const value = new Prisma.Decimal(score);
  if (value.gte(97)) return 'ROLE_MODEL';
  if (value.gte(90)) return 'EXCELLENT';
  if (value.gte(80)) return 'SUPERIOR';
  if (value.gte(70)) return 'CAPABLE';
  if (value.gte(60)) return 'WORTHY';
  if (value.gte(50)) return 'DILIGENT';
  return 'COMPANION';
};

const lowerLevel = (left: SellerPerformanceLevelCode, right: SellerPerformanceLevelCode) => {
  const order: SellerPerformanceLevelCode[] = ['COMPANION', 'DILIGENT', 'WORTHY', 'CAPABLE', 'SUPERIOR', 'EXCELLENT', 'ROLE_MODEL'];
  return order[Math.min(order.indexOf(left), order.indexOf(right))];
};

export const applySellerPerformanceGates = (input: {
  score: Prisma.Decimal.Value;
  behavioralScore: Prisma.Decimal.Value;
  collectionScore: Prisma.Decimal.Value;
  qualityScore: Prisma.Decimal.Value;
  sufficientEvidence: boolean;
  confirmedSeriousViolation: boolean;
  primaryFamilyScores: Prisma.Decimal.Value[];
}) => {
  let level = sellerPerformanceLevel(input.score);
  if (new Prisma.Decimal(input.behavioralScore).lt(70)) level = lowerLevel(level, 'CAPABLE');
  if (new Prisma.Decimal(input.collectionScore).lt(75) || new Prisma.Decimal(input.qualityScore).lt(75)) {
    level = lowerLevel(level, 'SUPERIOR');
  }
  if (!input.sufficientEvidence || input.confirmedSeriousViolation
    || new Prisma.Decimal(input.behavioralScore).lt(90)
    || input.primaryFamilyScores.some((score) => new Prisma.Decimal(score).lt(60))) {
    level = lowerLevel(level, 'EXCELLENT');
  }
  return level;
};

export const sellerPerformancePeriodFor = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
    timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric',
  }).formatToParts(date);
  const persianYear = Number(parts.find(({ type }) => type === 'year')?.value);
  const month = Number(parts.find(({ type }) => type === 'month')?.value);
  if (!Number.isInteger(persianYear) || !Number.isInteger(month)) throw new Error('تاریخ دوره معتبر نیست.');
  const half = month <= 6 ? 1 : 2;
  return {
    persianYear,
    half,
    key: `${persianYear}-H${half}`,
    labelFa: half === 1 ? `فروردین تا شهریور ${persianYear.toLocaleString('fa-IR', { useGrouping: false })}`
      : `مهر تا اسفند ${persianYear.toLocaleString('fa-IR', { useGrouping: false })}`,
  } as const;
};

const utcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

export const sellerPerformancePeriodWindowFor = (date: Date) => {
  const period = sellerPerformancePeriodFor(date);
  let from = utcDay(date);
  let to = utcDay(date);
  while (sellerPerformancePeriodFor(new Date(from.getTime() - 86_400_000)).key === period.key) {
    from = new Date(from.getTime() - 86_400_000);
  }
  while (sellerPerformancePeriodFor(new Date(to.getTime() + 86_400_000)).key === period.key) {
    to = new Date(to.getTime() + 86_400_000);
  }
  return { ...period, from, to };
};

const higherIsBetter = (actual: Prisma.Decimal, target: Prisma.Decimal) => {
  if (target.lte(ZERO)) throw new Error('هدف باید بیشتر از صفر باشد.');
  if (actual.lte(target)) return actual.div(target).mul(SEVENTY_FIVE);
  return SEVENTY_FIVE.add(actual.div(target).mul(HUNDRED).sub(HUNDRED).div(20).mul(TWENTY_FIVE));
};

const factorScore = (input: SellerPerformanceFactorInput) => {
  const actual = new Prisma.Decimal(input.actual);
  const target = new Prisma.Decimal(input.target);
  if (actual.lt(ZERO) || target.lt(ZERO)) throw new Error('هدف و مقدار واقعی معتبر نیست.');
  if (input.direction === 'HIGHER_IS_BETTER') return higherIsBetter(actual, target);
  if (input.direction === 'CAPPED_RATE') {
    if (target.gte(HUNDRED) || target.lte(ZERO)) throw new Error('هدف نرخ باید بین صفر و صد باشد.');
    if (actual.lte(target)) return actual.div(target).mul(SEVENTY_FIVE);
    return SEVENTY_FIVE.add(actual.sub(target).div(HUNDRED.sub(target)).mul(TWENTY_FIVE));
  }
  if (target.eq(ZERO)) return actual.eq(ZERO) ? HUNDRED : ZERO;
  if (actual.lte(target)) return HUNDRED.sub(actual.div(target).mul(TWENTY_FIVE));
  return SEVENTY_FIVE.sub(actual.div(target).sub(1).mul(SEVENTY_FIVE));
};

export const calculateSellerPerformance = (inputs: SellerPerformanceFactorInput[]) => {
  if (!inputs.length) throw new Error('حداقل یک عامل لازم است.');
  const totalWeight = inputs.reduce((sum, input) => sum.add(input.weightPercent), ZERO);
  if (!totalWeight.eq(HUNDRED)) throw new Error('جمع وزن‌ها باید ۱۰۰ درصد باشد.');
  const factors = inputs.map((input) => {
    const score = Prisma.Decimal.max(ZERO, Prisma.Decimal.min(HUNDRED, factorScore(input)));
    return { factorCode: input.factorCode, score: stored(score) };
  });
  const total = factors.reduce((sum, factor, index) => (
    sum.add(new Prisma.Decimal(factor.score).mul(inputs[index].weightPercent).div(HUNDRED))
  ), ZERO);
  return { score: stored(total), levelCode: sellerPerformanceLevel(total), factors };
};

export const redistributeSellerFactorWeights = (factors: Array<{
  factorCode: string;
  familyCode: string;
  weightPercent: string;
  minimumSampleCount: number;
  sampleCount: number | null;
  actual: string | null;
}>) => {
  const byFamily = new Map<string, typeof factors>();
  for (const factor of factors) byFamily.set(factor.familyCode, [...(byFamily.get(factor.familyCode) ?? []), factor]);
  const effective = new Map<string, string>();
  for (const [familyCode, family] of byFamily) {
    const familyWeight = family.reduce((sum, factor) => sum.add(factor.weightPercent), ZERO);
    const valid = family.filter((factor) => factor.actual !== null
      && factor.sampleCount !== null && factor.sampleCount >= factor.minimumSampleCount);
    if (!valid.length) throw new Error(`خانواده اصلی ${familyCode} شواهد کافی ندارد.`);
    const validWeight = valid.reduce((sum, factor) => sum.add(factor.weightPercent), ZERO);
    for (const factor of valid) effective.set(factor.factorCode, stored(
      new Prisma.Decimal(factor.weightPercent).div(validWeight).mul(familyWeight),
    ));
  }
  return factors.flatMap((factor) => {
    const effectiveWeightPercent = effective.get(factor.factorCode);
    return effectiveWeightPercent ? [{ factorCode: factor.factorCode, effectiveWeightPercent }] : [];
  });
};

export const aggregateBehaviorSurveyScores = (answers: BehaviorSurveyScore[]) => {
  const perRespondent = new Map<string, { targetPersonnelId: string; factorCode: string; scores: number[] }>();
  for (const answer of answers) {
    if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > 100) {
      throw new Error('امتیاز پاسخ معتبر نیست.');
    }
    if (answer.respondentPersonnelId === answer.targetPersonnelId) throw new Error('خودارزیابی مجاز نیست.');
    const key = `${answer.respondentPersonnelId}\u0000${answer.targetPersonnelId}\u0000${answer.factorCode}`;
    const current = perRespondent.get(key) ?? {
      targetPersonnelId: answer.targetPersonnelId,
      factorCode: answer.factorCode,
      scores: [],
    };
    current.scores.push(answer.score);
    perRespondent.set(key, current);
  }
  const perFactor = new Map<string, { targetPersonnelId: string; factorCode: string; peerScores: number[] }>();
  for (const value of perRespondent.values()) {
    const key = `${value.targetPersonnelId}\u0000${value.factorCode}`;
    const current = perFactor.get(key) ?? { ...value, peerScores: [] };
    current.peerScores.push(value.scores.reduce((sum, score) => sum + score, 0) / value.scores.length);
    perFactor.set(key, current);
  }
  return [...perFactor.values()].map(({ targetPersonnelId, factorCode, peerScores }) => ({
    targetPersonnelId,
    factorCode,
    respondentCount: peerScores.length,
    score: peerScores.reduce((sum, score) => sum + score, 0) / peerScores.length,
    sufficient: peerScores.length >= 3,
  }));
};
