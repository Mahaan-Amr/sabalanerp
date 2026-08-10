import type { Prisma } from '@prisma/client';
import { sealApprovedPricing } from './domain';
import { PrismaApprovedPricingRepository, type ApprovedPricingAuditContext } from './prismaRepository';

export * from './domain';
export * from './approvalLock';
export * from './fixtures';
export * from './types';
export * from './prismaEvidence';
export * from './prismaRepository';
export * from './readinessPublisher';

export const sealApprovedPricingAtFinancialApproval = (
  tx: Prisma.TransactionClient,
  financialRecordId: string,
  auditContext: ApprovedPricingAuditContext,
) => sealApprovedPricing(new PrismaApprovedPricingRepository(tx, auditContext), financialRecordId);
