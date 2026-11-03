export type BiRecommendationPriority = 'breached' | 'imminent' | 'deterioration' | 'reconciliation';

export type BiRecommendation = {
  id: string;
  priority: BiRecommendationPriority;
  title: string;
  evidence: string;
  count: number;
  value: number | null;
  destination: string;
};

export type BiSellerSignals = {
  name: string;
  overdueFollowUpCount: number;
  stalledPipelineCount: number;
  deteriorationPercent: number | null;
  lossRate: number | null;
  netRealized: number;
};

export const rankBiSellers = <T extends BiSellerSignals>(rows: T[]) => [...rows].sort((left, right) => {
  const comparisons = [
    right.overdueFollowUpCount - left.overdueFollowUpCount,
    right.stalledPipelineCount - left.stalledPipelineCount,
    (left.deteriorationPercent != null && left.deteriorationPercent <= -20 ? left.deteriorationPercent : 0)
      - (right.deteriorationPercent != null && right.deteriorationPercent <= -20 ? right.deteriorationPercent : 0),
    (right.lossRate != null && right.lossRate >= 50 ? right.lossRate : 0)
      - (left.lossRate != null && left.lossRate >= 50 ? left.lossRate : 0),
    right.netRealized - left.netRealized,
  ];
  return comparisons.find((value) => value !== 0) || left.name.localeCompare(right.name, 'fa');
});

type Count = { count: number };
type Exposure = Count & { value: number };

export const buildBiRecommendations = ({
  overdueReceivables,
  overdueDeliveries,
  overdueFollowUps = { count: 0 },
  dueSoonDeliveries = { count: 0 },
  stalledPipeline,
  currentNetRealized,
  previousNetRealized,
  promisedWithoutLoading,
  finalizedWithoutExit,
  legacyUnassigned,
  crmWonWithoutContract = { count: 0 },
}: {
  overdueReceivables: Exposure;
  overdueDeliveries: Count;
  overdueFollowUps?: Count;
  dueSoonDeliveries?: Count;
  stalledPipeline: Exposure;
  currentNetRealized: number;
  previousNetRealized: number;
  promisedWithoutLoading: Count;
  finalizedWithoutExit: Count;
  legacyUnassigned: Exposure;
  crmWonWithoutContract?: Count;
}): BiRecommendation[] => {
  const rows: BiRecommendation[] = [];
  const add = (condition: boolean, row: BiRecommendation) => { if (condition) rows.push(row); };

  add(overdueReceivables.count > 0, {
    id: 'overdue-collections', priority: 'breached', title: 'وصول سررسیدگذشته نیازمند پیگیری است',
    evidence: `${overdueReceivables.count.toLocaleString('fa-IR')} مانده دریافتنی از سررسید عبور کرده است`,
    count: overdueReceivables.count, value: overdueReceivables.value, destination: '/dashboard/bi/collections',
  });
  add(overdueDeliveries.count > 0, {
    id: 'overdue-deliveries', priority: 'breached', title: 'تحویل وعده‌داده‌شده عقب افتاده است',
    evidence: `${overdueDeliveries.count.toLocaleString('fa-IR')} تحویل از تاریخ وعده عبور کرده است`,
    count: overdueDeliveries.count, value: null, destination: '/dashboard/bi/delivery',
  });
  add(overdueFollowUps.count > 0, {
    id: 'overdue-follow-ups', priority: 'breached', title: 'پیگیری CRM از موعد عبور کرده است',
    evidence: `${overdueFollowUps.count.toLocaleString('fa-IR')} اقدام بعدی باز و سررسیدگذشته است`,
    count: overdueFollowUps.count, value: null, destination: '/dashboard/bi/recommendations',
  });
  add(stalledPipeline.count > 0, {
    id: 'stalled-pipeline', priority: 'imminent', title: 'پایپ‌لاین فعال بدون پیشرفت مانده است',
    evidence: `${stalledPipeline.count.toLocaleString('fa-IR')} قرارداد باز بیش از ۳۰ روز عمر دارد`,
    count: stalledPipeline.count, value: stalledPipeline.value, destination: '/dashboard/bi/pipeline',
  });
  add(dueSoonDeliveries.count > 0, {
    id: 'delivery-due-soon', priority: 'imminent', title: 'موعد تحویل نزدیک است',
    evidence: `${dueSoonDeliveries.count.toLocaleString('fa-IR')} تحویل در ۷ روز آینده سررسید می‌شود`,
    count: dueSoonDeliveries.count, value: null, destination: '/dashboard/bi/delivery',
  });
  const deterioration = previousNetRealized > 0
    ? Math.round(((currentNetRealized - previousNetRealized) / previousNetRealized) * 100)
    : null;
  add(deterioration != null && deterioration <= -20, {
    id: 'realized-deterioration', priority: 'deterioration', title: 'فروش قطعی نسبت به دوره قابل‌مقایسه افت کرده است',
    evidence: `${Math.abs(deterioration || 0).toLocaleString('fa-IR')}٪ کاهش نسبت به دوره قبل`,
    count: 1, value: currentNetRealized, destination: '/dashboard/bi/realized-sales',
  });
  add(promisedWithoutLoading.count > 0, {
    id: 'delivery-not-linked', priority: 'reconciliation', title: 'وعده تحویل با رکورد لجستیک تطبیق ندارد',
    evidence: `${promisedWithoutLoading.count.toLocaleString('fa-IR')} قرارداد دارای وعده تحویل و بدون رکورد بارگیری است`,
    count: promisedWithoutLoading.count, value: null, destination: '/dashboard/bi/reconciliation',
  });
  add(finalizedWithoutExit.count > 0, {
    id: 'guard-exit-not-linked', priority: 'reconciliation', title: 'بارگیری نهایی با خروج گارد تطبیق ندارد',
    evidence: `${finalizedWithoutExit.count.toLocaleString('fa-IR')} بارگیری نهایی خروج ثبت‌شده ندارد`,
    count: finalizedWithoutExit.count, value: null, destination: '/dashboard/bi/reconciliation',
  });
  add(legacyUnassigned.count > 0, {
    id: 'legacy-attribution', priority: 'reconciliation', title: 'فروش قطعی به فروشنده منتسب نشده است',
    evidence: `${legacyUnassigned.count.toLocaleString('fa-IR')} قرارداد در جمع شرکت هست اما وارد رتبه‌بندی نمی‌شود`,
    count: legacyUnassigned.count, value: legacyUnassigned.value, destination: '/dashboard/bi/sellers',
  });
  add(crmWonWithoutContract.count > 0, {
    id: 'crm-won-not-linked', priority: 'reconciliation', title: 'پروژه برنده CRM به قرارداد متصل نیست',
    evidence: `${crmWonWithoutContract.count.toLocaleString('fa-IR')} پروژه برنده قرارداد فروش پیوندخورده ندارد`,
    count: crmWonWithoutContract.count, value: null, destination: '/dashboard/bi/reconciliation',
  });

  return rows;
};
