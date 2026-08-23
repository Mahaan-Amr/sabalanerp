import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  assertCandidatePersonnelIdentityConsistent,
  createIdentityConflictIfNeeded,
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
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});
