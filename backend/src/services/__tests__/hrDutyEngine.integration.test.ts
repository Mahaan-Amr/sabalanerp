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
      tx.hrAuthorityCatalog.upsert({
        where: { code: 'FINANCE_RECORDER' }, update: { isActive: true },
        create: { code: 'FINANCE_RECORDER', displayName: 'Finance Recorder' },
      }),
      tx.hrResponsibilityTypeCatalog.upsert({
        where: { code: 'FINANCE_RECORDER' }, update: { isActive: true },
        create: { code: 'FINANCE_RECORDER', displayName: 'Finance Recorder' },
      }),
    ]);
    await tx.hrNamedResponsibility.updateMany({
      where: { responsibilityTypeCode: { in: ['FINANCE_MANAGER', 'FINANCE_RECORDER'] }, scopeType: 'GLOBAL', scopeId: null },
      data: { effectiveTo: new Date('2026-07-31T23:59:59.000Z') },
    });
    await tx.hrResponsibilityDestination.updateMany({
      where: { responsibilityTypeCode: { in: ['FINANCE_MANAGER', 'FINANCE_RECORDER'] }, scopeType: 'GLOBAL', scopeId: null },
      data: { isActive: false },
    });
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
    const staticEnvelopeCodes = Object.values(HR_DUTY_DEFINITIONS)
      .filter(({ destinationWorkspaceCode }) => Boolean(destinationWorkspaceCode))
      .map(({ envelopeCode }) => envelopeCode);
    assert.equal(
      await tx.hrDutyEnvelope.count({ where: { code: { in: staticEnvelopeCodes } } }),
      staticEnvelopeCodes.length,
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
      scopeType: 'GLOBAL', scopeId: null,
      assignedUserId: assignee.id,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `duty-test-destination:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'GLOBAL', scopeId: null,
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
      sourceActionCode: 'FINANCE_APPROVAL', actorUserId: sourceActor.id, policyVersion: 1,
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
      sourceActionCode: 'FINANCE_APPROVAL', actorUserId: sourceActor.id, policyVersion: 1,
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
    const successorGrant = await tx.hrBusinessAuthorityGrant.create({ data: {
      stableKey: `duty-test-successor-authority:${suffix}`,
      userId: successorOwner.id, authorityCode: 'FINANCE_MANAGER',
      effectiveFrom: new Date('2026-08-09T08:30:00.000Z'),
      grantedByUserId: sourceActor.id, reason: 'Duty engine reassignment test',
    } });
    const successorResponsibility = await tx.hrNamedResponsibility.create({ data: {
      stableKey: `duty-test-successor-responsibility:${suffix}`,
      responsibilityTypeCode: 'FINANCE_MANAGER', scopeType: 'GLOBAL', scopeId: null,
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
      responsibilityTypeCode: 'FINANCE_RECORDER',
      scopeType: 'GLOBAL', scopeId: null,
      workspaceCode: 'ACCOUNTING', queueCode: 'FINANCE_RECORDER_TRIAGE',
      createdByUserId: sourceActor.id,
    } });
    const unassigned = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: unassignedSource.id,
      sourceActionCode: 'FINANCE_RECORDING', actorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:00:00.000Z'),
    });
    assert.equal(unassigned.currentAssigneeUserId, null);
    assert.equal((await tx.hrDutyAuditVersion.count({ where: { dutyId: unassigned.id, eventCode: 'UNASSIGNED_TRIAGE' } })), 1);
    const blockedSource = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: unassignedSource.id } });
    assert.equal(blockedSource.status, 'PENDING');
    assert.ok(blockedSource.dutyRoutingBlockedAt);

    const recorder = await tx.user.create({ data: {
      email: `duty-recorder-${suffix}@example.invalid`, username: `duty-recorder-${suffix}`,
      password: 'not-a-login-secret', firstName: 'Duty', lastName: 'Recorder',
    } });
    await tx.hrBusinessAuthorityGrant.create({ data: {
      stableKey: `duty-test-recorder-authority:${suffix}`,
      userId: recorder.id, authorityCode: 'FINANCE_RECORDER',
      effectiveFrom: new Date('2026-08-09T08:01:00.000Z'),
      grantedByUserId: sourceActor.id, reason: 'Duty engine triage recovery test',
    } });
    await tx.hrNamedResponsibility.create({ data: {
      stableKey: `duty-test-recorder-responsibility:${suffix}`,
      responsibilityTypeCode: 'FINANCE_RECORDER', scopeType: 'GLOBAL', scopeId: null,
      assignedUserId: recorder.id, effectiveFrom: new Date('2026-08-09T08:01:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const recovered = await reconcileHrDutyAssignment(tx, {
      dutyId: unassigned.id, actorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:02:00.000Z'),
    });
    assert.ok(recovered?.successor);
    assert.equal(recovered.predecessor.status, 'WAIVED');
    assert.equal(recovered.successor.currentAssigneeUserId, recorder.id);
    assert.equal((await tx.hrWorkItem.findUniqueOrThrow({ where: { id: unassignedSource.id } })).dutyRoutingBlockedAt, null);

    await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `duty-test-ambiguous-destination:${suffix}`,
      responsibilityTypeCode: 'FINANCE_RECORDER', scopeType: 'GLOBAL', scopeId: null,
      workspaceCode: 'ACCOUNTING', queueCode: 'SECOND_FINANCE_RECORDER_TRIAGE',
      createdByUserId: sourceActor.id,
    } });
    const ambiguousDestinationSource = await tx.hrWorkItem.create({ data: {
      title: 'Ambiguous accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-12T09:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    await assert.rejects(createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: ambiguousDestinationSource.id,
      sourceActionCode: 'FINANCE_RECORDING', actorUserId: sourceActor.id, policyVersion: 1,
      now: new Date('2026-08-09T08:03:00.000Z'),
    }), /HR_DUTY_DESTINATION_UNRESOLVED/);

    const deadlineSource = await tx.hrWorkItem.create({ data: {
      title: 'Past-due accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-08T07:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const deadlineDuty = await createHrDutyFromLegacyWorkItem(tx, {
      sourceWorkItemId: deadlineSource.id,
      sourceActionCode: 'FINANCE_APPROVAL', actorUserId: sourceActor.id, policyVersion: 1,
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
      sourceActionCode: 'FINANCE_APPROVAL', actorUserId: sourceActor.id, policyVersion: 1,
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

    await tx.hrBusinessAuthorityGrant.update({
      where: { id: successorGrant.id },
      data: {
        status: 'REVOKED', revokedAt: new Date('2026-08-09T10:02:00.000Z'),
        revokedByUserId: sourceActor.id, reason: 'Replay revalidation test',
      },
    });
    await assert.rejects(respondToHrDuty(tx, {
      dutyId: successorDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
      expectedSourceVersion: successorDuty.sourceVersion,
      expectedEnvelopeVersion: successorDuty.envelopeVersion,
      reason: null, policyVersion: 1,
      now: new Date('2026-08-09T10:03:00.000Z'),
    }), /DUTY_REPLAY_REVALIDATION_FAILED/);

    throw rollback;
  }, { timeout: 120_000 }), (error) => error === rollback);
  console.log('HR duty engine integration tests passed.');
};

run().finally(() => prisma.$disconnect());
