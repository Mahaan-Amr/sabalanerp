export const PERFORMANCE_LEVELS = [
  { code: 'URGENT_IMPROVEMENT', labelFa: 'نیازمند بهبود فوری', meaningFa: 'عملکرد مصوب به‌طور جدی پایین‌تر از انتظارهای نقش بوده است.' },
  { code: 'IMPROVEMENT_NEEDED', labelFa: 'نیازمند بهبود', meaningFa: 'عملکرد مصوب در بخشی از انتظارهای نقش نیازمند بهبود است.' },
  { code: 'MEETS_EXPECTATIONS', labelFa: 'مطابق انتظار', meaningFa: 'عملکرد مصوب با انتظارهای نقش هم‌خوان است.' },
  { code: 'EXCEEDS_EXPECTATIONS', labelFa: 'فراتر از انتظار', meaningFa: 'عملکرد مصوب در مجموع فراتر از انتظارهای نقش بوده است.' },
  { code: 'OUTSTANDING', labelFa: 'عملکرد برجسته', meaningFa: 'عملکرد مصوب به‌شکلی پایدار و برجسته فراتر از انتظارهای نقش بوده است.' },
] as const;

type ProjectionState = 'UNEVALUATED' | 'NEEDS_NEW_EVALUATION' | 'LEVEL' | 'TEMPORARILY_UNAVAILABLE';

const neutralProjection: Record<Exclude<ProjectionState, 'LEVEL'>, { labelFa: string; meaningFa: string }> = {
  UNEVALUATED: { labelFa: 'ارزیابی‌نشده', meaningFa: 'هنوز نتیجه مصوب امتیازداری برای این رابطه استخدامی وجود ندارد.' },
  NEEDS_NEW_EVALUATION: { labelFa: 'نیازمند ارزیابی جدید', meaningFa: 'اعتبار همه نتایج مؤثر پایان یافته و ارزیابی تازه لازم است.' },
  TEMPORARILY_UNAVAILABLE: { labelFa: 'خلاصه عملکرد موقتاً در دسترس نیست', meaningFa: 'عملیات منابع انسانی از اختلال آگاه شده و بازیابی در حال پیگیری است.' },
};

export const buildPerformanceBadgeSummary = (projection: {
  state: ProjectionState;
  levelCode?: string | null;
  newestMeasurementTo?: Date | null;
  nextReviewAt?: Date | null;
  version: number;
}) => {
  const level = projection.state === 'LEVEL'
    ? PERFORMANCE_LEVELS.find(({ code }) => code === projection.levelCode)
    : null;
  const presentation = level ?? neutralProjection[projection.state as Exclude<ProjectionState, 'LEVEL'>]
    ?? neutralProjection.TEMPORARILY_UNAVAILABLE;
  return {
    state: level ? 'LEVEL' as const : projection.state,
    ...(level ? { levelCode: level.code } : {}),
    labelFa: presentation.labelFa,
    meaningFa: presentation.meaningFa,
    ...(projection.newestMeasurementTo ? { newestMeasurementTo: projection.newestMeasurementTo.toISOString() } : {}),
    ...(projection.nextReviewAt ? { nextReviewAt: projection.nextReviewAt.toISOString() } : {}),
    version: projection.version,
  };
};

export type PerformanceAnalyticsMember = {
  subjectId: string;
  personnelId: string;
  displayName: string;
  employmentRelationshipId: string;
  levelCode: string;
  comparabilitySignature: string;
  peerGroupKey: string;
  measurementTo: Date;
  exactScore?: number;
};

// A single calendar quarter is the release unit. Overlapping unions of months
// would disclose small differences even when each individual report is safe.
export const performanceReportingQuarter = (from?: Date, to?: Date, now = new Date()) => {
  const currentQuarter = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const start = from ?? new Date(Date.UTC(currentQuarter.getUTCFullYear(), currentQuarter.getUTCMonth() - 3, 1));
  const end = to ?? currentQuarter;
  if (Boolean(from) !== Boolean(to) || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())
    || start.getUTCMonth() % 3 !== 0 || start.getUTCDate() !== 1 || start.getUTCHours() || start.getUTCMinutes() || start.getUTCSeconds() || start.getUTCMilliseconds()
    || end.getTime() !== Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1)) {
    throw Object.assign(new Error('گزارش فقط برای یک فصل تقویمی کامل قابل نمایش است.'), { status: 422, code: 'PERFORMANCE_ANALYTICS_STABLE_PERIOD_REQUIRED' });
  }
  return { from: start, to: end };
};

export const performanceReportingMonths = (from: Date, to: Date) => {
  const keys: string[] = [];
  for (let month = new Date(from); month < to; month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))) {
    keys.unshift(month.toISOString().slice(0, 7));
  }
  return keys;
};

export const latestPerformancePeerFamilies = <T extends { familyKey: string; version: number }>(families: readonly T[]) => {
  const latest = new Map<string, T>();
  for (const family of families) if ((latest.get(family.familyKey)?.version ?? 0) < family.version) latest.set(family.familyKey, family);
  return [...latest.values()];
};

export const performancePeerFamilyKey = (jobId: string, families: readonly { familyKey: string; version: number }[]) => {
  const latest = new Map<string, number>();
  for (const family of families) latest.set(family.familyKey, Math.max(latest.get(family.familyKey) ?? 0, family.version));
  if (latest.size > 1) return null;
  const family = [...latest][0];
  return family ? `${family[0]}:v${family[1]}` : `job:${jobId}`;
};

const suppressed = (reasonCode: string, messageFa = 'برای نمایش این گزارش، جمعیت واجد شرایط کافی نیست.') => ({
  suppressed: true as const,
  reasonCode,
  messageFa,
});

export type PerformanceAnalyticsResult =
  | { suppressed: true; reasonCode: string; messageFa: string }
  | {
      suppressed: false;
      eligibleCount: number;
      levelDistribution: Array<{ levelCode: string; labelFa: string; count: number; percent: number }>;
      exactScoreStatistics: { average: number } | null;
    }
  | {
      suppressed: false;
      eligibleCount: number;
      peerGroups: Array<{ peerGroupKey: string; groups: Array<{
        levelCode: string;
        labelFa: string;
        members: Array<{ personnelId: string; displayName: string; employmentRelationshipId: string; measurementTo: string }>;
      }> }>;
    };

export const buildPerformanceAnalytics = (input: {
  population: readonly PerformanceAnalyticsMember[];
  selected: readonly PerformanceAnalyticsMember[];
  mode?: 'AGGREGATE' | 'NAMED_RANKING';
}): PerformanceAnalyticsResult => {
  const mode = input.mode ?? 'AGGREGATE';
  const minimum = mode === 'NAMED_RANKING' ? 5 : 10;
  if (input.selected.length < minimum) return suppressed(mode === 'NAMED_RANKING' ? 'NAMED_POPULATION_TOO_SMALL' : 'AGGREGATE_POPULATION_TOO_SMALL');
  const complement = input.population.length - input.selected.length;
  if (complement > 0 && complement < 10) {
    return suppressed('COMPLEMENTARY_GROUP_TOO_SMALL', 'این فیلتر به‌دلیل حفاظت از محرمانگی قابل نمایش نیست.');
  }
  if (mode === 'NAMED_RANKING') {
    const peerGroups = new Map<string, PerformanceAnalyticsMember[]>();
    for (const member of input.selected) peerGroups.set(member.peerGroupKey, [...(peerGroups.get(member.peerGroupKey) ?? []), member]);
    if ([...peerGroups.values()].some((members) => members.length < 5)) return suppressed('NAMED_PEER_GROUP_TOO_SMALL');
    return {
      suppressed: false as const,
      eligibleCount: input.selected.length,
      peerGroups: [...peerGroups].map(([peerGroupKey, members]) => ({ peerGroupKey, groups: PERFORMANCE_LEVELS.map((level) => ({
        levelCode: level.code,
        labelFa: level.labelFa,
        members: members
          .filter(({ levelCode }) => levelCode === level.code)
          .map(({ personnelId, displayName, employmentRelationshipId, measurementTo }) => ({
            personnelId,
            displayName,
            employmentRelationshipId,
            measurementTo: measurementTo.toISOString(),
          })),
      })) })),
    };
  }
  if (PERFORMANCE_LEVELS.some((level) => {
    const count = input.selected.filter(({ levelCode }) => levelCode === level.code).length;
    return count > 0 && count < 10;
  })) return suppressed('LEVEL_CELL_TOO_SMALL', 'توزیع سطح‌ها برای حفاظت از گروه‌های کوچک قابل نمایش نیست.');
  const signatures = new Set(input.selected.map(({ comparabilitySignature }) => comparabilitySignature));
  const scores = input.selected.map(({ exactScore }) => exactScore).filter((score): score is number => Number.isFinite(score));
  const exactScoreStatistics = signatures.size === 1 && scores.length === input.selected.length
    ? { average: scores.reduce((sum, score) => sum + score, 0) / scores.length }
    : null;
  return {
    suppressed: false as const,
    eligibleCount: input.selected.length,
    levelDistribution: PERFORMANCE_LEVELS.map((level) => ({
      levelCode: level.code,
      labelFa: level.labelFa,
      count: input.selected.filter(({ levelCode }) => levelCode === level.code).length,
      percent: Number((input.selected.filter(({ levelCode }) => levelCode === level.code).length * 100 / input.selected.length).toFixed(2)),
    })),
    exactScoreStatistics,
  };
};

export const buildPerformanceCalibration = (sections: readonly {
  evaluatorPersonnelId: string;
  subjectId: string;
  periodKey: string;
  comparabilitySignature: string;
  grade: number;
}[]) => {
  const subjects = new Set(sections.map(({ subjectId }) => subjectId));
  const periods = new Set(sections.map(({ periodKey }) => periodKey));
  const signatures = new Set(sections.map(({ comparabilitySignature }) => comparabilitySignature));
  if (sections.length < 10 || subjects.size < 5 || periods.size < 2 || signatures.size !== 1) {
    return {
      sufficient: false as const,
      reasonCode: 'CALIBRATION_POPULATION_INSUFFICIENT',
      messageFa: 'برای کالیبراسیون ارزیاب داده کافی وجود ندارد.',
    };
  }
  return {
    sufficient: true as const,
    acceptedSectionCount: sections.length,
    distinctPersonnelCount: subjects.size,
    distinctPeriodCount: periods.size,
    gradeDistribution: [1, 2, 3, 4, 5].map((grade) => sections.filter((section) => section.grade === grade).length),
  };
};

export const escapePerformanceSpreadsheetCell = (value: unknown) => {
  const text = String(value ?? '');
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

export const escapePerformanceExportHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

const consequenceTypes = new Set([
  'COMPENSATION_REVIEW',
  'DISCRETIONARY_BONUS_REVIEW',
  'PROMOTION_REVIEW',
  'PERFORMANCE_IMPROVEMENT_REVIEW',
  'DEMOTION_REVIEW',
]);

export type PerformanceConsequenceRule = {
  minimumResults: number;
  maximumAgeDays: number;
  requireMultiplePeriods: boolean;
  requireCompensationContext: boolean;
  allowEndedRelationship: boolean;
  requireLegalControl: boolean;
  legalControlResponsibilityTypeCode?: string;
  destination: { responsibilityTypeCode: string; workspaceCode: string; featureCode?: string; queueCode: string };
};

export const validateConsequenceHandoff = (input: {
  consequenceType: string;
  resultIds: readonly string[];
  reasonCategory: string;
  reason: string;
  independentEvidenceReferences: readonly string[];
}) => {
  const errors: string[] = [];
  if (!consequenceTypes.has(input.consequenceType)) errors.push('نوع بازبینی پیامد معتبر نیست.');
  if (!input.resultIds.length) errors.push('دست‌کم یک نتیجه مصوب باید انتخاب شود.');
  if (!input.reasonCategory.trim()) errors.push('دسته دلیل الزامی است.');
  if (input.reason.trim().length < 20) errors.push('توضیح انسانی دلیل باید دست‌کم ۲۰ نویسه باشد.');
  if (!input.independentEvidenceReferences.length) errors.push('ارجاع به شاهد مستقل الزامی است.');
  return errors;
};
