import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  assertCandidatePersonnelIdentityConsistent,
  createIdentityConflictIfNeeded,
  ensureCandidatePersonnelIdentityConsistent,
} from '../hrCandidatePersonnelIdentityConflict';
import { eraseJobApplicationRecords } from '../hrJobApplicationErasure';
import { buildPersonnelErasurePlan, executePersonnelErasureGraph } from '../hrPersonnelErasureGraph';

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

test('permanent application deletion removes its identity-conflict decision bundle', async () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let candidateId = '';
  let personnelId = '';
  let unitId = '';
  let jobId = '';
  let positionId = '';
  let applicationId = '';
  try {
    const personnel = await prisma.personnel.create({ data: {
      firstName: 'رضا', lastName: 'قربانی', nationalCode: `7${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
    } });
    personnelId = personnel.id;
    const candidate = await prisma.hrCandidate.create({ data: {
      firstName: 'رضا', lastName: 'قربانی', mobile: `06${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
    } });
    candidateId = candidate.id;
    const unit = await prisma.hrOrganizationalUnit.create({ data: { code: `ERASE-U-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: 'SYSTEM' } });
    unitId = unit.id;
    const job = await prisma.hrJob.create({ data: { code: `ERASE-J-${suffix}`, title: suffix, createdBy: 'SYSTEM' } });
    jobId = job.id;
    const position = await prisma.hrPosition.create({ data: { code: `ERASE-P-${suffix}`, title: suffix, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'SYSTEM' } });
    positionId = position.id;
    const application = await prisma.hrJobApplication.create({ data: {
      candidateId: candidate.id, positionId: position.id, createdBy: 'SYSTEM', identityClearance: 'APPROVED',
    } });
    applicationId = application.id;
    await createIdentityConflictIfNeeded(prisma, {
      applicationId, candidateId, claim: candidate, potentialPersonnel: personnel,
      now: new Date('2026-08-23T08:00:00Z'),
    });

    await prisma.$transaction((tx) => eraseJobApplicationRecords(tx, applicationId));

    assert.equal(await prisma.hrJobApplication.count({ where: { id: applicationId } }), 0);
    assert.equal(await prisma.hrCandidatePersonnelIdentityConflict.count({ where: { applicationId } }), 0);
    assert.equal(await prisma.hrWorkItem.count({ where: { sourceKey: `HIRING:${applicationId}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED` } }), 0);
    applicationId = '';
  } finally {
    if (applicationId) {
      await prisma.hrWorkItem.deleteMany({ where: { sourceKey: `HIRING:${applicationId}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED` } });
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

test('permanent application deletion removes formal and company evaluation graphs', async () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await assert.rejects(prisma.$transaction(async (tx) => {
      const candidate = await tx.hrCandidate.create({ data: {
        firstName: 'علی', lastName: 'رضایی', mobile: `04${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      } });
      const evaluator = await tx.personnel.create({ data: {
        firstName: 'ارزیاب', lastName: 'آزمایشی', nationalCode: `5${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      } });
      const unit = await tx.hrOrganizationalUnit.create({ data: {
        code: `ERASE-EVAL-U-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: 'SYSTEM',
      } });
      const job = await tx.hrJob.create({ data: {
        code: `ERASE-EVAL-J-${suffix}`, title: suffix, createdBy: 'SYSTEM',
      } });
      const position = await tx.hrPosition.create({ data: {
        code: `ERASE-EVAL-P-${suffix}`, title: suffix, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'SYSTEM',
      } });
      const application = await tx.hrJobApplication.create({ data: {
        candidateId: candidate.id, positionId: position.id, createdBy: 'SYSTEM', stage: 'OFFER', identityClearance: 'APPROVED',
      } });
      const occurrence = await tx.hrCompanyEvaluationOccurrence.create({ data: {
        applicationId: application.id,
        type: 'SECTION_SUPERVISOR_INTERVIEW',
        occurrenceNumber: 1,
        evidencePolicy: 'REPORT_REQUIRED',
        evaluatorPersonnelId: evaluator.id,
        createdByUserId: 'SYSTEM',
        resultStorageName: `company-evaluation-${suffix}.pdf`,
      } });
      await tx.hrCompanyEvaluationAssignmentHistory.create({ data: {
        occurrenceId: occurrence.id,
        evaluatorPersonnelId: evaluator.id,
        assignedByUserId: 'SYSTEM',
      } });
      const plan = await tx.hrFormalAssessmentPlan.create({ data: {
        stableKey: `ERASE-EVAL-PLAN-${suffix}`,
        applicationId: application.id,
        version: 1,
        executionMethod: 'APPLICANT',
        finalizedByUserId: 'SYSTEM',
      } });
      const selection = await tx.hrFormalAssessmentPlanSelection.create({ data: {
        planId: plan.id,
        assessmentKind: 'DISC',
        selected: true,
        executionMethod: 'APPLICANT',
      } });
      const result = await tx.hrFormalAssessmentResult.create({ data: {
        stableKey: `ERASE-EVAL-RESULT-${suffix}`,
        applicationId: application.id,
        planId: plan.id,
        planSelectionId: selection.id,
        assessmentKind: 'DISC',
        resultVersion: 1,
        status: 'COMPLETED',
        resultJson: { D: 25, I: 25, S: 25, C: 25 },
        recordedAt: new Date('2026-08-25T08:00:00Z'),
      } });
      const attempt = await tx.hrFormalAssessmentAttempt.create({ data: {
        stableKey: `ERASE-EVAL-ATTEMPT-${suffix}`,
        resultId: result.id,
        attemptNumber: 1,
        executionMethod: 'APPLICANT',
        status: 'COMPLETED',
        completedAt: new Date('2026-08-25T08:00:00Z'),
      } });
      const document = await tx.hrHiringDocument.create({ data: {
        applicationId: application.id,
        category: 'OTHER',
        customTitle: 'گزارش DISC',
        version: 1,
        inspectionSource: 'COPY_RECEIVED',
        storageName: `formal-assessment-${suffix}.pdf`,
        uploadedBy: 'SYSTEM',
      } });
      await tx.hrFormalAssessmentEvidenceLink.create({ data: {
        stableKey: `ERASE-EVAL-EVIDENCE-${suffix}`,
        attemptId: attempt.id,
        evidenceType: 'HIRING_DOCUMENT',
        hiringDocumentId: document.id,
      } });
      await tx.hrAssessmentMigrationEvent.create({ data: {
        stableKey: `ERASE-EVAL-MIGRATION-${suffix}`,
        applicationId: application.id,
        eventCode: 'LEGACY_RESULT_IMPORTED',
        detailsJson: { source: 'test' },
      } });

      await eraseJobApplicationRecords(tx, application.id);

      assert.equal(await tx.hrJobApplication.count({ where: { id: application.id } }), 0);
      assert.equal(await tx.hrCompanyEvaluationOccurrence.count({ where: { applicationId: application.id } }), 0);
      assert.equal(await tx.hrFormalAssessmentPlan.count({ where: { applicationId: application.id } }), 0);
      assert.equal(await tx.hrFormalAssessmentResult.count({ where: { applicationId: application.id } }), 0);
      assert.equal(await tx.hrAssessmentMigrationEvent.count({ where: { applicationId: application.id } }), 0);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await prisma.$disconnect();
  }
});

test('permanent personnel erasure includes identity conflicts and their decision work item', async () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let personnelId = '';
  let candidateId = '';
  let unitId = '';
  let jobId = '';
  let positionId = '';
  let applicationId = '';
  try {
    const personnel = await prisma.personnel.create({ data: {
      firstName: 'رضا', lastName: 'قربانی', nationalCode: `6${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
    } });
    personnelId = personnel.id;
    const candidate = await prisma.hrCandidate.create({ data: {
      firstName: 'رضا', lastName: 'قربانی', mobile: `05${suffix.replace(/\D/g, '').slice(-9).padStart(9, '0')}`,
      linkedPersonnelId: personnel.id,
    } });
    candidateId = candidate.id;
    const unit = await prisma.hrOrganizationalUnit.create({ data: { code: `PERSON-ERASE-U-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: 'SYSTEM' } });
    unitId = unit.id;
    const job = await prisma.hrJob.create({ data: { code: `PERSON-ERASE-J-${suffix}`, title: suffix, createdBy: 'SYSTEM' } });
    jobId = job.id;
    const position = await prisma.hrPosition.create({ data: { code: `PERSON-ERASE-P-${suffix}`, title: suffix, organizationalUnitId: unit.id, jobId: job.id, createdBy: 'SYSTEM' } });
    positionId = position.id;
    const application = await prisma.hrJobApplication.create({ data: {
      candidateId: candidate.id, positionId: position.id, createdBy: 'SYSTEM', identityClearance: 'APPROVED',
    } });
    applicationId = application.id;
    await createIdentityConflictIfNeeded(prisma, {
      applicationId, candidateId, claim: candidate,
      potentialPersonnel: { ...personnel, firstName: 'رضا-متعارض' },
      now: new Date('2026-08-23T08:00:00Z'),
    });

    const plan = await buildPersonnelErasurePlan(prisma, personnelId);
    assert.deepEqual(plan.nodes.HrCandidatePersonnelIdentityConflict?.length, 1);
    await prisma.$transaction((tx) => executePersonnelErasureGraph(tx, plan));

    assert.equal(await prisma.personnel.count({ where: { id: personnelId } }), 0);
    assert.equal(await prisma.hrJobApplication.count({ where: { id: applicationId } }), 0);
    assert.equal(await prisma.hrWorkItem.count({ where: { sourceKey: `HIRING:${applicationId}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED` } }), 0);
    personnelId = '';
    candidateId = '';
    applicationId = '';
  } finally {
    if (applicationId) {
      await prisma.hrWorkItem.deleteMany({ where: { sourceKey: `HIRING:${applicationId}:RESOLVE_IDENTITY_CONFLICT:UNASSIGNED` } });
      await prisma.hrCandidatePersonnelIdentityConflict.deleteMany({ where: { applicationId } });
      await prisma.hrJobApplication.deleteMany({ where: { id: applicationId } });
    }
    if (candidateId) await prisma.hrCandidate.deleteMany({ where: { id: candidateId } });
    if (personnelId) await prisma.personnel.deleteMany({ where: { id: personnelId } });
    if (positionId) await prisma.hrPosition.deleteMany({ where: { id: positionId } });
    if (jobId) await prisma.hrJob.deleteMany({ where: { id: jobId } });
    if (unitId) await prisma.hrOrganizationalUnit.deleteMany({ where: { id: unitId } });
    await prisma.$disconnect();
  }
});
