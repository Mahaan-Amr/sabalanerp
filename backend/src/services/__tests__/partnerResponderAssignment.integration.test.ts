import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, type PartnerManagementCommandV2 } from '@sabalanerp/partner-sales-contracts';
import { createPartnerResponderAssignmentService } from '../partnerSales/management/responderAssignment';
import { resolveEligibleResponder, resolveProfileResponder } from '../partnerSales/inquiries/adapters';
import { grantScopedAction } from '../effectiveAuthorization/scopedActions';
import { createPartnerInquiryService } from '../partnerSales/inquiries/service';

function localDatabaseUrl(): string {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10');
  return url.toString();
}

async function command(actorId: string, profileId: string, responderId: string, expectedRevision: number,
  commandId = randomUUID()): Promise<PartnerManagementCommandV2> {
  const intent = { schemaVersion: 2 as const, type: 'RESPONDER_ASSIGN' as const, profileId, expectedRevision,
    responderId, reason: 'تخصیص پاسخ‌دهنده برای استعلام‌های جدید' };
  return { ...intent, commandId, correlationId: commandId, idempotency: { actorId, operation: 'RESPONDER_ASSIGN',
    targetId: profileId, key: commandId, payloadHash: await canonicalHash(intent) } };
}

test('profile responder assignment is append-only, CAS protected and exactly replayable', async () => {
  const database = new PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const rollback = new Error('rollback responder assignment fixture');
  try {
    await database.$transaction(async tx => {
      const suffix = randomUUID(), actorId = `manager-${suffix}`, partnerId = `partner-${suffix}`;
      const responderA = `responder-a-${suffix}`, responderB = `responder-b-${suffix}`;
      await tx.user.createMany({ data: [actorId, partnerId, responderA, responderB].map((id, index) => ({ id,
        username: id, email: `${id}@example.invalid`, password: 'not-a-login', firstName: `User${index}`, lastName: 'Fixture',
        ...(id === actorId ? { role: 'ADMIN' as const } : {}) })) });
      await tx.partnerProfile.create({ data: { id: partnerId, userId: partnerId, state: 'ACTIVE' } });
      await tx.partnerReleaseCohort.create({ data: { id: partnerId, name: partnerId, activationEnabled: true,
        enrollmentPaused: false, operationalPaused: true } });
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: {
        cohortId: partnerId, enrollmentPaused: false, operationalPaused: true } });
      await tx.partnerCohortMembership.create({ data: { id: partnerId, profileId: partnerId, cohortId: partnerId,
        actorId, eligibilityEvidence: { fixture: true } } });
      for (const responderId of [responderA, responderB]) await grantScopedAction(tx,
        { actorId, reason: 'مجوز پاسخ استعلام برای تست', correlationId: `grant-${responderId}` },
        { principal: { kind: 'USER', id: responderId }, domain: 'PARTNER', action: 'INQUIRY_RESPOND',
          rootKind: 'INQUIRY', purpose: 'RESPONDER', scope: 'ASSIGNED', effect: 'ALLOW' });
      const service = createPartnerResponderAssignmentService({ actorId,
        transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
        authorize: async () => ({ ok: true, value: { evidenceId: 'authorization-fixture' } }),
        resolveResponder: resolveEligibleResponder,
      });
      const firstCommand = await command(actorId, partnerId, responderA, 1);
      const first = await service.execute(firstCommand);
      assert.equal(first.ok, true);
      if (!first.ok) return;
      assert.equal(first.value.revision, 2);
      const storedEvidence = (await tx.partnerProfileResponderAssignment.findFirstOrThrow({ where: { profileId: partnerId } }))
        .eligibilityEvidence as { authorizationEvidenceId?: string };
      assert.equal(storedEvidence.authorizationEvidenceId, 'authorization-fixture');
      const initial = await resolveProfileResponder(tx, { profileId: partnerId });
      assert.equal(initial.ok, true);
      if (initial.ok) {
        assert.equal(initial.value.assignedByActorId, actorId);
        assert.equal(initial.value.profileAssignmentRevision, 1);
        assert.equal((initial.value.eligibilityEvidence.currentEligibility as { source?: string }).source,
          'CURRENT_RESPONDER_AUTHORITY');
      }
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: false } });
      const rows = [{ rowId: `${partnerId}-inquiry-row`, configuration: { recoveryId: `${partnerId}-recovery`,
        recoveryRevision: 1, productRowId: `${partnerId}-inquiry-row` } }];
      const inquiryIntent = { schemaVersion: 1 as const, type: 'INQUIRY_SUBMIT' as const, partnerSellerId: partnerId, rows };
      const inquiry = createPartnerInquiryService({ actorId: partnerId,
        transaction: <T>(run: (database: Prisma.TransactionClient) => Promise<T>) => run(tx),
        authorize: async () => ({ ok: true, value: { evidenceId: 'inquiry-authorization' } }),
        resolveInitialResponder: resolveProfileResponder,
        resolveConfiguration: async () => ({ ok: true, value: { identity: { schemaVersion: 1, partnerSellerId: partnerId,
          catalogProductId: 'catalog-responder-test', family: 'prepared', unit: 'count',
          configuration: [{ key: 'technicalConfigurationHash', value: `sha256-v1:${'1'.repeat(64)}` }],
          materialRateEvidenceId: 'material-responder-test', materialRateHash: `sha256-v1:${'2'.repeat(64)}`,
          components: [], currency: 'IRT', calculationPolicyVersion: 'calculation-v1', roundingPolicyVersion: 'rounding-v2' },
          description: 'سنگ تست پاسخ‌دهنده', configuration: [{ label: 'نوع', value: 'آماده' }] } }),
      });
      assert.equal((await inquiry.execute({ ...inquiryIntent, commandId: `${partnerId}-inquiry-command`,
        correlationId: `${partnerId}-inquiry-command`, idempotency: { actorId: partnerId, operation: 'INQUIRY_SUBMIT',
          targetId: `${partnerId}-inquiry`, key: `${partnerId}-inquiry-command`, payloadHash: await canonicalHash(inquiryIntent) } })).ok, true);
      const inquiryAssignment = await tx.partnerInquiryAssignment.findFirstOrThrow({ where: { inquiryId: `${partnerId}-inquiry` } });
      assert.equal(inquiryAssignment.actorId, actorId, 'Admin assignment actor is preserved; Partner submitter is not substituted');
      assert.equal((inquiryAssignment.eligibilityEvidence as { profileAssignmentRevision?: number }).profileAssignmentRevision, 1);
      assert.equal((await service.execute(firstCommand)).ok, true);
      const stale = await service.execute(await command(actorId, partnerId, responderB, 1));
      assert.equal(stale.ok ? null : stale.error.code, 'ROW_STALE');
      const second = await service.execute(await command(actorId, partnerId, responderB, 2));
      assert.equal(second.ok, true);
      const assignments = await tx.partnerProfileResponderAssignment.findMany({ where: { profileId: partnerId }, orderBy: { revision: 'asc' } });
      assert.deepEqual(assignments.map(row => [row.revision, row.responderId]), [[1, responderA], [2, responderB]]);
      assert.equal((await tx.partnerProfile.findUniqueOrThrow({ where: { id: partnerId } })).revision, 3);
      throw rollback;
    }, { timeout: 20_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});
