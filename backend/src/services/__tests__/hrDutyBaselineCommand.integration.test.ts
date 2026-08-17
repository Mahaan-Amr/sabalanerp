import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { runHrDutyBaselineCommand } from '../hrDutyBaselineCommand';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

const rollback = new Error('ROLLBACK_HR_DUTY_BASELINE_COMMAND_TEST');

test('baseline command emits machine-readable findings and exits non-zero for integrity violations', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `duty-baseline-command-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'Duty', lastName: 'Command Baseline',
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

      const lines: string[] = [];
      const result = await runHrDutyBaselineCommand(tx, {
        now: new Date('2026-08-16T08:00:00.000Z'),
        writeLine: (line) => lines.push(line),
      });
      assert.equal(result.exitCode, 1);
      assert.equal(lines.length, 1);
      const output = JSON.parse(lines[0]);
      assert.equal(output.generatedAt, '2026-08-16T08:00:00.000Z');
      assert.ok(output.findings.some((finding: { code: string; dutyId: string }) => (
        finding.code === 'DUTY_SOURCE_MISSING' && finding.dutyId === duty.id
      )));
      throw rollback;
    }), rollback);
  } finally {
    await prisma.$disconnect();
  }
});
