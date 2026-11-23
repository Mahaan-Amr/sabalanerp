import type { Prisma } from '@prisma/client';

/** The Inquiry owner is immutable. Lock that Profile before the Inquiry:
 * lifecycle termination and responder assignment already own the Profile
 * while updating pending Inquiries, as does the database's write guard. */
export async function lockPartnerProfileAndInquiry(tx: Prisma.TransactionClient, inquiryId: string) {
  const [profile] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM partner_profiles p JOIN partner_inquiries i ON i."profileId" = p.id
    WHERE i.id = ${inquiryId} FOR UPDATE OF p`;
  if (!profile) return null;
  await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${inquiryId} FOR UPDATE`;
  return profile.id;
}
