import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import type { ApprovedPricingVersionInsert } from '../approvedPricing/types';

const prisma = new PrismaClient();
const rollback = Symbol('approved-pricing-port-rollback');

const run = async () => {
  const before = await prisma.contractApprovedPricingVersion.count();
  try {
    await prisma.$transaction(async tx => {
      const candidates = await tx.$queryRaw<Array<{
        itemId: string; productRowId: string; contractId: string; financialRecordId: string;
      }>>(Prisma.sql`
        SELECT ci."id" AS "itemId", ci."productRowId", ci."contractId", afr."id" AS "financialRecordId"
        FROM "contract_items" ci
        JOIN "accounting_financial_records" afr ON afr."contractId" = ci."contractId"
        LEFT JOIN "contract_approved_pricing_versions" pv
          ON pv."contractId" = ci."contractId" OR pv."sourceFinancialRecordId" = afr."id"
        WHERE ci."productRowId" IS NOT NULL AND pv."id" IS NULL
        ORDER BY ci."createdAt" ASC
        LIMIT 1
      `);
      const candidate = candidates[0];
      assert(candidate, 'Local integration database needs one unsealed financial record with a stable contract row');
      const source = await tx.accountingFinancialRecord.findUnique({ where: { id: candidate.financialRecordId } });
      assert(source?.contractId, 'Port candidate financial record must exist');
      const contract = await tx.salesContract.findUnique({ where: { id: source.contractId } });
      assert(contract, 'Financial record contract must exist');

      const repository = new PrismaApprovedPricingRepository(tx);
      await repository.withContractLock(contract.id, async () => {
        const versionNumber = await repository.nextVersionNumber(contract.id);
        const versionId = randomUUID();
        const version: ApprovedPricingVersionInsert = {
          id: versionId,
          contractId: contract.id,
          versionNumber,
          sourceFinancialRecordId: source.id,
          approvedAt: new Date('2026-08-09T09:00:00.000Z'),
          approvedBy: source.createdBy,
          schemaVersion: 1,
          currency: contract.currency,
          grossAmount: '1.000000000000',
          discountAmount: '0.000000000000',
          netAmount: '1.000000000000',
          sourceEvidence: { conformance: 'approved-pricing-v1' },
          integrityHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          rows: [{
            id: randomUUID(),
            contractItemId: candidate.itemId,
            productRowId: candidate.productRowId,
            ordinal: 1,
            contractedQuantity: '1.000',
            unit: 'count',
            canonicalAllInTotal: '1.000000000000',
            discountEligible: true,
            componentEvidence: { base: '1.000000000000' },
            integrityHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          }],
        };
        const inserted = await repository.insertAndAdvance(version);
        assert.equal(inserted.id, versionId);
        assert.equal(inserted.rows[0]?.ordinal, 1);
        assert.equal((await repository.findByApproval(contract.id, source.id))?.id, versionId);
        const head = await tx.contractApprovedPricingHead.findUnique({ where: { contractId: contract.id } });
        assert.equal(head?.currentVersionId, versionId);
      });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.contractApprovedPricingVersion.count(), before, 'Port conformance transaction must leave no data behind');
};

run()
  .then(() => console.log('approved pricing Prisma port conformance: ok'))
  .finally(() => prisma.$disconnect());
