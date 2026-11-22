import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import { buildApprovedPricingVersion } from '../approvedPricing/domain';
import { approvedPricingSourceFixture } from '../approvedPricing/fixtures';
import { persistedApprovedPricingInclude, persistedApprovedPricingVersionIntegrityMatches, persistedApprovedPricingRowIntegrityMatches, mapVerifiedApprovedPricingVersion } from '../approvedPricing/prismaEvidence';
import { allocatePricedRevision } from '../pricedAllocationLedger';
import { roundContractPayableTotal } from '@sabalanerp/contract-product-graph';

const prisma = new PrismaClient();
const rollback = Symbol('approved-pricing-port-rollback');

const run = async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432' && url.pathname === '/sabalanerp', 'Only the existing sabalanerp-local database is allowed');
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
        const input = approvedPricingSourceFixture();
        input.contract.id = contract.id;
        input.leaf.id = source.id;
        input.leaf.contractId = contract.id;
        input.leaf.sourceId = contract.id;
        input.leaf.sourceSnapshot = { id: contract.id, immutable: true };
        input.leaf.financiallyApprovedBy = source.createdBy;
        (input.contract.items[0] as any).id = candidate.itemId;
        (input.contract.items[0] as any).productRowId = candidate.productRowId;
        (input.contract.currentItems[0] as any).id = candidate.itemId;
        (input.contract.currentItems[0] as any).productRowId = candidate.productRowId;
        (input.leaf.invoiceItems[0] as any).contractItemId = candidate.itemId;
        const data = input.contract.contractData as any;
        data.products[0].rowId = candidate.productRowId;
        (input.contract.productGraph!.rows[0] as any).productRowId = candidate.productRowId;
        data.discount = { enabled: false, baseSubtotal: '1000', percent: '0', amount: '0', currency: 'تومان' };
        data.serviceRows = [{ id: 'independent-cutting', totalPrice: '100.4' }];
        data.payment.totalContractAmount = '1350';
        data.monetaryRounding = roundContractPayableTotal('1350.4', 'تومان');
        input.leaf.amount = '13500';
        const version = buildApprovedPricingVersion(input, versionNumber, versionId);
        const inserted = await repository.insertAndAdvance(version);
        assert.equal(inserted.id, versionId);
        assert.equal(inserted.rows[0]?.canonicalAllInTotal, '1250.000000000000');
        const stored = await tx.contractApprovedPricingVersion.findUniqueOrThrow({ where: { id: versionId }, include: persistedApprovedPricingInclude });
        assert(persistedApprovedPricingVersionIntegrityMatches(stored));
        assert(stored.rows.every(row => persistedApprovedPricingRowIntegrityMatches(stored, row)));
        assert.equal((stored.sourceEvidence as any).financialApproval.payable.amount, '1350.000000000000');
        const altered = JSON.parse(JSON.stringify(stored.sourceEvidence));
        altered.financialApproval.payable.serviceAmount = '0';
        assert.equal(persistedApprovedPricingVersionIntegrityMatches({ ...stored, sourceEvidence: altered }), false);
        const locked = mapVerifiedApprovedPricingVersion(stored, 'test-readiness');
        const row = locked.rows[0]!;
        const allocated = allocatePricedRevision({ versions: [locked], priorEvents: [], lines: [{ allocationRevisionLineId: 'local-test', contractId: contract.id, contractItemId: row.contractItemId, productRowId: row.productRowId, quantity: row.contractedQuantity, unit: row.unit }] });
        assert.equal(allocated.totals.netAmount, '1250.000000000000');
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
