import type { Prisma } from '@prisma/client';

/** Write the same row even when it exists. A Serializable transaction that
 * took an older snapshot must abort instead of missing a new reservation. */
export async function serializeCustomerAllocationWithin(tx: Prisma.TransactionClient, profileId: string) {
  await tx.$executeRaw`
    INSERT INTO public.accounting_customer_allocation_fences ("profileId") VALUES (${profileId})
    ON CONFLICT ("profileId") DO UPDATE SET "profileId" = EXCLUDED."profileId"
  `;
}
