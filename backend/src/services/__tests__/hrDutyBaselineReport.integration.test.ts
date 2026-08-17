import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { collectHrDutyBaselineReport } from '../hrDutyBaselineReport';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

const rollback = new Error('ROLLBACK_HR_DUTY_BASELINE_TEST');

test('baseline report counts one newly persisted envelope, source, and open duty exactly once', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const before = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      const suffix = `duty-baseline-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`,
        username: suffix,
        password: 'not-a-login-secret',
        firstName: 'Duty',
        lastName: 'Baseline',
      } });
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Baseline report source',
        sourceType: 'MANUAL',
        destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-17T08:00:00.000Z'),
        createdByUserId: actor.id,
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix,
        version: 1,
        destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title', 'dueAt'],
        allowedEvidenceJson: [],
        allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: {
          type: 'object',
          required: ['actionCode'],
          properties: { actionCode: { type: 'string', enum: ['APPROVE'] } },
          additionalProperties: false,
        },
        createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix,
        sourceType: 'HR_WORK_ITEM',
        sourceId: source.id,
        sourceActionCode: 'FINANCE_APPROVAL',
        sourceVersion: 1,
        envelopeCode: envelope.code,
        envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING',
        destinationQueueCode: 'FINANCE_APPROVALS',
        dueAt: source.dueDate,
        createdByUserId: actor.id,
      } });
      await tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
        dutyId: duty.id,
        sequence: 1,
        assignedUserId: null,
        destinationWorkspaceCode: 'ACCOUNTING',
        destinationQueueCode: 'FINANCE_APPROVALS',
        changedByUserId: actor.id,
        policyVersion: 1,
      } });

      const after = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.equal(after.counts.envelopes, before.counts.envelopes + 1);
      assert.equal(after.counts.sourceWorkItems, before.counts.sourceWorkItems + 1);
      assert.equal(after.counts.duties, before.counts.duties + 1);
      assert.equal(after.counts.openDuties, before.counts.openDuties + 1);
      assert.equal(after.counts.assignmentHistory, before.counts.assignmentHistory + 1);
      assert.equal(after.counts.activeAssignments, before.counts.activeAssignments + 1);
      assert.equal(after.counts.auditVersions, before.counts.auditVersions);
      assert.equal(after.counts.notificationIdentities, before.counts.notificationIdentities);
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report rejects an assigned open duty without active assignment or audit evidence', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-broken-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Broken Baseline',
      } });
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Broken baseline source', sourceType: 'MANUAL',
        destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 1,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        currentAssigneeUserId: actor.id, dueAt: source.dueDate, createdByUserId: actor.id,
      } });

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      const dutyFindingCodes = report.findings
        .filter((finding) => finding.dutyId === duty.id)
        .map((finding) => finding.code)
        .sort();
      assert.deepEqual(dutyFindingCodes, ['DUTY_AUDIT_MISSING', 'OPEN_DUTY_ACTIVE_ASSIGNMENT_COUNT']);
      assert.equal(report.ok, false);
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report identifies a duty whose authoritative HR source is missing', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-orphan-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Orphan Baseline',
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: `${suffix}:missing-source`,
        sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 1,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        dueAt: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      await Promise.all([
        tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
          dutyId: duty.id, sequence: 1, assignedUserId: null,
          destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
          changedByUserId: actor.id, policyVersion: 1,
        } }),
        tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: 1, eventCode: 'UNASSIGNED_TRIAGE', actorUserId: actor.id,
          sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
        } }),
      ]);

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.deepEqual(
        report.findings.filter((finding) => finding.dutyId === duty.id).map((finding) => finding.code),
        ['DUTY_SOURCE_MISSING'],
      );
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report identifies a duty whose source version is stale', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-stale-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Stale Baseline',
      } });
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Stale baseline source', sourceType: 'MANUAL',
        destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 2,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        dueAt: source.dueDate, createdByUserId: actor.id,
      } });
      await Promise.all([
        tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
          dutyId: duty.id, sequence: 1, assignedUserId: null,
          destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
          changedByUserId: actor.id, policyVersion: 1,
        } }),
        tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: 1, eventCode: 'UNASSIGNED_TRIAGE', actorUserId: actor.id,
          sourceVersion: 2, envelopeVersion: 1, policyVersion: 1,
        } }),
      ]);

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.deepEqual(
        report.findings.filter((finding) => finding.dutyId === duty.id).map((finding) => finding.code),
        ['DUTY_SOURCE_VERSION_MISMATCH'],
      );
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report identifies a gap in append-only duty audit versions', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-audit-gap-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Audit Gap',
      } });
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Audit gap source', sourceType: 'MANUAL', destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 1,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        currentAssigneeUserId: actor.id, dueAt: source.dueDate, createdByUserId: actor.id,
      } });
      await tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
        dutyId: duty.id, sequence: 1, assignedUserId: actor.id,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        changedByUserId: actor.id, policyVersion: 1,
      } });
      await tx.crossWorkspaceDutyAuditVersion.createMany({ data: [
        { dutyId: duty.id, version: 1, eventCode: 'ASSIGNED', actorUserId: actor.id, sourceVersion: 1, envelopeVersion: 1, policyVersion: 1 },
        { dutyId: duty.id, version: 3, eventCode: 'OVERDUE', actorUserId: null, sourceVersion: 1, envelopeVersion: 1, policyVersion: 1 },
      ] });

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.deepEqual(
        report.findings.filter((finding) => finding.dutyId === duty.id).map((finding) => finding.code),
        ['DUTY_AUDIT_VERSION_GAP'],
      );
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report identifies a duty bound to an inactive envelope version', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-envelope-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Inactive Envelope',
      } });
      const source = await tx.hrWorkItem.create({ data: {
        title: 'Inactive envelope source', sourceType: 'MANUAL', destinationHref: '/dashboard/accounting/duties',
        dueDate: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING', isActive: false,
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'HR_WORK_ITEM', sourceId: source.id,
        sourceActionCode: 'FINANCE_APPROVAL', sourceVersion: 1,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
        dueAt: source.dueDate, createdByUserId: actor.id,
      } });
      await Promise.all([
        tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
          dutyId: duty.id, sequence: 1, assignedUserId: null,
          destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'FINANCE_APPROVALS',
          changedByUserId: actor.id, policyVersion: 1,
        } }),
        tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: 1, eventCode: 'UNASSIGNED_TRIAGE', actorUserId: actor.id,
          sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
        } }),
      ]);

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.deepEqual(
        report.findings.filter((finding) => finding.dutyId === duty.id).map((finding) => finding.code),
        ['DUTY_ENVELOPE_INACTIVE'],
      );
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('baseline report identifies a source type that has no registered current adapter', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-adapter-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Adapter Baseline',
      } });
      const envelope = await tx.crossWorkspaceDutyEnvelope.create({ data: {
        code: suffix, version: 1, destinationWorkspaceCode: 'ACCOUNTING',
        allowedFieldsJson: ['title'], allowedEvidenceJson: [], allowedActionCodesJson: ['APPROVE'],
        responseSchemaJson: { type: 'object' }, createdByUserId: actor.id,
      } });
      const duty = await tx.crossWorkspaceDuty.create({ data: {
        stableKey: suffix, sourceType: 'ACCOUNTING_DISPATCH_CANDIDATE', sourceId: `${suffix}:candidate`,
        sourceActionCode: 'ISSUE_WAYBILL', sourceVersion: 1,
        envelopeCode: envelope.code, envelopeVersion: envelope.version,
        destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'DISPATCH_CANDIDATES',
        dueAt: new Date('2026-08-17T08:00:00.000Z'), createdByUserId: actor.id,
      } });
      await Promise.all([
        tx.crossWorkspaceDutyAssignmentHistory.create({ data: {
          dutyId: duty.id, sequence: 1, assignedUserId: null,
          destinationWorkspaceCode: 'ACCOUNTING', destinationQueueCode: 'DISPATCH_CANDIDATES',
          changedByUserId: actor.id, policyVersion: 1,
        } }),
        tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: 1, eventCode: 'UNASSIGNED_TRIAGE', actorUserId: actor.id,
          sourceVersion: 1, envelopeVersion: 1, policyVersion: 1,
        } }),
      ]);

      const report = await collectHrDutyBaselineReport(tx, { now: new Date('2026-08-16T08:00:00.000Z') });
      assert.deepEqual(
        report.findings.filter((finding) => finding.dutyId === duty.id).map((finding) => finding.code),
        ['DUTY_SOURCE_ADAPTER_UNREGISTERED'],
      );
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});
