import type { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError } from './accountingCustomerTreasury';

/** Write the same row even when it exists. A Serializable transaction that
 * took an older snapshot must abort instead of missing a new reservation. */
export async function serializeCustomerAllocationWithin(tx: Prisma.TransactionClient, profileId: string) {
  await tx.$executeRaw`
    INSERT INTO public.accounting_customer_allocation_fences ("profileId") VALUES (${profileId})
    ON CONFLICT ("profileId") DO UPDATE SET "profileId" = EXCLUDED."profileId"
  `;
}

export async function requireAllocationReservationWithin(tx: Prisma.TransactionClient, profileId: string, input?: {
  sourcePlanHash?: string; correlationId: string; actor: { id: string };
}) {
  await serializeCustomerAllocationWithin(tx, profileId);
  const pending = await tx.accountingCustomerAllocationIntent.findFirst({
    where: { profileId, state: 'PENDING' },
    select: { idempotencyKey: true, commandHash: true, ownerId: true },
  });
  if (pending && (pending.idempotencyKey !== input?.correlationId ||
    pending.commandHash !== input?.sourcePlanHash || pending.ownerId !== input?.actor.id)) {
    throw new AccountingCustomerTreasuryError('ALLOCATION_INTENT_PENDING', 'ابتدا درخواست تخصیص معلق این مشتری را تعیین تکلیف کنید.', 409);
  }
  if (!pending && input?.sourcePlanHash) {
    throw new AccountingCustomerTreasuryError('ALLOCATION_INTENT_REQUIRED', 'درخواست تخصیص تأییدشده پیدا نشد.', 409);
  }
}
