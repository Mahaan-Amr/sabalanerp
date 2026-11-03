import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { claimCandidateSmsAttempt, finalizeCandidateSmsAttempt } from '../hrCandidateSmsDelivery';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

test('SMS attempt claim serializes retries and enforces the two-minute cooldown', async () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let applicationId = '';
  let candidateId = '';
  try {
    const actor = await prisma.user.create({ data: {
      email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret', firstName: 'Sms', lastName: 'Owner',
    } });
    const unit = await prisma.hrOrganizationalUnit.create({ data: { code: `UNIT-${suffix}`, name: suffix, type: 'DEPARTMENT', createdBy: actor.id } });
    const job = await prisma.hrJob.create({ data: { code: `JOB-${suffix}`, title: suffix, createdBy: actor.id } });
    const position = await prisma.hrPosition.create({ data: {
      code: `POS-${suffix}`, title: suffix, capacity: 1, organizationalUnitId: unit.id, jobId: job.id, createdBy: actor.id,
    } });
    const candidate = await prisma.hrCandidate.create({ data: { firstName: 'Sms', lastName: 'Candidate', mobile: `09${Date.now().toString().slice(-9)}` } });
    candidateId = candidate.id;
    const application = await prisma.hrJobApplication.create({ data: { candidateId: candidate.id, positionId: position.id, createdBy: actor.id } });
    applicationId = application.id;
    const sentAt = new Date('2026-08-26T08:00:00.000Z');
    const initial = await claimCandidateSmsAttempt({
      prisma, applicationId, purpose: 'OFFER', referenceId: 'snapshot-test', initiatedByUserId: actor.id, now: sentAt,
    });
    await finalizeCandidateSmsAttempt({ prisma, attemptId: initial.id, success: false, error: 'provider rejected', now: sentAt });
    await assert.rejects(
      claimCandidateSmsAttempt({
        prisma, applicationId, purpose: 'OFFER', referenceId: 'snapshot-test', initiatedByUserId: actor.id,
        isRetry: true, now: new Date(sentAt.getTime() + 60_000),
      }),
      (error: any) => error.code === 'CANDIDATE_SMS_RETRY_NOT_ALLOWED' && error.eligibility?.reason === 'COOLDOWN',
    );
    const retry = await claimCandidateSmsAttempt({
      prisma, applicationId, purpose: 'OFFER', referenceId: 'snapshot-test', initiatedByUserId: actor.id,
      isRetry: true, now: new Date(sentAt.getTime() + 120_000),
    });
    assert.equal(retry.attemptNumber, 2);
    assert.equal(retry.retryOfAttemptId, initial.id);
    await assert.rejects(
      claimCandidateSmsAttempt({
        prisma, applicationId, purpose: 'OFFER', referenceId: 'snapshot-test', initiatedByUserId: actor.id,
        isRetry: true, now: new Date(sentAt.getTime() + 121_000),
      }),
      (error: any) => error.code === 'CANDIDATE_SMS_RETRY_NOT_ALLOWED',
    );

    const crashed = await claimCandidateSmsAttempt({
      prisma, applicationId, purpose: 'CORRECTION', referenceId: 'revision-crashed', initiatedByUserId: actor.id, now: sentAt,
    });
    const recovered = await claimCandidateSmsAttempt({
      prisma, applicationId, purpose: 'CORRECTION', referenceId: 'revision-crashed', initiatedByUserId: actor.id,
      isRetry: true, now: new Date(sentAt.getTime() + 24 * 60 * 60_000),
    });
    assert.equal(recovered.retryOfAttemptId, crashed.id);

    const ambiguous = await claimCandidateSmsAttempt({
      prisma, applicationId, purpose: 'INVITATION', referenceId: 'invitation-timeout', initiatedByUserId: actor.id, now: sentAt,
    });
    const finalizedAmbiguous = await finalizeCandidateSmsAttempt({
      prisma, attemptId: ambiguous.id, success: false, failureKind: 'NETWORK', error: 'timeout', now: sentAt,
    });
    assert.equal(finalizedAmbiguous.providerDeliveryState, 'UNKNOWN');
    assert.equal(finalizedAmbiguous.providerFailureKind, 'NETWORK');
  } finally {
    if (applicationId) await prisma.hrJobApplication.delete({ where: { id: applicationId } });
    await prisma.hrPosition.deleteMany({ where: { code: `POS-${suffix}` } });
    await prisma.hrJob.deleteMany({ where: { code: `JOB-${suffix}` } });
    await prisma.hrOrganizationalUnit.deleteMany({ where: { code: `UNIT-${suffix}` } });
    if (candidateId) await prisma.hrCandidate.delete({ where: { id: candidateId } });
    await prisma.user.deleteMany({ where: { username: suffix } });
    await prisma.$disconnect();
  }
});
