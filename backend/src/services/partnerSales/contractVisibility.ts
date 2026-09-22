import { Prisma, type PrismaClient } from '@prisma/client';

type PartnerContractVisibilityDatabase = Pick<PrismaClient, 'partnerProfile' | 'salesContract'>;

export function applyPartnerContractListScope(
  current: Prisma.SalesContractWhereInput,
  partnerProfileId: string | null,
): Prisma.SalesContractWhereInput {
  if (!partnerProfileId) return current;
  return { AND: [current, { partnerCase: { is: { profileId: partnerProfileId } } }] };
}

export async function readPartnerProfileId(
  database: PartnerContractVisibilityDatabase,
  userId: string,
  role: string,
): Promise<string | null> {
  if (role === 'ADMIN') return null;
  const profile = await database.partnerProfile.findUnique({ where: { userId }, select: { id: true } });
  return profile?.id ?? null;
}

export async function canPartnerReadSalesContract(
  database: PartnerContractVisibilityDatabase,
  input: { userId: string; role: string; contractId: string },
): Promise<boolean> {
  const profileId = await readPartnerProfileId(database, input.userId, input.role);
  if (!profileId) return true;
  return (await database.salesContract.count({ where: {
    id: input.contractId,
    partnerCase: { is: { profileId } },
  } })) === 1;
}
