import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  createHrHiringCollateralReturnDuty,
  createHrHiringFinanceDuty,
  recordHrHiringCollateralOriginalReturn,
  recordHrHiringCollateralReceipt,
} from '../crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter';
import { claimCrossWorkspaceDuty, respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';
import { activeHrActionPermissionsForUser } from '../hrAuthorizationService';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';
const rollback = new Error('ROLLBACK_HR_HIRING_FINANCE_DUTY_TEST');

const evidence = (name: string) => ({
  storageName: `${name}.pdf`, originalName: `${name}.pdf`, mimeType: 'application/pdf',
  size: 12, sha256: name.padEnd(64, '0').slice(0, 64), malwareScanStatus: 'CLEAN',
});

test('Accounting duties record and verify collateral atomically without granting HR workspace access', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const [initiator, recorder, verifier] = await Promise.all(['initiator', 'recorder', 'verifier'].map((role) => tx.user.create({ data: {
        email: `${suffix}-${role}@example.invalid`, username: `${suffix}-${role}`, password: 'not-a-login-secret',
        firstName: 'Finance', lastName: role,
      } })));
      await tx.hrWorkspaceCatalog.upsert({
        where: { code: 'HUMAN_RESOURCES' }, update: { isActive: true },
        create: { code: 'HUMAN_RESOURCES', displayName: 'Human Resources' },
      });
      await tx.hrFeatureCatalog.upsert({
        where: { code: 'MANAGE_FINANCE_EVIDENCE' }, update: { isActive: true },
        create: { code: 'MANAGE_FINANCE_EVIDENCE', workspaceCode: 'HUMAN_RESOURCES', displayName: 'Manage finance evidence' },
      });
      for (const user of [recorder, verifier]) {
        await tx.hrFeatureAccessGrant.create({ data: {
          stableKey: `${suffix}:${user.id}:finance-action`, userId: user.id,
          featureCode: 'MANAGE_FINANCE_EVIDENCE', level: 'EDIT', effectiveFrom: new Date('2026-01-01T00:00:00Z'),
          grantedByUserId: initiator.id, reason: 'Independent Accounting duty action',
        } });
      }
      assert.deepEqual(await activeHrActionPermissionsForUser(tx, recorder.id), ['MANAGE_FINANCE_EVIDENCE']);
      assert.equal(await tx.hrWorkspaceAccessGrant.count({ where: { userId: { in: [recorder.id, verifier.id] } } }), 0);

      const unit = await tx.hrOrganizationalUnit.create({ data: {
        code: `UNIT-${suffix}`, name: 'Finance duty unit', type: 'DEPARTMENT', createdBy: initiator.id,
      } });
      const job = await tx.hrJob.create({ data: { code: `JOB-${suffix}`, title: 'Finance duty job', createdBy: initiator.id } });
      const position = await tx.hrPosition.create({ data: {
        code: `POS-${suffix}`, title: 'Finance duty position', capacity: 1,
        organizationalUnitId: unit.id, jobId: job.id, createdBy: initiator.id,
      } });
      const candidate = await tx.hrCandidate.create({ data: { firstName: 'Duty', lastName: 'Candidate', mobile: `09${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}` } });
      const application = await tx.hrJobApplication.create({ data: {
        candidateId: candidate.id, positionId: position.id, createdBy: initiator.id,
        collateralClearance: 'IN_PROGRESS', pendingClosureOutcome: 'REJECTED',
        pendingClosureReason: 'Closure after verified original return', pendingClosureRequestedBy: initiator.id,
        pendingClosureRequestedAt: new Date('2026-08-23T08:00:00Z'),
      } });
      const item = await tx.hrCollateralItem.create({ data: {
        applicationId: application.id, type: 'PROMISSORY_NOTE', amountRials: '20000000',
        status: 'MISSING', recordedBy: initiator.id,
      } });

      const recordingDuty = await createHrHiringFinanceDuty(tx, {
        collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT', actorUserId: initiator.id,
      });
      const replayedCreation = await createHrHiringFinanceDuty(tx, {
        collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT', actorUserId: initiator.id,
      });
      assert.equal(replayedCreation.id, recordingDuty.id, 'stable key makes synchronization replay-safe');
      await claimCrossWorkspaceDuty(tx, { dutyId: recordingDuty.id, actorUserId: recorder.id, policyVersion: 1 });
      const recorded = await recordHrHiringCollateralReceipt(tx, {
        dutyId: recordingDuty.id, actorUserId: recorder.id, receivedAt: new Date('2026-08-23T09:00:00Z'),
        custodyLocation: 'Safe A', identifier: 'PN-1', evidence: evidence('receipt-v1'),
      });
      const verificationDuty = await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: recorded.successorDutyId } });
      await assert.rejects(
        claimCrossWorkspaceDuty(tx, { dutyId: verificationDuty.id, actorUserId: recorder.id, policyVersion: 1 }),
        /DUTY_CLAIM_NOT_ALLOWED/,
      );
      await claimCrossWorkspaceDuty(tx, { dutyId: verificationDuty.id, actorUserId: verifier.id, policyVersion: 1 });
      await respondToCrossWorkspaceDuty(tx, {
        dutyId: verificationDuty.id, actorUserId: verifier.id, actionCode: 'APPROVE',
        expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null, policyVersion: 1,
      });
      assert.equal((await tx.hrCollateralItem.findUniqueOrThrow({ where: { id: item.id } })).status, 'VERIFIED');
      assert.equal((await tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id } })).collateralClearance, 'APPROVED');
      await assert.rejects(respondToCrossWorkspaceDuty(tx, {
        dutyId: verificationDuty.id, actorUserId: verifier.id, actionCode: 'APPROVE',
        expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null, policyVersion: 1,
      }), /DUTY_NOT_ASSIGNED/);

      const firstReturn = await tx.hrCollateralOriginalReturn.create({ data: {
        collateralItemId: item.id, version: 1, status: 'DRAFT',
      } });
      const returnRecordingDuty = await createHrHiringCollateralReturnDuty(tx, {
        returnId: firstReturn.id, actionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN', actorUserId: initiator.id,
      });
      await claimCrossWorkspaceDuty(tx, { dutyId: returnRecordingDuty.id, actorUserId: recorder.id, policyVersion: 1 });
      const returned = await recordHrHiringCollateralOriginalReturn(tx, {
        dutyId: returnRecordingDuty.id, actorUserId: recorder.id, returnedTo: 'Candidate',
        evidenceNote: 'First proof needs correction', evidence: evidence('return-v1'),
      });
      await claimCrossWorkspaceDuty(tx, { dutyId: returned.successorDutyId, actorUserId: verifier.id, policyVersion: 1 });
      await respondToCrossWorkspaceDuty(tx, {
        dutyId: returned.successorDutyId, actorUserId: verifier.id, actionCode: 'RETURN',
        expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: 'Proof is unclear', policyVersion: 1,
      });
      const secondReturn = await tx.hrCollateralOriginalReturn.findUniqueOrThrow({
        where: { collateralItemId_version: { collateralItemId: item.id, version: 2 } },
      });
      assert.equal((await tx.hrCollateralOriginalReturn.findUniqueOrThrow({ where: { id: firstReturn.id } })).status, 'RETURNED');
      const secondRecordingDuty = await tx.crossWorkspaceDuty.findUniqueOrThrow({
        where: { stableKey: `HR_HIRING_FINANCE:${secondReturn.id}:HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN:2` },
      });
      await claimCrossWorkspaceDuty(tx, { dutyId: secondRecordingDuty.id, actorUserId: recorder.id, policyVersion: 1 });
      const secondRecorded = await recordHrHiringCollateralOriginalReturn(tx, {
        dutyId: secondRecordingDuty.id, actorUserId: recorder.id, returnedTo: 'Candidate',
        evidenceNote: 'Clear replacement proof', evidence: evidence('return-v2'),
      });
      await claimCrossWorkspaceDuty(tx, { dutyId: secondRecorded.successorDutyId, actorUserId: verifier.id, policyVersion: 1 });
      await respondToCrossWorkspaceDuty(tx, {
        dutyId: secondRecorded.successorDutyId, actorUserId: verifier.id, actionCode: 'APPROVE',
        expectedSourceVersion: 2, expectedEnvelopeVersion: 1, reason: null, policyVersion: 1,
      });
      const versions = await tx.hrCollateralOriginalReturn.findMany({ where: { collateralItemId: item.id }, orderBy: { version: 'asc' } });
      assert.deepEqual(versions.map(({ version, status, evidenceOriginalName }) => ({ version, status, evidenceOriginalName })), [
        { version: 1, status: 'RETURNED', evidenceOriginalName: 'return-v1.pdf' },
        { version: 2, status: 'CONFIRMED', evidenceOriginalName: 'return-v2.pdf' },
      ]);
      const closed = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id } });
      assert.deepEqual({ stage: closed.stage, outcome: closed.outcome, pending: closed.pendingClosureOutcome }, {
        stage: 'CLOSED', outcome: 'REJECTED', pending: null,
      });
      assert.equal(await tx.hrHiringAudit.count({ where: { applicationId: application.id } }), 5);
      throw rollback;
    }, { timeout: 120_000 }), (error: unknown) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('a concurrent Accounting claim has exactly one winner', async () => {
  const prisma = new PrismaClient();
  const contenderAClient = new PrismaClient();
  const contenderBClient = new PrismaClient();
  const suffix = `claim-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let applicationId = '';
  let candidateId = '';
  let positionId = '';
  let jobId = '';
  let unitId = '';
  let itemId = '';
  let dutyId = '';
  let userIds: string[] = [];
  try {
    const [initiator, contenderA, contenderB] = await Promise.all(['initiator', 'a', 'b'].map((role) => prisma.user.create({ data: {
      email: `${suffix}-${role}@example.invalid`, username: `${suffix}-${role}`, password: 'not-a-login-secret',
      firstName: 'Concurrent', lastName: role,
    } })));
    userIds = [initiator.id, contenderA.id, contenderB.id];
    await prisma.hrWorkspaceCatalog.upsert({ where: { code: 'HUMAN_RESOURCES' }, update: { isActive: true }, create: { code: 'HUMAN_RESOURCES', displayName: 'Human Resources' } });
    await prisma.hrFeatureCatalog.upsert({ where: { code: 'MANAGE_FINANCE_EVIDENCE' }, update: { isActive: true }, create: { code: 'MANAGE_FINANCE_EVIDENCE', workspaceCode: 'HUMAN_RESOURCES', displayName: 'Manage finance evidence' } });
    await Promise.all([contenderA, contenderB].map((user) => prisma.hrFeatureAccessGrant.create({ data: {
      stableKey: `${suffix}:${user.id}:finance-action`, userId: user.id, featureCode: 'MANAGE_FINANCE_EVIDENCE',
      level: 'EDIT', effectiveFrom: new Date('2026-01-01T00:00:00Z'), grantedByUserId: initiator.id, reason: 'Concurrent claim test',
    } })));
    const unit = await prisma.hrOrganizationalUnit.create({ data: { code: `UNIT-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: initiator.id } }); unitId = unit.id;
    const job = await prisma.hrJob.create({ data: { code: `JOB-${suffix}`, title: suffix, createdBy: initiator.id } }); jobId = job.id;
    const position = await prisma.hrPosition.create({ data: { code: `POS-${suffix}`, title: suffix, capacity: 1, organizationalUnitId: unit.id, jobId: job.id, createdBy: initiator.id } }); positionId = position.id;
    const candidate = await prisma.hrCandidate.create({ data: { firstName: 'Concurrent', lastName: 'Candidate', mobile: `09${Date.now().toString().slice(-9)}` } }); candidateId = candidate.id;
    const application = await prisma.hrJobApplication.create({ data: { candidateId: candidate.id, positionId: position.id, createdBy: initiator.id } }); applicationId = application.id;
    const item = await prisma.hrCollateralItem.create({ data: { applicationId: application.id, type: 'PROMISSORY_NOTE', status: 'MISSING', recordedBy: initiator.id } }); itemId = item.id;
    const duty = await createHrHiringFinanceDuty(prisma, { collateralItemId: item.id, actionCode: 'HIRING_COLLATERAL_RECORD_RECEIPT', actorUserId: initiator.id }); dutyId = duty.id;

    const results = await Promise.allSettled([
      claimCrossWorkspaceDuty(contenderAClient, { dutyId: duty.id, actorUserId: contenderA.id, policyVersion: 1 }),
      claimCrossWorkspaceDuty(contenderBClient, { dutyId: duty.id, actorUserId: contenderB.id, policyVersion: 1 }),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    assert.equal(results.filter(({ status }) => status === 'rejected').length, 1);
    const claimed = await prisma.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
    assert.ok([contenderA.id, contenderB.id].includes(claimed.currentAssigneeUserId || ''));
    assert.deepEqual((await prisma.crossWorkspaceDutyAssignmentHistory.findMany({ where: { dutyId: duty.id }, orderBy: { sequence: 'asc' } })).map(({ sequence }) => sequence), [1, 2]);
  } finally {
    if (dutyId) {
      await prisma.crossWorkspaceDutyAuditVersion.deleteMany({ where: { dutyId } });
      await prisma.crossWorkspaceDutyAssignmentHistory.deleteMany({ where: { dutyId } });
      await prisma.crossWorkspaceDuty.deleteMany({ where: { id: dutyId } });
    }
    if (applicationId) await prisma.hrHiringAudit.deleteMany({ where: { applicationId } });
    if (itemId) await prisma.hrCollateralItem.deleteMany({ where: { id: itemId } });
    if (applicationId) await prisma.hrJobApplication.deleteMany({ where: { id: applicationId } });
    if (candidateId) await prisma.hrCandidate.deleteMany({ where: { id: candidateId } });
    if (positionId) await prisma.hrPosition.deleteMany({ where: { id: positionId } });
    if (jobId) await prisma.hrJob.deleteMany({ where: { id: jobId } });
    if (unitId) await prisma.hrOrganizationalUnit.deleteMany({ where: { id: unitId } });
    if (userIds.length) {
      await prisma.hrFeatureAccessGrant.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await Promise.all([contenderAClient.$disconnect(), contenderBClient.$disconnect(), prisma.$disconnect()]);
  }
});
