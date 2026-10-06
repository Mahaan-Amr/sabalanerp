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

/** Exact-target admission for Partner self-service. General Sales grants still
 * govern ordinary contracts and lists; handlers retain audited CASE_READ. */
export async function ownsPartnerCustomerContract(
  database: PartnerContractVisibilityDatabase,
  userId: string,
  contractId: string,
): Promise<boolean> {
  const profile = await database.partnerProfile.findUnique({ where: { userId }, select: { id: true } });
  if (!profile) return false;
  return (await database.salesContract.count({ where: { id: contractId,
    partnerKind: 'PARTNER_CUSTOMER', partnerCase: { is: { profileId: profile.id } } } })) === 1;
}
