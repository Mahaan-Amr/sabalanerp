import type { Prisma, PrismaClient } from '@prisma/client';
/** EXECUTED DELETE is irreversible. Retained Case history is not an active contract. */
export async function partnerContractWasDeleted(client: Prisma.TransactionClient | PrismaClient, contractId: string): Promise<boolean> {
  return Boolean(await client.contractLifecycleRequest.findFirst({ where: { contractId, kind: 'DELETE', status: 'EXECUTED' }, select: { id: true } }));
}
