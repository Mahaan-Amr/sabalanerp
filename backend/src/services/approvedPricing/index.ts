import type { Prisma } from '@prisma/client';
import { sealApprovedPricing } from './domain';
import { PrismaApprovedPricingRepository } from './prismaRepository';

export * from './domain';
export * from './approvalLock';
export * from './fixtures';
export * from './types';
export * from './prismaEvidence';

export const sealApprovedPricingAtFinancialApproval = (
  tx: Prisma.TransactionClient,
  financialRecordId: string,
) => sealApprovedPricing(new PrismaApprovedPricingRepository(tx), financialRecordId);
