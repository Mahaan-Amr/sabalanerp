import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PricingReadinessStatus, Prisma, PrismaClient } from '@prisma/client';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from '../approvedPricing';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import type { ApprovedPricingVersionInsert } from '../approvedPricing/types';
import { createDispatchCorrection, dispatchLifecycleAuditEventHash, postDispatchCorrection } from '../dispatchCorrectionOutage';
import { createStatementAdjustmentArtifactPreparer, type DispatchArtifactStorage } from '../dispatchDocuments';
import { pricedAllocationIntegrityHash } from '../pricedAllocationLedger';
import { readShipmentQuantityProjection, shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { assertStatementAdjustmentRaceEvidence } from './shipmentStatementConcurrency/statementAdjustmentEvidence';

const prisma = new PrismaClient();
const rollback = Symbol('statement-adjustment-db-rollback');
const hash = (character: string) => character.repeat(64);
const runConcurrency = process.env.ISSUE262_TWO_CONNECTION_RACE === '1';
if (runConcurrency) {
  assert.match(process.env.DATABASE_URL || '',
    /\/(?:sabalanerp_issue262_[a-z0-9_]+|sabalanerp_concurrency_[a-f0-9]{16})(?:\?|$)/,
    'Two-connection proof may run only in an explicit issue262 or issue260 temporary database.');
}
const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Readonly<Record<string, unknown>> : {};
const bytes = (value: string) => new TextEncoder().encode(value);
const configuredArtifactPreparer = (options: { corruptOnReverify?: boolean;
  onPublish?: () => void } = {}) => {
  const files = new Map<string, Uint8Array>();
  let readCount = 0;
  const storage: DispatchArtifactStorage = {
    stage: async ({ storageKey, bytes: content }) => { files.set(storageKey, content); },
    read: async (storageKey) => {
      readCount += 1;
      return options.corruptOnReverify && readCount > 1
        ? bytes('different-durable-bytes') : files.get(storageKey) ?? null;
    },
  };
  return {
    templateVersion: 'adjustment-v1',
    storage,
    preparer: createStatementAdjustmentArtifactPreparer({
      publisher: { publish: async () => {
        options.onPublish?.();
        return { bytes: bytes('statement-adjustment-pdf'), mediaType: 'application/pdf' };
      } },
      storage,
      generatorVersion: 'issue262-test-generator-v1',
      sourceVersionIdentities: { fixture: 'issue262' },
    }),
  };
};

const run = async () => {
  assert.ok(process.env.DATABASE_URL?.includes('127.0.0.1:55432'), 'Integration must target sabalanerp-local PostgreSQL.');
  const before = {
    versions: await prisma.contractApprovedPricingVersion.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    statements: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT' } }),
    corrections: await prisma.dispatchCorrection.count(),
    adjustments: await prisma.dispatchStatementAdjustment.count(),
    artifacts: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT_ADJUSTMENT' } }),
    movements: await prisma.securityVehicleMovement.count(),
    quantityEvidence: await prisma.shipmentQuantityEvidence.count(),
    commands: await prisma.dispatchDocumentCommandResult.count({ where: { scope: 'CORRECTION' } }),
    audits: await prisma.dispatchLifecycleAudit.count({ where: { aggregateType: 'DISPATCH_CORRECTION' } }),
  };
  let committedFixture: { waybillId: string; correctionIds: [string, string]; returnAndReshipIds: [string, string];
    returnEvidenceId: string; actorId: string;
    authority: { actorRole: string; workspace: string; workspacePermission: string } } | null = null;
  try {
    committedFixture = await prisma.$transaction(async (tx) => {
      const [candidate] = await tx.$queryRaw<Array<{
        waybillId: string; revisionId: string; revisionLineId: string; itemId: string; productRowId: string;
        contractId: string; financialRecordId: string; createdBy: string; currency: string;
        lineQuantity: Prisma.Decimal; lineUnit: string; loadingId: string;
      }>>(Prisma.sql`
        SELECT w."id" AS "waybillId", ar."id" AS "revisionId", arl."id" AS "revisionLineId",
          ci."id" AS "itemId", ci."productRowId", ci."contractId", afr."id" AS "financialRecordId",
          afr."createdBy", sc."currency", arl."quantity" AS "lineQuantity", arl."unit" AS "lineUnit", ar."loadingId"
        FROM "accounting_dispatch_waybills" w
        JOIN "accounting_dispatch_candidates" adc ON adc."id" = w."candidateId"
        JOIN "guard_physical_exits" gpe ON gpe."waybillId" = w."id"
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
      const projectionBefore = await tx.shipmentQuantityProjection.findUnique({ where: { contractItemId: candidate.itemId } });

      const boundPrisma = { $transaction: async (work: (transaction: Prisma.TransactionClient) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
      const authority = { actorRole: 'ADMIN', workspace: 'accounting', workspacePermission: 'admin' };
      const correction = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
        reason: 'DB positive correction', effectiveAt: new Date(), actorId: candidate.createdBy, authority,
        lines: [{ contractItemId: candidate.itemId, quantity: '0.500' }] });

      await assert.rejects(postDispatchCorrection(boundPrisma, { correctionId: correction.id, actorId: candidate.createdBy,
        authority, idempotencyKey: 'issue262-invalid-artifact' }, {
          artifactPreparer: configuredArtifactPreparer({ corruptOnReverify: true }),
        }), /durable dispatch artifact changed before metadata publication/i);
      assert.equal((await tx.dispatchCorrection.findUniqueOrThrow({ where: { id: correction.id } })).status, 'DRAFT');
      assert.equal(await tx.dispatchStatementAdjustment.count({ where: { waybillId: candidate.waybillId } }), 0);

      let prepareCount = 0;
      const artifactPreparer = configuredArtifactPreparer({ onPublish: () => { prepareCount += 1; } });
      const firstResponse = await postDispatchCorrection(boundPrisma, { correctionId: correction.id,
        actorId: candidate.createdBy, authority, idempotencyKey: 'issue262-positive' }, { artifactPreparer });
      const first = await tx.dispatchStatementAdjustment.findUniqueOrThrow({ where: { correctionId: correction.id } });
      const firstArtifact = await tx.dispatchDocumentArtifact.findUniqueOrThrow({ where: { statementAdjustmentId: first.id } });
      assert.equal(first.sequence, 1);
      assert.equal(firstArtifact.sourceIntegrityHash, first.integrityHash);
      const firstAudit = await tx.dispatchLifecycleAudit.findFirstOrThrow({ where: {
        aggregateType: 'DISPATCH_CORRECTION', aggregateId: correction.id, eventType: 'CORRECTION_POSTED',
      } });
      const firstAuditPayload = record(firstAudit.payload);
      assert.equal(firstAuditPayload.statementAdjustmentId, first.id);
      assert.equal(firstAuditPayload.statementAdjustmentIntegrityHash, first.integrityHash);
      assert.equal(firstAuditPayload.statementAdjustmentArtifactId, firstArtifact.id);
      assert.equal(firstAuditPayload.statementAdjustmentArtifactSourceIntegrityHash, firstArtifact.sourceIntegrityHash);
      assert.equal(firstAudit.eventHash, dispatchLifecycleAuditEventHash({
        aggregateType: firstAudit.aggregateType,
        aggregateId: firstAudit.aggregateId,
        eventType: firstAudit.eventType,
        payload: firstAuditPayload,
        actorId: firstAudit.actorId,
        authority: record(firstAuditPayload.effectiveAuthority) as typeof authority,
        at: firstAudit.recordedAt,
        previousHash: firstAudit.previousHash,
      }), 'the actual post writer must persist the canonical audit event hash');
      assert.equal((first.snapshot as any).originalStatementDocumentId, originalStatement.id);
      assert.match((first.snapshot as any).lines[0].grossAmountDelta, /^-?\d+\.\d{12}$/);
      assert.deepEqual(await postDispatchCorrection(boundPrisma, { correctionId: correction.id,
        actorId: candidate.createdBy, authority, idempotencyKey: 'issue262-positive' }, { artifactPreparer }), firstResponse);
      assert.equal(prepareCount, 1, 'an identical retry must replay the persisted result without publishing another artifact');
      await assert.rejects(postDispatchCorrection(boundPrisma, { correctionId: correction.id,
        actorId: `${candidate.createdBy}-different`, authority, idempotencyKey: 'issue262-positive' }, { artifactPreparer }),
      /different command evidence/i);

      const reversal = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
        reason: 'DB immutable opposite', effectiveAt: new Date(), actorId: candidate.createdBy, authority,
        reversalOfId: correction.id, lines: [{ contractItemId: candidate.itemId, quantity: '-0.500' }] });
      await postDispatchCorrection(boundPrisma, { correctionId: reversal.id, actorId: candidate.createdBy,
        authority, idempotencyKey: 'issue262-reversal' }, { artifactPreparer: configuredArtifactPreparer() });
      const second = await tx.dispatchStatementAdjustment.findUniqueOrThrow({ where: { correctionId: reversal.id } });
      assert.equal(second.sequence, 2);
      assert.equal((second.snapshot as any).lines[0].grossAmountDelta,
        new Prisma.Decimal((first.snapshot as any).lines[0].grossAmountDelta).negated().toFixed(12));

      const dispatchEvidence = await tx.shipmentQuantityEvidence.findFirstOrThrow({ where: {
        kind: 'PHYSICAL_EXIT', contractItemId: candidate.itemId,
        metadata: { path: ['waybillId'], equals: candidate.waybillId },
      }, orderBy: { effectiveAt: 'desc' } });
      const returnQuantity = Prisma.Decimal.min(candidate.lineQuantity, new Prisma.Decimal('0.002')).toDecimalPlaces(3);
      const movementOccurredAt = new Date(Math.max(dispatchEvidence.effectiveAt.getTime() + 1, Date.now() - 2_000));
      const movementCompletedAt = new Date(movementOccurredAt.getTime() + 500);
      const returnRecordedAt = new Date(movementCompletedAt.getTime() + 500);
      const movement = await tx.securityVehicleMovement.create({ data: {
        movementNumber: `I262-${randomUUID()}`,
        direction: 'INBOUND',
        purpose: 'SALES_RETURN',
        status: 'INFO_COMPLETED',
        loadingId: candidate.loadingId,
        occurredAt: movementOccurredAt,
        completedAt: movementCompletedAt,
        createdBy: candidate.createdBy,
      } });
      const returnEvidenceBase = {
        id: randomUUID(),
        contractId: candidate.contractId,
        contractItemId: candidate.itemId,
        productRowId: candidate.productRowId,
        unit: candidate.lineUnit,
        kind: 'GUARD_RETURN_VERIFIED' as const,
        quantity: returnQuantity.toFixed(3),
        effectiveAt: movementOccurredAt.toISOString(),
        recordedAt: returnRecordedAt.toISOString(),
        sourceType: 'GUARD_RETURN_MOVEMENT',
        sourceId: movement.id,
        sourceVersion: 1,
        integrityHash: '',
        guardReturnMovementId: movement.id,
        dispatchEvidenceId: dispatchEvidence.id,
        metadata: { dispatchLoadingId: candidate.loadingId },
      };
      const returnEvidence = await tx.shipmentQuantityEvidence.create({ data: {
        ...returnEvidenceBase,
        quantity: returnQuantity,
        effectiveAt: movementOccurredAt,
        recordedAt: returnRecordedAt,
        integrityHash: shipmentQuantityEvidenceIntegrityHash(returnEvidenceBase),
      } });
      const returned = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
        reason: 'DB verified Guard return', effectiveAt: returnRecordedAt, actorId: candidate.createdBy, authority,
        lines: [{ contractItemId: candidate.itemId, quantity: returnQuantity.negated().toFixed(3),
          returnEvidenceId: returnEvidence.id }] });
      await postDispatchCorrection(boundPrisma, { correctionId: returned.id, actorId: candidate.createdBy,
        authority, idempotencyKey: 'issue262-verified-return' }, { artifactPreparer: configuredArtifactPreparer() });
      assert.equal(await tx.shipmentQuantityEvidence.count({ where: {
        kind: 'DISPATCH_CORRECTION_POSTED', returnEvidenceId: returnEvidence.id,
      } }), 1, 'a verified Guard return is consumed exactly once by the actual atomic post command');
      if (projectionBefore?.physicallyDispatched) {
        const projectionAfter = await tx.shipmentQuantityProjection.findUniqueOrThrow({ where: { contractItemId: candidate.itemId } });
        const rebuilt = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId: candidate.contractId });
        const rebuiltRow = rebuilt.rows.find((row) => row.contractItemId === candidate.itemId);
        assert.ok(rebuiltRow?.quantities, 'the corrected row must remain projection-ready');
        assert.equal(projectionAfter.physicallyDispatched?.toFixed(3), rebuiltRow.quantities.physicallyDispatched);
        assert.equal(projectionAfter.availableToLoad?.toFixed(3), rebuiltRow.quantities.availableToLoad);
      }
      assert.equal(await tx.dispatchStatementAdjustment.count({ where: { waybillId: candidate.waybillId } }), 3);
      assert.equal(await tx.dispatchDocumentArtifact.count({ where: { waybillId: candidate.waybillId,
        kind: 'STATEMENT_ADJUSTMENT' } }), 3);
      assert.deepEqual(await tx.dispatchDocumentArtifact.findUniqueOrThrow({ where: { id: originalStatement.id } }), originalStatement,
        'adjustments must not rewrite the original statement artifact');
      if (runConcurrency) {
        const raceA = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
          reason: 'DB sequence race A', effectiveAt: new Date(), actorId: candidate.createdBy, authority,
          lines: [{ contractItemId: candidate.itemId, quantity: '0.001' }] });
        const raceB = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
          reason: 'DB sequence race B', effectiveAt: new Date(), actorId: candidate.createdBy, authority,
          lines: [{ contractItemId: candidate.itemId, quantity: '0.001' }] });
        const concurrentMovementAt = new Date(returnRecordedAt.getTime() + 1);
        const concurrentMovement = await tx.securityVehicleMovement.create({ data: {
          movementNumber: `I260-${randomUUID()}`,
          direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED', loadingId: candidate.loadingId,
          occurredAt: concurrentMovementAt, completedAt: new Date(concurrentMovementAt.getTime() + 1),
          createdBy: candidate.createdBy,
        } });
        const concurrentReturnBase = { id: randomUUID(), contractId: candidate.contractId,
          contractItemId: candidate.itemId, productRowId: candidate.productRowId, unit: candidate.lineUnit,
          kind: 'GUARD_RETURN_VERIFIED' as const, quantity: '0.001', effectiveAt: concurrentMovementAt.toISOString(),
          recordedAt: new Date(concurrentMovementAt.getTime() + 2).toISOString(), sourceType: 'GUARD_RETURN_MOVEMENT',
          sourceId: concurrentMovement.id, sourceVersion: 1, integrityHash: '', guardReturnMovementId: concurrentMovement.id,
          dispatchEvidenceId: dispatchEvidence.id, metadata: { dispatchLoadingId: candidate.loadingId },
        };
        const concurrentReturn = await tx.shipmentQuantityEvidence.create({ data: { ...concurrentReturnBase,
          quantity: '0.001', effectiveAt: concurrentMovementAt, recordedAt: new Date(concurrentReturnBase.recordedAt),
          integrityHash: shipmentQuantityEvidenceIntegrityHash(concurrentReturnBase) } });
        const returnedAgain = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
          reason: 'DB concurrent verified return', effectiveAt: new Date(concurrentReturnBase.recordedAt),
          actorId: candidate.createdBy, authority,
          lines: [{ contractItemId: candidate.itemId, quantity: '-0.001', returnEvidenceId: concurrentReturn.id }] });
        const reship = await createDispatchCorrection(boundPrisma, { waybillId: candidate.waybillId,
          reason: 'DB concurrent reship', effectiveAt: new Date(concurrentReturnBase.recordedAt),
          actorId: candidate.createdBy, authority, lines: [{ contractItemId: candidate.itemId, quantity: '0.001' }] });
        return { waybillId: candidate.waybillId, correctionIds: [raceA.id, raceB.id] as [string, string],
          returnAndReshipIds: [returnedAgain.id, reship.id] as [string, string], returnEvidenceId: concurrentReturn.id,
          actorId: candidate.createdBy, authority };
      }
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  if (runConcurrency) {
    assert.ok(committedFixture, 'temporary DB race fixture must commit before opening independent connections');
    const [firstClient, secondClient] = [new PrismaClient(), new PrismaClient()];
    try {
      await Promise.all(committedFixture.correctionIds.map((correctionId, index) =>
        postDispatchCorrection(index === 0 ? firstClient : secondClient, {
          correctionId,
          actorId: committedFixture!.actorId,
          authority: committedFixture!.authority,
          idempotencyKey: `issue262-two-connection-${index + 1}`,
        }, { artifactPreparer: configuredArtifactPreparer() })));
      const raced = await prisma.dispatchStatementAdjustment.findMany({ where: {
        correctionId: { in: committedFixture.correctionIds },
      }, include: { artifact: true }, orderBy: { sequence: 'asc' } });
      assert.deepEqual(raced.map((item) => item.sequence), [4, 5],
        'two independent connections must serialize into unique adjacent waybill sequences');
      assert.equal(new Set(raced.map((item) => item.artifact?.id)).size, 2);
      assert.ok(raced.every((item) => item.artifact?.sourceIntegrityHash === item.integrityHash));

      const returnAndReshipResults = await Promise.allSettled(committedFixture.returnAndReshipIds.map((correctionId, index) =>
        postDispatchCorrection(index === 0 ? firstClient : secondClient, { correctionId,
          actorId: committedFixture!.actorId, authority: committedFixture!.authority,
          idempotencyKey: `issue260-return-reship-${index + 1}` }, { artifactPreparer: configuredArtifactPreparer() })));
      assert.equal(returnAndReshipResults[0].status, 'fulfilled', 'the verified return must always commit');
      let reshipRetried = false;
      if (returnAndReshipResults[1].status === 'rejected') {
        reshipRetried = true;
        await postDispatchCorrection(secondClient, { correctionId: committedFixture.returnAndReshipIds[1],
          actorId: committedFixture.actorId, authority: committedFixture.authority,
          idempotencyKey: 'issue260-return-reship-2' }, { artifactPreparer: configuredArtifactPreparer() });
      }
      const allCorrectionIds = [...committedFixture.correctionIds, ...committedFixture.returnAndReshipIds];
      const proofRows = await prisma.dispatchCorrection.findMany({ where: { id: { in: allCorrectionIds } }, include: {
        statementAdjustment: { include: { artifact: true } },
      } });
      const proofFor = async (correctionId: string) => {
        const correction = proofRows.find((row) => row.id === correctionId)!;
        const adjustment = correction.statementAdjustment!;
        const [commands, audits] = await Promise.all([
          prisma.dispatchDocumentCommandResult.findMany({ where: { scope: 'CORRECTION', scopeId: correctionId,
            command: 'ISSUE_ADJUSTMENT', status: 'SUCCEEDED' } }),
          prisma.dispatchLifecycleAudit.findMany({ where: { aggregateType: 'DISPATCH_CORRECTION', aggregateId: correctionId,
            eventType: 'CORRECTION_POSTED' } }),
        ]);
        const commandResponse = record(record(commands[0]?.result).response);
        const commandAdjustment = record(commandResponse.statementAdjustment);
        const auditPayload = record(audits[0]?.payload);
        const auditAuthority = record(auditPayload.effectiveAuthority) as typeof committedFixture.authority;
        return { reason: correction.reason, adjustmentId: adjustment.id, sequence: adjustment.sequence,
          integrityHash: adjustment.integrityHash,
          artifact: adjustment.artifact ? { id: adjustment.artifact.id,
            sourceIntegrityHash: adjustment.artifact.sourceIntegrityHash } : null,
          commandCount: commands.length, commandAdjustmentId: String(commandAdjustment.id || ''), auditCount: audits.length,
          adjustmentIntegrityVerified: pricedAllocationIntegrityHash(adjustment.snapshot) === adjustment.integrityHash,
          auditIntegrityVerified: Boolean(audits[0]) && audits[0].eventHash === dispatchLifecycleAuditEventHash({
            aggregateType: audits[0].aggregateType, aggregateId: audits[0].aggregateId, eventType: audits[0].eventType,
            payload: auditPayload, actorId: audits[0].actorId, authority: auditAuthority, at: audits[0].recordedAt,
            previousHash: audits[0].previousHash,
          }), adjustment };
      };
      const sequenceProof = await Promise.all(committedFixture.correctionIds.map(proofFor));
      const returnProof = await Promise.all(committedFixture.returnAndReshipIds.map(proofFor));
      const verified = assertStatementAdjustmentRaceEvidence({
        sequencePosts: sequenceProof.map(({ adjustment: _adjustment, ...proof }) => proof),
        returnAndReship: returnProof.map(({ adjustment, ...proof }) => ({ ...proof,
          line: (adjustment.snapshot as any).lines[0] })),
        consumedReturnEvidenceCount: await prisma.shipmentQuantityEvidence.count({ where: {
          kind: 'DISPATCH_CORRECTION_POSTED', returnEvidenceId: committedFixture.returnEvidenceId,
        } }),
      });
      assert.deepEqual(verified.sequenceRange, [4, 7]);
      console.log(JSON.stringify({ kind: 'issue260-statement-adjustment-concurrency-proof',
        scenarios: ['concurrent-correction-adjustment-sequence-posting',
          'verified-return-vs-reship-final-remainder-attribution'],
        reshipInitialStatus: returnAndReshipResults[1].status, reshipRetried, ...verified }));
    } finally {
      await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    }
    return;
  }
  const after = {
    versions: await prisma.contractApprovedPricingVersion.count(),
    events: await prisma.dispatchPricedAllocationEvent.count(),
    statements: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT' } }),
    corrections: await prisma.dispatchCorrection.count(),
    adjustments: await prisma.dispatchStatementAdjustment.count(),
    artifacts: await prisma.dispatchDocumentArtifact.count({ where: { kind: 'STATEMENT_ADJUSTMENT' } }),
    movements: await prisma.securityVehicleMovement.count(),
    quantityEvidence: await prisma.shipmentQuantityEvidence.count(),
    commands: await prisma.dispatchDocumentCommandResult.count({ where: { scope: 'CORRECTION' } }),
    audits: await prisma.dispatchLifecycleAudit.count({ where: { aggregateType: 'DISPATCH_CORRECTION' } }),
  };
  assert.deepEqual(after, before, 'rollback must preserve every pre-test evidence count');
};

run()
  .then(() => console.log(runConcurrency
    ? 'statement adjustment Prisma integration: two-connection sequence race ok'
    : 'statement adjustment Prisma integration: rollback/count/sequence/artifact-failure ok'))
  .finally(() => prisma.$disconnect());
