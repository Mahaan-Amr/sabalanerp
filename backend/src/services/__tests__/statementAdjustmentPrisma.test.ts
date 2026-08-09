import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PricingReadinessStatus, Prisma, PrismaClient } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import type { ApprovedPricingVersionInsert } from '../approvedPricing/types';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { persistStatementAdjustment, planStatementAdjustment } from '../statementAdjustmentPosting';

const prisma = new PrismaClient();
const rollback = Symbol('statement-adjustment-db-rollback');
const hash = (character: string) => character.repeat(64);

const run = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Integration must target sabalanerp-local PostgreSQL.');
  const before = {
    versions: await prisma.contractApprovedPricingVersion.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    statements: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT' } }),
    corrections: await prisma.dispatchCorrection.count(),
    adjustments: await prisma.dispatchStatementAdjustment.count(),
    artifacts: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT_ADJUSTMENT' } }),
  };
  try {
    await prisma.$transaction(async (tx) => {
      const [candidate] = await tx.$queryRaw<Array<{
        waybillId: string; revisionId: string; revisionLineId: string; itemId: string; productRowId: string;
        contractId: string; financialRecordId: string; createdBy: string; currency: string;
        lineQuantity: Prisma.Decimal; lineUnit: string;
      }>>(Prisma.sql`
        SELECT w."id" AS "waybillId", ar."id" AS "revisionId", arl."id" AS "revisionLineId",
          ci."id" AS "itemId", ci."productRowId", ci."contractId", afr."id" AS "financialRecordId",
          afr."createdBy", sc."currency", arl."quantity" AS "lineQuantity", arl."unit" AS "lineUnit"
        FROM "accounting_dispatch_waybills" w
        JOIN "accounting_dispatch_candidates" adc ON adc."id" = w."candidateId"
        JOIN "logistics_allocation_revisions" ar ON ar."id" = adc."allocationRevisionId"
        JOIN "logistics_allocation_revision_lines" arl ON arl."revisionId" = ar."id"
        JOIN "contract_items" ci ON ci."id" = arl."sourceContractItemId"
        JOIN "sales_contracts" sc ON sc."id" = ci."contractId"
        JOIN "accounting_financial_records" afr ON afr."contractId" = ci."contractId"
        WHERE w."status" = 'EXIT_RECORDED' AND ci."productRowId" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "contract_approved_pricing_versions" pv WHERE pv."contractId" = ci."contractId")
          AND NOT EXISTS (SELECT 1 FROM "dispatch_document_artifacts" da WHERE da."waybillId" = w."id")
        ORDER BY w."issuedAt", arl."id"
        LIMIT 1
      `);
      assert(candidate, 'sabalanerp-local needs one exited waybill with an unsealed stable contract row');

      const repository = new PrismaApprovedPricingRepository(tx);
      const versionId = randomUUID();
      const rowId = randomUUID();
      const versionNumber = await repository.nextVersionNumber(candidate.contractId);
      const approvedAt = new Date('2026-08-09T10:00:00.000Z');
      const componentEvidence = { material: '100.000000000000', discountBasis: '100.000000000000' };
      const rowInput = { versionId, contractId: candidate.contractId, sourceFinancialRecordId: candidate.financialRecordId,
        versionNumber, contractItemId: candidate.itemId, productRowId: candidate.productRowId, ordinal: 1,
        contractedQuantity: candidate.lineQuantity.toFixed(3), unit: candidate.lineUnit,
        canonicalAllInTotal: '100.000000000000', discountEligible: true, componentEvidence };
      const rowHash = approvedPricingRowIntegrityHash(rowInput);
      const sourceEvidence = { customer: { id: 'db-customer' }, project: { id: 'db-project' },
        destination: { kind: 'PROJECT_ADDRESS', projectId: 'db-project', address: 'db-destination' } };
      const rootInput = { id: versionId, contractId: candidate.contractId, versionNumber,
        sourceFinancialRecordId: candidate.financialRecordId, approvedAt, approvedBy: candidate.createdBy,
        schemaVersion: 1, currency: candidate.currency, grossAmount: '100.000000000000',
        discountAmount: '0.000000000000', netAmount: '100.000000000000', sourceEvidence, rowHashes: [rowHash] };
      const version: ApprovedPricingVersionInsert = { ...rootInput, integrityHash: approvedPricingVersionIntegrityHash(rootInput),
        rows: [{ id: rowId, ...rowInput, integrityHash: rowHash }] };
      await repository.insertAndAdvance(version);
      const readiness = await tx.contractPricingReadinessResult.create({ data: {
        contractId: candidate.contractId, pricingVersionId: versionId, sourceFinancialRecordId: candidate.financialRecordId,
        status: PricingReadinessStatus.READY, sourceCount: 1, sourceIdentityHash: hash('d'),
        quantityTotal: candidate.lineQuantity.toFixed(3), amountTotal: '100.000000000000', evidenceHash: hash('e'),
        evaluatedBy: candidate.createdBy,
      } });
      await tx.logisticsAllocationRevisionPricing.create({ data: { allocationRevisionId: candidate.revisionId,
        contractId: candidate.contractId, pricingVersionId: versionId, expectedPricingHash: version.integrityHash,
        readinessEvidenceHash: readiness.evidenceHash } });
      const eventEvidence = { schemaVersion: 1, ledgerSequence: 1 };
      const eventPayload = { allocationRevisionId: candidate.revisionId, allocationRevisionLineId: candidate.revisionLineId,
        pricingVersionId: versionId, pricingRowId: rowId, quantity: candidate.lineQuantity.toFixed(3),
        grossAmount: '100.000000000000', discountAmount: '0.000000000000', netAmount: '100.000000000000',
        consumesFinalRemainder: true, evidence: eventEvidence, recordedBy: candidate.createdBy };
      await tx.dispatchPricedAllocationEvent.create({ data: { ...eventPayload, quantity: candidate.lineQuantity,
        grossAmount: '100.000000000000', discountAmount: '0.000000000000', netAmount: '100.000000000000',
        integrityHash: pricedAllocationIntegrityHash(eventPayload) } });
      const originalStatement = await tx.dispatchDocumentArtifact.create({ data: { id: randomUUID(), waybillId: candidate.waybillId,
        kind: 'STATEMENT', templateVersion: 'statement-v1', storageKey: `dispatch-documents/${randomUUID()}.pdf`,
        mediaType: 'application/pdf', byteLength: 100n, sha256: hash('a'), sourceIntegrityHash: version.integrityHash,
        publishedBy: candidate.createdBy } });

      const correction = await tx.dispatchCorrection.create({ data: { waybillId: candidate.waybillId,
        reason: 'DB positive correction', effectiveAt: new Date(), createdBy: candidate.createdBy,
        lines: { create: { contractId: candidate.contractId, contractItemId: candidate.itemId,
          productRowId: candidate.productRowId, unit: candidate.lineUnit, quantity: '0.500' } } }, include: { lines: true } });

      await assert.rejects(planStatementAdjustment(tx, { correctionId: correction.id, actorId: candidate.createdBy,
        correctionIntegrityHash: hash('c'), issuedAt: new Date(), artifactPreparer: { templateVersion: 'adjustment-v1',
          prepare: async () => ({ storageKey: `dispatch-documents/${randomUUID()}.pdf`, mediaType: 'application/pdf',
            byteLength: 100, sha256: 'invalid' }) } }), /artifact failed durable publication verification/i);
      assert.equal((await tx.dispatchCorrection.findUniqueOrThrow({ where: { id: correction.id } })).status, 'DRAFT');
      assert.equal(await tx.dispatchStatementAdjustment.count({ where: { waybillId: candidate.waybillId } }), 0);

      const issuedAt = new Date();
      const plan = await planStatementAdjustment(tx, { correctionId: correction.id, actorId: candidate.createdBy,
        correctionIntegrityHash: hash('c'), issuedAt, artifactPreparer: { templateVersion: 'adjustment-v1',
          prepare: async () => ({ storageKey: `dispatch-documents/${randomUUID()}.pdf`, mediaType: 'application/pdf',
            byteLength: 100, sha256: hash('b') }) } });
      assert(plan);
      assert.equal(await tx.dispatchStatementAdjustment.count({ where: { waybillId: candidate.waybillId } }), 0,
        'a draft correction and prepared artifact reserve no customer-facing sequence');
      await tx.dispatchCorrection.update({ where: { id: correction.id }, data: { status: 'POSTED', postedAt: issuedAt,
        postedBy: candidate.createdBy, integrityHash: hash('c') } });
      const first = await persistStatementAdjustment(tx, plan);
      assert.equal(first.adjustment.sequence, 1);
      assert.equal(first.artifact.sourceIntegrityHash, first.adjustment.integrityHash);
      assert.equal((first.adjustment.snapshot as any).originalStatementDocumentId, originalStatement.id);
      assert.match((first.adjustment.snapshot as any).lines[0].grossAmountDelta, /^-?\d+\.\d{12}$/);

      const reversal = await tx.dispatchCorrection.create({ data: { waybillId: candidate.waybillId,
        reason: 'DB immutable opposite', effectiveAt: new Date(), createdBy: candidate.createdBy, reversalOfId: correction.id,
        lines: { create: { contractId: candidate.contractId, contractItemId: candidate.itemId,
          productRowId: candidate.productRowId, unit: candidate.lineUnit, quantity: '-0.500' } } }, include: { lines: true } });
      const reversalAt = new Date();
      const reversalPlan = await planStatementAdjustment(tx, { correctionId: reversal.id, actorId: candidate.createdBy,
        correctionIntegrityHash: hash('f'), issuedAt: reversalAt, artifactPreparer: { templateVersion: 'adjustment-v1',
          prepare: async () => ({ storageKey: `dispatch-documents/${randomUUID()}.pdf`, mediaType: 'application/pdf',
            byteLength: 100, sha256: hash('9') }) } });
      assert(reversalPlan);
      await tx.dispatchCorrection.update({ where: { id: reversal.id }, data: { status: 'POSTED', postedAt: reversalAt,
        postedBy: candidate.createdBy, integrityHash: hash('f') } });
      const second = await persistStatementAdjustment(tx, reversalPlan);
      assert.equal(second.adjustment.sequence, 2);
      assert.equal((second.adjustment.snapshot as any).lines[0].grossAmountDelta,
        new Prisma.Decimal((first.adjustment.snapshot as any).lines[0].grossAmountDelta).negated().toFixed(12));
      assert.equal(await tx.dispatchStatementAdjustment.count({ where: { waybillId: candidate.waybillId } }), 2);
      assert.equal(await tx.dispatchDocumentArtifact.count({ where: { waybillId: candidate.waybillId,
        kind: 'STATEMENT_ADJUSTMENT' } }), 2);
      assert.deepEqual(await tx.dispatchDocumentArtifact.findUniqueOrThrow({ where: { id: originalStatement.id } }), originalStatement,
        'adjustments must not rewrite the original statement artifact');
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const after = {
    versions: await prisma.contractApprovedPricingVersion.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    statements: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT' } }),
    corrections: await prisma.dispatchCorrection.count(),
    adjustments: await prisma.dispatchStatementAdjustment.count(),
    artifacts: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT_ADJUSTMENT' } }),
  };
  assert.deepEqual(after, before, 'rollback must preserve every pre-test evidence count');
};

run()
  .then(() => console.log('statement adjustment Prisma integration: rollback/count/sequence/artifact-failure ok'))
  .finally(() => prisma.$disconnect());
