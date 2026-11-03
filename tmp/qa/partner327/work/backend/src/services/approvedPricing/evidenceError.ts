export type FinancialEvidenceReviewKind = 'QUANTITY' | 'AMOUNT' | 'SNAPSHOT' | 'GENERAL';
export type FinancialEvidenceRemediationKind =
  | 'RESPONSIBLE_SELLER_CORRECTION'
  | 'EVIDENCE_RECOVERY'
  | 'TECHNICAL_SUPPORT';

export class ApprovedPricingEvidenceError extends Error {
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly userMessageFa: string;
  readonly reviewKind?: FinancialEvidenceReviewKind;
  readonly remediationKind?: FinancialEvidenceRemediationKind;

  constructor(input: string | {
    technicalDetail: string;
    evidence?: Readonly<Record<string, unknown>>;
    userMessageFa?: string;
    reviewKind?: FinancialEvidenceReviewKind;
    remediationKind?: FinancialEvidenceRemediationKind;
  } = 'Approved pricing evidence is invalid') {
    const normalized = typeof input === 'string' ? { technicalDetail: input } : input;
    super(normalized.technicalDetail);
    this.name = 'ApprovedPricingEvidenceError';
    this.evidence = normalized.evidence;
    this.userMessageFa = normalized.userMessageFa ??
      'شواهد فریز‌شدهٔ قرارداد با یکدیگر سازگار نیستند. مدیر حسابداری باید پروندهٔ بررسی این قرارداد را تعیین تکلیف کند.';
    this.reviewKind = normalized.reviewKind;
    this.remediationKind = normalized.remediationKind;
  }
}

export const asApprovedPricingEvidenceError = (error: unknown) => {
  if (error instanceof ApprovedPricingEvidenceError) return error;
  return null;
};
