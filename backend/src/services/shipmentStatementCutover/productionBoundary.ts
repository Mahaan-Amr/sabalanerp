import { PrismaClient } from '@prisma/client';

export const assertProtectedProductionCutoverBoundary = async (
  client: PrismaClient,
  input: { sourceCommit: string; releaseId: string; environment?: Readonly<Record<string, string | undefined>> },
) => {
  const environment = input.environment ?? process.env;
  if (environment.NODE_ENV !== 'production') return { protectedBoundaryRequired: false as const };
  const deploymentId = String(environment.DEPLOYMENT_ID || '').trim();
  if (!deploymentId) throw new Error('Production cutover requires the active deployment identity.');
  const [operation, clock] = await Promise.all([
    client.deploymentOperation.findUnique({ where: { id: deploymentId } }),
    client.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS "now"`,
  ]);
  const now = clock[0]?.now;
  if (!operation || !now || operation.activeKey !== 'production' || operation.phase !== 'MIGRATIONS_APPLIED'
    || operation.leaseExpiresAt.getTime() <= now.getTime()
    || operation.targetCommit !== input.sourceCommit || operation.releaseId !== input.releaseId) {
    throw new Error('Production cutover requires the live deployment lease at MIGRATIONS_APPLIED for this exact release and commit.');
  }
  return { protectedBoundaryRequired: true as const, deploymentId, phase: operation.phase, leaseExpiresAt: operation.leaseExpiresAt };
};
