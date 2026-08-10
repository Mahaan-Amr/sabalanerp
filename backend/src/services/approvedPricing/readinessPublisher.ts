import { createHash } from 'node:crypto';
import { PricingReadinessStatus, Prisma, PrismaClient } from '@prisma/client';
import { sumCanonicalQuantities } from '../pricedAllocationLedger';
import {
  persistedApprovedPricingInclude,
  persistedApprovedPricingRowIntegrityMatches,
  persistedApprovedPricingVersionIntegrityMatches,
} from './prismaEvidence';

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return value;
};

export const approvedPricingReadinessHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

export const publishCurrentApprovedPricingReadiness = (
  prisma: PrismaClient,
  input: { contractId: string; pricingVersionId: string; sourceFinancialRecordId: string; evaluatedBy: string },
) => prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))',
    `APPROVED_PRICING_HEAD:${input.contractId}`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${input.contractId} FOR UPDATE`);
  const head = await tx.contractApprovedPricingHead.findUnique({ where: { contractId: input.contractId },
    include: { currentVersion: { include: persistedApprovedPricingInclude } } });
  if (!head || head.currentVersionId !== input.pricingVersionId
    || head.currentVersion.sourceFinancialRecordId !== input.sourceFinancialRecordId) {
    throw new Error('READY publication requires the exact current approved-pricing version and financial source.');
  }
  const version = head.currentVersion;
  if (!persistedApprovedPricingVersionIntegrityMatches(version)
    || version.rows.some(row => !persistedApprovedPricingRowIntegrityMatches(version, row))) {
    throw new Error('READY publication refused approved-pricing evidence that failed immutable integrity verification.');
  }
  const approval = await tx.accountingFinancialRecord.findUnique({ where: { id: input.sourceFinancialRecordId } });
  if (!approval?.financiallyApprovedAt || !approval.financiallyApprovedBy || approval.contractId !== input.contractId) {
    throw new Error('READY publication requires committed financial-approval evidence.');
  }
  const evidence = {
    schemaVersion: 1, contractId: input.contractId, pricingVersionId: version.id,
    sourceFinancialRecordId: version.sourceFinancialRecordId, pricingIntegrityHash: version.integrityHash,
    rowIntegrityHashes: version.rows.map(row => row.integrityHash),
    sourceCount: 1, quantityTotal: sumCanonicalQuantities(version.rows.map(row => row.contractedQuantity.toFixed(3))),
    amountTotal: version.grossAmount.toFixed(12),
  };
  const sourceIdentityHash = approvedPricingReadinessHash({ contractId: input.contractId,
    sourceFinancialRecordId: version.sourceFinancialRecordId, financiallyApprovedAt: approval.financiallyApprovedAt,
    financiallyApprovedBy: approval.financiallyApprovedBy });
  const evidenceHash = approvedPricingReadinessHash({ ...evidence, sourceIdentityHash });
  const existing = await tx.contractPricingReadinessResult.findFirst({ where: { contractId: input.contractId,
    pricingVersionId: version.id }, include: { reasons: true }, orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }] });
  if (existing) {
    if (existing.status === PricingReadinessStatus.READY && existing.reasons.length === 0
      && existing.sourceFinancialRecordId === version.sourceFinancialRecordId && existing.sourceCount === 1
      && existing.sourceIdentityHash === sourceIdentityHash
      && existing.quantityTotal?.toFixed(3) === evidence.quantityTotal
      && existing.amountTotal?.toFixed(12) === evidence.amountTotal && existing.evidenceHash === evidenceHash) return existing;
    throw new Error('Approved-pricing readiness was already published with different evidence.');
  }
  return tx.contractPricingReadinessResult.create({ data: { contractId: input.contractId,
    pricingVersionId: version.id, sourceFinancialRecordId: version.sourceFinancialRecordId,
    status: PricingReadinessStatus.READY, sourceCount: 1, sourceIdentityHash,
    quantityTotal: evidence.quantityTotal, amountTotal: evidence.amountTotal, evidenceHash,
    evaluatedBy: input.evaluatedBy } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
