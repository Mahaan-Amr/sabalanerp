import type { Prisma } from '@prisma/client';

export async function lockInventoryIdentities(db: Prisma.TransactionClient, ids: readonly string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  }
}
