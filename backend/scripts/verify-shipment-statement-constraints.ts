import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const hash = (character: string) => character.repeat(64);

const expectConstraintFailure = async (operation: () => Promise<unknown>, message: RegExp) => {
  await assert.rejects(operation, message);
};

const run = async () => {
  const [source] = await prisma.$queryRaw<Array<{
    contractId: string;
    contractItemId: string;
    financialRecordId: string;
    productRowId: string;
  }>>`
    SELECT c."id" AS "contractId", i."id" AS "contractItemId", f."id" AS "financialRecordId", i."productRowId"
    FROM "sales_contracts" c
    JOIN "contract_items" i ON i."contractId" = c."id" AND i."productRowId" IS NOT NULL
    JOIN "accounting_financial_records" f ON f."contractId" = c."id"
    LIMIT 1
  `;
  assert.ok(source, 'A financially evidenced contract item is required for the constraint verification.');

  await expectConstraintFailure(() => prisma.$transaction(async (tx) => {
    const versionId = randomUUID();
    await tx.$executeRawUnsafe(`
      INSERT INTO "contract_approved_pricing_versions"
        ("id", "contractId", "versionNumber", "sourceFinancialRecordId", "origin", "approvedAt", "approvedBy",
         "schemaVersion", "currency", "grossAmount", "discountAmount", "netAmount", "sourceEvidence", "integrityHash")
      VALUES ($1, $2, 900001, $3, 'FINANCIAL_APPROVAL', now(), 'constraint-verifier', 1, 'IRR',
              100, 10, 90, '{}'::jsonb, $4)
    `, versionId, source.contractId, source.financialRecordId, hash('a'));
    await tx.$executeRawUnsafe(`
      INSERT INTO "contract_approved_pricing_rows"
        ("id", "pricingVersionId", "contractItemId", "productRowId", "ordinal", "contractedQuantity", "unit",
         "canonicalAllInTotal", "discountEligible", "componentEvidence", "integrityHash")
      VALUES ($1, $2, $3, $4, 1, 1.000, 'unit', 100, true, '{}'::jsonb, $5)
    `, randomUUID(), versionId, source.contractItemId, `${source.productRowId}-wrong`, hash('b'));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), /pricing row stable product identity differs from contract item/);

  const [unrelatedAllocationLine] = await prisma.$queryRaw<Array<{ id: string; revisionId: string }>>`
    SELECT "id", "revisionId"
    FROM "logistics_allocation_revision_lines"
    WHERE "sourceContractId" <> ${source.contractId}
    LIMIT 1
  `;
  assert.ok(unrelatedAllocationLine, 'An unrelated allocation line is required for source-identity verification.');
  await expectConstraintFailure(() => prisma.$transaction(async (tx) => {
    const versionId = randomUUID();
    const pricingRowId = randomUUID();
    await tx.$executeRawUnsafe(`
      INSERT INTO "contract_approved_pricing_versions"
        ("id", "contractId", "versionNumber", "sourceFinancialRecordId", "origin", "approvedAt", "approvedBy",
         "schemaVersion", "currency", "grossAmount", "discountAmount", "netAmount", "sourceEvidence", "integrityHash")
      VALUES ($1, $2, 900002, $3, 'FINANCIAL_APPROVAL', now(), 'constraint-verifier', 1, 'IRR',
              100, 10, 90, '{}'::jsonb, $4)
    `, versionId, source.contractId, source.financialRecordId, hash('a'));
    await tx.$executeRawUnsafe(`
      INSERT INTO "contract_approved_pricing_rows"
        ("id", "pricingVersionId", "contractItemId", "productRowId", "ordinal", "contractedQuantity", "unit",
         "canonicalAllInTotal", "discountEligible", "componentEvidence", "integrityHash")
      VALUES ($1, $2, $3, $4, 1, 1.000, 'unit', 100, true, '{}'::jsonb, $5)
    `, pricingRowId, versionId, source.contractItemId, source.productRowId, hash('b'));
    await tx.$executeRawUnsafe(`
      INSERT INTO "logistics_allocation_revision_pricing"
        ("id", "allocationRevisionId", "contractId", "pricingVersionId", "expectedPricingHash", "readinessEvidenceHash")
      VALUES ($1, $2, $3, $4, $5, $6)
    `, randomUUID(), unrelatedAllocationLine.revisionId, source.contractId, versionId, hash('a'), hash('c'));
    await tx.$executeRawUnsafe(`
      INSERT INTO "dispatch_priced_allocation_events"
        ("id", "allocationRevisionId", "allocationRevisionLineId", "pricingVersionId", "pricingRowId", "quantity",
         "grossAmount", "discountAmount", "netAmount", "consumesFinalRemainder", "evidence", "integrityHash", "recordedBy")
      VALUES ($1, $2, $3, $4, $5, 1.000, 100, 10, 90, false, '{}'::jsonb, $6, 'constraint-verifier')
    `, randomUUID(), unrelatedAllocationLine.revisionId, unrelatedAllocationLine.id, versionId, pricingRowId, hash('d'));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), /priced event source contract differs from approved pricing/);

  const waybill = await prisma.accountingDispatchWaybill.findFirst({ select: { id: true } });
  assert.ok(waybill, 'An existing waybill is required for the adjustment constraint verification.');
  await expectConstraintFailure(() => prisma.$transaction(async (tx) => {
    const correctionId = randomUUID();
    await tx.$executeRawUnsafe(`
      INSERT INTO "dispatch_corrections" ("id", "waybillId", "status", "reason", "effectiveAt", "createdBy")
      VALUES ($1, $2, 'DRAFT', 'constraint verification', now(), 'constraint-verifier')
    `, correctionId, waybill.id);
    await tx.$executeRawUnsafe(`
      INSERT INTO "dispatch_statement_adjustments"
        ("id", "waybillId", "correctionId", "sequence", "snapshot", "integrityHash", "issuedBy")
      VALUES ($1, $2, $3, 900001, '{}'::jsonb, $4, 'constraint-verifier')
    `, randomUUID(), waybill.id, correctionId, hash('c'));
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }), /statement adjustment requires a posted correction/);

  const [replacement] = await prisma.$queryRaw<Array<{ predecessorId: string; successorId: string }>>`
    SELECT predecessor."id" AS "predecessorId", successor."id" AS "successorId"
    FROM "accounting_dispatch_waybills" successor
    JOIN "accounting_dispatch_waybills" predecessor ON predecessor."id" = successor."replacesWaybillId"
    LIMIT 1
  `;
  assert.ok(replacement, 'An existing replacement waybill pair is required for artifact history verification.');
  const rollback = new Error('ROLLBACK_VERIFIED_ARTIFACT_INSERTS');
  try {
    await prisma.$transaction(async (tx) => {
      const sharedChecksum = hash('d');
      for (const [ordinal, waybillId] of [replacement.predecessorId, replacement.successorId].entries()) {
        await tx.dispatchDocumentArtifact.create({
          data: {
            id: randomUUID(),
            waybillId,
            kind: 'WAYBILL',
            templateVersion: 'constraint-verification-v1',
            storageKey: `constraint-verification/${randomUUID()}.pdf`,
            mediaType: 'application/pdf',
            byteLength: 1n,
            sha256: sharedChecksum,
            sourceIntegrityHash: hash(ordinal === 0 ? 'e' : 'f'),
            publishedBy: 'constraint-verifier',
          },
        });
      }
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    assert.fail('Artifact verification transaction unexpectedly committed.');
  } catch (error) {
    assert.equal(error, rollback, 'Replacement waybills must independently retain artifacts even when checksums match.');
  }

  await expectConstraintFailure(() => prisma.dispatchDocumentCommandResult.create({
    data: {
      id: randomUUID(),
      waybillId: waybill.id,
      scope: 'CANDIDATE',
      scopeId: 'candidate-scope-cannot-carry-waybill',
      idempotencyKey: randomUUID(),
      command: 'ACCEPT_AND_ISSUE',
      status: 'STARTED',
      actorId: 'constraint-verifier',
      correlationId: randomUUID(),
    },
  }), /dispatch_document_command_scope_identity_valid/);

  console.log('shipment statement database constraint verification passed');
};

run().finally(() => prisma.$disconnect());
