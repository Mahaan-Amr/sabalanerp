import type { Prisma, PrismaClient } from '@prisma/client';

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
