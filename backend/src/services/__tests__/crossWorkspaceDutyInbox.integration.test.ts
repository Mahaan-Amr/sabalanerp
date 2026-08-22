import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  getCrossWorkspaceDutyDetail,
  getCrossWorkspaceDutySummary,
  listCrossWorkspaceDuties,
  markCrossWorkspaceDutyHistorySeen,
} from '../crossWorkspaceDutyInbox';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS as HR_DUTY_DEFINITIONS,
  synchronizeCrossWorkspaceDutyDefinitions as syncHrDutyEnvelopeDefinitions,
} from '../crossWorkspaceDutyModule';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

const rollback = new Error('ROLLBACK_CROSS_WORKSPACE_DUTY_INBOX_TEST');

test('generic destination Inbox returns the minimum HR Work Item projection to its assignee', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `cross-workspace-inbox-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Inbox', lastName: 'Assignee',
      } });
      await syncHrDutyEnvelopeDefinitions(tx, actor.id);
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Approve protected finance handoff',
        description: 'Only this minimum description is allowed.',
        sourceType: 'MANUAL', destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-18T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      const definition = HR_DUTY_DEFINITIONS.FINANCE_APPROVAL;
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: definition.sourceActionCode, sourceVersion: 1,
        envelopeCode: definition.envelopeCode, envelopeVersion: definition.envelopeVersion,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        currentAssigneeUserId: actor.id, dueAt: source.dueDate, createdByUserId: actor.id,
      } });
      await Promise.all([
        tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
          dutyId: duty.id, sequence: 1, assignedUserId: actor.id,
          destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
          changedByUserId: actor.id, policyVersion: 1,
        } }),
        tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: actor.id,
          sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
        } }),
      ]);

      const detail = await getCrossWorkspaceDutyDetail(tx, {
        dutyId: duty.id, actorUserId: actor.id, workspaceCode: 'ACCOUNTING',
        now: new Date('2026-08-16T08:00:00.000Z'),
      });
      assert.deepEqual({
        id: detail.id,
        access: detail.access,
        workspace: detail.workspace,
        sourceActionCode: detail.sourceActionCode,
        fields: detail.fields,
        allowedActionCodes: detail.allowedActionCodes,
      }, {
        id: duty.id,
        access: 'ASSIGNEE',
        workspace: 'accounting',
        sourceActionCode: 'FINANCE_APPROVAL',
        fields: {
          title: 'Approve protected finance handoff',
          description: 'Only this minimum description is allowed.',
          dueAt: '2026-08-18T08:00:00.000Z',
        },
        allowedActionCodes: ['APPROVE', 'REJECT', 'RETURN', 'REQUEST_CLARIFICATION'],
      });
      const manager = await tx.user.create({ data: {
        email: `${suffix}-manager@example.invalid`, username: `${suffix}-manager`, password: 'not-a-login-secret',
        firstName: 'Inbox', lastName: 'Manager', role: 'ADMIN',
      } });
      const unclaimableSource = await tx.hrWorkItem.create({ data: {
        title: 'Unclaimable manager-triage handoff', sourceType: 'MANUAL',
        destinationHref: '/dashboard/accounting/duties', dueDate: source.dueDate,
        createdByUserId: actor.id,
      } });
      const unclaimable = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: `${suffix}:unclaimable`, sourceType: 'HR_WORK_ITEM', sourceId: unclaimableSource.id,
        sourceActionCode: definition.sourceActionCode, sourceVersion: 1,
        envelopeCode: definition.envelopeCode, envelopeVersion: definition.envelopeVersion,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        currentAssigneeUserId: null, dueAt: source.dueDate, createdByUserId: actor.id,
      } });
      const managerAvailable = await listCrossWorkspaceDuties(tx, {
        actorUserId: manager.id, workspaceCode: 'ACCOUNTING', view: 'available',
        now: new Date('2026-08-16T08:00:00.000Z'),
      });
      assert.equal(managerAvailable.some(({ id }) => id === unclaimable.id), false,
        'manager triage access must not advertise an unclaimable duty as Available');
      throw rollback;
    }, { timeout: 30_000 }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('opening duty History clears only the current User unseen count', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `cross-workspace-history-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'History', lastName: 'Viewer', role: 'USER',
      } });
      const currentAssignee = await tx.user.create({ data: {
        email: `${suffix}-current@example.invalid`, username: `${suffix}-current`, password: 'not-a-login-secret',
        firstName: 'Current', lastName: 'Assignee', role: 'USER',
      } });
      await syncHrDutyEnvelopeDefinitions(tx, actor.id);
      const changedAt = new Date('2026-08-22T12:00:00.000Z');
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Completed finance handoff', sourceType: 'MANUAL', status: 'COMPLETE',
        destinationHref: '/dashboard/accounting/duties', dueDate: changedAt,
        createdByUserId: actor.id, completedAt: changedAt, completedByUserId: actor.id,
      } });
      const definition = HR_DUTY_DEFINITIONS.FINANCE_APPROVAL;
      const completedDuty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: definition.sourceActionCode, sourceVersion: 1,
        envelopeCode: definition.envelopeCode, envelopeVersion: definition.envelopeVersion,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        status: 'COMPLETED', currentAssigneeUserId: currentAssignee.id, dueAt: changedAt,
        structuredResultJson: { actionCode: 'APPROVE' },
        respondedAt: changedAt, respondedByUserId: actor.id, createdByUserId: actor.id,
        createdAt: changedAt, updatedAt: changedAt,
      } });
      await tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
        dutyId: completedDuty.id, sequence: 1, assignedUserId: actor.id,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        startedAt: new Date('2026-08-22T11:00:00.000Z'), endedAt: changedAt,
        endReason: 'REASSIGNED', changedByUserId: actor.id, policyVersion: 1,
      } });
      const now = new Date('2026-08-22T13:00:00.000Z');
      assert.equal((await getCrossWorkspaceDutySummary(tx, {
        actorUserId: actor.id, workspaceCode: 'ACCOUNTING', now,
      })).historyUnseen, 1);
      const history = await listCrossWorkspaceDuties(tx, {
        actorUserId: actor.id, workspaceCode: 'ACCOUNTING', view: 'history', now,
      });
      assert.deepEqual(history.map(({ id, detailAvailable }) => ({ id, detailAvailable })), [
        { id: completedDuty.id, detailAvailable: false },
      ], 'a former assignee can open the same terminal record counted by the unseen badge');
      await markCrossWorkspaceDutyHistorySeen(tx, {
        actorUserId: actor.id, workspaceCode: 'ACCOUNTING', seenThrough: changedAt, now,
      });
      assert.equal((await getCrossWorkspaceDutySummary(tx, {
        actorUserId: actor.id, workspaceCode: 'ACCOUNTING', now,
      })).historyUnseen, 0);
      throw rollback;
    }, { timeout: 30_000 }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});
