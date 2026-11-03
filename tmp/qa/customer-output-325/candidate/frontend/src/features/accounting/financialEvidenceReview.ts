type ConflictResponse = {
  code?: string;
  actionUrl?: string;
  reviewCase?: {
    id?: string;
    contractId?: string;
    actionUrl?: string;
  } | null;
};

export const financialEvidenceCaseHref = (contractId: string, caseId: string) =>
  `/dashboard/accounting/contracts/${encodeURIComponent(contractId)}/financial-evidence-reviews/${encodeURIComponent(caseId)}`;

export const financialEvidenceReviewFromConflict = (response: ConflictResponse | null | undefined) => {
  if (response?.code !== 'FINANCIAL_EVIDENCE_CONFLICT') return null;
  const reviewCase = response.reviewCase;
  if (!reviewCase?.id || !reviewCase.contractId) return null;
  const canonical = financialEvidenceCaseHref(reviewCase.contractId, reviewCase.id);
  return reviewCase.actionUrl === canonical ? canonical : null;
};

export const isFinancialEvidenceReviewCase = (flag: { trackingCode?: string | null; evidence?: unknown }) => {
  const evidence = flag.evidence && typeof flag.evidence === 'object' && !Array.isArray(flag.evidence)
    ? flag.evidence as Record<string, unknown>
    : {};
  return Boolean(flag.trackingCode?.startsWith('financial-evidence:') || evidence.code === 'FINANCIAL_EVIDENCE_CONFLICT');
};
