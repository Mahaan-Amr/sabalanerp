import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  createHrDutyFromLegacyWorkItem,
} from '../hrDutyEngine';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS as HR_DUTY_DEFINITIONS,
  processCrossWorkspaceDutyDeadlines as processHrDutyDeadlines,
  reconcileCrossWorkspaceDutyAssignment as reconcileHrDutyAssignment,
  respondToCrossWorkspaceDuty as respondToHrDuty,
  synchronizeCrossWorkspaceDutyDefinitions as syncHrDutyEnvelopeDefinitions,
} from '../crossWorkspaceDutyModule';
import {
  getDestinationDutyDetail,
  getDestinationDutySummary,
  listDestinationDuties,
} from '../hrDutySurface';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';
const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_HR_DUTY_ENGINE_TEST');

const grantFinanceAction = async (
  tx: any,
  input: { userId: string; actorUserId: string; suffix: string; effectiveFrom: Date },
) => {
  await Promise.all([
    tx.hrWorkspaceCatalog.upsert({
      where: { code: 'HUMAN_RESOURCES' },
      update: { isActive: true },
      create: { code: 'HUMAN_RESOURCES', displayName: 'Human Resources' },
    }),
    tx.hrFeatureCatalog.upsert({
      where: { code: 'RECRUITMENT_CASES' },
      update: { isActive: true },
      create: { code: 'RECRUITMENT_CASES', workspaceCode: 'HUMAN_RESOURCES', displayName: 'Recruitment cases' },
    }),
    tx.hrFeatureCatalog.upsert({
      where: { code: 'MANAGE_FINANCE_EVIDENCE' },
      update: { isActive: true },
      create: { code: 'MANAGE_FINANCE_EVIDENCE', workspaceCode: 'HUMAN_RESOURCES', displayName: 'Manage finance evidence' },
    }),
  ]);
  await tx.hrWorkspaceAccessGrant.create({ data: {
    stableKey: `${input.suffix}:workspace`, userId: input.userId,
    workspaceCode: 'HUMAN_RESOURCES', level: 'VIEW', effectiveFrom: input.effectiveFrom,
    grantedByUserId: input.actorUserId, reason: 'Duty engine action-permission workspace',
  } });
  await tx.hrFeatureAccessGrant.create({ data: {
    stableKey: `${input.suffix}:recruitment-cases`, userId: input.userId,
    featureCode: 'RECRUITMENT_CASES', level: 'VIEW', effectiveFrom: input.effectiveFrom,
    grantedByUserId: input.actorUserId, reason: 'Duty engine action-permission prerequisite',
  } });
  return tx.hrFeatureAccessGrant.create({ data: {
    stableKey: `${input.suffix}:finance-action`, userId: input.userId,
    featureCode: 'MANAGE_FINANCE_EVIDENCE', level: 'EDIT', effectiveFrom: input.effectiveFrom,
    grantedByUserId: input.actorUserId, reason: 'Duty engine action-permission test',
  } });
};

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
      where: {
        responsibilityTypeCode: { in: ['FINANCE_MANAGER', 'FINANCE_RECORDER'] }, scopeType: 'GLOBAL', scopeId: null,
        effectiveFrom: { lt: new Date('2026-07-31T23:59:59.000Z') },
      },
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
    await tx.workspacePermission.create({ data: {
      userId: sourceActor.id, workspace: 'accounting', permissionLevel: 'admin',
      grantedBy: sourceActor.id,
    } });
    const staticEnvelopeCodes = Object.values(HR_DUTY_DEFINITIONS)
      .filter(({ destinationWorkspaceCode }) => Boolean(destinationWorkspaceCode))
      .map(({ envelopeCode }) => envelopeCode);
    assert.equal(
      await tx.crossWorkspaceDutyEnvelope.count({ where: { code: { in: staticEnvelopeCodes } } }),
      staticEnvelopeCodes.length,
    );
    await tx.crossWorkspaceDutyEnvelope.update({
      where: { code_version: { code: HR_DUTY_DEFINITIONS.FINANCE_APPROVAL.envelopeCode, version: 1 } },
      data: { responseSchemaJson: { type: 'string' } },
    });
    await assert.rejects(syncHrDutyEnvelopeDefinitions(tx, sourceActor.id), /HR_DUTY_ENVELOPE_DEFINITION_CONFLICT/);
    await tx.crossWorkspaceDutyEnvelope.update({
      where: { code_version: { code: HR_DUTY_DEFINITIONS.FINANCE_APPROVAL.envelopeCode, version: 1 } },
      data: { responseSchemaJson: HR_DUTY_DEFINITIONS.FINANCE_APPROVAL.responseSchema },
    });
    await grantFinanceAction(tx, {
      userId: assignee.id, actorUserId: sourceActor.id, suffix: `duty-test-authority:${suffix}`,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    });
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
    assert.equal((await tx.crossWorkspaceDutyAssignmentHistory.count({ where: { dutyId: created.id } })), 1);
    assert.equal((await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: created.id, eventCode: 'ASSIGNED' } })), 1);

    const assignedDetail = await getDestinationDutyDetail(tx, {
      dutyId: created.id, actorUserId: assignee.id, workspaceCode: 'accounting',
      now: new Date('2026-08-09T08:05:00.000Z'),
    });
    assert.equal(assignedDetail.access, 'ASSIGNEE');
    assert.equal(assignedDetail.fields.title, source.title);
    assert.equal(JSON.stringify(assignedDetail).includes(source.id), false, 'surface cannot expose the HR source id');
    assert.equal(JSON.stringify(assignedDetail).includes(sourceActor.id), false, 'surface cannot expose source actor identity');
    assert.equal((await getDestinationDutySummary(tx, {
      actorUserId: assignee.id, workspaceCode: 'ACCOUNTING', now: new Date('2026-08-09T08:05:00.000Z'),
    })).open, 1);
    await assert.rejects(getDestinationDutyDetail(tx, {
      dutyId: created.id, actorUserId: sourceActor.id, workspaceCode: 'ACCOUNTING',
      now: new Date('2026-08-09T08:05:00.000Z'),
    }), /DUTY_ASSIGNEE_CHANGED/);
    await assert.rejects(getDestinationDutyDetail(tx, {
      dutyId: created.id, actorUserId: assignee.id, workspaceCode: 'SALES',
      now: new Date('2026-08-09T08:05:00.000Z'),
    }), /DUTY_DESTINATION_CHANGED/);

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
    const successorGrant = await grantFinanceAction(tx, {
      userId: successorOwner.id, actorUserId: sourceActor.id, suffix: `duty-test-successor-authority:${suffix}`,
      effectiveFrom: new Date('2026-08-09T08:30:00.000Z'),
    });
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
    const formerAssigneeHistory = await listDestinationDuties(tx, {
      actorUserId: assignee.id, workspaceCode: 'ACCOUNTING', view: 'history',
      now: new Date('2026-08-09T08:32:00.000Z'),
    });
    const predecessorHistory = formerAssigneeHistory.find((item) => item.id === created.id);
    assert.ok(predecessorHistory, 'former assignee retains a bounded terminal history record');
    assert.equal(predecessorHistory.detailAvailable, false, 'stale terminal records are not actionable deep links');
    assert.deepEqual(predecessorHistory.fields, {}, 'terminal fallback cannot re-read changed source fields');
    assert.deepEqual(predecessorHistory.evidence, [], 'terminal fallback cannot reuse stale evidence declarations');
    assert.equal(predecessorHistory.result, null, 'terminal fallback cannot expose a stale structured result');
    assert.ok(predecessorHistory.history.every((event) => event.reason === null), 'terminal fallback exposes event metadata without reasons');
    await assert.rejects(getDestinationDutyDetail(tx, {
      dutyId: successorDuty.id, actorUserId: assignee.id, workspaceCode: 'ACCOUNTING',
      now: new Date('2026-08-09T08:32:00.000Z'),
    }), /DUTY_ASSIGNEE_CHANGED/);

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
    assert.equal((await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: successorDuty.id, eventCode: 'COMPLETED' } })), 1);
    const history = await listDestinationDuties(tx, {
      actorUserId: successorOwner.id, workspaceCode: 'ACCOUNTING', view: 'history',
      now: new Date('2026-08-09T09:00:30.000Z'),
    });
    assert.ok(history.some((item) => item.id === successorDuty.id));
    const managerHistory = await listDestinationDuties(tx, {
      actorUserId: sourceActor.id, workspaceCode: 'ACCOUNTING', view: 'history',
      now: new Date('2026-08-09T09:00:30.000Z'),
    });
    assert.ok(managerHistory.some((item) => item.id === successorDuty.id));

    const responseReplay = await respondToHrDuty(tx, {
      dutyId: successorDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
      expectedSourceVersion: successorDuty.sourceVersion,
      expectedEnvelopeVersion: successorDuty.envelopeVersion,
      reason: null, policyVersion: 1,
      now: new Date('2026-08-09T09:01:00.000Z'),
    });
    assert.equal(responseReplay.replayed, true);
    assert.equal((await tx.hrWorkItemAudit.count({ where: { workItemId: source.id, eventType: 'DUTY_APPROVED' } })), 1);

    const safeIdentities = await tx.crossWorkspaceDutyNotificationIdentity.findMany({
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
    assert.equal((await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: unassigned.id, eventCode: 'UNASSIGNED_TRIAGE' } })), 1);
    const blockedSource = await tx.hrWorkItem.findUniqueOrThrow({ where: { id: unassignedSource.id } });
    assert.equal(blockedSource.status, 'PENDING');
    assert.ok(blockedSource.dutyRoutingBlockedAt);

    const recorder = await tx.user.create({ data: {
      email: `duty-recorder-${suffix}@example.invalid`, username: `duty-recorder-${suffix}`,
      password: 'not-a-login-secret', firstName: 'Duty', lastName: 'Recorder',
    } });
    await grantFinanceAction(tx, {
      userId: recorder.id, actorUserId: sourceActor.id, suffix: `duty-test-recorder-authority:${suffix}`,
      effectiveFrom: new Date('2026-08-09T08:01:00.000Z'),
    });
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
    assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'OVERDUE' } }), 1);
    assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'MANAGER_ESCALATION' } }), 1);
    await processHrDutyDeadlines(tx, { now: new Date('2026-08-09T08:05:00.000Z'), policyVersion: 1 });
    assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'OVERDUE' } }), 1);
    assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: deadlineDuty.id, eventCode: 'MANAGER_ESCALATION' } }), 1);

    const concurrentSource = await tx.hrWorkItem.create({ data: {
      title: 'Concurrent accounting handoff', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-14T08:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const concurrentCreations = await Promise.all([
      createHrDutyFromLegacyWorkItem(tx, {
        sourceWorkItemId: concurrentSource.id, sourceActionCode: 'FINANCE_APPROVAL',
        actorUserId: sourceActor.id, policyVersion: 1, now: new Date('2026-08-09T09:10:00.000Z'),
      }),
      createHrDutyFromLegacyWorkItem(tx, {
        sourceWorkItemId: concurrentSource.id, sourceActionCode: 'FINANCE_APPROVAL',
        actorUserId: sourceActor.id, policyVersion: 1, now: new Date('2026-08-09T09:10:00.000Z'),
      }),
    ]);
    assert.equal(concurrentCreations[0].id, concurrentCreations[1].id);
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: concurrentSource.id } }), 1);
    const concurrentDuty = concurrentCreations[0];
    await tx.crossWorkspaceDutyEnvelope.update({
      where: { code_version: { code: concurrentDuty.envelopeCode, version: concurrentDuty.envelopeVersion } },
      data: { allowedActionCodesJson: ['APPROVE', 'UNREGISTERED_ACTION'] },
    });
    await assert.rejects(respondToHrDuty(tx, {
      dutyId: concurrentDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
      expectedSourceVersion: concurrentDuty.sourceVersion, expectedEnvelopeVersion: concurrentDuty.envelopeVersion,
      reason: null, policyVersion: 1, now: new Date('2026-08-09T09:10:30.000Z'),
    }), /HR_DUTY_ENVELOPE_VERSION_STALE/);
    await tx.crossWorkspaceDutyEnvelope.update({
      where: { code_version: { code: concurrentDuty.envelopeCode, version: concurrentDuty.envelopeVersion } },
      data: { allowedActionCodesJson: [...HR_DUTY_DEFINITIONS.FINANCE_APPROVAL.allowedActionCodes] },
    });
    const concurrentResponses = await Promise.allSettled([
      respondToHrDuty(tx, {
        dutyId: concurrentDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
        expectedSourceVersion: concurrentDuty.sourceVersion, expectedEnvelopeVersion: concurrentDuty.envelopeVersion,
        reason: null, policyVersion: 1, now: new Date('2026-08-09T09:11:00.000Z'),
      }),
      respondToHrDuty(tx, {
        dutyId: concurrentDuty.id, actorUserId: successorOwner.id, actionCode: 'APPROVE',
        expectedSourceVersion: concurrentDuty.sourceVersion, expectedEnvelopeVersion: concurrentDuty.envelopeVersion,
        reason: null, policyVersion: 1, now: new Date('2026-08-09T09:11:00.000Z'),
      }),
    ]);
    const completedResponseCount = concurrentResponses.filter((result) => (
      result.status === 'fulfilled' && !result.value.replayed
    )).length;
    assert.equal(completedResponseCount, 1, 'concurrent retries perform the source transition exactly once');
    assert.equal(await tx.crossWorkspaceDutyAuditVersion.count({ where: { dutyId: concurrentDuty.id, eventCode: 'COMPLETED' } }), 1);

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
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { predecessorDutyId: externallyCompletedDuty.id } }), 0);

    await tx.hrFeatureAccessGrant.update({
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

const runCompetingTransactionTest = async () => {
  const suffix = `concurrency-${Date.now()}`;
  const seeded = await prisma.$transaction(async (tx) => {
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
        email: `${suffix}-source@example.invalid`, username: `${suffix}-source`,
        password: 'not-a-login-secret', firstName: 'Concurrent', lastName: 'Source',
      } }),
      tx.user.create({ data: {
        email: `${suffix}-assignee@example.invalid`, username: `${suffix}-assignee`,
        password: 'not-a-login-secret', firstName: 'Concurrent', lastName: 'Assignee',
      } }),
    ]);
    await syncHrDutyEnvelopeDefinitions(tx, 'SYSTEM');
    const grant = await grantFinanceAction(tx, {
      userId: assignee.id, actorUserId: sourceActor.id, suffix: `${suffix}:grant`,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    });
    const responsibility = await tx.hrNamedResponsibility.create({ data: {
      stableKey: `${suffix}:responsibility`, responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'CONCURRENCY_TEST', scopeId: suffix, assignedUserId: assignee.id,
      effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), createdByUserId: sourceActor.id,
    } });
    const destination = await tx.hrResponsibilityDestination.create({ data: {
      stableKey: `${suffix}:destination`, responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'CONCURRENCY_TEST', scopeId: suffix,
      workspaceCode: 'ACCOUNTING', queueCode: 'FINANCE_APPROVALS', createdByUserId: sourceActor.id,
    } });
    const source = await tx.hrWorkItem.create({ data: {
      title: 'Competing transaction response', sourceType: 'MANUAL',
      destinationHref: '/dashboard/accounting', dueDate: new Date('2026-08-14T08:00:00.000Z'),
      createdByUserId: sourceActor.id,
    } });
    const duty = await tx.crossWorkspaceDuty.create({ data: {
      stableKey: `${suffix}:duty`, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
      sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 1,
      envelopeCode: HR_DUTY_DEFINITIONS.FINANCE_APPROVAL.envelopeCode, envelopeVersion: 1,
      destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
      currentAssigneeUserId: assignee.id, responsibilityId: responsibility.id,
      routingResponsibilityTypeCode: 'FINANCE_MANAGER', routingScopeType: 'CONCURRENCY_TEST',
      routingScopeId: suffix, sourceActorUserId: sourceActor.id,
      dueAt: source.dueDate, createdByUserId: sourceActor.id,
    } });
    await Promise.all([
      tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
        dutyId: duty.id, sequence: 1, assignedUserId: assignee.id, responsibilityId: responsibility.id,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        startedAt: new Date('2026-08-01T00:00:00.000Z'), createdAt: new Date('2026-08-01T00:00:00.000Z'),
        changedByUserId: sourceActor.id, policyVersion: 1,
      } }),
      tx.crossWorkspaceDutyAuditVersion.create({ data: {
        dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: sourceActor.id,
        sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
        afterJson: { status: 'OPEN', currentAssigneeUserId: assignee.id },
      } }),
    ]);
    return { sourceActor, assignee, grant, responsibility, destination, source, duty };
  });

  const firstClient = new PrismaClient();
  const secondClient = new PrismaClient();
  try {
    const response = {
      dutyId: seeded.duty.id, actorUserId: seeded.assignee.id, actionCode: 'APPROVE',
      expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null,
      policyVersion: 1, now: new Date('2026-08-09T11:00:00.000Z'),
    };
    const outcomes = await Promise.allSettled([
      respondToHrDuty(firstClient, response),
      respondToHrDuty(secondClient, response),
    ]);
    const durableWinners = outcomes.filter((outcome) => (
      outcome.status === 'fulfilled' && !outcome.value.replayed
    ));
    assert.equal(
      durableWinners.length,
      1,
      `competing transactions perform exactly one durable response: ${outcomes.map((outcome) => (
        outcome.status === 'fulfilled'
          ? `fulfilled(replayed=${outcome.value.replayed})`
          : `rejected(${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)})`
      )).join(', ')}`,
    );
    assert.equal(await prisma.crossWorkspaceDutyAuditVersion.count({
      where: { dutyId: seeded.duty.id, eventCode: 'COMPLETED' },
    }), 1);
    assert.equal((await prisma.hrWorkItem.findUniqueOrThrow({ where: { id: seeded.source.id } })).status, 'COMPLETE');
  } finally {
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect()]);
    await prisma.$transaction(async (tx) => {
      const events = await tx.notificationEvent.findMany({
        where: { resourceType: 'HR_DUTY', resourceId: seeded.duty.id }, select: { id: true },
      });
      const eventIds = events.map(({ id }) => id);
      await tx.notification.deleteMany({ where: { eventId: { in: eventIds } } });
      await tx.notificationEvent.deleteMany({ where: { id: { in: eventIds } } });
      await tx.crossWorkspaceDutyNotificationIdentity.deleteMany({ where: { dutyId: seeded.duty.id } });
      await tx.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId: seeded.duty.id } });
      await tx.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId: seeded.duty.id } });
      await tx.crossWorkspaceDuty.delete({ where: { id: seeded.duty.id } });
      await tx.hrWorkItemAudit.deleteMany({ where: { workItemId: seeded.source.id } });
      await tx.hrWorkItem.delete({ where: { id: seeded.source.id } });
      await tx.hrNamedResponsibility.delete({ where: { id: seeded.responsibility.id } });
      await tx.hrResponsibilityDestination.delete({ where: { id: seeded.destination.id } });
      await tx.hrFeatureAccessGrant.deleteMany({ where: { userId: seeded.assignee.id } });
      await tx.hrWorkspaceAccessGrant.deleteMany({ where: { userId: seeded.assignee.id } });
      await tx.user.deleteMany({ where: { id: { in: [seeded.sourceActor.id, seeded.assignee.id] } } });
    }, { timeout: 30_000 });
  }
  console.log('HR duty competing-transaction test passed.');
};

run()
  .then(runCompetingTransactionTest)
  .finally(() => prisma.$disconnect());
