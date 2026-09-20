export type PerformanceLevelCode = 'COMPANION' | 'DILIGENT' | 'WORTHY' | 'CAPABLE' | 'SUPERIOR' | 'EXCELLENT' | 'ROLE_MODEL'
  | 'URGENT_IMPROVEMENT' | 'IMPROVEMENT' | 'IMPROVEMENT_NEEDED' | 'NEEDS_IMPROVEMENT' | 'MEETS' | 'MEETS_EXPECTATIONS' | 'EXCEEDS' | 'EXCEEDS_EXPECTATIONS' | 'OUTSTANDING';
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

const levelPresentation = {
  COMPANION: { tone: 'neutral', asset: 'agate' },
  DILIGENT: { tone: 'warning', asset: 'amber' },
  WORTHY: { tone: 'success', asset: 'emerald-v2', imageFilter: 'hue-rotate(48deg) saturate(1.2)' },
  CAPABLE: { tone: 'success', asset: 'emerald-v2' },
  SUPERIOR: { tone: 'primary', asset: 'ruby', imageFilter: 'hue-rotate(235deg) saturate(1.15)' },
  EXCELLENT: { tone: 'purple', asset: 'ruby' },
  ROLE_MODEL: { tone: 'purple', asset: 'diamond' },
  URGENT_IMPROVEMENT: { tone: 'danger', asset: 'agate' },
  IMPROVEMENT: { tone: 'warning', asset: 'amber' },
  IMPROVEMENT_NEEDED: { tone: 'warning', asset: 'amber' },
  NEEDS_IMPROVEMENT: { tone: 'warning', asset: 'amber' },
  MEETS: { tone: 'success', asset: 'emerald-v2' },
  MEETS_EXPECTATIONS: { tone: 'success', asset: 'emerald-v2' },
  EXCEEDS: { tone: 'primary', asset: 'ruby' },
  EXCEEDS_EXPECTATIONS: { tone: 'primary', asset: 'ruby' },
  OUTSTANDING: { tone: 'purple', asset: 'diamond' },
} as const;

export const performanceLevelTone = (levelCode: string): PerformanceLevelTone =>
  levelPresentation[levelCode as PerformanceLevelCode]?.tone ?? 'neutral';

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
  const level = badge.state === 'LEVEL' && badge.levelCode ? levelPresentation[badge.levelCode] : null;
  const asset = level?.asset ?? 'neutral-frame';
  const tone: PerformanceLevelTone = level?.tone ?? 'neutral';
  const imageFilter = level && 'imageFilter' in level ? (level as { imageFilter: string }).imageFilter : undefined;
  return {
    labelFa: badge.labelFa,
    meaningFa: badge.meaningFa,
    tone,
    lightAsset: `/assets/performance-rank-badges-v2/light/${asset}.png`,
    darkAsset: `/assets/performance-rank-badges-v2/dark/${asset}.png`,
    imageFilter,
    romanNumeral: undefined,
    presentationVersion: undefined,
    neutral: !level,
  };
};
