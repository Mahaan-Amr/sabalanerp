import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10',
    schemaOnly: true });
    const first = database.client();
  const second = database.client();
  try {
    await first.$executeRaw`INSERT INTO performance_disclosure_revision(id,revision) VALUES (1,0)`;
    await first.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'آزمون منابع انسانی' } });
    await first.hrFeatureCatalog.createMany({ data: [
      'APPROVE_PERFORMANCE_COHORT_HR', 'APPROVE_PERFORMANCE_COHORT_SECURITY', 'APPROVE_PERFORMANCE_COHORT_SYSTEM',
    ].map((code) => ({ code, workspaceCode: 'HUMAN_RESOURCES', displayName: code })) });
    const users: Array<{ id: string }> = [];
    for (let index = 0; index < 4; index++) users.push(await first.user.create({ data: { email: `${database.runId}-${index}@example.invalid`,
      username: `${database.runId}-${index}`, password: 'not-used', firstName: 'عامل', lastName: String(index) } }));
    await first.hrFeatureAccessGrant.createMany({ data: [
      ['APPROVE_PERFORMANCE_COHORT_HR', users[1].id],
      ['APPROVE_PERFORMANCE_COHORT_SECURITY', users[2].id],
      ['APPROVE_PERFORMANCE_COHORT_SYSTEM', users[3].id],
    ].map(([featureCode, userId]) => ({ stableKey: `${database.runId}:${featureCode}`, featureCode, userId,
      level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: users[0].id, reason: 'Promotion race owner' })) });
    const [clock] = await first.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await first.performanceFeaturePhaseVersion.create({ data: { version: 1, phase: 'EXPANSION_RETIREMENT', releaseEnabled: false,
      effectiveFrom: clock.now, recordedByUserId: users[0].id, reason: 'Isolated promotion race phase' } });
    const createScheduledFixture = async (suffix: string, approvalUserIds = users.slice(1).map(({ id }) => id),
      authenticate = true, evidenceMode: 'VALID' | 'STALE' | 'WRONG_GATE' | 'UNRELATED' = 'VALID') => {
      const [fixtureClock] = await first.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const personnel = await first.personnel.create({ data: { firstName: 'آزمون', lastName: suffix } });
      const relationship = await first.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE',
        effectiveFrom: new Date('2020-01-01Z'), createdBy: users[0].id } });
      const subject = await first.performanceSubject.create({ data: { stableKey: `${database.runId}:${suffix}`,
        nonDisplayKey: `${database.runId}:${suffix}`, personnelId: personnel.id, employmentRelationshipId: relationship.id,
        createdByUserId: users[0].id } });
      const cohort = await first.performanceCohortVersion.create({ data: { cohortKey: `${database.runId}:${suffix}`,
        version: 1, membershipHash: 'a'.repeat(64), stage: 'PILOT', targetPercent: 10, readinessHash: 'b'.repeat(64),
        targetPhase: 'EXPANSION_RETIREMENT', createdByUserId: users[0].id } });
      await first.performanceCohortMember.create({ data: { cohortVersionId: cohort.id, subjectId: subject.id,
        eligibilityHash: 'c'.repeat(64) } });
      const payload = await first.performanceEncryptedPayload.create({ data: { aggregateType: 'PERFORMANCE_PROMOTION_EVIDENCE',
        aggregateId: `${database.runId}:${suffix}:evidence`, payloadKind: 'AUTHENTICATED_REPORT', schemaVersion: 1,
        format: 'sabalan-personnel-performance', cipher: 'aes-256-gcm', keyId: 'race-key', iv: Buffer.alloc(12), authTag: Buffer.alloc(16),
        ciphertext: Buffer.from('race'), plaintextHash: 'd'.repeat(64), aadHash: 'e'.repeat(64) } });
      const evidence = await first.performancePromotionEvidence.create({ data: { id: `${database.runId}:${suffix}:evidence`,
        evidenceHash: createHash('sha256').update(`${database.runId}:${suffix}`).digest('hex'), manifestHash: '3'.repeat(64), releaseCommit: '4'.repeat(40),
        releaseSourceHash: '5'.repeat(64), releaseSchemaHash: '6'.repeat(64), releasePolicyHash: '7'.repeat(64),
        releaseInfrastructureHash: '8'.repeat(64), backendImageDigest: `sha256:${'9'.repeat(64)}`,
        frontendImageDigest: `sha256:${'a'.repeat(64)}`, inquiryImageDigest: `sha256:${'b'.repeat(64)}`,
        targetPhase: 'EXPANSION_RETIREMENT', targetCohortVersionId: cohort.id, targetCohortStage: 'PILOT',
        targetMembershipHash: evidenceMode === 'UNRELATED' ? '0'.repeat(64) : cohort.membershipHash,
        targetReadyPopulation: 1, targetMemberCount: 1, targetGate: evidenceMode === 'WRONG_GATE' ? 8 : 9,
        encryptedPayloadId: payload.id, attestationKeyId: 'race-key', authenticatedByUserId: users[0].id,
        verifiedAt: fixtureClock.now, validUntil: new Date(fixtureClock.now.getTime() + (evidenceMode === 'STALE' ? 100 : 60_000)) } });
      await first.performanceRolloutDecision.createMany({ data: ['HUMAN_RESOURCES', 'SECURITY_PRIVACY', 'SYSTEM_OWNER'].map((ownerType, index) => ({
        scopeType: 'COHORT', scopeId: cohort.id, ownerType, action: 'APPROVE', version: 1, actorUserId: approvalUserIds[index],
        reasonCode: 'RACE_APPROVED', authorityHash: 'c'.repeat(64), evidenceHash: evidence.evidenceHash, promotionEvidenceId: evidence.id,
      })) });
      const effectiveFrom = new Date(fixtureClock.now.getTime() + 250);
      await first.$transaction(async (tx) => {
        if (authenticate) await tx.$executeRaw`SELECT set_config('sabalan.performance_promotion_evidence_hash', ${evidence.evidenceHash}, true)`;
        await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'SCHEDULED', effectiveFrom,
          activationReason: 'Isolated promotion evidence race', activatedByUserId: users[0].id, promotionEvidenceId: evidence.id } });
      });
      return { cohort, evidence, subject, effectiveFrom };
    };

    await assert.rejects(() => createScheduledFixture('unverified', users.slice(1).map(({ id }) => id), false),
      /promotion evidence was not authenticated in the current transaction/,
      'PostgreSQL rejects even well-shaped indexed rows unless this transaction authenticated the encrypted report');
    await assert.rejects(() => createScheduledFixture('same-owner', [users[1].id, users[1].id, users[1].id]),
      /three distinct currently authorized owner approvals/,
      'PostgreSQL rejects three role labels when one actor supplied every approval');
    await assert.rejects(() => createScheduledFixture('wrong-gate', undefined, true, 'WRONG_GATE'),
      /missing, stale, revoked, incomplete or unrelated/, 'PostgreSQL rejects an incomplete target gate');
    await assert.rejects(() => createScheduledFixture('unrelated', undefined, true, 'UNRELATED'),
      /missing, stale, revoked, incomplete or unrelated/, 'PostgreSQL rejects evidence bound to another membership');
    await assert.rejects(() => createScheduledFixture('stale', undefined, true, 'STALE'),
      /missing, stale, revoked, incomplete or unrelated/, 'PostgreSQL rejects evidence that expires before scheduling takes effect');

    const revoked = await createScheduledFixture('revoke');
    await delay(Math.max(0, revoked.effectiveFrom.getTime() - Date.now() + 20));
    const revocationHolding = deferred();
    const releaseRevocation = deferred();
    const revoking = first.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
      await tx.performancePromotionEvidenceRevocation.create({ data: { id: `${database.runId}:revocation`,
        promotionEvidenceId: revoked.evidence.id, reasonCode: 'RACE_REVOKED', revokedByUserId: users[0].id } });
      revocationHolding.resolve();
      await releaseRevocation.promise;
    });
    await revocationHolding.promise;
    const activating = second.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
      await tx.$executeRaw`SELECT set_config('sabalan.performance_promotion_evidence_hash', ${revoked.evidence.evidenceHash}, true)`;
      return tx.performanceCohortVersion.update({ where: { id: revoked.cohort.id }, data: { lifecycle: 'ACTIVE' } });
    });
    await delay(30);
    releaseRevocation.resolve();
    await revoking;
    await assert.rejects(activating, /promotion evidence is missing, stale, revoked, incomplete or unrelated/,
      'a revocation that wins the canonical fence must block due activation');
    assert.equal((await first.performanceCohortVersion.findUniqueOrThrow({ where: { id: revoked.cohort.id } })).lifecycle, 'SCHEDULED');

    const changing = await createScheduledFixture('change');
    const extraPersonnel = await first.personnel.create({ data: { firstName: 'آزمون', lastName: 'تغییر' } });
    const extraRelationship = await first.hrEmploymentRelationship.create({ data: { personnelId: extraPersonnel.id, status: 'ACTIVE',
      effectiveFrom: new Date('2020-01-01Z'), createdBy: users[0].id } });
    const extraSubject = await first.performanceSubject.create({ data: { stableKey: `${database.runId}:extra`, nonDisplayKey: `${database.runId}:extra`,
      personnelId: extraPersonnel.id, employmentRelationshipId: extraRelationship.id, createdByUserId: users[0].id } });
    await delay(Math.max(0, changing.effectiveFrom.getTime() - Date.now() + 20));
    const changeHolding = deferred();
    const releaseChange = deferred();
    const membershipChange = first.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
      changeHolding.resolve();
      await releaseChange.promise;
      return tx.performanceCohortMember.create({ data: { cohortVersionId: changing.cohort.id,
        subjectId: extraSubject.id, eligibilityHash: 'f'.repeat(64) } });
    });
    await changeHolding.promise;
    const activationAfterChangeRace = second.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
      await tx.$executeRaw`SELECT set_config('sabalan.performance_promotion_evidence_hash', ${changing.evidence.evidenceHash}, true)`;
      return tx.performanceCohortVersion.update({ where: { id: changing.cohort.id }, data: { lifecycle: 'ACTIVE' } });
    });
    await delay(30);
    releaseChange.resolve();
    await assert.rejects(membershipChange, /PERFORMANCE_COHORT_MEMBERSHIP_FROZEN/,
      'a candidate change that wins the fence still fails against the frozen exact target');
    assert.equal((await activationAfterChangeRace).lifecycle, 'ACTIVE', 'activation rechecks after the losing change releases the fence');
    assert.equal(await first.performanceCohortMember.count({ where: { cohortVersionId: changing.cohort.id } }), 1);
  } finally {
    await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
    await database.cleanup();
  }
};

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
