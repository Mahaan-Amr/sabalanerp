import type { Prisma } from '@prisma/client';
import { sealApprovedPricing } from './domain';
import { PrismaApprovedPricingRepository, type ApprovedPricingAuditContext } from './prismaRepository';
import { ApprovedPricingEvidenceError, asApprovedPricingEvidenceError } from './evidenceError';

export * from './domain';
export * from './approvalLock';
export * from './fixtures';
export * from './types';
export * from './prismaEvidence';
export * from './prismaRepository';
export * from './readinessPublisher';
export * from './evidenceError';

export class FinancialEvidenceConflictError extends Error {
  readonly code = 'FINANCIAL_EVIDENCE_CONFLICT';
  readonly technicalDetail: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
  readonly userMessageFa: string;

  constructor(cause: ApprovedPricingEvidenceError) {
    super('شواهد مالی این قرارداد با یکدیگر سازگار نیستند و تأیید مالی متوقف شد.');
    this.name = 'FinancialEvidenceConflictError';
    this.technicalDetail = cause instanceof Error ? cause.message : String(cause);
    this.evidence = cause.evidence;
    this.userMessageFa = cause.userMessageFa;
  }
}

export const sealApprovedPricingAtFinancialApproval = async (
  tx: Prisma.TransactionClient,
  financialRecordId: string,
  auditContext: ApprovedPricingAuditContext,
) => {
  try {
    return await sealApprovedPricing(new PrismaApprovedPricingRepository(tx, auditContext), financialRecordId);
  } catch (error) {
    if (error instanceof FinancialEvidenceConflictError) throw error;
    const evidenceError = asApprovedPricingEvidenceError(error);
    if (evidenceError) throw new FinancialEvidenceConflictError(evidenceError);
    throw error;
  }
};
