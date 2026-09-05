import { Prisma, PrismaClient } from '@prisma/client';

type BoundaryClient = PrismaClient | Prisma.TransactionClient;

export const assertProtectedProductionCutoverBoundary = async (
  client: BoundaryClient,
  input: { sourceCommit: string; releaseId: string; environment?: Readonly<Record<string, string | undefined>> },
) => {
  const environment = input.environment ?? process.env;
  if (environment.NODE_ENV !== 'production') return { protectedBoundaryRequired: false as const };
  const deploymentId = String(environment.DEPLOYMENT_ID || '').trim();
  const leaseToken = String(environment.DEPLOYMENT_LEASE_TOKEN || '').trim();
  if (!deploymentId) throw new Error('Production cutover requires the active deployment identity.');
  if (!leaseToken) throw new Error('Production cutover requires the owning deployment lease token.');
  const operation = await client.$queryRaw<Array<{ id: string; activeKey: string | null; phase: string; leaseToken: string;
      leaseExpiresAt: Date; targetCommit: string; releaseId: string }>>(Prisma.sql`
        SELECT "id", "activeKey", "phase", "leaseToken", "leaseExpiresAt", "targetCommit", "releaseId"
        FROM "deployment_operations"
        WHERE "id" = ${deploymentId} AND "leaseToken" = ${leaseToken}
        FOR UPDATE
      `);
  // This must be wall-clock time sampled after the row lock is acquired. transaction_timestamp()
  // would retain the transaction start time and could accept a lease that expired while waiting.
  const clock = await client.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  const now = clock[0]?.now;
  const owned = operation[0];
  if (!owned || !now || owned.activeKey !== 'production' || owned.phase !== 'MIGRATIONS_APPLIED'
    || owned.leaseExpiresAt.getTime() <= now.getTime()
    || owned.targetCommit !== input.sourceCommit || owned.releaseId !== input.releaseId) {
    throw new Error('Production cutover requires the live deployment lease at MIGRATIONS_APPLIED for this exact release and commit.');
  }
  return { protectedBoundaryRequired: true as const, deploymentId, leaseToken, phase: owned.phase, leaseExpiresAt: owned.leaseExpiresAt };
};
