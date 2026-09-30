export type PerformanceLevelCode = 'COMPANION' | 'DILIGENT' | 'WORTHY' | 'CAPABLE' | 'SUPERIOR' | 'EXCELLENT' | 'ROLE_MODEL';
export type PerformanceLevelTone = 'danger' | 'warning' | 'success' | 'primary' | 'purple' | 'neutral';

export type PerformanceBadgeSummary = {
  state: 'UNEVALUATED' | 'NEEDS_NEW_EVALUATION' | 'LEVEL' | 'TEMPORARILY_UNAVAILABLE';
  levelCode?: PerformanceLevelCode;
  labelFa: string;
  meaningFa: string;
  newestMeasurementTo?: string;
  nextReviewAt?: string;
  version: number;
  officialResult?: boolean;
  ordinal?: number;
  stoneFamily?: 'TURQUOISE' | 'RUBY' | 'DIAMOND';
  romanNumeral?: 'I' | 'II' | 'III';
  lightAsset?: string;
  darkAsset?: string;
  presentationVersion?: 'roman-v1' | string;
  details?: {
    evaluationId?: string; status?: 'PENDING_APPEAL' | 'FINAL'; score: string | null; behavioralScore: string | null; performanceScore: string | null; evaluationDate: string;
    periodLabelFa?: string | null; measurementFrom?: string | null; measurementTo?: string | null; nextReviewAt?: string | null;
    surveyAggregateScore?: string | null;
    strength?: { titleFa: string; score?: string | null } | null;
    improvement?: { titleFa: string; score?: string | null } | null;
    appeal?: { deadline: string | null; submittedAt: string | null; text?: string | null; resolution?: string | null; canSubmit: boolean; endpoint: string } | null;
    factors: Array<{
      code: string; titleFa: string; familyCode?: string | null; sourceKind: string;
      weightPercent: string; actual: string; target: string; unitFa: string;
      sampleCount?: number | null; sourceReference?: string | null; score?: string | null;
    }>;
  } | null;
};

const levelTones = {
  COMPANION: 'neutral', DILIGENT: 'warning', WORTHY: 'success', CAPABLE: 'success',
  SUPERIOR: 'primary', EXCELLENT: 'purple', ROLE_MODEL: 'purple',
} as const;

export const PERFORMANCE_BADGE_ROADMAP = [
  { code: 'COMPANION', labelFa: 'همراه', meaningFa: 'با ماست', romanNumeral: 'I', assetNumber: '01' },
  { code: 'DILIGENT', labelFa: 'هم‌ریشه', meaningFa: 'از ماست', romanNumeral: 'II', assetNumber: '02' },
  { code: 'WORTHY', labelFa: 'کارساز', meaningFa: 'به کار ما می‌آید', romanNumeral: 'III', assetNumber: '03' },
  { code: 'CAPABLE', labelFa: 'مانا', meaningFa: 'با ما می‌ماند', romanNumeral: 'I', assetNumber: '04' },
  { code: 'SUPERIOR', labelFa: 'ستون', meaningFa: 'تکیه‌گاه ماست', romanNumeral: 'II', assetNumber: '05' },
  { code: 'EXCELLENT', labelFa: 'اثرگذار', meaningFa: 'ما را بهتر می‌کند', romanNumeral: 'I', assetNumber: '06' },
  { code: 'ROLE_MODEL', labelFa: 'الگو', meaningFa: 'آن‌گونه که باید باشی', romanNumeral: 'II', assetNumber: '07' },
] as const;

export const performanceLevelTone = (levelCode: string): PerformanceLevelTone =>
  levelTones[levelCode as PerformanceLevelCode] ?? 'neutral';

export const performanceBadgePresentation = (badge: PerformanceBadgeSummary) => {
  if (badge.presentationVersion === 'roman-v1' && badge.lightAsset && badge.darkAsset) return {
    labelFa: badge.labelFa,
    meaningFa: badge.meaningFa,
    tone: performanceLevelTone(badge.levelCode ?? ''),
    lightAsset: badge.lightAsset,
    darkAsset: badge.darkAsset,
    imageFilter: undefined,
    ordinal: badge.ordinal,
    stoneFamily: badge.stoneFamily,
    romanNumeral: badge.officialResult === false ? undefined : badge.romanNumeral,
    presentationVersion: badge.presentationVersion,
    neutral: false,
  };
  const level = badge.state === 'LEVEL' && badge.levelCode
    ? PERFORMANCE_BADGE_ROADMAP.find(({ code }) => code === badge.levelCode) : undefined;
  return {
    labelFa: badge.labelFa,
    meaningFa: badge.meaningFa,
    tone: performanceLevelTone(badge.levelCode ?? ''),
    lightAsset: level ? `/assets/performance-rank-badges-roman-v1/light/rank-${level.assetNumber}.png` : '/assets/performance-rank-badges-v2/light/neutral-frame.png',
    darkAsset: level ? `/assets/performance-rank-badges-roman-v1/dark/rank-${level.assetNumber}.png` : '/assets/performance-rank-badges-v2/dark/neutral-frame.png',
    imageFilter: undefined,
    romanNumeral: badge.officialResult === false ? undefined : level?.romanNumeral,
    presentationVersion: undefined,
    neutral: !level,
  };
};
