export type PerformanceLifecycle = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED' | 'CANCELLED';
export type PerformancePolicyKind = 'EVALUATION_PLAN' | 'SCORING' | 'CURRENT_LEVEL' | 'LEVEL_CLASSIFICATION' | 'RETENTION' | 'ROLLOUT';
export type SemanticTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

const lifecyclePresentations: Record<PerformanceLifecycle, { label: string; tone: SemanticTone }> = {
  DRAFT: { label: 'پیش‌نویس', tone: 'warning' },
  SCHEDULED: { label: 'زمان‌بندی‌شده', tone: 'info' },
  ACTIVE: { label: 'فعال', tone: 'success' },
  RETIRED: { label: 'بازنشسته', tone: 'neutral' },
  CANCELLED: { label: 'لغوشده', tone: 'danger' },
};

export const lifecyclePresentation = (lifecycle: PerformanceLifecycle) => lifecyclePresentations[lifecycle];

export const policyKindLabel = (kind: PerformancePolicyKind) => ({
  EVALUATION_PLAN: 'برنامه ارزیابی',
  SCORING: 'امتیازدهی و پوشش',
  CURRENT_LEVEL: 'تجمیع سطح جاری',
  LEVEL_CLASSIFICATION: 'آستانه‌های سطح‌بندی',
  RETENTION: 'نگهداری شواهد',
  ROLLOUT: 'فعال‌سازی مرحله‌ای',
}[kind]);

export type CriterionDraft = {
  schemaVersion: 1;
  conceptCode: string;
  titleFa: string;
  meaningFa: string;
  kind: 'JUDGMENT' | 'KPI_EVIDENCE' | 'EXPLANATORY' | 'BINARY_GATE';
  anchorsFa: string[];
  applicability: { fact: string; operator: 'EQUALS' | 'IN' | 'EXISTS'; values: unknown[] } | null;
  evidence: {
    allowedKinds: Array<'STRUCTURED_OBSERVATION' | 'OPERATIONAL_REFERENCE' | 'CONTROLLED_DOCUMENT'>;
    minimumReliableCount: number;
    lookbackDays: number;
    required: boolean;
  };
};

export const defaultCriterionDraft = (): CriterionDraft => ({
  schemaVersion: 1,
  conceptCode: `PERF-${Date.now().toString(36).toUpperCase()}`,
  titleFa: '',
  meaningFa: '',
  kind: 'JUDGMENT',
  anchorsFa: ['', '', '', '', ''],
  applicability: null,
  evidence: { allowedKinds: ['STRUCTURED_OBSERVATION'], minimumReliableCount: 1, lookbackDays: 0, required: true },
});

export const criterionDraftValidation = (draft: CriterionDraft) => {
  const errors: string[] = [];
  if (!draft.titleFa.trim()) errors.push('عنوان فارسی معیار را وارد کنید.');
  if (!draft.meaningFa.trim()) errors.push('معنای کسب‌وکاری معیار را وارد کنید.');
  if (draft.kind === 'JUDGMENT' && (draft.anchorsFa.length !== 5 || draft.anchorsFa.some((anchor) => !anchor.trim()))) {
    errors.push('برای هر پنج درجه توضیح رفتاری اختصاصی بنویسید.');
  }
  if (draft.evidence.required && draft.evidence.minimumReliableCount < 1) errors.push('حداقل یک شاهد قابل اتکا لازم است.');
  if (draft.evidence.allowedKinds.length === 0) errors.push('حداقل یک گونه شاهد انتخاب کنید.');
  if (draft.applicability && draft.applicability.values.length === 0) errors.push('برای قاعده کاربردپذیری حداقل یک مقدار وارد کنید.');
  return errors;
};

export type PolicyPreviewCounts = {
  eligible: number;
  evaluated: number;
  increased: number;
  decreased: number;
  unchanged: number;
  expired: number;
  needsNewEvaluation: number;
  errors: number;
};

export const summarizePreview = (preview: PolicyPreviewCounts): Array<{ label: string; value: number; tone: SemanticTone }> => [
  { label: 'افزایش سطح', value: preview.increased, tone: preview.increased ? 'success' : 'neutral' },
  { label: 'کاهش سطح', value: preview.decreased, tone: preview.decreased ? 'warning' : 'neutral' },
  { label: 'بدون تغییر', value: preview.unchanged, tone: 'neutral' },
  { label: 'انقضا', value: preview.expired, tone: preview.expired ? 'danger' : 'neutral' },
  { label: 'نیازمند ارزیابی جدید', value: preview.needsNewEvaluation, tone: preview.needsNewEvaluation ? 'info' : 'neutral' },
  { label: 'خطا', value: preview.errors, tone: preview.errors ? 'danger' : 'neutral' },
];
