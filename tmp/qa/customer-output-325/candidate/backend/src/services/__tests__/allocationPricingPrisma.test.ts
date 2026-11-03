import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PricingReadinessStatus, Prisma, PrismaClient } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import type { ApprovedPricingVersionInsert } from '../approvedPricing/types';
import { createPrismaAllocationPricingBindingPort } from '../allocationPricingPrismaAdapter';
import { readBoundPricedAllocation } from '../allocationPricingReadModel';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';

const prisma = new PrismaClient();
const rollback = Symbol('allocation-pricing-port-rollback');

const run = async () => {
  const beforeVersions = await prisma.contractApprovedPricingVersion.count();
  const beforeReadiness = await prisma.contractPricingReadinessResult.count();
  const beforeEvents = await prisma.dispatchPricedAllocationEvent.count();
  try {
    await prisma.$transaction(async tx => {
      const [candidate] = await tx.$queryRaw<Array<{
        itemId: string; productRowId: string; contractId: string; financialRecordId: string; createdBy: string; currency: string;
        revisionId: string; revisionLineId: string; lineQuantity: Prisma.Decimal; lineUnit: string;
      }>>(Prisma.sql`
        SELECT ci."id" AS "itemId", ci."productRowId", ci."contractId",
          afr."id" AS "financialRecordId", afr."createdBy", sc."currency",
          arl."revisionId", arl."id" AS "revisionLineId", arl."quantity" AS "lineQuantity", arl."unit" AS "lineUnit"
        FROM "logistics_allocation_revision_lines" arl
        JOIN "contract_items" ci ON ci."id" = arl."sourceContractItemId"
        JOIN "sales_contracts" sc ON sc."id" = ci."contractId"
        JOIN "accounting_financial_records" afr ON afr."contractId" = ci."contractId"
        LEFT JOIN "contract_approved_pricing_versions" pv
          ON pv."contractId" = ci."contractId" OR pv."sourceFinancialRecordId" = afr."id"
        LEFT JOIN "dispatch_priced_allocation_events" pae ON pae."allocationRevisionLineId" = arl."id"
        LEFT JOIN "logistics_allocation_revision_pricing" arp
          ON arp."allocationRevisionId" = arl."revisionId" AND arp."contractId" = ci."contractId"
        WHERE ci."productRowId" IS NOT NULL AND pv."id" IS NULL AND pae."id" IS NULL AND arp."id" IS NULL
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
          contractedQuantity: candidate.lineQuantity.toFixed(3), unit: candidate.lineUnit, canonicalAllInTotal: '1.000000000000',
          discountEligible: true, componentEvidence,
        };
        const rowHash = approvedPricingRowIntegrityHash(rowInput);
        const sourceEvidence = {
          customer: { id: 'integration-customer' }, project: { id: 'integration-project' },
          destination: { kind: 'PROJECT_ADDRESS', projectId: 'integration-project', address: 'integration-destination' },
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
          quantityTotal: candidate.lineQuantity.toFixed(3),
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
        await port.createPricingReference({ allocationRevisionId: candidate.revisionId, contractId: candidate.contractId,
          pricingVersionId: versionId, expectedPricingHash: version.integrityHash, readinessEvidenceHash: readiness.evidenceHash });
        const eventEvidence = { schemaVersion: 1, ledgerSequence: 1 };
        const eventPayload = { allocationRevisionId: candidate.revisionId, allocationRevisionLineId: candidate.revisionLineId,
          pricingVersionId: versionId, pricingRowId: rowId, quantity: candidate.lineQuantity.toFixed(3),
          grossAmount: '1.000000000000', discountAmount: '0.000000000000', netAmount: '1.000000000000',
          consumesFinalRemainder: true, evidence: eventEvidence, recordedBy: candidate.createdBy };
        await port.createPricedEvent({ ...eventPayload, integrityHash: pricedAllocationIntegrityHash(eventPayload) });
        const [prior] = await port.loadPriorPricedEvents([rowId]);
        assert.equal(prior?.ledgerSequence, 1);
        assert.equal(prior?.integrityVerified, true);
        assert.equal((await readBoundPricedAllocation(tx, candidate.revisionId)).lines[0]?.ledgerSequence, 1);
      });
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.contractApprovedPricingVersion.count(), beforeVersions);
  assert.equal(await prisma.contractPricingReadinessResult.count(), beforeReadiness);
  assert.equal(await prisma.dispatchPricedAllocationEvent.count(), beforeEvents);
};

run()
  .then(() => console.log('allocation pricing Prisma adapter integration: ok'))
  .finally(() => prisma.$disconnect());
