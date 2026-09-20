export type SellerPolicyFactor = {
  code: string;
  familyCode: string;
  titleFa: string;
  unitFa: string;
  direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "CAPPED_RATE";
  weightPercent: string | number;
  sourceKind: "SYSTEM" | "SUPERVISOR" | "SURVEY";
  minimumSampleCount: number;
};

const provisionalTarget = (factor: SellerPolicyFactor) => {
  if (factor.sourceKind === "SUPERVISOR" || factor.sourceKind === "SURVEY") return "75";
  if (factor.direction === "CAPPED_RATE") return "75";
  if (factor.direction === "LOWER_IS_BETTER") return "1";
  return "100";
};

export const buildSellerProfileIndicators = (factors: SellerPolicyFactor[]) => factors.map((factor) => ({
  code: factor.code,
  categoryFa: factor.familyCode,
  familyCode: factor.familyCode,
  titleFa: factor.titleFa,
  unitFa: factor.unitFa,
  direction: factor.direction,
  weightPercent: String(factor.weightPercent),
  sourceKind: factor.sourceKind,
  minimumSampleCount: factor.minimumSampleCount,
  target: provisionalTarget(factor),
}));

export type ProfileDraftIndicator = ReturnType<typeof buildSellerProfileIndicators>[number];

export type ProfileDraftValidationInput = {
  nameFa: string;
  jobId: string;
  effectivePeriodKey: string;
  indicators: Array<{
    code: string;
    titleFa: string;
    unitFa: string;
    target: string;
    weightPercent: string;
    direction: "HIGHER_IS_BETTER" | "LOWER_IS_BETTER" | "CAPPED_RATE";
    minimumSampleCount?: number;
  }>;
};

export type ProfileDraftError = { fieldId: string; message: string };

const validDecimal = (value: string) => /^\d+(?:\.\d{1,4})?$/.test(value.trim());

export const validateProfileDraft = (input: ProfileDraftValidationInput): ProfileDraftError[] => {
  const errors: ProfileDraftError[] = [];
  if (!input.nameFa.trim()) errors.push({ fieldId: "profile-name", message: "نام الگو را وارد کنید." });
  if (!input.jobId.trim()) errors.push({ fieldId: "profile-job", message: "شغل را انتخاب کنید." });
  if (!/^\d{4}-H[12]$/.test(input.effectivePeriodKey)) {
    errors.push({ fieldId: "profile-period", message: "دوره شروع اثر را انتخاب کنید." });
  }
  if (!input.indicators.length) errors.push({ fieldId: "profile-add-indicator", message: "حداقل یک معیار لازم است." });
  const codeCounts = new Map<string, number>();
  input.indicators.forEach((indicator) => {
    const code = indicator.code.trim();
    if (code) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
  });
  input.indicators.forEach((indicator, index) => {
    const prefix = `profile-indicator-${index}`;
    if (!indicator.code.trim()) errors.push({ fieldId: `${prefix}-code`, message: "کد معیار را وارد کنید." });
    else if ((codeCounts.get(indicator.code.trim()) ?? 0) > 1) errors.push({ fieldId: `${prefix}-code`, message: "کد معیار تکراری است." });
    if (!indicator.titleFa.trim()) errors.push({ fieldId: `${prefix}-title`, message: "عنوان معیار را وارد کنید." });
    if (!indicator.unitFa.trim()) errors.push({ fieldId: `${prefix}-unit`, message: "واحد معیار را وارد کنید." });
    if (!validDecimal(indicator.target)) errors.push({ fieldId: `${prefix}-target`, message: "هدف معتبر را وارد کنید." });
    else if (indicator.direction === "HIGHER_IS_BETTER" && Number(indicator.target) <= 0) {
      errors.push({ fieldId: `${prefix}-target`, message: "هدف این معیار باید بیشتر از صفر باشد." });
    } else if (indicator.direction === "CAPPED_RATE" && (Number(indicator.target) <= 0 || Number(indicator.target) >= 100)) {
      errors.push({ fieldId: `${prefix}-target`, message: "هدف نرخ باید بین صفر و صد باشد." });
    }
    if (!validDecimal(String(indicator.weightPercent))) errors.push({ fieldId: `${prefix}-weight`, message: "وزن معتبر را وارد کنید." });
    if (typeof indicator.minimumSampleCount !== "number"
      || !Number.isInteger(indicator.minimumSampleCount) || indicator.minimumSampleCount < 1) {
      errors.push({ fieldId: `${prefix}-sample`, message: "حداقل نمونه باید یک یا بیشتر باشد." });
    }
  });
  if (input.indicators.length && input.indicators.every(({ weightPercent }) => validDecimal(String(weightPercent)))) {
    const totalWeight = input.indicators.reduce((sum, { weightPercent }) => sum + Number(weightPercent), 0);
    if (Math.abs(totalWeight - 100) > 0.0001) {
      errors.push({ fieldId: "profile-indicator-0-weight", message: "جمع وزن معیارها باید ۱۰۰ درصد باشد." });
    }
  }
  return errors;
};
