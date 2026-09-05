import type { Prisma, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';

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
