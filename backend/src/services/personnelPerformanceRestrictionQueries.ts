import type { Prisma, PrismaClient } from '@prisma/client';
type Client = PrismaClient | Prisma.TransactionClient;
export const activePerformanceRestrictionIds = async (client: Client, evaluationIds?: readonly string[]) => [...new Set((await client.performanceEvidenceRestriction.findMany({
  where: { status: 'ACTIVE', ...(evaluationIds ? { evaluationId: { in: [...evaluationIds] } } : {}) },
  select: { evaluationId: true }, orderBy: { evaluationId: 'asc' },
})).map(({ evaluationId }) => evaluationId))];
