import { PrismaClient } from '@prisma/client';
import { applicationRuntimeDatabaseUrl } from '../services/runtimeNativeAuthority';

const globalDatabaseClient = globalThis as unknown as {
  sabalanPrismaClient?: PrismaClient;
  sabalanPrismaDatabaseUrl?: string;
};

const databaseUrl = applicationRuntimeDatabaseUrl();
if (globalDatabaseClient.sabalanPrismaClient && globalDatabaseClient.sabalanPrismaDatabaseUrl !== databaseUrl) {
  throw new Error('RUNTIME_DATABASE_POOL_IDENTITY_CHANGED');
}

/**
 * The only application-runtime Prisma client.
 *
 * Every route, middleware, worker, and service must reuse this instance so the
 * backend owns one connection pool. Standalone scripts and recovery clients
 * that target a different database are the only permitted exceptions.
 */
export const prisma =
  globalDatabaseClient.sabalanPrismaClient ?? new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);

if (process.env.NODE_ENV !== 'production') {
  globalDatabaseClient.sabalanPrismaClient = prisma;
  globalDatabaseClient.sabalanPrismaDatabaseUrl = databaseUrl;
}

export const disconnectDatabase = async () => {
  await prisma.$disconnect();
};
