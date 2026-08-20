import type { Prisma } from '@prisma/client';
import { sealApprovedPricing } from './domain';
import { PrismaApprovedPricingRepository, type ApprovedPricingAuditContext } from './prismaRepository';
import { ApprovedPricingEvidenceError, asApprovedPricingEvidenceError } from './evidenceError';
import { AccountingRecordStatus } from '@prisma/client';
import { buildApprovedPricingVersion } from './domain';

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
  readonly reviewKind?: ApprovedPricingEvidenceError['reviewKind'];
  readonly remediationKind?: ApprovedPricingEvidenceError['remediationKind'];

  constructor(cause: ApprovedPricingEvidenceError) {
    super('شواهد مالی این قرارداد با یکدیگر سازگار نیستند و تأیید مالی متوقف شد.');
    this.name = 'FinancialEvidenceConflictError';
    this.technicalDetail = cause instanceof Error ? cause.message : String(cause);
    this.evidence = cause.evidence;
    this.userMessageFa = cause.userMessageFa;
    this.reviewKind = cause.reviewKind;
    this.remediationKind = cause.remediationKind;
  }
}

export const preflightApprovedPricingAtFinancialApproval = async (
  tx: Prisma.TransactionClient,
  financialRecordId: string,
  actorId: string,
) => {
  const repository = new PrismaApprovedPricingRepository(tx, {
    reason: 'بازآزمایی پرونده بررسی شواهد مالی',
    correlationId: `financial-evidence-review:${financialRecordId}`,
    idempotencyKey: `financial-evidence-review:${financialRecordId}`,
    effectiveAuthority: {
      actorRole: 'SYSTEM',
      workspace: 'accounting',
      workspacePermission: 'ADMIN',
      feature: 'accounting-actions-manage',
      featurePermission: 'EDIT',
    },
  });
  try {
    const source = await repository.loadSource(financialRecordId);
    if (!source) throw new ApprovedPricingEvidenceError({
      technicalDetail: 'Approved pricing source was not found',
      userMessageFa: 'منبع شواهد قیمت‌گذاری این پیش‌فاکتور پیدا نشد. پرونده باید توسط پشتیبانی بررسی و سپس دوباره بازآزمایی شود.',
      remediationKind: 'EVIDENCE_RECOVERY',
    });
    const now = new Date();
    const preflightSource = {
      ...source,
      leaf: {
        ...source.leaf,
        status: AccountingRecordStatus.ISSUED,
        financiallyApprovedAt: now,
        financiallyApprovedBy: actorId,
      },
    };
    return buildApprovedPricingVersion(
      preflightSource,
      await repository.nextVersionNumber(source.contract.id),
      `preflight-${financialRecordId}`,
    );
  } catch (error) {
    const evidenceError = asApprovedPricingEvidenceError(error);
    if (evidenceError) throw new FinancialEvidenceConflictError(evidenceError);
    throw error;
  }
};

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
