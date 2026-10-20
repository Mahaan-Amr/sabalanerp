import type { Prisma } from '@prisma/client';

/** Ordering: ticket mutex before storage-name mutex. Staged promotion only
 * takes sorted storage-name locks; it never subsequently locks existing tickets. */
export const lockSupportTicket = async (tx: Prisma.TransactionClient, ticketId: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'support-ticket-storage:' + ticketId}, 0))`;
  // Ordinary status/reopen writers already take the SQL row lock. Preserve
  // their serialization too, without introducing locks into every route.
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM support_tickets WHERE id = ${ticketId} FOR UPDATE`;
};
export const lockSupportStoredFile = async (tx: Prisma.TransactionClient, storageName: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'support-file:' + storageName}, 0))`;
};
