import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerOperationsStore } from '../partnerSales/operations/prismaStore';
import { createOperationsService } from '../partnerSales/operations/service';
import { acceptanceResponsibilities, readinessGates } from '../partnerSales/operations/readiness';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  return url.toString();
}

test('durable operations control starts without a cohort and persists define, enroll and pause transitions', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const run = `partner-operations-${randomUUID()}`;
  const operatorId = `${run}-operator`, sellerId = `${run}-seller`, profileId = `${run}-profile`, cohortId = `${run}-cohort`;
  await database.$executeRaw`INSERT INTO effective_authorization_state (id, revision) VALUES (1, 1)`;
  await database.partnerOperationsControl.create({ data: { id: 'partner-operations',
    revision: 1, enrollmentPaused: true, operationalPaused: true, lastOperationalPauseAt: null,
    cohortId: null, readinessEvidence: Prisma.DbNull,
  } });
  const control = await database.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
  assert.deepEqual({ revision: control.revision, enrollmentPaused: control.enrollmentPaused,
    operationalPaused: control.operationalPaused, cohortId: control.cohortId },
  { revision: 1, enrollmentPaused: true, operationalPaused: true, cohortId: null });
  try {
    await database.$transaction(async tx => {
      await tx.user.createMany({ data: [
        { id: operatorId, username: operatorId, email: `${operatorId}@example.invalid`, password: 'not-a-login',
          firstName: 'Operations', lastName: 'Fixture' },
        { id: sellerId, username: sellerId, email: `${sellerId}@example.invalid`, password: 'not-a-login',
          firstName: 'Partner', lastName: 'Fixture' },
      ] });
      await tx.partnerProfile.create({ data: { id: profileId, userId: sellerId, state: 'ACTIVE' } });
      await tx.effectiveActionGrant.create({ data: { id: `${run}-grant`, principalKind: 'USER', principalId: operatorId,
        subjectUserId: operatorId, domain: 'PARTNER', action: 'OPERATIONS_MANAGE', rootKind: 'PROFILE',
        purpose: 'OPERATIONS', scope: 'COMPANY', effect: 'ALLOW', grantedBy: operatorId,
        reason: 'isolated operations integration fixture', correlationId: run } });
    });
    const service = createOperationsService(contracts, createPrismaPartnerOperationsStore({ database,
      actorId: operatorId, correlationId: run }));
    const defined = await service.defineCohort({ id: cohortId, name: 'گروه آزمون عملیات', expectedRevision: 1,
      reason: 'تعریف گروه آزمون عملیات' });
    assert.equal(defined.ok && defined.value.revision, 2);
    const now = new Date(), expiresAt = new Date(now.getTime() + 3_600_000);
    await database.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { readinessEvidence: {
      source: 'DATABASE_VERIFIED', evidenceId: `${run}-evidence`, releaseId: cohortId, schemaId: 'partner-schema-v1',
      checkedAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
      gates: Object.fromEntries(readinessGates.map(gate => [gate, true])),
      acceptedBy: Object.fromEntries(acceptanceResponsibilities.map(role => [role, `${run}-${role}`])),
    } } });
    const command = async (kind: 'ENROLLMENT' | 'OPERATIONAL', expectedRevision: number, paused = false) => {
      const intent = { kind, paused, expectedRevision, reason: 'تغییر کنترل‌شده وضعیت آزمون' };
      return { schemaVersion: 1 as const, type: 'OPERATIONS_PAUSE' as const, commandId: `${run}-${kind}-${paused}`,
        correlationId: run, ...intent, idempotency: { actorId: operatorId, operation: 'OPERATIONS_PAUSE' as const,
          targetId: 'partner-operations', key: `${run}-${kind}-${paused}`, payloadHash: await contracts.canonicalHash(intent) } };
    };
    assert.equal((await service.pause(await command('ENROLLMENT', 2))).ok, true);
    assert.equal((await service.pause(await command('OPERATIONAL', 3))).ok, true);
    const enrolled = await service.enroll({ sellerId, expectedRevision: 4, reason: 'پذیرش فروشنده واجد شرایط' });
    assert.deepEqual(enrolled.ok && enrolled.value.cohort?.sellerIds, [sellerId]);
    const paused = await service.pause(await command('OPERATIONAL', 5, true));
    assert.equal(paused.ok && paused.value.operationalPaused, true);
    assert.equal(await database.partnerOperationsControlEvent.count({ where: { actorId: operatorId } }), 5);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
