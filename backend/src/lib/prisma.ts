import { PrismaClient } from '@prisma/client';

const globalDatabaseClient = globalThis as unknown as {
  sabalanPrismaClient?: PrismaClient;
};

/**
 * The only application-runtime Prisma client.
 *
 * Every route, middleware, worker, and service must reuse this instance so the
 * backend owns one connection pool. Standalone scripts and recovery clients
 * that target a different database are the only permitted exceptions.
 */
export const prisma =
  globalDatabaseClient.sabalanPrismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalDatabaseClient.sabalanPrismaClient = prisma;
}

export const disconnectDatabase = async () => {
  await prisma.$disconnect();
};
