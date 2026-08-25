import type { Prisma, PrismaClient } from '@prisma/client';

type Database = PrismaClient | Prisma.TransactionClient;

export const lockCrossWorkspaceDuty = (database: Database, dutyId: string) =>
  database.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cross-workspace-duty:${dutyId}`}))`;
