import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  createHrDutyFromLegacyWorkItem,
  HR_DUTY_DEFINITIONS,
  processHrDutyDeadlines,
  reconcileHrDutyAssignment,
  respondToHrDuty,
  syncHrDutyEnvelopeDefinitions,
} from '../hrDutyEngine';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';
const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_HR_DUTY_ENGINE_TEST');

const run = async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now()}`;
    await Promise.all([
      tx.hrAuthorityCatalog.upsert({
        where: { code: 'FINANCE_MANAGER' }, update: { isActive: true },
        create: { code: 'FINANCE_MANAGER', displayName: 'Finance Manager' },
      }),
      tx.hrResponsibilityTypeCatalog.upsert({
        where: { code: 'FINANCE_MANAGER' }, update: { isActive: true },
        create: { code: 'FINANCE_MANAGER', displayName: 'Finance Manager' },
      }),
    ]);
    const [sourceActor, assignee] = await Promise.all([
      tx.user.create({ data: {
        email: `duty-source-${suffix}@example.invalid`, username: `duty-source-${suffix}`,
        password: 'not-a-login-secret', firstName: 'Duty', lastName: 'Source',
      } }),
      tx.user.create({ data: {
        email: `duty-assignee-${suffix}@example.invalid`, username: `duty-assignee-${suffix}`,
        password: 'not-a-login-secret', firstName: 'Duty', lastName: 'Assignee',
      } }),
    ]);
    await syncHrDutyEnvelopeDefinitions(tx, sourceActor.id);
    assert.equal(
      await tx.hrDutyEnvelope.count({ where: { code: { in: Object.values(HR_DUTY_DEFINITIONS).map(({ envelopeCode }) => envelopeCode) } } }),
      Object.keys(HR_DUTY_DEFINITIONS).length,
    );
    await tx.hrBusinessAuthorityGrant.create({ data: {
      stableKey: `duty-test-authority:${suffix}`,
      userId: assignee.id,
      authorityCode: 'FINANCE_MANAGER',
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      grantedByUserId: sourceActor.id,
      reason: 'Duty engine integration test',
    } });
    const responsibility = await tx.hrNamedResponsibility.create({ data: {
      stableKey: `duty-test-responsibility:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      assignedUserId: assignee.id,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `duty-test-destination:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      workspaceCode: 'ACCOUNTING', queueCode: 'FINANCE_APPROVALS',
      createdByUserId: sourceActor.id,
    } });
    const source = await tx.hrWorkItem.create({ data: {
      title: 'Approve accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-11T08:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });

    const created = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: source.id,
      sourceActionCode: 'FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      sourceActorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    assert.equal(created.currentAssigneeUserId, assignee.id);
    assert.equal(created.responsibilityId, responsibility.id);
    assert.equal(created.destinationWorkspaceCode, 'ACCOUNTING');
    assert.equal(created.status, 'OPEN');
    assert.equal((await tx.hrDutyAssignmentHistory.count({ where: { dutyId: created.id } })), 1);
    assert.equal((await tx.hrDutyAuditVersion.count({ where: { dutyId: created.id, eventCode: 'ASSIGNED' } })), 1);

    const replay = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: source.id,
      sourceActionCode: 'FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      sourceActorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    assert.equal(replay.id, created.id, 'creation retry returns the one durable duty');

    await tx.hrNamedResponsibility.update({
      where: { id: responsibility.id },
      data: { effectiveTo: new Date('2026-08-09T08:30:00.000Z') },
    });
    const successorOwner = await tx.user.create({ data: {
      email: `duty-successor-${suffix}@example.invalid`, username: `duty-successor-${suffix}`,
      password: 'not-a-login-secret', firstName: 'Duty', lastName: 'Successor',
    } });
    await tx.hrBusinessAuthorityGrant.create({ data: {
      stableKey: `duty-test-successor-authority:${suffix}`,
      userId: successorOwner.id, authorityCode: 'FINANCE_MANAGER',
      effectiveFrom: new Date('2026-08-09T08:30:00.000Z'),
      grantedByUserId: sourceActor.id, reason: 'Duty engine reassignment test',
    } });
    const successorResponsibility = await tx.hrNamedResponsibility.create({ data: {
      stableKey: `duty-test-successor-responsibility:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      assignedUserId: successorOwner.id, effectiveFrom: new Date('2026-08-09T08:30:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const reassigned = await reconcileHrDutyAssignment(tx, {
      dutyId: created.id, actorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:31:00.000Z'),
    });
    assert.ok(reassigned);
    assert.ok(reassigned.successor);
    const successorDuty = reassigned.successor;
    assert.equal(reassigned.predecessor.status, 'WAIVED');
    assert.equal(successorDuty.predecessorDutyId, created.id);
    assert.equal(successorDuty.currentAssigneeUserId, successorOwner.id);
    assert.equal(successorDuty.responsibilityId, successorResponsibility.id);
    assert.equal(successorDuty.dueAt.toISOString(), created.dueAt.toISOString());

    const completed = await respondToHrDuty(tx, {
      dutyId: successorDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
      expectedSourceVersion: successorDuty.sourceVersion,
      expectedEnvelopeVersion: successorDuty.envelopeVersion,
      reason: null, policyVersion: 1,
      now: new Date('2026-08-09T09:00:00.000Z'),
    });
    assert.equal(completed.replayed, false);
    assert.equal(completed.duty.status, 'COMPLETED');
    assert.deepEqual(completed.duty.structuredResultJson, { actionCode: 'APPROVE', reason: null });
    assert.equal((await tx.hrWorkItem.findUniqueOrThrow({ where: { id: source.id } })).status, 'COMPLETE');
    assert.equal((await tx.hrDutyAuditVersion.count({ where: { dutyId: successorDuty.id, eventCode: 'COMPLETED' } })), 1);

    const responseReplay = await respondToHrDuty(tx, {
      dutyId: successorDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
      expectedSourceVersion: successorDuty.sourceVersion,
      expectedEnvelopeVersion: successorDuty.envelopeVersion,
      reason: null, policyVersion: 1,
      now: new Date('2026-08-09T09:01:00.000Z'),
    });
    assert.equal(responseReplay.replayed, true);
    assert.equal((await tx.hrWorkItemAudit.count({ where: { workItemId: source.id, eventType: 'DUTY_APPROVED' } })), 1);

    const safeIdentities = await tx.hrDutyNotificationIdentity.findMany({
      where: { dutyId: { in: [created.id, successorDuty.id] } },
    });
    assert.ok(safeIdentities.length >= 2);
    for (const identity of safeIdentities) {
      const payload = JSON.stringify(identity.safePayloadJson);
      assert.equal(payload.includes(source.title), false, 'notification identity cannot contain protected source fields');
      assert.equal(payload.includes(source.id), false, 'notification identity cannot expose the HR source identifier');
    }

    const unassignedSource = await tx.hrWorkItem.create({ data: {
      title: 'Unassigned accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-12T08:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `duty-test-unassigned-destination:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_UNASSIGNED_TEST', scopeId: suffix,
      workspaceCode: 'ACCOUNTING', queueCode: 'FINANCE_MANAGER_TRIAGE',
      createdByUserId: sourceActor.id,
    } });
    const unassigned = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: unassignedSource.id,
      sourceActionCode: 'FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_UNASSIGNED_TEST', scopeId: suffix,
      sourceActorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    assert.equal(unassigned.currentAssigneeUserId, null);
    assert.equal((await tx.hrDutyAuditVersion.count({ where: { dutyId: unassigned.id, eventCode: 'UNASSIGNED_TRIAGE' } })), 1);
    assert.equal((await tx.hrWorkItem.findUniqueOrThrow({ where: { id: unassignedSource.id } })).status, 'PENDING');

    const deadlineSource = await tx.hrWorkItem.create({ data: {
      title: 'Past-due accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-08T07:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const deadlineDuty = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: deadlineSource.id,
      sourceActionCode: 'FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      sourceActorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    const deadlineResult = await processHrDutyDeadlines(tx, {
      now: new Date('2026-08-09T08:00:00.000Z'), policyVersion: 1,
    });
    assert.ok(deadlineResult.overdue >= 1);
    assert.ok(deadlineResult.escalated >= 1);
    assert.equal(await tx.hrDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'OVERDUE' } }), 1);
    assert.equal(await tx.hrDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'MANAGER_ESCALATION' } }), 1);
    await processHrDutyDeadlines(tx, { now: new Date('2026-08-09T08:05:00.000Z'), policyVersion: 1 });
    assert.equal(await tx.hrDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'OVERDUE' } }), 1);
    assert.equal(await tx.hrDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'MANAGER_ESCALATION' } }), 1);

    const externallyCompletedSource = await tx.hrWorkItem.create({ data: {
      title: 'Externally completed handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-13T08:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const externallyCompletedDuty = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: externallyCompletedSource.id,
      sourceActionCode: 'FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'DUTY_ENGINE_TEST', scopeId: suffix,
      sourceActorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    const externallyCompletedRow = await tx.hrWorkItem.update({
      where: { id: externallyCompletedSource.id },
      data: { status: 'COMPLETE', completedAt: new Date('2026-08-09T10:00:00.000Z'), completedByUserId: sourceActor.id },
    });
    await tx.hrWorkItemAudit.create({ data: {
      workItemId: externallyCompletedSource.id, actorUserId: sourceActor.id,
      eventType: 'SOURCE_COMPLETED', afterJson: externallyCompletedRow,
    } });
    const cancelled = await reconcileHrDutyAssignment(tx, {
      dutyId: externallyCompletedDuty.id, actorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T10:01:00.000Z'),
    });
    assert.ok(cancelled);
    assert.equal(cancelled!.predecessor.status, 'CANCELLED');
    assert.equal(cancelled!.successor, null, 'a terminal source cancels without inventing replacement work');
    assert.equal(await tx.hrDuty.count({ where: { predecessorDutyId: externallyCompletedDuty.id } }), 0);

    throw rollback;
  }, { timeout: 120_000 }), (error) => error === rollback);
  console.log('HR duty engine integration tests passed.');
};

run().finally(() => prisma.$disconnect());
