export type PerformanceBadgeSummary = {
  state: 'UNEVALUATED' | 'NEEDS_NEW_EVALUATION' | 'LEVEL' | 'TEMPORARILY_UNAVAILABLE';
  levelCode?: 'URGENT_IMPROVEMENT' | 'IMPROVEMENT_NEEDED' | 'MEETS_EXPECTATIONS' | 'EXCEEDS_EXPECTATIONS' | 'OUTSTANDING';
  labelFa: string;
  meaningFa: string;
  newestMeasurementTo?: string;
  nextReviewAt?: string;
  version: number;
};

const levelPresentation = {
  URGENT_IMPROVEMENT: { tone: 'danger', asset: 'agate' },
  IMPROVEMENT_NEEDED: { tone: 'warning', asset: 'amber' },
  MEETS_EXPECTATIONS: { tone: 'success', asset: 'emerald-v2' },
  EXCEEDS_EXPECTATIONS: { tone: 'primary', asset: 'ruby' },
  OUTSTANDING: { tone: 'purple', asset: 'diamond' },
} as const;

export const performanceBadgePresentation = (badge: PerformanceBadgeSummary) => {
  const level = badge.state === 'LEVEL' && badge.levelCode ? levelPresentation[badge.levelCode] : null;
  const asset = level?.asset ?? 'neutral-frame';
  return {
    labelFa: badge.labelFa,
    meaningFa: badge.meaningFa,
    tone: (level?.tone ?? 'neutral') as 'danger' | 'warning' | 'success' | 'primary' | 'purple' | 'neutral',
    lightAsset: `/assets/performance-rank-badges-v2/light/${asset}.png`,
    darkAsset: `/assets/performance-rank-badges-v2/dark/${asset}.png`,
    neutral: !level,
  };
};
