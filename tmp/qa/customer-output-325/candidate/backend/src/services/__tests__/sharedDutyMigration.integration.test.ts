import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { migrateOpenSharedDecisionDuties } from '../sharedDutyMigration';
import { CROSS_WORKSPACE_DUTY_DEFINITIONS, synchronizeCrossWorkspaceDutyDefinitions } from '../crossWorkspaceDutyModule';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

test('apply migrates a legacy QUEUED duty before the immutable cutoff and replays idempotently', async () => {
  const prisma = new PrismaClient();
  const actor = await prisma.user.findFirstOrThrow({ where: { isActive: true } });
  const suffix = `shared-migration-${Date.now()}`;
  let dutyId: string | null = null;
  let sourceId: string | null = null;
  try {
    await synchronizeCrossWorkspaceDutyDefinitions(prisma, actor.id);
    const source = await prisma.hrWorkItem.create({ data: {
      title: suffix, sourceType: 'MANUAL', destinationHref: '/dashboard/accounting/duties',
      dueDate: new Date(Date.now() + 86_400_000), createdByUserId: actor.id,
    } });
    sourceId = source.id;
    const definition = CROSS_WORKSPACE_DUTY_DEFINITIONS.FINANCE_APPROVAL;
    const duty = await prisma.crossWorkspaceDuty.create({ data: {
      stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
      sourceActionCode: definition.sourceActionCode, sourceVersion: 1,
      envelopeCode: definition.envelopeCode, envelopeVersion: definition.envelopeVersion,
      destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
      currentAssigneeUserId: actor.id, sourceActorUserId: null,
      dueAt: source.dueDate, createdByUserId: actor.id,
    } });
    dutyId = duty.id;
    await prisma.crossWorkspaceDutyAssignmentHistory.create({ data: {
      dutyId: duty.id, sequence: 1, assignedUserId: actor.id,
      destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
      changedByUserId: actor.id, policyVersion: 1,
    } });
    await prisma.crossWorkspaceDutyAuditVersion.create({ data: {
      dutyId: duty.id, version: 1, eventCode: 'QUEUED', actorUserId: actor.id,
      sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
    } });
    const createdBefore = new Date(duty.createdAt.getTime() + 1_000);
    const first = await migrateOpenSharedDecisionDuties(prisma, {
      apply: true, actorUserId: actor.id, createdBefore, dutyIds: [duty.id],
    });
    assert.deepEqual(first.migrated, [duty.id]);
    assert.equal((await prisma.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } })).currentAssigneeUserId, null);
    assert.equal(await prisma.crossWorkspaceDutyAuditVersion.count({
      where: { dutyId: duty.id, eventCode: 'MIGRATED_TO_SHARED_DECISION' },
    }), 1);
    const replay = await migrateOpenSharedDecisionDuties(prisma, {
      apply: true, actorUserId: actor.id, createdBefore, dutyIds: [duty.id],
    });
    assert.deepEqual(replay.replayed, [duty.id]);
  } finally {
    if (dutyId) {
      await prisma.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId } });
      await prisma.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId } });
      await prisma.crossWorkspaceDuty.delete({ where: { id: dutyId } });
    }
    if (sourceId) await prisma.hrWorkItem.delete({ where: { id: sourceId } });
    await prisma.$disconnect();
  }
});
