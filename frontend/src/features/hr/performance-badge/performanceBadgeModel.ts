export type PerformanceLevelCode = 'URGENT_IMPROVEMENT' | 'IMPROVEMENT' | 'IMPROVEMENT_NEEDED' | 'MEETS' | 'MEETS_EXPECTATIONS' | 'EXCEEDS' | 'EXCEEDS_EXPECTATIONS' | 'OUTSTANDING';

export type PerformanceBadgeSummary = {
  state: 'UNEVALUATED' | 'NEEDS_NEW_EVALUATION' | 'LEVEL' | 'TEMPORARILY_UNAVAILABLE';
  levelCode?: PerformanceLevelCode;
  labelFa: string;
  meaningFa: string;
  newestMeasurementTo?: string;
  nextReviewAt?: string;
  version: number;
};

const levelPresentation = {
  URGENT_IMPROVEMENT: { tone: 'danger', asset: 'agate' },
  IMPROVEMENT: { tone: 'warning', asset: 'amber' },
  IMPROVEMENT_NEEDED: { tone: 'warning', asset: 'amber' },
  MEETS: { tone: 'success', asset: 'emerald-v2' },
  MEETS_EXPECTATIONS: { tone: 'success', asset: 'emerald-v2' },
  EXCEEDS: { tone: 'primary', asset: 'ruby' },
  EXCEEDS_EXPECTATIONS: { tone: 'primary', asset: 'ruby' },
  OUTSTANDING: { tone: 'purple', asset: 'diamond' },
} as const;

export const performanceLevelTone = (levelCode: string) =>
  levelPresentation[levelCode as PerformanceLevelCode]?.tone ?? 'neutral';

export const performanceBadgePresentation = (badge: PerformanceBadgeSummary) => {
  const level = badge.state === 'LEVEL' && badge.levelCode ? levelPresentation[badge.levelCode] : null;
  const asset = level?.asset ?? 'neutral-frame';
  return {
    labelFa: badge.labelFa,
    meaningFa: badge.meaningFa,
    tone: level?.tone ?? 'neutral',
    lightAsset: `/assets/performance-rank-badges-v2/light/${asset}.png`,
    darkAsset: `/assets/performance-rank-badges-v2/dark/${asset}.png`,
    neutral: !level,
  };
};
