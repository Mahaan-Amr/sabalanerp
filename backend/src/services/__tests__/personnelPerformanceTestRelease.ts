import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';
import { persistPerformancePayload, performanceVaultKeyFromEnvironment } from '../personnelPerformancePayloadStore';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';

/** Explicit release fixture in the existing local PostgreSQL test harness; never imported by runtime code. */
export const enablePerformanceTestRelease = async (client: PrismaClient | Prisma.TransactionClient, actorUserId: string) => {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost:55432/sabalanerp');
  if (process.env.NODE_ENV === 'production' || !['127.0.0.1:55432','localhost:55432'].includes(url.host)) throw new Error('Performance release fixture requires local test PostgreSQL');
  const latest = await client.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
  if (latest?.releaseEnabled && latest.phase === 'EXPANSION_RETIREMENT' && latest.effectiveFrom <= new Date()) return latest;
  const [clock] = await client.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  return client.performanceFeaturePhaseVersion.create({ data: {
    version: (latest?.version ?? 0) + 1, predecessorId: latest?.id, phase: 'EXPANSION_RETIREMENT', releaseEnabled: true,
    effectiveFrom: clock.now, recordedByUserId: actorUserId, reason: 'Isolated test fixture; not release acceptance evidence',
  } });
};

export const enrollPerformanceTestCohort = async (client: PrismaClient | Prisma.TransactionClient, actorUserId: string, subjectIds: string[]) => {
  await enablePerformanceTestRelease(client, actorUserId);
  const members = [...new Set(subjectIds)].sort();
  const [clock] = await client.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS now`;
  const cohort = await client.performanceCohortVersion.create({ data: {
    cohortKey: `isolated-test-${randomUUID()}`, version: 1, membershipHash: canonicalPerformanceHash(members), createdByUserId: actorUserId,
  } });
  await client.performanceCohortMember.createMany({ data: members.map((subjectId) => ({ cohortVersionId: cohort.id, subjectId,
    eligibilityHash: canonicalPerformanceHash({ subjectId, fixture: 'isolated-local-workflow' }) })) });
  await client.performanceCohortVersion.update({ where: { id: cohort.id }, data: {
    lifecycle: 'SCHEDULED', effectiveFrom: clock.now, activatedByUserId: actorUserId, activationReason: 'Explicit local workflow fixture',
  } });
  await client.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'ACTIVE' } });
  const latest = await client.performanceFeaturePhaseVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
  const [effective] = await client.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  await client.performanceFeaturePhaseVersion.create({ data: {
    version: latest.version + 1, predecessorId: latest.id, phase: latest.phase, releaseEnabled: true,
    cohortVersionId: cohort.id, effectiveFrom: effective.now, recordedByUserId: actorUserId, reason: 'Explicit local workflow cohort fixture',
  } });
  return cohort;
};

/** Synthetic publication for rollback-only tests; never promotion or owner-approval evidence. */
export const publishPerformanceTestRetentionPolicy = async (client: PrismaClient | Prisma.TransactionClient, actorUserId: string) => {
  await enablePerformanceTestRelease(client, actorUserId);
  const existing = await client.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE', effectiveFrom: { lte: new Date() } } });
  if (existing) return existing;
  const id = randomUUID();
  const previewId = randomUUID();
  const latest = await client.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION' }, orderBy: { version: 'desc' } });
  const payload = await persistPerformancePayload(client, { aggregateType: 'POLICY_VERSION', aggregateId: id,
    payloadKind: 'POLICY_CONTENT_REVISION_1', schemaVersion: 1, payload: PERFORMANCE_RETENTION_SCHEDULE_V1, keyring: performanceVaultKeyFromEnvironment() });
  const policy = await client.performancePolicyVersion.create({ data: { id, policyKind: 'RETENTION', version: (latest?.version ?? 0) + 1,
    predecessorId: latest?.id, contentHash: payload.contentHash, encryptedPayloadId: payload.id, createdByUserId: actorUserId } });
  const preview = await persistPerformancePayload(client, { aggregateType: 'POLICY_ACTIVATION_PREVIEW', aggregateId: previewId,
    payloadKind: 'POPULATION_RESULT', schemaVersion: 1, payload: { testFixture: true, population: [] }, keyring: performanceVaultKeyFromEnvironment() });
  const at = new Date(Date.now() - 10_000);
  await client.performancePolicyActivationPreview.create({ data: { id: previewId, policyVersionId: id, policyContentHash: policy.contentHash,
    populationHash: preview.contentHash, encryptedPayloadId: preview.id, eligibleSubjectCount: 0, evaluatedSubjectCount: 0,
    increasedCount: 0, decreasedCount: 0, unchangedCount: 0, expiredCount: 0, needsNewEvaluationCount: 0, errorCount: 0,
    resultHash: preview.contentHash, generatedAt: at, confirmedAt: at, confirmedByUserId: actorUserId } });
  await client.performancePolicyVersion.update({ where: { id }, data: { lifecycle: 'SCHEDULED', effectiveFrom: at,
    publicationReason: 'Isolated retention test fixture', publishedByUserId: actorUserId, publishedAt: at,
    activationPreviewId: previewId, activationPreviewHash: preview.contentHash, activationConfirmedAt: at } });
  return client.performancePolicyVersion.update({ where: { id }, data: { lifecycle: 'ACTIVE' } });
};
