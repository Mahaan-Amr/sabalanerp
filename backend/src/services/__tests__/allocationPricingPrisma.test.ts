import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PricingReadinessStatus, Prisma, PrismaClient } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import type { ApprovedPricingVersionInsert } from '../approvedPricing/types';
import { createPrismaAllocationPricingBindingPort } from '../allocationPricingPrismaAdapter';

const prisma = new PrismaClient();
const rollback = Symbol('allocation-pricing-port-rollback');

const run = async () => {
  const beforeVersions = await prisma.contractApprovedPricingVersion.count();
  const beforeReadiness = await prisma.contractPricingReadinessResult.count();
  try {
    await prisma.$transaction(async tx => {
      const [candidate] = await tx.$queryRaw<Array<{
        itemId: string; productRowId: string; contractId: string; financialRecordId: string; createdBy: string; currency: string;
      }>>(Prisma.sql`
        SELECT ci."id" AS "itemId", ci."productRowId", ci."contractId",
          afr."id" AS "financialRecordId", afr."createdBy", sc."currency"
        FROM "contract_items" ci
        JOIN "sales_contracts" sc ON sc."id" = ci."contractId"
        JOIN "accounting_financial_records" afr ON afr."contractId" = ci."contractId"
        LEFT JOIN "contract_approved_pricing_versions" pv
          ON pv."contractId" = ci."contractId" OR pv."sourceFinancialRecordId" = afr."id"
        WHERE ci."productRowId" IS NOT NULL AND pv."id" IS NULL
        ORDER BY ci."createdAt", ci."id"
        LIMIT 1
      `);
      assert(candidate, 'sabalanerp-local needs one unsealed financial record with a stable contract row');

      const repository = new PrismaApprovedPricingRepository(tx);
      await repository.withContractLock(candidate.contractId, async () => {
        const versionId = randomUUID();
        const versionNumber = await repository.nextVersionNumber(candidate.contractId);
        const rowId = randomUUID();
        const approvedAt = new Date('2026-08-09T12:00:00.000Z');
        const componentEvidence = { base: '1.000000000000', discountBasis: '1.000000000000' };
        const rowInput = {
          versionId, contractId: candidate.contractId, sourceFinancialRecordId: candidate.financialRecordId,
          versionNumber, contractItemId: candidate.itemId, productRowId: candidate.productRowId, ordinal: 1,
          contractedQuantity: '1.000', unit: 'count', canonicalAllInTotal: '1.000000000000',
          discountEligible: true, componentEvidence,
        };
        const rowHash = approvedPricingRowIntegrityHash(rowInput);
        const sourceEvidence = {
          customer: { id: 'integration-customer' }, project: { id: 'integration-project' }, destination: 'integration-destination',
        };
        const rootInput = {
          id: versionId, contractId: candidate.contractId, versionNumber,
          sourceFinancialRecordId: candidate.financialRecordId, approvedAt, approvedBy: candidate.createdBy,
          schemaVersion: 1, currency: candidate.currency, grossAmount: '1.000000000000',
          discountAmount: '0.000000000000', netAmount: '1.000000000000', sourceEvidence, rowHashes: [rowHash],
        };
        const version: ApprovedPricingVersionInsert = {
          ...rootInput,
          integrityHash: approvedPricingVersionIntegrityHash(rootInput),
          rows: [{ id: rowId, ...rowInput, integrityHash: rowHash }],
        };
        await repository.insertAndAdvance(version);
        const readiness = await tx.contractPricingReadinessResult.create({ data: {
          contractId: candidate.contractId,
          pricingVersionId: versionId,
          sourceFinancialRecordId: candidate.financialRecordId,
          status: PricingReadinessStatus.READY,
          sourceCount: 1,
          sourceIdentityHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          quantityTotal: '1.000',
          amountTotal: '1.000000000000',
          evidenceHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          evaluatedBy: candidate.createdBy,
        } });

        const port = createPrismaAllocationPricingBindingPort(tx);
        await port.lockPricingScope([
          `APPROVED_PRICING_HEAD:${candidate.contractId}`,
          `APPROVED_PRICING_ROW:${candidate.contractId}:${candidate.itemId}`,
          `PRICED_ALLOCATION_LEDGER:${rowId}`,
        ]);
        const [evidence] = await port.loadLockedPricingEvidence([candidate.contractId]);
        assert(evidence);
        assert.equal(evidence.version.id, versionId);
        assert.equal(evidence.version.readinessEvidenceHash, readiness.evidenceHash);
        assert.equal(evidence.versionIntegrityVerified, true);
        assert.equal(evidence.rowIntegrityVerified, true);
        assert.deepEqual(evidence.scope, {
          customerId: 'integration-customer', projectId: 'integration-project', destination: 'integration-destination',
        });
      });
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.contractApprovedPricingVersion.count(), beforeVersions);
  assert.equal(await prisma.contractPricingReadinessResult.count(), beforeReadiness);
};

run()
  .then(() => console.log('allocation pricing Prisma adapter integration: ok'))
  .finally(() => prisma.$disconnect());
