import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  loadLegacyPricingCandidates,
  PrismaLegacyApprovedPricingRepository,
  sealLegacyPricingWithApprovedPricingRepository,
  type LegacyPricingCandidate,
} from '../legacyApprovedPricing';

const databaseUrl = process.env.DATABASE_URL?.trim();

test('serializable legacy sealing rejects a financial mutation after preflight and writes nothing', {
  skip: databaseUrl ? false : 'DATABASE_URL is required for Prisma integration coverage',
}, async () => {
  const prisma = new PrismaClient();
  const beforeVersions = await prisma.contractApprovedPricingVersion.count();
  try {
    await assert.rejects(prisma.$transaction(async tx => {
      const source = (await loadLegacyPricingCandidates(tx)).find(candidate =>
        candidate.sourceFinancialRecordId && candidate.rows.length > 0 && !candidate.existingSeal);
      assert.ok(source, 'sabalanerp-local needs one unsealed graphless invoice candidate for this integration test');
      const row = source.rows[0];
      const candidate: LegacyPricingCandidate = {
        ...source,
        approvalLeaves: [{
          id: source.sourceFinancialRecordId,
          kind: 'INVOICE_CANDIDATE',
          status: 'ISSUED',
          approvedAt: '2026-08-01T08:00:00.000Z',
          approvedBy: 'integration-reviewer',
        }],
        currency: 'ریال',
        customerId: source.customerId ?? 'integration-customer',
        projectId: 'integration-project',
        destination: 'integration-destination',
        envelopeEvidence: {
          financialCurrency: 'ریال', financialCustomerId: source.customerId ?? 'integration-customer',
          snapshotCurrency: 'ریال', snapshotCustomerId: source.customerId ?? 'integration-customer',
          snapshotProjectId: 'integration-project',
        },
        discount: { enabled: false, baseAmount: '100.000000000000', amount: '0.000000000000' },
        rows: [{
          ...row,
          relationalProductRowId: row.relationalProductRowId ?? 'integration-row',
          snapshotProductRowId: row.relationalProductRowId ?? 'integration-row',
          relationalProductId: row.relationalProductId ?? 'integration-product',
          snapshotProductId: row.relationalProductId ?? 'integration-product',
          quantity: '1.000', unit: 'count', canonicalAllInTotal: '100.000000000000',
          currencyEvidence: { contract: 'ریال', approvalSnapshot: 'ریال', productSnapshot: 'ریال', financialRecord: 'ریال' },
          quantityEvidence: { contractItem: '1.000', approvalItem: '1.000', invoiceItem: '1.000' },
          amountEvidence: { contractItem: '100.000000000000', approvalItem: '100.000000000000', invoiceItem: '100.000000000000' },
          discountEligible: false,
          componentEvidence: {
            material: '100.000000000000', mandatory: '0.000000000000', cutting: '0.000000000000',
            tooling: '0.000000000000', finishing: '0.000000000000', discountBasis: '0.000000000000',
          },
          componentEvidenceConflict: false,
          identityEvidenceConflict: false,
          snapshotHash: 'a'.repeat(64),
        }],
        grossAmount: '100.000000000000', discountAmount: '0.000000000000', netAmount: '100.000000000000',
        existingSeal: null,
        rowCounts: { contractItems: 1, approvalItems: 1, productSnapshots: 1, invoiceItems: 1 },
        review: {
          reviewedBy: 'integration-reviewer', reviewedAt: '2026-08-02T08:00:00.000Z',
          sourceEvidenceHash: source.sourceEvidenceHash, decision: 'APPROVE_SEAL', reason: 'integration race proof',
        },
      };
      const financial = await tx.accountingFinancialRecord.findUniqueOrThrow({
        where: { id: source.sourceFinancialRecordId }, select: { amount: true },
      });
      await tx.accountingFinancialRecord.update({
        where: { id: source.sourceFinancialRecordId },
        data: { amount: financial.amount.plus(new Prisma.Decimal(1)) },
      });
      const command = {
        idempotencyKey: 'integration-race', origin: 'LEGACY_SEAL' as const, candidate, review: candidate.review!,
        sourceReference: {
          contractId: candidate.contractId,
          sourceFinancialRecordId: candidate.sourceFinancialRecordId,
          sourceIdentityHash: candidate.sourceIdentityHash,
          sourceEvidenceHash: candidate.sourceEvidenceHash,
        },
      };
      await sealLegacyPricingWithApprovedPricingRepository(new PrismaLegacyApprovedPricingRepository(tx), command);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 }), /source evidence changed after preflight/);
    assert.equal(await prisma.contractApprovedPricingVersion.count(), beforeVersions);
  } finally {
    await prisma.$disconnect();
  }
});
