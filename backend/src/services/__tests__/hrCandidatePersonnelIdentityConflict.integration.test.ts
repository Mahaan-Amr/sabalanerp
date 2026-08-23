import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  assertCandidatePersonnelIdentityConsistent,
  createIdentityConflictIfNeeded,
  ensureCandidatePersonnelIdentityConsistent,
} from '../hrCandidatePersonnelIdentityConflict';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';
const rollback = new Error('ROLLBACK_IDENTITY_CONFLICT_TEST');

test('a candidate/personnel name conflict is preserved, audited, tasked, and blocks identity-sensitive actions', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const personnel = await tx.personnel.create({ data: {
        firstName: 'امیر', lastName: 'ماهانیان', nationalCode: `9${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      } });
      const candidate = await tx.hrCandidate.create({ data: {
        firstName: 'علی', lastName: 'رضایی', mobile: `09${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
        linkedPersonnelId: personnel.id,
      } });
      const unit = await tx.hrOrganizationalUnit.create({ data: { code: `IDENTITY-U-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: 'SYSTEM' } });
      const job = await tx.hrJob.create({ data: { code: `IDENTITY-J-${suffix}`, title: suffix, createdBy: 'SYSTEM' } });
      const position = await tx.hrPosition.create({ data: { code: `IDENTITY-P-${suffix}`, title: suffix, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'SYSTEM' } });
      const application = await tx.hrJobApplication.create({ data: { candidateId: candidate.id, positionId: position.id, createdBy: 'SYSTEM', identityClearance: 'APPROVED' } });
      const conflict = await createIdentityConflictIfNeeded(tx, {
        applicationId: application.id, candidateId: candidate.id, claim: candidate, potentialPersonnel: personnel,
        now: new Date('2026-08-23T08:00:00Z'),
      });
      assert.ok(conflict);
      assert.equal((await tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id } })).identityClearance, 'IN_PROGRESS');
      assert.equal(await tx.hrWorkItem.count({ where: { sourceKey: `HIRING:${application.id}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED` } }), 1);
      assert.equal(await tx.hrHiringAudit.count({ where: { applicationId: application.id, eventType: 'CANDIDATE_PERSONNEL_IDENTITY_CONFLICT_OPENED' } }), 1);
      await assert.rejects(assertCandidatePersonnelIdentityConsistent(tx, {
        applicationId: application.id, candidate: { ...candidate, linkedPersonnel: personnel },
      }), /مغایرت هویت/);
      const incompletePersonnel = await tx.personnel.create({ data: {
        firstName: 'علی', lastName: 'رضایی', identityCompletionStatus: 'NEEDS_COMPLETION',
      } });
      const incompleteCandidate = await tx.hrCandidate.create({ data: {
        firstName: 'علی', lastName: 'رضایی', mobile: `08${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
        linkedPersonnelId: incompletePersonnel.id,
      } });
      const incompleteApplication = await tx.hrJobApplication.create({ data: {
        candidateId: incompleteCandidate.id, positionId: position.id, createdBy: 'SYSTEM', identityClearance: 'APPROVED',
      } });
      await assert.rejects(assertCandidatePersonnelIdentityConsistent(tx, {
        applicationId: incompleteApplication.id,
        candidate: { ...incompleteCandidate, linkedPersonnel: incompletePersonnel },
      }), /نیازمند تکمیل/);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('identity conflict bundle is committed before the consistency guard rejects the action', async () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sourceKey = `HIRING:pending:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED`;
  let personnelId = '';
  let candidateId = '';
  let unitId = '';
  let jobId = '';
  let positionId = '';
  let applicationId = '';
  try {
    const personnel = await prisma.personnel.create({ data: {
      firstName: 'امیر', lastName: 'ماهانیان', nationalCode: `8${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
    } });
    personnelId = personnel.id;
    const candidate = await prisma.hrCandidate.create({ data: {
      firstName: 'علی', lastName: 'رضایی', mobile: `07${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      linkedPersonnelId: personnel.id,
    } });
    candidateId = candidate.id;
    const unit = await prisma.hrOrganizationalUnit.create({ data: { code: `IDENTITY-COMMIT-U-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: 'SYSTEM' } });
    unitId = unit.id;
    const job = await prisma.hrJob.create({ data: { code: `IDENTITY-COMMIT-J-${suffix}`, title: suffix, createdBy: 'SYSTEM' } });
    jobId = job.id;
    const position = await prisma.hrPosition.create({ data: { code: `IDENTITY-COMMIT-P-${suffix}`, title: suffix, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'SYSTEM' } });
    positionId = position.id;
    const application = await prisma.hrJobApplication.create({ data: {
      candidateId: candidate.id, positionId: position.id, createdBy: 'SYSTEM', identityClearance: 'APPROVED',
    } });
    applicationId = application.id;
    const actualSourceKey = sourceKey.replace('pending', application.id);

    await assert.rejects(ensureCandidatePersonnelIdentityConsistent(prisma, {
      applicationId: application.id,
      candidate: { ...candidate, linkedPersonnel: personnel },
    }), /مغایرت هویت/);

    const conflict = await prisma.hrCandidatePersonnelIdentityConflict.findFirst({ where: { applicationId: application.id, status: 'OPEN' } });
    const workItem = await prisma.hrWorkItem.findUnique({ where: { sourceKey: actualSourceKey } });
    assert.ok(conflict);
    assert.ok(workItem);
    assert.equal(await prisma.hrWorkItemAudit.count({ where: { workItemId: workItem.id, eventType: 'IDENTITY_CONFLICT_TASK_CREATED' } }), 1);
    assert.equal(await prisma.hrHiringAudit.count({ where: { applicationId: application.id, eventType: 'CANDIDATE_PERSONNEL_IDENTITY_CONFLICT_OPENED' } }), 1);
    assert.equal((await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: application.id } })).identityClearance, 'IN_PROGRESS');
  } finally {
    if (applicationId) {
      await prisma.hrWorkItem.deleteMany({ where: { sourceKey: sourceKey.replace('pending', applicationId) } });
      await prisma.hrCandidatePersonnelIdentityConflict.deleteMany({ where: { applicationId } });
      await prisma.hrJobApplication.deleteMany({ where: { id: applicationId } });
    }
    if (positionId) await prisma.hrPosition.deleteMany({ where: { id: positionId } });
    if (candidateId) await prisma.hrCandidate.deleteMany({ where: { id: candidateId } });
    if (personnelId) await prisma.personnel.deleteMany({ where: { id: personnelId } });
    if (jobId) await prisma.hrJob.deleteMany({ where: { id: jobId } });
    if (unitId) await prisma.hrOrganizationalUnit.deleteMany({ where: { id: unitId } });
    await prisma.$disconnect();
  }
});
