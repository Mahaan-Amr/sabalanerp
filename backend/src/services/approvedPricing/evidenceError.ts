export class ApprovedPricingEvidenceError extends Error {
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly userMessageFa: string;

  constructor(input: string | {
    technicalDetail: string;
    evidence?: Readonly<Record<string, unknown>>;
    userMessageFa?: string;
  } = 'Approved pricing evidence is invalid') {
    const normalized = typeof input === 'string' ? { technicalDetail: input } : input;
    super(normalized.technicalDetail);
    this.name = 'ApprovedPricingEvidenceError';
    this.evidence = normalized.evidence;
    this.userMessageFa = normalized.userMessageFa ??
      'شواهد فریز‌شدهٔ قرارداد با یکدیگر سازگار نیستند. مدیر حسابداری باید پروندهٔ بررسی این قرارداد را تعیین تکلیف کند.';
  }
}

export const asApprovedPricingEvidenceError = (error: unknown) => {
  if (error instanceof ApprovedPricingEvidenceError) return error;
  return null;
};
